/**
 * GenerationNotificationPanel - Slide-out panel for generation status
 *
 * Shows current generation job progress, recently generated images,
 * and queue status. Can be minimized to a small badge.
 */

import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Cross2Icon,
  ReloadIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  ImageIcon,
  CheckCircledIcon,
  MinusIcon,
} from '@radix-ui/react-icons';

import { useGenerationContext } from '../contexts/GenerationContext';

/**
 * Progress bar component
 */
function ProgressBar({ current, total, label }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-parchment-400">
        <span>{label}</span>
        <span>{current} / {total} ({percent}%)</span>
      </div>
      <div className="h-2 bg-midnight-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-gold transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Generated image thumbnail
 */
function ImageThumbnail({ image }) {
  const [hasError, setHasError] = useState(false);
  // Extract filename from path
  const filename = image.path?.split('/').pop() || 'unknown';

  return (
    <div
      className="w-12 h-12 bg-midnight-800 border border-midnight-700 rounded-lg
                 flex items-center justify-center text-parchment-500 overflow-hidden"
      title={filename}
    >
      {hasError ? (
        <ImageIcon className="w-6 h-6" />
      ) : (
        <img
          src={image.path}
          alt={filename}
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />
      )}
    </div>
  );
}

/**
 * Minimized badge shown when panel is collapsed
 */
export function GenerationBadge() {
  const { isProcessing, currentProgress, pendingCount, toggleMinimize } = useGenerationContext();

  if (!isProcessing && pendingCount === 0) return null;

  const current = currentProgress?.current || 0;
  const total = currentProgress?.total || 0;

  return (
    <button
      onClick={toggleMinimize}
      className="fixed bottom-6 right-6 z-[90] flex items-center gap-2 px-4 py-2
                 bg-midnight-800 border border-midnight-700 rounded-lg shadow-lg
                 hover:bg-midnight-700 transition-colors"
    >
      {isProcessing ? (
        <>
          <ReloadIcon className="w-4 h-4 text-accent-gold animate-spin" />
          <span className="text-sm text-parchment-200">
            {total > 0 ? `${current}/${total}` : 'Processing...'}
          </span>
        </>
      ) : pendingCount > 0 ? (
        <>
          <span className="w-2 h-2 bg-accent-gold rounded-full" />
          <span className="text-sm text-parchment-200">
            {pendingCount} pending
          </span>
        </>
      ) : null}
    </button>
  );
}

/**
 * Main notification panel component
 */
export default function GenerationNotificationPanel() {
  const {
    // State
    currentJob,
    pendingJobs,
    paused,
    isProcessing,
    currentProgress,
    eta,
    generatedImages,
    connected,

    // Panel controls
    panelOpen,
    closePanel,

    // Actions
    pause,
    resume,
    cancelJob,
    cancelAll,
  } = useGenerationContext();

  // Recent images (last 8)
  const recentImages = useMemo(() =>
    (generatedImages || []).slice(-8).reverse(),
    [generatedImages]
  );

  if (!panelOpen) return null;

  return (
    <Dialog.Root open={panelOpen} onOpenChange={(open) => !open && closePanel()}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[80]" />

        {/* Panel */}
        <Dialog.Content
          aria-describedby="generation-panel-description"
          className="fixed top-0 right-0 h-full w-full max-w-md
                     bg-midnight-900 border-l border-midnight-700 shadow-xl z-[90]
                     flex flex-col focus:outline-none
                     data-[state=open]:animate-slideInRight
                     data-[state=closed]:animate-slideOutRight"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-midnight-700">
            <div className="flex items-center gap-3">
              <Dialog.Title className="text-lg font-display font-semibold text-parchment-100">
                Generation Status
              </Dialog.Title>
              {connected ? (
                <span className="w-2 h-2 bg-accent-emerald rounded-full" title="Connected" />
              ) : (
                <span className="w-2 h-2 bg-accent-ruby rounded-full" title="Disconnected" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={closePanel}
                className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg"
                aria-label="Minimize panel"
              >
                <MinusIcon className="w-5 h-5" />
              </button>
              <Dialog.Close asChild>
                <button
                  className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg"
                  aria-label="Close panel"
                >
                  <Cross2Icon className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <p id="generation-panel-description" className="sr-only">
              Shows current image generation progress and recently generated images.
            </p>

            {/* Current Job */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-parchment-300 uppercase tracking-wide">
                Current Job
              </h3>

              {currentJob ? (
                <div className="p-4 bg-midnight-800/50 border border-midnight-700 rounded-lg space-y-4">
                  {/* Job info */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-parchment-100 font-medium capitalize">
                        {currentJob.category}
                      </p>
                      <p className="text-sm text-parchment-500">
                        ID: {currentJob.id?.slice(0, 8)}...
                      </p>
                    </div>
                    {isProcessing ? (
                      <ReloadIcon className="w-5 h-5 text-accent-gold animate-spin" />
                    ) : paused ? (
                      <PauseIcon className="w-5 h-5 text-accent-gold" />
                    ) : (
                      <CheckCircledIcon className="w-5 h-5 text-accent-emerald" />
                    )}
                  </div>

                  {/* Progress */}
                  {currentProgress && currentProgress.total > 0 && (
                    <ProgressBar
                      current={currentProgress.current}
                      total={currentProgress.total}
                      label="Assets"
                    />
                  )}

                  {/* ETA */}
                  {eta && isProcessing && (
                    <p className="text-xs text-parchment-500">
                      ETA: {eta.formatted}
                    </p>
                  )}

                  {/* Controls */}
                  <div className="flex gap-2">
                    {paused ? (
                      <button
                        onClick={resume}
                        className="btn-ghost text-sm flex items-center gap-1"
                      >
                        <PlayIcon className="w-4 h-4" />
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={pause}
                        className="btn-ghost text-sm flex items-center gap-1"
                      >
                        <PauseIcon className="w-4 h-4" />
                        Pause
                      </button>
                    )}
                    <button
                      onClick={() => cancelJob(currentJob.id)}
                      className="btn-ghost text-sm flex items-center gap-1 text-accent-ruby hover:text-accent-ruby"
                    >
                      <StopIcon className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-midnight-800/50 border border-midnight-700 rounded-lg text-center text-parchment-500">
                  No active job
                </div>
              )}
            </div>

            {/* Queue */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-parchment-300 uppercase tracking-wide">
                  Queue
                </h3>
                {pendingJobs.length > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-accent-gold/20 text-accent-gold rounded">
                    {pendingJobs.length} pending
                  </span>
                )}
              </div>

              {pendingJobs.length > 0 ? (
                <div className="space-y-2">
                  {pendingJobs.slice(0, 5).map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 bg-midnight-800/50 border border-midnight-700 rounded-lg"
                    >
                      <span className="text-sm text-parchment-300 capitalize">
                        {job.category}
                      </span>
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="text-parchment-500 hover:text-accent-ruby transition-colors"
                        aria-label="Cancel job"
                      >
                        <Cross2Icon className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {pendingJobs.length > 5 && (
                    <p className="text-xs text-parchment-500 text-center">
                      +{pendingJobs.length - 5} more
                    </p>
                  )}
                  <button
                    onClick={cancelAll}
                    className="w-full btn-ghost text-sm text-accent-ruby hover:text-accent-ruby"
                  >
                    Cancel All
                  </button>
                </div>
              ) : (
                <p className="text-sm text-parchment-500">Queue is empty</p>
              )}
            </div>

            {/* Recent Images */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-parchment-300 uppercase tracking-wide">
                Recent Images
              </h3>

              {recentImages.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {recentImages.map((img) => (
                    <ImageThumbnail key={img.path || img.timestamp} image={img} />
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-midnight-800/50 border border-midnight-700 rounded-lg text-center">
                  <ImageIcon className="w-8 h-8 mx-auto mb-2 text-parchment-600" />
                  <p className="text-sm text-parchment-500">No images generated yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-midnight-700 text-xs text-parchment-600 text-center">
            {connected ? 'Real-time updates via WebSocket' : 'Reconnecting...'}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
