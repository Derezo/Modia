import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentButtonCSS,
  getParchmentInputCSS,
  getParchmentGradient,
  getParchmentBorder
} from '../../ui/parchment/index.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';
import { escapeHtml } from '../../utils/escapeHtml.js';
import { parchmentConfirm } from '../../ui/parchment/parchmentConfirm.js';

const P = PARCHMENT_COLORS;

/**
 * ClanTab - Clan management with create/join/chat functionality
 *
 * Features:
 * - Browse and search clans
 * - Create new clan
 * - View pending invites
 * - Clan member list
 * - Clan chat
 * - Invite members (leader/officer)
 */
export class ClanTab {
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

    this.myClan = null;
    this.clanDetails = null;
    this.clans = [];
    this.invites = [];
    this.messages = [];
    this.searchQuery = '';
    this.isLoading = true;
    this.showCreateModal = false;
    this.showInviteModal = false;
    this.chatMessage = '';

    this.abortController = null;
    this.wsHandlers = {};
    this.chatPollInterval = null;
    this.chatPollFailures = 0;
  }

  /**
   * Add tab-specific styles
   */
  static addStyles() {
    if (document.getElementById('clan-tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'clan-tab-styles';
    style.textContent = `
      .clan-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      /* Header */
      .clan-tab-header {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderLight};
        background: ${P.light};
      }

      .clan-tab-title {
        margin: 0;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .clan-tab-actions {
        margin-left: auto;
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .clan-tab-btn {
        ${getParchmentButtonCSS('secondary')}
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
      }

      .clan-tab-btn.primary {
        ${getParchmentButtonCSS('primary')}
      }

      .clan-tab-btn.danger {
        ${getParchmentButtonCSS('danger')}
      }

      /* Body */
      .clan-tab-body {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
      }

      /* Search */
      .clan-search {
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .clan-search-input {
        ${getParchmentInputCSS()}
        width: 100%;
      }

      /* Clan list */
      .clan-list {
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .clan-card {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md};
        background: ${P.light};
        border: 1px solid ${P.borderLight};
        border-radius: ${PARCHMENT_RADIUS.md};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .clan-card:hover {
        background: ${P.mid};
        border-color: ${P.border};
      }

      .clan-card-tag {
        min-width: 50px;
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        background: ${P.accent.burgundy};
        color: white;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: 600;
        text-align: center;
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .clan-card-info {
        flex: 1;
      }

      .clan-card-name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .clan-card-meta {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      /* Invites section */
      .clan-invites-section {
        margin-bottom: ${PARCHMENT_SPACING.lg};
      }

      .clan-section-title {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: 600;
        color: ${P.text.muted};
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .clan-invite-item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: ${P.accent.gold}15;
        border: 1px solid ${P.accent.gold}40;
        border-radius: ${PARCHMENT_RADIUS.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .clan-invite-info {
        flex: 1;
      }

      .clan-invite-name {
        font-weight: 600;
        color: ${P.text.primary};
      }

      .clan-invite-from {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      .clan-invite-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
      }

      /* My clan view */
      .my-clan-container {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .my-clan-info {
        padding: ${PARCHMENT_SPACING.md};
        background: ${P.light};
        border-bottom: 1px solid ${P.borderLight};
      }

      .my-clan-header {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .my-clan-tag {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        background: ${P.accent.burgundy};
        color: white;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 700;
        border-radius: ${PARCHMENT_RADIUS.sm};
      }

      .my-clan-name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .my-clan-meta {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      .my-clan-description {
        margin-top: ${PARCHMENT_SPACING.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.secondary};
      }

      /* Content area: members + chat */
      .my-clan-content {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      /* Members panel */
      .clan-members-panel {
        width: 200px;
        border-right: 1px solid ${P.borderLight};
        overflow-y: auto;
        background: ${P.base};
      }

      .clan-member-item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        border-bottom: 1px solid ${P.borderLight};
      }

      .clan-member-role {
        font-size: 12px;
      }

      .clan-member-name {
        flex: 1;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.primary};
      }

      .clan-member-role-badge {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        padding: 2px 6px;
        background: ${P.mid};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.text.muted};
      }

      .clan-member-role-badge.leader {
        background: ${P.accent.gold}30;
        color: ${P.accent.gold};
      }

      .clan-member-role-badge.officer {
        background: ${P.accent.burgundy}30;
        color: ${P.accent.burgundy};
      }

      .clan-member-transfer-btn {
        ${getParchmentButtonCSS('secondary')}
        font-size: 10px;
        padding: 2px 6px;
        margin-left: auto;
      }

      /* Chat panel */
      .clan-chat-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .clan-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .clan-chat-message {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        border-radius: ${PARCHMENT_RADIUS.sm};
        background: ${P.light};
      }

      .clan-chat-message-header {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        margin-bottom: 2px;
      }

      .clan-chat-message-author {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: 600;
        color: ${P.accent.burgundy};
      }

      .clan-chat-message-time {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
      }

      .clan-chat-message-text {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.primary};
        word-break: break-word;
      }

      .clan-chat-input-area {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        border-top: 1px solid ${P.borderLight};
        background: ${P.light};
      }

      .clan-chat-input {
        ${getParchmentInputCSS()}
        flex: 1;
      }

      /* Modal */
      .clan-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .clan-modal {
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.lg};
        width: 400px;
        max-width: 90%;
      }

      .clan-modal-title {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: 600;
        color: ${P.text.primary};
        margin: 0 0 ${PARCHMENT_SPACING.md} 0;
      }

      .clan-modal-field {
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .clan-modal-label {
        display: block;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: 600;
        color: ${P.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .clan-modal-input {
        ${getParchmentInputCSS()}
        width: 100%;
      }

      .clan-modal-hint {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
        margin-top: ${PARCHMENT_SPACING.xs};
      }

      .clan-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: ${PARCHMENT_SPACING.sm};
        margin-top: ${PARCHMENT_SPACING.lg};
      }

      /* Loading */
      .clan-tab-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .clan-tab-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid ${P.borderLight};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: clan-spin 1s linear infinite;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      @keyframes clan-spin {
        to { transform: rotate(360deg); }
      }

      /* Empty state */
      .clan-tab-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
        color: ${P.text.muted};
        text-align: center;
      }

      .clan-tab-empty-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .clan-tab-empty-text {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      /* Scrollbar */
      .clan-tab-body::-webkit-scrollbar,
      .clan-members-panel::-webkit-scrollbar,
      .clan-chat-messages::-webkit-scrollbar {
        width: 8px;
      }

      .clan-tab-body::-webkit-scrollbar-track,
      .clan-members-panel::-webkit-scrollbar-track,
      .clan-chat-messages::-webkit-scrollbar-track {
        background: ${P.mid};
        border-radius: 4px;
      }

      .clan-tab-body::-webkit-scrollbar-thumb,
      .clan-members-panel::-webkit-scrollbar-thumb,
      .clan-chat-messages::-webkit-scrollbar-thumb {
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
    ClanTab.addStyles();
    this.abortController = new AbortController();

    await this.loadData();
    this.render();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    // Start chat polling if in a clan
    if (this.myClan) {
      this.startChatPolling();
    }
  }

  /**
   * Load initial data
   */
  async loadData() {
    this.isLoading = true;

    try {
      // Load user's clan status
      const myClanResponse = await this.game.api.getMyClan();
      this.myClan = myClanResponse.clan;

      if (this.myClan) {
        // Load detailed clan info with members
        const detailsResponse = await this.game.api.getClanDetails(this.myClan.id);
        if (detailsResponse.success) {
          this.clanDetails = detailsResponse.clan;
        }

        // Load recent messages
        await this.loadMessages();
      } else {
        // Load clan list and invites
        const [clansResponse, invitesResponse] = await Promise.all([
          this.game.api.listClans(),
          this.game.api.getClanInvites()
        ]);

        if (clansResponse.success) {
          this.clans = clansResponse.clans;
        }

        if (invitesResponse.success) {
          this.invites = invitesResponse.invites;
          this.onBadgeUpdate?.(this.invites.length);
        }
      }
    } catch (error) {
      console.error('Failed to load clan data:', error);
      parchmentToast.error('Error', 'Failed to load clan data');
    }

    this.isLoading = false;
  }

  /**
   * Load chat messages
   */
  async loadMessages() {
    if (!this.myClan) return;

    try {
      const response = await this.game.api.getClanMessages(this.myClan.id);
      if (response.success) {
        this.messages = response.messages;
      }
    } catch (error) {
      console.error('Failed to load clan messages:', error);
    }
  }

  /**
   * Start polling for new messages
   */
  startChatPolling() {
    this.chatPollFailures = 0;
    const MAX_FAILURES = 3;

    // Poll every 5 seconds
    this.chatPollInterval = setInterval(async () => {
      try {
        await this.loadMessages();
        this.renderChatMessages();
        // Reset failure count on success
        this.chatPollFailures = 0;
      } catch (error) {
        this.chatPollFailures++;
        console.error(`Chat poll failed (${this.chatPollFailures}/${MAX_FAILURES}):`, error);

        // Stop polling after too many consecutive failures
        if (this.chatPollFailures >= MAX_FAILURES) {
          this.stopChatPolling();
          console.warn('Chat polling stopped due to repeated failures');
        }
      }
    }, 5000);
  }

  /**
   * Render the tab
   */
  render() {
    if (this.isLoading) {
      this.container.innerHTML = `
        <div class="clan-tab">
          <div class="clan-tab-loading">
            <div class="clan-tab-spinner"></div>
            <span>Loading clan...</span>
          </div>
        </div>
      `;
      return;
    }

    if (this.myClan) {
      this.renderMyClan();
    } else {
      this.renderNoClan();
    }

    // Render modals
    if (this.showCreateModal) {
      this.renderCreateModal();
    }
    if (this.showInviteModal) {
      this.renderInviteModal();
    }
  }

  /**
   * Render view when user has a clan
   */
  renderMyClan() {
    const clan = this.clanDetails || this.myClan;
    const members = this.clanDetails?.members || [];
    const isLeaderOrOfficer = this.myClan.myRole === 'leader' || this.myClan.myRole === 'officer';

    this.container.innerHTML = `
      <div class="clan-tab">
        <div class="clan-tab-header">
          <h3 class="clan-tab-title">My Clan</h3>
          <div class="clan-tab-actions">
            ${isLeaderOrOfficer ? `
              <button class="clan-tab-btn primary" data-action="invite">
                + Invite
              </button>
            ` : ''}
            ${this.myClan.myRole === 'leader' ? `
              <button class="clan-tab-btn danger" data-action="disband">
                Disband
              </button>
            ` : `
              <button class="clan-tab-btn danger" data-action="leave">
                Leave
              </button>
            `}
          </div>
        </div>
        <div class="my-clan-container">
          <div class="my-clan-info">
            <div class="my-clan-header">
              <span class="my-clan-tag">[${escapeHtml(clan.tag)}]</span>
              <span class="my-clan-name">${escapeHtml(clan.name)}</span>
            </div>
            <div class="my-clan-meta">
              ${members.length}/${clan.maxMembers} members | Leader: ${escapeHtml(clan.leaderUsername)}
            </div>
            ${clan.description ? `
              <div class="my-clan-description">${escapeHtml(clan.description)}</div>
            ` : ''}
          </div>
          <div class="my-clan-content">
            <div class="clan-members-panel">
              ${this.renderMembers(members)}
            </div>
            <div class="clan-chat-panel">
              <div class="clan-chat-messages" id="clan-chat-messages">
                ${this.renderMessages()}
              </div>
              <div class="clan-chat-input-area">
                <input type="text"
                       class="clan-chat-input"
                       placeholder="Type a message..."
                       maxlength="500"
                       id="clan-chat-input">
                <button class="clan-tab-btn primary" data-action="send-message">
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Scroll chat to bottom
    const chatMessages = this.container.querySelector('#clan-chat-messages');
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  /**
   * Render members list
   */
  renderMembers(members) {
    if (members.length === 0) {
      return '<div class="clan-tab-empty"><span>No members</span></div>';
    }

    const isLeader = this.myClan?.myRole === 'leader';

    return members.map(member => {
      // Show transfer button only if current user is leader and member is not leader
      const showTransfer = isLeader && member.role !== 'leader';

      return `
        <div class="clan-member-item">
          <span class="clan-member-role">${this.getRoleIcon(member.role)}</span>
          <span class="clan-member-name">${escapeHtml(member.username)}</span>
          <span class="clan-member-role-badge ${member.role}">${member.role}</span>
          ${showTransfer ? `
            <button class="clan-member-transfer-btn" data-action="transfer" data-user-id="${member.userId}">
              Make Leader
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Get role icon
   */
  getRoleIcon(role) {
    switch (role) {
      case 'leader': return '&#x1F451;'; // Crown
      case 'officer': return '&#x2B50;'; // Star
      default: return '&#x1F464;'; // Person
    }
  }

  /**
   * Render chat messages
   */
  renderMessages() {
    if (this.messages.length === 0) {
      return `
        <div class="clan-tab-empty">
          <div class="clan-tab-empty-icon">&#x1F4AC;</div>
          <div class="clan-tab-empty-text">No messages yet</div>
        </div>
      `;
    }

    return this.messages.map(msg => `
      <div class="clan-chat-message">
        <div class="clan-chat-message-header">
          <span class="clan-chat-message-author">${escapeHtml(msg.username)}</span>
          <span class="clan-chat-message-time">${this.formatTime(msg.createdAt)}</span>
        </div>
        <div class="clan-chat-message-text">${escapeHtml(msg.message)}</div>
      </div>
    `).join('');
  }

  /**
   * Re-render just the chat messages
   */
  renderChatMessages() {
    const container = this.container.querySelector('#clan-chat-messages');
    if (container) {
      const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
      container.innerHTML = this.renderMessages();
      if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }

  /**
   * Format timestamp
   */
  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Render view when user has no clan
   */
  renderNoClan() {
    this.container.innerHTML = `
      <div class="clan-tab">
        <div class="clan-tab-header">
          <h3 class="clan-tab-title">Clan</h3>
          <div class="clan-tab-actions">
            <button class="clan-tab-btn primary" data-action="create">
              + Create Clan
            </button>
          </div>
        </div>
        <div class="clan-tab-body">
          ${this.invites.length > 0 ? this.renderInvites() : ''}
          <div class="clan-search">
            <input type="text"
                   class="clan-search-input"
                   placeholder="Search clans..."
                   value="${escapeHtml(this.searchQuery)}">
          </div>
          ${this.renderClanList()}
        </div>
      </div>
    `;
  }

  /**
   * Render pending invites
   */
  renderInvites() {
    return `
      <div class="clan-invites-section">
        <div class="clan-section-title">Pending Invites (${this.invites.length})</div>
        ${this.invites.map(invite => `
          <div class="clan-invite-item">
            <span class="clan-card-tag">[${escapeHtml(invite.clanTag)}]</span>
            <div class="clan-invite-info">
              <div class="clan-invite-name">${escapeHtml(invite.clanName)}</div>
              <div class="clan-invite-from">Invited by ${escapeHtml(invite.inviterUsername)}</div>
            </div>
            <div class="clan-invite-actions">
              <button class="clan-tab-btn primary" data-action="accept-invite" data-invite-id="${invite.id}">
                Accept
              </button>
              <button class="clan-tab-btn" data-action="decline-invite" data-invite-id="${invite.id}">
                Decline
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Render clan list
   */
  renderClanList() {
    const filteredClans = this.searchQuery
      ? this.clans.filter(c =>
        c.name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
          c.tag.toLowerCase().includes(this.searchQuery.toLowerCase())
      )
      : this.clans;

    if (filteredClans.length === 0) {
      return `
        <div class="clan-tab-empty">
          <div class="clan-tab-empty-icon">&#x1F3F0;</div>
          <div class="clan-tab-empty-text">
            ${this.searchQuery ? 'No clans found' : 'No clans exist yet'}
          </div>
        </div>
      `;
    }

    return `
      <div class="clan-section-title">Browse Clans</div>
      <div class="clan-list">
        ${filteredClans.map(clan => `
          <div class="clan-card" data-clan-id="${clan.id}">
            <span class="clan-card-tag">[${escapeHtml(clan.tag)}]</span>
            <div class="clan-card-info">
              <div class="clan-card-name">${escapeHtml(clan.name)}</div>
              <div class="clan-card-meta">
                ${clan.memberCount}/${clan.maxMembers} members | Leader: ${escapeHtml(clan.leaderUsername)}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Render create clan modal
   */
  renderCreateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'clan-modal-overlay';
    overlay.innerHTML = `
      <div class="clan-modal">
        <h3 class="clan-modal-title">Create Clan</h3>
        <div class="clan-modal-field">
          <label class="clan-modal-label">Clan Name</label>
          <input type="text" class="clan-modal-input" id="create-clan-name"
                 placeholder="My Awesome Clan" maxlength="32">
          <div class="clan-modal-hint">3-32 characters</div>
        </div>
        <div class="clan-modal-field">
          <label class="clan-modal-label">Clan Tag</label>
          <input type="text" class="clan-modal-input" id="create-clan-tag"
                 placeholder="MAC" maxlength="6" style="text-transform: uppercase;">
          <div class="clan-modal-hint">2-6 alphanumeric characters</div>
        </div>
        <div class="clan-modal-field">
          <label class="clan-modal-label">Description (optional)</label>
          <input type="text" class="clan-modal-input" id="create-clan-desc"
                 placeholder="A brief description..." maxlength="256">
        </div>
        <div class="clan-modal-actions">
          <button class="clan-tab-btn" data-action="cancel-create">Cancel</button>
          <button class="clan-tab-btn primary" data-action="confirm-create">Create</button>
        </div>
      </div>
    `;
    this.container.appendChild(overlay);
  }

  /**
   * Render invite modal
   */
  renderInviteModal() {
    const overlay = document.createElement('div');
    overlay.className = 'clan-modal-overlay';
    overlay.innerHTML = `
      <div class="clan-modal">
        <h3 class="clan-modal-title">Invite Player</h3>
        <div class="clan-modal-field">
          <label class="clan-modal-label">Username</label>
          <input type="text" class="clan-modal-input" id="invite-username"
                 placeholder="Enter username...">
        </div>
        <div class="clan-modal-actions">
          <button class="clan-tab-btn" data-action="cancel-invite">Cancel</button>
          <button class="clan-tab-btn primary" data-action="confirm-invite">Send Invite</button>
        </div>
      </div>
    `;
    this.container.appendChild(overlay);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Reset AbortController to prevent duplicate listeners on re-render
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Action buttons
    this.container.addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      if (!action) return;

      switch (action) {
        case 'create':
          this.showCreateModal = true;
          this.render();
          break;

        case 'cancel-create':
          this.showCreateModal = false;
          this.render();
          break;

        case 'confirm-create':
          await this.handleCreateClan();
          break;

        case 'invite':
          this.showInviteModal = true;
          this.render();
          break;

        case 'cancel-invite':
          this.showInviteModal = false;
          this.render();
          break;

        case 'confirm-invite':
          await this.handleInvitePlayer();
          break;

        case 'accept-invite':
          await this.handleAcceptInvite(parseInt(e.target.dataset.inviteId, 10));
          break;

        case 'decline-invite':
          await this.handleDeclineInvite(parseInt(e.target.dataset.inviteId, 10));
          break;

        case 'leave':
          await this.handleLeaveClan();
          break;

        case 'disband':
          await this.handleDisbandClan();
          break;

        case 'send-message':
          await this.handleSendMessage();
          break;

        case 'transfer':
          await this.handleTransferLeadership(parseInt(e.target.dataset.userId, 10));
          break;
      }
    }, { signal });

    // Search input
    this.container.addEventListener('input', (e) => {
      if (e.target.classList.contains('clan-search-input')) {
        this.searchQuery = e.target.value;
        this.render();
        this.setupEventListeners();
      }
    }, { signal });

    // Chat input enter key
    this.container.addEventListener('keypress', async (e) => {
      if (e.target.id === 'clan-chat-input' && e.key === 'Enter') {
        await this.handleSendMessage();
      }
    }, { signal });
  }

  /**
   * Setup WebSocket handlers
   */
  setupWebSocketHandlers() {
    // Clan message received
    this.wsHandlers['clan_message'] = (data) => {
      if (data.clanId === this.myClan?.id) {
        this.messages.push(data);
        this.renderChatMessages();
      }
    };

    // Clan member joined
    this.wsHandlers['clan_member_joined'] = async (data) => {
      if (data.clanId === this.myClan?.id) {
        await this.loadData();
        this.render();
        this.setupEventListeners();
        parchmentToast.info('New Member', `${data.username} joined the clan`);
      }
    };

    // Clan member left
    this.wsHandlers['clan_member_left'] = async (data) => {
      if (data.clanId === this.myClan?.id) {
        await this.loadData();
        this.render();
        this.setupEventListeners();
        parchmentToast.info('Member Left', `${data.username} left the clan`);
      }
    };

    // Register handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.on(type, handler);
    });
  }

  /**
   * Handle create clan
   */
  async handleCreateClan() {
    const nameInput = this.container.querySelector('#create-clan-name');
    const tagInput = this.container.querySelector('#create-clan-tag');
    const descInput = this.container.querySelector('#create-clan-desc');

    const name = nameInput?.value.trim();
    const tag = tagInput?.value.trim().toUpperCase();
    const description = descInput?.value.trim();

    if (!name || name.length < 3) {
      parchmentToast.error('Invalid Name', 'Clan name must be at least 3 characters');
      return;
    }

    if (!tag || tag.length < 2 || !/^[A-Z0-9]+$/.test(tag)) {
      parchmentToast.error('Invalid Tag', 'Clan tag must be 2-6 alphanumeric characters');
      return;
    }

    try {
      const response = await this.game.api.createClan(name, tag, description || undefined);
      if (response.success) {
        parchmentToast.success('Clan Created', `[${tag}] ${name} has been created!`);
        this.showCreateModal = false;
        await this.loadData();
        this.render();
        this.setupEventListeners();
        this.startChatPolling();
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to create clan');
    }
  }

  /**
   * Handle invite player
   */
  async handleInvitePlayer() {
    const usernameInput = this.container.querySelector('#invite-username');
    const username = usernameInput?.value.trim();

    if (!username) {
      parchmentToast.error('Invalid Username', 'Please enter a username');
      return;
    }

    try {
      const response = await this.game.api.inviteToClan(this.myClan.id, username);
      if (response.success) {
        parchmentToast.success('Invite Sent', `Invited ${username} to the clan`);
        this.showInviteModal = false;
        this.render();
        this.setupEventListeners();
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to send invite');
    }
  }

  /**
   * Handle accept invite
   */
  async handleAcceptInvite(inviteId) {
    try {
      const response = await this.game.api.acceptClanInvite(inviteId);
      if (response.success) {
        parchmentToast.success('Joined Clan', `Welcome to ${response.membership.clanName}!`);
        await this.loadData();
        this.render();
        this.setupEventListeners();
        this.startChatPolling();
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to accept invite');
    }
  }

  /**
   * Handle decline invite
   */
  async handleDeclineInvite(inviteId) {
    try {
      const response = await this.game.api.declineClanInvite(inviteId);
      if (response.success) {
        this.invites = this.invites.filter(i => i.id !== inviteId);
        this.onBadgeUpdate?.(this.invites.length);
        this.render();
        this.setupEventListeners();
        parchmentToast.info('Declined', 'Clan invite declined');
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to decline invite');
    }
  }

  /**
   * Handle leave clan
   */
  async handleLeaveClan() {
    if (!(await parchmentConfirm({ title: 'Leave Clan', message: 'Are you sure you want to leave this clan?', confirmLabel: 'Leave', confirmVariant: 'danger' }))) return;

    try {
      const response = await this.game.api.leaveClan(this.myClan.id);
      if (response.success) {
        parchmentToast.info('Left Clan', 'You have left the clan');
        this.stopChatPolling();
        this.myClan = null;
        this.clanDetails = null;
        this.messages = [];
        await this.loadData();
        this.render();
        this.setupEventListeners();
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to leave clan');
    }
  }

  /**
   * Handle transfer leadership
   */
  async handleTransferLeadership(targetUserId) {
    const member = this.clanDetails?.members?.find(m => m.userId === targetUserId);
    const memberName = member?.username || 'this member';

    if (!(await parchmentConfirm({ title: 'Transfer Leadership', message: `Are you sure you want to transfer leadership to ${memberName}? You will become an officer.`, confirmLabel: 'Transfer' }))) {
      return;
    }

    try {
      const response = await this.game.api.transferClanLeadership(this.myClan.id, targetUserId);
      if (response.success) {
        parchmentToast.success('Leadership Transferred', `${response.newLeaderUsername} is now the clan leader`);
        await this.loadData();
        this.render();
        this.setupEventListeners();
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to transfer leadership');
    }
  }

  /**
   * Handle disband clan
   */
  async handleDisbandClan() {
    if (!(await parchmentConfirm({ title: 'Disband Clan', message: 'Are you sure you want to disband this clan? This cannot be undone.', confirmLabel: 'Disband', confirmVariant: 'danger' }))) return;

    try {
      const response = await this.game.api.disbandClan(this.myClan.id);
      if (response.success) {
        parchmentToast.info('Clan Disbanded', 'The clan has been disbanded');
        this.stopChatPolling();
        this.myClan = null;
        this.clanDetails = null;
        this.messages = [];
        await this.loadData();
        this.render();
        this.setupEventListeners();
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to disband clan');
    }
  }

  /**
   * Handle send message
   */
  async handleSendMessage() {
    const input = this.container.querySelector('#clan-chat-input');
    const message = input?.value.trim();

    if (!message) return;

    try {
      const response = await this.game.api.sendClanMessage(this.myClan.id, message);
      if (response.success) {
        input.value = '';
        // Add message locally for instant feedback
        this.messages.push(response.message);
        this.renderChatMessages();
      }
    } catch (error) {
      parchmentToast.error('Error', error.message || 'Failed to send message');
    }
  }

  /**
   * Stop chat polling
   */
  stopChatPolling() {
    if (this.chatPollInterval) {
      clearInterval(this.chatPollInterval);
      this.chatPollInterval = null;
    }
  }

  /**
   * Escape HTML
   */

  /**
   * Clean up resources
   */
  destroy() {
    // Stop chat polling
    this.stopChatPolling();

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
}
