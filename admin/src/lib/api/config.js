/**
 * Config API - System configuration and status
 */

import { fetchAPI } from './client';

/**
 * Get admin configuration
 * @returns {Promise<object>} Configuration data
 */
export const getConfig = () => fetchAPI('/config');

/**
 * Get asset statistics
 * @returns {Promise<object>} Stats for all categories
 */
export const getStats = () => fetchAPI('/stats');

/**
 * Get API status
 * @returns {Promise<object>} API status with enabled flag and utilities info
 */
export const getStatus = () => fetchAPI('/status');
