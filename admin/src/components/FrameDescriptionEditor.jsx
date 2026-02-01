/**
 * FrameDescriptionEditor - Edit per-frame prompt descriptions for character animations
 *
 * Allows customization of the 8 frame descriptions used during SD1.5 animation generation.
 * Provides default descriptions from the manifest with ability to override per character.
 *
 * @param {Object} props
 * @param {string} props.characterId - Character ID
 * @param {string} props.animation - Current animation type (idle, walk, attack, etc.)
 * @param {Object} props.animationConfig - Animation config from manifest (description, frameDescriptions)
 * @param {Object|null} props.overrides - Character's frameDescriptionOverrides object
 * @param {Function} props.onSave - Callback when overrides are saved (frameDescriptionOverrides) => void
 * @param {boolean} props.loading - Whether save is in progress
 * @param {boolean} props.disabled - Whether editor is disabled
 */

import { useState, useEffect, useMemo } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ResetIcon,
  CheckIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';

const FRAME_COUNT = 8;

/**
 * Single frame description input
 */
function FrameInput({ index, value, defaultValue, onChange, disabled }) {
  const isModified = value !== defaultValue && value !== '';

  return (
    <div className="flex items-start gap-2">
      <span
        className={`
          flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs font-medium
          ${isModified ? 'bg-accent-gold/20 text-accent-gold' : 'bg-midnight-800 text-parchment-500'}
        `}
      >
        {index + 1}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(index, e.target.value)}
        disabled={disabled}
        placeholder={defaultValue}
        className={`
          flex-1 px-2 py-1.5 text-xs rounded border transition-colors
          bg-midnight-800 text-parchment-200 placeholder-parchment-600
          focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isModified ? 'border-accent-gold/50' : 'border-midnight-700'}
        `}
      />
    </div>
  );
}

export default function FrameDescriptionEditor({
  characterId: _characterId,
  animation,
  animationConfig,
  overrides,
  onSave,
  loading = false,
  disabled = false,
}) {
  // Expanded state for collapsible section
  const [isExpanded, setIsExpanded] = useState(false);

  // Local state for edited frame descriptions
  const [frameDescriptions, setFrameDescriptions] = useState([]);

  // Get default descriptions from animation config or use generic fallback
  const defaultDescriptions = useMemo(() => {
    if (animationConfig?.frameDescriptions?.length === FRAME_COUNT) {
      return animationConfig.frameDescriptions;
    }
    // Fallback generic descriptions
    return Array.from({ length: FRAME_COUNT }, (_, i) => `frame ${i + 1} of ${FRAME_COUNT}`);
  }, [animationConfig]);

  // Get character's existing overrides for this animation
  const existingOverrides = useMemo(() => {
    return overrides?.[animation] || [];
  }, [overrides, animation]);

  // Initialize local state when animation or overrides change
  useEffect(() => {
    // Start with existing overrides or empty strings (will show placeholder)
    const initial = Array.from({ length: FRAME_COUNT }, (_, i) =>
      existingOverrides[i] || ''
    );
    setFrameDescriptions(initial);
  }, [animation, existingOverrides]);

  // Check if any frames have overrides
  const hasModifications = useMemo(() => {
    return frameDescriptions.some((desc, i) => desc !== '' && desc !== defaultDescriptions[i]);
  }, [frameDescriptions, defaultDescriptions]);

  // Handle frame description change
  const handleFrameChange = (index, value) => {
    setFrameDescriptions(prev => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  // Reset all overrides to defaults
  const handleReset = () => {
    setFrameDescriptions(Array(FRAME_COUNT).fill(''));
  };

  // Save current overrides
  const handleSave = () => {
    if (!onSave) return;

    // Build new overrides object
    // Only include non-empty values that differ from defaults
    const newOverridesForAnimation = frameDescriptions.map((desc, i) =>
      desc !== '' && desc !== defaultDescriptions[i] ? desc : null
    );

    // Check if any non-null values exist
    const hasOverrides = newOverridesForAnimation.some(v => v !== null);

    // Build the complete frameDescriptionOverrides object
    const newOverrides = { ...(overrides || {}) };

    if (hasOverrides) {
      // Replace nulls with empty strings for storage (8-element array)
      newOverrides[animation] = newOverridesForAnimation.map(v => v || '');
    } else {
      // Remove the animation key if no overrides
      delete newOverrides[animation];
    }

    onSave(newOverrides);
  };

  // Count modified frames
  const modifiedCount = frameDescriptions.filter(
    (desc, i) => desc !== '' && desc !== defaultDescriptions[i]
  ).length;

  return (
    <div className="space-y-2">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          w-full flex items-center justify-between p-2 rounded-lg
          bg-midnight-800/50 border border-midnight-700
          text-parchment-300 hover:bg-midnight-800 transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronRightIcon className="w-4 h-4" />
          )}
          <span className="text-sm font-medium">Frame Descriptions</span>
          {modifiedCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 bg-accent-gold/20 text-accent-gold rounded">
              {modifiedCount} custom
            </span>
          )}
        </div>
        <span className="text-xs text-parchment-500">
          {animation} - {FRAME_COUNT} frames
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-3 bg-midnight-800/30 border border-midnight-700 rounded-lg space-y-3">
          {/* Info note */}
          <div className="flex items-start gap-2 p-2 bg-midnight-900/50 border border-midnight-800 rounded text-xs text-parchment-500">
            <InfoCircledIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Customize frame descriptions to control the motion per frame during SD1.5 generation.
              Empty fields use the default descriptions from the manifest.
            </span>
          </div>

          {/* Animation description */}
          {animationConfig?.description && (
            <div className="text-xs text-parchment-400 italic">
              {animationConfig.description}
            </div>
          )}

          {/* Frame inputs */}
          <div className="space-y-2">
            {Array.from({ length: FRAME_COUNT }, (_, i) => (
              <FrameInput
                key={i}
                index={i}
                value={frameDescriptions[i] || ''}
                defaultValue={defaultDescriptions[i]}
                onChange={handleFrameChange}
                disabled={disabled || loading}
              />
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-midnight-700">
            <button
              type="button"
              onClick={handleReset}
              disabled={!hasModifications || loading || disabled}
              className="px-3 py-1.5 text-xs bg-midnight-800 text-parchment-400 rounded
                         hover:bg-midnight-700 hover:text-parchment-200 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center gap-1.5"
            >
              <ResetIcon className="w-3 h-3" />
              Reset to Defaults
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={loading || disabled}
              className="px-3 py-1.5 text-xs bg-accent-gold text-midnight-950 rounded
                         hover:bg-accent-gold/90 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center gap-1.5"
            >
              {loading ? (
                <span className="animate-spin">...</span>
              ) : (
                <CheckIcon className="w-3 h-3" />
              )}
              Save Descriptions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
