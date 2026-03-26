// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
export type GeoLocation = { lat: number; long: number; info?: string };

export interface StandorteAbteilungen {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    standort_name?: string;
    abteilung_name?: string;
    standort_strasse?: string;
    standort_hausnummer?: string;
    standort_plz?: string;
    standort_ort?: string;
    standort_beschreibung?: string;
  };
}

export interface Mitarbeiter {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    vorname?: string;
    nachname?: string;
    personalnummer?: string;
    email?: string;
    telefon?: string;
    position?: string;
    beschaeftigungsart?: LookupValue;
    wochenstunden?: number;
    abteilung_ref?: string; // applookup -> URL zu 'StandorteAbteilungen' Record
    mitarbeiter_notizen?: string;
  };
}

export interface Schichtvorlagen {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    schicht_name?: string;
    schicht_kuerzel?: string;
    schicht_beginn?: string;
    schicht_ende?: string;
    pausendauer?: number;
    schicht_kategorie?: LookupValue;
    schicht_abteilung_ref?: string; // applookup -> URL zu 'StandorteAbteilungen' Record
    schicht_beschreibung?: string;
  };
}

export interface Schichtplanung {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    schicht_datum?: string; // Format: YYYY-MM-DD oder ISO String
    mitarbeiter_ref?: string; // applookup -> URL zu 'Mitarbeiter' Record
    schicht_ref?: string; // applookup -> URL zu 'Schichtvorlagen' Record
    planung_abteilung_ref?: string; // applookup -> URL zu 'StandorteAbteilungen' Record
    schicht_status?: LookupValue;
    planung_notizen?: string;
  };
}

export const APP_IDS = {
  STANDORTE_ABTEILUNGEN: '69c5196c30a2e351ed55e8e6',
  MITARBEITER: '69c519719a8c4a3e9d08485f',
  SCHICHTVORLAGEN: '69c51971ed063aab6dfc28d0',
  SCHICHTPLANUNG: '69c51972c9beadf114b98825',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {
  'mitarbeiter': {
    beschaeftigungsart: [{ key: "vollzeit", label: "Vollzeit" }, { key: "teilzeit", label: "Teilzeit" }, { key: "minijob", label: "Minijob" }, { key: "aushilfe", label: "Aushilfe" }],
  },
  'schichtvorlagen': {
    schicht_kategorie: [{ key: "fruehschicht", label: "Frühschicht" }, { key: "spaetschicht", label: "Spätschicht" }, { key: "nachtschicht", label: "Nachtschicht" }, { key: "tagschicht", label: "Tagschicht" }, { key: "sonderschicht", label: "Sonderschicht" }],
  },
  'schichtplanung': {
    schicht_status: [{ key: "geplant", label: "Geplant" }, { key: "bestaetigt", label: "Bestätigt" }, { key: "abwesend", label: "Abwesend" }, { key: "storniert", label: "Storniert" }],
  },
};

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'standorte_&_abteilungen': {
    'standort_name': 'string/text',
    'abteilung_name': 'string/text',
    'standort_strasse': 'string/text',
    'standort_hausnummer': 'string/text',
    'standort_plz': 'string/text',
    'standort_ort': 'string/text',
    'standort_beschreibung': 'string/textarea',
  },
  'mitarbeiter': {
    'vorname': 'string/text',
    'nachname': 'string/text',
    'personalnummer': 'string/text',
    'email': 'string/email',
    'telefon': 'string/tel',
    'position': 'string/text',
    'beschaeftigungsart': 'lookup/radio',
    'wochenstunden': 'number',
    'abteilung_ref': 'applookup/select',
    'mitarbeiter_notizen': 'string/textarea',
  },
  'schichtvorlagen': {
    'schicht_name': 'string/text',
    'schicht_kuerzel': 'string/text',
    'schicht_beginn': 'string/text',
    'schicht_ende': 'string/text',
    'pausendauer': 'number',
    'schicht_kategorie': 'lookup/select',
    'schicht_abteilung_ref': 'applookup/select',
    'schicht_beschreibung': 'string/textarea',
  },
  'schichtplanung': {
    'schicht_datum': 'date/date',
    'mitarbeiter_ref': 'applookup/select',
    'schicht_ref': 'applookup/select',
    'planung_abteilung_ref': 'applookup/select',
    'schicht_status': 'lookup/radio',
    'planung_notizen': 'string/textarea',
  },
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreateStandorteAbteilungen = StripLookup<StandorteAbteilungen['fields']>;
export type CreateMitarbeiter = StripLookup<Mitarbeiter['fields']>;
export type CreateSchichtvorlagen = StripLookup<Schichtvorlagen['fields']>;
export type CreateSchichtplanung = StripLookup<Schichtplanung['fields']>;