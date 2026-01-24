/**
 * Dashboard - Main overview page with stats and quick actions
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlayIcon,
  CheckCircledIcon,
  ArchiveIcon,
  ReloadIcon,
  RocketIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ActivityLogIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';

import StatsCard from '../components/StatsCard';
import { useStats, useQueue, useApiStatus } from '../hooks/useAssets';
import { api } from '../lib/api';

// Category order for display
const categoryOrder = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];

// Recent activity placeholder data
const placeholderActivity = [
  { id: 1, type: 'generate', message: 'Generated 12 forest floor tiles', time: '2 hours ago', status: 'success' },
  { id: 2, type: 'backup', message: 'Backup created before batch generation', time: '2 hours ago', status: 'info' },
  { id: 3, type: 'generate', message: 'Generated 8 warrior portraits', time: '4 hours ago', status: 'success' },
  { id: 4, type: 'error', message: 'Failed to generate cave_wall_3: API timeout', time: '5 hours ago', status: 'error' },
  { id: 5, type: 'validate', message: 'Validation complete: 42 pending assets', time: '6 hours ago', status: 'warning' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { stats, loading: statsLoading, error: statsError, refetch: refetchStats } = useStats();
  const { queue } = useQueue();
  const { error: statusError } = useApiStatus();

  const [consoleOpen, setConsoleOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  // Quick action handlers
  const handleGenerateAll = async () => {
    setActionLoading('generate');
    setActionMessage(null);

    try {
      // Queue generation for all categories with pending assets
      const pendingCategories = categoryOrder.filter(
        (cat) => stats?.categories?.[cat]?.pending > 0
      );

      if (pendingCategories.length === 0) {
        setActionMessage({ type: 'info', text: 'No pending assets to generate' });
        return;
      }

      for (const category of pendingCategories) {
        await api.generateAssets(category, {}, { limit: 10 });
      }

      setActionMessage({
        type: 'success',
        text: `Queued generation for ${pendingCategories.length} categories`,
      });
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  const handleValidate = async () => {
    setActionLoading('validate');
    setActionMessage(null);

    try {
      await refetchStats();
      setActionMessage({ type: 'success', text: 'Validation complete - stats refreshed' });
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBackup = async () => {
    setActionLoading('backup');
    setActionMessage(null);

    try {
      const result = await api.createBackup('manual');
      setActionMessage({
        type: 'success',
        text: `Backup created with ${result.assetCount} assets`,
      });
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  // Navigate to category page
  const handleCategoryClick = (category) => {
    navigate(`/${category}`);
  };

  // Calculate total stats
  const totalStats = stats?.total || { total: 0, generated: 0, pending: 0, percentComplete: 0 };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-parchment-100 mb-2">
          Dashboard
        </h1>
        <p className="text-parchment-400">
          Overview of AI-generated assets and generation status
        </p>
      </div>

      {/* API Status Banner */}
      {statusError && (
        <div className="mb-6 p-4 bg-accent-ruby/10 border border-accent-ruby/30 rounded-lg flex items-center gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-accent-ruby flex-shrink-0" />
          <div>
            <p className="text-accent-ruby font-medium">API Connection Error</p>
            <p className="text-parchment-400 text-sm">{statusError}</p>
          </div>
        </div>
      )}

      {/* Action message */}
      {actionMessage && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            actionMessage.type === 'success'
              ? 'bg-accent-emerald/10 border border-accent-emerald/30'
              : actionMessage.type === 'error'
              ? 'bg-accent-ruby/10 border border-accent-ruby/30'
              : 'bg-accent-gold/10 border border-accent-gold/30'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircledIcon className="w-5 h-5 text-accent-emerald flex-shrink-0" />
          ) : actionMessage.type === 'error' ? (
            <ExclamationTriangleIcon className="w-5 h-5 text-accent-ruby flex-shrink-0" />
          ) : (
            <InfoCircledIcon className="w-5 h-5 text-accent-gold flex-shrink-0" />
          )}
          <p
            className={
              actionMessage.type === 'success'
                ? 'text-accent-emerald'
                : actionMessage.type === 'error'
                ? 'text-accent-ruby'
                : 'text-accent-gold'
            }
          >
            {actionMessage.text}
          </p>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="ml-auto text-parchment-400 hover:text-parchment-200"
            aria-label="Dismiss message"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Overall progress card */}
      <div className="card p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-display font-semibold text-parchment-100">
              Overall Progress
            </h2>
            <p className="text-parchment-400 text-sm">
              {totalStats.generated} of {totalStats.total} assets generated
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-bold text-accent-gold">
              {totalStats.percentComplete}%
            </span>
            <p className="text-parchment-400 text-sm">
              {totalStats.pending} pending
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-3 bg-midnight-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-gold transition-all duration-500"
            style={{ width: `${totalStats.percentComplete}%` }}
          />
        </div>

        {/* Queue status */}
        {queue?.stats?.isProcessing && (
          <div className="mt-4 flex items-center gap-2 text-parchment-300">
            <ReloadIcon className="w-4 h-4 animate-spin" />
            <span>
              Processing: {queue.current?.category} ({queue.current?.progress?.completed || 0}/
              {queue.current?.progress?.total || '?'})
            </span>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <h2 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Quick Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleGenerateAll}
            disabled={actionLoading === 'generate'}
            className="btn-gold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading === 'generate' ? (
              <ReloadIcon className="w-4 h-4 animate-spin" />
            ) : (
              <RocketIcon className="w-4 h-4" />
            )}
            Generate All Pending
          </button>

          <button
            onClick={handleValidate}
            disabled={actionLoading === 'validate'}
            className="btn-ghost flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading === 'validate' ? (
              <ReloadIcon className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircledIcon className="w-4 h-4" />
            )}
            Validate Assets
          </button>

          <button
            onClick={handleBackup}
            disabled={actionLoading === 'backup'}
            className="btn-ghost flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading === 'backup' ? (
              <ReloadIcon className="w-4 h-4 animate-spin" />
            ) : (
              <ArchiveIcon className="w-4 h-4" />
            )}
            Create Backup
          </button>

          <button
            onClick={refetchStats}
            disabled={statsLoading}
            className="btn-ghost flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ReloadIcon className={`w-4 h-4 ${statsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Category stats grid */}
      <div className="mb-8">
        <h2 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Categories
        </h2>

        {statsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoryOrder.map((cat) => (
              <div key={cat} className="card p-5 animate-pulse">
                <div className="h-6 bg-midnight-800 rounded w-1/3 mb-4" />
                <div className="h-2 bg-midnight-800 rounded mb-3" />
                <div className="h-4 bg-midnight-800 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : statsError ? (
          <div className="card p-6 text-center">
            <ExclamationTriangleIcon className="w-8 h-8 text-accent-ruby mx-auto mb-2" />
            <p className="text-parchment-300">{statsError}</p>
            <button onClick={refetchStats} className="btn-ghost mt-4">
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoryOrder.map((category) => {
              const catStats = stats?.categories?.[category];
              if (!catStats) return null;

              return (
                <StatsCard
                  key={category}
                  category={category}
                  stats={catStats}
                  onClick={() => handleCategoryClick(category)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="mb-8">
        <h2 className="text-lg font-display font-semibold text-parchment-100 mb-4 flex items-center gap-2">
          <ActivityLogIcon className="w-5 h-5" />
          Recent Activity
        </h2>
        <div className="card divide-y divide-midnight-700">
          {placeholderActivity.map((activity) => (
            <div key={activity.id} className="p-4 flex items-center gap-4">
              <div
                className={`w-2 h-2 rounded-full ${
                  activity.status === 'success'
                    ? 'bg-accent-emerald'
                    : activity.status === 'error'
                    ? 'bg-accent-ruby'
                    : activity.status === 'warning'
                    ? 'bg-accent-gold'
                    : 'bg-parchment-400'
                }`}
              />
              <div className="flex-1">
                <p className="text-parchment-200">{activity.message}</p>
                <p className="text-parchment-500 text-sm">{activity.time}</p>
              </div>
            </div>
          ))}
          <div className="p-4 text-center">
            <span className="text-parchment-500 text-sm">
              Activity log is a placeholder - will be populated with real job history
            </span>
          </div>
        </div>
      </div>

      {/* Collapsible console */}
      <div className="card">
        <button
          onClick={() => setConsoleOpen(!consoleOpen)}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-midnight-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <PlayIcon className="w-5 h-5 text-accent-gold" />
            <span className="font-display font-semibold text-parchment-100">
              Generation Console
            </span>
            {queue?.stats?.isProcessing && (
              <span className="badge badge-success">Running</span>
            )}
          </div>
          {consoleOpen ? (
            <ChevronUpIcon className="w-5 h-5 text-parchment-400" />
          ) : (
            <ChevronDownIcon className="w-5 h-5 text-parchment-400" />
          )}
        </button>

        {consoleOpen && (
          <div className="border-t border-midnight-700">
            <div className="p-4 bg-midnight-950 font-mono text-sm">
              {queue?.stats?.isProcessing && queue.current ? (
                <div className="space-y-2">
                  <div className="text-parchment-300">
                    <span className="text-accent-gold">[RUNNING]</span>{' '}
                    {queue.current.category} generation
                  </div>
                  <div className="text-parchment-400">
                    Progress: {queue.current.progress?.completed || 0} /{' '}
                    {queue.current.progress?.total || '?'}
                  </div>
                  <div className="text-parchment-500">
                    Started: {new Date(queue.current.startedAt).toLocaleTimeString()}
                  </div>
                </div>
              ) : (
                <div className="text-parchment-500">
                  <span className="text-parchment-400">[IDLE]</span> No generation jobs
                  running.
                  <br />
                  <span className="text-parchment-600">
                    Use &quot;Generate All Pending&quot; or navigate to a category to start
                    generation.
                  </span>
                </div>
              )}

              {queue?.pending?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-midnight-800">
                  <div className="text-parchment-400 mb-2">
                    Queued ({queue.pending.length}):
                  </div>
                  {queue.pending.slice(0, 5).map((job) => (
                    <div key={job.id} className="text-parchment-500 pl-4">
                      - {job.category}
                      {job.filters?.biome && ` (${job.filters.biome})`}
                    </div>
                  ))}
                  {queue.pending.length > 5 && (
                    <div className="text-parchment-600 pl-4">
                      ... and {queue.pending.length - 5} more
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
