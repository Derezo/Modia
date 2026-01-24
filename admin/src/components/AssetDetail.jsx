/**
 * AssetDetail - Slide-over panel for viewing and editing asset details
 * Uses Radix Dialog for accessibility and smooth animations
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Cross2Icon,
  StarIcon,
  StarFilledIcon,
  ReloadIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  EyeOpenIcon,
} from '@radix-ui/react-icons';

import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

/**
 * Size options for preview
 */
const SIZE_OPTIONS = [128, 256, 384, 512];

/**
 * Get the base image URL for an asset (without size suffix)
 */
function getAssetBasePath(asset, category) {
  const id = asset.key || asset.id;

  switch (category) {
    case 'tiles': {
      const biome = asset._biome || asset.outputPath || 'base';
      const tileCategory = asset._tileCategory || 'floors';
      return {
        dir: `/assets/sprites/terrain/${biome}/${tileCategory}`,
        filename: asset.key,
      };
    }
    case 'portraits': {
      if (asset._type === 'enemy' || asset.type === 'enemy') {
        return {
          dir: '/assets/sprites/enemies/portraits',
          filename: id,
        };
      }
      return {
        dir: '/assets/sprites/portraits',
        filename: id,
      };
    }
    case 'items': {
      const subcategory = asset._itemCategory || asset._subcategory || asset.subcategory || 'weapons';
      return {
        dir: `/assets/sprites/items/${subcategory}`,
        filename: id,
      };
    }
    case 'icons': {
      const subcategory = asset._iconCategory || asset._subcategory || asset.subcategory || 'actions';
      return {
        dir: `/assets/sprites/icons/${subcategory}`,
        filename: id,
      };
    }
    case 'nodes': {
      return {
        dir: '/assets/sprites/nodes',
        filename: id,
      };
    }
    case 'overlays': {
      const subcategory = asset._overlayCategory || asset._subcategory || asset.subcategory || 'rarity';
      return {
        dir: `/assets/sprites/overlays/${subcategory}`,
        filename: id,
      };
    }
    default:
      return { dir: '', filename: id };
  }
}

/**
 * Star rating component
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
        <span className="ml-2 text-sm text-parchment-400">{value}/5</span>
      )}
    </div>
  );
}

/**
 * Full prompt preview modal
 */
function FullPromptModal({ open, onClose, basePrompt, fullPrompt, loading }) {
  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[90vw] max-w-2xl max-h-[80vh] overflow-y-auto
                     bg-midnight-900 border border-midnight-700 rounded-lg shadow-xl z-[70]
                     focus:outline-none"
        >
          <div className="p-6">
            <Dialog.Title className="text-lg font-display font-semibold text-parchment-100 mb-4">
              Full Constructed Prompt
            </Dialog.Title>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <ReloadIcon className="w-6 h-6 text-parchment-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-parchment-400 mb-2">Base Prompt</h4>
                  <div className="p-3 bg-midnight-800 border border-midnight-700 rounded-lg text-parchment-200 text-sm">
                    {basePrompt || 'No prompt defined'}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-parchment-400 mb-2">
                    With Theme Modifiers
                  </h4>
                  <div className="p-3 bg-midnight-800 border border-midnight-700 rounded-lg text-parchment-200 text-sm whitespace-pre-wrap">
                    {fullPrompt || 'Theme not available'}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Dialog.Close asChild>
                <button type="button" className="btn-ghost">
                  Close
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Main AssetDetail component
 */
export default function AssetDetail({
  asset,
  category,
  open,
  onClose,
  onUpdate,
}) {
  // Toast notifications
  const toast = useToast();

  // Form state
  const [formData, setFormData] = useState({
    prompt: '',
    seed: '',
    evaluation: 0,
    issues: '',
    notes: '',
    priority: 0,
    needsRegeneration: false,
  });

  // UI state
  const [previewSize, setPreviewSize] = useState(256);
  const [imageError, setImageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [fullPromptData, setFullPromptData] = useState({ loading: false, prompt: '' });

  // Initialize form data when asset changes
  useEffect(() => {
    if (asset) {
      setFormData({
        prompt: asset.prompt || '',
        seed: asset.seed?.toString() || '',
        evaluation: asset.evaluation || 0,
        issues: asset.issues || '',
        notes: asset.notes || '',
        priority: asset.priority || 0,
        needsRegeneration: asset.needsRegeneration || false,
      });
      setImageError(false);
    }
  }, [asset]);

  // Get image paths (memoized to prevent useCallback recreation)
  const basePath = useMemo(() =>
    asset ? getAssetBasePath(asset, category) : null,
    [asset, category]
  );

  const getImageUrl = useCallback((size) => {
    if (!basePath) return null;
    if (size === 'original') {
      return `${basePath.dir}/${basePath.filename}.png`;
    }
    return `${basePath.dir}/${basePath.filename}_${size}.png`;
  }, [basePath]);

  // Handle form field changes
  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Save changes
  const handleSave = async () => {
    if (!asset) return;

    setSaving(true);

    try {
      const updates = {
        prompt: formData.prompt,
        seed: formData.seed ? parseInt(formData.seed, 10) : null,
        evaluation: formData.evaluation,
        issues: formData.issues,
        notes: formData.notes,
        priority: formData.priority,
        needsRegeneration: formData.needsRegeneration,
      };

      await api.updateAsset(category, asset.key || asset.id, updates);
      toast.success('Asset saved');
      onUpdate?.();
    } catch (err) {
      toast.error(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Regenerate asset
  const handleRegenerate = async () => {
    if (!asset) return;

    setRegenerating(true);

    try {
      await api.generateAssetsByIds(category, [asset.key || asset.id], { force: true });
      toast.success('Queued for regeneration');
      onUpdate?.();
    } catch (err) {
      toast.error(err.message || 'Failed to queue regeneration');
    } finally {
      setRegenerating(false);
    }
  };

  // Mark for regeneration
  const handleMarkForRegen = () => {
    handleChange('needsRegeneration', true);
  };

  // Preview full prompt with theme
  const handlePreviewFullPrompt = async () => {
    setShowFullPrompt(true);
    setFullPromptData({ loading: true, prompt: '' });

    try {
      const theme = await api.getTheme();
      // Construct full prompt with theme modifiers
      const basePrompt = formData.prompt || asset?.prompt || '';
      const themePrefix = theme?.globalPrefix || '';
      const themeSuffix = theme?.globalSuffix || '';
      const fullPrompt = [themePrefix, basePrompt, themeSuffix]
        .filter(Boolean)
        .join(' ');

      setFullPromptData({
        loading: false,
        basePrompt,
        prompt: fullPrompt || basePrompt,
      });
    } catch (err) {
      setFullPromptData({
        loading: false,
        basePrompt: formData.prompt,
        prompt: 'Failed to load theme: ' + err.message,
      });
    }
  };

  const assetId = asset?.key || asset?.id;
  const isGenerated = asset?.generated === true;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onClose}>
        <Dialog.Portal>
          {/* Overlay */}
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />

          {/* Slide-over panel */}
          <Dialog.Content
            className="fixed top-0 right-0 h-full w-full max-w-lg
                       bg-midnight-900 border-l border-midnight-700 shadow-xl z-50
                       flex flex-col focus:outline-none
                       data-[state=open]:animate-slideInRight
                       data-[state=closed]:animate-slideOutRight"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-midnight-700">
              <Dialog.Title className="text-lg font-display font-semibold text-parchment-100 truncate">
                {assetId || 'Asset Details'}
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
              {!asset ? (
                <div className="text-center py-12 text-parchment-400">
                  No asset selected
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Image Preview */}
                  <div className="space-y-3">
                    <div className="aspect-square bg-midnight-950 rounded-lg overflow-hidden flex items-center justify-center border border-midnight-700">
                      {isGenerated && !imageError ? (
                        <img
                          src={getImageUrl(previewSize)}
                          alt={assetId}
                          onError={() => setImageError(true)}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div className="text-center text-parchment-500">
                          <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-2" />
                          <p>{isGenerated ? 'Image not found' : 'Not yet generated'}</p>
                        </div>
                      )}
                    </div>

                    {/* Size switcher */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-parchment-400">Size:</span>
                      {SIZE_OPTIONS.map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => {
                            setPreviewSize(size);
                            setImageError(false);
                          }}
                          className={`
                            px-3 py-1 text-sm rounded-lg transition-colors
                            ${previewSize === size
                              ? 'bg-accent-gold text-midnight-950'
                              : 'bg-midnight-800 text-parchment-300 hover:bg-midnight-700'}
                          `}
                        >
                          {size}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewSize('original');
                          setImageError(false);
                        }}
                        className={`
                          px-3 py-1 text-sm rounded-lg transition-colors
                          ${previewSize === 'original'
                            ? 'bg-accent-gold text-midnight-950'
                            : 'bg-midnight-800 text-parchment-300 hover:bg-midnight-700'}
                        `}
                      >
                        Original
                      </button>
                    </div>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`badge ${isGenerated ? 'badge-success' : 'badge-warning'}`}
                    >
                      {isGenerated ? 'Generated' : 'Pending'}
                    </span>
                    {formData.needsRegeneration && (
                      <span className="badge badge-warning">Marked for Regen</span>
                    )}
                    {formData.priority > 0 && (
                      <span className="badge bg-accent-sapphire/20 text-accent-sapphire">
                        Priority: {formData.priority}
                      </span>
                    )}
                  </div>

                  {/* Prompt */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-parchment-300">
                      Prompt
                    </label>
                    <textarea
                      value={formData.prompt}
                      onChange={(e) => handleChange('prompt', e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-100 placeholder-parchment-500 resize-none
                                 focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                      placeholder="Enter generation prompt..."
                    />
                    <button
                      type="button"
                      onClick={handlePreviewFullPrompt}
                      className="btn-ghost text-sm flex items-center gap-2"
                    >
                      <EyeOpenIcon className="w-4 h-4" />
                      Preview Full Prompt
                    </button>
                  </div>

                  {/* Seed */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-parchment-300">
                      Seed
                    </label>
                    <input
                      type="number"
                      value={formData.seed}
                      onChange={(e) => handleChange('seed', e.target.value)}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-100 placeholder-parchment-500
                                 focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                      placeholder="Random seed for reproducibility"
                    />
                  </div>

                  {/* Evaluation Score */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-parchment-300">
                      Quality Score
                    </label>
                    <StarRating
                      value={formData.evaluation}
                      onChange={(val) => handleChange('evaluation', val)}
                    />
                  </div>

                  {/* Issues */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-parchment-300">
                      Issues
                    </label>
                    <input
                      type="text"
                      value={formData.issues}
                      onChange={(e) => handleChange('issues', e.target.value)}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-100 placeholder-parchment-500
                                 focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                      placeholder="Known issues with this asset..."
                    />
                  </div>

                  {/* Notes */}
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

                  {/* Priority */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-parchment-300">
                      Priority (0 = normal)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formData.priority}
                      onChange={(e) => handleChange('priority', parseInt(e.target.value, 10) || 0)}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-100 placeholder-parchment-500
                                 focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                    />
                  </div>

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

                <button
                  type="button"
                  onClick={handleMarkForRegen}
                  disabled={formData.needsRegeneration}
                  className="btn-ghost flex items-center gap-2 disabled:opacity-50"
                >
                  <ExclamationTriangleIcon className="w-4 h-4" />
                  Mark for Regen
                </button>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Full prompt preview modal */}
      <FullPromptModal
        open={showFullPrompt}
        onClose={() => setShowFullPrompt(false)}
        basePrompt={fullPromptData.basePrompt}
        fullPrompt={fullPromptData.prompt}
        loading={fullPromptData.loading}
      />
    </>
  );
}
