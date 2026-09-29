/**
 * @module TavernChatManager
 * @description Manages chat message handling for the TavernScene.
 *
 * Key responsibilities:
 * - Message sending/receiving via WebSocket
 * - Chat history loading and pagination
 * - Message rendering with reactions
 * - Chat input handling and auto-resize
 * - Emoji picker and insertion
 * - Typing indicators
 * - Chat scrolling and scroll-to-bottom
 *
 * @see TavernScene.js - Parent scene that orchestrates tavern UI
 * @see TavernDMSystem.js - Direct messaging subsystem
 */

import { escapeHtml } from '../utils/escapeHtml.js';

/**
 * Manages chat message functionality for the tavern
 */
export class TavernChatManager {
  /**
   * @param {TavernScene} scene - Parent TavernScene instance
   */
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;

    // Chat state
    this.messages = [];
    this.hasMoreMessages = true;
    this.loadingMessages = false;

    // Typing state
    this.typingUsers = new Map(); // room -> Set of usernames
    this.typingTimeout = null;
    this.isTyping = false;

    // Emoji picker
    this.showEmojiPicker = false;
    this.commonEmojis = [
      '128578', '128512', '128514', '128516', '128518', '128519', '128521', '128522',
      '128525', '128536', '128540', '128557', '128563', '128564', '128577', '128580',
      '129315', '129316', '129320', '129321', '129325', '129327', '128293', '128077',
      '128078', '128079', '128591', '128170', '127881', '127873', '128142', '128161'
    ];
  }

  /**
   * Get current user ID from game state
   * @returns {number|null}
   */
  get userId() {
    return this.game.state.get('user')?.id;
  }

  /**
   * Get current username from game state
   * @returns {string|null}
   */
  get username() {
    return this.game.state.get('user')?.username;
  }

  /**
   * Get the active tab from parent scene
   * @returns {string}
   */
  get activeTab() {
    return this.scene.activeTab;
  }

  /**
   * Get active DM user from parent scene
   * @returns {{userId: number, username: string}|null}
   */
  get activeDMUser() {
    return this.scene.activeDMUser;
  }

  /**
   * Get UI element from parent scene
   * @returns {HTMLElement|null}
   */
  get uiElement() {
    return this.scene.uiElement;
  }

  /**
   * Reset chat state when switching tabs
   */
  resetState() {
    this.messages = [];
    this.hasMoreMessages = true;
  }

  /**
   * Load chat history from API
   */
  async loadChatHistory() {
    try {
      let messages;

      if (this.activeTab === 'dm' && this.activeDMUser) {
        const result = await this.game.api.getDMHistory(this.activeDMUser.userId);
        messages = result.messages;
      } else if (this.activeTab === 'party') {
        // For party chat, we need to get the partyId first
        const partyResponse = await this.game.api.getMultiplayerParty();
        if (!partyResponse.party) {
          // Player has no party, skip loading party chat
          this.messages = [];
          this.hasMoreMessages = false;
          this.renderMessages();
          return;
        }
        const result = await this.game.api.getChatHistory('party', {
          partyId: partyResponse.party.id
        });
        messages = result.messages;
      } else {
        // Global chat
        const result = await this.game.api.getChatHistory('global');
        messages = result.messages;
      }

      this.messages = messages || [];
      this.hasMoreMessages = this.messages.length >= 50;
      this.renderMessages();
      this.scrollToBottom();
    } catch (err) {
      console.error('Failed to load chat history:', err);
      this.messages = [];
      this.renderMessages();
    }
  }

  /**
   * Load older messages when scrolling up
   */
  async loadMoreMessages() {
    if (this.loadingMessages || !this.hasMoreMessages || this.messages.length === 0) return;

    this.loadingMessages = true;
    const oldestMessage = this.messages[0];

    try {
      let result;
      if (this.activeTab === 'dm' && this.activeDMUser) {
        result = await this.game.api.getDMHistory(this.activeDMUser.userId, {
          before: oldestMessage.createdAt
        });
      } else if (this.activeTab === 'party') {
        // For party chat, we need to get the partyId first
        const partyResponse = await this.game.api.getMultiplayerParty();
        if (!partyResponse.party) {
          // Player has no party, nothing more to load
          this.hasMoreMessages = false;
          return;
        }
        result = await this.game.api.getChatHistory('party', {
          before: oldestMessage.createdAt,
          partyId: partyResponse.party.id
        });
      } else {
        // Global chat
        result = await this.game.api.getChatHistory('global', {
          before: oldestMessage.createdAt
        });
      }

      const newMessages = result.messages || [];
      this.hasMoreMessages = newMessages.length >= 50;
      this.messages = [...newMessages, ...this.messages];
      this.renderMessages(true);
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      this.loadingMessages = false;
    }
  }

  /**
   * Add a new message to the chat
   * @param {Object} msg - Message object
   */
  addMessage(msg) {
    this.messages.push(msg);
    this.renderMessages();
    this.scrollToBottom();
  }

  /**
   * Send a chat message
   */
  sendMessage() {
    const input = this.uiElement?.querySelector('#chat-input');
    const message = input?.value.trim();

    if (!message) return;

    input.value = '';
    this.autoResizeInput(input);

    // Stop typing indicator
    this.stopTyping();

    // Get party leader character ID for chat messages
    const characters = this.game.state.get('characters') || [];
    const partyLeader = characters.find(c => c.party_slot === 1) || characters[0];
    const characterId = partyLeader?.id || null;

    if (this.activeTab === 'dm' && this.activeDMUser) {
      // Send DM via WebSocket
      this.game.socket.send('private_message', {
        targetUserId: this.activeDMUser.userId,
        message,
        characterId
      });

      // Add to local messages immediately
      this.addMessage({
        id: Date.now(),
        senderUserId: this.userId,
        senderUsername: this.username,
        message,
        createdAt: new Date(),
        reactions: []
      });
    } else if (this.activeTab === 'global') {
      // Send to global room
      this.game.socket.sendChatMessage('global', message, characterId);
    } else if (this.activeTab === 'party') {
      // Send to party room
      this.game.socket.sendChatMessage('party', message, characterId);
    }
  }

  /**
   * Render all messages to the chat container
   * @param {boolean} preserveScroll - Whether to preserve scroll position
   */
  renderMessages(preserveScroll = false) {
    const container = this.uiElement?.querySelector('#chat-messages');
    if (!container) return;

    const scrollPos = container.scrollTop;
    const scrollHeight = container.scrollHeight;

    if (this.messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128172;</div>
          <div>No messages yet. Be the first to say hello!</div>
        </div>
      `;
      return;
    }

    let html = '';

    if (this.hasMoreMessages) {
      html += '<button class="load-more-btn" id="load-more-btn">Load older messages</button>';
    }

    html += this.messages.map(msg => this.renderMessage(msg)).join('');

    container.innerHTML = html;

    // Add event listeners for reactions
    container.querySelectorAll('.add-reaction-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showReactionPicker(parseInt(btn.dataset.messageId));
      });
    });

    container.querySelectorAll('.chat-reaction').forEach(btn => {
      btn.addEventListener('click', () => {
        this.toggleReaction(parseInt(btn.dataset.messageId), btn.dataset.emoji);
      });
    });

    // Load more button
    container.querySelector('#load-more-btn')?.addEventListener('click', () => {
      this.loadMoreMessages();
    });

    if (preserveScroll) {
      container.scrollTop = scrollPos + (container.scrollHeight - scrollHeight);
    }
  }

  /**
   * Render a single message
   * @param {Object} msg - Message object
   * @returns {string} HTML string
   */
  renderMessage(msg) {
    const isSelf = msg.senderUserId === this.userId;
    const time = this.formatTime(msg.createdAt || msg.created_at);
    const reactions = msg.reactions || [];

    let reactionsHtml = '';
    if (reactions.length > 0) {
      reactionsHtml = `
        <div class="chat-message-reactions">
          ${reactions.map(r => `
            <button class="chat-reaction ${r.userIds?.includes(this.userId) ? 'user-reacted' : ''}"
                    data-message-id="${msg.id}"
                    data-emoji="${r.emoji}">
              <span>${r.emoji}</span>
              <span class="chat-reaction-count">${r.count}</span>
            </button>
          `).join('')}
          <button class="add-reaction-btn" data-message-id="${msg.id}">+</button>
        </div>
      `;
    } else {
      reactionsHtml = `
        <div class="chat-message-reactions" style="display: none;">
          <button class="add-reaction-btn" data-message-id="${msg.id}">+</button>
        </div>
      `;
    }

    return `
      <div class="chat-message ${isSelf ? 'own-message' : ''}" data-message-id="${msg.id}">
        <div class="chat-message-header">
          <span class="chat-message-author ${isSelf ? 'self' : ''}">${escapeHtml(msg.senderUsername || msg.sender_username || '')}</span>
          <span class="chat-message-time">${time}</span>
        </div>
        <div class="chat-message-text">${escapeHtml(msg.message)}</div>
        ${reactionsHtml}
      </div>
    `;
  }

  /**
   * Handle typing indicator start
   */
  handleTyping() {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    if (!this.isTyping) {
      this.isTyping = true;
      const room = this.activeTab === 'dm' ? `dm:${this.activeDMUser?.userId}` : this.activeTab;
      this.game.socket.send('typing_indicator', { room, isTyping: true });
    }

    this.typingTimeout = setTimeout(() => {
      this.stopTyping();
    }, 2000);
  }

  /**
   * Stop typing indicator
   */
  stopTyping() {
    if (this.isTyping) {
      this.isTyping = false;
      const room = this.activeTab === 'dm' ? `dm:${this.activeDMUser?.userId}` : this.activeTab;
      this.game.socket.send('typing_indicator', { room, isTyping: false });
    }
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
  }

  /**
   * Show typing indicator from another user
   * @param {string} room - Room identifier
   * @param {string} username - Username of typing user
   * @param {boolean} isTyping - Whether user is typing
   */
  showTypingIndicator(room, username, isTyping) {
    const indicator = this.uiElement?.querySelector('#typing-indicator');
    if (!indicator) return;

    const currentRoom = this.activeTab === 'dm' ? `dm:${this.activeDMUser?.userId}` : this.activeTab;

    // Only show if in same room
    if (room !== currentRoom && room !== 'global') return;

    if (!this.typingUsers.has(room)) {
      this.typingUsers.set(room, new Set());
    }

    const roomTyping = this.typingUsers.get(room);

    if (isTyping) {
      roomTyping.add(username);
    } else {
      roomTyping.delete(username);
    }

    if (roomTyping.size === 0) {
      indicator.textContent = '';
    } else if (roomTyping.size === 1) {
      indicator.textContent = `${Array.from(roomTyping)[0]} is typing...`;
    } else if (roomTyping.size === 2) {
      const names = Array.from(roomTyping);
      indicator.textContent = `${names[0]} and ${names[1]} are typing...`;
    } else {
      indicator.textContent = 'Several people are typing...';
    }
  }

  /**
   * Toggle emoji picker visibility
   */
  toggleEmojiPicker() {
    const picker = this.uiElement?.querySelector('#emoji-picker');
    if (picker) {
      picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    }
  }

  /**
   * Insert emoji at cursor position in chat input
   * @param {string} emoji - Emoji to insert
   */
  insertEmoji(emoji) {
    const input = this.uiElement?.querySelector('#chat-input');
    if (input) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const text = input.value;
      input.value = text.substring(0, start) + emoji + text.substring(end);
      input.selectionStart = input.selectionEnd = start + emoji.length;
      input.focus();
    }
    this.toggleEmojiPicker();
  }

  /**
   * Show reaction picker for a message (simplified to just add thumbs up)
   * @param {number} messageId - Message ID
   */
  showReactionPicker(messageId) {
    // For simplicity, just add a thumbs up
    this.toggleReaction(messageId, String.fromCodePoint(128077));
  }

  /**
   * Toggle a reaction on a message
   * @param {number} messageId - Message ID
   * @param {string} emoji - Emoji reaction
   */
  toggleReaction(messageId, emoji) {
    const room = this.activeTab === 'dm' ? `dm:${this.activeDMUser?.userId}` : this.activeTab;

    // Check if user already reacted
    const msg = this.messages.find(m => m.id === messageId);
    const existingReaction = msg?.reactions?.find(r => r.emoji === emoji && r.userIds?.includes(this.userId));

    if (existingReaction) {
      this.game.socket.send('remove_reaction', { messageId, emoji, room });
    } else {
      this.game.socket.send('add_reaction', { messageId, emoji, room });
    }
  }

  /**
   * Update reactions on a message
   * @param {number} messageId - Message ID
   * @param {Array} reactions - Updated reactions array
   */
  updateMessageReactions(messageId, reactions) {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) {
      msg.reactions = reactions;
      this.renderMessages();
    }
  }

  /**
   * Auto-resize chat input based on content
   * @param {HTMLTextAreaElement} input - Input element
   */
  autoResizeInput(input) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  /**
   * Scroll chat to bottom
   */
  scrollToBottom() {
    const container = this.uiElement?.querySelector('#chat-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
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
   * Escape HTML in message text
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */

  /**
   * Clean up resources
   */
  destroy() {
    this.stopTyping();
    this.typingUsers.clear();
    this.messages = [];
  }
}
