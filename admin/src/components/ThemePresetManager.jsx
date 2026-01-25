/**
 * ThemePresetManager - Component for managing theme presets
 *
 * Features:
 * - List available presets (built-in and custom)
 * - Save current theme as a new preset
 * - Apply a preset to the current theme
 * - Delete custom presets
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArchiveIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
  Cross2Icon,
  ReloadIcon,
  StarFilledIcon,
  StarIcon,
} from '@radix-ui/react-icons';

import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

/**
 * Preset card component
 */
function PresetCard({ preset, isActive, onApply, onDelete, loading }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(preset.filename);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div
      className={`p-4 rounded-lg border transition-colors ${
        isActive
          ? 'bg-accent-gold/10 border-accent-gold/50'
          : 'bg-midnight-800 border-midnight-700 hover:border-midnight-600'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-parchment-100 truncate">
              {preset.name}
            </h4>
            {preset.builtin && (
              <span className="px-2 py-0.5 text-xs bg-midnight-700 text-parchment-400 rounded">
                Built-in
              </span>
            )}
            {isActive && (
              <StarFilledIcon className="w-4 h-4 text-accent-gold flex-shrink-0" />
            )}
          </div>
          {preset.description && (
            <p className="text-sm text-parchment-400 mt-1 line-clamp-2">
              {preset.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isActive && (
            <button
              type="button"
              onClick={() => onApply(preset.filename)}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-accent-gold/20 text-accent-gold rounded-lg
                         hover:bg-accent-gold/30 transition-colors disabled:opacity-50"
            >
              Apply
            </button>
          )}
          {!preset.builtin && (
            confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="p-1.5 bg-accent-ruby/20 text-accent-ruby rounded hover:bg-accent-ruby/30"
                  aria-label="Confirm delete"
                >
                  <CheckIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="p-1.5 bg-midnight-700 text-parchment-400 rounded hover:bg-midnight-600"
                  aria-label="Cancel delete"
                >
                  <Cross2Icon className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="p-1.5 text-parchment-500 hover:text-accent-ruby hover:bg-accent-ruby/10 rounded transition-colors"
                aria-label="Delete preset"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Save preset form
 */
function SavePresetForm({ onSave, onCancel, loading }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    // Validate name
    const trimmedName = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      setError('Name can only contain letters, numbers, underscores, and dashes');
      return;
    }

    onSave(trimmedName, description.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-midnight-800 rounded-lg space-y-4">
      <div>
        <label className="block text-sm font-medium text-parchment-300 mb-1">
          Preset Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-custom-theme"
          className="w-full px-3 py-2 bg-midnight-900 border border-midnight-600 rounded-lg
                     text-parchment-100 placeholder-parchment-500
                     focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
          autoFocus
        />
        {error && <p className="text-xs text-accent-ruby mt-1">{error}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-parchment-300 mb-1">
          Description (optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A brief description of this theme style"
          className="w-full px-3 py-2 bg-midnight-900 border border-midnight-600 rounded-lg
                     text-parchment-100 placeholder-parchment-500
                     focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="flex-1 px-4 py-2 bg-accent-gold text-midnight-950 rounded-lg font-medium
                     hover:bg-accent-copper transition-colors disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Preset'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-midnight-700 text-parchment-300 rounded-lg
                     hover:bg-midnight-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Main ThemePresetManager component
 */
export default function ThemePresetManager({ currentThemeName, onPresetApplied }) {
  const toast = useToast();
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);

  // Fetch presets
  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getThemePresets();
      // Sort: built-in first, then alphabetically
      const sorted = (data.presets || []).sort((a, b) => {
        if (a.builtin !== b.builtin) return b.builtin ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      setPresets(sorted);
    } catch (err) {
      toast.error(err.message || 'Failed to load presets');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  // Apply preset
  const handleApply = async (presetName) => {
    setOperating(true);
    try {
      const result = await api.applyThemePreset(presetName);
      toast.success(`Applied preset: ${presetName}`);
      onPresetApplied?.(result.theme);
    } catch (err) {
      toast.error(err.message || 'Failed to apply preset');
    } finally {
      setOperating(false);
    }
  };

  // Save current theme as preset
  const handleSave = async (name, description) => {
    setOperating(true);
    try {
      await api.saveThemePreset(name, description);
      toast.success(`Saved preset: ${name}`);
      setShowSaveForm(false);
      fetchPresets();
    } catch (err) {
      toast.error(err.message || 'Failed to save preset');
    } finally {
      setOperating(false);
    }
  };

  // Delete preset
  const handleDelete = async (presetName) => {
    setOperating(true);
    try {
      await api.deleteThemePreset(presetName);
      toast.success(`Deleted preset: ${presetName}`);
      fetchPresets();
    } catch (err) {
      toast.error(err.message || 'Failed to delete preset');
    } finally {
      setOperating(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-display font-semibold text-parchment-100 flex items-center gap-2">
            <ArchiveIcon className="w-5 h-5" />
            Theme Presets
          </h3>
          <p className="text-sm text-parchment-400 mt-1">
            Save and load different theme configurations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchPresets}
            disabled={loading}
            className="btn-ghost p-2"
            aria-label="Refresh presets"
          >
            <ReloadIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!showSaveForm && (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              disabled={operating}
              className="btn-gold flex items-center gap-2"
            >
              <PlusIcon className="w-4 h-4" />
              Save Current
            </button>
          )}
        </div>
      </div>

      {/* Save form */}
      {showSaveForm && (
        <div className="mb-4">
          <SavePresetForm
            onSave={handleSave}
            onCancel={() => setShowSaveForm(false)}
            loading={operating}
          />
        </div>
      )}

      {/* Presets list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <ReloadIcon className="w-6 h-6 animate-spin text-parchment-400" />
        </div>
      ) : presets.length === 0 ? (
        <div className="text-center py-8 text-parchment-400">
          <StarIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No presets available</p>
          <p className="text-sm text-parchment-500 mt-1">
            Save your current theme configuration as a preset.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {presets.map((preset) => (
            <PresetCard
              key={preset.filename}
              preset={preset}
              isActive={currentThemeName === preset.name}
              onApply={handleApply}
              onDelete={handleDelete}
              loading={operating}
            />
          ))}
        </div>
      )}
    </div>
  );
}
