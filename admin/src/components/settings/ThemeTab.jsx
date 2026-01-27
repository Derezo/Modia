/**
 * ThemeTab - Theme configuration tab for Settings page
 *
 * Allows editing:
 * - Style settings (trigger, base phrase, technique, texture, mood)
 * - Negative prompt
 * - Category modifiers (suffix and size per category)
 * - Live prompt preview
 */

import { useState, useCallback } from 'react';
import { ReloadIcon } from '@radix-ui/react-icons';
import ThemePresetManager from '../ThemePresetManager';
import { EditableField } from './EditableField';

/**
 * Theme tab content
 * @param {object} props
 * @param {object} props.theme - Current theme configuration
 * @param {boolean} props.saving - Whether theme is being saved
 * @param {function} props.onUpdateField - Callback to update a theme field
 * @param {function} props.onUpdateCategoryModifier - Callback to update a category modifier
 * @param {function} props.onPresetApplied - Callback when a preset is applied
 */
export function ThemeTab({ theme, saving, onUpdateField, onUpdateCategoryModifier, onPresetApplied }) {
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

      {/* Saving indicator - positioned higher to avoid bottom panels */}
      {saving && (
        <div className="fixed top-20 right-4 bg-midnight-800 border border-midnight-600 rounded-lg px-4 py-2 flex items-center gap-2 shadow-lg z-50">
          <ReloadIcon className="w-4 h-4 animate-spin text-accent-gold" />
          <span className="text-parchment-200 text-sm">Saving changes...</span>
        </div>
      )}
    </div>
  );
}

export default ThemeTab;
