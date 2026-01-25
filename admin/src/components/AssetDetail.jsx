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
import { DEFAULT_SIZES, SIZE_PRESETS } from '@shared/assetPaths.js';
import { getAssetSubcategory, getAssetExtraOptions, getAssetUrlsWithFallback } from '../lib/assetPathHelper.js';

/**
 * Category-specific size options for preview
 * Uses SIZE_PRESETS from shared assetPaths module
 */
const CATEGORY_SIZE_OPTIONS = SIZE_PRESETS;

/**
 * Get image URLs for asset preview using canonical paths with fallback
 * Returns an array of URLs to try in order (canonical first, then legacy)
 *
 * @param {Object} asset - The asset object
 * @param {string} category - Asset category
 * @param {number} size - Size variant to use
 * @returns {string[]} Array of URLs to try
 */
function getAssetImageUrls(asset, category, size) {
  const id = asset.key || asset.id;
  const subcategory = getAssetSubcategory(asset, category);
  const extraOptions = getAssetExtraOptions(asset, category);

  return getAssetUrlsWithFallback(category, id, {
    subcategory,
    size,
    ...extraOptions
  });
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
 * Read-only prompt section component
 */
function PromptSection({ label, value, readOnly = true, hint = null }) {
  if (!value) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-parchment-400">{label}</h4>
        {readOnly && (
          <span className="text-xs px-2 py-0.5 bg-midnight-700 text-parchment-500 rounded">
            Read-only
          </span>
        )}
      </div>
      <div
        className={`p-3 border rounded-lg text-sm whitespace-pre-wrap ${
          readOnly
            ? 'bg-midnight-950 border-midnight-800 text-parchment-400'
            : 'bg-midnight-800 border-midnight-700 text-parchment-200'
        }`}
      >
        {value}
      </div>
      {hint && <p className="text-xs text-parchment-600 mt-1">{hint}</p>}
    </div>
  );
}

/**
 * Trait component breakdown for portraits
 */
function TraitComponents({ components, isEnemy = false }) {
  if (!components) return null;

  if (isEnemy) {
    return (
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-parchment-400">Enemy Trait Components</h4>
        <div className="grid gap-2">
          {components.visualTraits?.value && (
            <div className="flex items-start gap-2">
              <span className="text-xs px-2 py-0.5 bg-accent-ruby/20 text-accent-ruby rounded shrink-0">
                Visual
              </span>
              <span className="text-sm text-parchment-300">{components.visualTraits.value}</span>
            </div>
          )}
          {components.archetype?.value && (
            <div className="flex items-start gap-2">
              <span className="text-xs px-2 py-0.5 bg-accent-sapphire/20 text-accent-sapphire rounded shrink-0">
                {components.archetype.key}
              </span>
              <span className="text-sm text-parchment-300">{components.archetype.value}</span>
            </div>
          )}
          {components.region?.value && (
            <div className="flex items-start gap-2">
              <span className="text-xs px-2 py-0.5 bg-accent-emerald/20 text-accent-emerald rounded shrink-0">
                {components.region.key}
              </span>
              <span className="text-sm text-parchment-300">{components.region.value}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-parchment-400">Portrait Trait Components</h4>
      <div className="grid gap-2">
        {components.race?.value && (
          <div className="flex items-start gap-2">
            <span className="text-xs px-2 py-0.5 bg-accent-gold/20 text-accent-gold rounded shrink-0">
              {components.race.key}
            </span>
            <span className="text-sm text-parchment-300">{components.race.value}</span>
          </div>
        )}
        {components.gender?.value && (
          <div className="flex items-start gap-2">
            <span className="text-xs px-2 py-0.5 bg-accent-sapphire/20 text-accent-sapphire rounded shrink-0">
              {components.gender.key}
            </span>
            <span className="text-sm text-parchment-300">{components.gender.value}</span>
          </div>
        )}
        {components.class?.value && (
          <div className="flex items-start gap-2">
            <span className="text-xs px-2 py-0.5 bg-accent-emerald/20 text-accent-emerald rounded shrink-0">
              {components.class.key}
              {components.class.isAdvanced && ' ★'}
            </span>
            <span className="text-sm text-parchment-300">{components.class.value}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Full prompt preview modal with structured sections
 */
function FullPromptModal({ open, onClose, promptData, loading, category, error }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (promptData?.fullPrompt) {
      navigator.clipboard.writeText(promptData.fullPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isEnemy = promptData?.traitComponents?.archetype !== undefined;
  const isPortrait = category === 'portraits';

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
        <Dialog.Content
          aria-describedby="prompt-modal-description"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[90vw] max-w-2xl max-h-[85vh] overflow-y-auto
                     bg-midnight-900 border border-midnight-700 rounded-lg shadow-xl z-[70]
                     focus:outline-none"
        >
          <div className="p-6">
            <Dialog.Title className="text-lg font-display font-semibold text-parchment-100 mb-2">
              Prompt Construction
            </Dialog.Title>
            <p id="prompt-modal-description" className="text-sm text-parchment-500 mb-4">
              Shows how the final prompt is constructed from theme and asset metadata.
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <ReloadIcon className="w-6 h-6 text-parchment-400 animate-spin" />
              </div>
            ) : promptData ? (
              <div className="space-y-4">
                {/* Style Trigger */}
                <PromptSection
                  label="Style Trigger (LoRA)"
                  value={promptData.styleTrigger}
                  hint="Triggers the trained style model"
                />

                {/* Style Base */}
                <PromptSection
                  label="Style Base"
                  value={promptData.styleBase}
                  hint="Base style description from theme"
                />

                {/* Trait Components (portraits only) */}
                {isPortrait && promptData.traitComponents && (
                  <div className="p-3 bg-midnight-800/50 border border-midnight-700 rounded-lg">
                    <TraitComponents components={promptData.traitComponents} isEnemy={isEnemy} />
                  </div>
                )}

                {/* Base Prompt */}
                <PromptSection
                  label="Base Prompt"
                  value={promptData.basePrompt}
                  readOnly={false}
                  hint={isPortrait ? 'Constructed from traits above' : 'Custom prompt for this asset'}
                />

                {/* Category Suffix */}
                <PromptSection
                  label="Category Suffix"
                  value={promptData.categorySuffix}
                  hint={`Standard suffix for ${category}`}
                />

                {/* Full Prompt */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-accent-gold">Full Constructed Prompt</h4>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="text-xs px-2 py-1 bg-midnight-700 text-parchment-300 rounded hover:bg-midnight-600 transition-colors"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="p-3 bg-midnight-800 border border-accent-gold/30 rounded-lg text-parchment-100 text-sm whitespace-pre-wrap">
                    {promptData.fullPrompt || 'Unable to construct prompt'}
                  </div>
                </div>

                {/* Negative Prompt */}
                {promptData.negativePrompt && (
                  <PromptSection
                    label="Negative Prompt"
                    value={promptData.negativePrompt}
                    hint="Things to avoid in generation"
                  />
                )}
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-2 text-accent-ruby" />
                <p className="text-accent-ruby">Failed to load prompt data</p>
                <p className="text-parchment-500 text-sm mt-1">{error}</p>
              </div>
            ) : (
              <div className="text-center py-8 text-parchment-500">
                No prompt data available
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
    loraModel: '', // Empty string means use category default
  });

  // Config state for LoRA models
  const [loraConfig, setLoraConfig] = useState({
    loraModels: {},       // { v1: { name, triggerWord, description }, ... }
    categoryDefaults: {}, // { tiles: 'v2', portraits: 'v1', ... }
    loading: true,
  });

  // UI state - preview size will be initialized per category
  const [previewSize, setPreviewSize] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [fullPromptData, setFullPromptData] = useState({ loading: false, prompt: '' });

  // Load LoRA config on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await api.getConfig();
        // API returns validLoraModels (array), loraModels (full metadata), and defaultLoraByCategory (object)
        setLoraConfig({
          // Use full model metadata from API (includes name, triggerWord, description)
          loraModels: config.loraModels || {},
          categoryDefaults: config.defaultLoraByCategory || {},
          loading: false,
        });
      } catch (err) {
        console.error('Failed to load LoRA config:', err);
        setLoraConfig(prev => ({ ...prev, loading: false }));
      }
    }
    loadConfig();
  }, []);

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
        loraModel: asset.loraModel || '', // Empty string means use category default
      });
      setImageError(false);
    }
  }, [asset]);

  // Set default preview size when category changes
  useEffect(() => {
    if (category) {
      setPreviewSize(DEFAULT_SIZES[category] || 64);
    }
  }, [category]);

  // Get available size options for this category
  const sizeOptions = useMemo(() =>
    CATEGORY_SIZE_OPTIONS[category] || [64],
    [category]
  );

  // Get image URLs with fallback support (memoized for performance)
  const imageUrls = useMemo(() =>
    asset && previewSize ? getAssetImageUrls(asset, category, previewSize) : [],
    [asset, category, previewSize]
  );

  // Track current fallback URL index
  const [fallbackIndex, setFallbackIndex] = useState(0);

  // Reset fallback index when asset or size changes
  useEffect(() => {
    setFallbackIndex(0);
  }, [asset, previewSize]);

  /**
   * Get the current image URL to display
   * Returns the URL at the current fallback index
   */
  const getImageUrl = useCallback((size) => {
    if (!asset) return null;
    const urls = getAssetImageUrls(asset, category, size);
    return urls[fallbackIndex] || urls[0] || null;
  }, [asset, category, fallbackIndex]);

  /**
   * Handle image load error - try next URL in fallback list
   */
  const handleImageError = useCallback(() => {
    if (fallbackIndex < imageUrls.length - 1) {
      setFallbackIndex(prev => prev + 1);
    } else {
      setImageError(true);
    }
  }, [fallbackIndex, imageUrls.length]);

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
        // Only include loraModel if explicitly set (non-empty), otherwise use category default
        loraModel: formData.loraModel || null,
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

  // Preview full prompt with theme - uses API endpoint for structured breakdown
  const handlePreviewFullPrompt = async () => {
    setShowFullPrompt(true);
    setFullPromptData({ loading: true, data: null });

    try {
      const assetKey = asset?.key || asset?.id;
      const promptData = await api.getAssetPrompt(category, assetKey);
      setFullPromptData({
        loading: false,
        data: promptData,
      });
    } catch (err) {
      console.error('Failed to load prompt data:', err);
      setFullPromptData({
        loading: false,
        data: null,
        error: err.message,
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
            aria-describedby="asset-detail-description"
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
              <p id="asset-detail-description" className="sr-only">
                View and edit asset metadata including prompt, seed, evaluation, and regeneration options.
              </p>
              {!asset ? (
                <div className="text-center py-12 text-parchment-400">
                  No asset selected
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Image Preview */}
                  <div className="space-y-3">
                    <div className="aspect-square bg-midnight-950 rounded-lg overflow-hidden flex items-center justify-center border border-midnight-700">
                      {isGenerated && !imageError && previewSize ? (
                        <img
                          src={getImageUrl(previewSize)}
                          alt={assetId}
                          onError={handleImageError}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div className="text-center text-parchment-500 px-4">
                          <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-2" />
                          <p className="font-medium">
                            {!isGenerated ? 'Not yet generated' : 'Image not found'}
                          </p>
                          {isGenerated && imageError && previewSize && (
                            <p className="text-xs mt-2 text-parchment-600 break-all">
                              Tried: {imageUrls.join(', ')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Size switcher - only show if multiple sizes available */}
                    {sizeOptions.length > 1 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-parchment-400">Size:</span>
                        {sizeOptions.map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => {
                              setPreviewSize(size);
                              setImageError(false);
                              setFallbackIndex(0);
                            }}
                            className={`
                              px-3 py-1 text-sm rounded-lg transition-colors
                              ${previewSize === size
                                ? 'bg-accent-gold text-midnight-950'
                                : 'bg-midnight-800 text-parchment-300 hover:bg-midnight-700'}
                            `}
                          >
                            {size}px
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Show asset info for single-size categories */}
                    {sizeOptions.length === 1 && (
                      <div className="text-sm text-parchment-500">
                        Size: {sizeOptions[0]}px (original)
                      </div>
                    )}
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

                  {/* Portrait Trait Summary (for portraits only) */}
                  {category === 'portraits' && asset?.promptComponents && (
                    <div className="p-3 bg-midnight-800/50 border border-midnight-700 rounded-lg">
                      <h4 className="text-xs font-medium text-parchment-500 mb-2 uppercase tracking-wide">
                        Trait Components
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {asset.promptComponents.race?.key && (
                          <span className="text-xs px-2 py-0.5 bg-accent-gold/20 text-accent-gold rounded">
                            {asset.promptComponents.race.key}
                          </span>
                        )}
                        {asset.promptComponents.gender?.key && (
                          <span className="text-xs px-2 py-0.5 bg-accent-sapphire/20 text-accent-sapphire rounded">
                            {asset.promptComponents.gender.key}
                          </span>
                        )}
                        {asset.promptComponents.class?.key && (
                          <span className="text-xs px-2 py-0.5 bg-accent-emerald/20 text-accent-emerald rounded">
                            {asset.promptComponents.class.key}
                            {asset.promptComponents.class.isAdvanced && ' ★'}
                          </span>
                        )}
                        {/* Enemy traits */}
                        {asset.promptComponents.archetype?.key && (
                          <span className="text-xs px-2 py-0.5 bg-accent-ruby/20 text-accent-ruby rounded">
                            {asset.promptComponents.archetype.key}
                          </span>
                        )}
                        {asset.promptComponents.region?.key && (
                          <span className="text-xs px-2 py-0.5 bg-accent-emerald/20 text-accent-emerald rounded">
                            {asset.promptComponents.region.key}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-parchment-600 mt-2">
                        These traits are combined to construct the base prompt.
                      </p>
                    </div>
                  )}

                  {/* Prompt */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-parchment-300">
                      {category === 'portraits' ? 'Custom Prompt Override' : 'Prompt'}
                    </label>
                    <textarea
                      value={formData.prompt}
                      onChange={(e) => handleChange('prompt', e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-100 placeholder-parchment-500 resize-none
                                 focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
                      placeholder={
                        category === 'portraits'
                          ? 'Optional: Override auto-generated prompt from traits...'
                          : 'Enter generation prompt...'
                      }
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

                  {/* Style Model (LoRA) */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-parchment-300">
                      Style Model
                    </label>
                    <select
                      value={formData.loraModel}
                      onChange={(e) => handleChange('loraModel', e.target.value)}
                      disabled={loraConfig.loading}
                      className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-200 focus:outline-none focus:border-accent-gold
                                 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <p className="text-xs text-parchment-500">
                      Default for {category}: {loraConfig.categoryDefaults[category]
                        ? `${loraConfig.loraModels[loraConfig.categoryDefaults[category]]?.name || loraConfig.categoryDefaults[category]}`
                        : 'loading...'}
                    </p>
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
        promptData={fullPromptData.data}
        loading={fullPromptData.loading}
        error={fullPromptData.error}
        category={category}
      />
    </>
  );
}
