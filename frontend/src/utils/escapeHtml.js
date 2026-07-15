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

/**
 * Escape a dynamic value for interpolation inside a quoted HTML attribute.
 *
 * `escapeHtml` is sufficient for text nodes, but browsers do not encode quote
 * characters when serializing a div's textContent. Attribute values therefore
 * need this additional quote encoding to prevent breaking out of `title`,
 * `data-*`, `src`, and similar attributes.
 *
 * @param {any} value - Attribute value (will be converted to string)
 * @returns {string} Escaped value safe inside single- or double-quoted HTML
 */
export function escapeHtmlAttribute(value) {
  if (value === null || value === undefined) return '';
  return escapeHtml(String(value))
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
