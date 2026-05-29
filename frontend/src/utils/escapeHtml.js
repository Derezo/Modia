/**
 * Escape HTML special characters to prevent XSS attacks
 *
 * This is the canonical XSS-escaping utility for innerHTML interpolation.
 * Use this function whenever you need to safely insert user-provided or
 * dynamic content into HTML strings to prevent script injection.
 *
 * @param {any} text - Text to escape (will be converted to string)
 * @returns {string} Escaped text safe for innerHTML
 */
export function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
