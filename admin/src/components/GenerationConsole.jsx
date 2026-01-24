/**
 * GenerationConsole - Docked console with tabs for stdout and live gallery
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  PlayIcon,
  StopIcon,
  PauseIcon,
  Cross2Icon,
  ChevronUpIcon,
  ChevronDownIcon,
  TrashIcon,
  ImageIcon,
  CodeIcon,
  ExclamationTriangleIcon,
  CheckCircledIcon,
} from '@radix-ui/react-icons';

import { useGeneration } from '../hooks/useGeneration';
import ProgressBar from './ProgressBar';

// Tab types
const TABS = {
  CONSOLE: 'console',
  IMAGES: 'images'
};

export default function GenerationConsole({ minimized = false, onMinimizeChange }) {
  const {
    connected,
    connectionError,
    currentJob,
    pendingJobs,
    paused,
    stats,
    progress,
    stdout,
    clearStdout,
    generatedImages,
    cancelJob,
    cancelAll,
    pause,
    resume
  } = useGeneration();

  const [activeTab, setActiveTab] = useState(TABS.CONSOLE);
  const [expanded, setExpanded] = useState(!minimized);
  const consoleRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll console to bottom
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [stdout, autoScroll]);

  // Handle scroll to detect if user scrolled up
  const handleConsoleScroll = () => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  // Get status indicator
  const statusInfo = useMemo(() => {
    if (!connected) {
      return { color: 'text-parchment-500', label: 'Disconnected', dot: 'bg-parchment-500' };
    }
    if (paused) {
      return { color: 'text-accent-gold', label: 'Paused', dot: 'bg-accent-gold' };
    }
    if (currentJob) {
      return { color: 'text-accent-emerald', label: 'Running', dot: 'bg-accent-emerald animate-pulse' };
    }
    return { color: 'text-parchment-400', label: 'Idle', dot: 'bg-parchment-400' };
  }, [connected, paused, currentJob]);

  // Toggle expanded state
  const toggleExpanded = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    if (onMinimizeChange) {
      onMinimizeChange(!newExpanded);
    }
  };

  // Format image path for display
  const getImageUrl = (imagePath) => {
    // Convert file path to URL
    // Example: frontend/public/assets/sprites/terrain/forest/grass_1.png
    // -> /assets/sprites/terrain/forest/grass_1.png
    if (imagePath.includes('frontend/public')) {
      return imagePath.replace('frontend/public', '');
    }
    // Already a relative path
    if (imagePath.startsWith('/assets')) {
      return imagePath;
    }
    // Try to construct path
    return `/assets/${imagePath.split('assets/').pop() || imagePath}`;
  };

  return (
    <div className="card border-t-2 border-midnight-600">
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-midnight-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <PlayIcon className="w-5 h-5 text-accent-gold" />
          <span className="font-display font-semibold text-parchment-100">
            Generation Console
          </span>
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
            <span className={`text-sm ${statusInfo.color}`}>{statusInfo.label}</span>
          </div>
          {/* Queue count badge */}
          {stats.pendingCount > 0 && (
            <span className="badge badge-warning">
              {stats.pendingCount} queued
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Connection error indicator */}
          {connectionError && (
            <ExclamationTriangleIcon className="w-4 h-4 text-accent-ruby" title={connectionError} />
          )}
          {expanded ? (
            <ChevronDownIcon className="w-5 h-5 text-parchment-400" />
          ) : (
            <ChevronUpIcon className="w-5 h-5 text-parchment-400" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-midnight-700">
          {/* Progress bar (when job is running) */}
          {currentJob && (
            <div className="px-4 py-3 bg-midnight-900/50 border-b border-midnight-700">
              <ProgressBar
                label={`Generating ${currentJob.category}${currentJob.filters?.biome ? ` (${currentJob.filters.biome})` : ''}`}
                current={progress.current}
                total={progress.total}
                steps={progress.steps}
                startedAt={currentJob.startedAt}
                showETA
              />
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-midnight-700 bg-midnight-900/30">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab(TABS.CONSOLE)}
                className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 transition-colors ${
                  activeTab === TABS.CONSOLE
                    ? 'bg-midnight-700 text-parchment-100'
                    : 'text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800'
                }`}
              >
                <CodeIcon className="w-4 h-4" />
                Console
                {stdout.length > 0 && (
                  <span className="text-xs text-parchment-500">({stdout.length})</span>
                )}
              </button>
              <button
                onClick={() => setActiveTab(TABS.IMAGES)}
                className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 transition-colors ${
                  activeTab === TABS.IMAGES
                    ? 'bg-midnight-700 text-parchment-100'
                    : 'text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                Images
                {generatedImages.length > 0 && (
                  <span className="text-xs text-accent-emerald">({generatedImages.length})</span>
                )}
              </button>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              {currentJob && (
                <>
                  <button
                    onClick={() => cancelJob(currentJob.id)}
                    className="p-1.5 text-parchment-400 hover:text-accent-ruby hover:bg-midnight-800 rounded transition-colors"
                    title="Cancel current job"
                  >
                    <StopIcon className="w-4 h-4" />
                  </button>
                  {paused ? (
                    <button
                      onClick={resume}
                      className="p-1.5 text-parchment-400 hover:text-accent-emerald hover:bg-midnight-800 rounded transition-colors"
                      title="Resume queue"
                    >
                      <PlayIcon className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={pause}
                      className="p-1.5 text-parchment-400 hover:text-accent-gold hover:bg-midnight-800 rounded transition-colors"
                      title="Pause queue"
                    >
                      <PauseIcon className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
              {(currentJob || pendingJobs.length > 0) && (
                <button
                  onClick={cancelAll}
                  className="p-1.5 text-parchment-400 hover:text-accent-ruby hover:bg-midnight-800 rounded transition-colors"
                  title="Cancel all jobs"
                >
                  <Cross2Icon className="w-4 h-4" />
                </button>
              )}
              {activeTab === TABS.CONSOLE && stdout.length > 0 && (
                <button
                  onClick={clearStdout}
                  className="p-1.5 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded transition-colors"
                  title="Clear console"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Tab content */}
          <div className="h-64 overflow-hidden">
            {activeTab === TABS.CONSOLE && (
              <div
                ref={consoleRef}
                onScroll={handleConsoleScroll}
                className="h-full overflow-y-auto p-4 font-mono text-sm bg-midnight-950"
              >
                {stdout.length === 0 ? (
                  <div className="text-parchment-500">
                    {currentJob ? (
                      'Waiting for output...'
                    ) : (
                      <>
                        <span className="text-parchment-400">[IDLE]</span> No generation jobs running.
                        <br />
                        <span className="text-parchment-600">
                          Use &quot;Generate All Pending&quot; or navigate to a category to start generation.
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  stdout.map((line, index) => (
                    <div
                      key={index}
                      className={`py-0.5 ${
                        line.type === 'stderr' ? 'text-accent-ruby' : 'text-parchment-300'
                      }`}
                    >
                      <span className="text-parchment-600 text-xs mr-2">
                        {new Date(line.timestamp).toLocaleTimeString()}
                      </span>
                      {line.text}
                    </div>
                  ))
                )}
                {/* Auto-scroll indicator */}
                {!autoScroll && stdout.length > 0 && (
                  <button
                    onClick={() => {
                      setAutoScroll(true);
                      if (consoleRef.current) {
                        consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
                      }
                    }}
                    className="fixed bottom-4 right-4 px-3 py-1 bg-midnight-700 text-parchment-300 text-xs rounded-lg hover:bg-midnight-600 transition-colors"
                  >
                    Scroll to bottom
                  </button>
                )}
              </div>
            )}

            {activeTab === TABS.IMAGES && (
              <div className="h-full overflow-y-auto p-4 bg-midnight-950">
                {generatedImages.length === 0 ? (
                  <div className="text-parchment-500 text-center py-8">
                    <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No images generated yet</p>
                    <p className="text-sm text-parchment-600">
                      Images will appear here as they are generated
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                    {generatedImages.map((image, index) => (
                      <div
                        key={index}
                        className="group relative aspect-square bg-midnight-800 rounded-lg overflow-hidden border border-midnight-700 hover:border-accent-gold/50 transition-colors"
                      >
                        <img
                          src={getImageUrl(image.path)}
                          alt={image.path.split('/').pop()}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                        <div className="hidden items-center justify-center w-full h-full text-parchment-500">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                        {/* Overlay with filename */}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-midnight-950/90 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="text-xs text-parchment-300 truncate">
                            {image.path.split('/').pop()}
                          </p>
                        </div>
                        {/* New badge */}
                        <div className="absolute top-1 right-1">
                          <CheckCircledIcon className="w-4 h-4 text-accent-emerald" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Queue status footer */}
          {pendingJobs.length > 0 && (
            <div className="px-4 py-2 border-t border-midnight-700 bg-midnight-900/30">
              <div className="text-sm text-parchment-400">
                <span className="font-medium">Queue ({pendingJobs.length}):</span>
                {pendingJobs.slice(0, 3).map((job, index) => (
                  <span key={job.id} className="ml-2">
                    {job.category}
                    {job.filters?.biome && ` (${job.filters.biome})`}
                    {index < Math.min(pendingJobs.length, 3) - 1 && ','}
                  </span>
                ))}
                {pendingJobs.length > 3 && (
                  <span className="text-parchment-500"> ... and {pendingJobs.length - 3} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
