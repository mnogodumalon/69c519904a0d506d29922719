import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ActionsProvider } from '@/context/ActionsContext';
import { Layout } from '@/components/Layout';
import DashboardOverview from '@/pages/DashboardOverview';
import AdminPage from '@/pages/AdminPage';
import StandorteAbteilungenPage from '@/pages/StandorteAbteilungenPage';
import MitarbeiterPage from '@/pages/MitarbeiterPage';
import SchichtvorlagenPage from '@/pages/SchichtvorlagenPage';
import SchichtplanungPage from '@/pages/SchichtplanungPage';

const WochenplanErstellenPage = lazy(() => import('@/pages/intents/WochenplanErstellenPage'));
const SchichtbestatigungPage = lazy(() => import('@/pages/intents/SchichtbestatigungPage'));
const AbwesenheitMeldenPage = lazy(() => import('@/pages/intents/AbwesenheitMeldenPage'));

export default function App() {
  return (
    <HashRouter>
      <ActionsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardOverview />} />
            <Route path="standorte-&-abteilungen" element={<StandorteAbteilungenPage />} />
            <Route path="mitarbeiter" element={<MitarbeiterPage />} />
            <Route path="schichtvorlagen" element={<SchichtvorlagenPage />} />
            <Route path="schichtplanung" element={<SchichtplanungPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="intents/wochenplan-erstellen" element={<Suspense fallback={null}><WochenplanErstellenPage /></Suspense>} />
            <Route path="intents/schichtbestatigung" element={<Suspense fallback={null}><SchichtbestatigungPage /></Suspense>} />
            <Route path="intents/abwesenheit-melden" element={<Suspense fallback={null}><AbwesenheitMeldenPage /></Suspense>} />
          </Route>
        </Routes>
      </ActionsProvider>
    </HashRouter>
  );
}
