import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IntentWizardShell } from '@/components/IntentWizardShell';
import { EntitySelectStep } from '@/components/EntitySelectStep';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { Mitarbeiter, StandorteAbteilungen, Schichtvorlagen, Schichtplanung } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { SchichtplanungDialog } from '@/components/dialogs/SchichtplanungDialog';
import { MitarbeiterDialog } from '@/components/dialogs/MitarbeiterDialog';
import { SchichtvorlagenDialog } from '@/components/dialogs/SchichtvorlagenDialog';
import { StandorteAbteilungenDialog } from '@/components/dialogs/StandorteAbteilungenDialog';
import {
  IconCalendar,
  IconUsers,
  IconCheck,
  IconBuilding,
  IconPlus,
  IconLoader2,
  IconAlertCircle,
  IconChevronRight,
} from '@tabler/icons-react';

// -------------------------
// Types for Step 2 row state
// -------------------------
interface EmployeeRow {
  employeeId: string;
  schichtId: string | null;
  notizen: string;
  einplanen: boolean;
  existingRecordId: string | null;
}

const WIZARD_STEPS = [
  { label: 'Abteilung & Datum' },
  { label: 'Mitarbeiter einteilen' },
  { label: 'Zusammenfassung' },
];

export default function TagesschichtplanPage() {
  const { mitarbeiter, standorteAbteilungen, schichtvorlagen, schichtplanung, loading, error, fetchAll } = useDashboardData();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- Step management (deep-linking) ----
  const initialStep = (() => {
    const s = parseInt(searchParams.get('step') ?? '', 10);
    return s >= 1 && s <= 3 ? s : 1;
  })();
  const [currentStep, setCurrentStep] = useState(initialStep);

  // ---- Step 1 state ----
  const initialAbteilungId = searchParams.get('abteilungId') ?? null;
  const initialDatum = searchParams.get('datum') ?? '';
  const [selectedAbteilungId, setSelectedAbteilungId] = useState<string | null>(initialAbteilungId);
  const [selectedDatum, setSelectedDatum] = useState<string>(initialDatum);

  // ---- Step 2 state ----
  const [employeeRows, setEmployeeRows] = useState<EmployeeRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ---- Step 3 state ----
  const [savedCount, setSavedCount] = useState(0);

  // ---- Dialog state ----
  const [abteilungDialogOpen, setAbteilungDialogOpen] = useState(false);
  const [mitarbeiterDialogOpen, setMitarbeiterDialogOpen] = useState(false);
  const [schichtvorlagenDialogOpen, setSchichtvorlagenDialogOpen] = useState(false);
  const [schichtplanungDialogOpen, setSchichtplanungDialogOpen] = useState(false);

  // ---- Sync URL params ----
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (selectedAbteilungId) params.set('abteilungId', selectedAbteilungId);
    else params.delete('abteilungId');
    if (selectedDatum) params.set('datum', selectedDatum);
    else params.delete('datum');
    setSearchParams(params, { replace: true });
  }, [selectedAbteilungId, selectedDatum, searchParams, setSearchParams]);

  // ---- Derived data ----
  const selectedAbteilung = useMemo(
    () => standorteAbteilungen.find(a => a.record_id === selectedAbteilungId) ?? null,
    [standorteAbteilungen, selectedAbteilungId]
  );

  const abteilungMitarbeiter = useMemo(
    () => mitarbeiter.filter(m => extractRecordId(m.fields.abteilung_ref) === selectedAbteilungId),
    [mitarbeiter, selectedAbteilungId]
  );

  // Schichtvorlagen for this Abteilung (or all if none match)
  const relevantSchichtvorlagen = useMemo(() => {
    const filtered = schichtvorlagen.filter(
      sv => extractRecordId(sv.fields.schicht_abteilung_ref) === selectedAbteilungId
    );
    return filtered.length > 0 ? filtered : schichtvorlagen;
  }, [schichtvorlagen, selectedAbteilungId]);

  // Existing Schichtplanung for this date + department
  const existingPlanungen = useMemo(() => {
    if (!selectedDatum || !selectedAbteilungId) return [] as Schichtplanung[];
    return schichtplanung.filter(
      sp =>
        sp.fields.schicht_datum === selectedDatum &&
        extractRecordId(sp.fields.planung_abteilung_ref) === selectedAbteilungId
    );
  }, [schichtplanung, selectedDatum, selectedAbteilungId]);

  // Initialize employee rows when moving to step 2
  const initEmployeeRows = () => {
    const rows: EmployeeRow[] = abteilungMitarbeiter.map(m => {
      const existing = existingPlanungen.find(
        sp => extractRecordId(sp.fields.mitarbeiter_ref) === m.record_id
      );
      return {
        employeeId: m.record_id,
        schichtId: existing ? extractRecordId(existing.fields.schicht_ref) : null,
        notizen: existing?.fields.planung_notizen ?? '',
        einplanen: !!existing,
        existingRecordId: existing?.record_id ?? null,
      };
    });
    setEmployeeRows(rows);
  };

  const handleAbteilungSelect = (id: string) => {
    setSelectedAbteilungId(id);
  };

  const handleGoToStep2 = () => {
    initEmployeeRows();
    setCurrentStep(2);
  };

  const handleGoToStep1 = () => {
    setCurrentStep(1);
    setSaveError(null);
  };

  const updateRow = (employeeId: string, patch: Partial<EmployeeRow>) => {
    setEmployeeRows(rows =>
      rows.map(r => (r.employeeId === employeeId ? { ...r, ...patch } : r))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    let count = 0;
    try {
      const toSave = employeeRows.filter(r => r.einplanen && r.schichtId);
      for (const row of toSave) {
        const fields = {
          schicht_datum: selectedDatum,
          mitarbeiter_ref: createRecordUrl(APP_IDS.MITARBEITER, row.employeeId),
          schicht_ref: createRecordUrl(APP_IDS.SCHICHTVORLAGEN, row.schichtId!),
          planung_abteilung_ref: createRecordUrl(APP_IDS.STANDORTE_ABTEILUNGEN, selectedAbteilungId!),
          schicht_status: 'geplant',
          planung_notizen: row.notizen || undefined,
        };
        if (row.existingRecordId) {
          await LivingAppsService.updateSchichtplanungEntry(row.existingRecordId, fields);
        } else {
          await LivingAppsService.createSchichtplanungEntry(fields);
        }
        count++;
      }
      await fetchAll();
      setSavedCount(count);
      setCurrentStep(3);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unbekannter Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSelectedAbteilungId(null);
    setSelectedDatum('');
    setEmployeeRows([]);
    setSaveError(null);
    setSavedCount(0);
    setCurrentStep(1);
  };

  const plannedRows = employeeRows.filter(r => r.einplanen && r.schichtId);
  const checkedCount = employeeRows.filter(r => r.einplanen).length;

  const getMitarbeiter = (id: string): Mitarbeiter | undefined =>
    mitarbeiter.find(m => m.record_id === id);

  const getSchichtvorlage = (id: string | null): Schichtvorlagen | undefined =>
    id ? schichtvorlagen.find(sv => sv.record_id === id) : undefined;

  // ---- Render ----
  return (
    <IntentWizardShell
      title="Tagesschichtplan erstellen"
      subtitle="Weise Mitarbeitern Schichten für einen bestimmten Tag zu"
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      onStepChange={setCurrentStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
    >
      {/* ===================== STEP 1 ===================== */}
      {currentStep === 1 && (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <IconBuilding size={18} className="text-primary" stroke={2} />
                <h2 className="font-semibold text-sm">Abteilung auswählen</h2>
              </div>
            </div>
            <div className="p-5">
              <EntitySelectStep
                items={standorteAbteilungen.map((a: StandorteAbteilungen) => ({
                  id: a.record_id,
                  title: a.fields.abteilung_name ?? '(Unbekannte Abteilung)',
                  subtitle: [a.fields.standort_name, a.fields.standort_ort].filter(Boolean).join(', '),
                  status: undefined,
                  icon: <IconBuilding size={16} className="text-primary" stroke={2} />,
                }))}
                onSelect={handleAbteilungSelect}
                searchPlaceholder="Abteilung suchen..."
                emptyText="Keine Abteilungen gefunden."
                emptyIcon={<IconBuilding size={32} />}
                createLabel="Neue Abteilung"
                onCreateNew={() => setAbteilungDialogOpen(true)}
                createDialog={
                  <StandorteAbteilungenDialog
                    open={abteilungDialogOpen}
                    onClose={() => setAbteilungDialogOpen(false)}
                    onSubmit={async (fields) => {
                      await LivingAppsService.createStandorteAbteilungenEntry(fields);
                      await fetchAll();
                    }}
                    enablePhotoScan={AI_PHOTO_SCAN['StandorteAbteilungen']}
                    enablePhotoLocation={AI_PHOTO_LOCATION['StandorteAbteilungen']}
                  />
                }
              />

              {selectedAbteilung && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                  <IconCheck size={15} className="text-primary shrink-0" stroke={2.5} />
                  <span className="font-medium text-primary truncate">
                    {selectedAbteilung.fields.abteilung_name}
                  </span>
                  <span className="text-muted-foreground truncate">
                    — {selectedAbteilung.fields.standort_name}, {selectedAbteilung.fields.standort_ort}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <IconCalendar size={18} className="text-primary" stroke={2} />
                <h2 className="font-semibold text-sm">Datum wählen</h2>
              </div>
            </div>
            <div className="p-5">
              <label className="block text-sm font-medium mb-2 text-foreground">Datum</label>
              <input
                type="date"
                value={selectedDatum}
                onChange={e => setSelectedDatum(e.target.value)}
                className="w-full max-w-xs rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              />
              {selectedDatum && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Ausgewähltes Datum:{' '}
                  <span className="font-medium text-foreground">
                    {new Date(selectedDatum + 'T00:00:00').toLocaleDateString('de-DE', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleGoToStep2}
              disabled={!selectedAbteilungId || !selectedDatum}
              className="gap-2"
            >
              Weiter
              <IconChevronRight size={16} stroke={2} />
            </Button>
          </div>
        </div>
      )}

      {/* ===================== STEP 2 ===================== */}
      {currentStep === 2 && (
        <div className="space-y-5">
          {/* Context banner */}
          <div className="flex flex-wrap gap-3 items-center px-4 py-3 rounded-xl bg-muted/50 border text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <IconBuilding size={15} stroke={2} className="text-primary" />
              {selectedAbteilung?.fields.abteilung_name}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1.5">
              <IconCalendar size={15} stroke={2} className="text-primary" />
              {selectedDatum
                ? new Date(selectedDatum + 'T00:00:00').toLocaleDateString('de-DE', {
                    weekday: 'long',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })
                : selectedDatum}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1.5 font-medium text-primary">
              <IconUsers size={15} stroke={2} />
              {checkedCount} von {employeeRows.length} eingeplant
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setMitarbeiterDialogOpen(true)}
            >
              <IconPlus size={15} stroke={2} />
              Neuen Mitarbeiter anlegen
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setSchichtvorlagenDialogOpen(true)}
            >
              <IconPlus size={15} stroke={2} />
              Neue Schichtvorlage
            </Button>
          </div>

          {/* Employee table */}
          {employeeRows.length === 0 ? (
            <div className="text-center py-12 rounded-2xl border bg-card text-muted-foreground">
              <IconUsers size={32} className="mx-auto mb-3 opacity-30" stroke={1.5} />
              <p className="text-sm">Keine Mitarbeiter in dieser Abteilung gefunden.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5"
                onClick={() => setMitarbeiterDialogOpen(true)}
              >
                <IconPlus size={14} stroke={2} />
                Mitarbeiter anlegen
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide w-10">
                        Ein
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide">
                        Mitarbeiter
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide min-w-[180px]">
                        Schicht
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide min-w-[160px]">
                        Notizen
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {employeeRows.map(row => {
                      const m = getMitarbeiter(row.employeeId);
                      if (!m) return null;
                      const beschKey = typeof m.fields.beschaeftigungsart === 'object'
                        ? m.fields.beschaeftigungsart?.key
                        : m.fields.beschaeftigungsart;
                      const beschLabel = typeof m.fields.beschaeftigungsart === 'object'
                        ? m.fields.beschaeftigungsart?.label
                        : m.fields.beschaeftigungsart;

                      return (
                        <tr
                          key={row.employeeId}
                          className={`transition-colors ${row.einplanen ? 'bg-primary/3' : 'bg-card'}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={row.einplanen}
                              onChange={e => updateRow(row.employeeId, { einplanen: e.target.checked })}
                              className="w-4 h-4 accent-primary cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {[m.fields.vorname, m.fields.nachname].filter(Boolean).join(' ') || '(Unbekannt)'}
                              </p>
                              {m.fields.position && (
                                <p className="text-xs text-muted-foreground truncate">{m.fields.position}</p>
                              )}
                              {beschKey && (
                                <StatusBadge statusKey={beschKey} label={beschLabel} className="mt-1" />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={row.schichtId ?? ''}
                              onChange={e =>
                                updateRow(row.employeeId, {
                                  schichtId: e.target.value || null,
                                  einplanen: e.target.value ? true : row.einplanen,
                                })
                              }
                              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                            >
                              <option value="">— Schicht wählen —</option>
                              {relevantSchichtvorlagen.map((sv: Schichtvorlagen) => (
                                <option key={sv.record_id} value={sv.record_id}>
                                  {sv.fields.schicht_kuerzel
                                    ? `${sv.fields.schicht_kuerzel} – `
                                    : ''}
                                  {sv.fields.schicht_name ?? '(Unbekannt)'}
                                  {sv.fields.schicht_beginn && sv.fields.schicht_ende
                                    ? ` (${sv.fields.schicht_beginn}–${sv.fields.schicht_ende})`
                                    : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <textarea
                              value={row.notizen}
                              onChange={e => updateRow(row.employeeId, { notizen: e.target.value })}
                              placeholder="Notizen..."
                              rows={1}
                              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {saveError && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <IconAlertCircle size={16} className="shrink-0 mt-0.5" stroke={2} />
              <span>{saveError}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button variant="outline" onClick={handleGoToStep1} className="gap-1.5">
              Zurück
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || plannedRows.length === 0}
              className="gap-2"
            >
              {saving && <IconLoader2 size={15} className="animate-spin" stroke={2} />}
              {saving ? 'Wird gespeichert…' : `Schichten speichern (${plannedRows.length})`}
            </Button>
          </div>

          {/* Dialogs */}
          <MitarbeiterDialog
            open={mitarbeiterDialogOpen}
            onClose={() => setMitarbeiterDialogOpen(false)}
            onSubmit={async (fields) => {
              await LivingAppsService.createMitarbeiterEntry(fields);
              await fetchAll();
            }}
            standorte_abteilungenList={standorteAbteilungen}
            enablePhotoScan={AI_PHOTO_SCAN['Mitarbeiter']}
            enablePhotoLocation={AI_PHOTO_LOCATION['Mitarbeiter']}
          />
          <SchichtvorlagenDialog
            open={schichtvorlagenDialogOpen}
            onClose={() => setSchichtvorlagenDialogOpen(false)}
            onSubmit={async (fields) => {
              await LivingAppsService.createSchichtvorlagenEntry(fields);
              await fetchAll();
            }}
            standorte_abteilungenList={standorteAbteilungen}
            enablePhotoScan={AI_PHOTO_SCAN['Schichtvorlagen']}
            enablePhotoLocation={AI_PHOTO_LOCATION['Schichtvorlagen']}
          />
          <SchichtplanungDialog
            open={schichtplanungDialogOpen}
            onClose={() => setSchichtplanungDialogOpen(false)}
            onSubmit={async (fields) => {
              await LivingAppsService.createSchichtplanungEntry(fields);
              await fetchAll();
            }}
            mitarbeiterList={mitarbeiter}
            schichtvorlagenList={schichtvorlagen}
            standorte_abteilungenList={standorteAbteilungen}
            enablePhotoScan={AI_PHOTO_SCAN['Schichtplanung']}
            enablePhotoLocation={AI_PHOTO_LOCATION['Schichtplanung']}
          />
        </div>
      )}

      {/* ===================== STEP 3 ===================== */}
      {currentStep === 3 && (
        <div className="space-y-5">
          {/* Summary card */}
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b bg-primary/5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                  <IconCheck size={16} className="text-primary-foreground" stroke={2.5} />
                </div>
                <div>
                  <h2 className="font-semibold text-sm">Schichten erfolgreich geplant</h2>
                  <p className="text-xs text-muted-foreground">{savedCount} Schicht{savedCount !== 1 ? 'en' : ''} gespeichert</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/40 px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Abteilung</p>
                  <p className="font-semibold text-sm">{selectedAbteilung?.fields.abteilung_name ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    {[selectedAbteilung?.fields.standort_name, selectedAbteilung?.fields.standort_ort]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/40 px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Datum</p>
                  <p className="font-semibold text-sm">
                    {selectedDatum
                      ? new Date(selectedDatum + 'T00:00:00').toLocaleDateString('de-DE', {
                          weekday: 'long',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Planned assignments list */}
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">{savedCount} Schicht{savedCount !== 1 ? 'en' : ''} geplant</h3>
            </div>
            {plannedRows.length === 0 ? (
              <p className="text-sm text-muted-foreground px-5 py-4">Keine Schichten geplant.</p>
            ) : (
              <ul className="divide-y">
                {plannedRows.map(row => {
                  const m = getMitarbeiter(row.employeeId);
                  const sv = getSchichtvorlage(row.schichtId);
                  return (
                    <li key={row.employeeId} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <IconUsers size={14} className="text-primary" stroke={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {[m?.fields.vorname, m?.fields.nachname].filter(Boolean).join(' ') || '—'}
                        </p>
                        {sv && (
                          <p className="text-xs text-muted-foreground truncate">
                            {sv.fields.schicht_name}
                            {sv.fields.schicht_beginn && sv.fields.schicht_ende
                              ? ` · ${sv.fields.schicht_beginn}–${sv.fields.schicht_ende}`
                              : ''}
                          </p>
                        )}
                      </div>
                      <StatusBadge statusKey="geplant" label="Geplant" />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-3 justify-between pt-1">
            <Button variant="outline" onClick={handleReset} className="gap-1.5">
              Weitere Schichten planen
            </Button>
            <a href="#/schichtplanung">
              <Button className="gap-1.5">
                Zur Schichtplanung
                <IconChevronRight size={15} stroke={2} />
              </Button>
            </a>
          </div>
        </div>
      )}
    </IntentWizardShell>
  );
}
