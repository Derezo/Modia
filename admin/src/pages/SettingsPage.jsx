/**
 * SettingsPage - API configuration and generation preferences
 */

import { GearIcon } from '@radix-ui/react-icons';
import { useApiStatus } from '../hooks/useAssets';

export default function SettingsPage() {
  const { status, loading, error } = useApiStatus();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-midnight-800 rounded-lg">
          <GearIcon className="w-6 h-6 text-accent-gold" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-parchment-100">Settings</h1>
          <p className="text-parchment-400">API configuration and generation preferences</p>
        </div>
      </div>

      {/* API Status */}
      <div className="card p-6 mb-6">
        <h2 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          API Status
        </h2>

        {loading ? (
          <div className="text-parchment-400">Checking API status...</div>
        ) : error ? (
          <div className="text-accent-ruby">{error}</div>
        ) : status ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${status.enabled ? 'bg-accent-emerald' : 'bg-accent-ruby'}`} />
              <span className="text-parchment-200">
                {status.enabled ? 'Admin API Enabled' : 'Admin API Disabled'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-parchment-500">Environment:</span>
                <span className="text-parchment-200 ml-2">{status.environment}</span>
              </div>
              <div>
                <span className="text-parchment-500">Metadata Utils:</span>
                <span className={`ml-2 ${status.utilitiesLoaded?.metadata ? 'text-accent-emerald' : 'text-accent-ruby'}`}>
                  {status.utilitiesLoaded?.metadata ? 'Loaded' : 'Not Loaded'}
                </span>
              </div>
              <div>
                <span className="text-parchment-500">Backup Utils:</span>
                <span className={`ml-2 ${status.utilitiesLoaded?.backup ? 'text-accent-emerald' : 'text-accent-ruby'}`}>
                  {status.utilitiesLoaded?.backup ? 'Loaded' : 'Not Loaded'}
                </span>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-midnight-700">
              <div className="text-sm text-parchment-500 break-all">
                <strong className="text-parchment-400">Metadata Dir:</strong>
                <br />
                {status.metadataDir}
              </div>
              <div className="text-sm text-parchment-500 break-all mt-2">
                <strong className="text-parchment-400">Scripts Dir:</strong>
                <br />
                {status.scriptsDir}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card p-8 text-center">
        <p className="text-parchment-400 mb-4">
          Full settings interface coming soon.
        </p>
        <p className="text-parchment-500 text-sm">
          This page will include theme configuration, generation defaults, and backup management.
        </p>
      </div>
    </div>
  );
}
