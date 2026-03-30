import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, startOfWeek, addDays, getISOWeek, addWeeks } from 'date-fns';
import { de } from 'date-fns/locale';

import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { StandorteAbteilungenDialog } from '@/components/dialogs/StandorteAbteilungenDialog';
import { SchichtvorlagenDialog } from '@/components/dialogs/SchichtvorlagenDialog';
import { MitarbeiterDialog } from '@/components/dialogs/MitarbeiterDialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

import {
  LivingAppsService,
  extractRecordId,
  createRecordUrl,
} from '@/services/livingAppsService';
import { APP_IDS } from '@/types/app';
import type { StandorteAbteilungen, Mitarbeiter, Schichtvorlagen, Schichtplanung } from '@/types/app';
import { AI_PHOTO_SCAN } from '@/config/ai-features';
import {
  IconPlus,
  IconChevronLeft,
  IconChevronRight,
  IconCalendar,
  IconUsers,
  IconCheck,
  IconLoader2,
  IconBuildingFactory2,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Abteilung' },
  { label: 'Woche' },
  { label: 'Schichten' },
  { label: 'Fertig' },
];

// Assignment grid: mitarbeiterId -> dayIndex (0=Mon..6=Sun) -> schichtvorlagenId | ''
type AssignmentGrid = Record<string, Record<number, string>>;

function getWeekStart(weekOffset: number): Date {
  const now = new Date();
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  return addWeeks(monday, weekOffset);
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export default function SchichtWochenplanPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // --- Step state (1-indexed to match IntentWizardShell) ---
  const initialStep = parseInt(searchParams.get('step') ?? '1', 10);
  const [step, setStep] = useState<number>(
    initialStep >= 1 && initialStep <= 4 ? initialStep : 1
  );

  // --- Data state ---
  const [abteilungen, setAbteilungen] = useState<StandorteAbteilungen[]>([]);
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter[]>([]);
  const [schichtvorlagen, setSchichtvorlagen] = useState<Schichtvorlagen[]>([]);
  const [schichtplanung, setSchichtplanung] = useState<Schichtplanung[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // --- Selection state ---
  const initialAbteilungId = searchParams.get('abteilungId') ?? '';
  const [selectedAbteilungId, setSelectedAbteilungId] = useState<string>(initialAbteilungId);

  const initialWeekOffset = parseInt(searchParams.get('weekOffset') ?? '0', 10);
  const [weekOffset, setWeekOffset] = useState<number>(
    isNaN(initialWeekOffset) ? 0 : initialWeekOffset
  );

  // Assignment grid: mitarbeiterId -> dayIndex -> schichtvorlagenId | ''
  const [assignments, setAssignments] = useState<AssignmentGrid>({});

  // Summary after creation
  const [createdCount, setCreatedCount] = useState<number>(0);
  const [creating, setCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Dialog open state
  const [abteilungDialogOpen, setAbteilungDialogOpen] = useState(false);
  const [schichtvorlagenDialogOpen, setSchichtvorlagenDialogOpen] = useState(false);
  const [mitarbeiterDialogOpen, setMitarbeiterDialogOpen] = useState(false);

  // --- Fetch all data ---
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [abt, ma, sv, sp] = await Promise.all([
        LivingAppsService.getStandorteAbteilungen(),
        LivingAppsService.getMitarbeiter(),
        LivingAppsService.getSchichtvorlagen(),
        LivingAppsService.getSchichtplanung(),
      ]);
      setAbteilungen(abt);
      setMitarbeiter(ma);
      setSchichtvorlagen(sv);
      setSchichtplanung(sp);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Deep-link: if abteilungId is in URL and data loaded, skip to step 2
  useEffect(() => {
    if (!loading && initialAbteilungId && step === 1) {
      const found = abteilungen.find(a => a.record_id === initialAbteilungId);
      if (found) {
        setSelectedAbteilungId(initialAbteilungId);
        setStep(2);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, abteilungen]);

  // Sync weekOffset to URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (weekOffset !== 0) {
      params.set('weekOffset', String(weekOffset));
    } else {
      params.delete('weekOffset');
    }
    if (selectedAbteilungId) {
      params.set('abteilungId', selectedAbteilungId);
    } else {
      params.delete('abteilungId');
    }
    setSearchParams(params, { replace: true });
  }, [weekOffset, selectedAbteilungId, searchParams, setSearchParams]);

  // --- Computed values ---
  const weekStart = useMemo(() => getWeekStart(weekOffset), [weekOffset]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const weekNumber = useMemo(() => getISOWeek(weekStart), [weekStart]);
  const weekLabel = useMemo(() => {
    const mon = format(weekDays[0], 'dd.MM', { locale: de });
    const sun = format(weekDays[6], 'dd.MM.yyyy', { locale: de });
    return `KW ${weekNumber}: ${mon} – ${sun}`;
  }, [weekDays, weekNumber]);

  const selectedAbteilung = useMemo(
    () => abteilungen.find(a => a.record_id === selectedAbteilungId) ?? null,
    [abteilungen, selectedAbteilungId]
  );

  const abteilungMitarbeiter = useMemo(
    () =>
      mitarbeiter.filter(
        m => extractRecordId(m.fields.abteilung_ref) === selectedAbteilungId
      ),
    [mitarbeiter, selectedAbteilungId]
  );

  // Count existing Schichtplanung records for this abteilung × week
  const existingShiftCount = useMemo(() => {
    const weekDayStrings = weekDays.map(d => format(d, 'yyyy-MM-dd'));
    return schichtplanung.filter(sp => {
      const abtId = extractRecordId(sp.fields.planung_abteilung_ref);
      const datum = sp.fields.schicht_datum?.slice(0, 10) ?? '';
      return abtId === selectedAbteilungId && weekDayStrings.includes(datum);
    }).length;
  }, [schichtplanung, selectedAbteilungId, weekDays]);

  // Count of assignments with a schichtvorlage selected
  const plannedShiftCount = useMemo(() => {
    let count = 0;
    for (const dayMap of Object.values(assignments)) {
      for (const val of Object.values(dayMap)) {
        if (val !== '') count++;
      }
    }
    return count;
  }, [assignments]);

  // Initialize assignment grid when mitarbeiter or week changes (step 3)
  useEffect(() => {
    if (step !== 3) return;
    setAssignments(prev => {
      const next: AssignmentGrid = {};
      for (const m of abteilungMitarbeiter) {
        next[m.record_id] = {};
        for (let d = 0; d < 7; d++) {
          next[m.record_id][d] = prev[m.record_id]?.[d] ?? '';
        }
      }
      return next;
    });
  }, [step, abteilungMitarbeiter]);

  // --- Handlers ---
  const handleSelectAbteilung = (id: string) => {
    setSelectedAbteilungId(id);
    setStep(2);
  };

  const handleStepChange = (newStep: number) => {
    setStep(newStep);
  };

  const handleAssignmentChange = (mitarbeiterId: string, dayIndex: number, value: string) => {
    setAssignments(prev => ({
      ...prev,
      [mitarbeiterId]: {
        ...prev[mitarbeiterId],
        [dayIndex]: value,
      },
    }));
  };

  const handleBatchCreate = async () => {
    setCreating(true);
    setCreateError(null);
    const tasks: Promise<unknown>[] = [];
    for (const [mitarbeiterId, dayMap] of Object.entries(assignments)) {
      for (const [dayIndexStr, schichtvorlagenId] of Object.entries(dayMap)) {
        if (!schichtvorlagenId) continue;
        const dayIndex = parseInt(dayIndexStr, 10);
        const date = weekDays[dayIndex];
        const dateStr = format(date, 'yyyy-MM-dd');
        tasks.push(
          LivingAppsService.createSchichtplanungEntry({
            schicht_datum: dateStr,
            mitarbeiter_ref: createRecordUrl(APP_IDS.MITARBEITER, mitarbeiterId),
            schicht_ref: createRecordUrl(APP_IDS.SCHICHTVORLAGEN, schichtvorlagenId),
            planung_abteilung_ref: createRecordUrl(APP_IDS.STANDORTE_ABTEILUNGEN, selectedAbteilungId),
            schicht_status: 'geplant',
          })
        );
      }
    }
    try {
      await Promise.all(tasks);
      setCreatedCount(tasks.length);
      await fetchAll();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  // Trigger batch create when entering step 4
  useEffect(() => {
    if (step === 4 && !creating && createdCount === 0 && createError === null) {
      handleBatchCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleReset = () => {
    setSelectedAbteilungId('');
    setWeekOffset(0);
    setAssignments({});
    setCreatedCount(0);
    setCreateError(null);
    setCreating(false);
    setStep(1);
  };

  const abteilungName = selectedAbteilung
    ? (selectedAbteilung.fields.abteilung_name || selectedAbteilung.fields.standort_name || '—')
    : '—';

  return (
    <IntentWizardShell
      title="Schicht-Wochenplan"
      subtitle="Plane alle Schichten einer Abteilung für eine ganze Woche auf einmal."
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={handleStepChange}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ===== STEP 1: Abteilung wählen ===== */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold mb-1">Standort / Abteilung wählen</h2>
            <p className="text-sm text-muted-foreground">
              Wähle die Abteilung, für die du den Wochenplan erstellen möchtest.
            </p>
          </div>
          <EntitySelectStep
            items={abteilungen.map(a => ({
              id: a.record_id,
              title: a.fields.abteilung_name || a.fields.standort_name || '(ohne Name)',
              subtitle: [
                a.fields.standort_plz,
                a.fields.standort_ort,
                a.fields.standort_strasse,
              ]
                .filter(Boolean)
                .join(' ') || undefined,
              icon: <IconBuildingFactory2 size={20} className="text-primary" />,
            }))}
            onSelect={handleSelectAbteilung}
            searchPlaceholder="Abteilung suchen..."
            emptyText="Keine Abteilungen gefunden."
            createLabel="Neue Abteilung"
            onCreateNew={() => setAbteilungDialogOpen(true)}
            createDialog={
              <StandorteAbteilungenDialog
                open={abteilungDialogOpen}
                onClose={() => setAbteilungDialogOpen(false)}
                onSubmit={async fields => {
                  await LivingAppsService.createStandorteAbteilungenEntry(fields);
                  await fetchAll();
                  setAbteilungDialogOpen(false);
                }}
                enablePhotoScan={AI_PHOTO_SCAN['StandorteAbteilungen']}
              />
            }
          />
        </div>
      )}

      {/* ===== STEP 2: Woche wählen ===== */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-1">Woche wählen</h2>
            <p className="text-sm text-muted-foreground">
              Abteilung:{' '}
              <span className="font-medium text-foreground">{abteilungName}</span>
            </p>
          </div>

          {/* Week picker */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekOffset(w => w - 1)}
              aria-label="Vorherige Woche"
            >
              <IconChevronLeft size={18} />
            </Button>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border bg-card min-w-0">
              <IconCalendar size={16} className="text-muted-foreground shrink-0" />
              <span className="font-medium text-sm truncate">{weekLabel}</span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekOffset(w => w + 1)}
              aria-label="Nächste Woche"
            >
              <IconChevronRight size={18} />
            </Button>
            {weekOffset !== 0 && (
              <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
                Aktuelle Woche
              </Button>
            )}
          </div>

          {existingShiftCount > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <IconCalendar size={16} className="shrink-0" />
              <span>
                <span className="font-semibold">{existingShiftCount} Schicht{existingShiftCount !== 1 ? 'en' : ''}</span>{' '}
                bereits für diese Abteilung und Woche geplant.
              </span>
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" onClick={() => setStep(1)}>
              <IconChevronLeft size={16} className="mr-1" />
              Zurück
            </Button>
            <Button onClick={() => setStep(3)}>
              Weiter zur Schichtzuweisung
              <IconChevronRight size={16} className="ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ===== STEP 3: Schichten zuweisen ===== */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold mb-1">Schichten zuweisen</h2>
              <p className="text-sm text-muted-foreground">
                Abteilung:{' '}
                <span className="font-medium text-foreground">{abteilungName}</span>
                {' · '}
                <span className="font-medium text-foreground">{weekLabel}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-sm px-3 py-1">
                <IconCalendar size={14} className="mr-1.5" />
                {plannedShiftCount} Schicht{plannedShiftCount !== 1 ? 'en' : ''} werden angelegt
              </Badge>
            </div>
          </div>

          {/* Quick-add buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSchichtvorlagenDialogOpen(true)}
            >
              <IconPlus size={15} className="mr-1.5" />
              Neue Schichtvorlage
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMitarbeiterDialogOpen(true)}
            >
              <IconUsers size={15} className="mr-1.5" />
              Mitarbeiter hinzufügen
            </Button>
          </div>

          {/* Dialogs */}
          <SchichtvorlagenDialog
            open={schichtvorlagenDialogOpen}
            onClose={() => setSchichtvorlagenDialogOpen(false)}
            onSubmit={async fields => {
              await LivingAppsService.createSchichtvorlagenEntry(fields);
              await fetchAll();
              setSchichtvorlagenDialogOpen(false);
            }}
            standorte_abteilungenList={abteilungen}
            enablePhotoScan={AI_PHOTO_SCAN['Schichtvorlagen']}
          />
          <MitarbeiterDialog
            open={mitarbeiterDialogOpen}
            onClose={() => setMitarbeiterDialogOpen(false)}
            onSubmit={async fields => {
              await LivingAppsService.createMitarbeiterEntry(fields);
              await fetchAll();
              setMitarbeiterDialogOpen(false);
            }}
            standorte_abteilungenList={abteilungen}
            enablePhotoScan={AI_PHOTO_SCAN['Mitarbeiter']}
          />

          {abteilungMitarbeiter.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border rounded-xl bg-card">
              <IconUsers size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Keine Mitarbeiter in dieser Abteilung.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMitarbeiterDialogOpen(true)}
                className="mt-3"
              >
                <IconPlus size={14} className="mr-1.5" />
                Mitarbeiter hinzufügen
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground min-w-[140px] sticky left-0 bg-muted/50 z-10">
                      Mitarbeiter
                    </th>
                    {weekDays.map((day, i) => (
                      <th
                        key={i}
                        className="text-center px-2 py-3 font-medium text-muted-foreground min-w-[120px]"
                      >
                        <div className="text-xs font-semibold uppercase tracking-wide">
                          {format(day, 'EEE', { locale: de })}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(day, 'dd.MM', { locale: de })}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {abteilungMitarbeiter.map((m, rowIdx) => (
                    <tr
                      key={m.record_id}
                      className={rowIdx % 2 === 0 ? '' : 'bg-muted/20'}
                    >
                      <td className={`px-4 py-2 font-medium truncate max-w-[160px] sticky left-0 z-10 ${rowIdx % 2 === 0 ? 'bg-card' : 'bg-muted/20'}`}>
                        <span className="truncate block">
                          {[m.fields.vorname, m.fields.nachname].filter(Boolean).join(' ') || '(ohne Name)'}
                        </span>
                        {m.fields.position && (
                          <span className="text-xs text-muted-foreground truncate block">
                            {m.fields.position}
                          </span>
                        )}
                      </td>
                      {Array.from({ length: 7 }, (_, dayIndex) => (
                        <td key={dayIndex} className="px-2 py-2 text-center">
                          <Select
                            value={assignments[m.record_id]?.[dayIndex] ?? ''}
                            onValueChange={val =>
                              handleAssignmentChange(m.record_id, dayIndex, val)
                            }
                          >
                            <SelectTrigger className="w-full min-w-[100px] text-xs h-8">
                              <SelectValue placeholder="Frei" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">Frei</SelectItem>
                              {schichtvorlagen.map(sv => (
                                <SelectItem key={sv.record_id} value={sv.record_id}>
                                  {sv.fields.schicht_kuerzel
                                    ? `${sv.fields.schicht_kuerzel} – ${sv.fields.schicht_name ?? ''}`
                                    : (sv.fields.schicht_name ?? sv.record_id)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" onClick={() => setStep(2)}>
              <IconChevronLeft size={16} className="mr-1" />
              Zurück
            </Button>
            <Button
              onClick={() => {
                setCreatedCount(0);
                setCreateError(null);
                setCreating(false);
                setStep(4);
              }}
              disabled={plannedShiftCount === 0}
            >
              {plannedShiftCount === 0
                ? 'Keine Schichten ausgewählt'
                : `${plannedShiftCount} Schicht${plannedShiftCount !== 1 ? 'en' : ''} anlegen`}
              <IconCheck size={16} className="ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ===== STEP 4: Erstellen & Zusammenfassung ===== */}
      {step === 4 && (
        <div className="space-y-6">
          {creating && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <IconLoader2 size={36} className="text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">
                Schichten werden angelegt...
              </p>
            </div>
          )}

          {!creating && createError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 space-y-3">
              <p className="font-semibold text-destructive">Fehler beim Anlegen</p>
              <p className="text-sm text-muted-foreground">{createError}</p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(3)}>
                  <IconChevronLeft size={16} className="mr-1" />
                  Zurück zur Zuweisung
                </Button>
                <Button
                  onClick={() => {
                    setCreatedCount(0);
                    setCreateError(null);
                    setCreating(false);
                    handleBatchCreate();
                  }}
                >
                  Erneut versuchen
                </Button>
              </div>
            </div>
          )}

          {!creating && !createError && createdCount > 0 && (
            <div className="space-y-5">
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <IconCheck size={32} className="text-green-600" stroke={2.5} />
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  Planung abgeschlossen!
                </h2>
                <p className="text-sm text-muted-foreground text-center max-w-sm">
                  Es wurden erfolgreich{' '}
                  <span className="font-semibold text-foreground">
                    {createdCount} Schicht{createdCount !== 1 ? 'en' : ''}
                  </span>{' '}
                  angelegt.
                </p>
              </div>

              {/* Summary card */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b bg-muted/30">
                  <h3 className="font-semibold text-sm">Zusammenfassung</h3>
                </div>
                <div className="px-5 py-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-2 flex-wrap">
                    <span className="text-muted-foreground">Abteilung</span>
                    <span className="font-medium truncate">{abteilungName}</span>
                  </div>
                  <div className="flex justify-between gap-2 flex-wrap">
                    <span className="text-muted-foreground">Woche</span>
                    <span className="font-medium">{weekLabel}</span>
                  </div>
                  <div className="flex justify-between gap-2 flex-wrap">
                    <span className="text-muted-foreground">Mitarbeiter</span>
                    <span className="font-medium">{abteilungMitarbeiter.length}</span>
                  </div>
                  <div className="flex justify-between gap-2 flex-wrap">
                    <span className="text-muted-foreground">Angelegte Schichten</span>
                    <span className="font-semibold text-green-700">{createdCount}</span>
                  </div>
                </div>
                <div className="px-5 py-4 border-t bg-muted/20">
                  <div className="space-y-1">
                    {abteilungMitarbeiter.map(m => {
                      const count = Object.values(assignments[m.record_id] ?? {}).filter(v => v !== '').length;
                      if (count === 0) return null;
                      return (
                        <div key={m.record_id} className="flex justify-between text-xs text-muted-foreground gap-2">
                          <span className="truncate min-w-0">
                            {[m.fields.vorname, m.fields.nachname].filter(Boolean).join(' ') || '(ohne Name)'}
                          </span>
                          <span className="shrink-0 font-medium text-foreground">
                            {count} Schicht{count !== 1 ? 'en' : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <Button onClick={handleReset} variant="outline">
                  Neue Planung starten
                </Button>
                <Button asChild>
                  <a href="#/">Zum Dashboard</a>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </IntentWizardShell>
  );
}
