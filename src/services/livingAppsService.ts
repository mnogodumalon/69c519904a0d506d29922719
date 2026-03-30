// AUTOMATICALLY GENERATED SERVICE
import { APP_IDS, LOOKUP_OPTIONS, FIELD_TYPES } from '@/types/app';
import type { Mitarbeiter, StandorteAbteilungen, Schichtvorlagen, Schichtplanung, CreateMitarbeiter, CreateStandorteAbteilungen, CreateSchichtvorlagen, CreateSchichtplanung } from '@/types/app';

// Base Configuration
const API_BASE_URL = 'https://my.living-apps.de/rest';

// --- HELPER FUNCTIONS ---
export function extractRecordId(url: unknown): string | null {
  if (!url) return null;
  if (typeof url !== 'string') return null;
  const match = url.match(/([a-f0-9]{24})$/i);
  return match ? match[1] : null;
}

export function createRecordUrl(appId: string, recordId: string): string {
  return `https://my.living-apps.de/rest/apps/${appId}/records/${recordId}`;
}

async function callApi(method: string, endpoint: string, data?: any) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',  // Nutze Session Cookies für Auth
    body: data ? JSON.stringify(data) : undefined
  });
  if (!response.ok) throw new Error(await response.text());
  // DELETE returns often empty body or simple status
  if (method === 'DELETE') return true;
  return response.json();
}

/** Upload a file to LivingApps. Returns the file URL for use in record fields. */
export async function uploadFile(file: File | Blob, filename?: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', file, filename ?? (file instanceof File ? file.name : 'upload'));
  const res = await fetch(`${API_BASE_URL}/files`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) throw new Error(`File upload failed: ${res.status}`);
  const data = await res.json();
  return data.url;
}

function enrichLookupFields<T extends { fields: Record<string, unknown> }>(
  records: T[], entityKey: string
): T[] {
  const opts = LOOKUP_OPTIONS[entityKey];
  if (!opts) return records;
  return records.map(r => {
    const fields = { ...r.fields };
    for (const [fieldKey, options] of Object.entries(opts)) {
      const val = fields[fieldKey];
      if (typeof val === 'string') {
        const m = options.find(o => o.key === val);
        fields[fieldKey] = m ?? { key: val, label: val };
      } else if (Array.isArray(val)) {
        fields[fieldKey] = val.map(v => {
          if (typeof v === 'string') {
            const m = options.find(o => o.key === v);
            return m ?? { key: v, label: v };
          }
          return v;
        });
      }
    }
    return { ...r, fields } as T;
  });
}

/** Normalize fields for API writes: strip lookup objects to keys, fix date formats. */
export function cleanFieldsForApi(
  fields: Record<string, unknown>,
  entityKey: string
): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...fields };
  for (const [k, v] of Object.entries(clean)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'key' in v) clean[k] = (v as any).key;
    if (Array.isArray(v)) clean[k] = v.map((item: any) => item && typeof item === 'object' && 'key' in item ? item.key : item);
  }
  const types = FIELD_TYPES[entityKey];
  if (types) {
    for (const [k, ft] of Object.entries(types)) {
      if (!(k in clean)) continue;
      const val = clean[k];
      // applookup fields: undefined → null (clear single reference)
      if ((ft === 'applookup/select' || ft === 'applookup/choice') && val === undefined) { clean[k] = null; continue; }
      // multipleapplookup fields: undefined/null → [] (clear multi reference)
      if ((ft === 'multipleapplookup/select' || ft === 'multipleapplookup/choice') && (val === undefined || val === null)) { clean[k] = []; continue; }
      // lookup fields: undefined → null (clear single lookup)
      if ((ft.startsWith('lookup/')) && val === undefined) { clean[k] = null; continue; }
      // multiplelookup fields: undefined/null → [] (clear multi lookup)
      if ((ft.startsWith('multiplelookup/')) && (val === undefined || val === null)) { clean[k] = []; continue; }
      if (typeof val !== 'string' || !val) continue;
      if (ft === 'date/datetimeminute') clean[k] = val.slice(0, 16);
      else if (ft === 'date/date') clean[k] = val.slice(0, 10);
    }
  }
  return clean;
}

let _cachedUserProfile: Record<string, unknown> | null = null;

export async function getUserProfile(): Promise<Record<string, unknown>> {
  if (_cachedUserProfile) return _cachedUserProfile;
  const raw = await callApi('GET', '/user');
  const skip = new Set(['id', 'image', 'lang', 'gender', 'title', 'fax', 'menus', 'initials']);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v != null && !skip.has(k)) data[k] = v;
  }
  _cachedUserProfile = data;
  return data;
}

export interface HeaderProfile {
  firstname: string;
  surname: string;
  email: string;
  image: string | null;
  company: string | null;
}

let _cachedHeaderProfile: HeaderProfile | null = null;

export async function getHeaderProfile(): Promise<HeaderProfile> {
  if (_cachedHeaderProfile) return _cachedHeaderProfile;
  const raw = await callApi('GET', '/user');
  _cachedHeaderProfile = {
    firstname: raw.firstname ?? '',
    surname: raw.surname ?? '',
    email: raw.email ?? '',
    image: raw.image ?? null,
    company: raw.company ?? null,
  };
  return _cachedHeaderProfile;
}

export interface AppGroupInfo {
  id: string;
  name: string;
  image: string | null;
  createdat: string;
  /** Resolved link: /objects/{id}/ if the dashboard exists, otherwise /gateway/apps/{firstAppId}?template=list_page */
  href: string;
}

let _cachedAppGroups: AppGroupInfo[] | null = null;

export async function getAppGroups(): Promise<AppGroupInfo[]> {
  if (_cachedAppGroups) return _cachedAppGroups;
  const raw = await callApi('GET', '/appgroups?with=apps');
  const groups: AppGroupInfo[] = Object.values(raw)
    .map((g: any) => {
      const firstAppId = Object.keys(g.apps ?? {})[0] ?? g.id;
      return {
        id: g.id,
        name: g.name,
        image: g.image ?? null,
        createdat: g.createdat ?? '',
        href: `/gateway/apps/${firstAppId}?template=list_page`,
        _firstAppId: firstAppId,
      };
    })
    .sort((a, b) => b.createdat.localeCompare(a.createdat));

  // Check which appgroups have a working dashboard at /objects/{id}/
  const checks = await Promise.allSettled(
    groups.map(g => fetch(`/objects/${g.id}/`, { method: 'HEAD', credentials: 'include' }))
  );
  checks.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.ok) {
      groups[i].href = `/objects/${groups[i].id}/`;
    }
  });

  // Clean up internal helper property
  groups.forEach(g => delete (g as any)._firstAppId);

  _cachedAppGroups = groups;
  return _cachedAppGroups;
}

export class LivingAppsService {
  // --- MITARBEITER ---
  static async getMitarbeiter(): Promise<Mitarbeiter[]> {
    const data = await callApi('GET', `/apps/${APP_IDS.MITARBEITER}/records`);
    const records = Object.entries(data).map(([id, rec]: [string, any]) => ({
      record_id: id, ...rec
    })) as Mitarbeiter[];
    return enrichLookupFields(records, 'mitarbeiter');
  }
  static async getMitarbeiterEntry(id: string): Promise<Mitarbeiter | undefined> {
    const data = await callApi('GET', `/apps/${APP_IDS.MITARBEITER}/records/${id}`);
    const record = { record_id: data.id, ...data } as Mitarbeiter;
    return enrichLookupFields([record], 'mitarbeiter')[0];
  }
  static async createMitarbeiterEntry(fields: CreateMitarbeiter) {
    return callApi('POST', `/apps/${APP_IDS.MITARBEITER}/records`, { fields: cleanFieldsForApi(fields as any, 'mitarbeiter') });
  }
  static async updateMitarbeiterEntry(id: string, fields: Partial<CreateMitarbeiter>) {
    return callApi('PATCH', `/apps/${APP_IDS.MITARBEITER}/records/${id}`, { fields: cleanFieldsForApi(fields as any, 'mitarbeiter') });
  }
  static async deleteMitarbeiterEntry(id: string) {
    return callApi('DELETE', `/apps/${APP_IDS.MITARBEITER}/records/${id}`);
  }

  // --- STANDORTE_ABTEILUNGEN ---
  static async getStandorteAbteilungen(): Promise<StandorteAbteilungen[]> {
    const data = await callApi('GET', `/apps/${APP_IDS.STANDORTE_ABTEILUNGEN}/records`);
    const records = Object.entries(data).map(([id, rec]: [string, any]) => ({
      record_id: id, ...rec
    })) as StandorteAbteilungen[];
    return enrichLookupFields(records, 'standorte_abteilungen');
  }
  static async getStandorteAbteilungenEntry(id: string): Promise<StandorteAbteilungen | undefined> {
    const data = await callApi('GET', `/apps/${APP_IDS.STANDORTE_ABTEILUNGEN}/records/${id}`);
    const record = { record_id: data.id, ...data } as StandorteAbteilungen;
    return enrichLookupFields([record], 'standorte_abteilungen')[0];
  }
  static async createStandorteAbteilungenEntry(fields: CreateStandorteAbteilungen) {
    return callApi('POST', `/apps/${APP_IDS.STANDORTE_ABTEILUNGEN}/records`, { fields: cleanFieldsForApi(fields as any, 'standorte_abteilungen') });
  }
  static async updateStandorteAbteilungenEntry(id: string, fields: Partial<CreateStandorteAbteilungen>) {
    return callApi('PATCH', `/apps/${APP_IDS.STANDORTE_ABTEILUNGEN}/records/${id}`, { fields: cleanFieldsForApi(fields as any, 'standorte_abteilungen') });
  }
  static async deleteStandorteAbteilungenEntry(id: string) {
    return callApi('DELETE', `/apps/${APP_IDS.STANDORTE_ABTEILUNGEN}/records/${id}`);
  }

  // --- SCHICHTVORLAGEN ---
  static async getSchichtvorlagen(): Promise<Schichtvorlagen[]> {
    const data = await callApi('GET', `/apps/${APP_IDS.SCHICHTVORLAGEN}/records`);
    const records = Object.entries(data).map(([id, rec]: [string, any]) => ({
      record_id: id, ...rec
    })) as Schichtvorlagen[];
    return enrichLookupFields(records, 'schichtvorlagen');
  }
  static async getSchichtvorlagenEntry(id: string): Promise<Schichtvorlagen | undefined> {
    const data = await callApi('GET', `/apps/${APP_IDS.SCHICHTVORLAGEN}/records/${id}`);
    const record = { record_id: data.id, ...data } as Schichtvorlagen;
    return enrichLookupFields([record], 'schichtvorlagen')[0];
  }
  static async createSchichtvorlagenEntry(fields: CreateSchichtvorlagen) {
    return callApi('POST', `/apps/${APP_IDS.SCHICHTVORLAGEN}/records`, { fields: cleanFieldsForApi(fields as any, 'schichtvorlagen') });
  }
  static async updateSchichtvorlagenEntry(id: string, fields: Partial<CreateSchichtvorlagen>) {
    return callApi('PATCH', `/apps/${APP_IDS.SCHICHTVORLAGEN}/records/${id}`, { fields: cleanFieldsForApi(fields as any, 'schichtvorlagen') });
  }
  static async deleteSchichtvorlagenEntry(id: string) {
    return callApi('DELETE', `/apps/${APP_IDS.SCHICHTVORLAGEN}/records/${id}`);
  }

  // --- SCHICHTPLANUNG ---
  static async getSchichtplanung(): Promise<Schichtplanung[]> {
    const data = await callApi('GET', `/apps/${APP_IDS.SCHICHTPLANUNG}/records`);
    const records = Object.entries(data).map(([id, rec]: [string, any]) => ({
      record_id: id, ...rec
    })) as Schichtplanung[];
    return enrichLookupFields(records, 'schichtplanung');
  }
  static async getSchichtplanungEntry(id: string): Promise<Schichtplanung | undefined> {
    const data = await callApi('GET', `/apps/${APP_IDS.SCHICHTPLANUNG}/records/${id}`);
    const record = { record_id: data.id, ...data } as Schichtplanung;
    return enrichLookupFields([record], 'schichtplanung')[0];
  }
  static async createSchichtplanungEntry(fields: CreateSchichtplanung) {
    return callApi('POST', `/apps/${APP_IDS.SCHICHTPLANUNG}/records`, { fields: cleanFieldsForApi(fields as any, 'schichtplanung') });
  }
  static async updateSchichtplanungEntry(id: string, fields: Partial<CreateSchichtplanung>) {
    return callApi('PATCH', `/apps/${APP_IDS.SCHICHTPLANUNG}/records/${id}`, { fields: cleanFieldsForApi(fields as any, 'schichtplanung') });
  }
  static async deleteSchichtplanungEntry(id: string) {
    return callApi('DELETE', `/apps/${APP_IDS.SCHICHTPLANUNG}/records/${id}`);
  }

}