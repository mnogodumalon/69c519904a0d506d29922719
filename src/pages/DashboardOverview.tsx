import { useState, useMemo, useCallback } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichMitarbeiter, enrichSchichtplanung } from '@/lib/enrich';
import type { EnrichedMitarbeiter, EnrichedSchichtplanung } from '@/types/enriched';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/StatCard';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import {
  IconAlertCircle,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconPencil,
  IconTrash,
  IconUsers,
  IconCalendar,
  IconClock,
  IconCheck,
  IconRocket,
  IconCalendarStats,
  IconClipboardCheck,
} from '@tabler/icons-react';
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addDays,
  format,
  isToday,
  isSameDay,
  parseISO,
} from 'date-fns';
import { de } from 'date-fns/locale';

// Distinct avatar colors for employee rows
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-orange-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-amber-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-pink-500',
];

function getAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

// Status color map
const STATUS_COLORS: Record<string, string> = {
  geplant: 'bg-blue-100 text-blue-800 border-blue-200',
  bestaetigt: 'bg-green-100 text-green-800 border-green-200',
  abwesend: 'bg-amber-100 text-amber-800 border-amber-200',
  storniert: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_DOT: Record<string, string> = {
  geplant: 'bg-blue-500',
  bestaetigt: 'bg-green-500',
  abwesend: 'bg-amber-500',
  storniert: 'bg-red-500',
};

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export default function DashboardOverview() {
  const {
    standorteAbteilungen,
    mitarbeiter,
    schichtvorlagen,
    schichtplanung,
    standorteAbteilungenMap,
    mitarbeiterMap,
    schichtvorlagenMap,
    loading,
    error,
    fetchAll,
  } = useDashboardData();

  const enrichedMitarbeiter = enrichMitarbeiter(mitarbeiter, { standorteAbteilungenMap });
  const enrichedSchichtplanung = enrichSchichtplanung(schichtplanung, {
    mitarbeiterMap,
    schichtvorlagenMap,
    standorteAbteilungenMap,
  });

  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [selectedAbteilung, setSelectedAbteilung] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<EnrichedSchichtplanung | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedSchichtplanung | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | undefined>(undefined);
  const [prefillMitarbeiter, setPrefillMitarbeiter] = useState<string | undefined>(undefined);

  const weekDays = useMemo(() => getWeekDays(currentWeekStart), [currentWeekStart]);
  const weekEnd = useMemo(() => endOfWeek(currentWeekStart, { weekStartsOn: 1 }), [currentWeekStart]);

  const filteredMitarbeiter = useMemo<EnrichedMitarbeiter[]>(() => {
    if (selectedAbteilung === 'all') return enrichedMitarbeiter;
    return enrichedMitarbeiter.filter(m => {
      const id = extractRecordId(m.fields.abteilung_ref);
      return id === selectedAbteilung;
    });
  }, [enrichedMitarbeiter, selectedAbteilung]);

  const planningByDateAndMitarbeiter = useMemo(() => {
    const map = new Map<string, EnrichedSchichtplanung[]>();
    for (const p of enrichedSchichtplanung) {
      if (!p.fields.schicht_datum) continue;
      const dateStr = p.fields.schicht_datum.slice(0, 10);
      const mitId = extractRecordId(p.fields.mitarbeiter_ref) ?? 'unknown';
      const key = `${dateStr}_${mitId}`;
      const existing = map.get(key) ?? [];
      existing.push(p);
      map.set(key, existing);
    }
    return map;
  }, [enrichedSchichtplanung]);

  const weekStats = useMemo(() => {
    const weekPlannings = enrichedSchichtplanung.filter(p => {
      if (!p.fields.schicht_datum) return false;
      const d = parseISO(p.fields.schicht_datum.slice(0, 10));
      return d >= currentWeekStart && d <= weekEnd;
    });
    const confirmed = weekPlannings.filter(p => p.fields.schicht_status?.key === 'bestaetigt').length;
    const absent = weekPlannings.filter(p => p.fields.schicht_status?.key === 'abwesend').length;
    return { total: weekPlannings.length, confirmed, absent };
  }, [enrichedSchichtplanung, currentWeekStart, weekEnd]);

  const goToPrevWeek = useCallback(() => setCurrentWeekStart(d => subWeeks(d, 1)), []);
  const goToNextWeek = useCallback(() => setCurrentWeekStart(d => addWeeks(d, 1)), []);
  const goToCurrentWeek = useCallback(
    () => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 })),
    []
  );

  const handleAddShift = useCallback((date: Date, mitarbeiterId?: string) => {
    setEditRecord(null);
    setPrefillDate(format(date, 'yyyy-MM-dd'));
    setPrefillMitarbeiter(mitarbeiterId);
    setDialogOpen(true);
  }, []);

  const handleEditShift = useCallback((record: EnrichedSchichtplanung) => {
    setEditRecord(record);
    setPrefillDate(undefined);
    setPrefillMitarbeiter(undefined);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await LivingAppsService.deleteSchichtplanungEntry(deleteTarget.record_id);
    setDeleteTarget(null);
    fetchAll();
  }, [deleteTarget, fetchAll]);

  const getDefaultValues = useCallback(() => {
    if (editRecord) return editRecord.fields;
    const vals: Record<string, unknown> = {};
    if (prefillDate) vals.schicht_datum = prefillDate;
    if (prefillMitarbeiter) {
      vals.mitarbeiter_ref = createRecordUrl(APP_IDS.MITARBEITER, prefillMitarbeiter);
    }
    const geplantOpt = LOOKUP_OPTIONS.schichtplanung?.schicht_status?.find(o => o.key === 'geplant');
    if (geplantOpt) vals.schicht_status = geplantOpt;
    return Object.keys(vals).length > 0 ? vals : undefined;
  }, [editRecord, prefillDate, prefillMitarbeiter]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  const isCurrentWeek = isSameDay(currentWeekStart, startOfWeek(new Date(), { weekStartsOn: 1 }));

  return (
    <div className="space-y-6">
      {/* Workflows */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <IconRocket size={18} className="text-primary shrink-0" />
          <h2 className="font-semibold text-sm text-foreground">Workflows</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a href="#/intents/wochenplan-erstellen" className="block group">
            <div className="bg-card border border-border border-l-4 border-l-primary rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconCalendarStats size={20} className="text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-foreground truncate">Wochenplan erstellen</div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">Abteilung wählen · Schichten zuweisen · Bestätigen</div>
              </div>
              <IconChevronRight size={16} className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
            </div>
          </a>
          <a href="#/intents/schichtbestatigung" className="block group">
            <div className="bg-card border border-border border-l-4 border-l-primary rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <IconClipboardCheck size={20} className="text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-foreground truncate">Schichtbestätigung</div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">Zeitraum wählen · Status aktualisieren · Abschlussbericht</div>
              </div>
              <IconChevronRight size={16} className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
            </div>
          </a>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Mitarbeiter"
          value={String(mitarbeiter.length)}
          description="Gesamt aktiv"
          icon={<IconUsers size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Schichten diese Woche"
          value={String(weekStats.total)}
          description="Geplante Einträge"
          icon={<IconCalendar size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Bestätigt"
          value={String(weekStats.confirmed)}
          description="Diese Woche"
          icon={<IconCheck size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Schichtvorlagen"
          value={String(schichtvorlagen.length)}
          description="Vorlagen verfügbar"
          icon={<IconClock size={18} className="text-muted-foreground" />}
        />
      </div>

      {/* Calendar Panel */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Calendar Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={goToPrevWeek}>
              <IconChevronLeft size={16} />
            </Button>
            <div className="min-w-0">
              <span className="font-semibold text-sm truncate">
                {format(currentWeekStart, 'dd. MMM', { locale: de })} – {format(weekEnd, 'dd. MMM yyyy', { locale: de })}
              </span>
              {!isCurrentWeek && (
                <button
                  onClick={goToCurrentWeek}
                  className="ml-2 text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  Heute
                </button>
              )}
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={goToNextWeek}>
              <IconChevronRight size={16} />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Abteilung filter */}
            <select
              value={selectedAbteilung}
              onChange={e => setSelectedAbteilung(e.target.value)}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">Alle Abteilungen</option>
              {standorteAbteilungen.map(s => (
                <option key={s.record_id} value={s.record_id}>
                  {s.fields.standort_name || s.fields.abteilung_name || 'Unbekannt'}
                </option>
              ))}
            </select>

            <Button
              size="sm"
              onClick={() => handleAddShift(new Date())}
              className="gap-1.5 shrink-0"
            >
              <IconPlus size={14} className="shrink-0" />
              <span className="hidden sm:inline">Schicht planen</span>
              <span className="sm:hidden">Neu</span>
            </Button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="overflow-x-auto">
          <div style={{ minWidth: filteredMitarbeiter.length > 0 ? '640px' : '400px' }}>
            {/* Day header row */}
            <div
              className="grid border-b border-border bg-muted/30"
              style={{ gridTemplateColumns: `160px repeat(7, 1fr)` }}
            >
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border">
                Mitarbeiter
              </div>
              {weekDays.map(day => (
                <div
                  key={day.toISOString()}
                  className={`px-2 py-2 text-center border-r border-border last:border-r-0 ${
                    isToday(day) ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className={`text-xs font-medium ${isToday(day) ? 'text-primary' : 'text-muted-foreground'}`}>
                    {format(day, 'EEE', { locale: de })}
                  </div>
                  <div
                    className={`text-sm font-semibold leading-tight ${
                      isToday(day)
                        ? 'w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto'
                        : 'text-foreground'
                    }`}
                  >
                    {format(day, 'd')}
                  </div>
                </div>
              ))}
            </div>

            {/* Employee rows */}
            {filteredMitarbeiter.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                <IconUsers size={36} className="mx-auto mb-3 text-muted-foreground/40" stroke={1.5} />
                Keine Mitarbeiter gefunden
              </div>
            ) : (
              filteredMitarbeiter.map((m, rowIdx) => (
                <div
                  key={m.record_id}
                  className={`grid border-b border-border last:border-b-0 ${rowIdx % 2 === 1 ? 'bg-muted/10' : ''}`}
                  style={{ gridTemplateColumns: `160px repeat(7, 1fr)` }}
                >
                  {/* Employee name cell */}
                  <div className="px-3 py-2 border-r border-border flex items-center gap-2 min-h-[56px]">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${getAvatarColor(rowIdx)}`}>
                      {(m.fields.vorname?.[0] ?? '?')}{(m.fields.nachname?.[0] ?? '')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold text-foreground truncate block">
                        {m.fields.vorname} {m.fields.nachname}
                      </span>
                      {m.fields.beschaeftigungsart && (
                        <span className="text-[10px] text-muted-foreground truncate block mt-0.5">
                          {m.fields.beschaeftigungsart.label}
                        </span>
                      )}
                      {m.abteilung_refName && (
                        <span className="text-[10px] text-muted-foreground truncate block">
                          {m.abteilung_refName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Day cells */}
                  {weekDays.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const key = `${dateStr}_${m.record_id}`;
                    const dayShifts = planningByDateAndMitarbeiter.get(key) ?? [];

                    return (
                      <div
                        key={day.toISOString()}
                        className={`border-r border-border last:border-r-0 p-1 min-h-[56px] group ${
                          isToday(day) ? 'bg-primary/5' : ''
                        }`}
                      >
                        <div className="flex flex-col gap-1 h-full">
                          {dayShifts.map(shift => {
                            const statusKey = shift.fields.schicht_status?.key ?? 'geplant';
                            return (
                              <div
                                key={shift.record_id}
                                className={`rounded-md border px-1.5 py-1 text-[10px] leading-tight cursor-pointer ${
                                  STATUS_COLORS[statusKey] ?? STATUS_COLORS.geplant
                                }`}
                              >
                                <div className="font-medium truncate">
                                  {shift.schicht_refName || '—'}
                                </div>
                                {shift.fields.schicht_status && (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        STATUS_DOT[statusKey] ?? STATUS_DOT.geplant
                                      }`}
                                    />
                                    <span className="truncate">{shift.fields.schicht_status.label}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1 mt-1">
                                  <button
                                    onClick={() => handleEditShift(shift)}
                                    className="p-0.5 rounded hover:bg-black/10 transition-colors"
                                    title="Bearbeiten"
                                  >
                                    <IconPencil size={10} className="shrink-0" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteTarget(shift)}
                                    className="p-0.5 rounded hover:bg-black/10 transition-colors"
                                    title="Löschen"
                                  >
                                    <IconTrash size={10} className="shrink-0" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {/* Add button */}
                          <button
                            onClick={() => handleAddShift(day, m.record_id)}
                            className="flex items-center justify-center w-full rounded-md border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                            style={{ minHeight: dayShifts.length === 0 ? '40px' : '20px' }}
                            title="Schicht hinzufügen"
                          >
                            <IconPlus size={12} className="shrink-0" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {LOOKUP_OPTIONS.schichtplanung?.schicht_status?.map(opt => (
          <div key={opt.key} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[opt.key] ?? 'bg-gray-400'}`} />
            <span className="text-xs text-muted-foreground">{opt.label}</span>
          </div>
        ))}
      </div>

      {/* Weekly Summary */}
      {weekStats.total > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">Wochenübersicht</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {enrichedMitarbeiter
                .map((m, mIdx) => {
                  const shifts = enrichedSchichtplanung.filter(p => {
                    if (!p.fields.schicht_datum) return false;
                    const d = parseISO(p.fields.schicht_datum.slice(0, 10));
                    const mitId = extractRecordId(p.fields.mitarbeiter_ref);
                    return d >= currentWeekStart && d <= weekEnd && mitId === m.record_id;
                  });
                  return { m, mIdx, shifts };
                })
                .filter(({ shifts }) => shifts.length > 0)
                .map(({ m, mIdx, shifts }) => (
                  <div
                    key={m.record_id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-border bg-muted/20"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${getAvatarColor(mIdx)}`}>
                      {(m.fields.vorname?.[0] ?? '?')}{(m.fields.nachname?.[0] ?? '')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">
                        {m.fields.vorname} {m.fields.nachname}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {shifts.map(s => {
                          const statusKey = s.fields.schicht_status?.key ?? 'geplant';
                          return (
                            <Badge
                              key={s.record_id}
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 h-auto ${STATUS_COLORS[statusKey] ?? ''}`}
                            >
                              {s.schicht_refName || formatDate(s.fields.schicht_datum)}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground shrink-0">
                      {shifts.length}x
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Schichtplanung Dialog */}
      <SchichtplanungDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditRecord(null); }}
        onSubmit={async (fields) => {
          if (editRecord) {
            await LivingAppsService.updateSchichtplanungEntry(editRecord.record_id, fields);
          } else {
            await LivingAppsService.createSchichtplanungEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={getDefaultValues()}
        mitarbeiterList={mitarbeiter}
        schichtvorlagenList={schichtvorlagen}
        standorteAbteilungenList={standorteAbteilungen}
        enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Schichtplanung']}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Schicht löschen"
        description={
          deleteTarget
            ? `Schicht "${deleteTarget.schicht_refName || '—'}" für ${deleteTarget.mitarbeiter_refName || '—'} am ${formatDate(deleteTarget.fields.schicht_datum)} wirklich löschen?`
            : 'Wirklich löschen?'
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

function DashboardError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <IconAlertCircle size={22} className="text-destructive" />
      </div>
      <div className="text-center">
        <h3 className="font-semibold text-foreground mb-1">Fehler beim Laden</h3>
        <p className="text-sm text-muted-foreground max-w-xs">{error.message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>Erneut versuchen</Button>
    </div>
  );
}
