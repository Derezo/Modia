import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS
} from '../../ui/parchment/index.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';

const P = PARCHMENT_COLORS;

/**
 * RequestsTab - Unified inbox for friend requests, party invites, and clan invites
 *
 * Features:
 * - Friend request accept/decline
 * - Party invite accept/decline with countdown
 * - Clan invite accept/decline (future)
 * - Real-time updates via WebSocket
 */
export class RequestsTab {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Container element for this tab
   * @param {Object} options.game - Game instance for API/WebSocket access
   * @param {Function} options.onBadgeUpdate - Callback when badge count changes
   */
  constructor(options) {
    this.container = options.container;
    this.game = options.game;
    this.onBadgeUpdate = options.onBadgeUpdate;

    this.friendRequests = [];
    this.partyInvites = [];
    this.clanInvites = [];
    this.isLoading = true;

    this.countdownIntervals = new Map(); // inviteId -> intervalId
    this.abortController = null;
    this.wsHandlers = {};
  }

  /**
   * Add tab-specific styles
   */
  static addStyles() {
    if (document.getElementById('requests-tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'requests-tab-styles';
    style.textContent = `
      .requests-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .requests-tab-header {
        display: flex;
        align-items: center;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderLight};
        background: ${P.light};
      }

      .requests-tab-title {
        margin: 0;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .requests-tab-count {
        font-weight: 400;
        color: ${P.text.muted};
        margin-left: ${PARCHMENT_SPACING.sm};
      }

      .requests-tab-body {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
      }

      /* Request sections */
      .requests-section {
        margin-bottom: ${PARCHMENT_SPACING.lg};
      }

      .requests-section-header {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.xs} 0;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: 600;
        color: ${P.text.secondary};
        border-bottom: 1px solid ${P.borderLight};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .requests-section-icon {
        font-size: 16px;
      }

      /* Request card */
      .request-card {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md};
        background: ${P.mid};
        border-radius: ${PARCHMENT_RADIUS.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .request-card-avatar {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: ${P.dark};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        flex-shrink: 0;
      }

      .request-card-info {
        flex: 1;
        min-width: 0;
      }

      .request-card-title {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: 600;
        color: ${P.text.primary};
        margin-bottom: 2px;
      }

      .request-card-subtitle {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      .request-card-timer {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.state.warning};
        margin-top: 2px;
      }

      .request-card-timer.urgent {
        color: ${P.state.error};
        animation: pulse 1s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .request-card-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
        flex-shrink: 0;
      }

      .request-card-btn {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        border-radius: ${PARCHMENT_RADIUS.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .request-card-btn.accept {
        background: ${P.state.success};
        border: 1px solid ${P.state.success};
        color: white;
      }

      .request-card-btn.accept:hover {
        filter: brightness(1.1);
      }

      .request-card-btn.decline {
        background: transparent;
        border: 1px solid ${P.borderLight};
        color: ${P.text.secondary};
      }

      .request-card-btn.decline:hover {
        background: ${P.state.error};
        border-color: ${P.state.error};
        color: white;
      }

      .request-card-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Empty state */
      .requests-tab-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
        text-align: center;
      }

      .requests-tab-empty-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .requests-tab-empty-text {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .requests-tab-empty-subtext {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      /* Loading state */
      .requests-tab-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
      }

      .requests-tab-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid ${P.borderLight};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: requests-spin 1s linear infinite;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      @keyframes requests-spin {
        to { transform: rotate(360deg); }
      }

      /* Scrollbar */
      .requests-tab-body::-webkit-scrollbar {
        width: 8px;
      }

      .requests-tab-body::-webkit-scrollbar-track {
        background: ${P.mid};
        border-radius: 4px;
      }

      .requests-tab-body::-webkit-scrollbar-thumb {
        background: ${P.border};
        border-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Initialize and render the tab
   */
  async init() {
    RequestsTab.addStyles();
    this.abortController = new AbortController();

    this.render();
    this.setupWebSocketHandlers();

    await this.loadRequests();
  }

  /**
   * Render the tab structure
   */
  render() {
    const totalCount = this.friendRequests.length + this.partyInvites.length + this.clanInvites.length;

    this.container.innerHTML = `
      <div class="requests-tab">
        <div class="requests-tab-header">
          <h3 class="requests-tab-title">Inbox</h3>
          <span class="requests-tab-count">(${totalCount})</span>
        </div>
        <div class="requests-tab-body">
          ${this.isLoading ? this.renderLoading() : this.renderContent()}
        </div>
      </div>
    `;

    if (!this.isLoading) {
      this.setupEventListeners();
      this.startCountdowns();
    }
  }

  /**
   * Render loading state
   */
  renderLoading() {
    return `
      <div class="requests-tab-loading">
        <div class="requests-tab-spinner"></div>
        <span>Loading requests...</span>
      </div>
    `;
  }

  /**
   * Render the content
   */
  renderContent() {
    const totalCount = this.friendRequests.length + this.partyInvites.length + this.clanInvites.length;

    if (totalCount === 0) {
      return `
        <div class="requests-tab-empty">
          <div class="requests-tab-empty-icon">&#x1F4EC;</div>
          <div class="requests-tab-empty-text">No pending requests</div>
          <div class="requests-tab-empty-subtext">
            Friend requests and party invites will appear here
          </div>
        </div>
      `;
    }

    let html = '';

    // Friend Requests
    if (this.friendRequests.length > 0) {
      html += `
        <div class="requests-section" data-section="friends">
          <div class="requests-section-header">
            <span class="requests-section-icon">&#x1F465;</span>
            <span>Friend Requests (${this.friendRequests.length})</span>
          </div>
          ${this.friendRequests.map(req => this.renderFriendRequest(req)).join('')}
        </div>
      `;
    }

    // Party Invites
    if (this.partyInvites.length > 0) {
      html += `
        <div class="requests-section" data-section="party">
          <div class="requests-section-header">
            <span class="requests-section-icon">&#x2694;&#xFE0F;</span>
            <span>Party Invites (${this.partyInvites.length})</span>
          </div>
          ${this.partyInvites.map(inv => this.renderPartyInvite(inv)).join('')}
        </div>
      `;
    }

    // Clan Invites (future)
    if (this.clanInvites.length > 0) {
      html += `
        <div class="requests-section" data-section="clan">
          <div class="requests-section-header">
            <span class="requests-section-icon">&#x1F3F0;</span>
            <span>Clan Invites (${this.clanInvites.length})</span>
          </div>
          ${this.clanInvites.map(inv => this.renderClanInvite(inv)).join('')}
        </div>
      `;
    }

    return html;
  }

  /**
   * Render a friend request card
   */
  renderFriendRequest(request) {
    const timeAgo = this.formatRelativeTime(request.created_at || request.createdAt);

    return `
      <div class="request-card" data-type="friend" data-id="${request.id}">
        <div class="request-card-avatar">&#x1F464;</div>
        <div class="request-card-info">
          <div class="request-card-title">${this.escapeHtml(request.fromUsername || request.username)}</div>
          <div class="request-card-subtitle">wants to be your friend</div>
          <div class="request-card-subtitle">${timeAgo}</div>
        </div>
        <div class="request-card-actions">
          <button class="request-card-btn accept" data-action="accept-friend" data-id="${request.id}">
            Accept
          </button>
          <button class="request-card-btn decline" data-action="decline-friend" data-id="${request.id}">
            Decline
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render a party invite card
   */
  renderPartyInvite(invite) {
    const expiresAt = new Date(invite.expiresAt || invite.expires_at);
    const timeLeft = this.getTimeLeft(expiresAt);
    const isUrgent = timeLeft < 60; // Less than 1 minute

    return `
      <div class="request-card" data-type="party" data-id="${invite.inviteId || invite.id}">
        <div class="request-card-avatar">&#x2694;&#xFE0F;</div>
        <div class="request-card-info">
          <div class="request-card-title">${this.escapeHtml(invite.partyName || 'Party')}</div>
          <div class="request-card-subtitle">
            Invited by ${this.escapeHtml(invite.fromUsername || invite.leaderUsername)}
          </div>
          <div class="request-card-timer ${isUrgent ? 'urgent' : ''}" data-countdown="${invite.inviteId || invite.id}">
            Expires in ${this.formatTimeLeft(timeLeft)}
          </div>
        </div>
        <div class="request-card-actions">
          <button class="request-card-btn accept" data-action="accept-party" data-id="${invite.inviteId || invite.id}">
            Join
          </button>
          <button class="request-card-btn decline" data-action="decline-party" data-id="${invite.inviteId || invite.id}">
            Decline
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render a clan invite card
   */
  renderClanInvite(invite) {
    return `
      <div class="request-card" data-type="clan" data-id="${invite.id}">
        <div class="request-card-avatar">&#x1F3F0;</div>
        <div class="request-card-info">
          <div class="request-card-title">[${this.escapeHtml(invite.clanTag)}] ${this.escapeHtml(invite.clanName)}</div>
          <div class="request-card-subtitle">
            Invited by ${this.escapeHtml(invite.inviterUsername)}
          </div>
        </div>
        <div class="request-card-actions">
          <button class="request-card-btn accept" data-action="accept-clan" data-id="${invite.id}">
            Join
          </button>
          <button class="request-card-btn decline" data-action="decline-clan" data-id="${invite.id}">
            Decline
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Reset AbortController to prevent duplicate listeners on re-render
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Friend request actions
    this.container.querySelectorAll('[data-action="accept-friend"]').forEach(btn => {
      btn.addEventListener('click', () => this.acceptFriendRequest(btn.dataset.id, btn), { signal });
    });

    this.container.querySelectorAll('[data-action="decline-friend"]').forEach(btn => {
      btn.addEventListener('click', () => this.declineFriendRequest(btn.dataset.id, btn), { signal });
    });

    // Party invite actions
    this.container.querySelectorAll('[data-action="accept-party"]').forEach(btn => {
      btn.addEventListener('click', () => this.acceptPartyInvite(btn.dataset.id, btn), { signal });
    });

    this.container.querySelectorAll('[data-action="decline-party"]').forEach(btn => {
      btn.addEventListener('click', () => this.declinePartyInvite(btn.dataset.id, btn), { signal });
    });

    // Clan invite actions (future)
    this.container.querySelectorAll('[data-action="accept-clan"]').forEach(btn => {
      btn.addEventListener('click', () => this.acceptClanInvite(btn.dataset.id, btn), { signal });
    });

    this.container.querySelectorAll('[data-action="decline-clan"]').forEach(btn => {
      btn.addEventListener('click', () => this.declineClanInvite(btn.dataset.id, btn), { signal });
    });
  }

  /**
   * Set up WebSocket handlers
   */
  setupWebSocketHandlers() {
    // New friend request
    this.wsHandlers['notification:new'] = (data) => {
      if (data.type === 'friend_request') {
        this.loadRequests();
      }
    };

    // Party invite received
    this.wsHandlers['party:invite_received'] = (data) => {
      this.partyInvites.push(data);
      this.render();
      this.updateBadge();
    };

    // Party invite expired
    this.wsHandlers['party:invite_expired'] = (data) => {
      this.partyInvites = this.partyInvites.filter(i => (i.inviteId || i.id) !== data.inviteId);
      this.render();
      this.updateBadge();
    };

    // Register handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.on(type, handler);
    });
  }

  /**
   * Start countdown timers for party invites
   */
  startCountdowns() {
    // Clear existing intervals
    this.countdownIntervals.forEach(intervalId => clearInterval(intervalId));
    this.countdownIntervals.clear();

    // Start new intervals
    this.partyInvites.forEach(invite => {
      const inviteId = invite.inviteId || invite.id;
      const timerEl = this.container.querySelector(`[data-countdown="${inviteId}"]`);
      if (!timerEl) return;

      const intervalId = setInterval(() => {
        const expiresAt = new Date(invite.expiresAt || invite.expires_at);
        const timeLeft = this.getTimeLeft(expiresAt);

        if (timeLeft <= 0) {
          // Expired - remove from list
          clearInterval(intervalId);
          this.partyInvites = this.partyInvites.filter(i => (i.inviteId || i.id) !== inviteId);
          this.render();
          this.updateBadge();
        } else {
          // Update display
          timerEl.textContent = `Expires in ${this.formatTimeLeft(timeLeft)}`;
          timerEl.classList.toggle('urgent', timeLeft < 60);
        }
      }, 1000);

      this.countdownIntervals.set(inviteId, intervalId);
    });
  }

  /**
   * Load all requests from API
   */
  async loadRequests() {
    this.isLoading = true;
    this.render();

    try {
      const [friendResponse, partyResponse] = await Promise.all([
        this.game.api.getFriendRequests(),
        this.game.api.getPartyInvites()
      ]);

      if (friendResponse.success) {
        this.friendRequests = friendResponse.requests || [];
      }

      if (partyResponse.success) {
        this.partyInvites = partyResponse.invites || [];
      }

      // Clan invites will be loaded when implemented

      this.isLoading = false;
      this.render();
      this.updateBadge();
    } catch (error) {
      console.error('Failed to load requests:', error);
      this.isLoading = false;
      parchmentToast.error('Error', 'Failed to load requests');
      this.render();
    }
  }

  /**
   * Accept friend request
   */
  async acceptFriendRequest(requestId, buttonEl) {
    try {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Accepting...';

      const response = await this.game.api.acceptFriendRequest(requestId);
      if (response.success) {
        // Remove from list
        this.friendRequests = this.friendRequests.filter(r => r.id !== parseInt(requestId));
        this.render();
        this.updateBadge();
        parchmentToast.success('Friend Added', 'You are now friends!');
      }
    } catch (error) {
      console.error('Failed to accept friend request:', error);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Accept';
      parchmentToast.error('Error', error.message || 'Failed to accept request');
    }
  }

  /**
   * Decline friend request
   */
  async declineFriendRequest(requestId, buttonEl) {
    try {
      buttonEl.disabled = true;

      const response = await this.game.api.declineFriendRequest(requestId);
      if (response.success) {
        // Remove from list
        this.friendRequests = this.friendRequests.filter(r => r.id !== parseInt(requestId));
        this.render();
        this.updateBadge();
      }
    } catch (error) {
      console.error('Failed to decline friend request:', error);
      buttonEl.disabled = false;
      parchmentToast.error('Error', 'Failed to decline request');
    }
  }

  /**
   * Accept party invite
   */
  async acceptPartyInvite(inviteId, buttonEl) {
    try {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Joining...';

      const response = await this.game.api.acceptPartyInvite(inviteId);
      if (response.success) {
        // Remove from list
        this.partyInvites = this.partyInvites.filter(i => (i.inviteId || i.id) !== inviteId);
        this.render();
        this.updateBadge();
        parchmentToast.success('Joined Party', 'You have joined the party!');

        // Refresh party status bar
        if (this.game.partyStatusBar) {
          this.game.partyStatusBar.refresh();
        }
      }
    } catch (error) {
      console.error('Failed to accept party invite:', error);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Join';
      parchmentToast.error('Error', error.message || 'Failed to join party');
    }
  }

  /**
   * Decline party invite
   */
  async declinePartyInvite(inviteId, buttonEl) {
    try {
      buttonEl.disabled = true;

      const response = await this.game.api.declinePartyInvite(inviteId);
      if (response.success) {
        // Remove from list
        this.partyInvites = this.partyInvites.filter(i => (i.inviteId || i.id) !== inviteId);
        this.render();
        this.updateBadge();
      }
    } catch (error) {
      console.error('Failed to decline party invite:', error);
      buttonEl.disabled = false;
      parchmentToast.error('Error', 'Failed to decline invite');
    }
  }

  /**
   * Accept clan invite (placeholder)
   */
  async acceptClanInvite(_inviteId, _buttonEl) {
    // Will be implemented with clan system
    parchmentToast.info('Coming Soon', 'Clan system is not yet implemented');
  }

  /**
   * Decline clan invite (placeholder)
   */
  async declineClanInvite(_inviteId, _buttonEl) {
    // Will be implemented with clan system
    parchmentToast.info('Coming Soon', 'Clan system is not yet implemented');
  }

  /**
   * Update badge count
   */
  updateBadge() {
    const totalCount = this.friendRequests.length + this.partyInvites.length + this.clanInvites.length;
    if (this.onBadgeUpdate) {
      this.onBadgeUpdate(totalCount);
    }
  }

  /**
   * Get time left in seconds
   */
  getTimeLeft(expiresAt) {
    const now = new Date();
    return Math.max(0, Math.floor((expiresAt - now) / 1000));
  }

  /**
   * Format time left for display
   */
  formatTimeLeft(seconds) {
    if (seconds <= 0) return 'Expired';

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (minutes > 0) {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    return `${secs}s`;
  }

  /**
   * Format relative time
   */
  formatRelativeTime(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Clear countdown intervals
    this.countdownIntervals.forEach(intervalId => clearInterval(intervalId));
    this.countdownIntervals.clear();

    // Remove WebSocket handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.off(type, handler);
    });
    this.wsHandlers = {};

    // Abort event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
