import type { EnrichedMitarbeiter, EnrichedSchichtplanung, EnrichedSchichtvorlagen } from '@/types/enriched';
import type { Mitarbeiter, Schichtplanung, Schichtvorlagen, StandorteAbteilungen } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveDisplay(url: unknown, map: Map<string, any>, ...fields: string[]): string {
  if (!url) return '';
  const id = extractRecordId(url);
  if (!id) return '';
  const r = map.get(id);
  if (!r) return '';
  return fields.map(f => String(r.fields[f] ?? '')).join(' ').trim();
}

interface MitarbeiterMaps {
  standorteAbteilungenMap: Map<string, StandorteAbteilungen>;
}

export function enrichMitarbeiter(
  mitarbeiter: Mitarbeiter[],
  maps: MitarbeiterMaps
): EnrichedMitarbeiter[] {
  return mitarbeiter.map(r => ({
    ...r,
    abteilung_refName: resolveDisplay(r.fields.abteilung_ref, maps.standorteAbteilungenMap, 'standort_name'),
  }));
}

interface SchichtvorlagenMaps {
  standorteAbteilungenMap: Map<string, StandorteAbteilungen>;
}

export function enrichSchichtvorlagen(
  schichtvorlagen: Schichtvorlagen[],
  maps: SchichtvorlagenMaps
): EnrichedSchichtvorlagen[] {
  return schichtvorlagen.map(r => ({
    ...r,
    schicht_abteilung_refName: resolveDisplay(r.fields.schicht_abteilung_ref, maps.standorteAbteilungenMap, 'standort_name'),
  }));
}

interface SchichtplanungMaps {
  mitarbeiterMap: Map<string, Mitarbeiter>;
  schichtvorlagenMap: Map<string, Schichtvorlagen>;
  standorteAbteilungenMap: Map<string, StandorteAbteilungen>;
}

export function enrichSchichtplanung(
  schichtplanung: Schichtplanung[],
  maps: SchichtplanungMaps
): EnrichedSchichtplanung[] {
  return schichtplanung.map(r => ({
    ...r,
    mitarbeiter_refName: resolveDisplay(r.fields.mitarbeiter_ref, maps.mitarbeiterMap, 'vorname', 'nachname'),
    schicht_refName: resolveDisplay(r.fields.schicht_ref, maps.schichtvorlagenMap, 'schicht_name'),
    planung_abteilung_refName: resolveDisplay(r.fields.planung_abteilung_ref, maps.standorteAbteilungenMap, 'standort_name'),
  }));
}
