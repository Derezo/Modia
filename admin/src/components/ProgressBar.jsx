/**
 * ProgressBar - Progress display with step count and ETA
 */

import { useMemo } from 'react';
import { ReloadIcon, ClockIcon } from '@radix-ui/react-icons';
import { formatDurationHuman } from '../utils/timeFormat';

/**
 * Calculate ETA based on progress
 */
function calculateETA(progress, startedAt) {
  if (!progress || !progress.total || progress.current === 0 || !startedAt) {
    return null;
  }

  const elapsed = Date.now() - new Date(startedAt).getTime();
  const avgTimePerItem = elapsed / progress.current;
  const remaining = progress.total - progress.current;
  const etaMs = remaining * avgTimePerItem;

  return etaMs;
}

/**
 * Format ETA duration with fallback for calculating state
 */
function formatETA(ms) {
  if (!ms || ms < 1000) return 'calculating...';
  return formatDurationHuman(ms);
}

export default function ProgressBar({
  label = 'Processing',
  current = 0,
  total = 0,
  steps = null,
  startedAt = null,
  showETA = true,
  className = ''
}) {
  const percentage = useMemo(() => {
    if (!total) return 0;
    return Math.round((current / total) * 100);
  }, [current, total]);

  const stepPercentage = useMemo(() => {
    if (!steps?.total) return 0;
    return Math.round((steps.current / steps.total) * 100);
  }, [steps]);

  const eta = useMemo(() => {
    return calculateETA({ current, total }, startedAt);
  }, [current, total, startedAt]);

  const isIndeterminate = total === 0;

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header with label and counts */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ReloadIcon className="w-4 h-4 text-accent-gold animate-spin" />
          <span className="text-parchment-200 font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {/* Asset progress */}
          {!isIndeterminate && (
            <span className="text-parchment-300">
              {current} / {total}
              <span className="text-parchment-500 ml-1">({percentage}%)</span>
            </span>
          )}
          {/* ETA */}
          {showETA && eta && !isIndeterminate && (
            <span className="flex items-center gap-1 text-parchment-400">
              <ClockIcon className="w-3 h-3" />
              {formatETA(eta)}
            </span>
          )}
        </div>
      </div>

      {/* Main progress bar */}
      <div className="h-2 bg-midnight-800 rounded-full overflow-hidden">
        {isIndeterminate ? (
          <div className="h-full bg-accent-gold/50 animate-indeterminate" />
        ) : (
          <div
            className="h-full bg-accent-gold transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        )}
      </div>

      {/* Step progress (if provided) */}
      {steps && steps.total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-parchment-500">Current asset steps</span>
            <span className="text-parchment-400">
              {steps.current} / {steps.total} steps
            </span>
          </div>
          <div className="h-1 bg-midnight-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-emerald/70 transition-all duration-300"
              style={{ width: `${stepPercentage}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// CSS for indeterminate animation (add to index.css)
// .animate-indeterminate {
//   width: 30%;
//   animation: indeterminate 1.5s infinite ease-in-out;
// }
// @keyframes indeterminate {
//   0% { transform: translateX(-100%); }
//   100% { transform: translateX(400%); }
// }
