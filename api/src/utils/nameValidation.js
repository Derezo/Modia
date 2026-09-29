/**
 * Name Validation Utilities
 *
 * Provides server-side validation for character names, display names, and
 * free-form text fields to prevent XSS attacks and ensure inputs meet format
 * requirements. This is defense-in-depth; the frontend should also validate,
 * but the server is the authoritative gate.
 */

import { AppError } from '../middleware/errorHandler.js';

/**
 * Regex for valid character/display names.
 * Allows: Unicode letters, combining marks, digits, spaces, apostrophes, hyphens, underscores.
 * Rejects: HTML tags, SQL injection characters, control characters, etc.
 */
const NAME_RE = /^[\p{L}\p{M}0-9 ''\-_]+$/u;

/**
 * Regex to check if a string contains at least one letter.
 */
const HAS_LETTER_RE = /\p{L}/u;

/**
 * Regex to detect control characters (except newline for descriptions).
 * Includes: ASCII control chars, Unicode control categories
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Regex to detect HTML-like tags.
 */
const HTML_TAG_RE = /[<>]/;

/**
 * Validate and sanitize a character name.
 *
 * @param {*} name - The name to validate
 * @returns {string} The trimmed, validated name
 * @throws {AppError} 400 error if validation fails
 *
 * @example
 * const validName = validateCharacterName(req.body.name);
 * // Use validName for DB insert (it's already trimmed)
 */
export function validateCharacterName(name) {
  // Type check
  if (typeof name !== 'string') {
    throw new AppError('Character name is required', 400);
  }

  // Trim whitespace
  const trimmed = name.trim();

  // Length validation (2-24 characters after trimming)
  if (trimmed.length < 2 || trimmed.length > 24) {
    throw new AppError('Character name must be between 2 and 24 characters', 400);
  }

  // Character set validation (blocks HTML tags, SQL injection chars, control chars)
  if (!NAME_RE.test(trimmed)) {
    throw new AppError('Character name contains invalid characters', 400);
  }

  // Must contain at least one letter (prevents pure numeric/symbol names)
  if (!HAS_LETTER_RE.test(trimmed)) {
    throw new AppError('Character name must contain a letter', 400);
  }

  return trimmed;
}

/**
 * Validate a character name without throwing (returns result object).
 * Use when you need to check validity without exception handling.
 *
 * @param {*} name - The name to validate
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
export function validateCharacterNameResult(name) {
  try {
    const trimmed = validateCharacterName(name);
    return { valid: true, value: trimmed };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Validate and sanitize a display name (clan names, party names, etc.).
 * Similar to character names but with configurable length limits.
 *
 * @param {*} name - The name to validate
 * @param {Object} options - Options
 * @param {string} [options.label='Name'] - Field label for error messages
 * @param {number} [options.min=2] - Minimum length
 * @param {number} [options.max=32] - Maximum length
 * @param {boolean} [options.optional=false] - Allow undefined/empty
 * @returns {string|null} The trimmed, validated name (null if optional and empty)
 * @throws {AppError} 400 error if validation fails
 */
export function validateDisplayName(name, { label = 'Name', min = 2, max = 32, optional = false } = {}) {
  // Type check
  if (name === undefined || name === null || name === '') {
    if (optional) {
      return null;
    }
    throw new AppError(`${label} is required`, 400);
  }

  if (typeof name !== 'string') {
    throw new AppError(`${label} must be a string`, 400);
  }

  // Trim whitespace
  const trimmed = name.trim();

  // Allow empty if optional (after trim)
  if (trimmed === '' && optional) {
    return null;
  }

  // Length validation
  if (trimmed.length < min || trimmed.length > max) {
    throw new AppError(`${label} must be between ${min} and ${max} characters`, 400);
  }

  // Character set validation (blocks HTML tags, SQL injection chars, control chars)
  if (!NAME_RE.test(trimmed)) {
    throw new AppError(`${label} contains invalid characters`, 400);
  }

  // Must contain at least one letter (prevents pure numeric/symbol names)
  if (!HAS_LETTER_RE.test(trimmed)) {
    throw new AppError(`${label} must contain a letter`, 400);
  }

  return trimmed;
}

/**
 * Validate and sanitize free-form text (descriptions, messages, etc.).
 * Allows more characters than names but blocks HTML and control characters.
 *
 * @param {*} text - The text to validate
 * @param {Object} options - Options
 * @param {string} [options.label='Text'] - Field label for error messages
 * @param {number} [options.max=256] - Maximum length
 * @param {boolean} [options.optional=true] - Allow undefined/empty
 * @param {boolean} [options.allowNewlines=false] - Allow newline characters
 * @returns {string|null} The trimmed, validated text (null if optional and empty)
 * @throws {AppError} 400 error if validation fails
 */
export function validateFreeText(text, { label = 'Text', max = 256, optional = true, allowNewlines = false } = {}) {
  // Type check
  if (text === undefined || text === null || text === '') {
    if (optional) {
      return null;
    }
    throw new AppError(`${label} is required`, 400);
  }

  if (typeof text !== 'string') {
    throw new AppError(`${label} must be a string`, 400);
  }

  // Trim whitespace
  const trimmed = text.trim();

  // Allow empty if optional (after trim)
  if (trimmed === '' && optional) {
    return null;
  }

  // Length validation
  if (trimmed.length > max) {
    throw new AppError(`${label} must be ${max} characters or less`, 400);
  }

  // Block HTML tags
  if (HTML_TAG_RE.test(trimmed)) {
    throw new AppError(`${label} contains invalid characters`, 400);
  }

  // Block control characters
  if (CONTROL_CHAR_RE.test(trimmed)) {
    throw new AppError(`${label} contains invalid characters`, 400);
  }

  // If newlines are not allowed, check for them specifically
  if (!allowNewlines && /[\r\n]/.test(trimmed)) {
    throw new AppError(`${label} cannot contain line breaks`, 400);
  }

  return trimmed;
}
