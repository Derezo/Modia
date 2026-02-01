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
import { useGenerationContext } from '../contexts/GenerationContext';

export default function Layout() {
  // Enable global navigation shortcuts (1-6 for category tabs)
  useNavigationShortcuts();

  // Get resume function from generation context
  const { resume } = useGenerationContext();

  // Track whether the unified panel is expanded
  const [panelExpanded, setPanelExpanded] = useState(false);

  // Track active panel (queue, console, assets)
  const [activePanel, setActivePanel] = useState('console');

  // Track source filter for console/assets panels
  const [sourceFilter, setSourceFilter] = useState('all');

  // Regeneration queue state for badge count (hook fetches on mount)
  // Note: UnifiedAssetPanel uses its own hook for fresh panel data
  const {
    totalCount: queueCount,
    fetchQueue,
  } = useRegenerationQueue();

  // Handle panel change - also expand if collapsed
  const handlePanelChange = useCallback((panel) => {
    setActivePanel(panel);
    if (!panelExpanded) setPanelExpanded(true);
  }, [panelExpanded]);

  // Handle badge click - toggle source filter (click same = reset to 'all')
  const handleBadgeClick = useCallback((sourceType) => {
    setSourceFilter(prev => prev === sourceType ? 'all' : sourceType);
    if (!panelExpanded) setPanelExpanded(true);
  }, [panelExpanded]);

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

      {/* Main content - add padding at bottom for the generation bar (and panel when expanded) */}
      <main className={`flex-1 bg-midnight-950 ${panelExpanded ? 'pb-96' : 'pb-16'}`}>
        <Outlet />
      </main>

      {/* Unified Generation Panel (expanded view) */}
      {panelExpanded && (
        <UnifiedAssetPanel
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          onRefreshQueue={fetchQueue}
          initialSourceFilter={sourceFilter}
        />
      )}

      {/* Unified Generation Bar (always visible at bottom) */}
      <UnifiedGenerationBar
        expanded={panelExpanded}
        onExpandChange={setPanelExpanded}
        queueCount={queueCount}
        activePanel={activePanel}
        onPanelChange={handlePanelChange}
        onBadgeClick={handleBadgeClick}
        sourceFilter={sourceFilter}
        onResumeAll={resume}
      />
    </div>
  );
}
