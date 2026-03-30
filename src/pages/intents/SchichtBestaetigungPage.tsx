import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, startOfWeek, format, addWeeks, getISOWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StandorteAbteilungenDialog } from '@/components/dialogs/StandorteAbteilungenDialog';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import type { Mitarbeiter, StandorteAbteilungen, Schichtvorlagen, Schichtplanung } from '@/types/app';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconX,
  IconMinus,
  IconUsers,
  IconCalendar,
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconBan,
  IconClock,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Abteilung' },
  { label: 'Woche' },
  { label: 'Bestätigen' },
  { label: 'Zusammenfassung' },
];

type StatusKey = 'geplant' | 'bestaetigt' | 'abwesend' | 'storniert';

interface EnrichedSchicht {
  record_id: string;
  schicht_datum: string;
  mitarbeiterId: string | null;
  schichtId: string | null;
  abteilungId: string | null;
  mitarbeiterName: string;
  schichtName: string;
  status: StatusKey;
}

function getWeekDays(weekOffset: number): Date[] {
  const base = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset);
  return Array.from({ length: 7 }, (_, i) => addDays(base, i));
}

function getWeekLabel(weekOffset: number): string {
  const days = getWeekDays(weekOffset);
  const mon = days[0];
  const sun = days[6];
  const kw = getISOWeek(mon);
  return `KW ${kw}: ${format(mon, 'dd.MM', { locale: de })} – ${format(sun, 'dd.MM.yyyy', { locale: de })}`;
}

export default function SchichtBestaetigungPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // --- All state (must be before early returns) ---
  const [step, setStep] = useState<number>(1);
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [selectedAbteilungId, setSelectedAbteilungId] = useState<string | null>(null);

  // Data
  const [abteilungen, setAbteilungen] = useState<StandorteAbteilungen[]>([]);
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter[]>([]);
  const [schichtvorlagen, setSchichtvorlagen] = useState<Schichtvorlagen[]>([]);
  const [schichtplanung, setSchichtplanung] = useState<Schichtplanung[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Dialog state
  const [abteilungDialogOpen, setAbteilungDialogOpen] = useState(false);

  // Track local status changes: Map<record_id, StatusKey>
  const [localStatusMap, setLocalStatusMap] = useState<Map<string, StatusKey>>(new Map());
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  // --- Deep-link init ---
  useEffect(() => {
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    const urlAbteilungId = searchParams.get('abteilungId');
    const urlWeekOffset = parseInt(searchParams.get('weekOffset') ?? '0', 10);

    if (urlAbteilungId) {
      setSelectedAbteilungId(urlAbteilungId);
      if (urlStep >= 2 && urlStep <= 4) {
        setStep(urlStep);
      } else {
        setStep(2);
      }
    } else if (urlStep >= 1 && urlStep <= 4) {
      setStep(urlStep);
    }
    if (!isNaN(urlWeekOffset)) {
      setWeekOffset(urlWeekOffset);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL when state changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (step > 1) params.set('step', String(step));
    if (selectedAbteilungId) params.set('abteilungId', selectedAbteilungId);
    if (weekOffset !== 0) params.set('weekOffset', String(weekOffset));
    setSearchParams(params, { replace: true });
  }, [step, selectedAbteilungId, weekOffset, setSearchParams]);

  // --- Data loading ---
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [abt, mit, schv, schp] = await Promise.all([
        LivingAppsService.getStandorteAbteilungen(),
        LivingAppsService.getMitarbeiter(),
        LivingAppsService.getSchichtvorlagen(),
        LivingAppsService.getSchichtplanung(),
      ]);
      setAbteilungen(abt);
      setMitarbeiter(mit);
      setSchichtvorlagen(schv);
      setSchichtplanung(schp);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Unbekannter Fehler'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // --- Lookup maps ---
  const mitarbeiterMap = useMemo(() => {
    const m = new Map<string, Mitarbeiter>();
    for (const ma of mitarbeiter) m.set(ma.record_id, ma);
    return m;
  }, [mitarbeiter]);

  const schichtvorlagenMap = useMemo(() => {
    const m = new Map<string, Schichtvorlagen>();
    for (const sv of schichtvorlagen) m.set(sv.record_id, sv);
    return m;
  }, [schichtvorlagen]);

  // --- Enrich Schichtplanung ---
  const enrichedSchichten = useMemo((): EnrichedSchicht[] => {
    return schichtplanung.map((s) => {
      const mitarbeiterId = extractRecordId(s.fields.mitarbeiter_ref);
      const schichtId = extractRecordId(s.fields.schicht_ref);
      const abteilungId = extractRecordId(s.fields.planung_abteilung_ref);
      const ma = mitarbeiterId ? mitarbeiterMap.get(mitarbeiterId) : undefined;
      const sv = schichtId ? schichtvorlagenMap.get(schichtId) : undefined;
      const rawStatus = s.fields.schicht_status;
      const statusKey: StatusKey = (rawStatus && typeof rawStatus === 'object'
        ? (rawStatus as { key: string }).key
        : (rawStatus as string | undefined) ?? 'geplant') as StatusKey;

      return {
        record_id: s.record_id,
        schicht_datum: s.fields.schicht_datum ?? '',
        mitarbeiterId,
        schichtId,
        abteilungId,
        mitarbeiterName: ma ? `${ma.fields.vorname ?? ''} ${ma.fields.nachname ?? ''}`.trim() : '—',
        schichtName: sv?.fields.schicht_name ?? '—',
        status: statusKey,
      };
    });
  }, [schichtplanung, mitarbeiterMap, schichtvorlagenMap]);

  // Count "geplant" shifts per abteilung
  const geplantCountByAbteilung = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of enrichedSchichten) {
      if (s.abteilungId && s.status === 'geplant') {
        m.set(s.abteilungId, (m.get(s.abteilungId) ?? 0) + 1);
      }
    }
    return m;
  }, [enrichedSchichten]);

  // --- Selected abteilung ---
  const selectedAbteilung = useMemo(
    () => (selectedAbteilungId ? abteilungen.find((a) => a.record_id === selectedAbteilungId) : undefined),
    [selectedAbteilungId, abteilungen]
  );

  // --- Week shifts (for selected abteilung × week) ---
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const weekDates = useMemo(() => weekDays.map((d) => format(d, 'yyyy-MM-dd')), [weekDays]);

  const weekSchichten = useMemo((): EnrichedSchicht[] => {
    if (!selectedAbteilungId) return [];
    return enrichedSchichten.filter(
      (s) =>
        s.abteilungId === selectedAbteilungId &&
        weekDates.includes(s.schicht_datum)
    );
  }, [enrichedSchichten, selectedAbteilungId, weekDates]);

  // Resolve status (with local overrides)
  function resolveStatus(s: EnrichedSchicht): StatusKey {
    return localStatusMap.get(s.record_id) ?? s.status;
  }

  // --- Week stats ---
  const weekStats = useMemo(() => {
    const total = weekSchichten.length;
    const geplant = weekSchichten.filter((s) => resolveStatus(s) === 'geplant').length;
    const bestaetigt = weekSchichten.filter((s) => resolveStatus(s) === 'bestaetigt').length;
    const abwesend = weekSchichten.filter((s) => resolveStatus(s) === 'abwesend').length;
    const storniert = weekSchichten.filter((s) => resolveStatus(s) === 'storniert').length;
    return { total, geplant, bestaetigt, abwesend, storniert };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekSchichten, localStatusMap]);

  // --- Status change handler ---
  async function handleStatusChange(recordId: string, newStatus: StatusKey) {
    if (updatingIds.has(recordId)) return;
    setUpdatingIds((prev) => new Set(prev).add(recordId));
    try {
      await LivingAppsService.updateSchichtplanungEntry(recordId, { schicht_status: newStatus });
      setLocalStatusMap((prev) => {
        const next = new Map(prev);
        next.set(recordId, newStatus);
        return next;
      });
    } catch {
      // silently ignore for now
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(recordId);
        return next;
      });
    }
  }

  async function handleAlleBestaetigen() {
    const toConfirm = weekSchichten.filter((s) => resolveStatus(s) === 'geplant');
    for (const s of toConfirm) {
      await handleStatusChange(s.record_id, 'bestaetigt');
    }
  }

  // Shift step to step 4: re-fetch data
  async function handleGoToSummary() {
    await fetchAll();
    setLocalStatusMap(new Map());
    setStep(4);
  }

  // --- Step 1: Abteilung wählen ---
  const abteilungItems = useMemo(
    () =>
      abteilungen.map((a) => {
        const geplant = geplantCountByAbteilung.get(a.record_id) ?? 0;
        const addrParts = [a.fields.standort_strasse, a.fields.standort_hausnummer, a.fields.standort_plz, a.fields.standort_ort].filter(Boolean);
        return {
          id: a.record_id,
          title: [a.fields.standort_name, a.fields.abteilung_name].filter(Boolean).join(' – ') || '(Unbenannt)',
          subtitle: addrParts.join(' ') || a.fields.standort_beschreibung || undefined,
          stats: [
            { label: 'Unbestätigte Schichten', value: geplant > 0 ? `${geplant} offen` : '–' },
          ],
        };
      }),
    [abteilungen, geplantCountByAbteilung]
  );

  function handleAbteilungSelect(id: string) {
    setSelectedAbteilungId(id);
    setLocalStatusMap(new Map());
    setStep(2);
  }

  // --- Status label map ---
  const STATUS_LABELS: Record<StatusKey, string> = {
    geplant: 'Geplant',
    bestaetigt: 'Bestätigt',
    abwesend: 'Abwesend',
    storniert: 'Storniert',
  };

  const STATUS_BADGE_COLORS: Record<StatusKey, string> = {
    geplant: 'bg-blue-100 text-blue-700 border-blue-200',
    bestaetigt: 'bg-green-100 text-green-700 border-green-200',
    abwesend: 'bg-amber-100 text-amber-700 border-amber-200',
    storniert: 'bg-red-100 text-red-600 border-red-200',
  };

  // --- Render ---
  const abteilungName = selectedAbteilung
    ? [selectedAbteilung.fields.standort_name, selectedAbteilung.fields.abteilung_name].filter(Boolean).join(' – ') || '(Unbenannt)'
    : '';

  return (
    <IntentWizardShell
      title="Schichtbestätigung"
      subtitle="Bestätige geplante Schichten für deine Abteilung."
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ─── Step 1: Abteilung wählen ─────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Standort / Abteilung wählen</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wähle die Abteilung, für die du Schichten bestätigen möchtest.
            </p>
          </div>
          <EntitySelectStep
            items={abteilungItems}
            onSelect={handleAbteilungSelect}
            searchPlaceholder="Abteilung oder Standort suchen…"
            emptyIcon={<IconUsers size={32} />}
            emptyText="Keine Abteilungen gefunden."
            createLabel="Neue Abteilung anlegen"
            onCreateNew={() => setAbteilungDialogOpen(true)}
            createDialog={
              <StandorteAbteilungenDialog
                open={abteilungDialogOpen}
                onClose={() => setAbteilungDialogOpen(false)}
                onSubmit={async (fields) => {
                  await LivingAppsService.createStandorteAbteilungenEntry(fields);
                  await fetchAll();
                  setAbteilungDialogOpen(false);
                }}
                enablePhotoScan={AI_PHOTO_SCAN['StandorteAbteilungen']}
                enablePhotoLocation={AI_PHOTO_LOCATION['StandorteAbteilungen']}
              />
            }
          />
        </div>
      )}

      {/* ─── Step 2: Woche wählen ──────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <IconChevronLeft size={16} />
              Zurück
            </button>
            <div>
              <h2 className="text-lg font-semibold">Woche wählen</h2>
              <p className="text-sm text-muted-foreground">{abteilungName}</p>
            </div>
          </div>

          {/* Week picker */}
          <Card className="p-4 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekOffset((w) => w - 1)}
                aria-label="Vorherige Woche"
              >
                <IconChevronLeft size={18} />
              </Button>
              <div className="flex items-center gap-2 text-sm font-medium">
                <IconCalendar size={16} className="text-muted-foreground shrink-0" />
                <span>{getWeekLabel(weekOffset)}</span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekOffset((w) => w + 1)}
                aria-label="Nächste Woche"
              >
                <IconChevronRight size={18} />
              </Button>
            </div>
          </Card>

          {/* Week summary */}
          <Card className="p-4 overflow-hidden">
            <h3 className="text-sm font-semibold mb-3">Wochenzusammenfassung</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="text-xl font-bold">{weekStats.total}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Schichten gesamt</div>
              </div>
              <div className={`rounded-lg p-3 text-center ${weekStats.geplant > 0 ? 'bg-blue-50 border border-blue-200' : 'bg-muted/50'}`}>
                <div className={`text-xl font-bold ${weekStats.geplant > 0 ? 'text-blue-700' : ''}`}>{weekStats.geplant}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Unbestätigt</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="text-xl font-bold text-green-700">{weekStats.bestaetigt}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Bestätigt</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="text-xl font-bold">{weekStats.total}</div>
                <div className="text-xs text-muted-foreground mt-0.5">in der Woche</div>
              </div>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => setStep(3)}
              disabled={weekStats.geplant === 0 && weekStats.total === 0}
            >
              {weekStats.geplant === 0 && weekStats.total > 0
                ? 'Alle bestätigt – trotzdem öffnen'
                : weekStats.total === 0
                ? 'Keine Schichten in dieser Woche'
                : `${weekStats.geplant} Schicht${weekStats.geplant !== 1 ? 'en' : ''} bestätigen`}
              <IconChevronRight size={16} className="ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Schichten bestätigen ─────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Context + back */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <IconChevronLeft size={16} />
              Zurück
            </button>
            <div>
              <h2 className="text-lg font-semibold">Schichten bestätigen</h2>
              <p className="text-sm text-muted-foreground">
                {abteilungName} · {getWeekLabel(weekOffset)}
              </p>
            </div>
          </div>

          {/* Live stats bar */}
          <Card className="p-3 overflow-hidden sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-green-700 font-medium">
                <IconCircleCheck size={15} />
                Bestätigt: <strong>{weekSchichten.filter((s) => resolveStatus(s) === 'bestaetigt').length}</strong>
              </span>
              <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                <IconAlertTriangle size={15} />
                Abwesend: <strong>{weekSchichten.filter((s) => resolveStatus(s) === 'abwesend').length}</strong>
              </span>
              <span className="flex items-center gap-1.5 text-red-600 font-medium">
                <IconBan size={15} />
                Storniert: <strong>{weekSchichten.filter((s) => resolveStatus(s) === 'storniert').length}</strong>
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <IconClock size={15} />
                Offen: <strong>{weekSchichten.filter((s) => resolveStatus(s) === 'geplant').length}</strong>
              </span>
            </div>
          </Card>

          {weekSchichten.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <IconCalendar size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">Keine Schichten in dieser Woche gefunden.</p>
            </div>
          ) : (
            <>
              {/* Group by day */}
              {weekDays.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const daySchichten = weekSchichten.filter((s) => s.schicht_datum === dateStr);
                if (daySchichten.length === 0) return null;
                return (
                  <div key={dateStr} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {format(day, 'EEEE, dd.MM.yyyy', { locale: de })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({daySchichten.length} Schicht{daySchichten.length !== 1 ? 'en' : ''})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {daySchichten.map((schicht) => {
                        const currentStatus = resolveStatus(schicht);
                        const isUpdating = updatingIds.has(schicht.record_id);
                        return (
                          <Card key={schicht.record_id} className="p-3 overflow-hidden">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm truncate">
                                    {schicht.mitarbeiterName}
                                  </span>
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE_COLORS[currentStatus]}`}
                                  >
                                    {STATUS_LABELS[currentStatus]}
                                  </span>
                                  {isUpdating && (
                                    <IconLoader2 size={14} className="animate-spin text-muted-foreground" />
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                  {schicht.schichtName}
                                </p>
                              </div>
                              {/* Action buttons — always visible */}
                              <div className="flex gap-1.5 shrink-0">
                                <button
                                  onClick={() => handleStatusChange(schicht.record_id, 'bestaetigt')}
                                  disabled={isUpdating || currentStatus === 'bestaetigt'}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                    currentStatus === 'bestaetigt'
                                      ? 'bg-green-100 text-green-700 border-green-200 cursor-default'
                                      : 'bg-white border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-40'
                                  }`}
                                  title="Bestätigen"
                                >
                                  <IconCheck size={13} stroke={2.5} />
                                  <span className="hidden sm:inline">Bestätigen</span>
                                </button>
                                <button
                                  onClick={() => handleStatusChange(schicht.record_id, 'abwesend')}
                                  disabled={isUpdating || currentStatus === 'abwesend'}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                    currentStatus === 'abwesend'
                                      ? 'bg-amber-100 text-amber-700 border-amber-200 cursor-default'
                                      : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-40'
                                  }`}
                                  title="Abwesend"
                                >
                                  <IconMinus size={13} stroke={2.5} />
                                  <span className="hidden sm:inline">Abwesend</span>
                                </button>
                                <button
                                  onClick={() => handleStatusChange(schicht.record_id, 'storniert')}
                                  disabled={isUpdating || currentStatus === 'storniert'}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                    currentStatus === 'storniert'
                                      ? 'bg-red-100 text-red-600 border-red-200 cursor-default'
                                      : 'bg-white border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40'
                                  }`}
                                  title="Stornieren"
                                >
                                  <IconX size={13} stroke={2.5} />
                                  <span className="hidden sm:inline">Stornieren</span>
                                </button>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Bottom actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            {weekStats.geplant > 0 && (
              <Button
                variant="outline"
                onClick={handleAlleBestaetigen}
                disabled={updatingIds.size > 0}
                className="gap-1.5"
              >
                <IconCircleCheck size={16} />
                Alle bestätigen ({weekStats.geplant})
              </Button>
            )}
            <div className="flex-1" />
            <Button onClick={handleGoToSummary} className="gap-1.5">
              Weiter zur Zusammenfassung
              <IconChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step 4: Zusammenfassung ──────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Zusammenfassung</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {abteilungName} · {getWeekLabel(weekOffset)}
            </p>
          </div>

          {/* Final stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4 overflow-hidden text-center">
              <div className="flex justify-center mb-2">
                <IconCircleCheck size={24} className="text-green-600" />
              </div>
              <div className="text-2xl font-bold text-green-700">
                {weekSchichten.filter((s) => (s.status as StatusKey) === 'bestaetigt').length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Bestätigt</div>
            </Card>
            <Card className="p-4 overflow-hidden text-center">
              <div className="flex justify-center mb-2">
                <IconAlertTriangle size={24} className="text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-amber-700">
                {weekSchichten.filter((s) => (s.status as StatusKey) === 'abwesend').length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Abwesend</div>
            </Card>
            <Card className="p-4 overflow-hidden text-center">
              <div className="flex justify-center mb-2">
                <IconBan size={24} className="text-red-500" />
              </div>
              <div className="text-2xl font-bold text-red-600">
                {weekSchichten.filter((s) => (s.status as StatusKey) === 'storniert').length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Storniert</div>
            </Card>
            <Card className="p-4 overflow-hidden text-center">
              <div className="flex justify-center mb-2">
                <IconClock size={24} className="text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">
                {weekSchichten.filter((s) => (s.status as StatusKey) === 'geplant').length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Noch offen</div>
            </Card>
          </div>

          {/* Shift list overview */}
          {weekSchichten.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="text-sm font-semibold">Alle Schichten dieser Woche</h3>
              </div>
              <div className="divide-y overflow-x-auto">
                {weekSchichten
                  .slice()
                  .sort((a, b) => a.schicht_datum.localeCompare(b.schicht_datum))
                  .map((s) => (
                    <div key={s.record_id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="text-xs text-muted-foreground w-20 shrink-0">
                        {s.schicht_datum ? format(new Date(s.schicht_datum + 'T00:00:00'), 'EEE dd.MM', { locale: de }) : '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block">{s.mitarbeiterName}</span>
                        <span className="text-xs text-muted-foreground truncate block">{s.schichtName}</span>
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${STATUS_BADGE_COLORS[s.status as StatusKey] ?? 'bg-muted text-muted-foreground border-muted'}`}
                      >
                        {STATUS_LABELS[s.status as StatusKey] ?? s.status}
                      </span>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          {/* Navigation actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setLocalStatusMap(new Map());
                setStep(2);
              }}
              className="gap-1.5"
            >
              <IconCalendar size={16} />
              Neue Woche bearbeiten
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedAbteilungId(null);
                setLocalStatusMap(new Map());
                setStep(1);
              }}
              className="gap-1.5"
            >
              <IconUsers size={16} />
              Andere Abteilung
            </Button>
            <div className="flex-1" />
            <Button asChild variant="default" className="gap-1.5">
              <a href="#/">
                Zum Dashboard
              </a>
            </Button>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
