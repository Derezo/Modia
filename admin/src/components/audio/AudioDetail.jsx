/**
 * AudioDetail - Slide-over panel for viewing and editing audio asset details
 * Follows pattern from AssetDetail.jsx for image assets.
 *
 * @module AudioDetail
 * @description Detailed view panel for audio assets with playback, metadata editing,
 * variant selection (music), and prompt validation (sfx).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Cross2Icon,
  ReloadIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@radix-ui/react-icons';

import AudioPlayer from './AudioPlayer';
import WaveformDisplay from './WaveformDisplay';
import VariantSelector from './VariantSelector';
import PromptValidator from './PromptValidator';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { formatDuration } from '../../utils/timeFormat';

/**
 * Get audio file URL from asset
 * Supports multiple path formats from metadata
 */
function getAudioUrl(asset, audioType) {
  if (asset?.audioUrl) return asset.audioUrl;
  // Use path from metadata (e.g., "/assets/audio/music/regions/key.mp3")
  if (asset?.path) return asset.path;
  if (asset?.filePath) return `/assets/audio/${asset.filePath}`;
  if (asset?.key) {
    // Fallback with correct /assets prefix
    return `/assets/audio/${audioType}/${asset.key}.mp3`;
  }
  return null;
}

/**
 * Metadata row component
 */
function MetadataRow({ label, value, mono = false }) {
  if (value === undefined || value === null) return null;

  return (
    <div className="flex items-center justify-between py-2 border-b border-midnight-800">
      <span className="text-sm text-parchment-500">{label}</span>
      <span className={`text-sm text-parchment-200 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Main AudioDetail component
 *
 * @param {Object} props - Component props
 * @param {Object} props.asset - Audio asset object
 * @param {string} props.audioType - 'music' or 'sfx'
 * @param {boolean} props.open - Whether panel is open
 * @param {Function} props.onClose - Close callback
 * @param {Function} props.onUpdate - Update callback
 * @param {boolean} [props.showVariants] - Show variant selector (music only)
 */
export default function AudioDetail({
  asset,
  audioType,
  open,
  onClose,
  onUpdate,
  showVariants = false,
}) {
  // Toast notifications
  const toast = useToast();

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    prompt: '',
    volume: 1.0,
    notes: '',
    selectedVariantId: null,
  });

  // UI state
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Initialize form data when asset changes
  useEffect(() => {
    if (asset) {
      // Music uses sunoPrompt, SFX uses prompt
      const promptValue = audioType === 'music'
        ? (asset.sunoPrompt || asset.prompt || '')
        : (asset.prompt || '');

      setFormData({
        name: asset.name || asset.key || '',
        prompt: promptValue,
        volume: asset.volume ?? 1.0,
        notes: asset.notes || '',
        selectedVariantId: asset.selectedVariantId || asset.primaryVariantId || null,
      });
    }
  }, [asset, audioType]);

  // Get audio URL
  const audioUrl = useMemo(() =>
    asset ? getAudioUrl(asset, audioType) : null,
    [asset, audioType]
  );

  // Check if asset is generated
  const isGenerated = asset?.generated === true;

  // Get asset ID
  const assetId = asset?.key || asset?.id;

  // Get waveform peaks
  const peaks = asset?.peaks || asset?.waveform || [];

  // Get variants for music tracks
  const variants = useMemo(() => {
    if (!showVariants || audioType !== 'music' || !asset?.variants) {
      return [];
    }
    return asset.variants.map((v) => ({
      id: v.id || v.variantId,
      // Use path from metadata first, then fall back to url/audioUrl
      url: v.path || v.url || v.audioUrl,
      duration: v.duration,
      filename: v.filename,
      isPrimary: v.isPrimary || false,
    }));
  }, [showVariants, audioType, asset?.variants]);

  /**
   * Handle form field changes
   */
  const handleChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  /**
   * Save changes
   */
  const handleSave = async () => {
    if (!asset) return;

    setSaving(true);

    try {
      const updates = {
        name: formData.name,
        volume: parseFloat(formData.volume) || 1.0,
        notes: formData.notes,
      };

      // Music uses sunoPrompt, SFX uses prompt
      if (audioType === 'music') {
        updates.sunoPrompt = formData.prompt;
      } else {
        updates.prompt = formData.prompt;
      }

      // Include selected variant for music
      if (showVariants && formData.selectedVariantId) {
        updates.primaryVariant = formData.selectedVariantId;
      }

      await api.updateAudioAsset(audioType, assetId, updates);
      toast.success('Audio asset saved');
      onUpdate?.();
    } catch (err) {
      toast.error(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Regenerate audio asset
   */
  const handleRegenerate = async () => {
    if (!asset) return;

    setRegenerating(true);

    try {
      await api.generateAudio(audioType, { keys: [assetId] }, { force: true });
      toast.success('Queued for regeneration');
      onUpdate?.();
    } catch (err) {
      toast.error(err.message || 'Failed to queue regeneration');
    } finally {
      setRegenerating(false);
    }
  };

  /**
   * Handle variant selection
   */
  const handleVariantSelect = useCallback((variantId) => {
    handleChange('selectedVariantId', variantId);
  }, [handleChange]);

  /**
   * Handle prompt change (with validation for SFX)
   */
  const handlePromptChange = useCallback((value) => {
    handleChange('prompt', value);
  }, [handleChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />

        {/* Slide-over panel */}
        <Dialog.Content
          aria-describedby="audio-detail-description"
          className="fixed top-0 right-0 h-full w-full max-w-lg
                     bg-midnight-900 border-l border-midnight-700 shadow-xl z-50
                     flex flex-col focus:outline-none
                     data-[state=open]:animate-slideInRight
                     data-[state=closed]:animate-slideOutRight"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-midnight-700">
            <Dialog.Title className="text-lg font-display font-semibold text-parchment-100 truncate">
              {assetId || 'Audio Details'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg transition-colors"
                aria-label="Close panel"
              >
                <Cross2Icon className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <p id="audio-detail-description" className="sr-only">
              View and edit audio asset metadata including prompt, volume, and regeneration options.
            </p>

            {!asset ? (
              <div className="text-center py-12 text-parchment-400">
                No audio asset selected
              </div>
            ) : (
              <div className="space-y-6">
                {/* Waveform visualization */}
                <div className="bg-midnight-950 rounded-lg p-4 border border-midnight-700">
                  {isGenerated && peaks.length > 0 ? (
                    <WaveformDisplay
                      peaks={peaks}
                      height={80}
                      showProgress={false}
                    />
                  ) : (
                    <div className="h-20 flex items-center justify-center">
                      <WaveformDisplay
                        peaks={[]}
                        height={80}
                        showProgress={false}
                        colors={{ waveform: '#3d3d4f' }}
                      />
                    </div>
                  )}
                </div>

                {/* Audio player */}
                {isGenerated && audioUrl && (
                  <AudioPlayer
                    src={audioUrl}
                    className="p-4 bg-midnight-800 rounded-lg border border-midnight-700"
                  />
                )}

                {/* Not generated notice */}
                {!isGenerated && (
                  <div className="p-4 bg-midnight-800 rounded-lg border border-midnight-700 text-center">
                    <ExclamationTriangleIcon className="w-8 h-8 text-parchment-500 mx-auto mb-2" />
                    <p className="text-parchment-400">Not yet generated</p>
                  </div>
                )}

                {/* Status badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`badge ${isGenerated ? 'badge-success' : 'badge-warning'}`}
                  >
                    {isGenerated ? 'Generated' : 'Pending'}
                  </span>
                  <span className="badge bg-midnight-700 text-parchment-300 capitalize">
                    {audioType}
                  </span>
                  {asset._subcategory && (
                    <span className="badge bg-accent-sapphire/20 text-accent-sapphire capitalize">
                      {asset._subcategory.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {/* Metadata section */}
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-parchment-300 mb-2">
                    Metadata
                  </h4>
                  <MetadataRow label="Key" value={assetId} mono />
                  <MetadataRow
                    label="Duration"
                    value={asset.duration ? formatDuration(asset.duration) : '--'}
                    mono
                  />
                  <MetadataRow
                    label="File Size"
                    value={asset.fileSize ? `${(asset.fileSize / 1024).toFixed(1)} KB` : '--'}
                  />
                  {asset.createdAt && (
                    <MetadataRow
                      label="Created"
                      value={new Date(asset.createdAt).toLocaleDateString()}
                    />
                  )}
                </div>

                {/* Variant selector (music only) */}
                {showVariants && variants.length > 0 && (
                  <VariantSelector
                    variants={variants}
                    selectedId={formData.selectedVariantId}
                    onSelect={handleVariantSelect}
                    className="p-4 bg-midnight-800 rounded-lg border border-midnight-700"
                  />
                )}

                {/* Name field */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-parchment-300">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                               text-parchment-100 placeholder-parchment-500
                               focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                    placeholder="Enter display name..."
                  />
                </div>

                {/* Prompt field */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-parchment-300">
                    Generation Prompt
                  </label>
                  {audioType === 'sfx' ? (
                    // Use PromptValidator for SFX to enforce comma restrictions
                    <PromptValidator
                      value={formData.prompt}
                      onChange={handlePromptChange}
                      placeholder="Enter SFX prompt (max 1 comma)..."
                    />
                  ) : (
                    // Regular textarea for music
                    <textarea
                      value={formData.prompt}
                      onChange={(e) => handleChange('prompt', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-100 placeholder-parchment-500 resize-none
                                 focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                      placeholder="Enter music prompt..."
                    />
                  )}
                </div>

                {/* Volume slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-parchment-300">
                      Volume
                    </label>
                    <span className="text-sm text-parchment-400 font-mono">
                      {(formData.volume * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={formData.volume}
                    onChange={(e) => handleChange('volume', parseFloat(e.target.value))}
                    className="w-full h-2 bg-midnight-700 rounded-lg appearance-none cursor-pointer
                               [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                               [&::-webkit-slider-thumb]:bg-accent-gold [&::-webkit-slider-thumb]:rounded-full
                               [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform
                               [&::-webkit-slider-thumb]:hover:scale-110"
                  />
                  <p className="text-xs text-parchment-500">
                    1.0 = normal, 0.5 = half volume, 2.0 = double volume
                  </p>
                </div>

                {/* Notes field */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-parchment-300">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                               text-parchment-100 placeholder-parchment-500 resize-none
                               focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                    placeholder="Additional notes..."
                  />
                </div>

                {/* Task info for pending tracks */}
                {asset.taskId && !isGenerated && (
                  <div className="p-4 bg-midnight-800 rounded-lg border border-midnight-700 space-y-2">
                    <h4 className="text-sm font-medium text-parchment-300 flex items-center gap-2">
                      <ClockIcon className="w-4 h-4 text-accent-gold" />
                      Generation in Progress
                    </h4>
                    <div className="text-xs text-parchment-500">
                      <p>Task ID: <code className="font-mono text-parchment-400">{asset.taskId}</code></p>
                      {asset.taskStatus && (
                        <p>Status: <span className="text-accent-gold capitalize">{asset.taskStatus}</span></p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer actions */}
          {asset && (
            <div className="px-6 py-4 border-t border-midnight-700 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-gold flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <ReloadIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckIcon className="w-4 h-4" />
                )}
                Save
              </button>

              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="btn-ghost flex items-center gap-2 disabled:opacity-50"
              >
                {regenerating ? (
                  <ReloadIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <ReloadIcon className="w-4 h-4" />
                )}
                Regenerate
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
