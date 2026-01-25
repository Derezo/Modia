/**
 * Audio Validation Utilities
 * Shared validation functions for audio generation.
 *
 * @module audioValidation
 * @description Provides SFX prompt validation per CLAUDE.md guidelines.
 * ElevenLabs interprets comma-separated prompts as multiple distinct sounds,
 * so we enforce a maximum of 1 comma per prompt.
 */

/**
 * Validate SFX prompt for comma count
 * Per CLAUDE.md: Maximum 1 comma per prompt for ElevenLabs
 *
 * @param {string} prompt - The prompt to validate
 * @param {Object} options - Validation options
 * @param {boolean} [options.strictMode=true] - If true, missing prompt is invalid.
 *   Use strictMode=true for routes (prompt required).
 *   Use strictMode=false for services (missing prompt may use metadata default).
 * @returns {{ valid: boolean, commaCount: number, message: string }}
 *
 * @example
 * // Route validation (strict - prompt required)
 * const result = validateSFXPrompt(prompt);
 * if (!result.valid) throw new Error(result.message);
 *
 * @example
 * // Service validation (non-strict - missing prompt ok)
 * const result = validateSFXPrompt(prompt, { strictMode: false });
 * if (!result.valid) throw new Error(result.message);
 */
export function validateSFXPrompt(prompt, { strictMode = true } = {}) {
  // Handle missing/invalid prompt
  if (!prompt || typeof prompt !== 'string') {
    if (strictMode) {
      return {
        valid: false,
        commaCount: 0,
        message: 'Prompt is required and must be a string'
      };
    }
    // Non-strict mode: missing prompt is ok (may use metadata default)
    return {
      valid: true,
      commaCount: 0,
      message: 'No prompt provided (will use metadata default)'
    };
  }

  // Count commas
  const commaCount = (prompt.match(/,/g) || []).length;
  const valid = commaCount <= 1;

  return {
    valid,
    commaCount,
    message: valid
      ? 'Prompt is valid'
      : `Prompt has ${commaCount} commas. Maximum allowed is 1. ElevenLabs interprets comma-separated prompts as multiple distinct sounds.`
  };
}

/**
 * Format SFX prompt suggestion
 * Provides guidance on fixing prompts with too many commas.
 *
 * @param {string} prompt - The prompt to analyze
 * @returns {string} Suggestion for fixing the prompt
 */
export function getSFXPromptSuggestion(prompt) {
  if (!prompt) return '';

  const parts = prompt.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 2) return '';

  // Suggest combining with 'with' and 'and'
  const [first, ...rest] = parts;
  const suggestion = `${first} with ${rest.join(' and ')}`;

  return `Try: "${suggestion}"`;
}

export default {
  validateSFXPrompt,
  getSFXPromptSuggestion
};
