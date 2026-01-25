/**
 * UnifiedAssetPanel - Split panel showing console output and generated assets
 *
 * Layout:
 * - Left side (40%): Console output with source filters
 * - Right side (60%): Generated assets grid with preview cards
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  TrashIcon,
  ImageIcon,
  SpeakerLoudIcon,
  MixerVerticalIcon,
  CodeIcon,
  Cross2Icon,
  StopIcon,
  PauseIcon,
  PlayIcon,
} from '@radix-ui/react-icons';

import { useUnifiedGeneration } from '../hooks/useUnifiedGeneration';
import AssetPreviewCard from './AssetPreviewCard';
import ProgressBar from './ProgressBar';

// Source filter options
const SOURCE_FILTERS = [
  { value: 'all', label: 'All', icon: null },
  { value: 'images', label: 'Images', icon: ImageIcon },
  { value: 'music', label: 'Music', icon: SpeakerLoudIcon },
  { value: 'sfx', label: 'SFX', icon: MixerVerticalIcon },
];

// Source color mapping
const SOURCE_COLORS = {
  images: 'text-blue-400',
  music: 'text-purple-400',
  sfx: 'text-orange-400',
};

const SOURCE_TAGS = {
  images: '[IMG]',
  music: '[MUS]',
  sfx: '[SFX]',
};

/**
 * Console output panel with source filtering
 */
function ConsolePanel({ stdout, clearStdout, sourceFilter, onSourceFilterChange }) {
  const consoleRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Filter stdout by source
  const filteredStdout = useMemo(() => {
    if (sourceFilter === 'all') return stdout;
    return stdout.filter(entry => entry.source === sourceFilter);
  }, [stdout, sourceFilter]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [filteredStdout, autoScroll]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Console header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-midnight-700 bg-midnight-900/50">
        <div className="flex items-center gap-2">
          <CodeIcon className="w-4 h-4 text-parchment-400" />
          <span className="text-sm font-medium text-parchment-200">Console</span>
          <span className="text-xs text-parchment-500">({filteredStdout.length})</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Source filter dropdown */}
          <select
            value={sourceFilter}
            onChange={(e) => onSourceFilterChange(e.target.value)}
            className="text-xs bg-midnight-800 border border-midnight-600 rounded px-2 py-1 text-parchment-300"
          >
            {SOURCE_FILTERS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {/* Clear button */}
          {stdout.length > 0 && (
            <button
              onClick={clearStdout}
              className="p-1 text-parchment-500 hover:text-parchment-300 hover:bg-midnight-700 rounded transition-colors"
              title="Clear console"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Console output */}
      <div
        ref={consoleRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs bg-midnight-950"
      >
        {filteredStdout.length === 0 ? (
          <div className="text-parchment-600">
            No output yet. Start a generation job to see output here.
          </div>
        ) : (
          filteredStdout.map((entry, index) => (
            <div
              key={index}
              className={`py-0.5 ${entry.lineType === 'stderr' ? 'text-accent-ruby' : 'text-parchment-300'}`}
            >
              <span className="text-parchment-600 mr-2">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={`mr-2 ${SOURCE_COLORS[entry.source] || 'text-parchment-400'}`}>
                {SOURCE_TAGS[entry.source] || '[???]'}
              </span>
              {entry.line}
            </div>
          ))
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && filteredStdout.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (consoleRef.current) {
              consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-midnight-700 text-parchment-300 text-xs rounded-lg hover:bg-midnight-600 transition-colors"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

/**
 * Assets grid panel with previews
 */
function AssetsPanel({ generatedAssets, clearGeneratedAssets, sourceFilter, onSourceFilterChange }) {
  // Filter assets by source/type
  const filteredAssets = useMemo(() => {
    if (sourceFilter === 'all') return generatedAssets;
    // Map source filter to asset type
    const typeMap = { images: 'image', music: 'music', sfx: 'sfx' };
    const targetType = typeMap[sourceFilter];
    return generatedAssets.filter(asset => asset.type === targetType);
  }, [generatedAssets, sourceFilter]);

  return (
    <div className="flex flex-col h-full">
      {/* Assets header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-midnight-700 bg-midnight-900/50">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-parchment-400" />
          <span className="text-sm font-medium text-parchment-200">Generated Assets</span>
          <span className="text-xs text-accent-emerald">({filteredAssets.length})</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Source filter dropdown */}
          <select
            value={sourceFilter}
            onChange={(e) => onSourceFilterChange(e.target.value)}
            className="text-xs bg-midnight-800 border border-midnight-600 rounded px-2 py-1 text-parchment-300"
          >
            {SOURCE_FILTERS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {/* Clear button */}
          {generatedAssets.length > 0 && (
            <button
              onClick={clearGeneratedAssets}
              className="p-1 text-parchment-500 hover:text-parchment-300 hover:bg-midnight-700 rounded transition-colors"
              title="Clear assets"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Assets grid */}
      <div className="flex-1 overflow-y-auto p-3 bg-midnight-950">
        {filteredAssets.length === 0 ? (
          <div className="text-center text-parchment-600 py-8">
            <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No assets generated yet</p>
            <p className="text-xs mt-1">Assets will appear here as they are generated</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredAssets.map((asset, index) => (
              <AssetPreviewCard key={`${asset.path}-${index}`} asset={asset} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Main UnifiedAssetPanel component
 */
export default function UnifiedAssetPanel({ onClose }) {
  const {
    queues,
    stdout,
    clearStdout,
    generatedAssets,
    clearGeneratedAssets,
    cancelJob,
    pauseQueue,
    resumeQueue,
  } = useUnifiedGeneration();

  const [consoleFilter, setConsoleFilter] = useState('all');
  const [assetsFilter, setAssetsFilter] = useState('all');

  // Get current active job for progress display
  const activeJob = useMemo(() => {
    if (queues.images.current) return { source: 'images', job: queues.images.current };
    if (queues.music.current) return { source: 'music', job: queues.music.current };
    if (queues.sfx.current) return { source: 'sfx', job: queues.sfx.current };
    return null;
  }, [queues]);

  // Get progress for active job
  const activeProgress = useMemo(() => {
    if (!activeJob) return null;
    return queues[activeJob.source].progress;
  }, [activeJob, queues]);

  return (
    <div className="fixed bottom-12 left-0 right-0 h-80 bg-midnight-900 border-t border-midnight-700 shadow-2xl z-40">
      {/* Progress bar (when job is running) */}
      {activeJob && activeProgress && (
        <div className="px-4 py-2 bg-midnight-850 border-b border-midnight-700">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <ProgressBar
                label={`Generating ${activeJob.source}${activeJob.job.category ? ` (${activeJob.job.category})` : ''}`}
                current={activeProgress.current || 0}
                total={activeProgress.total || 0}
                showETA={!!activeJob.job.startedAt}
                startedAt={activeJob.job.startedAt}
              />
            </div>

            {/* Job controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => cancelJob(activeJob.source, activeJob.job.id)}
                className="p-1.5 text-parchment-400 hover:text-accent-ruby hover:bg-midnight-700 rounded transition-colors"
                title="Cancel current job"
              >
                <StopIcon className="w-4 h-4" />
              </button>

              {queues[activeJob.source].paused ? (
                <button
                  onClick={() => resumeQueue(activeJob.source)}
                  className="p-1.5 text-parchment-400 hover:text-accent-emerald hover:bg-midnight-700 rounded transition-colors"
                  title="Resume queue"
                >
                  <PlayIcon className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => pauseQueue(activeJob.source)}
                  className="p-1.5 text-parchment-400 hover:text-accent-gold hover:bg-midnight-700 rounded transition-colors"
                  title="Pause queue"
                >
                  <PauseIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Split panel */}
      <div className="flex h-full" style={{ height: activeJob && activeProgress ? 'calc(100% - 48px)' : '100%' }}>
        {/* Left side: Console (40%) */}
        <div className="w-2/5 border-r border-midnight-700 relative">
          <ConsolePanel
            stdout={stdout}
            clearStdout={clearStdout}
            sourceFilter={consoleFilter}
            onSourceFilterChange={setConsoleFilter}
          />
        </div>

        {/* Right side: Assets (60%) */}
        <div className="w-3/5">
          <AssetsPanel
            generatedAssets={generatedAssets}
            clearGeneratedAssets={clearGeneratedAssets}
            sourceFilter={assetsFilter}
            onSourceFilterChange={setAssetsFilter}
          />
        </div>
      </div>

      {/* Close button (optional) */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-1 text-parchment-500 hover:text-parchment-300 hover:bg-midnight-700 rounded transition-colors"
          title="Close panel"
        >
          <Cross2Icon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
