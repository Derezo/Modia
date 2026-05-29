/**
 * Character Name Validation Utilities
 *
 * Provides server-side validation for character names to prevent XSS attacks
 * and ensure names meet format requirements. This is defense-in-depth;
 * the frontend should also validate, but the server is the authoritative gate.
 */

import { AppError } from '../middleware/errorHandler.js';

/**
 * Regex for valid character names.
 * Allows: Unicode letters, combining marks, digits, spaces, apostrophes, hyphens, underscores.
 * Rejects: HTML tags, SQL injection characters, control characters, etc.
 */
const NAME_RE = /^[\p{L}\p{M}0-9 ''\-_]+$/u;

/**
 * Regex to check if a string contains at least one letter.
 */
const HAS_LETTER_RE = /\p{L}/u;

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
