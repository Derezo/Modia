/**
 * Layout - Main layout component with header, navigation, and unified generation panel
 */

import { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import { useNavigationShortcuts } from '../hooks/useKeyboardShortcuts';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';
import UnifiedGenerationBar from './UnifiedGenerationBar';
import UnifiedAssetPanel from './UnifiedAssetPanel';
import { useRegenerationQueue } from '../hooks/useRegenerationQueue';

export default function Layout() {
  // Enable global navigation shortcuts (1-6 for category tabs)
  useNavigationShortcuts();

  // Track whether the unified panel is expanded
  const [panelExpanded, setPanelExpanded] = useState(false);

  // Track active panel (queue, console, assets)
  const [activePanel, setActivePanel] = useState('console');

  // Regeneration queue state (hook fetches on mount automatically)
  const {
    queue,
    totalCount: queueCount,
    fetchQueue,
  } = useRegenerationQueue();

  // Open the queue panel
  const handleOpenQueue = useCallback(() => {
    setActivePanel('queue');
    setPanelExpanded(true);
  }, []);

  // Handle panel change
  const handlePanelChange = useCallback((panel) => {
    setActivePanel(panel);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-midnight-900 border-b border-midnight-700">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-display font-bold text-accent-gold">
              Modia
            </h1>
            <span className="text-parchment-400 text-sm">Asset Manager</span>
          </div>
          <div className="flex items-center gap-4">
            <KeyboardShortcutsHelp />
            <span className="badge badge-warning">Development Only</span>
          </div>
        </div>

        {/* Navigation tabs */}
        <Navbar />
      </header>

      {/* Main content - add padding at bottom for the generation bar */}
      <main className="flex-1 bg-midnight-950 pb-12">
        <Outlet />
      </main>

      {/* Unified Generation Panel (expanded view) */}
      {panelExpanded && (
        <UnifiedAssetPanel
          onClose={() => setPanelExpanded(false)}
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          queueData={queue}
          queueTotalCount={queueCount}
          onRefreshQueue={fetchQueue}
        />
      )}

      {/* Unified Generation Bar (always visible at bottom) */}
      <UnifiedGenerationBar
        expanded={panelExpanded}
        onExpandChange={setPanelExpanded}
        queueCount={queueCount}
        onOpenQueue={handleOpenQueue}
      />
    </div>
  );
}
