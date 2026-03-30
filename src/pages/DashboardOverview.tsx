import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichSchichtplanung } from '@/lib/enrich';
import type { EnrichedSchichtplanung } from '@/types/enriched';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatCard } from '@/components/StatCard';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { AI_PHOTO_SCAN } from '@/config/ai-features';
import {
  IconAlertCircle,
  IconPlus,
  IconChevronLeft,
  IconChevronRight,
  IconPencil,
  IconTrash,
  IconUsers,
  IconCalendar,
  IconClock,
  IconCheck,
  IconRocket,
  IconCalendarEvent,
  IconChecklist,
} from '@tabler/icons-react';
import { addDays, startOfWeek, format, isToday, addWeeks } from 'date-fns';
import { de } from 'date-fns/locale';

export default function DashboardOverview() {
  const {
    mitarbeiter, standorteAbteilungen, schichtvorlagen, schichtplanung,
    mitarbeiterMap, schichtvorlagenMap, standorteAbteilungenMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const enrichedSchichtplanung = enrichSchichtplanung(schichtplanung, {
    mitarbeiterMap, schichtvorlagenMap, standorteAbteilungenMap,
  });

  // All hooks before any early returns
  const [weekOffset, setWeekOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<EnrichedSchichtplanung | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedSchichtplanung | null>(null);
  const [prefilledDate, setPrefilledDate] = useState<string | undefined>(undefined);
  const [filterAbteilung, setFilterAbteilung] = useState('all');

  const weekDays = useMemo(() => {
    const base = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset);
    return Array.from({ length: 7 }, (_, i) => addDays(base, i));
  }, [weekOffset]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, EnrichedSchichtplanung[]>();
    weekDays.forEach(d => map.set(format(d, 'yyyy-MM-dd'), []));
    enrichedSchichtplanung.forEach(sp => {
      const date = sp.fields.schicht_datum;
      if (!date) return;
      const dateKey = date.slice(0, 10);
      if (!map.has(dateKey)) return;
      if (filterAbteilung !== 'all') {
        const abtId = extractRecordId(sp.fields.planung_abteilung_ref);
        if (abtId !== filterAbteilung) return;
      }
      map.get(dateKey)!.push(sp);
    });
    return map;
  }, [enrichedSchichtplanung, weekDays, filterAbteilung]);

  const thisWeekTotal = useMemo(() => {
    let n = 0;
    shiftsByDay.forEach(arr => { n += arr.length; });
    return n;
  }, [shiftsByDay]);

  const confirmedThisWeek = useMemo(() => {
    let n = 0;
    shiftsByDay.forEach(arr => arr.forEach(s => {
      if (s.fields.schicht_status?.key === 'bestaetigt') n++;
    }));
    return n;
  }, [shiftsByDay]);

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const todayCount = shiftsByDay.get(todayKey)?.length ?? 0;

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  const weekLabel = `${format(weekDays[0], 'd. MMM', { locale: de })} – ${format(weekDays[6], 'd. MMM yyyy', { locale: de })}`;

  function openCreate(date?: string) {
    setEditRecord(null);
    setPrefilledDate(date);
    setDialogOpen(true);
  }

  function openEdit(s: EnrichedSchichtplanung) {
    setEditRecord(s);
    setPrefilledDate(undefined);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditRecord(null);
    setPrefilledDate(undefined);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await LivingAppsService.deleteSchichtplanungEntry(deleteTarget.record_id);
    setDeleteTarget(null);
    fetchAll();
  }

  return (
    <div className="space-y-6">
      {/* Workflows */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <IconRocket size={18} className="text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Workflows</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a href="#/intents/schicht-wochenplan" className="group bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 border-l-4 border-l-primary overflow-hidden">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <IconCalendarEvent size={20} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground">Wochenschichtplan erstellen</p>
              <p className="text-xs text-muted-foreground truncate">Schichten für eine ganze Abteilung in einem Schritt planen</p>
            </div>
            <IconChevronRight size={16} className="text-muted-foreground shrink-0" />
          </a>
          <a href="#/intents/schicht-bestaetigung" className="group bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 border-l-4 border-l-primary overflow-hidden">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <IconChecklist size={20} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground">Schichten bestätigen</p>
              <p className="text-xs text-muted-foreground truncate">Anwesenheit erfassen und Schichtstatus aktualisieren</p>
            </div>
            <IconChevronRight size={16} className="text-muted-foreground shrink-0" />
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Mitarbeiter"
          value={String(mitarbeiter.length)}
          description="Gesamt aktiv"
          icon={<IconUsers size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Diese Woche"
          value={String(thisWeekTotal)}
          description="Schichten geplant"
          icon={<IconCalendar size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Heute"
          value={String(todayCount)}
          description="Schichten"
          icon={<IconClock size={18} className="text-muted-foreground" />}
        />
        <StatCard
          title="Bestätigt"
          value={String(confirmedThisWeek)}
          description="Diese Woche"
          icon={<IconCheck size={18} className="text-muted-foreground" />}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekOffset(o => o - 1)}>
            <IconChevronLeft size={16} />
          </Button>
          <span className="text-sm font-semibold min-w-[160px] text-center">{weekLabel}</span>
          <Button variant="outline" size="icon" onClick={() => setWeekOffset(o => o + 1)}>
            <IconChevronRight size={16} />
          </Button>
          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
              Heute
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {standorteAbteilungen.length > 1 && (
            <Select value={filterAbteilung} onValueChange={setFilterAbteilung}>
              <SelectTrigger className="h-9 w-48 text-sm">
                <SelectValue placeholder="Alle Standorte" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Standorte</SelectItem>
                {standorteAbteilungen.map(a => (
                  <SelectItem key={a.record_id} value={a.record_id}>
                    {a.fields.standort_name || a.fields.abteilung_name || 'Standort'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={() => openCreate()}>
            <IconPlus size={16} className="shrink-0 mr-1.5" />
            <span>Schicht hinzufügen</span>
          </Button>
        </div>
      </div>

      {/* Week Calendar Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        {weekDays.map(day => {
          const key = format(day, 'yyyy-MM-dd');
          const dayShifts = shiftsByDay.get(key) ?? [];
          const isCurrentDay = isToday(day);
          return (
            <div
              key={key}
              className={`rounded-2xl border p-3 min-h-[140px] flex flex-col gap-2 ${
                isCurrentDay
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card'
              }`}
            >
              {/* Day Header */}
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-[11px] font-medium uppercase tracking-wider ${
                    isCurrentDay ? 'text-primary' : 'text-muted-foreground'
                  }`}>
                    {format(day, 'EEE', { locale: de })}
                  </p>
                  <p className={`text-2xl font-bold leading-none mt-0.5 ${
                    isCurrentDay ? 'text-primary' : 'text-foreground'
                  }`}>
                    {format(day, 'd')}
                  </p>
                </div>
                <button
                  onClick={() => openCreate(key)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  title="Schicht für diesen Tag hinzufügen"
                >
                  <IconPlus size={14} />
                </button>
              </div>

              {/* Shift Cards */}
              <div className="flex flex-col gap-1.5 flex-1">
                {dayShifts.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-[11px] text-muted-foreground/40">—</p>
                  </div>
                ) : (
                  dayShifts.map(s => (
                    <div
                      key={s.record_id}
                      className="rounded-xl p-2 bg-background border border-border space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate leading-tight">
                            {s.mitarbeiter_refName || '—'}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {s.schicht_refName || '—'}
                          </p>
                        </div>
                        <div className="flex shrink-0">
                          <button
                            onClick={() => openEdit(s)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          >
                            <IconPencil size={12} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(s)}
                            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <IconTrash size={12} />
                          </button>
                        </div>
                      </div>
                      {s.fields.schicht_status && (
                        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${getStatusColor(s.fields.schicht_status.key)}`}>
                          {s.fields.schicht_status.label}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dialogs */}
      <SchichtplanungDialog
        open={dialogOpen}
        onClose={closeDialog}
        onSubmit={async (fields) => {
          if (editRecord) {
            await LivingAppsService.updateSchichtplanungEntry(editRecord.record_id, fields);
          } else {
            await LivingAppsService.createSchichtplanungEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={editRecord ? editRecord.fields : (prefilledDate ? { schicht_datum: prefilledDate } : undefined)}
        mitarbeiterList={mitarbeiter}
        schichtvorlagenList={schichtvorlagen}
        standorte_abteilungenList={standorteAbteilungen}
        enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung']}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Schicht löschen"
        description={`Schicht von "${deleteTarget?.mitarbeiter_refName || 'Mitarbeiter'}" wirklich löschen?`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function getStatusColor(key: string): string {
  switch (key) {
    case 'bestaetigt': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'geplant': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'abwesend': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'storniert': return 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
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
