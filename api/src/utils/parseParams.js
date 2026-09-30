/**
 * Parameter Parsing Utilities
 *
 * Named helpers for common query and path parameters (IDs, limits, offsets,
 * dates). Integer parsing itself lives in validateNumericParam.js; these
 * helpers only choose bounds and error wording, so there is one rule.
 * All functions throw AppError(400) on invalid input, ensuring 400 status codes
 * instead of 500s from database errors.
 */

import { AppError } from '../middleware/errorHandler.js';
import { parseIntOrThrow, validatePositiveInt, PG_INT_MAX, PG_INT_MIN } from './validateNumericParam.js';

/**
 * Parse an integer with bounds checking.
 * Returns the default if the value is undefined or empty.
 * Throws AppError(400) on NaN or out-of-range values.
 *
 * @param {*} value - The value to parse
 * @param {Object} options - Options
 * @param {number} [options.min] - Minimum allowed value (default: PG INTEGER min)
 * @param {number} [options.max] - Maximum allowed value (default: PG INTEGER max)
 * @param {number} [options.default] - Default value if undefined/empty
 * @param {string} [options.name='value'] - Parameter name for error messages
 * @returns {number} The parsed integer
 * @throws {AppError} 400 error if validation fails
 */
export function parseBoundedInt(value, { min, max, default: defaultValue, name = 'value' } = {}) {
  // One parsing rule for the API: validateNumericParam.js owns it; this
  // wrapper only supplies the named error and bounds. Unset bounds default to
  // the PostgreSQL INTEGER range, so an oversized value is a 400 here rather
  // than an 'out of range for type integer' 500 from the query.
  return parseIntOrThrow(value, name, {
    min: min ?? PG_INT_MIN,
    max: max ?? PG_INT_MAX,
    defaultValue
  });
}

/**
 * Parse a required integer ID (path or query parameter).
 * Throws AppError(400) on a missing, non-numeric or non-positive value;
 * database IDs start at 1, so 0 and negatives are rejected here rather than
 * reaching a query.
 *
 * @param {*} value - The value to parse
 * @param {string} [name='id'] - Parameter name for error messages
 * @returns {number} The parsed integer (>= 1)
 * @throws {AppError} 400 error if validation fails
 */
export function parseIdParam(value, name = 'id') {
  const result = validatePositiveInt(value, { min: 1, max: PG_INT_MAX });
  if (!result.valid) {
    throw new AppError(`Invalid ${name}`, 400);
  }
  return result.value;
}

/**
 * Parse a date parameter.
 * Returns null if value is undefined or empty.
 * Throws AppError(400) on invalid date format.
 *
 * @param {*} value - The value to parse
 * @param {string} [name='date'] - Parameter name for error messages
 * @returns {Date|null} The parsed date or null
 * @throws {AppError} 400 error if the date is invalid
 */
export function parseDateParam(value, name = 'date') {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    throw new AppError(`Invalid ${name}: must be a valid date`, 400);
  }

  return date;
}

/**
 * Parse a limit parameter with bounds.
 *
 * @param {*} value - The value to parse
 * @param {number} [defaultValue=50] - Default limit
 * @param {number} [maxValue=100] - Maximum allowed limit
 * @returns {number} The parsed limit
 */
export function parseLimit(value, defaultValue = 50, maxValue = 100) {
  return parseBoundedInt(value, {
    min: 1,
    max: maxValue,
    default: defaultValue,
    name: 'limit'
  });
}

/**
 * Parse an offset parameter.
 *
 * @param {*} value - The value to parse
 * @returns {number} The parsed offset (minimum 0)
 */
export function parseOffset(value) {
  return parseBoundedInt(value, {
    min: 0,
    default: 0,
    name: 'offset'
  });
}

export default {
  parseBoundedInt,
  parseIdParam,
  parseDateParam,
  parseLimit,
  parseOffset
};
