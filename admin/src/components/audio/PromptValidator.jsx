/**
 * PromptValidator - Real-time SFX prompt validation component
 * Validates ElevenLabs prompts for comma count restrictions.
 *
 * @module PromptValidator
 * @description Textarea with real-time comma counting and validation feedback.
 *
 * ElevenLabs interprets comma-separated prompts as multiple distinct sounds,
 * generating each sequentially. Maximum 1 comma allowed per prompt.
 */

import { useState, useCallback, useMemo } from 'react';
import { CheckCircledIcon, CrossCircledIcon, ExclamationTriangleIcon } from '@radix-ui/react-icons';

/**
 * Count commas in a string
 */
function countCommas(text) {
  return (text.match(/,/g) || []).length;
}

/**
 * Get validation state based on comma count
 *
 * @param {number} count - Number of commas
 * @returns {'valid' | 'warning' | 'invalid'} - Validation state
 */
function getValidationState(count) {
  if (count === 0) return 'valid';
  if (count === 1) return 'warning';
  return 'invalid';
}

/**
 * PromptValidator component for SFX prompt editing
 *
 * @param {Object} props - Component props
 * @param {string} props.value - Current prompt value
 * @param {Function} props.onChange - Callback when prompt changes
 * @param {string} [props.className] - Additional CSS classes
 * @param {string} [props.placeholder] - Textarea placeholder text
 * @param {boolean} [props.disabled] - Whether input is disabled
 */
export default function PromptValidator({
  value = '',
  onChange,
  className = '',
  placeholder = 'Enter SFX prompt...',
  disabled = false,
}) {
  const [isFocused, setIsFocused] = useState(false);

  const commaCount = useMemo(() => countCommas(value), [value]);
  const validationState = useMemo(() => getValidationState(commaCount), [commaCount]);

  /**
   * Handle text change
   */
  const handleChange = useCallback((e) => {
    onChange?.(e.target.value);
  }, [onChange]);

  /**
   * Get border color based on validation state
   */
  const getBorderClass = () => {
    if (!isFocused && !value) return 'border-midnight-700';

    switch (validationState) {
      case 'valid':
        return 'border-accent-emerald focus:border-accent-emerald focus:ring-accent-emerald/30';
      case 'warning':
        return 'border-accent-gold focus:border-accent-gold focus:ring-accent-gold/30';
      case 'invalid':
        return 'border-accent-ruby focus:border-accent-ruby focus:ring-accent-ruby/30';
      default:
        return 'border-midnight-700 focus:border-accent-gold';
    }
  };

  /**
   * Get validation icon and message
   */
  const getValidationIndicator = () => {
    if (!value) return null;

    switch (validationState) {
      case 'valid':
        return {
          icon: <CheckCircledIcon className="w-4 h-4 text-accent-emerald" />,
          message: 'Prompt is valid',
          className: 'text-accent-emerald',
        };
      case 'warning':
        return {
          icon: <ExclamationTriangleIcon className="w-4 h-4 text-accent-gold" />,
          message: '1 comma - acceptable but consider rephrasing',
          className: 'text-accent-gold',
        };
      case 'invalid':
        return {
          icon: <CrossCircledIcon className="w-4 h-4 text-accent-ruby" />,
          message: `${commaCount} commas - will generate multiple sounds (max 1)`,
          className: 'text-accent-ruby',
        };
      default:
        return null;
    }
  };

  const indicator = getValidationIndicator();

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Textarea */}
      <textarea
        value={value}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
        className={`
          w-full px-3 py-2 bg-midnight-800 rounded-lg
          text-parchment-100 placeholder-parchment-500
          focus:outline-none focus:ring-1 resize-none
          disabled:opacity-50 disabled:cursor-not-allowed
          ${getBorderClass()}
        `}
      />

      {/* Validation footer */}
      <div className="flex items-center justify-between text-xs">
        {/* Comma count */}
        <div className="flex items-center gap-1.5">
          <span className="text-parchment-500">Commas:</span>
          <span className={`font-mono font-medium ${
            validationState === 'invalid' ? 'text-accent-ruby' :
            validationState === 'warning' ? 'text-accent-gold' :
            'text-parchment-300'
          }`}>
            {commaCount}
          </span>
        </div>

        {/* Validation message */}
        {indicator && (
          <div className={`flex items-center gap-1.5 ${indicator.className}`}>
            {indicator.icon}
            <span>{indicator.message}</span>
          </div>
        )}
      </div>

      {/* Help text for invalid state */}
      {validationState === 'invalid' && (
        <div className="p-2 bg-accent-ruby/10 border border-accent-ruby/20 rounded-lg">
          <p className="text-xs text-parchment-300">
            <strong className="text-accent-ruby">Tip:</strong> Use &quot;with&quot; and &quot;and&quot; to join descriptors instead of commas.
          </p>
          <p className="text-xs text-parchment-500 mt-1">
            Example: &quot;Fantasy sword slash with sharp metallic whoosh and light impact&quot;
          </p>
        </div>
      )}
    </div>
  );
}
