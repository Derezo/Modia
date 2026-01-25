/**
 * API Client for Admin Dashboard
 * Handles all API calls to the backend admin endpoints
 */

const API_BASE = '/api/admin';

/**
 * Generic fetch wrapper with error handling
 */
async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  // Remove Content-Type for FormData
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkError) {
    // Network error - server unreachable, CORS issue, etc.
    throw new Error(`Network error: ${networkError.message}. Is the API server running?`);
  }

  if (!response.ok) {
    // Try to parse error as JSON, fallback to status text
    let errorMessage;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || `API Error: ${response.status}`;
    } catch {
      // Response is not JSON (e.g., HTML error page)
      errorMessage = `API Error ${response.status}: ${response.statusText || 'Server error'}`;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * API Methods
 */
export const api = {
  // Config
  getConfig: () => fetchAPI('/config'),

  // Stats
  getStats: () => fetchAPI('/stats'),

  // Status
  getStatus: () => fetchAPI('/status'),

  // Assets
  getAssets: (category, params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.status) searchParams.set('status', params.status);
    if (params.biome) searchParams.set('biome', params.biome);
    if (params.subcategory) searchParams.set('subcategory', params.subcategory);

    const query = searchParams.toString();
    return fetchAPI(`/assets/${category}${query ? `?${query}` : ''}`);
  },

  getAsset: (category, id) => fetchAPI(`/assets/${category}/${id}`),

  // Get full prompt construction breakdown for an asset
  getAssetPrompt: (category, id) => fetchAPI(`/assets/${category}/${id}/prompt`),

  updateAsset: (category, id, updates) =>
    fetchAPI(`/assets/${category}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  // Generation
  generateAssets: (category, filters = {}, options = {}) =>
    fetchAPI('/generate', {
      method: 'POST',
      body: JSON.stringify({ category, filters, options }),
    }),

  // Generate specific assets by ID
  generateAssetsByIds: (category, assetIds, options = {}) =>
    fetchAPI('/generate', {
      method: 'POST',
      body: JSON.stringify({
        category,
        filters: { ids: assetIds },
        options,
      }),
    }),

  getQueue: () => fetchAPI('/generate/queue'),

  getJob: (jobId) => fetchAPI(`/generate/job/${jobId}`),

  cancelJob: (jobId) =>
    fetchAPI('/generate/cancel', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  cancelAllJobs: () =>
    fetchAPI('/generate/cancel', {
      method: 'POST',
      body: JSON.stringify({ all: true }),
    }),

  // Backups
  getBackups: () => fetchAPI('/backups'),

  createBackup: (reason = 'manual', options = {}) =>
    fetchAPI('/backups', {
      method: 'POST',
      body: JSON.stringify({ reason, ...options }),
    }),

  getBackup: (timestamp) => fetchAPI(`/backups/${timestamp}`),

  restoreBackup: (timestamp) =>
    fetchAPI(`/backups/${timestamp}/restore`, {
      method: 'POST',
    }),

  deleteBackup: (timestamp) =>
    fetchAPI(`/backups/${timestamp}`, {
      method: 'DELETE',
    }),

  // Theme
  getTheme: () => fetchAPI('/theme'),

  updateTheme: (updates) =>
    fetchAPI('/theme', {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  // Theme Presets
  getThemePresets: () => fetchAPI('/theme/presets'),

  getThemePreset: (name) => fetchAPI(`/theme/presets/${name}`),

  saveThemePreset: (name, description = '') =>
    fetchAPI('/theme/presets', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  applyThemePreset: (name) =>
    fetchAPI(`/theme/presets/${name}/apply`, {
      method: 'POST',
    }),

  deleteThemePreset: (name) =>
    fetchAPI(`/theme/presets/${name}`, {
      method: 'DELETE',
    }),

  // ============================================
  // Audio Assets
  // ============================================

  /**
   * Get audio assets by type with optional filters
   * @param {string} audioType - 'music' or 'sfx'
   * @param {object} params - Filter parameters
   * @param {string} [params.category] - Category filter (for sfx)
   * @param {string} [params.region] - Region filter (for music)
   * @param {string} [params.subcategory] - Subcategory filter
   * @param {string} [params.status] - Status filter ('exists', 'missing', 'error')
   * @returns {Promise<object>} Audio assets response
   */
  getAudioAssets: (audioType, params = {}) => {
    const searchParams = new URLSearchParams();
    if (params.category) searchParams.set('category', params.category);
    if (params.region) searchParams.set('region', params.region);
    if (params.subcategory) searchParams.set('subcategory', params.subcategory);
    if (params.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return fetchAPI(`/audio/${audioType}${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single audio asset by ID
   * @param {string} audioType - 'music' or 'sfx'
   * @param {string} id - Asset ID
   * @returns {Promise<object>} Audio asset details
   */
  getAudioAsset: (audioType, id) => fetchAPI(`/audio/${audioType}/${id}`),

  /**
   * Update an audio asset's metadata
   * @param {string} audioType - 'music' or 'sfx'
   * @param {string} id - Asset ID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated asset
   */
  updateAudioAsset: (audioType, id, updates) =>
    fetchAPI(`/audio/${audioType}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  /**
   * Get waveform visualization data for an audio asset
   * @param {string} audioType - 'music' or 'sfx'
   * @param {string} id - Asset ID
   * @returns {Promise<object>} Waveform data
   */
  getAudioWaveform: (audioType, id) => fetchAPI(`/audio/${audioType}/${id}/waveform`),

  /**
   * Get overall audio statistics
   * @returns {Promise<object>} Audio stats for music and sfx
   */
  getAudioStats: () => fetchAPI('/audio/stats'),

  // ============================================
  // Music-specific
  // ============================================

  /**
   * Set the primary variant for a music track
   * @param {string} trackId - Music track ID
   * @param {string} variantPath - Path to the variant file
   * @returns {Promise<object>} Updated track info
   */
  setMusicPrimaryVariant: (trackId, variantPath) =>
    fetchAPI(`/audio/music/${trackId}/primary`, {
      method: 'POST',
      body: JSON.stringify({ variantPath }),
    }),

  /**
   * Get Suno generation task status
   * @param {string} taskId - Suno task ID
   * @returns {Promise<object>} Task status
   */
  getSunoTaskStatus: (taskId) => fetchAPI(`/audio/suno/status/${taskId}`),

  // ============================================
  // SFX-specific
  // ============================================

  /**
   * Validate an SFX prompt before generation
   * Checks for comma count and other requirements
   * @param {string} prompt - The prompt to validate
   * @returns {Promise<object>} Validation result
   */
  validateSfxPrompt: (prompt) =>
    fetchAPI('/audio/sfx/validate', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  // ============================================
  // Audio Generation Queue
  // ============================================

  /**
   * Queue audio generation for assets
   * @param {string} audioType - 'music' or 'sfx'
   * @param {object} filters - Filter parameters to select which assets to generate
   * @param {object} options - Generation options
   * @param {boolean} [options.force] - Force regeneration of existing assets
   * @param {boolean} [options.wait] - Wait for Suno tasks to complete (music only)
   * @returns {Promise<object>} Generation job info
   */
  generateAudio: (audioType, filters = {}, options = {}) =>
    fetchAPI('/audio/generate', {
      method: 'POST',
      body: JSON.stringify({ type: audioType, filters, options }),
    }),

  /**
   * Get the current audio generation queue status
   * @returns {Promise<object>} Queue status with current, pending, and history
   */
  getAudioQueue: () => fetchAPI('/audio/generate/queue'),

  /**
   * Cancel a specific audio generation job
   * @param {string} jobId - Job ID to cancel
   * @returns {Promise<object>} Cancellation result
   */
  cancelAudioJob: (jobId) =>
    fetchAPI('/audio/generate/cancel', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  /**
   * Cancel all pending audio generation jobs
   * @returns {Promise<object>} Cancellation result
   */
  cancelAllAudioJobs: () =>
    fetchAPI('/audio/generate/cancel', {
      method: 'POST',
      body: JSON.stringify({ all: true }),
    }),

  // ============================================
  // Regeneration Queue
  // ============================================

  /**
   * Get the unified regeneration queue across all asset types
   * @returns {Promise<object>} Queue with items grouped by category
   */
  getRegenerationQueue: () => fetchAPI('/regeneration-queue'),

  /**
   * Mark a single asset for regeneration
   * @param {string} category - Asset category (tiles, portraits, items, icons, nodes, music, sfx)
   * @param {string} id - Asset ID
   * @param {boolean} mark - True to mark, false to unmark
   * @returns {Promise<object>} Updated asset status
   */
  markForRegeneration: (category, id, mark = true) =>
    fetchAPI(`/assets/${category}/${id}/mark-regeneration`, {
      method: 'PUT',
      body: JSON.stringify({ mark }),
    }),

  /**
   * Mark multiple assets for regeneration
   * @param {string} category - Asset category
   * @param {string[]} ids - Array of asset IDs
   * @param {boolean} mark - True to mark, false to unmark
   * @returns {Promise<object>} Result with updated count
   */
  markMultipleForRegeneration: (category, ids, mark = true) =>
    fetchAPI('/assets/mark-multiple', {
      method: 'PUT',
      body: JSON.stringify({ category, ids, mark }),
    }),

  /**
   * Clear all items from the regeneration queue
   * @param {string} category - Optional category to clear (all if omitted)
   * @returns {Promise<object>} Result with cleared count
   */
  clearRegenerationQueue: (category = null) =>
    fetchAPI('/regeneration-queue/clear', {
      method: 'POST',
      body: JSON.stringify({ category }),
    }),

  /**
   * Process the regeneration queue (start batch generation)
   * Uses --queue mode for items marked with needsRegeneration
   * @param {object} options - Generation options
   * @param {string} options.category - Optional category to process (all if omitted)
   * @returns {Promise<object>} Generation job info
   */
  processRegenerationQueue: (options = {}) =>
    fetchAPI('/generate/regeneration-queue', {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  // ============================================
  // Audio Regeneration Queue
  // ============================================

  /**
   * Get audio items marked for regeneration
   * @returns {Promise<object>} Audio queue items grouped by type (music, sfx)
   */
  getAudioRegenerationQueue: () => fetchAPI('/audio/regeneration-queue'),

  /**
   * Mark a single audio asset for regeneration
   * @param {string} audioType - 'music' or 'sfx'
   * @param {string} id - Asset ID
   * @param {boolean} mark - True to mark, false to unmark
   * @returns {Promise<object>} Updated asset status
   */
  markAudioForRegeneration: (audioType, id, mark = true) =>
    fetchAPI(`/audio/${audioType}/${id}/mark-regeneration`, {
      method: 'PUT',
      body: JSON.stringify({ mark }),
    }),

  /**
   * Mark multiple audio assets for regeneration
   * @param {string} audioType - 'music' or 'sfx'
   * @param {string[]} ids - Array of asset IDs
   * @param {boolean} mark - True to mark, false to unmark
   * @returns {Promise<object>} Result with updated count
   */
  markMultipleAudioForRegeneration: (audioType, ids, mark = true) =>
    fetchAPI('/audio/mark-multiple', {
      method: 'PUT',
      body: JSON.stringify({ type: audioType, ids, mark }),
    }),

  /**
   * Process audio regeneration queue (start batch generation)
   * Processes music and/or SFX items marked with needsRegeneration
   * @param {object} options - Options
   * @param {string} options.type - Optional 'music' or 'sfx' (all if omitted)
   * @returns {Promise<object>} Generation job info
   */
  processAudioRegenerationQueue: (options = {}) =>
    fetchAPI('/audio/generate/regeneration-queue', {
      method: 'POST',
      body: JSON.stringify(options),
    }),
};

export default api;
