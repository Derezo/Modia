/**
 * @module TavernDMSystem
 * @description Manages direct messaging functionality for the TavernScene.
 *
 * Key responsibilities:
 * - DM conversation loading and tracking
 * - DM tab management
 * - DM list rendering
 * - DM notifications and badge updates
 * - User selection for starting DMs
 *
 * @see TavernScene.js - Parent scene that orchestrates tavern UI
 * @see TavernChatManager.js - Chat message handling subsystem
 */

import { escapeHtml } from '../utils/escapeHtml.js';

/**
 * Manages direct messaging functionality for the tavern
 */
export class TavernDMSystem {
  /**
   * @param {TavernScene} scene - Parent TavernScene instance
   */
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;

    // DM state
    this.conversations = [];
    this.activeDMUser = null; // { userId, username }
    this.unreadCount = 0;
  }

  /**
   * Get UI element from parent scene
   * @returns {HTMLElement|null}
   */
  get uiElement() {
    return this.scene.uiElement;
  }

  /**
   * Get the active DM user
   * @returns {{userId: number, username: string}|null}
   */
  getActiveDMUser() {
    return this.activeDMUser;
  }

  /**
   * Set the active DM user
   * @param {{userId: number, username: string}|null} user
   */
  setActiveDMUser(user) {
    this.activeDMUser = user;
  }

  /**
   * Load DM conversations from API
   */
  async loadConversations() {
    try {
      const result = await this.game.api.getDMConversations();
      this.conversations = result.conversations || [];
      this.renderDMList();
    } catch (err) {
      console.error('Failed to load DM conversations:', err);
      this.conversations = [];
      this.renderDMList();
    }
  }

  /**
   * Start a direct message conversation with a user
   * @param {number} userId - Target user ID
   * @param {string} username - Target username
   */
  startDM(userId, username) {
    this.activeDMUser = { userId, username };
    this.scene.switchTab('dm');
    this.renderDMList();

    const input = this.uiElement?.querySelector('#chat-input');
    if (input) {
      input.placeholder = `Message ${username}...`;
      input.focus();
    }
  }

  /**
   * Handle incoming private message
   * @param {Object} payload - Message payload from WebSocket
   */
  handleIncomingDM(payload) {
    // If we're viewing this conversation, add the message
    if (this.scene.activeTab === 'dm' && this.activeDMUser?.userId === payload.senderId) {
      this.scene.chatManager.addMessage({
        id: payload.id,
        senderUserId: payload.senderId,
        senderUsername: payload.senderUsername,
        message: payload.message,
        createdAt: new Date(payload.timestamp),
        reactions: []
      });
    }

    // Update badge for unread messages
    this.updateDMBadge();
  }

  /**
   * Render the DM conversations list
   */
  renderDMList() {
    const container = this.uiElement?.querySelector('#dm-list');
    if (!container) return;

    if (this.conversations.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          No conversations yet
        </div>
      `;
      return;
    }

    container.innerHTML = this.conversations.map(conv => `
      <div class="dm-item ${this.activeDMUser?.userId === conv.other_user_id ? 'active' : ''}"
           data-user-id="${conv.other_user_id}"
           data-username="${escapeHtml(conv.other_username || '')}">
        <div class="dm-item-info">
          <div class="dm-item-name">${escapeHtml(conv.other_username || '')}</div>
          <div class="dm-item-preview">${escapeHtml(conv.last_message || '')}</div>
        </div>
        <div class="dm-item-time">${this.formatTime(conv.last_message_at)}</div>
      </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.dm-item').forEach(item => {
      item.addEventListener('click', () => {
        this.startDM(parseInt(item.dataset.userId), item.dataset.username);
      });
    });
  }

  /**
   * Update the DM badge with unread count
   */
  updateDMBadge() {
    const badge = this.uiElement?.querySelector('#dm-badge');
    if (badge) {
      // Track unread messages (placeholder for full implementation)
      // badge.style.display = this.unreadCount > 0 ? 'inline' : 'none';
      // badge.textContent = this.unreadCount;
    }
  }

  /**
   * Update chat input placeholder for current context
   */
  updateInputPlaceholder() {
    const input = this.uiElement?.querySelector('#chat-input');
    if (input && this.activeDMUser) {
      input.placeholder = `Message ${this.activeDMUser.username}...`;
    }
  }

  /**
   * Reset DM state when switching away from DM tab
   */
  resetActiveDM() {
    this.activeDMUser = null;
  }

  /**
   * Format timestamp for display
   * @param {string|Date} dateStr - Date to format
   * @returns {string} Formatted time string
   */
  formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;

    return date.toLocaleDateString();
  }

  /**
   * Escape HTML in text
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */

  /**
   * Clean up resources
   */
  destroy() {
    this.conversations = [];
    this.activeDMUser = null;
    this.unreadCount = 0;
  }
}
