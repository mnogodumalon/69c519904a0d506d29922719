import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Mitarbeiter, StandorteAbteilungen, Schichtvorlagen, Schichtplanung } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';

export function useDashboardData() {
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter[]>([]);
  const [standorteAbteilungen, setStandorteAbteilungen] = useState<StandorteAbteilungen[]>([]);
  const [schichtvorlagen, setSchichtvorlagen] = useState<Schichtvorlagen[]>([]);
  const [schichtplanung, setSchichtplanung] = useState<Schichtplanung[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [mitarbeiterData, standorteAbteilungenData, schichtvorlagenData, schichtplanungData] = await Promise.all([
        LivingAppsService.getMitarbeiter(),
        LivingAppsService.getStandorteAbteilungen(),
        LivingAppsService.getSchichtvorlagen(),
        LivingAppsService.getSchichtplanung(),
      ]);
      setMitarbeiter(mitarbeiterData);
      setStandorteAbteilungen(standorteAbteilungenData);
      setSchichtvorlagen(schichtvorlagenData);
      setSchichtplanung(schichtplanungData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Fehler beim Laden der Daten'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Silent background refresh (no loading state change → no flicker)
  useEffect(() => {
    async function silentRefresh() {
      try {
        const [mitarbeiterData, standorteAbteilungenData, schichtvorlagenData, schichtplanungData] = await Promise.all([
          LivingAppsService.getMitarbeiter(),
          LivingAppsService.getStandorteAbteilungen(),
          LivingAppsService.getSchichtvorlagen(),
          LivingAppsService.getSchichtplanung(),
        ]);
        setMitarbeiter(mitarbeiterData);
        setStandorteAbteilungen(standorteAbteilungenData);
        setSchichtvorlagen(schichtvorlagenData);
        setSchichtplanung(schichtplanungData);
      } catch {
        // silently ignore — stale data is better than no data
      }
    }
    function handleRefresh() { void silentRefresh(); }
    window.addEventListener('dashboard-refresh', handleRefresh);
    return () => window.removeEventListener('dashboard-refresh', handleRefresh);
  }, []);

  const mitarbeiterMap = useMemo(() => {
    const m = new Map<string, Mitarbeiter>();
    mitarbeiter.forEach(r => m.set(r.record_id, r));
    return m;
  }, [mitarbeiter]);

  const standorteAbteilungenMap = useMemo(() => {
    const m = new Map<string, StandorteAbteilungen>();
    standorteAbteilungen.forEach(r => m.set(r.record_id, r));
    return m;
  }, [standorteAbteilungen]);

  const schichtvorlagenMap = useMemo(() => {
    const m = new Map<string, Schichtvorlagen>();
    schichtvorlagen.forEach(r => m.set(r.record_id, r));
    return m;
  }, [schichtvorlagen]);

  return { mitarbeiter, setMitarbeiter, standorteAbteilungen, setStandorteAbteilungen, schichtvorlagen, setSchichtvorlagen, schichtplanung, setSchichtplanung, loading, error, fetchAll, mitarbeiterMap, standorteAbteilungenMap, schichtvorlagenMap };
}