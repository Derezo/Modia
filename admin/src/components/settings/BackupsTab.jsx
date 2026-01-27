/**
 * BackupsTab - Backup management tab for Settings page
 *
 * Features:
 * - List available backups
 * - Create new backups with optional reason
 * - Restore from backup (with confirmation)
 * - Delete backups (with confirmation)
 */

import { useState } from 'react';
import {
  ReloadIcon,
  PlusIcon,
  TrashIcon,
  ResetIcon,
  CheckIcon,
  Cross2Icon,
  InfoCircledIcon,
  ArchiveIcon,
} from '@radix-ui/react-icons';
import { useToast } from '../../contexts/ToastContext';
import { formatSize, formatTimestamp } from '../../utils/format';

/**
 * Backups tab content
 * @param {object} props
 * @param {Array} props.backups - List of available backups
 * @param {boolean} props.loading - Whether backups are loading
 * @param {boolean} props.operating - Whether a backup operation is in progress
 * @param {function} props.onRefresh - Callback to refresh backup list
 * @param {function} props.onCreateBackup - Callback to create a new backup
 * @param {function} props.onRestoreBackup - Callback to restore a backup
 * @param {function} props.onDeleteBackup - Callback to delete a backup
 */
export function BackupsTab({
  backups,
  loading,
  operating,
  onRefresh,
  onCreateBackup,
  onRestoreBackup,
  onDeleteBackup,
}) {
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [confirmingRestore, setConfirmingRestore] = useState(null);
  const [createReason, setCreateReason] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCreate = async () => {
    try {
      await onCreateBackup(createReason || 'manual');
      setCreateReason('');
      setShowCreateForm(false);
      toast.success('Backup created');
    } catch (err) {
      toast.error(err.message || 'Failed to create backup');
    }
  };

  const handleRestore = async (timestamp) => {
    try {
      await onRestoreBackup(timestamp);
      setConfirmingRestore(null);
      toast.info('Backup restored');
    } catch (err) {
      toast.error(err.message || 'Failed to restore backup');
    }
  };

  const handleDelete = async (timestamp) => {
    try {
      await onDeleteBackup(timestamp);
      setConfirmingDelete(null);
      toast.success('Backup deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete backup');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-display font-semibold text-parchment-100">
              Metadata Backups
            </h3>
            <p className="text-sm text-parchment-400">
              Create and manage backups of asset metadata JSON files.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="btn-ghost flex items-center gap-2"
            >
              <ReloadIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              disabled={operating}
              className="btn-gold flex items-center gap-2"
            >
              <PlusIcon className="w-4 h-4" />
              Create Backup
            </button>
          </div>
        </div>

        {/* Create backup form */}
        {showCreateForm && (
          <div className="p-4 bg-midnight-800 rounded-lg mb-4">
            <h4 className="text-sm font-medium text-parchment-200 mb-3">Create New Backup</h4>
            <div className="flex gap-3">
              <input
                type="text"
                value={createReason}
                onChange={(e) => setCreateReason(e.target.value)}
                placeholder="Reason for backup (optional)"
                className="flex-1 px-3 py-2 bg-midnight-900 border border-midnight-600 rounded-lg
                           text-parchment-100 placeholder-parchment-500
                           focus:outline-none focus:border-accent-gold"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={operating}
                className="btn-gold"
              >
                {operating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="flex items-start gap-2 p-3 bg-midnight-800 rounded-lg">
          <InfoCircledIcon className="w-4 h-4 text-accent-gold flex-shrink-0 mt-0.5" />
          <p className="text-sm text-parchment-400">
            Backups are automatically created before bulk generation operations.
            Restoring a backup will overwrite current metadata files.
          </p>
        </div>
      </div>

      {/* Backup list */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Available Backups
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <ReloadIcon className="w-6 h-6 animate-spin text-parchment-400" />
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-parchment-400">
            <ArchiveIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No backups available</p>
            <p className="text-sm text-parchment-500 mt-1">
              Create a backup to preserve your current metadata state.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {backups.map((backup) => (
              <div
                key={backup.timestamp}
                className="p-4 bg-midnight-800 rounded-lg flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-parchment-200">{backup.timestamp}</span>
                    {backup.reason && (
                      <span className="badge-warning">{backup.reason}</span>
                    )}
                  </div>
                  <div className="text-sm text-parchment-400 mt-1">
                    <span>{formatTimestamp(backup.timestamp)}</span>
                    {backup.size && (
                      <>
                        <span className="mx-2">|</span>
                        <span>{formatSize(backup.size)}</span>
                      </>
                    )}
                    {backup.fileCount && (
                      <>
                        <span className="mx-2">|</span>
                        <span>{backup.fileCount} files</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  {confirmingRestore === backup.timestamp ? (
                    <>
                      <span className="text-sm text-parchment-400 mr-2">Restore?</span>
                      <button
                        type="button"
                        onClick={() => handleRestore(backup.timestamp)}
                        disabled={operating}
                        className="p-2 bg-accent-gold/20 text-accent-gold rounded-lg hover:bg-accent-gold/30"
                        aria-label="Confirm restore"
                      >
                        <CheckIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingRestore(null)}
                        className="p-2 bg-midnight-700 text-parchment-400 rounded-lg hover:bg-midnight-600"
                        aria-label="Cancel restore"
                      >
                        <Cross2Icon className="w-4 h-4" />
                      </button>
                    </>
                  ) : confirmingDelete === backup.timestamp ? (
                    <>
                      <span className="text-sm text-accent-ruby mr-2">Delete?</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(backup.timestamp)}
                        disabled={operating}
                        className="p-2 bg-accent-ruby/20 text-accent-ruby rounded-lg hover:bg-accent-ruby/30"
                        aria-label="Confirm delete"
                      >
                        <CheckIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="p-2 bg-midnight-700 text-parchment-400 rounded-lg hover:bg-midnight-600"
                        aria-label="Cancel delete"
                      >
                        <Cross2Icon className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmingRestore(backup.timestamp)}
                        disabled={operating}
                        className="p-2 bg-midnight-700 text-parchment-300 rounded-lg hover:bg-midnight-600 hover:text-parchment-100"
                        title="Restore this backup"
                      >
                        <ResetIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(backup.timestamp)}
                        disabled={operating}
                        className="p-2 bg-midnight-700 text-parchment-300 rounded-lg hover:bg-accent-ruby/20 hover:text-accent-ruby"
                        title="Delete this backup"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Operating overlay */}
      {operating && (
        <div className="fixed inset-0 bg-midnight-950/50 flex items-center justify-center z-50">
          <div className="bg-midnight-800 border border-midnight-600 rounded-lg p-6 flex items-center gap-3">
            <ReloadIcon className="w-5 h-5 animate-spin text-accent-gold" />
            <span className="text-parchment-200">Processing...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default BackupsTab;
