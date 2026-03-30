import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Schichtplanung } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { useDashboardData } from '@/hooks/useDashboardData';
import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { StatusBadge } from '@/components/StatusBadge';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  IconCalendar,
  IconUsers,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconPlus,
  IconCheck,
  IconX,
  IconBuilding,
} from '@tabler/icons-react';

const WIZARD_STEPS = [
  { label: 'Abteilung & Datum' },
  { label: 'Status aktualisieren' },
  { label: 'Abschluss' },
];

interface PendingUpdate {
  status: string;
  notizen: string;
}

export default function SchichtenBestaetigenPage() {
  const [searchParams] = useSearchParams();
  const { mitarbeiter, standorteAbteilungen, schichtvorlagen, schichtplanung, loading, error, fetchAll, mitarbeiterMap, schichtvorlagenMap } = useDashboardData();

  const initialStep = (() => {
    const s = parseInt(searchParams.get('step') ?? '', 10);
    return s >= 1 && s <= 3 ? s : 1;
  })();

  const [currentStep, setCurrentStep] = useState(initialStep);
  const [selectedAbteilungId, setSelectedAbteilungId] = useState<string>(searchParams.get('abteilungId') ?? '');
  const [selectedDatum, setSelectedDatum] = useState<string>(searchParams.get('datum') ?? '');
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, PendingUpdate>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Deep-link: if abteilungId + datum params are present and step >= 2, we're pre-filled
  useEffect(() => {
    if (searchParams.get('abteilungId') && searchParams.get('datum') && initialStep >= 2) {
      setSelectedAbteilungId(searchParams.get('abteilungId')!);
      setSelectedDatum(searchParams.get('datum')!);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAbteilung = useMemo(
    () => standorteAbteilungen.find(a => a.record_id === selectedAbteilungId) ?? null,
    [standorteAbteilungen, selectedAbteilungId]
  );

  const filteredSchichten = useMemo(() => {
    if (!selectedAbteilungId || !selectedDatum) return [];
    return schichtplanung.filter(s => {
      const datumMatch = s.fields.schicht_datum === selectedDatum;
      const abteilungMatch = extractRecordId(s.fields.planung_abteilung_ref) === selectedAbteilungId;
      return datumMatch && abteilungMatch;
    });
  }, [schichtplanung, selectedAbteilungId, selectedDatum]);

  const stats = useMemo(() => {
    let bestaetigt = 0;
    let abgesagt = 0;
    let ausstehend = 0;
    filteredSchichten.forEach(s => {
      const update = pendingUpdates[s.record_id];
      const status = update?.status ?? (typeof s.fields.schicht_status === 'object' ? s.fields.schicht_status?.key : s.fields.schicht_status) ?? 'geplant';
      if (status === 'bestaetigt') bestaetigt++;
      else if (status === 'storniert') abgesagt++;
      else ausstehend++;
    });
    return { bestaetigt, abgesagt, ausstehend, total: filteredSchichten.length };
  }, [filteredSchichten, pendingUpdates]);

  function handleAbteilungSelect(id: string) {
    setSelectedAbteilungId(id);
  }

  function handleStatusChange(recordId: string, newStatus: string, currentNotizen: string) {
    setPendingUpdates(prev => ({
      ...prev,
      [recordId]: {
        status: newStatus,
        notizen: prev[recordId]?.notizen ?? currentNotizen,
      },
    }));
  }

  function handleNotizenChange(recordId: string, notizen: string, currentStatus: string) {
    setPendingUpdates(prev => ({
      ...prev,
      [recordId]: {
        status: prev[recordId]?.status ?? currentStatus,
        notizen,
      },
    }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const promises = Object.entries(pendingUpdates).map(([recordId, update]) =>
        LivingAppsService.updateSchichtplanungEntry(recordId, {
          schicht_status: update.status,
          planung_notizen: update.notizen,
        })
      );
      await Promise.all(promises);
      await fetchAll();
      setPendingUpdates({});
      setCurrentStep(3);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setSelectedAbteilungId('');
    setSelectedDatum('');
    setPendingUpdates({});
    setSaveError(null);
    setCurrentStep(1);
  }

  function getEffectiveStatus(record: Schichtplanung): string {
    if (pendingUpdates[record.record_id]?.status) return pendingUpdates[record.record_id].status;
    const s = record.fields.schicht_status;
    if (!s) return 'geplant';
    return typeof s === 'object' ? s.key : s;
  }

  function getEffectiveStatusLabel(record: Schichtplanung): string {
    const key = getEffectiveStatus(record);
    const labels: Record<string, string> = {
      geplant: 'Geplant',
      bestaetigt: 'Bestätigt',
      abwesend: 'Abwesend',
      storniert: 'Storniert',
    };
    return labels[key] ?? key;
  }

  function getEffectiveNotizen(record: Schichtplanung): string {
    if (pendingUpdates[record.record_id] !== undefined) return pendingUpdates[record.record_id].notizen;
    return record.fields.planung_notizen ?? '';
  }

  const canProceedStep1 = selectedAbteilungId !== '' && selectedDatum !== '';

  return (
    <IntentWizardShell
      title="Schichten bestätigen"
      subtitle="Überprüfe und bestätige geplante Schichten für einen Tag und eine Abteilung"
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      onStepChange={setCurrentStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* Step 1: Abteilung & Datum wählen */}
      {currentStep === 1 && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold mb-1">Abteilung wählen</h2>
              <p className="text-sm text-muted-foreground mb-3">Wähle die Abteilung, für die du Schichten bestätigen möchtest.</p>
              <EntitySelectStep
                items={standorteAbteilungen.map(a => ({
                  id: a.record_id,
                  title: a.fields.abteilung_name ?? '(Unbekannte Abteilung)',
                  subtitle: [a.fields.standort_name, a.fields.standort_ort].filter(Boolean).join(', '),
                  icon: <IconBuilding size={18} className="text-primary" stroke={1.5} />,
                }))}
                onSelect={handleAbteilungSelect}
                searchPlaceholder="Abteilung suchen..."
                emptyIcon={<IconUsers size={32} stroke={1.5} />}
                emptyText="Keine Abteilungen gefunden."
              />
            </div>

            {selectedAbteilungId && (
              <div className="rounded-xl border bg-primary/5 border-primary/20 px-4 py-3 flex items-center gap-2">
                <IconCircleCheck size={18} className="text-primary shrink-0" stroke={2} />
                <span className="text-sm font-medium text-primary">
                  Ausgewählt: {selectedAbteilung?.fields.abteilung_name ?? selectedAbteilungId}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold flex items-center gap-2" htmlFor="datum-picker">
              <IconCalendar size={16} stroke={2} className="text-muted-foreground" />
              Datum
            </label>
            <input
              id="datum-picker"
              type="date"
              value={selectedDatum}
              onChange={e => setSelectedDatum(e.target.value)}
              className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {canProceedStep1 && (
            <div className="rounded-xl border bg-card px-4 py-3 flex items-center gap-2">
              <IconClock size={16} className="text-muted-foreground shrink-0" stroke={2} />
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{filteredSchichten.length}</span> geplante Schichten gefunden
              </span>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => setCurrentStep(2)}
              disabled={!canProceedStep1}
              className="min-w-32"
            >
              Weiter
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Status aktualisieren */}
      {currentStep === 2 && (
        <div className="space-y-5">
          {/* Header info */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconBuilding size={15} stroke={2} />
              <span className="font-medium text-foreground">{selectedAbteilung?.fields.abteilung_name ?? selectedAbteilungId}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconCalendar size={15} stroke={2} />
              <span className="font-medium text-foreground">{selectedDatum}</span>
            </div>
          </div>

          {/* Live counters */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border bg-green-50 border-green-200 p-3 text-center overflow-hidden">
              <div className="text-2xl font-bold text-green-700">{stats.bestaetigt}</div>
              <div className="text-xs text-green-600 mt-0.5">Bestätigt</div>
            </div>
            <div className="rounded-xl border bg-red-50 border-red-200 p-3 text-center overflow-hidden">
              <div className="text-2xl font-bold text-red-700">{stats.abgesagt}</div>
              <div className="text-xs text-red-600 mt-0.5">Storniert</div>
            </div>
            <div className="rounded-xl border bg-gray-50 border-gray-200 p-3 text-center overflow-hidden">
              <div className="text-2xl font-bold text-gray-700">{stats.ausstehend}</div>
              <div className="text-xs text-gray-500 mt-0.5">Ausstehend</div>
            </div>
          </div>

          {/* Schicht cards */}
          {filteredSchichten.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <IconClock size={36} className="mx-auto mb-3 opacity-30" stroke={1.5} />
              <p className="text-sm">Keine Schichten für dieses Datum und diese Abteilung gefunden.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSchichten.map(record => {
                const mitarbeiterId = extractRecordId(record.fields.mitarbeiter_ref);
                const ma = mitarbeiterId ? mitarbeiterMap.get(mitarbeiterId) : undefined;
                const maName = ma ? [ma.fields.vorname, ma.fields.nachname].filter(Boolean).join(' ') : '(Unbekannt)';

                const schichtId = extractRecordId(record.fields.schicht_ref);
                const sv = schichtId ? schichtvorlagenMap.get(schichtId) : undefined;
                const schichtName = sv?.fields.schicht_name ?? '(Unbekannte Schicht)';
                const schichtZeit = sv ? `${sv.fields.schicht_beginn ?? ''}–${sv.fields.schicht_ende ?? ''}` : '';

                const effectiveStatus = getEffectiveStatus(record);
                const effectiveStatusLabel = getEffectiveStatusLabel(record);
                const effectiveNotizen = getEffectiveNotizen(record);
                const isDirty = pendingUpdates[record.record_id] !== undefined;

                return (
                  <div key={record.record_id} className={`rounded-xl border bg-card overflow-hidden ${isDirty ? 'border-primary/40 ring-1 ring-primary/20' : ''}`}>
                    <div className="p-4 space-y-3">
                      {/* Top row: name + status badge */}
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{maName}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {schichtName}{schichtZeit ? ` · ${schichtZeit}` : ''}
                          </div>
                        </div>
                        <StatusBadge statusKey={effectiveStatus} label={effectiveStatusLabel} />
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStatusChange(record.record_id, 'bestaetigt', effectiveNotizen)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-colors border ${
                            effectiveStatus === 'bestaetigt'
                              ? 'bg-green-600 text-white border-green-600'
                              : 'bg-background text-muted-foreground border-border hover:bg-green-50 hover:text-green-700 hover:border-green-300'
                          }`}
                        >
                          <IconCheck size={15} stroke={2.5} />
                          Bestätigen
                        </button>
                        <button
                          onClick={() => handleStatusChange(record.record_id, 'storniert', effectiveNotizen)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-colors border ${
                            effectiveStatus === 'storniert'
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-background text-muted-foreground border-border hover:bg-red-50 hover:text-red-700 hover:border-red-300'
                          }`}
                        >
                          <IconX size={15} stroke={2.5} />
                          Absagen
                        </button>
                      </div>

                      {/* Notizen */}
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Notizen</label>
                        <Textarea
                          rows={2}
                          value={effectiveNotizen}
                          onChange={e => handleNotizenChange(record.record_id, e.target.value, effectiveStatus)}
                          placeholder="Bemerkungen..."
                          className="text-sm resize-none"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add new Schichtplanung */}
          <div className="pt-1">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(true)}
              className="w-full gap-2"
            >
              <IconPlus size={16} stroke={2} />
              Neue Schichtplanung hinzufügen
            </Button>
            <SchichtplanungDialog
              open={dialogOpen}
              onClose={() => setDialogOpen(false)}
              onSubmit={async (fields) => {
                await LivingAppsService.createSchichtplanungEntry(fields);
                await fetchAll();
              }}
              mitarbeiterList={mitarbeiter}
              schichtvorlagenList={schichtvorlagen}
              standorte_abteilungenList={standorteAbteilungen}
              enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung']}
              enablePhotoLocation={AI_PHOTO_LOCATION['Schichtplanung']}
              defaultValues={
                selectedAbteilungId && selectedDatum
                  ? {
                      schicht_datum: selectedDatum,
                      planung_abteilung_ref: createRecordUrl(APP_IDS.STANDORTE_ABTEILUNGEN, selectedAbteilungId),
                    }
                  : undefined
              }
            />
          </div>

          {saveError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {saveError}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 justify-between pt-2">
            <Button variant="outline" onClick={() => setCurrentStep(1)}>
              Zurück
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || Object.keys(pendingUpdates).length === 0}
              className="min-w-44"
            >
              {saving ? 'Wird gespeichert...' : `Änderungen speichern (${Object.keys(pendingUpdates).length})`}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Abschluss */}
      {currentStep === 3 && (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-card overflow-hidden p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center shrink-0">
                <IconCircleCheck size={24} className="text-green-600" stroke={2} />
              </div>
              <div>
                <h2 className="text-lg font-bold">Schichten aktualisiert</h2>
                <p className="text-sm text-muted-foreground">Die Statusänderungen wurden erfolgreich gespeichert.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <IconBuilding size={14} stroke={2} />
                  <span className="text-xs">Abteilung</span>
                </div>
                <div className="font-medium truncate">{selectedAbteilung?.fields.abteilung_name ?? selectedAbteilungId}</div>
                {selectedAbteilung?.fields.standort_name && (
                  <div className="text-xs text-muted-foreground mt-0.5">{selectedAbteilung.fields.standort_name}</div>
                )}
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <IconCalendar size={14} stroke={2} />
                  <span className="text-xs">Datum</span>
                </div>
                <div className="font-medium">{selectedDatum}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border bg-background p-3 text-center overflow-hidden">
                <div className="text-xl font-bold">{filteredSchichten.length}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Gesamt</div>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center overflow-hidden">
                <div className="text-xl font-bold text-green-700">{stats.bestaetigt}</div>
                <div className="text-xs text-green-600 mt-0.5">Bestätigt</div>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center overflow-hidden">
                <div className="text-xl font-bold text-red-700">{stats.abgesagt}</div>
                <div className="text-xs text-red-600 mt-0.5">Storniert</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center overflow-hidden">
                <div className="text-xl font-bold text-gray-700">{stats.ausstehend}</div>
                <div className="text-xs text-gray-500 mt-0.5">Ausstehend</div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="#/schichtplanung"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
            >
              <IconCircleX size={16} stroke={2} />
              Schichtplan ansehen
            </a>
            <Button onClick={handleReset} className="flex-1 gap-2">
              <IconCalendar size={16} stroke={2} />
              Weiteren Tag bearbeiten
            </Button>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
