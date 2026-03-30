import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichSchichtplanung } from '@/lib/enrich';
import type { EnrichedSchichtplanung } from '@/types/enriched';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, createRecordUrl, extractRecordId } from '@/services/livingAppsService';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatCard } from '@/components/StatCard';
import {
  IconAlertCircle, IconChevronLeft, IconChevronRight,
  IconPlus, IconPencil, IconTrash, IconCalendarWeek,
  IconUsers, IconClockHour4, IconCircleCheck,
  IconRocket, IconCalendarStats, IconChecklist
} from '@tabler/icons-react';
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  isToday, parseISO
} from 'date-fns';
import { de } from 'date-fns/locale';

export default function DashboardOverview() {
  const {
    mitarbeiter, standorteAbteilungen, schichtvorlagen, schichtplanung,
    mitarbeiterMap, schichtvorlagenMap, standorteAbteilungenMap,
    loading, error, fetchAll,
  } = useDashboardData();

  // --- All hooks before early returns ---
  const enrichedSchichtplanung = useMemo(
    () => enrichSchichtplanung(schichtplanung, { mitarbeiterMap, schichtvorlagenMap, standorteAbteilungenMap }),
    [schichtplanung, mitarbeiterMap, schichtvorlagenMap, standorteAbteilungenMap]
  );

  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<EnrichedSchichtplanung | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedSchichtplanung | null>(null);
  const [prefillEmployeeId, setPrefillEmployeeId] = useState<string | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | null>(null);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i)),
    [currentWeekStart]
  );

  const weekDateStrs = useMemo(
    () => weekDays.map(d => format(d, 'yyyy-MM-dd')),
    [weekDays]
  );

  // mitarbeiterId → dateStr → plans[]
  const planMap = useMemo(() => {
    const map = new Map<string, Map<string, EnrichedSchichtplanung[]>>();
    for (const plan of enrichedSchichtplanung) {
      const mid = extractRecordId(plan.fields.mitarbeiter_ref);
      if (!mid) continue;
      const date = plan.fields.schicht_datum;
      if (!date) continue;
      if (!map.has(mid)) map.set(mid, new Map());
      const dayMap = map.get(mid)!;
      if (!dayMap.has(date)) dayMap.set(date, []);
      dayMap.get(date)!.push(plan);
    }
    return map;
  }, [enrichedSchichtplanung]);

  // Stats
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const shiftsToday = enrichedSchichtplanung.filter(p => p.fields.schicht_datum === todayStr);
  const shiftsThisWeek = enrichedSchichtplanung.filter(p => weekDateStrs.includes(p.fields.schicht_datum ?? ''));
  const confirmedThisWeek = shiftsThisWeek.filter(p => p.fields.schicht_status?.key === 'bestaetigt');

  // --- Handlers ---
  const openCreateForCell = (employeeId: string, dateStr: string) => {
    setEditEntry(null);
    setPrefillEmployeeId(employeeId);
    setPrefillDate(dateStr);
    setDialogOpen(true);
  };

  const openCreateBlank = () => {
    setEditEntry(null);
    setPrefillEmployeeId(null);
    setPrefillDate(null);
    setDialogOpen(true);
  };

  const openEdit = (plan: EnrichedSchichtplanung) => {
    setEditEntry(plan);
    setPrefillEmployeeId(null);
    setPrefillDate(null);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await LivingAppsService.deleteSchichtplanungEntry(deleteTarget.record_id);
    setDeleteTarget(null);
    fetchAll();
  };

  // defaultValues for dialog
  const dialogDefaultValues = (() => {
    if (editEntry) return editEntry.fields;
    const vals: Record<string, unknown> = {};
    if (prefillDate) vals['schicht_datum'] = prefillDate;
    if (prefillEmployeeId) vals['mitarbeiter_ref'] = createRecordUrl(APP_IDS.MITARBEITER, prefillEmployeeId);
    return Object.keys(vals).length > 0 ? vals : undefined;
  })();

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  return (
    <div className="space-y-6">
      {/* Workflows */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <IconRocket size={20} className="text-primary" stroke={1.5} />
          <h2 className="text-base font-semibold">Workflows</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a href="#/intents/tagesschichtplan" className="block overflow-hidden bg-card border border-border border-l-4 border-l-primary rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                <IconCalendarStats size={20} className="text-primary shrink-0" stroke={1.5} />
                <div className="min-w-0">
                  <div className="font-medium truncate">Tagesschichtplan erstellen</div>
                  <div className="text-sm text-muted-foreground line-clamp-2">Mitarbeiter einer Abteilung für einen Tag einplanen und Schichtplanung-Einträge anlegen.</div>
                </div>
              </div>
              <IconChevronRight size={18} className="text-muted-foreground shrink-0 ml-2" stroke={1.5} />
            </div>
          </a>
          <a href="#/intents/schichten-bestaetigen" className="block overflow-hidden bg-card border border-border border-l-4 border-l-primary rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                <IconChecklist size={20} className="text-primary shrink-0" stroke={1.5} />
                <div className="min-w-0">
                  <div className="font-medium truncate">Schichten bestätigen</div>
                  <div className="text-sm text-muted-foreground line-clamp-2">Geplante Schichten für einen Tag und eine Abteilung bestätigen oder absagen.</div>
                </div>
              </div>
              <IconChevronRight size={18} className="text-muted-foreground shrink-0 ml-2" stroke={1.5} />
            </div>
          </a>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Mitarbeiter"
          value={String(mitarbeiter.length)}
          description="Gesamt"
          icon={<IconUsers size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Heute"
          value={String(shiftsToday.length)}
          description="Schichten"
          icon={<IconClockHour4 size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Diese Woche"
          value={String(shiftsThisWeek.length)}
          description="Schichten geplant"
          icon={<IconCalendarWeek size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Bestätigt"
          value={String(confirmedThisWeek.length)}
          description="Diese Woche"
          icon={<IconCircleCheck size={18} className="text-muted-foreground" />}
        />
      </div>

      {/* Weekly Planner */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Planner Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentWeekStart(w => subWeeks(w, 1))}
            >
              <IconChevronLeft size={16} />
            </Button>
            <span className="font-semibold text-sm sm:text-base px-1 min-w-0">
              {format(currentWeekStart, "'KW' w · d. MMM", { locale: de })}
              {' – '}
              {format(addDays(currentWeekStart, 6), 'd. MMM yyyy', { locale: de })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentWeekStart(w => addWeeks(w, 1))}
            >
              <IconChevronRight size={16} />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            >
              Heute
            </Button>
            <Button size="sm" onClick={openCreateBlank}>
              <IconPlus size={16} className="shrink-0" />
              <span className="hidden sm:inline ml-1">Schicht hinzufügen</span>
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-40 min-w-[9rem]">
                  Mitarbeiter
                </th>
                {weekDays.map(day => (
                  <th
                    key={day.toISOString()}
                    className={`text-center px-1 py-2 font-medium w-[calc((100%-10rem)/7)] ${
                      isToday(day) ? 'bg-primary/10' : ''
                    }`}
                  >
                    <div className={`text-xs uppercase tracking-wide ${isToday(day) ? 'text-primary' : 'text-muted-foreground'}`}>
                      {format(day, 'EEE', { locale: de })}
                    </div>
                    <div className="mt-0.5 flex items-center justify-center">
                      <span className={`text-sm font-semibold leading-none inline-flex items-center justify-center w-7 h-7 rounded-full ${
                        isToday(day)
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground'
                      }`}>
                        {format(day, 'd')}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mitarbeiter.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-muted-foreground">
                    <IconUsers size={40} className="mx-auto mb-3 opacity-30" stroke={1.5} />
                    <p className="text-sm">Keine Mitarbeiter vorhanden</p>
                    <p className="text-xs mt-1 opacity-60">Lege zuerst Mitarbeiter an</p>
                  </td>
                </tr>
              ) : (
                mitarbeiter.map((emp, idx) => {
                  const empDayMap = planMap.get(emp.record_id);
                  return (
                    <tr
                      key={emp.record_id}
                      className={`border-b border-border last:border-0 ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/10'}`}
                    >
                      {/* Employee Name */}
                      <td className="px-4 py-2 min-w-[9rem]">
                        <div className="font-medium text-sm truncate">
                          {[emp.fields.vorname, emp.fields.nachname].filter(Boolean).join(' ') || '–'}
                        </div>
                        {emp.fields.position && (
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {emp.fields.position}
                          </div>
                        )}
                      </td>
                      {/* Day Cells */}
                      {weekDays.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const dayPlans = empDayMap?.get(dateStr) ?? [];
                        return (
                          <td
                            key={dateStr}
                            className={`px-1 py-1.5 align-top ${isToday(day) ? 'bg-primary/5' : ''}`}
                          >
                            <div className="flex flex-col gap-0.5 items-stretch min-h-[2.5rem]">
                              {dayPlans.map(plan => (
                                <ShiftChip
                                  key={plan.record_id}
                                  plan={plan}
                                  onEdit={() => openEdit(plan)}
                                  onDelete={() => setDeleteTarget(plan)}
                                />
                              ))}
                              <button
                                className="self-center mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground/30 hover:bg-primary/15 hover:text-primary transition-colors"
                                onClick={() => openCreateForCell(emp.record_id, dateStr)}
                                title="Schicht hinzufügen"
                              >
                                <IconPlus size={13} />
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialogs */}
      <SchichtplanungDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSubmit={async (fields: any) => {
          if (editEntry) {
            await LivingAppsService.updateSchichtplanungEntry(editEntry.record_id, fields);
          } else {
            await LivingAppsService.createSchichtplanungEntry(fields);
          }
          fetchAll();
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defaultValues={dialogDefaultValues as any}
        mitarbeiterList={mitarbeiter}
        schichtvorlagenList={schichtvorlagen}
        standorte_abteilungenList={standorteAbteilungen}
        enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung'] ?? false}
        enablePhotoLocation={AI_PHOTO_LOCATION['Schichtplanung'] ?? false}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Schicht löschen"
        description={
          deleteTarget
            ? `Schicht von ${deleteTarget.mitarbeiter_refName || 'Mitarbeiter'} am ${
                deleteTarget.fields.schicht_datum
                  ? format(parseISO(deleteTarget.fields.schicht_datum), 'd. MMMM yyyy', { locale: de })
                  : '?'
              } wirklich löschen?`
            : 'Schicht wirklich löschen?'
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// --- Shift Chip ---
const STATUS_COLORS: Record<string, string> = {
  geplant:    'bg-blue-50 text-blue-700 border-blue-200',
  bestaetigt: 'bg-green-50 text-green-700 border-green-200',
  abwesend:   'bg-amber-50 text-amber-700 border-amber-200',
  storniert:  'bg-muted text-muted-foreground border-border line-through opacity-50',
};

function ShiftChip({
  plan,
  onEdit,
  onDelete,
}: {
  plan: EnrichedSchichtplanung;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statusKey = plan.fields.schicht_status?.key ?? '';
  const colorClass = STATUS_COLORS[statusKey] ?? 'bg-muted text-muted-foreground border-border';
  const name = plan.schicht_refName || '—';

  return (
    <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-xs font-medium w-full overflow-hidden ${colorClass}`}>
      <span className="truncate flex-1 min-w-0" title={name}>{name}</span>
      <div className="flex items-center gap-0.5 shrink-0 ml-0.5">
        <button
          className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          onClick={e => { e.stopPropagation(); onEdit(); }}
          title="Bearbeiten"
        >
          <IconPencil size={10} />
        </button>
        <button
          className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Löschen"
        >
          <IconTrash size={10} />
        </button>
      </div>
    </div>
  );
}

// --- Skeleton & Error ---
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
