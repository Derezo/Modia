/**
 * UnifiedAssetPanel - Tabbed panel showing queue, console output, and generated assets
 *
 * Tabs:
 * - Queue: Items marked for regeneration, grouped by category
 * - Console: Real-time stdout from generation processes
 * - Assets: Recently generated assets grid
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  TrashIcon,
  ImageIcon,
  SpeakerLoudIcon,
  CodeIcon,
  Cross2Icon,
  StopIcon,
  PauseIcon,
  PlayIcon,
  ListBulletIcon,
  RocketIcon,
} from '@radix-ui/react-icons';

import { useGenerationContext } from '../contexts/GenerationContext';
import { useRegenerationQueue } from '../hooks/useRegenerationQueue';
import AssetPreviewCard from './AssetPreviewCard';
import ProgressBar from './ProgressBar';
import {
  IMAGE_CATEGORIES,
  AUDIO_CATEGORIES,
  getCategoryLabel,
} from '../constants/categories';

// Panel tabs
const PANEL_TABS = {
  QUEUE: 'queue',
  CONSOLE: 'console',
  ASSETS: 'assets',
};

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
 * Queue panel showing items marked for regeneration
 */
function QueuePanel({
  queue,
  totalCount,
  loading,
  onRemoveItem,
  onClearCategory,
  onClearAll,
  onStartGeneration,
}) {
  // Group queue items by source type (images vs audio)
  const groupedQueue = useMemo(() => {
    const images = {};
    const audio = {};

    for (const [category, items] of Object.entries(queue)) {
      if (IMAGE_CATEGORIES.includes(category)) {
        images[category] = items;
      } else if (AUDIO_CATEGORIES.includes(category)) {
        audio[category] = items;
      } else {
        // Handle unknown categories - warn and add to images as fallback
        if (import.meta.env.DEV) {
          console.warn(`[QueuePanel] Unknown category "${category}" - adding to images group`);
        }
        images[category] = items;
      }
    }

    return { images, audio };
  }, [queue]);

  const imageCount = useMemo(() => {
    return Object.values(groupedQueue.images).reduce((sum, items) => sum + items.length, 0);
  }, [groupedQueue.images]);

  const audioCount = useMemo(() => {
    return Object.values(groupedQueue.audio).reduce((sum, items) => sum + items.length, 0);
  }, [groupedQueue.audio]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-parchment-500">
        <div className="animate-spin mr-2">
          <RocketIcon className="w-5 h-5" />
        </div>
        Loading queue...
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-parchment-500">
        <ListBulletIcon className="w-10 h-10 mb-3 opacity-50" />
        <p className="text-lg font-medium">Queue is empty</p>
        <p className="text-sm mt-1">Mark assets for regeneration to add them here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Queue header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-midnight-700 bg-midnight-900/50">
        <div className="flex items-center gap-3">
          <ListBulletIcon className="w-5 h-5 text-accent-gold" />
          <span className="font-medium text-parchment-100">Regeneration Queue</span>
          <span className="text-sm text-parchment-400">({totalCount} items)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClearAll}
            className="px-3 py-1.5 text-xs text-parchment-400 hover:text-parchment-200 hover:bg-midnight-700 rounded transition-colors"
          >
            Clear All
          </button>
          <button
            onClick={() => onStartGeneration()}
            className="px-3 py-1.5 text-xs bg-accent-gold text-midnight-950 font-medium rounded hover:bg-accent-gold/90 transition-colors flex items-center gap-1.5"
          >
            <RocketIcon className="w-3 h-3" />
            Generate All
          </button>
        </div>
      </div>

      {/* Queue content */}
      <div className="flex-1 overflow-y-auto p-4 bg-midnight-950">
        {/* Image categories */}
        {imageCount > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <ImageIcon className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-parchment-200">Images ({imageCount})</span>
            </div>
            <div className="space-y-3">
              {Object.entries(groupedQueue.images).map(([category, items]) => (
                <QueueCategorySection
                  key={category}
                  category={category}
                  items={items}
                  onRemoveItem={onRemoveItem}
                  onClearCategory={onClearCategory}
                />
              ))}
            </div>
          </div>
        )}

        {/* Audio categories */}
        {audioCount > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <SpeakerLoudIcon className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-parchment-200">Audio ({audioCount})</span>
            </div>
            <div className="space-y-3">
              {Object.entries(groupedQueue.audio).map(([category, items]) => (
                <QueueCategorySection
                  key={category}
                  category={category}
                  items={items}
                  onRemoveItem={onRemoveItem}
                  onClearCategory={onClearCategory}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Category section within the queue panel
 */
function QueueCategorySection({ category, items, onRemoveItem, onClearCategory }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-midnight-800/50 rounded-lg border border-midnight-700">
      {/* Category header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-midnight-700/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-parchment-200">
            {getCategoryLabel(category)}
          </span>
          <span className="text-xs text-parchment-500">({items.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearCategory(category);
            }}
            className="px-2 py-0.5 text-xs text-parchment-500 hover:text-accent-ruby hover:bg-midnight-700 rounded transition-colors"
          >
            Clear
          </button>
          <span className="text-parchment-500">{expanded ? '-' : '+'}</span>
        </div>
      </div>

      {/* Category items */}
      {expanded && (
        <div className="px-3 pb-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={`${item._sourceFile || item._biome || ''}-${item.id}`}
              className="flex items-center gap-1.5 px-2 py-1 bg-midnight-700 rounded text-xs text-parchment-300 group"
            >
              <span className="truncate max-w-[150px]" title={item._biome ? `${item._biome}/${item.id}` : item.id}>
                {item._biome ? `${item._biome}/${item.id}` : item.id}
              </span>
              <button
                onClick={() => onRemoveItem(category, item.id)}
                className="text-parchment-500 hover:text-accent-ruby opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove from queue"
              >
                <Cross2Icon className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Console output panel with source filtering
 */
function ConsolePanel({ stdout, clearStdout, sourceFilter }) {
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
              key={`${entry.source}-${entry.timestamp}-${index}`}
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
function AssetsPanel({ generatedAssets, clearGeneratedAssets, sourceFilter }) {
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
              <AssetPreviewCard key={`${asset.type}-${asset.category}-${asset.path}-${index}`} asset={asset} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Main UnifiedAssetPanel component
 *
 * Uses its own useRegenerationQueue hook to ensure fresh data when panel opens.
 * The onRefreshQueue callback is used to sync the Layout's badge count after actions.
 */
export default function UnifiedAssetPanel({
  activePanel: controlledActivePanel,
  onPanelChange,
  onRefreshQueue,
  initialSourceFilter = 'all',
}) {
  const { unified } = useGenerationContext();
  const {
    queues,
    anyActive,
    stdout,
    clearStdout,
    generatedAssets,
    clearGeneratedAssets,
    cancelJob,
    pauseQueue,
    resumeQueue,
  } = unified;

  // Always use internal queue hook - it fetches fresh data when panel opens
  const internalQueue = useRegenerationQueue();
  const queueData = internalQueue.queue;
  const queueTotalCount = internalQueue.totalCount;
  const queueLoading = internalQueue.loading;

  // Refresh regeneration queue when generation finishes (active → idle)
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (wasActiveRef.current && !anyActive) {
      internalQueue.fetchQueue();
      onRefreshQueue?.();
    }
    wasActiveRef.current = !!anyActive;
  }, [anyActive, internalQueue, onRefreshQueue]);

  const [activePanel, setActivePanel] = useState(controlledActivePanel || PANEL_TABS.CONSOLE);
  const [sourceFilter, setSourceFilter] = useState(initialSourceFilter);

  // Sync with controlled activePanel prop
  useEffect(() => {
    if (controlledActivePanel && controlledActivePanel !== activePanel) {
      setActivePanel(controlledActivePanel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledActivePanel]);

  // Sync with external source filter when it changes
  useEffect(() => {
    if (initialSourceFilter && initialSourceFilter !== sourceFilter) {
      setSourceFilter(initialSourceFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSourceFilter]);

  // Handle panel change
  const handlePanelChange = useCallback((panel) => {
    setActivePanel(panel);
    onPanelChange?.(panel);
  }, [onPanelChange]);

  // Queue actions with error handling
  const handleRemoveItem = useCallback(async (category, id) => {
    try {
      await internalQueue.markItem(category, id, false);
      onRefreshQueue?.();
    } catch (err) {
      console.error('[UnifiedAssetPanel] Failed to remove item:', err);
    }
  }, [internalQueue, onRefreshQueue]);

  const handleClearCategory = useCallback(async (category) => {
    try {
      await internalQueue.clearCategory(category);
      onRefreshQueue?.();
    } catch (err) {
      console.error('[UnifiedAssetPanel] Failed to clear category:', err);
    }
  }, [internalQueue, onRefreshQueue]);

  const handleClearAll = useCallback(async () => {
    try {
      await internalQueue.clearAll();
      onRefreshQueue?.();
    } catch (err) {
      console.error('[UnifiedAssetPanel] Failed to clear queue:', err);
    }
  }, [internalQueue, onRefreshQueue]);

  const handleStartGeneration = useCallback(async () => {
    try {
      // Resume any paused queues before starting generation
      const anyPaused = queues.images.paused || queues.music.paused || queues.sfx.paused;
      if (anyPaused) {
        if (queues.images.paused) resumeQueue('images');
        if (queues.music.paused) resumeQueue('music');
        if (queues.sfx.paused) resumeQueue('sfx');
      }
      await internalQueue.startBatchGeneration();
      // Switch to console to watch progress
      handlePanelChange(PANEL_TABS.CONSOLE);
    } catch (err) {
      console.error('[UnifiedAssetPanel] Failed to start generation:', err);
    }
  }, [internalQueue, handlePanelChange, queues, resumeQueue]);

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

      {/* Panel content */}
      <div className="h-full" style={{ height: activeJob && activeProgress ? 'calc(100% - 48px)' : '100%' }}>
        {activePanel === PANEL_TABS.QUEUE && (
          <QueuePanel
            queue={queueData}
            totalCount={queueTotalCount}
            loading={queueLoading}
            onRemoveItem={handleRemoveItem}
            onClearCategory={handleClearCategory}
            onClearAll={handleClearAll}
            onStartGeneration={handleStartGeneration}
          />
        )}

        {activePanel === PANEL_TABS.CONSOLE && (
          <div className="h-full relative">
            <ConsolePanel
              stdout={stdout}
              clearStdout={clearStdout}
              sourceFilter={sourceFilter}
            />
          </div>
        )}

        {activePanel === PANEL_TABS.ASSETS && (
          <AssetsPanel
            generatedAssets={generatedAssets}
            clearGeneratedAssets={clearGeneratedAssets}
            sourceFilter={sourceFilter}
          />
        )}
      </div>
    </div>
  );
}
