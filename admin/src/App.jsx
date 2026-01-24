/**
 * App - Main application component with routing
 */

import { Routes, Route } from 'react-router-dom';

import { ToastProvider } from './contexts/ToastContext';
import { GenerationProvider } from './contexts/GenerationContext';
import Layout from './components/Layout';
import GenerationNotificationPanel, { GenerationBadge } from './components/GenerationNotificationPanel';
import Dashboard from './pages/Dashboard';
import TilesPage from './pages/TilesPage';
import PortraitsPage from './pages/PortraitsPage';
import ItemsPage from './pages/ItemsPage';
import IconsPage from './pages/IconsPage';
import NodesPage from './pages/NodesPage';
import OverlaysPage from './pages/OverlaysPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <ToastProvider>
      <GenerationProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="tiles" element={<TilesPage />} />
            <Route path="portraits" element={<PortraitsPage />} />
            <Route path="items" element={<ItemsPage />} />
            <Route path="icons" element={<IconsPage />} />
            <Route path="nodes" element={<NodesPage />} />
            <Route path="overlays" element={<OverlaysPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>

        {/* Global generation status UI */}
        <GenerationBadge />
        <GenerationNotificationPanel />
      </GenerationProvider>
    </ToastProvider>
  );
}
