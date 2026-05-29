import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentButtonCSS,
  getParchmentInputCSS
} from '../../ui/parchment/index.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';
import { FriendCard } from '../components/FriendCard.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

const P = PARCHMENT_COLORS;

/**
 * FriendsTab - Friends list with activity status and quick actions
 *
 * Features:
 * - Online/offline friend sections
 * - Real-time activity status
 * - Quick actions: invite to party, message
 * - Player search for adding friends
 * - Favorites sorting
 */
export class FriendsTab {
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

    this.friends = [];
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearching = false;
    this.isLoading = true;

    this.friendCards = new Map(); // friendId -> FriendCard instance
    this.abortController = null;
    this.wsHandlers = {};
    this.searchTimeout = null; // For debounced search
  }

  /**
   * Add tab-specific styles
   */
  static addStyles() {
    if (document.getElementById('friends-tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'friends-tab-styles';
    style.textContent = `
      .friends-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      /* Header with search */
      .friends-tab-header {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderLight};
        background: ${P.light};
      }

      .friends-tab-title {
        margin: 0;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .friends-tab-count {
        font-weight: 400;
        color: ${P.text.muted};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
      }

      .friends-tab-search {
        flex: 1;
        max-width: 300px;
        margin-left: auto;
      }

      .friends-tab-search-input {
        ${getParchmentInputCSS()}
        width: 100%;
        padding-right: 36px;
      }

      .friends-tab-search-wrapper {
        position: relative;
      }

      .friends-tab-search-icon {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: ${P.text.muted};
        font-size: 14px;
        pointer-events: none;
      }

      /* Body with friend list */
      .friends-tab-body {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.sm} 0;
      }

      /* Friend sections */
      .friends-section {
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .friends-section-header {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.lg};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: 600;
        color: ${P.text.muted};
        text-transform: uppercase;
        letter-spacing: 0.5px;
        cursor: pointer;
        user-select: none;
      }

      .friends-section-header:hover {
        color: ${P.text.secondary};
      }

      .friends-section-toggle {
        font-size: 10px;
        transition: transform 0.2s ease;
      }

      .friends-section.collapsed .friends-section-toggle {
        transform: rotate(-90deg);
      }

      .friends-section.collapsed .friends-section-list {
        display: none;
      }

      .friends-section-list {
        display: flex;
        flex-direction: column;
      }

      /* Search results dropdown */
      .friends-search-results {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: 0 0 ${PARCHMENT_RADIUS.md} ${PARCHMENT_RADIUS.md};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        max-height: 300px;
        overflow-y: auto;
        z-index: 100;
      }

      .friends-search-result {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .friends-search-result:hover {
        background: ${P.mid};
      }

      .friends-search-result-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: ${P.mid};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
      }

      .friends-search-result-info {
        flex: 1;
      }

      .friends-search-result-name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.primary};
      }

      .friends-search-result-status {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
      }

      .friends-search-result-action {
        ${getParchmentButtonCSS('primary')}
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .friends-search-result-action.added {
        ${getParchmentButtonCSS('secondary')}
        pointer-events: none;
      }

      .friends-search-result-action.pending {
        ${getParchmentButtonCSS('secondary')}
        pointer-events: none;
      }

      /* Empty state */
      .friends-tab-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
        text-align: center;
      }

      .friends-tab-empty-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .friends-tab-empty-text {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .friends-tab-empty-subtext {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      /* Loading state */
      .friends-tab-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
      }

      .friends-tab-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid ${P.borderLight};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: friends-spin 1s linear infinite;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      @keyframes friends-spin {
        to { transform: rotate(360deg); }
      }

      /* Scrollbar */
      .friends-tab-body::-webkit-scrollbar {
        width: 8px;
      }

      .friends-tab-body::-webkit-scrollbar-track {
        background: ${P.mid};
        border-radius: 4px;
      }

      .friends-tab-body::-webkit-scrollbar-thumb {
        background: ${P.border};
        border-radius: 4px;
      }

      .friends-tab-body::-webkit-scrollbar-thumb:hover {
        background: ${P.borderDark};
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Initialize and render the tab
   */
  async init() {
    FriendsTab.addStyles();
    this.abortController = new AbortController();

    this.render();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    await this.loadFriends();
  }

  /**
   * Render the tab structure
   */
  render() {
    this.container.innerHTML = `
      <div class="friends-tab">
        <div class="friends-tab-header">
          <h3 class="friends-tab-title">
            Friends <span class="friends-tab-count">(${this.friends.length})</span>
          </h3>
          <div class="friends-tab-search">
            <div class="friends-tab-search-wrapper">
              <input
                type="text"
                class="friends-tab-search-input"
                placeholder="Search or add friends..."
                value="${escapeHtml(this.searchQuery)}"
              >
              <span class="friends-tab-search-icon">&#x1F50D;</span>
              <div class="friends-search-results" style="display: none;"></div>
            </div>
          </div>
        </div>
        <div class="friends-tab-body">
          ${this.isLoading ? this.renderLoading() : this.renderFriendsList()}
        </div>
      </div>
    `;
  }

  /**
   * Render loading state
   */
  renderLoading() {
    return `
      <div class="friends-tab-loading">
        <div class="friends-tab-spinner"></div>
        <span>Loading friends...</span>
      </div>
    `;
  }

  /**
   * Render the friends list with sections
   */
  renderFriendsList() {
    if (this.friends.length === 0) {
      return `
        <div class="friends-tab-empty">
          <div class="friends-tab-empty-icon">&#x1F465;</div>
          <div class="friends-tab-empty-text">No friends yet</div>
          <div class="friends-tab-empty-subtext">
            Use the search bar to find and add friends
          </div>
        </div>
      `;
    }

    // Sort: favorites first, then by status, then alphabetically
    const sortedFriends = [...this.friends].sort((a, b) => {
      // Favorites first
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;

      // Online before offline
      const statusOrder = { online: 0, away: 1, busy: 2, offline: 3 };
      const statusA = statusOrder[a.status] ?? 3;
      const statusB = statusOrder[b.status] ?? 3;
      if (statusA !== statusB) return statusA - statusB;

      // Alphabetically
      return a.username.localeCompare(b.username);
    });

    // Split into sections
    const favorites = sortedFriends.filter(f => f.isFavorite);
    const online = sortedFriends.filter(f => !f.isFavorite && f.status === 'online');
    const away = sortedFriends.filter(f => !f.isFavorite && (f.status === 'away' || f.status === 'busy'));
    const offline = sortedFriends.filter(f => !f.isFavorite && f.status !== 'online' && f.status !== 'away' && f.status !== 'busy');

    let html = '';

    if (favorites.length > 0) {
      html += this.renderSection('favorites', '&#x2B50; Favorites', favorites);
    }
    if (online.length > 0) {
      html += this.renderSection('online', 'Online', online);
    }
    if (away.length > 0) {
      html += this.renderSection('away', 'Away', away);
    }
    if (offline.length > 0) {
      html += this.renderSection('offline', 'Offline', offline);
    }

    return html;
  }

  /**
   * Render a section of friends
   */
  renderSection(sectionId, title, friends) {
    return `
      <div class="friends-section" data-section="${sectionId}">
        <div class="friends-section-header" data-toggle="${sectionId}">
          <span class="friends-section-toggle">&#x25BC;</span>
          <span>${title} (${friends.length})</span>
        </div>
        <div class="friends-section-list" data-list="${sectionId}">
          ${friends.map(f => `<div data-friend-placeholder="${f.id}"></div>`).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Set up DOM event listeners
   */
  setupEventListeners() {
    // Reset AbortController to prevent duplicate listeners on re-render
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Search input
    const searchInput = this.container.querySelector('.friends-tab-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        clearTimeout(this.searchTimeout);

        if (this.searchQuery.length >= 2) {
          this.searchTimeout = setTimeout(() => this.performSearch(), 300);
        } else {
          this.hideSearchResults();
        }
      }, { signal });

      searchInput.addEventListener('focus', () => {
        if (this.searchQuery.length >= 2 && this.searchResults.length > 0) {
          this.showSearchResults();
        }
      }, { signal });

      // Close search results on outside click
      document.addEventListener('click', (e) => {
        if (!this.container.querySelector('.friends-tab-search')?.contains(e.target)) {
          this.hideSearchResults();
        }
      }, { signal });
    }

    // Section toggle handlers
    this.container.querySelectorAll('[data-toggle]').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.friends-section');
        section?.classList.toggle('collapsed');
      }, { signal });
    });
  }

  /**
   * Set up WebSocket event handlers
   */
  setupWebSocketHandlers() {
    // Friend presence updates
    this.wsHandlers['presence_changed'] = (data) => {
      this.handlePresenceUpdate(data);
    };

    // Friend request accepted (new friend added)
    this.wsHandlers['notification:new'] = (data) => {
      if (data.type === 'friend_accepted') {
        this.loadFriends(); // Refresh the list
      }
    };

    // Register handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.on(type, handler);
    });
  }

  /**
   * Handle presence update for a friend
   */
  handlePresenceUpdate(data) {
    const friend = this.friends.find(f => f.id === data.userId);
    if (!friend) return;

    // Update friend data
    friend.status = data.status;
    friend.activity = data.activity;

    // Update card if it exists
    const card = this.friendCards.get(friend.id);
    if (card) {
      card.update({ status: data.status, activity: data.activity });
    }
  }

  /**
   * Load friends from API
   */
  async loadFriends() {
    this.isLoading = true;
    this.render();

    try {
      const response = await this.game.api.getFriends();
      if (response.success) {
        this.friends = response.friends;
        this.isLoading = false;
        this.render();
        this.createFriendCards();
        this.setupEventListeners();
        this.updateCount();
      }
    } catch (error) {
      console.error('Failed to load friends:', error);
      this.isLoading = false;
      parchmentToast.error('Error', 'Failed to load friends list');
      this.render();
    }
  }

  /**
   * Create FriendCard instances for each friend
   */
  createFriendCards() {
    // Clean up old cards
    this.friendCards.forEach(card => card.destroy());
    this.friendCards.clear();

    // Create new cards
    this.friends.forEach(friend => {
      const placeholder = this.container.querySelector(`[data-friend-placeholder="${friend.id}"]`);
      if (!placeholder) return;

      const card = new FriendCard({
        friend,
        onInvite: (f) => this.handleInviteToParty(f),
        onMessage: (f) => this.handleSendMessage(f),
        onRemove: (f) => this.handleRemoveFriend(f),
        onBlock: (f) => this.handleBlockUser(f),
        onFavoriteToggle: (f) => this.handleToggleFavorite(f)
      });

      const cardElement = card.render();
      placeholder.replaceWith(cardElement);
      this.friendCards.set(friend.id, card);
    });
  }

  /**
   * Perform player search
   */
  async performSearch() {
    if (this.searchQuery.length < 2) return;

    this.isSearching = true;

    try {
      const response = await this.game.api.searchPlayers(this.searchQuery, 10);
      if (response.players) {
        this.searchResults = response.players;
        this.showSearchResults();
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      this.isSearching = false;
    }
  }

  /**
   * Show search results dropdown
   */
  showSearchResults() {
    const resultsContainer = this.container.querySelector('.friends-search-results');
    if (!resultsContainer) return;

    if (this.searchResults.length === 0) {
      resultsContainer.innerHTML = `
        <div class="friends-search-result">
          <span style="color: ${P.text.muted};">No players found</span>
        </div>
      `;
    } else {
      resultsContainer.innerHTML = this.searchResults.map(player => {
        const isFriend = this.friends.some(f => f.id === player.id);
        const isPending = player.friendshipStatus === 'pending';

        let actionText = 'Add Friend';
        let actionClass = '';
        if (isFriend) {
          actionText = 'Friends';
          actionClass = 'added';
        } else if (isPending) {
          actionText = 'Pending';
          actionClass = 'pending';
        }

        return `
          <div class="friends-search-result" data-player-id="${player.id}">
            <div class="friends-search-result-avatar">&#x1F464;</div>
            <div class="friends-search-result-info">
              <div class="friends-search-result-name">${escapeHtml(player.username)}</div>
              <div class="friends-search-result-status">
                ${player.characterLevel ? `Lv.${player.characterLevel}` : 'Player'}
              </div>
            </div>
            <button
              class="friends-search-result-action ${actionClass}"
              data-action="add-friend"
              data-username="${escapeHtml(player.username)}"
              ${isFriend || isPending ? 'disabled' : ''}
            >
              ${actionText}
            </button>
          </div>
        `;
      }).join('');

      // Add click handlers for add friend buttons
      const signal = this.abortController.signal;
      resultsContainer.querySelectorAll('[data-action="add-friend"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const username = btn.dataset.username;
          await this.handleSendFriendRequest(username, btn);
        }, { signal });
      });
    }

    resultsContainer.style.display = 'block';
  }

  /**
   * Hide search results dropdown
   */
  hideSearchResults() {
    const resultsContainer = this.container.querySelector('.friends-search-results');
    if (resultsContainer) {
      resultsContainer.style.display = 'none';
    }
  }

  /**
   * Handle sending friend request
   */
  async handleSendFriendRequest(username, buttonEl) {
    try {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Sending...';

      const response = await this.game.api.sendFriendRequest(username);
      if (response.success) {
        buttonEl.textContent = 'Sent!';
        buttonEl.classList.add('pending');
        parchmentToast.success('Request Sent', `Friend request sent to ${username}`);
      }
    } catch (error) {
      console.error('Failed to send friend request:', error);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Add Friend';
      parchmentToast.error('Error', error.message || 'Failed to send friend request');
    }
  }

  /**
   * Handle invite to party
   */
  async handleInviteToParty(friend) {
    try {
      // Check if user is in a party
      const partyResponse = await this.game.api.getMultiplayerParty();

      if (!partyResponse.party) {
        // Create a new party first
        const createResponse = await this.game.api.createMultiplayerParty('Quick Party', 'pve', 5);
        if (!createResponse.party) {
          throw new Error('Failed to create party');
        }

        // Send invite
        await this.game.api.inviteToParty(createResponse.party.id, friend.username);
        parchmentToast.success('Invite Sent', `Invited ${friend.username} to your party`);
      } else {
        // Already in party, just send invite
        await this.game.api.inviteToParty(partyResponse.party.id, friend.username);
        parchmentToast.success('Invite Sent', `Invited ${friend.username} to your party`);
      }
    } catch (error) {
      console.error('Failed to invite to party:', error);
      parchmentToast.error('Error', error.message || 'Failed to send party invite');
    }
  }

  /**
   * Handle send message to friend
   */
  handleSendMessage(friend) {
    // Navigate to tavern with DM tab open
    this.game.scenes.switchTo('tavern', { dm: friend.username });
  }

  /**
   * Handle remove friend
   */
  async handleRemoveFriend(friend) {
    try {
      const response = await this.game.api.removeFriend(friend.id);
      if (response.success) {
        // Remove from local list
        this.friends = this.friends.filter(f => f.id !== friend.id);

        // Remove card
        const card = this.friendCards.get(friend.id);
        if (card) {
          card.destroy();
          this.friendCards.delete(friend.id);
        }

        this.render();
        this.createFriendCards();
        this.setupEventListeners();
        this.updateCount();

        parchmentToast.info('Friend Removed', `${friend.username} removed from friends`);
      }
    } catch (error) {
      console.error('Failed to remove friend:', error);
      parchmentToast.error('Error', 'Failed to remove friend');
    }
  }

  /**
   * Handle block user
   */
  async handleBlockUser(friend) {
    try {
      const response = await this.game.api.blockUser(friend.id);
      if (response.success) {
        // Remove from friends list (blocking removes friendship)
        this.friends = this.friends.filter(f => f.id !== friend.id);
        this.render();
        this.createFriendCards();
        this.setupEventListeners();
        this.updateCount();

        parchmentToast.info('User Blocked', `${friend.username} has been blocked`);
      }
    } catch (error) {
      console.error('Failed to block user:', error);
      parchmentToast.error('Error', 'Failed to block user');
    }
  }

  /**
   * Handle toggle favorite
   */
  async handleToggleFavorite(friend) {
    try {
      const newFavoriteState = !friend.isFavorite;
      const response = await this.game.api.updateFriend(friend.id, { isFavorite: newFavoriteState });

      if (response.success) {
        friend.isFavorite = newFavoriteState;

        // Re-render to update sorting
        this.render();
        this.createFriendCards();
        this.setupEventListeners();
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      parchmentToast.error('Error', 'Failed to update favorite status');
    }
  }

  /**
   * Update the friends count display
   */
  updateCount() {
    const countEl = this.container.querySelector('.friends-tab-count');
    if (countEl) {
      countEl.textContent = `(${this.friends.length})`;
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Clear pending search timeout
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    // Remove WebSocket handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.off(type, handler);
    });
    this.wsHandlers = {};

    // Destroy friend cards
    this.friendCards.forEach(card => card.destroy());
    this.friendCards.clear();

    // Abort event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
}
