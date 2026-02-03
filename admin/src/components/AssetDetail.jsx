/**
 * @module AssetDetail
 * @description Slide-over panel for viewing and editing individual asset details.
 * Uses Radix Dialog for accessibility and smooth animations.
 *
 * Key responsibilities:
 * - Display asset metadata, preview images, and generation status
 * - Handle character sprite sheet preview with animation selection
 * - Manage asset regeneration requests and prompt editing
 * - Support frame description editing for SD1.5 animation generation
 * - Coordinate with asset path helpers for canonical URL construction
 *
 * Character animation support uses shared constants from @shared/assetPaths.js
 * for consistent animation lists across admin dashboard and generation scripts.
 *
 * @see AssetCard.jsx - Grid display component for asset thumbnails
 * @see SpritePreview.jsx - Animated sprite sheet preview component
 * @see FrameDescriptionEditor.jsx - SD1.5 frame prompt editing
 * @see @shared/assetPaths.js - Canonical path functions and CHARACTER_ANIMATIONS
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
  ImageIcon,
  CheckCircledIcon,
  PlayIcon,
} from '@radix-ui/react-icons';

import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { DEFAULT_SIZES, SIZE_PRESETS, getCharacterPath, CHARACTER_ANIMATIONS } from '@shared/assetPaths.js';
import { getAssetSubcategory, getAssetExtraOptions, getAssetUrls } from '../lib/assetPathHelper.js';
import SpritePreview from './SpritePreview.jsx';
import FrameDescriptionEditor from './FrameDescriptionEditor.jsx';

// Note: CHARACTER_ANIMATIONS is now imported from @shared/assetPaths.js
// It includes: idle, walk, attack, hurt, death, dead, cast, victory

/**
 * Weight preset definitions for SD1.5 generation
 */
const WEIGHT_PRESETS = {
  balanced: { label: 'Balanced', controlnetWeight: 0.7, ipadapterWeight: 0.7, description: 'Good balance of consistency and creativity' },
  maxConsistency: { label: 'Max Consistency', controlnetWeight: 0.9, ipadapterWeight: 0.9, description: 'Highest character consistency' },
  precisePoses: { label: 'Precise Poses', controlnetWeight: 0.9, ipadapterWeight: 0.5, description: 'Accurate poses, moderate style matching' },
  creative: { label: 'Creative', controlnetWeight: 0.5, ipadapterWeight: 0.5, description: 'More variation in outputs' },
};

/**
 * Category-specific size options for preview
 * Uses SIZE_PRESETS from shared assetPaths module
 */
const CATEGORY_SIZE_OPTIONS = SIZE_PRESETS;

/**
 * Get image URLs for asset preview using canonical paths
 *
 * @param {Object} asset - The asset object
 * @param {string} category - Asset category
 * @param {number} size - Size variant to use
 * @returns {string[]} Array of canonical URLs
 */
function getAssetImageUrls(asset, category, size) {
  const id = asset.key || asset.id;
  const subcategory = getAssetSubcategory(asset, category);
  const extraOptions = getAssetExtraOptions(asset, category);

  return getAssetUrls(category, id, {
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

// ============================================================================
// SD1.5 Animation Control Components (Characters only)
// ============================================================================

/**
 * AnimationSelector - Tabs for selecting which animation to preview
 */
function AnimationSelector({ animations, selectedAnimation, onSelect }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-parchment-300">
        Animation Preview
      </label>
      <div className="flex flex-wrap gap-1">
        {CHARACTER_ANIMATIONS.map((anim) => {
          const status = animations?.[anim];
          const isGenerated = status?.generated === true;
          const isSelected = selectedAnimation === anim;

          return (
            <button
              key={anim}
              type="button"
              onClick={() => onSelect(anim)}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-lg transition-all
                flex items-center gap-1.5
                ${isSelected
                  ? 'bg-accent-gold text-midnight-950'
                  : 'bg-midnight-800 text-parchment-300 hover:bg-midnight-700'}
              `}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isGenerated ? 'bg-accent-emerald' : 'bg-parchment-600'
                }`}
              />
              {anim}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * WeightSlider - Individual weight slider control
 */
function WeightSlider({ label, value, onChange, disabled = false }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-parchment-400">{label}</label>
        <span className="text-xs text-parchment-500">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full h-2 bg-midnight-700 rounded-lg appearance-none cursor-pointer
                   accent-accent-gold disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}

/**
 * WeightControls - Dual sliders with presets for SD1.5 weights
 */
function WeightControls({ weights, onWeightsChange, onPresetSelect, loading = false }) {
  const { controlnetWeight = 0.7, ipadapterWeight = 0.7 } = weights || {};

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-parchment-300">
        SD1.5 Generation Weights
      </label>

      {/* Weight sliders */}
      <div className="space-y-3 p-3 bg-midnight-800/50 border border-midnight-700 rounded-lg">
        <WeightSlider
          label="ControlNet Weight"
          value={controlnetWeight}
          onChange={(v) => onWeightsChange({ ...weights, controlnetWeight: v })}
          disabled={loading}
        />
        <WeightSlider
          label="IP-Adapter Weight"
          value={ipadapterWeight}
          onChange={(v) => onWeightsChange({ ...weights, ipadapterWeight: v })}
          disabled={loading}
        />
      </div>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1">
        {Object.entries(WEIGHT_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={() => onPresetSelect(key, preset)}
            disabled={loading}
            className="px-2 py-1 text-xs bg-midnight-800 text-parchment-400 rounded
                       hover:bg-midnight-700 hover:text-parchment-200 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
            title={preset.description}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * SD15LoraSelector - Dropdown for selecting SD1.5 LoRA models
 * Used for both reference image and animation generation
 */
function SD15LoraSelector({ label, value, onChange, models, defaultModel, loading = false, hint = null }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-parchment-300">
        {label}
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                   text-parchment-200 text-sm focus:outline-none focus:border-accent-gold
                   cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">
          Default ({models[defaultModel]?.name || defaultModel})
        </option>
        {Object.entries(models).map(([modelId, model]) => (
          <option key={modelId} value={modelId}>
            {model.name}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs text-parchment-500">{hint}</p>}
    </div>
  );
}

/**
 * Reference pose options for SD1.5 generation
 */
const REFERENCE_POSE_OPTIONS = {
  idle: { label: 'Idle Pose', description: 'Neutral standing pose' },
  tpose: { label: 'T-Pose', description: 'Arms at 45 degrees - better for clothing details' },
};

/**
 * ReferenceImageManager - Shows reference image status and generation controls
 */
function ReferenceImageManager({ characterId: _characterId, referenceStatus, onGenerate, loading = false }) {
  const hasReference = referenceStatus?.exists === true;
  const [selectedPose, setSelectedPose] = useState('idle');

  // Call onGenerate with the selected pose (and force=true if regenerating)
  const handleGenerate = () => {
    onGenerate({
      referencePose: selectedPose,
      force: hasReference  // Force regeneration if reference already exists
    });
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-parchment-300">
        Reference Image
      </label>
      <div className="p-3 bg-midnight-800/50 border border-midnight-700 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasReference ? (
              <>
                <CheckCircledIcon className="w-4 h-4 text-accent-emerald" />
                <span className="text-sm text-parchment-300">Reference available</span>
              </>
            ) : (
              <>
                <ImageIcon className="w-4 h-4 text-parchment-500" />
                <span className="text-sm text-parchment-400">No reference image</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedPose}
              onChange={(e) => setSelectedPose(e.target.value)}
              disabled={loading}
              className="px-2 py-1 text-xs bg-midnight-700 border border-midnight-600 rounded
                         text-parchment-300 focus:outline-none focus:border-accent-gold
                         cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={REFERENCE_POSE_OPTIONS[selectedPose]?.description}
            >
              {Object.entries(REFERENCE_POSE_OPTIONS).map(([pose, { label }]) => (
                <option key={pose} value={pose}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="px-3 py-1 text-xs bg-midnight-700 text-parchment-300 rounded
                         hover:bg-midnight-600 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center gap-1.5"
            >
              {loading ? (
                <ReloadIcon className="w-3 h-3 animate-spin" />
              ) : (
                <ReloadIcon className="w-3 h-3" />
              )}
              {hasReference ? 'Regenerate' : 'Generate'}
            </button>
          </div>
        </div>
        {hasReference && referenceStatus?.path && (
          <div className="mt-2 pt-2 border-t border-midnight-700">
            <img
              src={referenceStatus.path}
              alt="Reference"
              className="w-16 h-16 object-contain rounded bg-midnight-900"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * AnimationGenerationControls - Selective animation generation
 */
function AnimationGenerationControls({
  animations,
  selectedAnimations,
  onSelectionChange,
  onGenerate,
  loading = false,
}) {
  const handleToggle = (anim) => {
    const newSelection = new Set(selectedAnimations);
    if (newSelection.has(anim)) {
      newSelection.delete(anim);
    } else {
      newSelection.add(anim);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    onSelectionChange(new Set(CHARACTER_ANIMATIONS));
  };

  const handleSelectPending = () => {
    const pending = CHARACTER_ANIMATIONS.filter(
      (anim) => animations?.[anim]?.generated !== true
    );
    onSelectionChange(new Set(pending));
  };

  const pendingCount = CHARACTER_ANIMATIONS.filter(
    (anim) => animations?.[anim]?.generated !== true
  ).length;

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-parchment-300">
        Generate Animations
      </label>

      {/* Selection checkboxes */}
      <div className="grid grid-cols-4 gap-2 p-3 bg-midnight-800/50 border border-midnight-700 rounded-lg">
        {CHARACTER_ANIMATIONS.map((anim) => {
          const status = animations?.[anim];
          const isGenerated = status?.generated === true;
          const isSelected = selectedAnimations.has(anim);

          return (
            <label
              key={anim}
              className={`
                flex items-center gap-2 p-2 rounded cursor-pointer
                transition-colors text-xs
                ${isSelected ? 'bg-midnight-700' : 'hover:bg-midnight-800'}
              `}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleToggle(anim)}
                className="w-3.5 h-3.5 rounded border-midnight-600 bg-midnight-800
                           text-accent-gold focus:ring-accent-gold/30"
              />
              <span className={isGenerated ? 'text-parchment-300' : 'text-parchment-500'}>
                {anim}
              </span>
            </label>
          );
        })}
      </div>

      {/* Quick select buttons and generate */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSelectAll}
          className="px-2 py-1 text-xs bg-midnight-800 text-parchment-400 rounded
                     hover:bg-midnight-700 transition-colors"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={handleSelectPending}
          disabled={pendingCount === 0}
          className="px-2 py-1 text-xs bg-midnight-800 text-parchment-400 rounded
                     hover:bg-midnight-700 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Select Pending ({pendingCount})
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onGenerate}
          disabled={loading || selectedAnimations.size === 0}
          className="btn-gold text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <ReloadIcon className="w-4 h-4 animate-spin" />
          ) : (
            <PlayIcon className="w-4 h-4" />
          )}
          Generate ({selectedAnimations.size})
        </button>
      </div>
    </div>
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

  // Config state for LoRA models (Flux for assets, SD1.5 for character animations)
  const [loraConfig, setLoraConfig] = useState({
    loraModels: {},           // Flux: { v1: { name, triggerWord, description }, ... }
    categoryDefaults: {},     // Flux: { tiles: 'v2', portraits: 'v1', ... }
    sd15LoraModels: {},       // SD1.5: { pixel-art-xl: { name, description }, ... }
    sd15Defaults: {           // SD1.5 defaults for character animations
      loraModel: 'pixel-art-xl',
      referenceLoraModel: 'pixel-art-xl'
    },
    backgroundRemoval: {      // Background removal config
      availableModels: [],
    },
    loading: true,
  });

  // Background removal reprocessing state
  const [reprocessModel, setReprocessModel] = useState('');
  const [reprocessing, setReprocessing] = useState(false);

  // UI state - preview size will be initialized per category
  const [previewSize, setPreviewSize] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [fullPromptData, setFullPromptData] = useState({ loading: false, prompt: '' });

  // SD1.5 Animation state (characters only)
  const [selectedAnimation, setSelectedAnimation] = useState('idle');
  const [animationData, setAnimationData] = useState(null);
  const [animationWeights, setAnimationWeights] = useState({ controlnetWeight: 0.7, ipadapterWeight: 0.7 });
  const [referenceStatus, setReferenceStatus] = useState(null);
  const [selectedAnimationsForGen, setSelectedAnimationsForGen] = useState(new Set());
  const [animationLoading, setAnimationLoading] = useState(false);
  const [weightsLoading, setWeightsLoading] = useState(false);
  const [referenceLoading, setReferenceLoading] = useState(false);
  // SD1.5 LoRA model selections (null = use default from config)
  const [sd15Config, setSd15Config] = useState({
    referenceLoraModel: null, // LoRA for generating the reference image
    animationLoraModel: null, // LoRA for generating animation frames
  });

  // Frame description overrides state
  const [frameDescriptionData, setFrameDescriptionData] = useState(null);
  const [frameDescriptionLoading, setFrameDescriptionLoading] = useState(false);

  // Load LoRA config on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await api.getConfig();
        // API returns validLoraModels (array), loraModels (full metadata), defaultLoraByCategory (object),
        // SD1.5 models (sd15LoraModels, sd15Defaults), and backgroundRemoval config
        setLoraConfig({
          // Flux LoRA models (for static assets)
          loraModels: config.loraModels || {},
          categoryDefaults: config.defaultLoraByCategory || {},
          // SD1.5 LoRA models (for character animations)
          sd15LoraModels: config.sd15LoraModels || {},
          sd15Defaults: config.sd15Defaults || {
            loraModel: 'pixel-art-xl',
            referenceLoraModel: 'pixel-art-xl'
          },
          // Background removal models
          backgroundRemoval: config.backgroundRemoval || { availableModels: [] },
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

  // Load animation data for characters
  const isCharacter = category === 'characters';
  const characterId = asset?.key || asset?.id;

  useEffect(() => {
    if (!isCharacter || !characterId || !open) return;

    async function loadAnimationData() {
      try {
        const [animData, refData, presetsData] = await Promise.all([
          api.getCharacterAnimations(characterId).catch(() => null),
          api.getReferenceImageStatus(characterId).catch(() => null),
          api.getWeightPresets(characterId).catch(() => null),
        ]);

        if (animData?.animations) {
          // API returns animations as array, but frontend expects object keyed by animation name
          // Transform: [{animation: 'idle', generated: true}, ...] → {idle: {animation: 'idle', generated: true}, ...}
          if (Array.isArray(animData.animations)) {
            const animationObj = {};
            for (const anim of animData.animations) {
              if (anim.animation) {
                animationObj[anim.animation] = anim;
              }
            }
            setAnimationData(animationObj);
          } else {
            setAnimationData(animData.animations);
          }
        }
        if (refData) {
          setReferenceStatus(refData);
          // Load saved LoRA selections from sd15Weights
          if (refData.sd15Weights) {
            setSd15Config({
              referenceLoraModel: refData.sd15Weights.referenceLoraModel || null,
              animationLoraModel: refData.sd15Weights.animationLoraModel || null,
            });
          }
        }
        if (presetsData?.current) {
          setAnimationWeights(presetsData.current);
        }
      } catch (err) {
        console.error('Failed to load animation data:', err);
      }
    }

    loadAnimationData();
  }, [isCharacter, characterId, open]);

  // Reset animation state when asset changes
  useEffect(() => {
    setSelectedAnimation('idle');
    setSelectedAnimationsForGen(new Set());
    setAnimationData(null);
    setReferenceStatus(null);
    setFrameDescriptionData(null);
    // Reset SD1.5 LoRA selections (will use defaults)
    setSd15Config({
      referenceLoraModel: null,
      animationLoraModel: null,
    });
  }, [characterId]);

  // Load frame descriptions for characters
  useEffect(() => {
    if (!isCharacter || !characterId || !open) return;

    async function loadFrameDescriptions() {
      try {
        const data = await api.getFrameDescriptions(characterId);
        setFrameDescriptionData(data);
      } catch (err) {
        console.error('Failed to load frame descriptions:', err);
      }
    }

    loadFrameDescriptions();
  }, [isCharacter, characterId, open]);

  /**
   * Handle weight preset selection
   */
  const handlePresetSelect = useCallback(async (presetKey, preset) => {
    if (!characterId) return;

    const newWeights = {
      controlnetWeight: preset.controlnetWeight,
      ipadapterWeight: preset.ipadapterWeight,
    };

    setAnimationWeights(newWeights);

    // Save to API
    setWeightsLoading(true);
    try {
      await api.updateCharacterWeights(characterId, newWeights);
      toast.success(`Applied "${preset.label}" preset`);
    } catch (err) {
      toast.error(err.message || 'Failed to update weights');
    } finally {
      setWeightsLoading(false);
    }
  }, [characterId, toast]);

  /**
   * Handle weights change (from sliders)
   */
  const handleWeightsChange = useCallback(async (newWeights) => {
    setAnimationWeights(newWeights);

    // Debounce API calls for slider changes would be ideal here
    // For now, we'll save on blur or preset selection
  }, []);

  /**
   * Save current weights to API
   */
  const saveWeights = useCallback(async () => {
    if (!characterId) return;

    setWeightsLoading(true);
    try {
      await api.updateCharacterWeights(characterId, animationWeights);
      toast.success('Weights saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save weights');
    } finally {
      setWeightsLoading(false);
    }
  }, [characterId, animationWeights, toast]);

  /**
   * Handle SD1.5 LoRA model change - updates local state and saves to backend
   * @param {'referenceLoraModel' | 'animationLoraModel'} field - Which LoRA field to update
   * @param {string|null} value - New LoRA model value (null = use default)
   */
  const handleLoraChange = useCallback(async (field, value) => {
    if (!characterId) return;

    // Update local state immediately for responsive UI
    setSd15Config(prev => ({ ...prev, [field]: value }));

    // Save to backend
    try {
      await api.updateCharacterWeights(characterId, { [field]: value });
      toast.success('LoRA model saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save LoRA model');
      // Revert on error (optional - could reload from server instead)
    }
  }, [characterId, toast]);

  /**
   * Generate reference image
   * @param {object} poseOptions - Options from ReferenceImageManager { referencePose: 'idle' | 'tpose', force?: boolean }
   */
  const handleGenerateReference = useCallback(async (poseOptions = {}) => {
    if (!characterId) return;

    setReferenceLoading(true);
    try {
      // Include LoRA model if explicitly selected (otherwise API uses default)
      const options = {};
      if (sd15Config.referenceLoraModel) {
        options.loraModel = sd15Config.referenceLoraModel;
      }
      // Include reference pose if specified
      if (poseOptions.referencePose) {
        options.referencePose = poseOptions.referencePose;
      }
      // Include force flag for regeneration
      if (poseOptions.force) {
        options.force = true;
      }
      await api.generateReferenceImage(characterId, options);
      toast.success('Reference image generation queued');

      // Refresh status after a delay
      setTimeout(async () => {
        const refData = await api.getReferenceImageStatus(characterId).catch(() => null);
        if (refData) setReferenceStatus(refData);
        setReferenceLoading(false);
      }, 2000);
    } catch (err) {
      toast.error(err.message || 'Failed to generate reference');
      setReferenceLoading(false);
    }
  }, [characterId, sd15Config.referenceLoraModel, toast]);

  /**
   * Generate selected animations
   */
  const handleGenerateAnimations = useCallback(async () => {
    if (!characterId || selectedAnimationsForGen.size === 0) return;

    setAnimationLoading(true);
    try {
      const animations = Array.from(selectedAnimationsForGen);
      const options = {
        controlnetWeight: animationWeights.controlnetWeight,
        ipadapterWeight: animationWeights.ipadapterWeight,
      };
      // Include LoRA model if explicitly selected (otherwise API uses default)
      if (sd15Config.animationLoraModel) {
        options.loraModel = sd15Config.animationLoraModel;
      }
      await api.generateCharacterAnimations(characterId, animations, options);
      toast.success(`Queued ${animations.length} animation(s) for generation`);

      // Clear selection
      setSelectedAnimationsForGen(new Set());

      // Trigger parent update
      onUpdate?.();
    } catch (err) {
      toast.error(err.message || 'Failed to queue animations');
    } finally {
      setAnimationLoading(false);
    }
  }, [characterId, selectedAnimationsForGen, animationWeights, sd15Config.animationLoraModel, toast, onUpdate]);

  /**
   * Save frame description overrides
   */
  const handleSaveFrameDescriptions = useCallback(async (newOverrides) => {
    if (!characterId) return;

    setFrameDescriptionLoading(true);
    try {
      await api.updateFrameDescriptions(characterId, newOverrides);
      // Update local state with the saved overrides
      setFrameDescriptionData(prev => ({
        ...prev,
        hasOverrides: Object.keys(newOverrides || {}).length > 0,
        // Update each animation's overrides in the animations object
        animations: prev?.animations ? Object.fromEntries(
          Object.entries(prev.animations).map(([anim, data]) => [
            anim,
            { ...data, overrides: newOverrides?.[anim] || [] }
          ])
        ) : prev?.animations
      }));
      toast.success('Frame descriptions saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save frame descriptions');
    } finally {
      setFrameDescriptionLoading(false);
    }
  }, [characterId, toast]);

  /**
   * Get animation sprite URL for preview
   * Uses shared/assetPaths.js getCharacterPath for canonical path construction
   */
  const getAnimationUrl = useCallback((anim) => {
    if (!characterId) return null;
    const type = asset?._type || 'player';
    const biome = asset?._biome || asset?.biome;
    return getCharacterPath(characterId, {
      type: type === 'enemies' ? 'enemy' : type,
      biome,
      animation: anim
    });
  }, [characterId, asset?._type, asset?._biome, asset?.biome]);

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

      // Include biome for tiles disambiguation
      const options = category === 'tiles' ? { biome: asset._biome } : {};
      const response = await api.updateAsset(category, asset.key || asset.id, updates, options);
      const updatedAsset = response.asset;

      // Re-initialize form with saved data to ensure consistency
      if (updatedAsset) {
        setFormData({
          prompt: updatedAsset.prompt || '',
          seed: updatedAsset.seed?.toString() || '',
          evaluation: updatedAsset.evaluation || 0,
          issues: updatedAsset.issues || '',
          notes: updatedAsset.notes || '',
          priority: updatedAsset.priority || 0,
          needsRegeneration: updatedAsset.needsRegeneration || false,
          loraModel: updatedAsset.loraModel || '',
        });
      }

      toast.success('Asset saved');
      onUpdate?.(updatedAsset);
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
      // Build extra filters for disambiguation (e.g., biome for tiles)
      const extraFilters = {};
      if (category === 'tiles' && asset._biome) {
        extraFilters.biome = asset._biome;
      }
      if (asset._tileCategory) {
        extraFilters.subcategory = asset._tileCategory;
      }

      await api.generateAssetsByIds(category, [asset.key || asset.id], { force: true }, extraFilters);
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

  // Reprocess asset with background removal
  const handleReprocess = async () => {
    if (!asset) return;

    setReprocessing(true);

    try {
      // Build options for reprocessing
      const options = {};
      if (reprocessModel) {
        options.model = reprocessModel;
      }
      // Include biome for tiles disambiguation
      if (category === 'tiles' && asset._biome) {
        options.biome = asset._biome;
      }

      await api.reprocessAsset(category, asset.key || asset.id, options);
      toast.success('Asset reprocessed successfully');

      // Refresh the preview by incrementing fallback index to force reload
      setFallbackIndex(0);
      setImageError(false);

      // Trigger parent update
      onUpdate?.();
    } catch (err) {
      toast.error(err.message || 'Failed to reprocess asset');
    } finally {
      setReprocessing(false);
    }
  };

  // Preview full prompt with theme - uses API endpoint for structured breakdown
  const handlePreviewFullPrompt = async () => {
    setShowFullPrompt(true);
    setFullPromptData({ loading: true, data: null });

    try {
      const assetKey = asset?.key || asset?.id;
      // Include biome for tiles disambiguation
      const options = category === 'tiles' ? { biome: asset._biome } : {};
      const promptData = await api.getAssetPrompt(category, assetKey, options);
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
                  {/* Image Preview - different for characters vs other assets */}
                  <div className="space-y-3">
                    <div className="aspect-square bg-midnight-950 rounded-lg overflow-hidden flex items-center justify-center border border-midnight-700">
                      {isCharacter ? (
                        // Character: Show animated sprite preview
                        animationData?.[selectedAnimation]?.generated ? (
                          <SpritePreview
                            src={getAnimationUrl(selectedAnimation)}
                            frameWidth={64}
                            frameHeight={64}
                            animationType={selectedAnimation}
                            fps={8}
                            animate={true}
                            className="w-full h-full flex items-center justify-center scale-[2]"
                            onError={() => setImageError(true)}
                          />
                        ) : (
                          <div className="text-center text-parchment-500 px-4">
                            <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-2" />
                            <p className="font-medium">
                              Animation not generated
                            </p>
                            <p className="text-xs mt-2 text-parchment-600">
                              {selectedAnimation} animation is pending
                            </p>
                          </div>
                        )
                      ) : (
                        // Non-character: Show static image
                        isGenerated && !imageError && previewSize ? (
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
                        )
                      )}
                    </div>

                    {/* Animation selector for characters */}
                    {isCharacter && (
                      <AnimationSelector
                        animations={animationData}
                        selectedAnimation={selectedAnimation}
                        onSelect={setSelectedAnimation}
                      />
                    )}

                    {/* Size switcher - only show if multiple sizes available (not for characters) */}
                    {!isCharacter && sizeOptions.length > 1 && (
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

                    {/* Show asset info for single-size categories (not characters) */}
                    {!isCharacter && sizeOptions.length === 1 && (
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

                  {/* SD1.5 Animation Controls (characters only) */}
                  {isCharacter && (
                    <div className="space-y-4 p-4 bg-midnight-800/30 border border-midnight-700 rounded-lg">
                      <h3 className="text-sm font-medium text-accent-gold flex items-center gap-2">
                        <PlayIcon className="w-4 h-4" />
                        SD1.5 Animation Controls
                      </h3>

                      {/* Reference Image Manager */}
                      <ReferenceImageManager
                        characterId={characterId}
                        referenceStatus={referenceStatus}
                        onGenerate={handleGenerateReference}
                        loading={referenceLoading}
                      />

                      {/* Weight Controls */}
                      <WeightControls
                        weights={animationWeights}
                        onWeightsChange={handleWeightsChange}
                        onPresetSelect={handlePresetSelect}
                        loading={weightsLoading}
                      />

                      {/* SD1.5 LoRA Model Selectors */}
                      {!loraConfig.loading && Object.keys(loraConfig.sd15LoraModels).length > 0 && (
                        <div className="space-y-3 p-3 bg-midnight-800/50 border border-midnight-700 rounded-lg">
                          <h4 className="text-xs font-medium text-parchment-500 uppercase tracking-wide">
                            Style Models (LoRA)
                          </h4>
                          <SD15LoraSelector
                            label="Reference LoRA"
                            value={sd15Config.referenceLoraModel}
                            onChange={(val) => handleLoraChange('referenceLoraModel', val)}
                            models={loraConfig.sd15LoraModels}
                            defaultModel={loraConfig.sd15Defaults.referenceLoraModel}
                            loading={loraConfig.loading}
                            hint="Style model for generating the reference image"
                          />
                          <SD15LoraSelector
                            label="Animation LoRA"
                            value={sd15Config.animationLoraModel}
                            onChange={(val) => handleLoraChange('animationLoraModel', val)}
                            models={loraConfig.sd15LoraModels}
                            defaultModel={loraConfig.sd15Defaults.loraModel}
                            loading={loraConfig.loading}
                            hint="Style model for generating animation frames"
                          />
                        </div>
                      )}

                      {/* Save weights button (for manual slider changes) */}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={saveWeights}
                          disabled={weightsLoading}
                          className="px-3 py-1 text-xs bg-midnight-700 text-parchment-300 rounded
                                     hover:bg-midnight-600 transition-colors
                                     disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {weightsLoading ? 'Saving...' : 'Save Weights'}
                        </button>
                      </div>

                      {/* Animation Generation Controls */}
                      <AnimationGenerationControls
                        animations={animationData}
                        selectedAnimations={selectedAnimationsForGen}
                        onSelectionChange={setSelectedAnimationsForGen}
                        onGenerate={handleGenerateAnimations}
                        loading={animationLoading}
                      />

                      {/* Frame Description Editor */}
                      {frameDescriptionData?.animations && (
                        <FrameDescriptionEditor
                          characterId={characterId}
                          animation={selectedAnimation}
                          animationConfig={frameDescriptionData.animations[selectedAnimation]}
                          overrides={
                            // Build overrides object from all animations
                            Object.fromEntries(
                              Object.entries(frameDescriptionData.animations)
                                .filter(([, data]) => data.overrides?.length > 0)
                                .map(([anim, data]) => [anim, data.overrides])
                            )
                          }
                          onSave={handleSaveFrameDescriptions}
                          loading={frameDescriptionLoading}
                        />
                      )}
                    </div>
                  )}

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

                {/* Background Removal Reprocessing Controls */}
                {loraConfig.backgroundRemoval?.availableModels?.length > 0 && (
                  <div className="flex items-center gap-2 ml-auto">
                    <select
                      value={reprocessModel}
                      onChange={(e) => setReprocessModel(e.target.value)}
                      disabled={reprocessing || !isGenerated}
                      className="px-2 py-1.5 text-sm bg-midnight-800 border border-midnight-700 rounded-lg
                                 text-parchment-200 focus:outline-none focus:border-accent-gold
                                 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">Default Model</option>
                      {loraConfig.backgroundRemoval.availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleReprocess}
                      disabled={reprocessing || !isGenerated}
                      className="btn-ghost flex items-center gap-2 disabled:opacity-50"
                      title="Reprocess the original image with background removal"
                    >
                      {reprocessing ? (
                        <ReloadIcon className="w-4 h-4 animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                      Reprocess Original
                    </button>
                  </div>
                )}
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
