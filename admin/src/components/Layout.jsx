/**
 * Layout - Main layout component with header and navigation
 */

import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import { useNavigationShortcuts } from '../hooks/useKeyboardShortcuts';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';

export default function Layout() {
  // Enable global navigation shortcuts (1-6 for category tabs)
  useNavigationShortcuts();

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

      {/* Main content */}
      <main className="flex-1 bg-midnight-950">
        <Outlet />
      </main>
    </div>
  );
}
