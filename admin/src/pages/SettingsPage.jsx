/**
 * SettingsPage - Theme editor, generation settings, and backup management
 *
 * Three tabs:
 * - Theme: Style trigger, base phrase, negative prompt, category modifiers
 * - Generation: LoRA defaults, output paths (display only)
 * - Backups: List, create, restore, delete backups
 */

import { useState, useCallback } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  GearIcon,
  Pencil1Icon,
  MagicWandIcon,
  ArchiveIcon,
  ReloadIcon,
  PlusIcon,
  TrashIcon,
  ResetIcon,
  CheckIcon,
  Cross2Icon,
  InfoCircledIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import { useApiStatus, useBackups } from '../hooks/useAssets';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../contexts/ToastContext';
import ThemePresetManager from '../components/ThemePresetManager';

/**
 * Editable text field component
 */
function EditableField({ label, value, onChange, multiline = false, placeholder = '', hint = '' }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');

  const handleStartEdit = () => {
    setEditValue(value || ''); // Sync with current prop value when entering edit mode
    setIsEditing(true);
  };

  const handleSave = () => {
    onChange(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value || '');
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !multiline) {
      handleSave();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    const InputComponent = multiline ? 'textarea' : 'input';
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-parchment-300">{label}</label>
        <div className="flex gap-2">
          <InputComponent
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`flex-1 px-3 py-2 bg-midnight-800 border border-midnight-600 rounded-lg
                       text-parchment-100 placeholder-parchment-500
                       focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30
                       ${multiline ? 'min-h-[100px] resize-y' : ''}`}
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleSave}
              className="p-2 bg-accent-emerald/20 text-accent-emerald rounded-lg hover:bg-accent-emerald/30"
              aria-label="Save"
            >
              <CheckIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="p-2 bg-accent-ruby/20 text-accent-ruby rounded-lg hover:bg-accent-ruby/30"
              aria-label="Cancel"
            >
              <Cross2Icon className="w-4 h-4" />
            </button>
          </div>
        </div>
        {hint && <p className="text-xs text-parchment-500">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-parchment-300">{label}</label>
      <button
        type="button"
        onClick={handleStartEdit}
        className="w-full text-left px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                   text-parchment-200 hover:border-midnight-600 hover:bg-midnight-750
                   transition-colors group flex items-start gap-2"
      >
        <span className={`flex-1 ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>
          {value || <span className="text-parchment-500 italic">{placeholder || 'Click to edit...'}</span>}
        </span>
        <Pencil1Icon className="w-4 h-4 text-parchment-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
      </button>
      {hint && <p className="text-xs text-parchment-500">{hint}</p>}
    </div>
  );
}

/**
 * Theme Tab Content
 */
function ThemeTab({ theme, saving, onUpdateField, onUpdateCategoryModifier, onPresetApplied }) {
  const [previewCategory, setPreviewCategory] = useState('tiles');
  const [previewSubject, setPreviewSubject] = useState('forest grass floor tile');

  const categories = Object.keys(theme?.categoryModifiers || {});

  // Build prompt preview
  const buildPreview = useCallback(() => {
    if (!theme) return { positivePrompt: '', negativePrompt: '' };

    const { style, categoryModifiers, negativePrompt } = theme;
    const categoryMod = categoryModifiers?.[previewCategory];

    const parts = [];
    if (style?.trigger) parts.push(style.trigger);
    if (style?.basePhrase) parts.push(style.basePhrase);
    parts.push(previewSubject);
    if (categoryMod?.suffix) parts.push(categoryMod.suffix);
    if (style?.technique) parts.push(style.technique);
    if (style?.texture) parts.push(style.texture);

    return {
      positivePrompt: parts.join(', '),
      negativePrompt: negativePrompt || '',
      size: categoryMod?.size || '128x128',
    };
  }, [theme, previewCategory, previewSubject]);

  const preview = buildPreview();

  return (
    <div className="space-y-6">
      {/* Theme Presets */}
      <ThemePresetManager
        currentThemeName={theme?.name}
        onPresetApplied={onPresetApplied}
      />

      {/* Style Settings */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Style Settings
        </h3>
        <div className="space-y-4">
          <EditableField
            label="Style Trigger"
            value={theme?.style?.trigger}
            onChange={(val) => onUpdateField('style.trigger', val)}
            placeholder="wbgmsst"
            hint="LoRA activation trigger word"
          />
          <EditableField
            label="Base Phrase"
            value={theme?.style?.basePhrase}
            onChange={(val) => onUpdateField('style.basePhrase', val)}
            placeholder="ink and wash watercolor illustration"
            hint="Core style description included in all prompts"
          />
          <EditableField
            label="Technique"
            value={theme?.style?.technique}
            onChange={(val) => onUpdateField('style.technique', val)}
            placeholder="bold black outlines with watercolor fills"
            hint="Rendering technique description"
          />
          <EditableField
            label="Texture"
            value={theme?.style?.texture}
            onChange={(val) => onUpdateField('style.texture', val)}
            placeholder="aged parchment texture"
            hint="Background/surface texture"
          />
          <EditableField
            label="Mood"
            value={theme?.style?.mood}
            onChange={(val) => onUpdateField('style.mood', val)}
            placeholder="cozy nostalgic JRPG aesthetic"
            hint="Overall visual mood/feeling"
          />
        </div>
      </div>

      {/* Negative Prompt */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Negative Prompt
        </h3>
        <EditableField
          label="Negative Prompt"
          value={theme?.negativePrompt}
          onChange={(val) => onUpdateField('negativePrompt', val)}
          multiline
          placeholder="photorealistic, 3D render, CGI..."
          hint="Elements to avoid in generated images (comma-separated)"
        />
      </div>

      {/* Category Modifiers */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Category Modifiers
        </h3>
        <p className="text-sm text-parchment-400 mb-4">
          Additional prompt suffixes and output sizes for each asset category.
        </p>
        <div className="space-y-4">
          {categories.map((category) => {
            const modifier = theme?.categoryModifiers?.[category];
            return (
              <div key={category} className="p-4 bg-midnight-800 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-parchment-200 capitalize">{category}</h4>
                  <span className="text-xs text-parchment-500 bg-midnight-700 px-2 py-1 rounded">
                    {modifier?.size || '128x128'}
                  </span>
                </div>
                <EditableField
                  label="Suffix"
                  value={modifier?.suffix}
                  onChange={(val) => onUpdateCategoryModifier(category, { ...modifier, suffix: val })}
                  multiline
                  placeholder="Category-specific prompt additions..."
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Prompt Preview */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Prompt Preview
        </h3>
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-parchment-300 mb-2">Category</label>
              <select
                value={previewCategory}
                onChange={(e) => setPreviewCategory(e.target.value)}
                className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                           text-parchment-200 focus:outline-none focus:border-accent-gold"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-parchment-300 mb-2">Subject</label>
              <input
                type="text"
                value={previewSubject}
                onChange={(e) => setPreviewSubject(e.target.value)}
                className="w-full px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                           text-parchment-200 focus:outline-none focus:border-accent-gold"
                placeholder="Enter subject..."
              />
            </div>
          </div>

          <div className="p-4 bg-midnight-950 rounded-lg border border-midnight-700">
            <div className="mb-3">
              <span className="text-xs font-medium text-accent-emerald">POSITIVE PROMPT</span>
              <p className="text-sm text-parchment-200 mt-1 font-mono">{preview.positivePrompt}</p>
            </div>
            <div className="mb-3">
              <span className="text-xs font-medium text-accent-ruby">NEGATIVE PROMPT</span>
              <p className="text-sm text-parchment-400 mt-1 font-mono text-xs">{preview.negativePrompt}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-accent-gold">OUTPUT SIZE</span>
              <p className="text-sm text-parchment-200 mt-1">{preview.size}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Saving indicator */}
      {saving && (
        <div className="fixed bottom-4 right-4 bg-midnight-800 border border-midnight-600 rounded-lg px-4 py-2 flex items-center gap-2">
          <ReloadIcon className="w-4 h-4 animate-spin text-accent-gold" />
          <span className="text-parchment-200 text-sm">Saving changes...</span>
        </div>
      )}
    </div>
  );
}

/**
 * Generation Tab Content
 */
function GenerationTab({ theme, status, onThemeUpdate, onLoraUpdate }) {
  const toast = useToast();
  const loraDefaults = theme?.loraDefaults || {};
  const categories = Object.keys(loraDefaults).filter((k) => !k.startsWith('_'));

  // Valid LoRA models (must match backend VALID_LORA_MODELS)
  const VALID_LORA_MODELS = [
    { value: 'v1', label: 'v1 (GRPZA)', description: 'Flat 2D pixel art style' },
    { value: 'v2', label: 'v2 (wbgmsst)', description: 'Isometric/watercolor style' },
    { value: 'modern-pixel', label: 'Modern Pixel', description: 'Clean modern pixel art' },
    { value: 'retro-pixel', label: 'Retro Pixel', description: 'Classic retro 8-bit style' },
  ];

  // Local state for editable settings
  const [backend, setBackend] = useState(theme?.generationBackend || 'local');
  const [seedMode, setSeedMode] = useState(theme?.seedMode || 'random');
  const [fixedSeed, setFixedSeed] = useState(theme?.fixedSeed || '');
  const [variants, setVariants] = useState(theme?.variants || 1);
  const [generationDelay, setGenerationDelay] = useState(theme?.generationDelay || 0);
  const [saving, setSaving] = useState(false);

  // Handle backend change
  const handleBackendChange = async (newBackend) => {
    setBackend(newBackend);
    setSaving(true);
    try {
      await onThemeUpdate({ generationBackend: newBackend });
      toast.success('Backend updated');
    } catch (err) {
      toast.error(err.message || 'Failed to update backend');
    } finally {
      setSaving(false);
    }
  };

  // Handle seed settings change
  const handleSeedChange = async () => {
    setSaving(true);
    try {
      await onThemeUpdate({
        seedMode,
        fixedSeed: seedMode === 'fixed' ? parseInt(fixedSeed, 10) || 0 : null
      });
      toast.success('Seed settings saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save seed settings');
    } finally {
      setSaving(false);
    }
  };

  // Handle LoRA change for a category
  const handleLoraChange = async (category, newLora) => {
    setSaving(true);
    try {
      await onLoraUpdate(category, newLora);
      toast.success(`LoRA updated for ${category}`);
    } catch (err) {
      toast.error(err.message || 'Failed to update LoRA');
    } finally {
      setSaving(false);
    }
  };

  // Handle advanced options change
  const handleAdvancedChange = async () => {
    setSaving(true);
    try {
      await onThemeUpdate({
        variants: parseInt(variants, 10) || 1,
        generationDelay: parseInt(generationDelay, 10) || 0
      });
      toast.success('Advanced options saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save advanced options');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Backend Selection */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Generation Backend
        </h3>
        <p className="text-sm text-parchment-400 mb-4">
          Choose where to run image generation.
        </p>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => handleBackendChange('local')}
            disabled={saving}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              backend === 'local'
                ? 'border-accent-gold bg-midnight-800 text-parchment-100'
                : 'border-midnight-700 bg-midnight-900 text-parchment-400 hover:border-midnight-600'
            }`}
          >
            <div className="font-medium mb-1">Local (ComfyUI)</div>
            <p className="text-xs text-parchment-500">
              Run on local GPU via ComfyUI. Requires IMAGE_GENERATOR_ROOT.
            </p>
          </button>
          <button
            type="button"
            onClick={() => handleBackendChange('huggingface')}
            disabled={saving}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              backend === 'huggingface'
                ? 'border-accent-gold bg-midnight-800 text-parchment-100'
                : 'border-midnight-700 bg-midnight-900 text-parchment-400 hover:border-midnight-600'
            }`}
          >
            <div className="font-medium mb-1">HuggingFace API</div>
            <p className="text-xs text-parchment-500">
              Run via HuggingFace API. Requires HUGGINGFACE_API_TOKEN.
            </p>
          </button>
        </div>
      </div>

      {/* Seed Settings */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Seed Settings
        </h3>
        <p className="text-sm text-parchment-400 mb-4">
          Control randomness in image generation for reproducibility.
        </p>
        <div className="space-y-4">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="seedMode"
                checked={seedMode === 'random'}
                onChange={() => setSeedMode('random')}
                className="w-4 h-4 text-accent-gold"
              />
              <span className="text-parchment-200">Random seed</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="seedMode"
                checked={seedMode === 'fixed'}
                onChange={() => setSeedMode('fixed')}
                className="w-4 h-4 text-accent-gold"
              />
              <span className="text-parchment-200">Fixed seed</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="seedMode"
                checked={seedMode === 'incremental'}
                onChange={() => setSeedMode('incremental')}
                className="w-4 h-4 text-accent-gold"
              />
              <span className="text-parchment-200">Incremental</span>
            </label>
          </div>
          {seedMode === 'fixed' && (
            <div className="flex gap-2 items-center">
              <label className="text-sm text-parchment-400">Fixed seed value:</label>
              <input
                type="number"
                value={fixedSeed}
                onChange={(e) => setFixedSeed(e.target.value)}
                className="px-3 py-2 bg-midnight-800 border border-midnight-600 rounded-lg text-parchment-200 w-40"
                placeholder="e.g., 42"
              />
            </div>
          )}
          <button
            type="button"
            onClick={handleSeedChange}
            disabled={saving}
            className="px-4 py-2 bg-accent-gold text-midnight-950 rounded-lg hover:bg-accent-copper transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Seed Settings'}
          </button>
        </div>
      </div>

      {/* Advanced Options */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Advanced Generation Options
        </h3>
        <p className="text-sm text-parchment-400 mb-4">
          Additional options for controlling generation behavior.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-parchment-400 mb-2">Variants per Asset</label>
              <input
                type="number"
                min="1"
                max="10"
                value={variants}
                onChange={(e) => setVariants(e.target.value)}
                className="w-full px-3 py-2 bg-midnight-800 border border-midnight-600 rounded-lg
                           text-parchment-200 focus:outline-none focus:border-accent-gold"
              />
              <p className="text-xs text-parchment-500 mt-1">
                Number of variants to generate for tiles/nodes (1-10)
              </p>
            </div>
            <div>
              <label className="block text-sm text-parchment-400 mb-2">Delay Between Jobs (ms)</label>
              <input
                type="number"
                min="0"
                max="10000"
                step="100"
                value={generationDelay}
                onChange={(e) => setGenerationDelay(e.target.value)}
                className="w-full px-3 py-2 bg-midnight-800 border border-midnight-600 rounded-lg
                           text-parchment-200 focus:outline-none focus:border-accent-gold"
              />
              <p className="text-xs text-parchment-500 mt-1">
                Delay between generation jobs to prevent overload (0-10000ms)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdvancedChange}
            disabled={saving}
            className="px-4 py-2 bg-accent-gold text-midnight-950 rounded-lg hover:bg-accent-copper transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Advanced Options'}
          </button>
        </div>
      </div>

      {/* LoRA Defaults */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          LoRA Model Defaults
        </h3>
        <div className="flex items-start gap-2 mb-4 p-3 bg-midnight-800 rounded-lg">
          <InfoCircledIcon className="w-4 h-4 text-accent-gold flex-shrink-0 mt-0.5" />
          <p className="text-sm text-parchment-400">
            Select the default LoRA model for each asset category. These can be overridden per-job
            when queuing generation from the asset browser.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {categories.map((category) => (
            <div key={category} className="p-3 bg-midnight-800 rounded-lg">
              <label className="text-sm text-parchment-400 capitalize block mb-2">{category}</label>
              <select
                value={loraDefaults[category] || 'v1'}
                onChange={(e) => handleLoraChange(category, e.target.value)}
                disabled={saving}
                className="w-full px-3 py-2 bg-midnight-900 border border-midnight-600 rounded-lg
                           text-parchment-200 focus:outline-none focus:border-accent-gold
                           disabled:opacity-50"
              >
                {VALID_LORA_MODELS.map((lora) => (
                  <option key={lora.value} value={lora.value}>
                    {lora.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-parchment-500 mt-1">
                {VALID_LORA_MODELS.find(l => l.value === (loraDefaults[category] || 'v1'))?.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Output Paths */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Output Paths
        </h3>
        <div className="space-y-3">
          <div className="p-3 bg-midnight-800 rounded-lg">
            <span className="text-sm text-parchment-400">Metadata Directory</span>
            <p className="text-sm text-parchment-200 font-mono mt-1 break-all">
              {status?.metadataDir || 'Not configured'}
            </p>
          </div>
          <div className="p-3 bg-midnight-800 rounded-lg">
            <span className="text-sm text-parchment-400">Scripts Directory</span>
            <p className="text-sm text-parchment-200 font-mono mt-1 break-all">
              {status?.scriptsDir || 'Not configured'}
            </p>
          </div>
        </div>
      </div>

      {/* Overlay Configuration */}
      {theme?.overlayConfig && (
        <div className="card p-6">
          <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
            Overlay Configuration
          </h3>
          <p className="text-sm text-parchment-400 mb-4">
            Settings for layered item composition (rarity/augment overlays).
          </p>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-midnight-800 rounded-lg">
              <span className="text-sm text-parchment-400">Blend Mode</span>
              <p className="text-parchment-200 font-mono mt-1">{theme.overlayConfig.blendMode}</p>
            </div>
          </div>

          {/* Rarity Alpha */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-parchment-300 mb-2">Rarity Alpha Values</h4>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(theme.overlayConfig.rarityAlpha || {}).map(([rarity, alpha]) => (
                <div key={rarity} className="p-2 bg-midnight-800 rounded text-center">
                  <span className="text-xs text-parchment-400 capitalize">{rarity}</span>
                  <p className="text-sm text-parchment-200">{alpha}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Rarity Overlays */}
          <div>
            <h4 className="text-sm font-medium text-parchment-300 mb-2">Rarity Overlay Keywords</h4>
            <div className="space-y-2">
              {Object.entries(theme.overlayConfig.rarityOverlays || {}).map(([rarity, config]) => (
                <div key={rarity} className="p-3 bg-midnight-800 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor:
                          config.color === 'green' ? '#10b981' :
                          config.color === 'blue' ? '#3b82f6' :
                          config.color === 'purple' ? '#a855f7' :
                          config.color === 'golden' ? '#f59e0b' : '#888',
                      }}
                    />
                    <span className="text-sm font-medium text-parchment-200 capitalize">{rarity}</span>
                  </div>
                  <p className="text-xs text-parchment-400">{config.promptKeywords}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Format file size to human readable
 */
function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format timestamp to readable date
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';

  // Handle YYYY-MM-DD_HH-MM-SS format
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(year, month - 1, day, hour, minute, second);
    return date.toLocaleString();
  }

  return timestamp;
}

/**
 * Backups Tab Content
 */
function BackupsTab({ backups, loading, operating, onRefresh, onCreateBackup, onRestoreBackup, onDeleteBackup }) {
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

/**
 * Main Settings Page
 */
export default function SettingsPage() {
  const { status, loading: statusLoading, error: statusError } = useApiStatus();
  const { theme, loading: themeLoading, saving, error: themeError, updateField, updateCategoryModifier, updateTheme, updateLoraDefault, refetch: refetchTheme } = useTheme();
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
            <GenerationTab theme={theme} status={status} onThemeUpdate={updateTheme} onLoraUpdate={updateLoraDefault} />
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
