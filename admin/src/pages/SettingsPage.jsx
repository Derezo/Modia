/**
 * SettingsPage - Theme editor, generation settings, and backup management
 *
 * Three tabs:
 * - Theme: Style trigger, base phrase, negative prompt, category modifiers
 * - Generation: LoRA defaults, output paths (display only)
 * - Backups: List, create, restore, delete backups
 */

import { useCallback, useState, useEffect } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  GearIcon,
  MagicWandIcon,
  ArchiveIcon,
  ReloadIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import { useApiStatus, useBackups } from '../hooks/useAssets';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../contexts/ToastContext';
import { ThemeTab, GenerationTab, BackupsTab } from '../components/settings';
import { clearAllWaveformCache, getCacheStats } from '../lib/waveformCache';

/**
 * Main Settings Page
 */
export default function SettingsPage() {
  const toast = useToast();
  const { status, loading: statusLoading, error: statusError } = useApiStatus();
  const {
    theme,
    loading: themeLoading,
    saving,
    error: themeError,
    updateField,
    updateCategoryModifier,
    updateTheme,
    updateLoraDefault,
    refetch: refetchTheme,
  } = useTheme();
  const {
    backups,
    loading: backupsLoading,
    operating,
    error: backupsError,
    refetch: refetchBackups,
    createBackup,
    restoreBackup,
    deleteBackup,
  } = useBackups();

  // Waveform cache state
  const [cacheStats, setCacheStats] = useState({ count: 0, oldestTimestamp: null, newestTimestamp: null });
  const [cacheClearLoading, setCacheClearLoading] = useState(false);

  // Load cache stats on mount
  useEffect(() => {
    const loadCacheStats = async () => {
      const stats = await getCacheStats();
      setCacheStats(stats);
    };
    loadCacheStats();
  }, []);

  // Handle clearing waveform cache
  const handleClearWaveformCache = useCallback(async () => {
    setCacheClearLoading(true);
    try {
      const success = await clearAllWaveformCache();
      if (success) {
        toast.success(`Cleared ${cacheStats.count} cached waveform(s)`);
        setCacheStats({ count: 0, oldestTimestamp: null, newestTimestamp: null });
      } else {
        toast.error('Failed to clear waveform cache');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to clear cache');
    } finally {
      setCacheClearLoading(false);
    }
  }, [cacheStats.count, toast]);

  const handleUpdateField = useCallback(async (path, value) => {
    try {
      await updateField(path, value);
    } catch (err) {
      console.error('Failed to update field:', err);
    }
  }, [updateField]);

  const handleUpdateCategoryModifier = useCallback(async (category, modifier) => {
    try {
      await updateCategoryModifier(category, modifier);
    } catch (err) {
      console.error('Failed to update category modifier:', err);
    }
  }, [updateCategoryModifier]);

  const error = statusError || themeError || backupsError;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-midnight-800 rounded-lg">
          <GearIcon className="w-6 h-6 text-accent-gold" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-parchment-100">Settings</h1>
          <p className="text-parchment-400">Theme configuration, generation settings, and backups</p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 bg-accent-ruby/20 border border-accent-ruby/40 rounded-lg flex items-start gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-accent-ruby flex-shrink-0" />
          <div>
            <h4 className="text-accent-ruby font-medium">Error</h4>
            <p className="text-parchment-300 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* API Status Card */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          API Status
        </h2>

        {statusLoading ? (
          <div className="text-parchment-400">Checking API status...</div>
        ) : status ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${status.enabled ? 'bg-accent-emerald' : 'bg-accent-ruby'}`} />
              <span className="text-parchment-200">
                {status.enabled ? 'Admin API Enabled' : 'Admin API Disabled'}
              </span>
            </div>
            <span className="text-parchment-500">|</span>
            <span className="text-parchment-400 text-sm">
              Environment: <span className="text-parchment-200">{status.environment}</span>
            </span>
            <span className="text-parchment-500">|</span>
            <span className={`text-sm ${status.utilitiesLoaded?.metadata ? 'text-accent-emerald' : 'text-accent-ruby'}`}>
              Metadata: {status.utilitiesLoaded?.metadata ? 'Ready' : 'Not Loaded'}
            </span>
            <span className={`text-sm ${status.utilitiesLoaded?.backup ? 'text-accent-emerald' : 'text-accent-ruby'}`}>
              Backup: {status.utilitiesLoaded?.backup ? 'Ready' : 'Not Loaded'}
            </span>
          </div>
        ) : null}
      </div>

      {/* Cache Management Card */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Cache Management
        </h2>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-parchment-200 font-medium">Waveform Cache</h3>
            <p className="text-parchment-400 text-sm">
              {cacheStats.count > 0 ? (
                <>
                  {cacheStats.count} cached waveform{cacheStats.count !== 1 ? 's' : ''}
                  {cacheStats.oldestTimestamp && (
                    <span className="ml-2">
                      (oldest: {new Date(cacheStats.oldestTimestamp).toLocaleDateString()})
                    </span>
                  )}
                </>
              ) : (
                'No cached waveforms'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearWaveformCache}
            disabled={cacheClearLoading || cacheStats.count === 0}
            className="btn-ghost flex items-center gap-2 disabled:opacity-50"
          >
            {cacheClearLoading ? (
              <ReloadIcon className="w-4 h-4 animate-spin" />
            ) : (
              <TrashIcon className="w-4 h-4" />
            )}
            Clear Cache
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root defaultValue="theme" className="w-full">
        <Tabs.List className="flex border-b border-midnight-700 mb-6">
          <Tabs.Trigger
            value="theme"
            className="px-4 py-3 text-parchment-400 font-medium flex items-center gap-2
                       hover:text-parchment-200 transition-colors
                       data-[state=active]:text-accent-gold data-[state=active]:border-b-2 data-[state=active]:border-accent-gold
                       data-[state=active]:-mb-px"
          >
            <MagicWandIcon className="w-4 h-4" />
            Theme
          </Tabs.Trigger>
          <Tabs.Trigger
            value="generation"
            className="px-4 py-3 text-parchment-400 font-medium flex items-center gap-2
                       hover:text-parchment-200 transition-colors
                       data-[state=active]:text-accent-gold data-[state=active]:border-b-2 data-[state=active]:border-accent-gold
                       data-[state=active]:-mb-px"
          >
            <GearIcon className="w-4 h-4" />
            Generation
          </Tabs.Trigger>
          <Tabs.Trigger
            value="backups"
            className="px-4 py-3 text-parchment-400 font-medium flex items-center gap-2
                       hover:text-parchment-200 transition-colors
                       data-[state=active]:text-accent-gold data-[state=active]:border-b-2 data-[state=active]:border-accent-gold
                       data-[state=active]:-mb-px"
          >
            <ArchiveIcon className="w-4 h-4" />
            Backups
            {backups.length > 0 && (
              <span className="text-xs bg-midnight-700 text-parchment-400 px-1.5 py-0.5 rounded-full">
                {backups.length}
              </span>
            )}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="theme" className="outline-none">
          {themeLoading ? (
            <div className="card p-8 flex items-center justify-center">
              <ReloadIcon className="w-6 h-6 animate-spin text-parchment-400" />
            </div>
          ) : theme ? (
            <ThemeTab
              theme={theme}
              saving={saving}
              onUpdateField={handleUpdateField}
              onUpdateCategoryModifier={handleUpdateCategoryModifier}
              onPresetApplied={refetchTheme}
            />
          ) : (
            <div className="card p-8 text-center text-parchment-400">
              Failed to load theme configuration.
              <button type="button" onClick={refetchTheme} className="btn-ghost ml-2">
                Retry
              </button>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="generation" className="outline-none">
          {themeLoading || statusLoading ? (
            <div className="card p-8 flex items-center justify-center">
              <ReloadIcon className="w-6 h-6 animate-spin text-parchment-400" />
            </div>
          ) : (
            <GenerationTab
              theme={theme}
              status={status}
              onThemeUpdate={updateTheme}
              onLoraUpdate={updateLoraDefault}
            />
          )}
        </Tabs.Content>

        <Tabs.Content value="backups" className="outline-none">
          <BackupsTab
            backups={backups}
            loading={backupsLoading}
            operating={operating}
            onRefresh={refetchBackups}
            onCreateBackup={createBackup}
            onRestoreBackup={restoreBackup}
            onDeleteBackup={deleteBackup}
          />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
