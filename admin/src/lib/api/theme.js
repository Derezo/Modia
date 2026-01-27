/**
 * Theme API - Theme and preset management
 */

import { fetchAPI } from './client';

/**
 * Get current theme configuration
 * @returns {Promise<object>} Theme configuration
 */
export const getTheme = () => fetchAPI('/theme');

/**
 * Update theme configuration
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated theme
 */
export const updateTheme = (updates) =>
  fetchAPI('/theme', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

/**
 * Get all theme presets
 * @returns {Promise<object>} List of presets
 */
export const getThemePresets = () => fetchAPI('/theme/presets');

/**
 * Get a specific theme preset
 * @param {string} name - Preset name
 * @returns {Promise<object>} Preset details
 */
export const getThemePreset = (name) => fetchAPI(`/theme/presets/${name}`);

/**
 * Save current theme as a preset
 * @param {string} name - Preset name
 * @param {string} description - Preset description
 * @returns {Promise<object>} Created preset
 */
export const saveThemePreset = (name, description = '') =>
  fetchAPI('/theme/presets', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });

/**
 * Apply a theme preset
 * @param {string} name - Preset name to apply
 * @returns {Promise<object>} Applied theme
 */
export const applyThemePreset = (name) =>
  fetchAPI(`/theme/presets/${name}/apply`, {
    method: 'POST',
  });

/**
 * Delete a theme preset
 * @param {string} name - Preset name to delete
 * @returns {Promise<object>} Deletion result
 */
export const deleteThemePreset = (name) =>
  fetchAPI(`/theme/presets/${name}`, {
    method: 'DELETE',
  });
