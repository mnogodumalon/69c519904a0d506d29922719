import type { Mitarbeiter, Schichtplanung, Schichtvorlagen } from './app';

export type EnrichedMitarbeiter = Mitarbeiter & {
  abteilung_refName: string;
};

export type EnrichedSchichtvorlagen = Schichtvorlagen & {
  schicht_abteilung_refName: string;
};

export type EnrichedSchichtplanung = Schichtplanung & {
  mitarbeiter_refName: string;
  schicht_refName: string;
  planung_abteilung_refName: string;
};
