/**
 * Dashboard - Main overview page with stats and quick actions
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircledIcon,
  ArchiveIcon,
  ReloadIcon,
  RocketIcon,
  ExclamationTriangleIcon,
  ActivityLogIcon,
  InfoCircledIcon,
  ClockIcon,
} from '@radix-ui/react-icons';

import StatsCard from '../components/StatsCard';
import GenerationConsole from '../components/GenerationConsole';
import { useStats, useQueue, useApiStatus } from '../hooks/useAssets';
import { useActivityLog } from '../hooks/useActivityLog';
import { api } from '../lib/api';

// Category order for display
const categoryOrder = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];

export default function Dashboard() {
  const navigate = useNavigate();
  const { stats, loading: statsLoading, error: statsError, refetch: refetchStats } = useStats();
  const { queue } = useQueue();
  const { error: statusError } = useApiStatus();
  const { activities, loading: activitiesLoading, refetch: refetchActivities } = useActivityLog({ limit: 10 });

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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-display font-semibold text-parchment-100 flex items-center gap-2">
            <ActivityLogIcon className="w-5 h-5" />
            Recent Activity
          </h2>
          <button
            onClick={refetchActivities}
            disabled={activitiesLoading}
            className="btn-ghost text-sm flex items-center gap-1"
          >
            <ReloadIcon className={`w-3 h-3 ${activitiesLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <div className="card divide-y divide-midnight-700">
          {activitiesLoading ? (
            <div className="p-6 text-center">
              <ReloadIcon className="w-6 h-6 text-parchment-400 animate-spin mx-auto mb-2" />
              <p className="text-parchment-500 text-sm">Loading activity...</p>
            </div>
          ) : activities.length === 0 ? (
            <div className="p-6 text-center">
              <ClockIcon className="w-8 h-8 text-parchment-600 mx-auto mb-2" />
              <p className="text-parchment-500">No generation history yet</p>
              <p className="text-parchment-600 text-sm mt-1">
                Generate some assets to see activity here
              </p>
            </div>
          ) : (
            activities.map((activity) => (
              <div key={activity.id} className="p-4 flex items-center gap-4">
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    activity.status === 'success'
                      ? 'bg-accent-emerald'
                      : activity.status === 'error'
                      ? 'bg-accent-ruby'
                      : activity.status === 'warning'
                      ? 'bg-accent-gold'
                      : 'bg-parchment-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-parchment-200 truncate">{activity.message}</p>
                  <div className="flex items-center gap-3 text-parchment-500 text-sm">
                    <span>{activity.time}</span>
                    {activity.details?.duration && (
                      <span className="text-parchment-600">
                        ({activity.details.duration})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Generation Console - Real-time WebSocket-powered console */}
      <GenerationConsole
        minimized={!consoleOpen}
        onMinimizeChange={(minimized) => setConsoleOpen(!minimized)}
      />
    </div>
  );
}
