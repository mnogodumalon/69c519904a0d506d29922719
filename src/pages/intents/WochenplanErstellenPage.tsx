import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  startOfWeek,
  endOfWeek,
  addDays,
  format,
  parseISO,
  addWeeks,
  subWeeks,
  isSameDay,
} from 'date-fns';
import { de } from 'date-fns/locale';

import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { MitarbeiterDialog } from '@/components/dialogs/MitarbeiterDialog';
import { SchichtvorlagenDialog } from '@/components/dialogs/SchichtvorlagenDialog';
import { Button } from '@/components/ui/button';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { StandorteAbteilungen, Mitarbeiter, Schichtvorlagen, Schichtplanung, LookupValue, CreateSchichtplanung, CreateMitarbeiter, CreateSchichtvorlagen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconX,
  IconCheck,
  IconUsers,
  IconBuilding,
  IconArrowRight,
  IconRocket,
  IconAlertTriangle,
  IconClock,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Abteilung & Woche' },
  { label: 'Schichten zuweisen' },
  { label: 'Zusammenfassung' },
];

function getWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function getInitials(vorname?: string, nachname?: string): string {
  const f = (vorname ?? '').trim();
  const l = (nachname ?? '').trim();
  if (f && l) return `${f[0]}${l[0]}`.toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (l) return l.slice(0, 2).toUpperCase();
  return '?';
}

// Status color classes for shift chips
const SHIFT_STATUS_COLORS: Record<string, string> = {
  geplant: 'bg-blue-100 text-blue-700 border-blue-200',
  bestaetigt: 'bg-green-100 text-green-700 border-green-200',
  abwesend: 'bg-amber-100 text-amber-700 border-amber-200',
  storniert: 'bg-red-100 text-red-700 border-red-200',
};

export default function WochenplanErstellenPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ---- Step state ----
  const initialStep = (() => {
    const s = parseInt(searchParams.get('step') ?? '', 10);
    if (s >= 1 && s <= 3) return s;
    return 1;
  })();
  const [currentStep, setCurrentStep] = useState(initialStep);

  // ---- Step 1: selected dept + week ----
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const today = new Date();
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(today));

  // ---- Step 2: dialogs ----
  const [schichtplanungDialogOpen, setSchichtplanungDialogOpen] = useState(false);
  const [schichtplanungDefaultValues, setSchichtplanungDefaultValues] = useState<Schichtplanung['fields'] | undefined>(undefined);
  const [mitarbeiterDialogOpen, setMitarbeiterDialogOpen] = useState(false);
  const [schichtvorlagenDialogOpen, setSchichtvorlagenDialogOpen] = useState(false);

  // ---- Delete confirm ----
  const [deleteTarget, setDeleteTarget] = useState<Schichtplanung | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ---- Confirm all state ----
  const [confirming, setConfirming] = useState(false);

  // ---- Data ----
  const {
    standorteAbteilungen,
    mitarbeiter,
    schichtvorlagen,
    schichtplanung,
    loading,
    error,
    fetchAll,
  } = useDashboardData();

  // Derived data
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = getWeekDays(weekStart);

  const selectedDept: StandorteAbteilungen | undefined = useMemo(
    () => standorteAbteilungen.find(d => d.record_id === selectedDeptId),
    [standorteAbteilungen, selectedDeptId]
  );

  // Employees in selected department
  const deptEmployees: Mitarbeiter[] = useMemo(() => {
    if (!selectedDeptId) return [];
    return mitarbeiter.filter(m => {
      const refId = extractRecordId(m.fields.abteilung_ref);
      return refId === selectedDeptId;
    });
  }, [mitarbeiter, selectedDeptId]);

  // Shift plans for selected dept + week
  const weekSchichtplanung: Schichtplanung[] = useMemo(() => {
    if (!selectedDeptId) return [];
    return schichtplanung.filter(sp => {
      const deptId = extractRecordId(sp.fields.planung_abteilung_ref);
      if (deptId !== selectedDeptId) return false;
      const datum = sp.fields.schicht_datum;
      if (!datum) return false;
      try {
        const d = parseISO(datum.slice(0, 10));
        return d >= weekStart && d <= weekEnd;
      } catch {
        return false;
      }
    });
  }, [schichtplanung, selectedDeptId, weekStart, weekEnd]);

  // Lookup map: mitarbeiter_id + date -> Schichtplanung[]
  const assignmentMap = useMemo(() => {
    const map = new Map<string, Schichtplanung[]>();
    for (const sp of weekSchichtplanung) {
      const mid = extractRecordId(sp.fields.mitarbeiter_ref);
      if (!mid || !sp.fields.schicht_datum) continue;
      const dateStr = sp.fields.schicht_datum.slice(0, 10);
      const key = `${mid}::${dateStr}`;
      const existing = map.get(key) ?? [];
      existing.push(sp);
      map.set(key, existing);
    }
    return map;
  }, [weekSchichtplanung]);

  // Lookup: schicht by id
  const schichtMap = useMemo(() => {
    const m = new Map<string, Schichtvorlagen>();
    schichtvorlagen.forEach(s => m.set(s.record_id, s));
    return m;
  }, [schichtvorlagen]);

  const handleSelectDept = useCallback((id: string) => {
    setSelectedDeptId(id);
  }, []);

  const handlePrevWeek = useCallback(() => setWeekStart(w => subWeeks(w, 1)), []);
  const handleNextWeek = useCallback(() => setWeekStart(w => addWeeks(w, 1)), []);

  const handleGoToStep2 = useCallback(() => {
    if (!selectedDeptId) return;
    setCurrentStep(2);
  }, [selectedDeptId]);

  const handleGoToStep3 = useCallback(() => {
    setCurrentStep(3);
  }, []);

  const openAddShiftDialog = useCallback(
    (employeeId: string, day: Date) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const prefilled: Schichtplanung['fields'] = {
        mitarbeiter_ref: createRecordUrl(APP_IDS.MITARBEITER, employeeId),
        schicht_datum: dateStr,
        planung_abteilung_ref: selectedDeptId
          ? createRecordUrl(APP_IDS.STANDORTE_ABTEILUNGEN, selectedDeptId)
          : undefined,
        schicht_status: 'geplant' as unknown as LookupValue,
      };
      setSchichtplanungDefaultValues(prefilled);
      setSchichtplanungDialogOpen(true);
    },
    [selectedDeptId]
  );

  const handleCreateSchichtplanung = useCallback(
    async (fields: Schichtplanung['fields']) => {
      await LivingAppsService.createSchichtplanungEntry(fields as CreateSchichtplanung);
      await fetchAll();
    },
    [fetchAll]
  );

  const handleDeleteShift = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await LivingAppsService.deleteSchichtplanungEntry(deleteTarget.record_id);
      await fetchAll();
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, fetchAll]);

  const handleConfirmAll = useCallback(async () => {
    setConfirming(true);
    try {
      const geplant = weekSchichtplanung.filter(sp => {
        const status = sp.fields.schicht_status;
        if (!status) return false;
        const key = typeof status === 'object' && 'key' in status ? status.key : String(status);
        return key === 'geplant';
      });
      await Promise.all(
        geplant.map(sp =>
          LivingAppsService.updateSchichtplanungEntry(sp.record_id, {
            schicht_status: 'bestaetigt',
          })
        )
      );
      await fetchAll();
    } finally {
      setConfirming(false);
    }
  }, [weekSchichtplanung, fetchAll]);

  const handleCreateMitarbeiter = useCallback(
    async (fields: Mitarbeiter['fields']) => {
      await LivingAppsService.createMitarbeiterEntry(fields as CreateMitarbeiter);
      await fetchAll();
    },
    [fetchAll]
  );

  const handleCreateSchichtvorlage = useCallback(
    async (fields: Schichtvorlagen['fields']) => {
      await LivingAppsService.createSchichtvorlagenEntry(fields as CreateSchichtvorlagen);
      await fetchAll();
    },
    [fetchAll]
  );

  // Step 3 summary: per employee
  const employeeSummary = useMemo(() => {
    return deptEmployees.map(emp => {
      const empId = emp.record_id;
      const shifts = weekSchichtplanung.filter(sp => extractRecordId(sp.fields.mitarbeiter_ref) === empId);
      const targetShifts = emp.fields.wochenstunden ? Math.round(emp.fields.wochenstunden / 8) : null;
      return { emp, shifts, targetShifts };
    });
  }, [deptEmployees, weekSchichtplanung]);

  const totalShifts = weekSchichtplanung.length;
  const geplantCount = weekSchichtplanung.filter(sp => {
    const s = sp.fields.schicht_status;
    const key = s && typeof s === 'object' && 'key' in s ? s.key : String(s ?? '');
    return key === 'geplant';
  }).length;

  const getShiftStatusKey = (sp: Schichtplanung): string => {
    const s = sp.fields.schicht_status;
    if (!s) return 'geplant';
    return typeof s === 'object' && 'key' in s ? s.key : String(s);
  };

  const getShiftStatusLabel = (sp: Schichtplanung): string => {
    const s = sp.fields.schicht_status;
    if (!s) return 'Geplant';
    return typeof s === 'object' && 'label' in s ? s.label : String(s);
  };

  return (
    <>
      <IntentWizardShell
        title="Wochenplan erstellen"
        subtitle="Planen Sie Schichten fur eine Abteilung und eine Kalenderwoche"
        steps={WIZARD_STEPS}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        loading={loading}
        error={error}
        onRetry={fetchAll}
      >
        {/* ============================================================
            STEP 1: Abteilung & Woche wahlen
        ============================================================ */}
        {currentStep === 1 && (
          <div className="space-y-6">
            {/* Week picker */}
            <div className="rounded-2xl border border-border bg-card p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <IconCalendar size={18} className="text-primary shrink-0" />
                <h2 className="font-semibold text-sm">Kalenderwoche wahlen</h2>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={handlePrevWeek}>
                  <IconChevronLeft size={16} />
                </Button>
                <div className="flex-1 text-center min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {format(weekStart, 'd. MMM', { locale: de })} – {format(weekEnd, 'd. MMM yyyy', { locale: de })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    KW {format(weekStart, 'w', { locale: de })}
                  </p>
                </div>
                <Button variant="outline" size="icon" onClick={handleNextWeek}>
                  <IconChevronRight size={16} />
                </Button>
              </div>
              {/* Mini week day strip */}
              <div className="grid grid-cols-7 gap-1 mt-3">
                {weekDays.map(day => (
                  <div
                    key={day.toISOString()}
                    className={`rounded-lg p-1.5 text-center text-xs ${
                      isSameDay(day, today)
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">{format(day, 'EEE', { locale: de })}</div>
                    <div>{format(day, 'd')}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Department selection */}
            <div className="rounded-2xl border border-border bg-card p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <IconBuilding size={18} className="text-primary shrink-0" />
                <h2 className="font-semibold text-sm">Abteilung wahlen</h2>
              </div>
              <EntitySelectStep
                items={standorteAbteilungen.map(d => ({
                  id: d.record_id,
                  title: d.fields.abteilung_name ?? d.fields.standort_name ?? d.record_id,
                  subtitle: [d.fields.standort_name, d.fields.standort_ort].filter(Boolean).join(', '),
                  icon: <IconBuilding size={18} className="text-primary" />,
                  stats: [
                    {
                      label: 'Mitarbeiter',
                      value: mitarbeiter.filter(m => extractRecordId(m.fields.abteilung_ref) === d.record_id).length,
                    },
                  ],
                }))}
                onSelect={handleSelectDept}
                searchPlaceholder="Abteilung suchen..."
                emptyIcon={<IconBuilding size={32} />}
                emptyText="Keine Abteilungen gefunden."
              />
            </div>

            {/* Live counter & selected info */}
            {selectedDeptId && (
              <div className="rounded-2xl border border-border bg-card p-4 overflow-hidden">
                <div className="flex items-center gap-2 mb-2">
                  <IconCalendar size={16} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">
                    {selectedDept?.fields.abteilung_name ?? selectedDept?.fields.standort_name}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground font-semibold">{weekSchichtplanung.length} Schichten</span>{' '}
                  bereits geplant fur diese Woche
                </p>
              </div>
            )}

            {/* Next button */}
            <div className="flex justify-end">
              <Button
                onClick={handleGoToStep2}
                disabled={!selectedDeptId}
                className="gap-2"
              >
                Weiter
                <IconArrowRight size={16} />
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 2: Schichten zuweisen
        ============================================================ */}
        {currentStep === 2 && selectedDeptId && (
          <div className="space-y-4">
            {/* Header bar */}
            <div className="rounded-2xl border border-border bg-card p-4 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-sm truncate">
                    {selectedDept?.fields.abteilung_name ?? selectedDept?.fields.standort_name}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    KW {format(weekStart, 'w', { locale: de })} &middot;{' '}
                    {format(weekStart, 'd. MMM', { locale: de })} – {format(weekEnd, 'd. MMM yyyy', { locale: de })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                    {totalShifts} Schichten geplant
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setMitarbeiterDialogOpen(true)}
              >
                <IconUsers size={15} />
                Mitarbeiter hinzufugen
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setSchichtvorlagenDialogOpen(true)}
              >
                <IconClock size={15} />
                Schichtvorlage hinzufugen
              </Button>
            </div>

            {/* Empty state if no employees */}
            {deptEmployees.length === 0 && (
              <div className="rounded-2xl border border-border bg-card p-8 text-center overflow-hidden">
                <IconUsers size={32} className="mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Keine Mitarbeiter in dieser Abteilung.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => setMitarbeiterDialogOpen(true)}
                >
                  <IconPlus size={14} />
                  Mitarbeiter anlegen
                </Button>
              </div>
            )}

            {/* Shift grid */}
            {deptEmployees.length > 0 && (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground w-40">
                          Mitarbeiter
                        </th>
                        {weekDays.map(day => (
                          <th
                            key={day.toISOString()}
                            className={`text-center p-2 text-xs font-semibold min-w-[90px] ${
                              isSameDay(day, today)
                                ? 'text-primary bg-primary/5'
                                : 'text-muted-foreground'
                            }`}
                          >
                            <div>{format(day, 'EEE', { locale: de })}</div>
                            <div className="font-normal">{format(day, 'd. MMM', { locale: de })}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {deptEmployees.map((emp, empIdx) => (
                        <tr
                          key={emp.record_id}
                          className={empIdx % 2 === 0 ? 'bg-card' : 'bg-muted/30'}
                        >
                          {/* Employee cell */}
                          <td className="p-3 align-top">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                                {getInitials(emp.fields.vorname, emp.fields.nachname)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium truncate">
                                  {[emp.fields.vorname, emp.fields.nachname].filter(Boolean).join(' ') || emp.record_id}
                                </div>
                                {emp.fields.beschaeftigungsart && (
                                  <div className="text-xs text-muted-foreground truncate">
                                    {typeof emp.fields.beschaeftigungsart === 'object'
                                      ? emp.fields.beschaeftigungsart.label
                                      : emp.fields.beschaeftigungsart}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          {/* Day cells */}
                          {weekDays.map(day => {
                            const dateStr = format(day, 'yyyy-MM-dd');
                            const key = `${emp.record_id}::${dateStr}`;
                            const dayShifts = assignmentMap.get(key) ?? [];
                            return (
                              <td
                                key={day.toISOString()}
                                className={`p-1.5 align-top ${
                                  isSameDay(day, today) ? 'bg-primary/5' : ''
                                }`}
                              >
                                <div className="flex flex-col gap-1">
                                  {dayShifts.map(sp => {
                                    const schichtId = extractRecordId(sp.fields.schicht_ref);
                                    const schicht = schichtId ? schichtMap.get(schichtId) : undefined;
                                    const statusKey = getShiftStatusKey(sp);
                                    const colorClass =
                                      SHIFT_STATUS_COLORS[statusKey] ?? 'bg-gray-100 text-gray-700 border-gray-200';
                                    return (
                                      <div
                                        key={sp.record_id}
                                        className={`flex items-center gap-1 rounded-md px-1.5 py-1 border text-xs font-medium ${colorClass} overflow-hidden`}
                                      >
                                        <span className="truncate flex-1 min-w-0">
                                          {schicht?.fields.schicht_kuerzel ?? schicht?.fields.schicht_name ?? 'Schicht'}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setDeleteTarget(sp)}
                                          className="shrink-0 w-4 h-4 rounded flex items-center justify-center hover:bg-black/10 transition-colors"
                                          aria-label="Schicht entfernen"
                                        >
                                          <IconX size={10} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    onClick={() => openAddShiftDialog(emp.record_id, day)}
                                    className="flex items-center justify-center w-full rounded-md border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors p-1"
                                    aria-label="Schicht hinzufugen"
                                  >
                                    <IconPlus size={14} />
                                  </button>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={() => setCurrentStep(1)} className="gap-2">
                <IconChevronLeft size={16} />
                Zuruck
              </Button>
              <Button onClick={handleGoToStep3} className="gap-2">
                Weiter
                <IconArrowRight size={16} />
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 3: Zusammenfassung
        ============================================================ */}
        {currentStep === 3 && (
          <div className="space-y-4">
            {/* Summary header */}
            <div className="rounded-2xl border border-border bg-card p-4 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Zusammenfassung</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedDept?.fields.abteilung_name ?? selectedDept?.fields.standort_name} &middot;{' '}
                    KW {format(weekStart, 'w', { locale: de })} &middot;{' '}
                    {format(weekStart, 'd. MMM', { locale: de })} – {format(weekEnd, 'd. MMM yyyy', { locale: de })}
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <div className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                    {totalShifts} Schichten gesamt
                  </div>
                  {geplantCount > 0 && (
                    <div className="rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700">
                      {geplantCount} ungepruft
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Per-employee cards */}
            {employeeSummary.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-8 text-center overflow-hidden">
                <IconUsers size={32} className="mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Keine Mitarbeiter in dieser Abteilung.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {employeeSummary.map(({ emp, shifts, targetShifts }) => {
                  const hasNoTemplate = shifts.some(sp => !extractRecordId(sp.fields.schicht_ref));
                  return (
                    <div
                      key={emp.record_id}
                      className="rounded-2xl border border-border bg-card p-4 overflow-hidden"
                    >
                      {/* Employee header */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                          {getInitials(emp.fields.vorname, emp.fields.nachname)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {[emp.fields.vorname, emp.fields.nachname].filter(Boolean).join(' ') || emp.record_id}
                          </div>
                          {emp.fields.beschaeftigungsart && (
                            <div className="text-xs text-muted-foreground truncate">
                              {typeof emp.fields.beschaeftigungsart === 'object'
                                ? emp.fields.beschaeftigungsart.label
                                : emp.fields.beschaeftigungsart}
                            </div>
                          )}
                        </div>
                        {hasNoTemplate && (
                          <IconAlertTriangle size={16} className="text-amber-500 shrink-0 ml-auto" />
                        )}
                      </div>

                      {/* Shift count vs target */}
                      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                        <IconClock size={13} className="shrink-0" />
                        <span>
                          <span className="font-semibold text-foreground">{shifts.length}</span>
                          {targetShifts !== null && (
                            <span> / {targetShifts} Schichten (Ziel: {emp.fields.wochenstunden}h)</span>
                          )}
                          {targetShifts === null && <span> Schichten diese Woche</span>}
                        </span>
                      </div>

                      {/* Shift badges */}
                      {shifts.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">Keine Schichten geplant</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {shifts.map(sp => {
                            const schichtId = extractRecordId(sp.fields.schicht_ref);
                            const schicht = schichtId ? schichtMap.get(schichtId) : undefined;
                            const statusKey = getShiftStatusKey(sp);
                            const statusLabel = getShiftStatusLabel(sp);
                            const noTemplate = !schichtId;
                            return (
                              <div key={sp.record_id} className="flex flex-col gap-0.5">
                                <div
                                  className={`rounded-md px-2 py-0.5 border text-xs font-medium ${
                                    noTemplate
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : SHIFT_STATUS_COLORS[statusKey] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                                  }`}
                                >
                                  {sp.fields.schicht_datum?.slice(0, 10)
                                    ? format(parseISO(sp.fields.schicht_datum.slice(0, 10)), 'EE d.', { locale: de })
                                    : '?'}
                                  {' '}
                                  {schicht?.fields.schicht_kuerzel ?? schicht?.fields.schicht_name ?? (noTemplate ? 'Kein Template' : 'Schicht')}
                                </div>
                                <StatusBadge statusKey={statusKey} label={statusLabel} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Amber note if any shifts have no template */}
            {weekSchichtplanung.some(sp => !extractRecordId(sp.fields.schicht_ref)) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex gap-2 items-start">
                <IconAlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  Einige Schichten haben keine Schichtvorlage zugewiesen. Bitte prufen Sie diese in Schritt 2.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="rounded-2xl border border-border bg-card p-4 overflow-hidden">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Alle geplanten Schichten bestatigen?</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {geplantCount} Schichten haben Status "Geplant"
                  </p>
                </div>
                <Button
                  onClick={handleConfirmAll}
                  disabled={confirming || geplantCount === 0}
                  variant={geplantCount === 0 ? 'outline' : 'default'}
                  className="gap-2 shrink-0"
                >
                  {confirming ? (
                    'Wird bestatigt...'
                  ) : (
                    <>
                      <IconCheck size={16} />
                      Alle bestatigen
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={() => setCurrentStep(2)} className="gap-2">
                <IconChevronLeft size={16} />
                Zuruck
              </Button>
              <Button
                onClick={() => navigate('/')}
                className="gap-2"
              >
                <IconRocket size={16} />
                Fertig
              </Button>
            </div>
          </div>
        )}
      </IntentWizardShell>

      {/* ---- Dialogs ---- */}
      <SchichtplanungDialog
        open={schichtplanungDialogOpen}
        onClose={() => {
          setSchichtplanungDialogOpen(false);
          setSchichtplanungDefaultValues(undefined);
        }}
        onSubmit={handleCreateSchichtplanung}
        defaultValues={schichtplanungDefaultValues}
        mitarbeiterList={mitarbeiter}
        schichtvorlagenList={schichtvorlagen}
        standorteAbteilungenList={standorteAbteilungen}
        enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Schichtplanung']}
      />

      <MitarbeiterDialog
        open={mitarbeiterDialogOpen}
        onClose={() => setMitarbeiterDialogOpen(false)}
        onSubmit={handleCreateMitarbeiter}
        standorteAbteilungenList={standorteAbteilungen}
        enablePhotoScan={AI_PHOTO_SCAN['Mitarbeiter']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Mitarbeiter']}
      />

      <SchichtvorlagenDialog
        open={schichtvorlagenDialogOpen}
        onClose={() => setSchichtvorlagenDialogOpen(false)}
        onSubmit={handleCreateSchichtvorlage}
        standorteAbteilungenList={standorteAbteilungen}
        enablePhotoScan={AI_PHOTO_SCAN['Schichtvorlagen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Schichtvorlagen']}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Schicht entfernen"
        description="Soll diese Schichtzuweisung wirklich geloscht werden?"
        onConfirm={handleDeleteShift}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </>
  );
}
