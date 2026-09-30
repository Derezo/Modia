import { AppError } from '../middleware/errorHandler.js';

/** Largest PostgreSQL INTEGER (int4). The default upper bound, so an
 * oversized id is a 400 here instead of an 'out of range for type integer'
 * 500 from the query. */
export const PG_INT_MAX = 2147483647;
export const PG_INT_MIN = -2147483648;

const INTEGER_PATTERN = /^[+-]?\d+$/;

/**
 * Parse a whole decimal integer from a number or string, or return null.
 * @param {*} value
 * @returns {number|null}
 */
function parseStrictInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Pure validator for positive integers with range checking.
 * Returns a result object, throws nothing.
 * Use when you want to branch on validity without exceptions.
 *
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} [options.min=1] - Minimum allowed value
 * @param {number} [options.max=PG_INT_MAX] - Maximum allowed value (PostgreSQL INTEGER max)
 * @param {number} [options.defaultValue] - Default value if input is missing
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validatePositiveInt(value, options = {}) {
  const { min = 1, max = PG_INT_MAX, defaultValue } = options;
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return { valid: true, value: defaultValue };
    return { valid: false, error: 'Value is required' };
  }
  // Whole decimal integers only: parseInt's lenient prefix parsing let
  // '12abc', '1.9' and '0x10' through as 12, 1 and 0
  const parsed = parseStrictInteger(value);
  if (parsed === null) return { valid: false, error: 'Value must be a number' };
  if (parsed < min) return { valid: false, error: `Value must be at least ${min}` };
  if (parsed > max) return { valid: false, error: `Value must be at most ${max}` };
  return { valid: true, value: parsed };
}

/**
 * Route-handler helper that throws AppError on invalid input.
 * Use inside asyncHandler routes.
 *
 * @param {*} value - Value to validate
 * @param {string} fieldName - Name of the field for error messages
 * @param {Object} options - Validation options (same as validatePositiveInt)
 * @returns {number} The parsed and validated integer
 * @throws {AppError} 400 error if validation fails
 */
export function parseIntOrThrow(value, fieldName, options = {}) {
  const result = validatePositiveInt(value, options);
  if (!result.valid) {
    throw new AppError(`Invalid ${fieldName}: ${result.error}`, 400);
  }
  return result.value;
}
