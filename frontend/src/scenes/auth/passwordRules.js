/**
 * Client-side password rules, mirroring validatePassword() in
 * api/src/services/registrationService.js. bcrypt only hashes the first 72
 * bytes, so the server rejects longer passwords; checking here gives the
 * player the reason before the request is sent.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

/** Short hint shown in password placeholders. */
export const PASSWORD_HINT = `${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_BYTES} characters`;

/**
 * UTF-8 byte length of a string (what bcrypt and the server count).
 * @param {string} value
 * @returns {number}
 */
export function passwordByteLength(value) {
  return new TextEncoder().encode(value).length;
}

/**
 * Validate a new password.
 * @param {string} value
 * @returns {string|null} Error message, or null when valid
 */
export function getPasswordError(value) {
  if (!value) return 'Password is required';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (passwordByteLength(value) > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} letters; accented letters and emoji count as more than one)`;
  }
  return null;
}
