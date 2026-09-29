/**
 * Parameter Parsing Utilities
 *
 * Provides consistent parsing and validation for query and path parameters.
 * All functions throw AppError(400) on invalid input, ensuring 400 status codes
 * instead of 500s from database errors.
 */

import { AppError } from '../middleware/errorHandler.js';

/**
 * Parse an integer with bounds checking.
 * Returns the default if the value is undefined or empty.
 * Throws AppError(400) on NaN or out-of-range values.
 *
 * @param {*} value - The value to parse
 * @param {Object} options - Options
 * @param {number} [options.min] - Minimum allowed value
 * @param {number} [options.max] - Maximum allowed value
 * @param {number} [options.default] - Default value if undefined/empty
 * @param {string} [options.name='value'] - Parameter name for error messages
 * @returns {number} The parsed integer
 * @throws {AppError} 400 error if validation fails
 */
export function parseBoundedInt(value, { min, max, default: defaultValue, name = 'value' } = {}) {
  // Use default if value is undefined, null, or empty string
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new AppError(`${name} is required`, 400);
  }

  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    throw new AppError(`Invalid ${name}: must be a number`, 400);
  }

  if (min !== undefined && parsed < min) {
    throw new AppError(`Invalid ${name}: must be at least ${min}`, 400);
  }

  if (max !== undefined && parsed > max) {
    throw new AppError(`Invalid ${name}: must be at most ${max}`, 400);
  }

  return parsed;
}

/**
 * Parse a required integer path parameter.
 * Throws AppError(400) on NaN.
 *
 * @param {*} value - The value to parse
 * @param {string} [name='id'] - Parameter name for error messages
 * @returns {number} The parsed integer
 * @throws {AppError} 400 error if validation fails
 */
export function parseIdParam(value, name = 'id') {
  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    throw new AppError(`Invalid ${name}`, 400);
  }

  return parsed;
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
