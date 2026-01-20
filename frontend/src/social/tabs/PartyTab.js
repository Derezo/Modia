import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentButtonCSS
} from '../../ui/parchment/index.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';

const P = PARCHMENT_COLORS;

/**
 * PartyTab - Party management and quick formation
 *
 * Features:
 * - View current party with member status
 * - Quick party formation from online friends
 * - Ready status toggle
 * - Leave/disband party
 * - Invite more members
 */
export class PartyTab {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Container element
   * @param {Object} options.game - Game instance
   * @param {Function} options.onBadgeUpdate - Badge update callback
   */
  constructor(options) {
    this.container = options.container;
    this.game = options.game;
    this.onBadgeUpdate = options.onBadgeUpdate;

    this.party = null;
    this.friends = [];
    this.selectedFriends = new Set();
    this.isLoading = true;

    this.abortController = null;
    this.wsHandlers = {};
  }

  /**
   * Add tab-specific styles
   */
  static addStyles() {
    if (document.getElementById('party-tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'party-tab-styles';
    style.textContent = `
      .party-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .party-tab-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderLight};
        background: ${P.light};
      }

      .party-tab-title {
        margin: 0;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .party-tab-body {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
      }

      /* Current Party Section */
      .party-current {
        background: ${P.mid};
        border-radius: ${PARCHMENT_RADIUS.md};
        padding: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.lg};
      }

      .party-current-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .party-current-name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .party-current-type {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
        text-transform: uppercase;
        background: ${P.light};
        padding: 2px 8px;
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .party-members {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.sm};
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .party-member {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm};
        background: ${P.light};
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .party-member-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: ${P.mid};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
      }

      .party-member-info {
        flex: 1;
      }

      .party-member-name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.primary};
      }

      .party-member-leader {
        font-size: 12px;
        color: ${P.accent.burgundy};
        margin-left: ${PARCHMENT_SPACING.xs};
      }

      .party-member-class {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
      }

      .party-member-ready {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
      }

      .party-member-ready.ready {
        background: ${P.state.success};
        color: white;
      }

      .party-member-ready.not-ready {
        background: ${P.borderLight};
        color: ${P.text.muted};
      }

      .party-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        flex-wrap: wrap;
      }

      .party-btn {
        ${getParchmentButtonCSS('secondary')}
        flex: 1;
        min-width: 100px;
      }

      .party-btn.primary {
        ${getParchmentButtonCSS('primary')}
      }

      .party-btn.danger {
        background: ${P.state.error};
        border-color: ${P.state.error};
        color: white;
      }

      .party-btn.danger:hover {
        filter: brightness(1.1);
      }

      /* Quick Party Section */
      .quick-party {
        background: ${P.mid};
        border-radius: ${PARCHMENT_RADIUS.md};
        padding: ${PARCHMENT_SPACING.md};
      }

      .quick-party-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .quick-party-title {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .quick-party-count {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      .quick-party-list {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.xs};
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .quick-party-friend {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm};
        background: ${P.light};
        border-radius: ${PARCHMENT_RADIUS.sm};
        cursor: pointer;
        transition: all 0.15s ease;
        border: 2px solid transparent;
      }

      .quick-party-friend:hover {
        background: white;
      }

      .quick-party-friend.selected {
        border-color: ${P.state.success};
        background: rgba(34, 197, 94, 0.1);
      }

      .quick-party-friend.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .quick-party-friend-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: ${P.mid};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
      }

      .quick-party-friend-info {
        flex: 1;
      }

      .quick-party-friend-name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.primary};
      }

      .quick-party-friend-status {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
      }

      .quick-party-checkbox {
        width: 20px;
        height: 20px;
        border: 2px solid ${P.border};
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }

      .quick-party-friend.selected .quick-party-checkbox {
        background: ${P.state.success};
        border-color: ${P.state.success};
        color: white;
      }

      .quick-party-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
      }

      /* No Party State */
      .party-none {
        text-align: center;
        padding: ${PARCHMENT_SPACING.lg};
      }

      .party-none-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .party-none-text {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.lg};
      }

      /* Empty friends */
      .quick-party-empty {
        text-align: center;
        padding: ${PARCHMENT_SPACING.md};
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      /* Loading */
      .party-tab-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
      }

      .party-tab-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid ${P.borderLight};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: party-spin 1s linear infinite;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      @keyframes party-spin {
        to { transform: rotate(360deg); }
      }

      /* Scrollbar */
      .party-tab-body::-webkit-scrollbar,
      .quick-party-list::-webkit-scrollbar {
        width: 8px;
      }

      .party-tab-body::-webkit-scrollbar-track,
      .quick-party-list::-webkit-scrollbar-track {
        background: ${P.mid};
        border-radius: 4px;
      }

      .party-tab-body::-webkit-scrollbar-thumb,
      .quick-party-list::-webkit-scrollbar-thumb {
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
    PartyTab.addStyles();
    this.abortController = new AbortController();

    this.render();
    this.setupWebSocketHandlers();

    await this.loadData();
  }

  /**
   * Render the tab
   */
  render() {
    this.container.innerHTML = `
      <div class="party-tab">
        <div class="party-tab-header">
          <h3 class="party-tab-title">Party</h3>
        </div>
        <div class="party-tab-body">
          ${this.isLoading ? this.renderLoading() : this.renderContent()}
        </div>
      </div>
    `;

    if (!this.isLoading) {
      this.setupEventListeners();
    }
  }

  /**
   * Render loading state
   */
  renderLoading() {
    return `
      <div class="party-tab-loading">
        <div class="party-tab-spinner"></div>
        <span>Loading...</span>
      </div>
    `;
  }

  /**
   * Render content based on party state
   */
  renderContent() {
    let html = '';

    // Current party section
    if (this.party) {
      html += this.renderCurrentParty();
    } else {
      html += this.renderNoParty();
    }

    // Quick party section (only if not in party or party has room)
    if (!this.party || this.party.members?.length < this.party.maxMembers) {
      html += this.renderQuickParty();
    }

    return html;
  }

  /**
   * Render current party
   */
  renderCurrentParty() {
    const members = this.party.members || [];
    const isLeader = this.party.leaderId === this.game.userId;
    const currentMember = members.find(m => m.userId === this.game.userId);
    const isReady = currentMember?.isReady;

    return `
      <div class="party-current">
        <div class="party-current-header">
          <span class="party-current-name">${this.escapeHtml(this.party.name || 'Party')}</span>
          <span class="party-current-type">${this.party.partyType || 'PvE'}</span>
        </div>

        <div class="party-members">
          ${members.map(member => this.renderMember(member)).join('')}
          ${this.renderEmptySlots(this.party.maxMembers - members.length)}
        </div>

        <div class="party-actions">
          <button class="party-btn ${isReady ? '' : 'primary'}" data-action="toggle-ready">
            ${isReady ? '&#x2705; Ready' : 'Set Ready'}
          </button>
          ${isLeader && members.length > 1 ? `
            <button class="party-btn primary" data-action="start-battle" ${this.canStartBattle() ? '' : 'disabled'}>
              Start Battle
            </button>
          ` : ''}
          <button class="party-btn danger" data-action="leave">
            ${isLeader ? 'Disband' : 'Leave'}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render a party member
   */
  renderMember(member) {
    const isLeader = member.userId === this.party.leaderId;
    const isYou = member.userId === this.game.userId;

    return `
      <div class="party-member" data-user-id="${member.userId}">
        <div class="party-member-avatar">&#x1F464;</div>
        <div class="party-member-info">
          <div class="party-member-name">
            ${this.escapeHtml(member.username || member.characterName)}
            ${isLeader ? '<span class="party-member-leader">&#x1F451;</span>' : ''}
            ${isYou ? ' (You)' : ''}
          </div>
          <div class="party-member-class">
            ${member.characterLevel ? `Lv.${member.characterLevel}` : ''} ${member.characterClass || ''}
          </div>
        </div>
        <div class="party-member-ready ${member.isReady ? 'ready' : 'not-ready'}">
          ${member.isReady ? '&#x2713;' : ''}
        </div>
      </div>
    `;
  }

  /**
   * Render empty party slots
   */
  renderEmptySlots(count) {
    if (count <= 0) return '';

    return Array(count).fill(0).map(() => `
      <div class="party-member" style="opacity: 0.5;">
        <div class="party-member-avatar">&#x2795;</div>
        <div class="party-member-info">
          <div class="party-member-name">Empty Slot</div>
          <div class="party-member-class">Invite a friend</div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Render no party state
   */
  renderNoParty() {
    return `
      <div class="party-none">
        <div class="party-none-icon">&#x2694;&#xFE0F;</div>
        <div class="party-none-text">You're not in a party</div>
        <button class="party-btn primary" data-action="create-party">
          Create Party
        </button>
      </div>
    `;
  }

  /**
   * Render quick party formation
   */
  renderQuickParty() {
    const onlineFriends = this.friends.filter(f =>
      f.status === 'online' && f.activity?.type !== 'battle'
    );

    const slotsAvailable = this.party
      ? this.party.maxMembers - (this.party.members?.length || 1)
      : 4;

    return `
      <div class="quick-party">
        <div class="quick-party-header">
          <span class="quick-party-title">
            ${this.party ? 'Invite Friends' : 'Quick Party'}
          </span>
          <span class="quick-party-count">
            ${this.selectedFriends.size} selected / ${slotsAvailable} slots
          </span>
        </div>

        <div class="quick-party-list">
          ${onlineFriends.length === 0 ? `
            <div class="quick-party-empty">
              No friends online to invite
            </div>
          ` : onlineFriends.map(friend => this.renderQuickFriend(friend, slotsAvailable)).join('')}
        </div>

        ${onlineFriends.length > 0 ? `
          <div class="quick-party-actions">
            <button class="party-btn" data-action="select-all" ${onlineFriends.length > slotsAvailable ? 'disabled' : ''}>
              Select All
            </button>
            <button class="party-btn" data-action="clear-selection">
              Clear
            </button>
            <button class="party-btn primary" data-action="invite-selected" ${this.selectedFriends.size === 0 ? 'disabled' : ''}>
              ${this.party ? 'Send Invites' : 'Form Party'} (${this.selectedFriends.size})
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render a friend for quick party selection
   */
  renderQuickFriend(friend, slotsAvailable) {
    const isSelected = this.selectedFriends.has(friend.id);
    const isDisabled = !isSelected && this.selectedFriends.size >= slotsAvailable;

    return `
      <div class="quick-party-friend ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}"
           data-friend-id="${friend.id}"
           data-friend-username="${this.escapeHtml(friend.username)}">
        <div class="quick-party-friend-avatar">&#x1F464;</div>
        <div class="quick-party-friend-info">
          <div class="quick-party-friend-name">${this.escapeHtml(friend.username)}</div>
          <div class="quick-party-friend-status">
            ${friend.characterLevel ? `Lv.${friend.characterLevel}` : ''} ${friend.characterClass || 'Online'}
          </div>
        </div>
        <div class="quick-party-checkbox">
          ${isSelected ? '&#x2713;' : ''}
        </div>
      </div>
    `;
  }

  /**
   * Check if battle can be started
   */
  canStartBattle() {
    if (!this.party) return false;
    const members = this.party.members || [];
    return members.length > 0 && members.every(m => m.isReady);
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

    // Create party
    this.container.querySelector('[data-action="create-party"]')?.addEventListener('click', () => {
      this.createParty();
    }, { signal });

    // Toggle ready
    this.container.querySelector('[data-action="toggle-ready"]')?.addEventListener('click', () => {
      this.toggleReady();
    }, { signal });

    // Leave party
    this.container.querySelector('[data-action="leave"]')?.addEventListener('click', () => {
      this.leaveParty();
    }, { signal });

    // Start battle
    this.container.querySelector('[data-action="start-battle"]')?.addEventListener('click', () => {
      this.startBattle();
    }, { signal });

    // Friend selection for quick party
    this.container.querySelectorAll('.quick-party-friend:not(.disabled)').forEach(el => {
      el.addEventListener('click', () => {
        const friendId = parseInt(el.dataset.friendId);
        this.toggleFriendSelection(friendId);
      }, { signal });
    });

    // Select all
    this.container.querySelector('[data-action="select-all"]')?.addEventListener('click', () => {
      this.selectAllFriends();
    }, { signal });

    // Clear selection
    this.container.querySelector('[data-action="clear-selection"]')?.addEventListener('click', () => {
      this.clearSelection();
    }, { signal });

    // Invite selected
    this.container.querySelector('[data-action="invite-selected"]')?.addEventListener('click', () => {
      this.inviteSelected();
    }, { signal });
  }

  /**
   * Set up WebSocket handlers
   */
  setupWebSocketHandlers() {
    this.wsHandlers['party:member_joined'] = () => this.loadData();
    this.wsHandlers['party:member_left'] = () => this.loadData();
    this.wsHandlers['party:member_ready'] = () => this.loadData();
    this.wsHandlers['party:disbanded'] = () => {
      this.party = null;
      this.render();
    };
    this.wsHandlers['party:all_ready'] = () => this.render();

    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.on(type, handler);
    });
  }

  /**
   * Load party and friends data
   */
  async loadData() {
    this.isLoading = true;
    this.render();

    try {
      const [partyResponse, friendsResponse] = await Promise.all([
        this.game.api.getMultiplayerParty(),
        this.game.api.getFriends()
      ]);

      this.party = partyResponse.party || null;
      this.friends = friendsResponse.friends || [];

      this.isLoading = false;
      this.render();
    } catch (error) {
      console.error('Failed to load party data:', error);
      this.isLoading = false;
      this.render();
    }
  }

  /**
   * Create a new party
   */
  async createParty() {
    try {
      const response = await this.game.api.createMultiplayerParty('Party', 'pve', 5);
      if (response.party) {
        this.party = response.party;
        this.render();
        parchmentToast.success('Party Created', 'You created a new party!');

        if (this.game.partyStatusBar) {
          this.game.partyStatusBar.refresh();
        }
      }
    } catch (error) {
      console.error('Failed to create party:', error);
      parchmentToast.error('Error', error.message || 'Failed to create party');
    }
  }

  /**
   * Toggle ready status
   */
  async toggleReady() {
    if (!this.party) return;

    const currentMember = this.party.members?.find(m => m.userId === this.game.userId);
    const newReady = !currentMember?.isReady;

    try {
      await this.game.api.setReady(this.party.id, newReady);
      await this.loadData();
    } catch (error) {
      console.error('Failed to toggle ready:', error);
      parchmentToast.error('Error', 'Failed to update ready status');
    }
  }

  /**
   * Leave or disband party
   */
  async leaveParty() {
    if (!this.party) return;

    try {
      await this.game.api.leaveParty(this.party.id);
      this.party = null;
      this.render();
      parchmentToast.info('Left Party', 'You have left the party');

      if (this.game.partyStatusBar) {
        this.game.partyStatusBar.refresh();
      }
    } catch (error) {
      console.error('Failed to leave party:', error);
      parchmentToast.error('Error', error.message || 'Failed to leave party');
    }
  }

  /**
   * Start battle (leader only)
   */
  async startBattle() {
    // This would typically navigate to battle or show node selection
    parchmentToast.info('Select Node', 'Go to the world map and select a node to start battle');
  }

  /**
   * Toggle friend selection
   */
  toggleFriendSelection(friendId) {
    if (this.selectedFriends.has(friendId)) {
      this.selectedFriends.delete(friendId);
    } else {
      this.selectedFriends.add(friendId);
    }
    this.render();
  }

  /**
   * Select all online friends
   */
  selectAllFriends() {
    const slotsAvailable = this.party
      ? this.party.maxMembers - (this.party.members?.length || 1)
      : 4;

    const onlineFriends = this.friends.filter(f =>
      f.status === 'online' && f.activity?.type !== 'battle'
    );

    this.selectedFriends.clear();
    onlineFriends.slice(0, slotsAvailable).forEach(f => {
      this.selectedFriends.add(f.id);
    });
    this.render();
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.selectedFriends.clear();
    this.render();
  }

  /**
   * Invite selected friends (create party if needed)
   */
  async inviteSelected() {
    if (this.selectedFriends.size === 0) return;

    try {
      // Create party if not in one
      if (!this.party) {
        const response = await this.game.api.createMultiplayerParty('Party', 'pve', 5);
        if (!response.party) throw new Error('Failed to create party');
        this.party = response.party;
      }

      // Get usernames for selected friends
      const selectedUsernames = this.friends
        .filter(f => this.selectedFriends.has(f.id))
        .map(f => f.username);

      // Send invites
      const invitePromises = selectedUsernames.map(username =>
        this.game.api.inviteToParty(this.party.id, username).catch(err => {
          console.error(`Failed to invite ${username}:`, err);
          return { error: err.message };
        })
      );

      const results = await Promise.all(invitePromises);
      const successCount = results.filter(r => !r.error).length;

      if (successCount > 0) {
        parchmentToast.success('Invites Sent', `Invited ${successCount} friend(s) to your party`);
      }

      this.selectedFriends.clear();
      await this.loadData();

      if (this.game.partyStatusBar) {
        this.game.partyStatusBar.refresh();
      }
    } catch (error) {
      console.error('Failed to invite friends:', error);
      parchmentToast.error('Error', error.message || 'Failed to send invites');
    }
  }

  /**
   * Clean up
   */
  destroy() {
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.off(type, handler);
    });
    this.wsHandlers = {};

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
