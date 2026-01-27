/**
 * UnifiedGenerationBar - Persistent bottom status bar showing all three queue states
 *
 * Displays:
 * - Images queue status
 * - Music queue status
 * - SFX queue status
 * - Expand button to show full panel
 */

import { useMemo } from 'react';
import {
  ImageIcon,
  SpeakerLoudIcon,
  MixerVerticalIcon,
  ChevronDownIcon,
  PlayIcon,
  PauseIcon,
  ListBulletIcon,
  CodeIcon,
} from '@radix-ui/react-icons';

import { useGenerationContext } from '../contexts/GenerationContext';

/**
 * Status indicator for a single queue - clickable to filter console
 */
function QueueStatus({ icon: Icon, label, isActive, pendingCount, isPaused, progress, onClick }) {
  // Determine status color
  const statusColor = useMemo(() => {
    if (!isActive && pendingCount === 0) return 'text-parchment-500'; // Idle
    if (isPaused) return 'text-accent-gold'; // Paused
    if (isActive) return 'text-accent-emerald'; // Running
    return 'text-parchment-400'; // Has pending
  }, [isActive, pendingCount, isPaused]);

  const dotColor = useMemo(() => {
    if (!isActive && pendingCount === 0) return 'bg-parchment-500'; // Idle
    if (isPaused) return 'bg-accent-gold'; // Paused
    if (isActive) return 'bg-accent-emerald animate-pulse'; // Running
    return 'bg-accent-gold'; // Has pending
  }, [isActive, pendingCount, isPaused]);

  // Format status text
  const statusText = useMemo(() => {
    if (!isActive && pendingCount === 0) return 'Idle';
    if (isPaused) return 'Paused';
    if (isActive && progress) {
      const current = progress.current || 0;
      const total = progress.total || 0;
      if (total > 0) {
        return `${current}/${total}`;
      }
    }
    if (isActive) return 'Running';
    return `${pendingCount} pending`;
  }, [isActive, pendingCount, isPaused, progress]);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-midnight-800/50 hover:bg-midnight-700/50 transition-colors"
    >
      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
      <Icon className={`w-4 h-4 ${statusColor}`} />
      <span className={`text-sm font-medium ${statusColor}`}>{label}</span>
      <span className="text-xs text-parchment-500">{statusText}</span>
    </button>
  );
}

/**
 * Main UnifiedGenerationBar component
 */
export default function UnifiedGenerationBar({ expanded, onExpandChange, queueCount = 0, activePanel, onPanelChange, onBadgeClick }) {
  const { unified } = useGenerationContext();
  const {
    connected,
    queueSummary,
    anyActive,
    totalPending,
    stdout,
    generatedAssets
  } = unified;

  // Overall status for the bar
  const overallStatus = useMemo(() => {
    if (!connected) return { color: 'text-parchment-500', label: 'Disconnected' };
    if (anyActive) return { color: 'text-accent-emerald', label: 'Generating' };
    if (totalPending > 0) return { color: 'text-accent-gold', label: `${totalPending} Pending` };
    return { color: 'text-parchment-400', label: 'Idle' };
  }, [connected, anyActive, totalPending]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-midnight-900 border-t border-midnight-700 shadow-lg">
      {/* Main bar */}
      <div className="px-4 py-2 flex items-center justify-between">
        {/* Left side: Queue statuses */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 mr-4">
            {anyActive ? (
              <PlayIcon className="w-4 h-4 text-accent-emerald animate-pulse" />
            ) : (
              <PauseIcon className="w-4 h-4 text-parchment-500" />
            )}
            <span className={`text-sm font-semibold ${overallStatus.color}`}>
              {overallStatus.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <QueueStatus
              icon={ImageIcon}
              label="Images"
              isActive={queueSummary.images.isActive}
              pendingCount={queueSummary.images.pendingCount}
              isPaused={queueSummary.images.isPaused}
              progress={queueSummary.images.progress}
              onClick={() => onBadgeClick?.('images')}
            />
            <QueueStatus
              icon={SpeakerLoudIcon}
              label="Music"
              isActive={queueSummary.music.isActive}
              pendingCount={queueSummary.music.pendingCount}
              isPaused={queueSummary.music.isPaused}
              progress={queueSummary.music.progress}
              onClick={() => onBadgeClick?.('music')}
            />
            <QueueStatus
              icon={MixerVerticalIcon}
              label="SFX"
              isActive={queueSummary.sfx.isActive}
              pendingCount={queueSummary.sfx.pendingCount}
              isPaused={queueSummary.sfx.isPaused}
              progress={queueSummary.sfx.progress}
              onClick={() => onBadgeClick?.('sfx')}
            />
          </div>
        </div>

        {/* Right side: Panel tabs and collapse */}
        <div className="flex items-center gap-2">
          {/* Panel tab buttons */}
          <div className="flex items-center bg-midnight-800 rounded-lg p-0.5">
            <button
              onClick={() => {
                onPanelChange?.('queue');
                if (!expanded) onExpandChange?.(true);
              }}
              className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition-colors ${
                expanded && activePanel === 'queue'
                  ? 'bg-midnight-600 text-parchment-100'
                  : 'text-parchment-400 hover:text-parchment-200 hover:bg-midnight-700'
              }`}
            >
              <ListBulletIcon className="w-3.5 h-3.5" />
              Queue
              {queueCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-accent-gold/20 text-accent-gold rounded">
                  {queueCount}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                onPanelChange?.('console');
                if (!expanded) onExpandChange?.(true);
              }}
              className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition-colors ${
                expanded && activePanel === 'console'
                  ? 'bg-midnight-600 text-parchment-100'
                  : 'text-parchment-400 hover:text-parchment-200 hover:bg-midnight-700'
              }`}
            >
              <CodeIcon className="w-3.5 h-3.5" />
              Console
              {stdout.length > 0 && (
                <span className="text-xs text-parchment-500">({stdout.length})</span>
              )}
            </button>
            <button
              onClick={() => {
                onPanelChange?.('assets');
                if (!expanded) onExpandChange?.(true);
              }}
              className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition-colors ${
                expanded && activePanel === 'assets'
                  ? 'bg-midnight-600 text-parchment-100'
                  : 'text-parchment-400 hover:text-parchment-200 hover:bg-midnight-700'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Assets
              {generatedAssets.length > 0 && (
                <span className="text-xs text-accent-emerald">({generatedAssets.length})</span>
              )}
            </button>
          </div>

          {/* Collapse button - only visible when expanded */}
          {expanded && (
            <button
              onClick={() => onExpandChange?.(false)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-parchment-300 hover:text-parchment-100 hover:bg-midnight-700 rounded-lg transition-colors"
            >
              <ChevronDownIcon className="w-4 h-4" />
              Collapse
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
