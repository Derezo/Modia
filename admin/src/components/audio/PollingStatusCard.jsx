/**
 * PollingStatusCard - Status display for pending Suno generation tasks
 * Shows spinner, task ID, status text, and elapsed time.
 *
 * @module PollingStatusCard
 * @description Displays generation progress for audio tracks being processed by Suno API.
 */

import { useState, useEffect, useMemo } from 'react';
import { ReloadIcon, ClockIcon, InfoCircledIcon } from '@radix-ui/react-icons';

/**
 * Format elapsed time in human readable format
 */
function formatElapsedTime(startTime) {
  if (!startTime) return '--';

  const elapsed = Date.now() - new Date(startTime).getTime();
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get status color based on Suno task status
 */
function getStatusColor(status) {
  switch (status?.toLowerCase()) {
    case 'complete':
    case 'completed':
      return 'text-accent-emerald';
    case 'processing':
    case 'pending':
    case 'queued':
      return 'text-accent-gold';
    case 'error':
    case 'failed':
      return 'text-accent-ruby';
    default:
      return 'text-parchment-400';
  }
}

/**
 * PollingStatusCard component for generation progress display
 *
 * @param {Object} props - Component props
 * @param {string} props.taskId - Suno task ID
 * @param {string} props.status - Current task status (pending, processing, complete, error)
 * @param {string} [props.statusMessage] - Optional detailed status message
 * @param {string|Date} [props.startedAt] - Timestamp when generation started
 * @param {string} [props.trackKey] - Audio track key/identifier
 * @param {string} [props.className] - Additional CSS classes
 */
export default function PollingStatusCard({
  taskId,
  status = 'pending',
  statusMessage,
  startedAt,
  trackKey,
  className = '',
}) {
  const [elapsedTime, setElapsedTime] = useState('--');

  // Update elapsed time every second while processing
  useEffect(() => {
    if (!startedAt || status === 'complete' || status === 'error') {
      setElapsedTime(formatElapsedTime(startedAt));
      return;
    }

    // Initial update
    setElapsedTime(formatElapsedTime(startedAt));

    // Update every second
    const interval = setInterval(() => {
      setElapsedTime(formatElapsedTime(startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt, status]);

  const isProcessing = status === 'pending' || status === 'processing' || status === 'queued';
  const statusColor = useMemo(() => getStatusColor(status), [status]);

  return (
    <div className={`card p-4 ${className}`}>
      {/* Header with spinner */}
      <div className="flex items-center gap-3 mb-3">
        {isProcessing ? (
          <div className="w-8 h-8 rounded-full bg-accent-gold/10 flex items-center justify-center">
            <ReloadIcon className="w-4 h-4 text-accent-gold animate-spin" />
          </div>
        ) : (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            status === 'complete' ? 'bg-accent-emerald/10' : 'bg-accent-ruby/10'
          }`}>
            <InfoCircledIcon className={`w-4 h-4 ${statusColor}`} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-parchment-200 truncate">
            {trackKey || 'Generating Audio...'}
          </h4>
          <p className={`text-xs ${statusColor} capitalize`}>
            {statusMessage || status}
          </p>
        </div>
      </div>

      {/* Task details */}
      <div className="space-y-2 text-xs">
        {/* Task ID */}
        <div className="flex items-center justify-between">
          <span className="text-parchment-500">Task ID</span>
          <code className="text-parchment-400 font-mono bg-midnight-800 px-2 py-0.5 rounded truncate max-w-[180px]">
            {taskId || '--'}
          </code>
        </div>

        {/* Elapsed time */}
        <div className="flex items-center justify-between">
          <span className="text-parchment-500 flex items-center gap-1">
            <ClockIcon className="w-3 h-3" />
            Elapsed
          </span>
          <span className="text-parchment-300 font-mono">
            {elapsedTime}
          </span>
        </div>
      </div>

      {/* Processing indicator bar */}
      {isProcessing && (
        <div className="mt-3 h-1 bg-midnight-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-gold/50 rounded-full animate-pulse"
            style={{
              animation: 'progress-indeterminate 1.5s ease-in-out infinite',
            }}
          />
        </div>
      )}

      {/* Inline keyframes for indeterminate progress */}
      <style>{`
        @keyframes progress-indeterminate {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 50%; margin-left: 25%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}
