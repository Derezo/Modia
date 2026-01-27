/**
 * BulkEditModal - Modal for editing multiple assets at once
 * Uses Radix UI Dialog for accessibility and smooth animations
 */

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Cross2Icon,
  CheckIcon,
  ReloadIcon,
  StarIcon,
  StarFilledIcon,
} from '@radix-ui/react-icons';

import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

/**
 * Star rating component for quality score
 */
function StarRating({ value, onChange, disabled = false }) {
  const [hoverValue, setHoverValue] = useState(null);
  const displayValue = hoverValue ?? value;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !disabled && setHoverValue(star)}
          onMouseLeave={() => setHoverValue(null)}
          className={`
            p-0.5 transition-colors
            ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'}
          `}
          aria-label={`Rate ${star} stars`}
        >
          {star <= displayValue ? (
            <StarFilledIcon className="w-5 h-5 text-accent-gold" />
          ) : (
            <StarIcon className="w-5 h-5 text-parchment-500" />
          )}
        </button>
      ))}
      {value > 0 && (
        <button
          type="button"
          onClick={() => onChange?.(0)}
          disabled={disabled}
          className="ml-2 text-xs text-parchment-500 hover:text-parchment-300"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * BulkEditModal component
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether the modal is open
 * @param {Function} props.onClose - Callback when modal closes
 * @param {string[]} props.selectedIds - Array of selected asset IDs
 * @param {string} props.category - Asset category (tiles, portraits, etc.)
 * @param {Function} props.onUpdate - Callback after successful update
 */
export default function BulkEditModal({
  open,
  onClose,
  selectedIds,
  category,
  onUpdate,
}) {
  const toast = useToast();

  // Form state - null means don't update this field
  const [formData, setFormData] = useState({
    qualityScore: null,      // 0-5 (null = don't update)
    priority: null,          // 0-3 (null = don't update)
    loraModel: null,         // model ID or null
    note: '',                // Note to append
  });

  const [loraConfig, setLoraConfig] = useState({
    loraModels: {},
    categoryDefaults: {},
    loading: true,
  });

  const [saving, setSaving] = useState(false);

  // Track which fields are enabled for bulk update
  const [enabledFields, setEnabledFields] = useState({
    qualityScore: false,
    priority: false,
    loraModel: false,
    note: false,
  });

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setFormData({
        qualityScore: null,
        priority: null,
        loraModel: null,
        note: '',
      });
      setEnabledFields({
        qualityScore: false,
        priority: false,
        loraModel: false,
        note: false,
      });
    }
  }, [open]);

  // Load LoRA config on mount
  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      try {
        const config = await api.getConfig();
        if (mounted) {
          setLoraConfig({
            loraModels: config.loraModels || {},
            categoryDefaults: config.defaultLoraByCategory || {},
            loading: false,
          });
        }
      } catch (err) {
        console.error('Failed to load LoRA config:', err);
        if (mounted) {
          setLoraConfig(prev => ({ ...prev, loading: false }));
        }
      }
    }
    loadConfig();

    return () => {
      mounted = false;
    };
  }, []);

  /**
   * Toggle a field's enabled state
   */
  const toggleField = (field) => {
    setEnabledFields(prev => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  /**
   * Handle form field changes
   */
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  /**
   * Handle save - calls the bulk update API
   */
  const handleSave = async () => {
    // Build updates object based on enabled fields
    const updates = {};

    if (enabledFields.qualityScore && formData.qualityScore !== null) {
      updates.qualityScore = formData.qualityScore;
    }

    if (enabledFields.priority && formData.priority !== null) {
      updates.priority = formData.priority;
    }

    if (enabledFields.loraModel) {
      updates.loraModel = formData.loraModel || null; // null clears to category default
    }

    if (enabledFields.note && formData.note.trim()) {
      updates.note = formData.note.trim();
    }

    // Check if any updates are being made
    if (Object.keys(updates).length === 0) {
      toast.info('No fields selected for update');
      return;
    }

    setSaving(true);

    try {
      const result = await api.bulkUpdateAssets(category, selectedIds, updates);

      const message = result.updated === selectedIds.length
        ? `Updated ${result.updated} asset(s)`
        : `Updated ${result.updated} of ${selectedIds.length} asset(s)`;

      if (result.errors?.length > 0) {
        toast.warning(`${message}. Some errors occurred.`);
      } else {
        toast.success(message);
      }

      onUpdate?.();
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Failed to update assets');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = selectedIds?.length || 0;

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
        <Dialog.Content
          aria-describedby="bulk-edit-description"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[90vw] max-w-md max-h-[85vh] overflow-y-auto
                     bg-midnight-900 border border-midnight-700 rounded-lg shadow-xl z-[70]
                     focus:outline-none"
        >
          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-display font-semibold text-parchment-100">
                Bulk Edit Assets
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <Cross2Icon className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>

            <p id="bulk-edit-description" className="text-sm text-parchment-400 mb-6">
              Update {selectedCount} selected asset{selectedCount !== 1 ? 's' : ''}.
              Enable the fields you want to update.
            </p>

            {/* Form fields */}
            <div className="space-y-5">
              {/* Quality Score */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledFields.qualityScore}
                    onChange={() => toggleField('qualityScore')}
                    className="w-4 h-4 rounded border-midnight-600 bg-midnight-800 text-accent-gold focus:ring-accent-gold/30"
                  />
                  <span className="text-sm font-medium text-parchment-300">
                    Quality Score
                  </span>
                </label>
                {enabledFields.qualityScore && (
                  <div className="ml-6">
                    <StarRating
                      value={formData.qualityScore || 0}
                      onChange={(val) => handleChange('qualityScore', val)}
                    />
                    <p className="text-xs text-parchment-500 mt-1">
                      Set quality score for all selected assets
                    </p>
                  </div>
                )}
              </div>

              {/* Priority Level */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledFields.priority}
                    onChange={() => toggleField('priority')}
                    className="w-4 h-4 rounded border-midnight-600 bg-midnight-800 text-accent-gold focus:ring-accent-gold/30"
                  />
                  <span className="text-sm font-medium text-parchment-300">
                    Priority Level
                  </span>
                </label>
                {enabledFields.priority && (
                  <div className="ml-6">
                    <select
                      value={formData.priority ?? 0}
                      onChange={(e) => handleChange('priority', parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-200 focus:outline-none focus:border-accent-gold"
                    >
                      <option value={0}>0 - Normal</option>
                      <option value={1}>1 - Low</option>
                      <option value={2}>2 - Medium</option>
                      <option value={3}>3 - High</option>
                    </select>
                    <p className="text-xs text-parchment-500 mt-1">
                      Higher priority assets are generated first
                    </p>
                  </div>
                )}
              </div>

              {/* LoRA Model */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledFields.loraModel}
                    onChange={() => toggleField('loraModel')}
                    className="w-4 h-4 rounded border-midnight-600 bg-midnight-800 text-accent-gold focus:ring-accent-gold/30"
                  />
                  <span className="text-sm font-medium text-parchment-300">
                    Style Model (LoRA)
                  </span>
                </label>
                {enabledFields.loraModel && (
                  <div className="ml-6">
                    <select
                      value={formData.loraModel || ''}
                      onChange={(e) => handleChange('loraModel', e.target.value)}
                      disabled={loraConfig.loading}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-200 focus:outline-none focus:border-accent-gold
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">
                        Category Default ({loraConfig.categoryDefaults[category]
                          ? `${loraConfig.loraModels[loraConfig.categoryDefaults[category]]?.name || loraConfig.categoryDefaults[category]}`
                          : 'loading...'})
                      </option>
                      {Object.entries(loraConfig.loraModels).map(([modelId, model]) => (
                        <option key={modelId} value={modelId}>
                          {model.name} ({modelId})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-parchment-500 mt-1">
                      Override the style model for selected assets
                    </p>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledFields.note}
                    onChange={() => toggleField('note')}
                    className="w-4 h-4 rounded border-midnight-600 bg-midnight-800 text-accent-gold focus:ring-accent-gold/30"
                  />
                  <span className="text-sm font-medium text-parchment-300">
                    Append Note
                  </span>
                </label>
                {enabledFields.note && (
                  <div className="ml-6">
                    <textarea
                      value={formData.note}
                      onChange={(e) => handleChange('note', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-100 placeholder-parchment-500 resize-none
                                 focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                      placeholder="Note to append to all selected assets..."
                    />
                    <p className="text-xs text-parchment-500 mt-1">
                      This note will be appended to existing notes
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer actions */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <Dialog.Close asChild>
                <button type="button" className="btn-ghost">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !Object.values(enabledFields).some(Boolean)}
                className="btn-gold flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <ReloadIcon className="w-4 h-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    Update {selectedCount} Asset{selectedCount !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
