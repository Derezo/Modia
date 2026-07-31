export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,127})$/;

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function push(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

export function exactObject(value, path, keys, errors) {
  if (!isPlainObject(value)) {
    push(errors, path, 'must be a plain object');
    return false;
  }
  for (const key of keys) {
    if (!own(value, key)) push(errors, `${path}.${key}`, 'is required');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) push(errors, `${path}.${key}`, 'additional property is not allowed');
  }
  return true;
}

export function array(value, path, errors, { min = 0 } = {}) {
  if (!Array.isArray(value)) {
    push(errors, path, 'must be an array');
    return false;
  }
  if (value.length < min) push(errors, path, `must contain at least ${min} items`);
  return true;
}

export function nonEmptyString(value, path, errors, { pattern } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    push(errors, path, 'must be a non-empty string');
    return false;
  }
  if (pattern && !pattern.test(value)) {
    push(errors, path, `must match ${pattern}`);
    return false;
  }
  return true;
}

export function safeId(value, path, errors) {
  return nonEmptyString(value, path, errors, { pattern: SAFE_ID_PATTERN });
}

export function sha256(value, path, errors) {
  return nonEmptyString(value, path, errors, { pattern: SHA256_PATTERN });
}

export function integer(value, path, errors, { min, max } = {}) {
  if (!Number.isSafeInteger(value)) {
    push(errors, path, 'must be a safe integer');
    return false;
  }
  if (min !== undefined && value < min) push(errors, path, `must be >= ${min}`);
  if (max !== undefined && value > max) push(errors, path, `must be <= ${max}`);
  return true;
}

export function finite(value, path, errors, { min, max } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    push(errors, path, 'must be a finite number');
    return false;
  }
  if (min !== undefined && value < min) push(errors, path, `must be >= ${min}`);
  if (max !== undefined && value > max) push(errors, path, `must be <= ${max}`);
  return true;
}

export function boolean(value, path, errors) {
  if (typeof value !== 'boolean') {
    push(errors, path, 'must be a boolean');
    return false;
  }
  return true;
}

export function enumeration(value, path, allowed, errors) {
  if (!allowed.includes(value)) {
    push(errors, path, `must be one of ${allowed.join(', ')}`);
    return false;
  }
  return true;
}

export function uniqueStrings(value, path, errors, { min = 0 } = {}) {
  if (!array(value, path, errors, { min })) return false;
  const seen = new Set();
  value.forEach((item, index) => {
    if (!safeId(item, `${path}[${index}]`, errors)) return;
    if (seen.has(item)) push(errors, `${path}[${index}]`, `duplicate value ${item}`);
    seen.add(item);
  });
  return true;
}

export function uniqueRecordIds(records, path, errors) {
  const ids = new Set();
  if (!Array.isArray(records)) return ids;
  records.forEach((record, index) => {
    if (!isPlainObject(record) || typeof record.id !== 'string') return;
    if (ids.has(record.id)) push(errors, `${path}[${index}].id`, `duplicate id ${record.id}`);
    ids.add(record.id);
  });
  return ids;
}

export function assertion(result, name, code) {
  if (!result.valid) {
    const error = new TypeError(`${name} validation failed:\n${result.errors.join('\n')}`);
    error.code = code;
    error.validationErrors = result.errors;
    throw error;
  }
}
