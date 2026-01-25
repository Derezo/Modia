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
  ChevronUpIcon,
  ChevronDownIcon,
  PlayIcon,
  PauseIcon,
} from '@radix-ui/react-icons';

import { useUnifiedGeneration } from '../hooks/useUnifiedGeneration';

/**
 * Status indicator for a single queue
 */
function QueueStatus({ icon: Icon, label, isActive, pendingCount, isPaused, progress }) {
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
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-midnight-800/50">
      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
      <Icon className={`w-4 h-4 ${statusColor}`} />
      <span className={`text-sm font-medium ${statusColor}`}>{label}</span>
      <span className="text-xs text-parchment-500">{statusText}</span>
    </div>
  );
}

/**
 * Main UnifiedGenerationBar component
 */
export default function UnifiedGenerationBar({ expanded, onExpandChange }) {
  const {
    connected,
    queueSummary,
    anyActive,
    totalPending,
    stdout,
    generatedAssets
  } = useUnifiedGeneration();

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
            />
            <QueueStatus
              icon={SpeakerLoudIcon}
              label="Music"
              isActive={queueSummary.music.isActive}
              pendingCount={queueSummary.music.pendingCount}
              isPaused={queueSummary.music.isPaused}
              progress={queueSummary.music.progress}
            />
            <QueueStatus
              icon={MixerVerticalIcon}
              label="SFX"
              isActive={queueSummary.sfx.isActive}
              pendingCount={queueSummary.sfx.pendingCount}
              isPaused={queueSummary.sfx.isPaused}
              progress={queueSummary.sfx.progress}
            />
          </div>
        </div>

        {/* Right side: Stats and expand button */}
        <div className="flex items-center gap-4">
          {/* Console/Assets counts */}
          <div className="flex items-center gap-3 text-sm text-parchment-500">
            {stdout.length > 0 && (
              <span>{stdout.length} lines</span>
            )}
            {generatedAssets.length > 0 && (
              <span className="text-accent-emerald">{generatedAssets.length} assets</span>
            )}
          </div>

          {/* Expand/Collapse button */}
          <button
            onClick={() => onExpandChange && onExpandChange(!expanded)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-parchment-300 hover:text-parchment-100 hover:bg-midnight-700 rounded-lg transition-colors"
          >
            {expanded ? (
              <>
                <ChevronDownIcon className="w-4 h-4" />
                Collapse
              </>
            ) : (
              <>
                <ChevronUpIcon className="w-4 h-4" />
                Expand
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
