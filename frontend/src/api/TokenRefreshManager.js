/**
 * TokenRefreshManager - Handles automatic token refresh before expiry
 *
 * Features:
 * - Decodes JWT to extract expiration time
 * - Sets timer to refresh 1 minute before expiry
 * - Handles 401 responses with automatic retry
 * - Prevents concurrent refresh attempts
 * - Cleans up on logout
 */
export class TokenRefreshManager {
  constructor(game) {
    this.game = game;
    this.refreshTimer = null;
    this.isRefreshing = false;
    this.refreshPromise = null;

    // Buffer time before expiry to trigger refresh (1 minute)
    this.refreshBufferMs = 60 * 1000;
  }

  /**
   * Start managing token refresh after login
   * @param {string} accessToken - The JWT access token
   */
  start(accessToken) {
    this.stop(); // Clear any existing timer
    this.scheduleRefresh(accessToken);
  }

  /**
   * Stop managing tokens (on logout)
   */
  stop() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.isRefreshing = false;
    this.refreshPromise = null;
  }

  /**
   * Decode JWT payload without verification (client-side)
   * @param {string} token - JWT token string
   * @returns {Object|null} Decoded payload or null if invalid
   */
  decodeToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = parts[1];
      // Handle URL-safe base64
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decoded);
    } catch (err) {
      console.warn('Failed to decode token:', err);
      return null;
    }
  }

  /**
   * Get time until token expires in milliseconds
   * @param {string} token - JWT token
   * @returns {number} Milliseconds until expiry, or 0 if invalid/expired
   */
  getTimeUntilExpiry(token) {
    const payload = this.decodeToken(token);
    if (!payload || !payload.exp) return 0;

    const expiryMs = payload.exp * 1000;
    const nowMs = Date.now();
    return Math.max(0, expiryMs - nowMs);
  }

  /**
   * Schedule the next token refresh
   * @param {string} accessToken - Current access token
   */
  scheduleRefresh(accessToken) {
    const timeUntilExpiry = this.getTimeUntilExpiry(accessToken);

    if (timeUntilExpiry <= 0) {
      // Token already expired, refresh immediately
      console.log('[TokenRefresh] Token expired, refreshing immediately');
      this.performRefresh();
      return;
    }

    // Schedule refresh 1 minute before expiry, but at least 10 seconds from now
    const refreshDelay = Math.max(10000, timeUntilExpiry - this.refreshBufferMs);

    console.log(`[TokenRefresh] Scheduled in ${Math.round(refreshDelay / 1000)}s (expires in ${Math.round(timeUntilExpiry / 1000)}s)`);

    this.refreshTimer = setTimeout(() => {
      this.performRefresh();
    }, refreshDelay);
  }

  /**
   * Perform the token refresh
   * @returns {Promise<boolean>} True if refresh succeeded
   */
  async performRefresh() {
    // Prevent concurrent refreshes
    if (this.isRefreshing) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this._doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Internal refresh implementation
   * @private
   */
  async _doRefresh() {
    const refreshToken = this.game.state.get('refreshToken');

    if (!refreshToken) {
      console.warn('[TokenRefresh] No refresh token available');
      this.handleRefreshFailure();
      return false;
    }

    try {
      console.log('[TokenRefresh] Refreshing auth tokens...');

      const result = await this.game.api.refresh(refreshToken);

      // Update stored tokens
      this.game.state.set('token', result.accessToken);
      this.game.state.set('refreshToken', result.refreshToken);
      this.game.state.set('user', result.user);
      this.game.state.persist();

      // Update API client token
      this.game.api.setToken(result.accessToken);

      // Update WebSocket token if connected
      if (this.game.socket?.connected) {
        this.game.socket.token = result.accessToken;
        this.game.socket.send('auth', { token: result.accessToken });
      }

      // Schedule next refresh
      this.scheduleRefresh(result.accessToken);

      console.log('[TokenRefresh] Token refresh successful');
      return true;

    } catch (err) {
      console.error('[TokenRefresh] Token refresh failed:', err);
      this.handleRefreshFailure();
      return false;
    }
  }

  /**
   * Handle refresh failure - logout user
   * @private
   */
  handleRefreshFailure() {
    this.stop();

    // Clear auth state
    this.game.state.set('token', null);
    this.game.state.set('refreshToken', null);
    this.game.state.set('user', null);
    this.game.state.persist();

    // Clear API token
    this.game.api.setToken(null);

    // Disconnect WebSocket
    this.game.socket?.disconnect();

    // Destroy notification system
    if (this.game.destroyNotificationSystem) {
      this.game.destroyNotificationSystem();
    }

    // Show message and redirect to login
    if (this.game.toast) {
      this.game.toast.warning('Session Expired', 'Please log in again');
    }
    this.game.scenes.switchTo('login');
  }

  /**
   * Handle a 401 response - attempt refresh before failing
   * @returns {Promise<boolean>} True if refresh succeeded and request can be retried
   */
  async handle401() {
    return this.performRefresh();
  }
}
