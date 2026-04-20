import { AppError } from '../middleware/errorHandler.js';

/**
 * Pure validator for positive integers with range checking.
 * Returns a result object, throws nothing.
 * Use when you want to branch on validity without exceptions.
 *
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} [options.min=1] - Minimum allowed value
 * @param {number} [options.max=Number.MAX_SAFE_INTEGER] - Maximum allowed value
 * @param {number} [options.defaultValue] - Default value if input is missing
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validatePositiveInt(value, options = {}) {
  const { min = 1, max = Number.MAX_SAFE_INTEGER, defaultValue } = options;
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return { valid: true, value: defaultValue };
    return { valid: false, error: 'Value is required' };
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return { valid: false, error: 'Value must be a number' };
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
