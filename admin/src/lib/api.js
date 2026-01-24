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

  const response = await fetch(url, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * API Methods
 */
export const api = {
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

  createBackup: (reason = 'manual') =>
    fetchAPI('/backups', {
      method: 'POST',
      body: JSON.stringify({ reason }),
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
};

export default api;
