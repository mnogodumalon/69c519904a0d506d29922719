import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ActionsProvider } from '@/context/ActionsContext';
import { Layout } from '@/components/Layout';
import DashboardOverview from '@/pages/DashboardOverview';
import AdminPage from '@/pages/AdminPage';
import MitarbeiterPage from '@/pages/MitarbeiterPage';
import StandorteAbteilungenPage from '@/pages/StandorteAbteilungenPage';
import SchichtvorlagenPage from '@/pages/SchichtvorlagenPage';
import SchichtplanungPage from '@/pages/SchichtplanungPage';

const TagesschichtplanPage = lazy(() => import('@/pages/intents/TagesschichtplanPage'));
const SchichtenBestaetigenPage = lazy(() => import('@/pages/intents/SchichtenBestaetigenPage'));

export default function App() {
  return (
    <HashRouter>
      <ActionsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardOverview />} />
            <Route path="mitarbeiter" element={<MitarbeiterPage />} />
            <Route path="standorte-abteilungen" element={<StandorteAbteilungenPage />} />
            <Route path="schichtvorlagen" element={<SchichtvorlagenPage />} />
            <Route path="schichtplanung" element={<SchichtplanungPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="intents/tagesschichtplan" element={<Suspense fallback={null}><TagesschichtplanPage /></Suspense>} />
            <Route path="intents/schichten-bestaetigen" element={<Suspense fallback={null}><SchichtenBestaetigenPage /></Suspense>} />
          </Route>
        </Routes>
      </ActionsProvider>
    </HashRouter>
  );
}
