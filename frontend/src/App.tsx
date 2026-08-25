// App shell: fixed TopBar / scrollable main / StatusBar, flat route table.

import { Navigate, Route, Routes } from 'react-router-dom';
import StatusBar from './components/layout/StatusBar';
import TopBar from './components/layout/TopBar';
import ActualsPage from './pages/ActualsPage';
import AnalysisPage from './pages/AnalysisPage';
import CollateralPage from './pages/CollateralPage';
import DealsPage from './pages/DealsPage';
import ExportsPage from './pages/ExportsPage';
import MonitorPage from './pages/MonitorPage';
import PortfoliosPage from './pages/PortfoliosPage';
import ResultsPage from './pages/ResultsPage';
import ScenariosPage from './pages/ScenariosPage';
import StructurePage from './pages/StructurePage';

export default function App() {
  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<DealsPage />} />
          <Route path="/collateral" element={<CollateralPage />} />
          <Route path="/structure" element={<StructurePage />} />
          <Route path="/actuals" element={<ActualsPage />} />
          <Route path="/monitor" element={<MonitorPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/exports" element={<ExportsPage />} />
          <Route path="/portfolios" element={<PortfoliosPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <StatusBar />
    </div>
  );
}
