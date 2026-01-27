/**
 * API Client - Base fetch wrapper
 *
 * Provides the core fetch functionality with error handling.
 * All other API modules use this as their base.
 */

export const API_BASE = '/api/admin';

/**
 * Generic fetch wrapper with error handling
 * @param {string} endpoint - API endpoint (appended to API_BASE)
 * @param {object} options - Fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function fetchAPI(endpoint, options = {}) {
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

export default fetchAPI;
