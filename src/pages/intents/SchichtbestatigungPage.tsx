import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  startOfWeek, endOfWeek, addDays, format, parseISO, addWeeks, subWeeks,
} from 'date-fns';
import { de } from 'date-fns/locale';

import { useDashboardData } from '@/hooks/useDashboardData';
import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { StatusBadge } from '@/components/StatusBadge';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

import type { StandorteAbteilungen, Schichtplanung } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';

import {
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconCalendar,
  IconCircleCheck,
  IconAlertCircle,
  IconNotes,
  IconFileExport,
  IconUsers,
  IconCheck,
  IconX,
  IconArrowBack,
  IconPlus,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Zeitraum & Abteilung' },
  { label: 'Schichten bearbeiten' },
  { label: 'Zusammenfassung' },
];

function getWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

function getWeekEnd(date: Date): Date {
  return endOfWeek(date, { weekStartsOn: 1 });
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = getWeekEnd(weekStart);
  return `${format(weekStart, 'dd. MMM', { locale: de })} – ${format(weekEnd, 'dd. MMM yyyy', { locale: de })}`;
}

function getStatusKey(schicht: Schichtplanung): string {
  const s = schicht.fields.schicht_status;
  if (!s) return 'geplant';
  if (typeof s === 'string') return s;
  return s.key;
}

function getStatusLabel(key: string): string {
  const map: Record<string, string> = {
    geplant: 'Geplant',
    bestaetigt: 'Bestätigt',
    abwesend: 'Abwesend',
    storniert: 'Storniert',
  };
  return map[key] ?? key;
}

interface NotesEditorState {
  schichtId: string;
  value: string;
}

export default function SchichtbestatigungPage() {
  const [searchParams] = useSearchParams();

  const initialStep = (() => {
    const urlStep = parseInt(searchParams.get('step') ?? '', 10);
    if (urlStep >= 1 && urlStep <= 3) return urlStep;
    return 1;
  })();

  const initialAbteilungId = searchParams.get('abteilungId') ?? null;

  const [currentStep, setCurrentStep] = useState(initialStep);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [selectedAbteilungId, setSelectedAbteilungId] = useState<string | null>(initialAbteilungId);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [notesEditor, setNotesEditor] = useState<NotesEditorState | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportText, setExportText] = useState('');

  const {
    standorteAbteilungen,
    mitarbeiter,
    schichtvorlagen,
    schichtplanung,
    loading,
    error,
    fetchAll,
  } = useDashboardData();

  // --- Derived: filtered schichten for selected week + abteilung ---
  const weekEnd = getWeekEnd(weekStart);
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

  const filteredSchichten = useMemo(() => {
    return schichtplanung.filter(s => {
      const datum = s.fields.schicht_datum;
      if (!datum) return false;
      const d = datum.slice(0, 10);
      if (d < weekStartStr || d > weekEndStr) return false;
      if (selectedAbteilungId) {
        const abtId = extractRecordId(s.fields.planung_abteilung_ref);
        if (abtId !== selectedAbteilungId) return false;
      }
      return true;
    });
  }, [schichtplanung, weekStartStr, weekEndStr, selectedAbteilungId]);

  // --- Step 1 preview stats ---
  const previewStats = useMemo(() => {
    if (!selectedAbteilungId) return null;
    const relevant = schichtplanung.filter(s => {
      const datum = s.fields.schicht_datum;
      if (!datum) return false;
      const d = datum.slice(0, 10);
      if (d < weekStartStr || d > weekEndStr) return false;
      const abtId = extractRecordId(s.fields.planung_abteilung_ref);
      return abtId === selectedAbteilungId;
    });
    const counts = { geplant: 0, bestaetigt: 0, abwesend: 0, storniert: 0 };
    for (const s of relevant) {
      const key = getStatusKey(s);
      if (key in counts) counts[key as keyof typeof counts]++;
    }
    return { total: relevant.length, ...counts };
  }, [schichtplanung, weekStartStr, weekEndStr, selectedAbteilungId]);

  // --- Step 2 grouped by employee ---
  const groupedByEmployee = useMemo(() => {
    const mitarbeiterMap = new Map(mitarbeiter.map(m => [m.record_id, m]));
    const groups = new Map<string, { name: string; initials: string; schichten: Schichtplanung[] }>();

    for (const s of filteredSchichten) {
      const mId = extractRecordId(s.fields.mitarbeiter_ref) ?? '__unbekannt__';
      const m = mitarbeiterMap.get(mId);
      const name = m ? `${m.fields.vorname ?? ''} ${m.fields.nachname ?? ''}`.trim() : 'Unbekannter Mitarbeiter';
      const initials = name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('');

      if (!groups.has(mId)) {
        groups.set(mId, { name, initials, schichten: [] });
      }
      groups.get(mId)!.schichten.push(s);
    }

    // Sort each group's shifts by date
    for (const g of groups.values()) {
      g.schichten.sort((a, b) =>
        (a.fields.schicht_datum ?? '').localeCompare(b.fields.schicht_datum ?? '')
      );
    }

    return Array.from(groups.entries()).sort((a, b) =>
      a[1].name.localeCompare(b[1].name)
    );
  }, [filteredSchichten, mitarbeiter]);

  // --- Step 2 live counters ---
  const liveCounts = useMemo(() => {
    const counts = { geplant: 0, bestaetigt: 0, abwesend: 0, storniert: 0 };
    for (const s of filteredSchichten) {
      const key = getStatusKey(s);
      if (key in counts) counts[key as keyof typeof counts]++;
    }
    return counts;
  }, [filteredSchichten]);

  // --- Step 3 summary per employee ---
  const summaryRows = useMemo(() => {
    const mitarbeiterMap = new Map(mitarbeiter.map(m => [m.record_id, m]));
    const rows = new Map<string, { name: string; geplant: number; bestaetigt: number; abwesend: number; storniert: number }>();

    for (const s of filteredSchichten) {
      const mId = extractRecordId(s.fields.mitarbeiter_ref) ?? '__unbekannt__';
      const m = mitarbeiterMap.get(mId);
      const name = m ? `${m.fields.vorname ?? ''} ${m.fields.nachname ?? ''}`.trim() : 'Unbekannt';

      if (!rows.has(mId)) {
        rows.set(mId, { name, geplant: 0, bestaetigt: 0, abwesend: 0, storniert: 0 });
      }
      const row = rows.get(mId)!;
      const key = getStatusKey(s);
      if (key === 'geplant') row.geplant++;
      else if (key === 'bestaetigt') row.bestaetigt++;
      else if (key === 'abwesend') row.abwesend++;
      else if (key === 'storniert') row.storniert++;
    }

    return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredSchichten, mitarbeiter]);

  // --- Actions ---
  const handleStatusChange = useCallback(async (schicht: Schichtplanung, newStatus: string) => {
    setUpdatingIds(prev => new Set(prev).add(schicht.record_id));
    try {
      await LivingAppsService.updateSchichtplanungEntry(schicht.record_id, {
        schicht_status: newStatus,
      });
      await fetchAll();
    } catch (err) {
      console.error('Status update failed:', err);
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(schicht.record_id);
        return next;
      });
    }
  }, [fetchAll]);

  const handleBulkConfirm = useCallback(async () => {
    const toConfirm = filteredSchichten.filter(s => getStatusKey(s) === 'geplant');
    if (toConfirm.length === 0) return;
    setUpdatingIds(new Set(toConfirm.map(s => s.record_id)));
    try {
      await Promise.all(
        toConfirm.map(s =>
          LivingAppsService.updateSchichtplanungEntry(s.record_id, { schicht_status: 'bestaetigt' })
        )
      );
      await fetchAll();
    } catch (err) {
      console.error('Bulk confirm failed:', err);
    } finally {
      setUpdatingIds(new Set());
    }
  }, [filteredSchichten, fetchAll]);

  const handleSaveNotes = useCallback(async () => {
    if (!notesEditor) return;
    setNotesSaving(true);
    try {
      await LivingAppsService.updateSchichtplanungEntry(notesEditor.schichtId, {
        planung_notizen: notesEditor.value,
      });
      await fetchAll();
      setNotesEditor(null);
    } catch (err) {
      console.error('Notes save failed:', err);
    } finally {
      setNotesSaving(false);
    }
  }, [notesEditor, fetchAll]);

  const handleOpenExport = useCallback(() => {
    const weekLabel = formatWeekLabel(weekStart);
    const abt = standorteAbteilungen.find(a => a.record_id === selectedAbteilungId);
    const abtLabel = abt
      ? [abt.fields.standort_name, abt.fields.abteilung_name].filter(Boolean).join(' – ')
      : 'Alle Abteilungen';

    const total = filteredSchichten.length;
    const bestaetigt = filteredSchichten.filter(s => getStatusKey(s) === 'bestaetigt').length;
    const abwesend = filteredSchichten.filter(s => getStatusKey(s) === 'abwesend').length;
    const storniert = filteredSchichten.filter(s => getStatusKey(s) === 'storniert').length;
    const geplant = filteredSchichten.filter(s => getStatusKey(s) === 'geplant').length;

    let text = `SCHICHTBESTÄTIGUNG – BERICHT\n`;
    text += `Zeitraum: ${weekLabel}\n`;
    text += `Abteilung: ${abtLabel}\n`;
    text += `Erstellt am: ${format(new Date(), 'dd. MMM yyyy HH:mm', { locale: de })}\n`;
    text += `\n${'─'.repeat(40)}\n`;
    text += `ÜBERSICHT\n`;
    text += `  Gesamt:      ${total}\n`;
    text += `  Bestätigt:   ${bestaetigt}\n`;
    text += `  Abwesend:    ${abwesend}\n`;
    text += `  Storniert:   ${storniert}\n`;
    text += `  Ausstehend:  ${geplant}\n`;
    text += `\n${'─'.repeat(40)}\n`;
    text += `MITARBEITER-DETAIL\n`;
    for (const row of summaryRows) {
      text += `\n  ${row.name}\n`;
      text += `    Geplant: ${row.geplant}  |  Bestätigt: ${row.bestaetigt}  |  Abwesend: ${row.abwesend}  |  Storniert: ${row.storniert}\n`;
    }

    setExportText(text);
    setExportModalOpen(true);
  }, [weekStart, standorteAbteilungen, selectedAbteilungId, filteredSchichten, summaryRows]);

  // --- Dialog default values ---
  const schichtDialogDefaults = useMemo((): Schichtplanung['fields'] => {
    const defaults: Schichtplanung['fields'] = {
      schicht_datum: weekStartStr,
      schicht_status: 'geplant' as any,
    };
    if (selectedAbteilungId) {
      defaults.planung_abteilung_ref = createRecordUrl(APP_IDS.STANDORTE_ABTEILUNGEN, selectedAbteilungId);
    }
    return defaults;
  }, [weekStartStr, selectedAbteilungId]);

  // Schichtvorlagen lookup map
  const schichtvorlagenMap = useMemo(
    () => new Map(schichtvorlagen.map(s => [s.record_id, s])),
    [schichtvorlagen]
  );

  // --- Render helpers ---
  function renderStatusActions(schicht: Schichtplanung) {
    const statusKey = getStatusKey(schicht);
    const isUpdating = updatingIds.has(schicht.record_id);

    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {statusKey === 'geplant' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs border-green-300 text-green-700 bg-green-50 hover:bg-green-100"
              disabled={isUpdating}
              onClick={() => handleStatusChange(schicht, 'bestaetigt')}
            >
              <IconCheck size={12} className="mr-1" stroke={2.5} />
              Bestätigen
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
              disabled={isUpdating}
              onClick={() => handleStatusChange(schicht, 'abwesend')}
            >
              <IconAlertCircle size={12} className="mr-1" stroke={2} />
              Abwesend
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs border-red-300 text-red-700 bg-red-50 hover:bg-red-100"
              disabled={isUpdating}
              onClick={() => handleStatusChange(schicht, 'storniert')}
            >
              <IconX size={12} className="mr-1" stroke={2.5} />
              Stornieren
            </Button>
          </>
        )}
        {statusKey === 'bestaetigt' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
              disabled={isUpdating}
              onClick={() => handleStatusChange(schicht, 'abwesend')}
            >
              <IconAlertCircle size={12} className="mr-1" stroke={2} />
              Abwesend
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs text-muted-foreground"
              disabled={isUpdating}
              onClick={() => handleStatusChange(schicht, 'geplant')}
            >
              <IconArrowBack size={12} className="mr-1" stroke={2} />
              Zurücksetzen
            </Button>
          </>
        )}
        {statusKey === 'abwesend' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs border-green-300 text-green-700 bg-green-50 hover:bg-green-100"
              disabled={isUpdating}
              onClick={() => handleStatusChange(schicht, 'bestaetigt')}
            >
              <IconCheck size={12} className="mr-1" stroke={2.5} />
              Bestätigen
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs text-muted-foreground"
              disabled={isUpdating}
              onClick={() => handleStatusChange(schicht, 'geplant')}
            >
              <IconArrowBack size={12} className="mr-1" stroke={2} />
              Zurücksetzen
            </Button>
          </>
        )}
        {statusKey === 'storniert' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs text-muted-foreground"
            disabled={isUpdating}
            onClick={() => handleStatusChange(schicht, 'geplant')}
          >
            <IconArrowBack size={12} className="mr-1" stroke={2} />
            Reaktivieren
          </Button>
        )}
      </div>
    );
  }

  // Total and confirmed for progress bar in step 3
  const totalSchichten = filteredSchichten.length;
  const bestaetigtCount = filteredSchichten.filter(s => getStatusKey(s) === 'bestaetigt').length;
  const abwesendCount = filteredSchichten.filter(s => getStatusKey(s) === 'abwesend').length;
  const storniertCount = filteredSchichten.filter(s => getStatusKey(s) === 'storniert').length;
  const geplantCount = filteredSchichten.filter(s => getStatusKey(s) === 'geplant').length;
  const progressPct = totalSchichten > 0 ? Math.round((bestaetigtCount / totalSchichten) * 100) : 0;

  const selectedAbteilung: StandorteAbteilungen | undefined = standorteAbteilungen.find(
    a => a.record_id === selectedAbteilungId
  );
  const selectedAbteilungLabel = selectedAbteilung
    ? [selectedAbteilung.fields.standort_name, selectedAbteilung.fields.abteilung_name]
        .filter(Boolean)
        .join(' – ')
    : '';

  return (
    <>
      <IntentWizardShell
        title="Schichtbestätigung"
        subtitle="Schichten für eine Woche und Abteilung bestätigen"
        steps={WIZARD_STEPS}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        loading={loading}
        error={error}
        onRetry={fetchAll}
      >
        {/* ====== STEP 1: Zeitraum & Abteilung ====== */}
        {currentStep === 1 && (
          <div className="space-y-6">
            {/* Week picker */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <IconCalendar size={16} className="text-muted-foreground" />
                Woche auswählen
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 shrink-0"
                  onClick={() => setWeekStart(prev => getWeekStart(subWeeks(prev, 1)))}
                >
                  <IconChevronLeft size={16} />
                </Button>
                <div className="flex-1 text-center">
                  <p className="font-semibold text-sm">{formatWeekLabel(weekStart)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    KW {format(weekStart, 'w', { locale: de })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 shrink-0"
                  onClick={() => setWeekStart(prev => getWeekStart(addWeeks(prev, 1)))}
                >
                  <IconChevronRight size={16} />
                </Button>
              </div>
              {/* Mini week days */}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(weekStart, i);
                  const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                  return (
                    <div
                      key={i}
                      className={`rounded-lg p-1.5 text-center ${
                        isToday ? 'bg-primary/10 ring-1 ring-primary/30' : 'bg-muted/40'
                      }`}
                    >
                      <p className="text-xs text-muted-foreground">
                        {format(day, 'EEE', { locale: de })}
                      </p>
                      <p className={`text-sm font-semibold ${isToday ? 'text-primary' : ''}`}>
                        {format(day, 'd')}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Department selector */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <IconBuilding size={16} className="text-muted-foreground" />
                Abteilung auswählen
              </div>
              <EntitySelectStep
                items={standorteAbteilungen.map(a => ({
                  id: a.record_id,
                  title: [a.fields.standort_name, a.fields.abteilung_name].filter(Boolean).join(' – ') || a.record_id,
                  subtitle: [a.fields.standort_strasse, a.fields.standort_ort].filter(Boolean).join(', '),
                  icon: <IconBuilding size={18} className="text-primary/70" />,
                }))}
                onSelect={id => setSelectedAbteilungId(id)}
                searchPlaceholder="Abteilung suchen..."
                emptyIcon={<IconBuilding size={32} />}
                emptyText="Keine Abteilungen gefunden."
              />
            </div>

            {/* Live preview if abteilung selected */}
            {selectedAbteilungId && previewStats && (
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <p className="text-sm font-medium text-muted-foreground">
                  Vorschau: {selectedAbteilungLabel}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">{previewStats.geplant}</p>
                    <p className="text-xs text-blue-600 mt-0.5">Ausstehend</p>
                  </div>
                  <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{previewStats.bestaetigt}</p>
                    <p className="text-xs text-green-600 mt-0.5">Bestätigt</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
                    <p className="text-2xl font-bold text-amber-700">{previewStats.abwesend}</p>
                    <p className="text-xs text-amber-600 mt-0.5">Abwesend</p>
                  </div>
                  <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
                    <p className="text-2xl font-bold text-red-700">{previewStats.storniert}</p>
                    <p className="text-xs text-red-600 mt-0.5">Storniert</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {previewStats.total} Schichten insgesamt in dieser Woche
                </p>
              </div>
            )}

            <Button
              className="w-full"
              disabled={!selectedAbteilungId}
              onClick={() => setCurrentStep(2)}
            >
              Weiter zu Schichten
              <IconChevronRight size={16} className="ml-1.5" />
            </Button>
          </div>
        )}

        {/* ====== STEP 2: Schichten bearbeiten ====== */}
        {currentStep === 2 && (
          <div className="space-y-5">
            {/* Header with week + dept info */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm">{formatWeekLabel(weekStart)}</p>
                  {selectedAbteilungLabel && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <IconBuilding size={12} />
                      {selectedAbteilungLabel}
                    </p>
                  )}
                </div>
                {/* Live status counters */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'geplant', label: 'Ausstehend', count: liveCounts.geplant, color: 'bg-blue-500' },
                    { key: 'bestaetigt', label: 'Bestätigt', count: liveCounts.bestaetigt, color: 'bg-green-500' },
                    { key: 'abwesend', label: 'Abwesend', count: liveCounts.abwesend, color: 'bg-amber-500' },
                    { key: 'storniert', label: 'Storniert', count: liveCounts.storniert, color: 'bg-red-500' },
                  ].map(item => (
                    <div key={item.key} className="flex items-center gap-1.5 text-xs">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${item.color}`} />
                      <span className="text-muted-foreground">{item.label}:</span>
                      <span className="font-semibold">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bulk actions row */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-green-300 text-green-700 bg-green-50 hover:bg-green-100"
                onClick={handleBulkConfirm}
                disabled={liveCounts.geplant === 0}
              >
                <IconCircleCheck size={15} className="mr-1.5" />
                Alle bestätigen ({liveCounts.geplant})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
              >
                <IconPlus size={15} className="mr-1.5" />
                Neue Schicht hinzufügen
              </Button>
            </div>

            {/* Schichten grouped by employee */}
            {groupedByEmployee.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-8 text-center">
                <IconUsers size={32} className="mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Keine Schichten für diese Woche und Abteilung gefunden.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setDialogOpen(true)}
                >
                  <IconPlus size={14} className="mr-1.5" />
                  Erste Schicht anlegen
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedByEmployee.map(([mId, group]) => (
                  <div key={mId} className="rounded-2xl border border-border bg-card overflow-hidden">
                    {/* Employee header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border">
                      <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{group.initials || '?'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{group.name}</p>
                        <p className="text-xs text-muted-foreground">{group.schichten.length} Schicht{group.schichten.length !== 1 ? 'en' : ''}</p>
                      </div>
                    </div>

                    {/* Shifts */}
                    <div className="divide-y divide-border">
                      {group.schichten.map(schicht => {
                        const schichtId = extractRecordId(schicht.fields.schicht_ref);
                        const schichtVorlage = schichtId ? schichtvorlagenMap.get(schichtId) : undefined;
                        const schichtName = schichtVorlage?.fields.schicht_name ?? schichtVorlage?.fields.schicht_kuerzel ?? 'Schicht';
                        const datumStr = schicht.fields.schicht_datum;
                        const datumLabel = datumStr
                          ? format(parseISO(datumStr), 'EEE, dd. MMM', { locale: de })
                          : '–';
                        const statusKey = getStatusKey(schicht);
                        const isEditingNotes = notesEditor?.schichtId === schicht.record_id;
                        const currentNotes = schicht.fields.planung_notizen ?? '';

                        return (
                          <div key={schicht.record_id} className="p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{datumLabel}</span>
                                  <span className="text-sm text-muted-foreground">·</span>
                                  <span className="text-sm truncate max-w-[160px]">{schichtName}</span>
                                  {schichtVorlage?.fields.schicht_beginn && schichtVorlage?.fields.schicht_ende && (
                                    <span className="text-xs text-muted-foreground">
                                      {schichtVorlage.fields.schicht_beginn}–{schichtVorlage.fields.schicht_ende}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <StatusBadge statusKey={statusKey} label={getStatusLabel(statusKey)} />
                                  {currentNotes && !isEditingNotes && (
                                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                      {currentNotes}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {/* Notes button */}
                              <button
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                                title="Notiz bearbeiten"
                                onClick={() => {
                                  if (isEditingNotes) {
                                    setNotesEditor(null);
                                  } else {
                                    setNotesEditor({ schichtId: schicht.record_id, value: currentNotes });
                                  }
                                }}
                              >
                                <IconNotes size={15} />
                              </button>
                            </div>

                            {/* Notes inline editor */}
                            {isEditingNotes && (
                              <div className="mt-3 space-y-2">
                                <Textarea
                                  value={notesEditor.value}
                                  onChange={e => setNotesEditor(prev => prev ? { ...prev, value: e.target.value } : null)}
                                  placeholder="Notiz eingeben..."
                                  rows={2}
                                  className="text-sm resize-none"
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="h-7 px-3 text-xs"
                                    disabled={notesSaving}
                                    onClick={handleSaveNotes}
                                  >
                                    {notesSaving ? 'Speichern...' : 'Speichern'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-3 text-xs"
                                    onClick={() => setNotesEditor(null)}
                                  >
                                    Abbrechen
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Status actions */}
                            {renderStatusActions(schicht)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setCurrentStep(1)}>
                <IconChevronLeft size={15} className="mr-1.5" />
                Zurück
              </Button>
              <Button className="flex-1" onClick={() => setCurrentStep(3)}>
                Weiter zu Zusammenfassung
                <IconChevronRight size={15} className="ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ====== STEP 3: Zusammenfassung ====== */}
        {currentStep === 3 && (
          <div className="space-y-5">
            {/* Summary header */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <p className="font-semibold">{formatWeekLabel(weekStart)}</p>
                {selectedAbteilungLabel && (
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedAbteilungLabel}</p>
                )}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-muted/40 p-3 text-center">
                  <p className="text-2xl font-bold">{totalSchichten}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Gesamt</p>
                </div>
                <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{bestaetigtCount}</p>
                  <p className="text-xs text-green-600 mt-0.5">Bestätigt</p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-700">{abwesendCount}</p>
                  <p className="text-xs text-amber-600 mt-0.5">Abwesend</p>
                </div>
                <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
                  <p className="text-2xl font-bold text-red-700">{storniertCount}</p>
                  <p className="text-xs text-red-600 mt-0.5">Storniert</p>
                </div>
              </div>

              {/* Pending */}
              {geplantCount > 0 && (
                <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 flex items-center gap-2">
                  <IconAlertCircle size={16} className="text-blue-600 shrink-0" />
                  <p className="text-sm text-blue-700">
                    <span className="font-semibold">{geplantCount}</span> Schicht{geplantCount !== 1 ? 'en' : ''} noch ausstehend
                  </p>
                </div>
              )}

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Bestätigungsfortschritt</span>
                  <span className="font-semibold text-foreground">{progressPct}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Per-employee table */}
            {summaryRows.length > 0 && (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <IconUsers size={15} className="text-muted-foreground" />
                    Mitarbeiter-Übersicht
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Mitarbeiter</th>
                        <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">Geplant</th>
                        <th className="text-center px-3 py-2.5 text-xs font-medium text-green-600">Bestätigt</th>
                        <th className="text-center px-3 py-2.5 text-xs font-medium text-amber-600">Abwesend</th>
                        <th className="text-center px-3 py-2.5 text-xs font-medium text-red-600">Storniert</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {summaryRows.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-4 py-3 font-medium truncate max-w-[180px]">{row.name}</td>
                          <td className="px-3 py-3 text-center text-muted-foreground">{row.geplant}</td>
                          <td className="px-3 py-3 text-center font-semibold text-green-700">{row.bestaetigt}</td>
                          <td className="px-3 py-3 text-center font-semibold text-amber-700">{row.abwesend}</td>
                          <td className="px-3 py-3 text-center font-semibold text-red-700">{row.storniert}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setCurrentStep(2)}>
                <IconChevronLeft size={15} className="mr-1.5" />
                Zurück
              </Button>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={handleOpenExport}
              >
                <IconFileExport size={15} className="mr-1.5" />
                Bericht exportieren
              </Button>
              <a href="#/" className="flex-1 sm:flex-none">
                <Button className="w-full">
                  <IconCircleCheck size={15} className="mr-1.5" />
                  Fertig
                </Button>
              </a>
            </div>
          </div>
        )}
      </IntentWizardShell>

      {/* Schichtplanung Dialog */}
      <SchichtplanungDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={async (fields) => {
          await LivingAppsService.createSchichtplanungEntry(fields);
          await fetchAll();
        }}
        defaultValues={schichtDialogDefaults}
        mitarbeiterList={mitarbeiter}
        schichtvorlagenList={schichtvorlagen}
        standorteAbteilungenList={standorteAbteilungen}
        enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Schichtplanung']}
      />

      {/* Export Modal */}
      <Dialog open={exportModalOpen} onOpenChange={v => !v && setExportModalOpen(false)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconFileExport size={18} />
              Schichtbericht
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Kopiere den Text unten und füge ihn in eine E-Mail oder ein Dokument ein.
            </p>
            <Textarea
              value={exportText}
              readOnly
              rows={16}
              className="font-mono text-xs resize-none bg-muted/30"
              onClick={e => (e.target as HTMLTextAreaElement).select()}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(exportText).catch(() => {});
              }}
            >
              In Zwischenablage kopieren
            </Button>
            <Button onClick={() => setExportModalOpen(false)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
