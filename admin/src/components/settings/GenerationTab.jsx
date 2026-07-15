/**
 * GenerationTab - Generation settings tab for Settings page
 *
 * Configures:
 * - AI generation backend (ComfyUI/HuggingFace)
 * - Deterministic tile compiler contract
 * - Seed settings (random/fixed/incremental)
 * - Advanced AI options (node variants, delay)
 * - LoRA model defaults per category
 * - Output paths (display only)
 * - Overlay configuration
 */

import { useState, useEffect, useMemo } from 'react';
import { InfoCircledIcon, UpdateIcon } from '@radix-ui/react-icons';
import { useToast } from '../../contexts/ToastContext';

// Valid LoRA models (must match backend VALID_LORA_MODELS)
const VALID_LORA_MODELS = [
  { value: 'v1', label: 'v1 (GRPZA)', description: 'Flat 2D pixel art style' },
  { value: 'v2', label: 'v2 (wbgmsst)', description: 'Isometric/watercolor style' },
  { value: 'modern-pixel', label: 'Modern Pixel', description: 'Clean modern pixel art' },
  { value: 'retro-pixel', label: 'Retro Pixel', description: 'Classic retro 8-bit style' },
];

// SD1.5 LoRA models for character animation (must match backend VALID_SD15_LORA_MODELS)
const VALID_SD15_LORA_MODELS = [
  { value: 'pixel-art-xl', label: 'Pixel Art XL', description: 'General purpose pixel art (default)' },
  { value: '16-bit-pixel', label: '16-bit Pixel', description: 'SNES/retro 16-bit style' },
  { value: 'all-in-one-pixel', label: 'All-in-One Pixel', description: 'Versatile pixel art fallback' },
  { value: 'retro-game-art', label: 'Retro Game Art', description: 'MS-DOS/Amiga retro style' },
  { value: 'cps2-pixel-art', label: 'CPS2 Pixel Art', description: 'Arcade/CPS II fighting game style' },
];

// Quality presets for SD1.5 generation (must match backend VALID_QUALITY_PRESETS)
const QUALITY_PRESETS = [
  { value: 'fast', label: 'Fast', description: '15 steps - quick testing' },
  { value: 'balanced', label: 'Balanced', description: '20 steps - good balance' },
  { value: 'quality', label: 'Quality', description: '32 steps - best quality (default)' },
];

/**
 * Generation tab content
 * @param {object} props
 * @param {object} props.theme - Current theme with generation settings
 * @param {object} props.status - API status with path info
 * @param {function} props.onThemeUpdate - Callback to update theme fields
 * @param {function} props.onLoraUpdate - Callback to update LoRA default for a category
 */
export function GenerationTab({ theme, status, onThemeUpdate, onLoraUpdate }) {
  const toast = useToast();
  const loraDefaults = useMemo(() => theme?.loraDefaults || {}, [theme?.loraDefaults]);
  const categories = Object.keys(loraDefaults).filter(
    (category) => !category.startsWith('_') && category !== 'description' && category !== 'tiles'
  );

  // Local state for editable settings
  const [backend, setBackend] = useState(theme?.generationBackend || 'comfyui');
  const [seedMode, setSeedMode] = useState(theme?.seedMode || 'random');
  const [fixedSeed, setFixedSeed] = useState(theme?.fixedSeed || '');
  const [variants, setVariants] = useState(theme?.variants || 1);
  const [generationDelay, setGenerationDelay] = useState(theme?.generationDelay || 0);
  const [saving, setSaving] = useState(false);

  // Per-category LoRA state for optimistic updates
  const [savingCategory, setSavingCategory] = useState(null);
  const [localLoraDefaults, setLocalLoraDefaults] = useState(loraDefaults);

  // Sync localLoraDefaults when loraDefaults changes from props
  useEffect(() => {
    setLocalLoraDefaults(loraDefaults);
  }, [loraDefaults]);

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

  // Handle LoRA change for a category with optimistic updates
  const handleLoraChange = async (category, newLora) => {
    const previousValue = localLoraDefaults[category];

    // Optimistic update
    setLocalLoraDefaults(prev => ({ ...prev, [category]: newLora }));
    setSavingCategory(category);

    try {
      await onLoraUpdate(category, newLora);
      toast.success(`LoRA updated for ${category}`);
    } catch (err) {
      // Rollback on error
      setLocalLoraDefaults(prev => ({ ...prev, [category]: previousValue }));
      toast.error(err.message || 'Failed to update LoRA');
    } finally {
      setSavingCategory(null);
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
      {/* Tile Pipeline */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          Tile Material Pipeline
        </h3>
        <div className="flex items-start gap-2 p-3 bg-midnight-800 rounded-lg">
          <InfoCircledIcon className="w-4 h-4 text-accent-gold flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-parchment-200">
              Deterministic isometric compiler
            </p>
            <p className="text-xs text-parchment-400 mt-1">
              Tile jobs compile seamless, transparent WebP materials using the{' '}
              <code className="text-accent-gold">
                {theme?.tilePipeline?.geometryProfile || 'iso64-retina-v3'}
              </code>{' '}
              geometry contract. AI backend, LoRA, seed, variants, and request delay do not affect tiles.
            </p>
          </div>
        </div>
      </div>

      {/* Backend Selection */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          AI Generation Backend
        </h3>
        <p className="text-sm text-parchment-400 mb-4">
          Choose where to run AI generation for portraits, items, icons, nodes, and other non-tile assets.
        </p>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => handleBackendChange('comfyui')}
            disabled={saving}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              backend === 'comfyui'
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
          Control randomness in AI-generated assets. Tile compilation is deterministic.
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
          Additional options for controlling AI generation behavior.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-parchment-400 mb-2">Node Variants per Asset</label>
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
                Number of variants to generate for nodes (1-10). Tiles use metadata-defined variants.
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
                Delay between AI generation jobs to prevent overload (0-10000ms)
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
            Select the default LoRA model for AI-generated asset categories. These can be overridden
            per job when queuing generation from the asset browser; tiles use the material compiler.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {categories.map((category) => {
            const isSaving = savingCategory === category;
            const currentValue = localLoraDefaults[category] || 'v1';
            return (
              <div key={category} className="p-3 bg-midnight-800 rounded-lg">
                <label className="text-sm text-parchment-400 capitalize block mb-2 flex items-center gap-2">
                  {category}
                  {isSaving && (
                    <UpdateIcon className="w-3 h-3 text-accent-gold animate-spin" />
                  )}
                </label>
                <select
                  value={currentValue}
                  onChange={(e) => handleLoraChange(category, e.target.value)}
                  disabled={isSaving}
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
                  {VALID_LORA_MODELS.find(l => l.value === currentValue)?.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* SD1.5 Character Animation Settings */}
      <div className="card p-6">
        <h3 className="text-lg font-display font-semibold text-parchment-100 mb-4">
          SD1.5 Character Animation
        </h3>
        <div className="flex items-start gap-2 mb-4 p-3 bg-midnight-800 rounded-lg">
          <InfoCircledIcon className="w-4 h-4 text-accent-gold flex-shrink-0 mt-0.5" />
          <p className="text-sm text-parchment-400">
            Settings for SD1.5-based character animation generation using ControlNet and IP-Adapter.
            These apply when using <code className="text-accent-gold">--mode sd15</code> in the CLI.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-midnight-800 rounded-lg">
            <label className="text-sm text-parchment-400 block mb-2">SD1.5 LoRA Model</label>
            <select
              value={theme?.sd15Defaults?.loraModel || 'pixel-art-xl'}
              onChange={async (e) => {
                try {
                  await onThemeUpdate({ sd15Defaults: { ...theme?.sd15Defaults, loraModel: e.target.value } });
                  toast.success('SD1.5 LoRA updated');
                } catch (err) {
                  toast.error(err.message || 'Failed to update SD1.5 LoRA');
                }
              }}
              className="w-full px-3 py-2 bg-midnight-900 border border-midnight-600 rounded-lg
                         text-parchment-200 focus:outline-none focus:border-accent-gold"
            >
              {VALID_SD15_LORA_MODELS.map((lora) => (
                <option key={lora.value} value={lora.value}>
                  {lora.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-parchment-500 mt-1">
              {VALID_SD15_LORA_MODELS.find(l => l.value === (theme?.sd15Defaults?.loraModel || 'pixel-art-xl'))?.description}
            </p>
          </div>
          <div className="p-3 bg-midnight-800 rounded-lg">
            <label className="text-sm text-parchment-400 block mb-2">Quality Preset</label>
            <select
              value={theme?.sd15Defaults?.qualityPreset || 'quality'}
              onChange={async (e) => {
                try {
                  await onThemeUpdate({ sd15Defaults: { ...theme?.sd15Defaults, qualityPreset: e.target.value } });
                  toast.success('Quality preset updated');
                } catch (err) {
                  toast.error(err.message || 'Failed to update quality preset');
                }
              }}
              className="w-full px-3 py-2 bg-midnight-900 border border-midnight-600 rounded-lg
                         text-parchment-200 focus:outline-none focus:border-accent-gold"
            >
              {QUALITY_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-parchment-500 mt-1">
              {QUALITY_PRESETS.find(p => p.value === (theme?.sd15Defaults?.qualityPreset || 'quality'))?.description}
            </p>
          </div>
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

export default GenerationTab;
