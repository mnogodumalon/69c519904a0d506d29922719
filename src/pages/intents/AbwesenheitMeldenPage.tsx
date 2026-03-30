import { useState, useMemo, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { Button } from '@/components/ui/button';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Mitarbeiter, Schichtplanung } from '@/types/app';
import { LivingAppsService, extractRecordId } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';

import {
  IconUser,
  IconCalendar,
  IconCheck,
  IconAlertTriangle,
  IconCircleCheck,
  IconArrowRight,
  IconX,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Mitarbeiter' },
  { label: 'Datum & Schichten' },
  { label: 'Fertig' },
];

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-orange-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-amber-500', 'bg-indigo-500',
];

const STATUS_COLORS: Record<string, string> = {
  geplant: 'bg-blue-100 text-blue-800 border-blue-200',
  bestaetigt: 'bg-green-100 text-green-800 border-green-200',
  abwesend: 'bg-amber-100 text-amber-800 border-amber-200',
  storniert: 'bg-red-100 text-red-800 border-red-200',
};

function getInitials(vorname?: string, nachname?: string) {
  const f = (vorname ?? '').trim();
  const l = (nachname ?? '').trim();
  if (f && l) return `${f[0]}${l[0]}`.toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (l) return l.slice(0, 2).toUpperCase();
  return '?';
}

export default function AbwesenheitMeldenPage() {
  const { mitarbeiter, schichtplanung, schichtvorlagenMap, loading, error, fetchAll } = useDashboardData();

  const [step, setStep] = useState(1);
  const [selectedMitarbeiterId, setSelectedMitarbeiterId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Derived
  const selectedMitarbeiter = useMemo<Mitarbeiter | undefined>(
    () => mitarbeiter.find(m => m.record_id === selectedMitarbeiterId),
    [mitarbeiter, selectedMitarbeiterId]
  );

  const mitarbeiterIndex = useMemo(
    () => mitarbeiter.findIndex(m => m.record_id === selectedMitarbeiterId),
    [mitarbeiter, selectedMitarbeiterId]
  );

  const shiftsOnDate = useMemo<Schichtplanung[]>(() => {
    if (!selectedMitarbeiterId || !selectedDate) return [];
    return schichtplanung.filter(p => {
      if (!p.fields.schicht_datum) return false;
      const dateStr = p.fields.schicht_datum.slice(0, 10);
      const mitId = extractRecordId(p.fields.mitarbeiter_ref);
      return dateStr === selectedDate && mitId === selectedMitarbeiterId;
    });
  }, [schichtplanung, selectedMitarbeiterId, selectedDate]);

  const handleSelectEmployee = useCallback((id: string) => {
    setSelectedMitarbeiterId(id);
    setSelectedShiftIds(new Set());
    setStep(2);
  }, []);

  const toggleShift = useCallback((id: string) => {
    setSelectedShiftIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleMarkAbsent = useCallback(async () => {
    if (selectedShiftIds.size === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all(
        Array.from(selectedShiftIds).map(id =>
          LivingAppsService.updateSchichtplanungEntry(id, { schicht_status: 'abwesend' })
        )
      );
      setSavedCount(selectedShiftIds.size);
      fetchAll();
      setStep(3);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  }, [selectedShiftIds, fetchAll]);

  const handleReset = useCallback(() => {
    setStep(1);
    setSelectedMitarbeiterId(null);
    setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
    setSelectedShiftIds(new Set());
    setSavedCount(0);
    setSaveError(null);
  }, []);

  const employeeItems = useMemo(() =>
    mitarbeiter.map((m, idx) => ({
      id: m.record_id,
      title: `${m.fields.vorname ?? ''} ${m.fields.nachname ?? ''}`.trim() || '—',
      subtitle: [m.fields.position, m.fields.beschaeftigungsart?.label].filter(Boolean).join(' · '),
      icon: (
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${AVATAR_COLORS[idx % AVATAR_COLORS.length]}`}>
          {getInitials(m.fields.vorname, m.fields.nachname)}
        </div>
      ),
    })),
    [mitarbeiter]
  );

  return (
    <IntentWizardShell
      title="Abwesenheit melden"
      subtitle="Mitarbeiter auswählen und Schicht(en) als abwesend markieren"
      steps={WIZARD_STEPS}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ── Step 1: Mitarbeiter wählen ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <IconUser size={16} className="text-primary shrink-0" />
              Mitarbeiter auswählen
            </h2>
            <EntitySelectStep
              items={employeeItems}
              onSelect={handleSelectEmployee}
              searchPlaceholder="Mitarbeiter suchen..."
              emptyIcon={<IconUser size={36} />}
              emptyText="Keine Mitarbeiter gefunden."
            />
          </div>
        </div>
      )}

      {/* ── Step 2: Datum & Schichten ── */}
      {step === 2 && selectedMitarbeiter && (
        <div className="space-y-4">
          {/* Employee summary card */}
          <div className="flex items-center gap-3 p-4 rounded-xl border bg-card">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${AVATAR_COLORS[mitarbeiterIndex % AVATAR_COLORS.length]}`}>
              {getInitials(selectedMitarbeiter.fields.vorname, selectedMitarbeiter.fields.nachname)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">
                {selectedMitarbeiter.fields.vorname} {selectedMitarbeiter.fields.nachname}
              </div>
              {selectedMitarbeiter.fields.position && (
                <div className="text-xs text-muted-foreground truncate">{selectedMitarbeiter.fields.position}</div>
              )}
            </div>
            <button onClick={() => setStep(1)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0">
              <IconX size={14} />
              Ändern
            </button>
          </div>

          {/* Date picker */}
          <div className="rounded-xl border bg-card p-4">
            <label className="flex items-center gap-2 font-semibold text-sm mb-3">
              <IconCalendar size={16} className="text-primary shrink-0" />
              Datum der Abwesenheit
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => {
                setSelectedDate(e.target.value);
                setSelectedShiftIds(new Set());
              }}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
            />
          </div>

          {/* Shifts on selected date */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <IconAlertTriangle size={16} className="text-amber-500 shrink-0" />
              Schichten am {selectedDate ? format(parseISO(selectedDate), 'EEEE, dd. MMMM yyyy', { locale: de }) : '—'}
            </h3>

            {shiftsOnDate.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <IconCalendar size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Keine Schichten für diesen Tag geplant.</p>
                <p className="text-xs mt-1">Wähle ein anderes Datum oder prüfe die Schichtplanung.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shiftsOnDate.map(shift => {
                  const schichtVorlage = extractRecordId(shift.fields.schicht_ref)
                    ? schichtvorlagenMap.get(extractRecordId(shift.fields.schicht_ref)!)
                    : undefined;
                  const shichtName = schichtVorlage?.fields.schicht_name ?? '—';
                  const statusKey = shift.fields.schicht_status?.key ?? 'geplant';
                  const isSelected = selectedShiftIds.has(shift.record_id);
                  const isAlreadyAbsent = statusKey === 'abwesend';

                  return (
                    <button
                      key={shift.record_id}
                      onClick={() => !isAlreadyAbsent && toggleShift(shift.record_id)}
                      disabled={isAlreadyAbsent}
                      className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                        isAlreadyAbsent
                          ? 'opacity-50 cursor-not-allowed bg-muted/30 border-border'
                          : isSelected
                          ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200'
                          : 'bg-card border-border hover:bg-accent hover:border-primary/30'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                        isAlreadyAbsent
                          ? 'bg-amber-100 border-amber-300'
                          : isSelected
                          ? 'bg-amber-500 border-amber-500'
                          : 'bg-background border-muted-foreground/30'
                      }`}>
                        {(isSelected || isAlreadyAbsent) && <IconCheck size={12} className="text-white" stroke={3} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{shichtName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_COLORS[statusKey] ?? STATUS_COLORS.geplant}`}>
                            {shift.fields.schicht_status?.label ?? 'Geplant'}
                          </span>
                        </div>
                        {schichtVorlage?.fields.schicht_beginn && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {schichtVorlage.fields.schicht_beginn}
                            {schichtVorlage.fields.schicht_ende && ` – ${schichtVorlage.fields.schicht_ende}`}
                          </div>
                        )}
                        {isAlreadyAbsent && (
                          <div className="text-xs text-amber-600 mt-0.5 font-medium">Bereits als abwesend markiert</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {saveError && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-sm text-destructive">
              <IconAlertTriangle size={16} className="shrink-0" />
              {saveError}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>
              Zurück
            </Button>
            <Button
              onClick={handleMarkAbsent}
              disabled={selectedShiftIds.size === 0 || saving}
              className="gap-2"
            >
              {saving ? (
                'Wird gespeichert...'
              ) : (
                <>
                  <IconAlertTriangle size={15} className="shrink-0" />
                  {selectedShiftIds.size} Schicht{selectedShiftIds.size !== 1 ? 'en' : ''} als abwesend markieren
                  <IconArrowRight size={15} className="shrink-0" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Fertig ── */}
      {step === 3 && selectedMitarbeiter && (
        <div className="flex flex-col items-center justify-center py-12 gap-6">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <IconCircleCheck size={36} className="text-green-600" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">Abwesenheit eingetragen</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              {savedCount} Schicht{savedCount !== 1 ? 'en' : ''} von{' '}
              <span className="font-medium text-foreground">
                {selectedMitarbeiter.fields.vorname} {selectedMitarbeiter.fields.nachname}
              </span>{' '}
              am{' '}
              <span className="font-medium text-foreground">
                {formatDate(selectedDate)}
              </span>{' '}
              wurde{savedCount !== 1 ? 'n' : ''} als <span className="text-amber-600 font-medium">Abwesend</span> markiert.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={handleReset}>
              Weitere Abwesenheit melden
            </Button>
            <a href="#/">
              <Button>
                Zurück zum Dashboard
              </Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
