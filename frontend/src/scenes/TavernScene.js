import { Scene } from './Scene.js';
import { PARCHMENT_COLORS, injectParchmentTheme } from '../ui/parchment/index.js';

// Shorthand for colors in CSS template
const P = PARCHMENT_COLORS;

/**
 * TavernScene - Social hub for chat, online players, and direct messages
 * Features: Global chat, Party chat, DMs, emoji picker, typing indicators
 */
export class TavernScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // Chat state
    this.activeTab = 'global'; // 'global', 'party', 'dm'
    this.messages = [];
    this.onlinePlayers = [];
    this.dmConversations = [];
    this.activeDMUser = null; // { userId, username } for active DM

    // Typing state
    this.typingUsers = new Map(); // room -> Set of usernames
    this.typingTimeout = null;
    this.isTyping = false;

    // Pagination
    this.hasMoreMessages = true;
    this.loadingMessages = false;

    // Emoji picker
    this.showEmojiPicker = false;
    this.commonEmojis = [
      '128578', '128512', '128514', '128516', '128518', '128519', '128521', '128522',
      '128525', '128536', '128540', '128557', '128563', '128564', '128577', '128580',
      '129315', '129316', '129320', '129321', '129325', '129327', '128293', '128077',
      '128078', '128079', '128591', '128170', '127881', '127873', '128142', '128161'
    ];

    // WebSocket handlers
    this.wsHandlers = {};
  }

  async enter(data = {}) {
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    // Join tavern room
    this.game.socket.joinRoom('tavern');
    this.game.socket.joinRoom('global');

    // Load initial data
    await Promise.all([
      this.loadChatHistory(),
      this.loadOnlinePlayers(),
      this.loadDMConversations()
    ]);
  }

  exit() {
    // Leave rooms
    this.game.socket.leaveRoom('tavern');
    this.game.socket.leaveRoom('global');

    // Remove WebSocket handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.off(type, handler);
    });
    this.wsHandlers = {};

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  addStyles() {
    // Ensure parchment CSS variables are available
    injectParchmentTheme();

    if (document.getElementById('tavern-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'tavern-scene-styles';
    style.textContent = `
      /* ============================================
         Tavern Scene - Parchment Theme
         Uses CSS variables from ParchmentTheme.js
         ============================================ */

      .tavern-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 50%, var(--parchment-dark) 100%);
        display: flex;
        flex-direction: column;
        font-family: var(--parchment-font);
        color: var(--parchment-text-primary);
      }

      .tavern-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--parchment-spacing-lg) var(--parchment-spacing-xxl);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border-bottom: 2px solid var(--parchment-border);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .tavern-title {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-md);
      }

      .tavern-title h2 {
        margin: 0;
        color: var(--parchment-gold);
        text-shadow: 0 1px 0 var(--parchment-highlight);
        font-size: 22px;
      }

      .tavern-title-icon {
        font-size: 24px;
      }

      .tavern-content {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      .tavern-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .tavern-tabs {
        display: flex;
        gap: var(--parchment-spacing-xs);
        padding: var(--parchment-spacing-md) var(--parchment-spacing-lg) 0;
        background: linear-gradient(to bottom, var(--parchment-dark) 0%, ${P.dark}dd 100%);
        border-bottom: 2px solid var(--parchment-border);
      }

      .tavern-tab {
        padding: 10px 20px;
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 2px solid var(--parchment-border);
        border-bottom: none;
        border-radius: var(--parchment-radius-lg) var(--parchment-radius-lg) 0 0;
        color: var(--parchment-text-secondary);
        cursor: pointer;
        transition: all 0.2s;
        font-family: var(--parchment-font);
        font-size: 14px;
        font-weight: bold;
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-sm);
        margin-bottom: -2px;
      }

      .tavern-tab:hover:not(.active) {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        color: var(--parchment-text-primary);
      }

      .tavern-tab.active {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        color: var(--parchment-gold);
        border-color: var(--parchment-border);
      }

      .tab-badge {
        background: ${P.copper};
        color: var(--parchment-text-inverse);
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        min-width: 18px;
        text-align: center;
      }

      .chat-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: var(--parchment-spacing-lg);
        overflow: hidden;
      }

      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: var(--parchment-spacing-md);
        background: linear-gradient(to bottom, ${P.text.inverse} 0%, ${P.light}ee 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        margin-bottom: var(--parchment-spacing-md);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.08);
      }

      .chat-message {
        padding: 10px 14px;
        margin-bottom: 6px;
        border-radius: var(--parchment-radius-lg);
        transition: background 0.2s;
        background: var(--parchment-highlight);
        border: 1px solid transparent;
      }

      .chat-message:hover {
        background: rgba(139, 115, 85, 0.12);
        border-color: rgba(139, 115, 85, 0.2);
      }

      .chat-message.own-message {
        background: rgba(201, 162, 39, 0.12);
        border-color: rgba(201, 162, 39, 0.2);
      }

      .chat-message-header {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-sm);
        margin-bottom: var(--parchment-spacing-xs);
      }

      .chat-message-author {
        font-weight: bold;
        color: var(--parchment-border-dark);
      }

      .chat-message-author.self {
        color: var(--parchment-gold);
      }

      .chat-message-time {
        font-size: 11px;
        color: var(--parchment-text-muted);
      }

      .chat-message-text {
        color: var(--parchment-text-primary);
        word-wrap: break-word;
        line-height: 1.5;
      }

      .chat-message-reactions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--parchment-spacing-xs);
        margin-top: 6px;
      }

      .chat-reaction {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-xs);
        padding: 2px var(--parchment-spacing-sm);
        background: var(--parchment-highlight);
        border: 1px solid var(--parchment-border);
        border-radius: 12px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .chat-reaction:hover {
        background: rgba(139, 115, 85, 0.2);
        border-color: var(--parchment-border-dark);
      }

      .chat-reaction.user-reacted {
        background: rgba(201, 162, 39, 0.25);
        border-color: var(--parchment-gold);
      }

      .chat-reaction-count {
        color: var(--parchment-text-secondary);
      }

      .add-reaction-btn {
        padding: 2px var(--parchment-spacing-sm);
        background: transparent;
        border: 1px dashed var(--parchment-border);
        border-radius: 12px;
        cursor: pointer;
        color: var(--parchment-text-muted);
        font-size: 12px;
        transition: all 0.2s;
      }

      .add-reaction-btn:hover {
        border-color: var(--parchment-border-dark);
        color: var(--parchment-text-primary);
        background: rgba(139, 115, 85, 0.1);
      }

      .typing-indicator {
        height: 20px;
        padding: 0 var(--parchment-spacing-md);
        font-size: 12px;
        color: var(--parchment-text-muted);
        font-style: italic;
      }

      .chat-input-area {
        display: flex;
        gap: var(--parchment-spacing-sm);
        align-items: flex-end;
        position: relative;
      }

      .chat-input-wrapper {
        flex: 1;
        position: relative;
      }

      .chat-input {
        width: 100%;
        padding: var(--parchment-spacing-md) 40px var(--parchment-spacing-md) var(--parchment-spacing-md);
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, ${P.light}ee 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        color: var(--parchment-text-primary);
        font-family: var(--parchment-font);
        font-size: 14px;
        resize: none;
        min-height: 44px;
        max-height: 120px;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
      }

      .chat-input::placeholder {
        color: var(--parchment-text-muted);
      }

      .chat-input:focus {
        outline: none;
        border-color: var(--parchment-gold);
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.1), 0 0 0 2px rgba(201, 162, 39, 0.2);
      }

      .emoji-btn {
        position: absolute;
        right: var(--parchment-spacing-sm);
        bottom: 10px;
        background: transparent;
        border: none;
        font-size: 20px;
        cursor: pointer;
        opacity: 0.6;
        transition: opacity 0.2s;
      }

      .emoji-btn:hover {
        opacity: 1;
      }

      .emoji-picker {
        position: absolute;
        bottom: 100%;
        right: 0;
        margin-bottom: var(--parchment-spacing-sm);
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        padding: var(--parchment-spacing-md);
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: var(--parchment-spacing-xs);
        max-width: 300px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        z-index: 100;
      }

      .emoji-picker-btn {
        width: 32px;
        height: 32px;
        background: transparent;
        border: none;
        border-radius: var(--parchment-radius-md);
        font-size: 20px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .emoji-picker-btn:hover {
        background: rgba(139, 115, 85, 0.2);
      }

      .send-btn {
        padding: var(--parchment-spacing-md) var(--parchment-spacing-xxl);
        font-weight: bold;
        background: linear-gradient(to bottom, var(--parchment-border) 0%, var(--parchment-border-dark) 100%);
        color: var(--parchment-text-inverse);
        border: 2px solid var(--parchment-border-dark);
        border-radius: var(--parchment-radius-lg);
        font-family: var(--parchment-font);
        font-size: 14px;
        cursor: pointer;
        transition: all 0.15s;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
      }

      .send-btn:hover {
        background: linear-gradient(to bottom, var(--parchment-border-light) 0%, var(--parchment-border) 100%);
      }

      .send-btn:active {
        transform: translateY(1px);
      }

      .sidebar {
        width: 280px;
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border-left: 2px solid var(--parchment-border);
        display: flex;
        flex-direction: column;
      }

      .sidebar-section {
        padding: var(--parchment-spacing-lg);
        border-bottom: 2px solid var(--parchment-border);
      }

      .sidebar-header {
        font-weight: bold;
        color: var(--parchment-gold);
        margin-bottom: var(--parchment-spacing-md);
        display: flex;
        justify-content: space-between;
        align-items: center;
        text-shadow: 0 1px 0 var(--parchment-highlight);
      }

      .online-count {
        font-size: 12px;
        color: var(--parchment-text-secondary);
        font-weight: normal;
        background: rgba(139, 115, 85, 0.2);
        padding: 2px var(--parchment-spacing-sm);
        border-radius: 10px;
      }

      .player-list {
        overflow-y: auto;
        flex: 1;
      }

      .player-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
        border-radius: var(--parchment-radius-lg);
        cursor: pointer;
        transition: all 0.2s;
        border: 1px solid transparent;
      }

      .player-item:hover {
        background: rgba(139, 115, 85, 0.15);
        border-color: rgba(139, 115, 85, 0.2);
      }

      .player-item.active {
        background: rgba(201, 162, 39, 0.2);
        border-color: var(--parchment-gold);
      }

      .player-status {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
        border: 1px solid rgba(0,0,0,0.2);
      }

      .status-online { background: ${P.state.success}; }
      .status-away { background: ${P.state.warning}; }
      .status-busy { background: ${P.state.error}; }
      .status-offline { background: var(--parchment-text-muted); }

      .player-name {
        color: var(--parchment-text-primary);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .player-name.self {
        color: var(--parchment-gold);
        font-weight: bold;
      }

      .dm-btn {
        padding: var(--parchment-spacing-xs) 10px;
        font-size: 11px;
        opacity: 0;
        transition: all 0.2s;
        background: linear-gradient(to bottom, var(--parchment-border) 0%, var(--parchment-border-dark) 100%);
        color: var(--parchment-text-inverse);
        border: 1px solid var(--parchment-border-dark);
        border-radius: var(--parchment-radius-md);
        cursor: pointer;
      }

      .player-item:hover .dm-btn {
        opacity: 1;
      }

      .dm-btn:hover {
        background: linear-gradient(to bottom, var(--parchment-border-light) 0%, var(--parchment-border) 100%);
      }

      .dm-list {
        max-height: 200px;
        overflow-y: auto;
      }

      .dm-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px var(--parchment-spacing-md);
        border-radius: var(--parchment-radius-lg);
        cursor: pointer;
        transition: all 0.2s;
        border: 1px solid transparent;
        border-bottom: 1px solid rgba(139, 115, 85, 0.2);
      }

      .dm-item:hover {
        background: rgba(139, 115, 85, 0.15);
      }

      .dm-item.active {
        background: rgba(201, 162, 39, 0.2);
        border-color: var(--parchment-gold);
      }

      .dm-item-info {
        flex: 1;
        min-width: 0;
      }

      .dm-item-name {
        font-weight: bold;
        color: var(--parchment-text-primary);
      }

      .dm-item-preview {
        font-size: 12px;
        color: var(--parchment-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dm-item-time {
        font-size: 11px;
        color: var(--parchment-text-muted);
      }

      .load-more-btn {
        width: 100%;
        padding: var(--parchment-spacing-sm);
        background: transparent;
        border: 1px dashed var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        color: var(--parchment-text-secondary);
        cursor: pointer;
        margin-bottom: var(--parchment-spacing-sm);
        transition: all 0.2s;
        font-family: var(--parchment-font);
      }

      .load-more-btn:hover {
        border-color: var(--parchment-border-dark);
        background: rgba(139, 115, 85, 0.1);
        color: var(--parchment-text-primary);
      }

      .empty-state {
        text-align: center;
        color: var(--parchment-text-secondary);
        padding: 40px 20px;
      }

      .empty-state-icon {
        font-size: 48px;
        margin-bottom: var(--parchment-spacing-md);
        opacity: 0.5;
      }

      .system-message {
        text-align: center;
        color: var(--parchment-text-secondary);
        font-style: italic;
        padding: var(--parchment-spacing-sm);
        font-size: 12px;
      }

      /* Presence select styling */
      .presence-select {
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, ${P.light}ee 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        color: var(--parchment-text-primary);
        font-family: var(--parchment-font);
        font-size: 13px;
        cursor: pointer;
      }

      .presence-select:focus {
        outline: none;
        border-color: var(--parchment-gold);
      }

      /* Back button styling */
      .tavern-back-btn {
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-lg);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        color: var(--parchment-text-primary);
        font-family: var(--parchment-font);
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.15s;
      }

      .tavern-back-btn:hover {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
      }

      .tavern-back-btn:active {
        transform: translateY(1px);
      }

      /* ============================================
         Responsive Layout - Mobile
         ============================================ */
      @media (max-width: 768px) {
        .tavern-content {
          flex-direction: column;
        }

        .sidebar {
          width: 100%;
          border-left: none;
          border-top: 2px solid var(--parchment-border);
          max-height: 200px;
        }

        .tavern-header {
          padding: var(--parchment-spacing-md) var(--parchment-spacing-lg);
          flex-wrap: wrap;
          gap: var(--parchment-spacing-md);
        }

        .tavern-tabs {
          padding: var(--parchment-spacing-sm) var(--parchment-spacing-md) 0;
          overflow-x: auto;
        }

        .tavern-tab {
          padding: var(--parchment-spacing-sm) 14px;
          font-size: 13px;
          white-space: nowrap;
        }

        .chat-panel {
          padding: var(--parchment-spacing-md);
        }

        .chat-messages {
          padding: var(--parchment-spacing-sm);
        }
      }

      /* ============================================
         Responsive Layout - Tablet
         ============================================ */
      @media (min-width: 769px) and (max-width: 1024px) {
        .sidebar {
          width: 240px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'tavern-container';

    const userId = this.game.state.get('user')?.id;
    const username = this.game.state.get('user')?.username;

    container.innerHTML = `
      <div class="tavern-header">
        <div class="tavern-title">
          <span class="tavern-title-icon">&#127866;</span>
          <h2>The Tavern</h2>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <select id="presence-select" class="presence-select">
            <option value="online">Online</option>
            <option value="away">Away</option>
            <option value="busy">Busy</option>
          </select>
          <button class="tavern-back-btn" id="back-btn">Back to Map</button>
        </div>
      </div>

      <div class="tavern-content">
        <div class="tavern-main">
          <div class="tavern-tabs">
            <div class="tavern-tab active" data-tab="global">
              &#127758; Global
            </div>
            <div class="tavern-tab" data-tab="party">
              &#128101; Party
            </div>
            <div class="tavern-tab" data-tab="dm">
              &#128172; Messages
              <span class="tab-badge" id="dm-badge" style="display: none;">0</span>
            </div>
          </div>

          <div class="chat-panel">
            <div class="chat-messages" id="chat-messages">
              <div class="empty-state">
                <div class="empty-state-icon">&#128172;</div>
                <div>Loading messages...</div>
              </div>
            </div>

            <div class="typing-indicator" id="typing-indicator"></div>

            <div class="chat-input-area">
              <div class="chat-input-wrapper">
                <textarea
                  class="chat-input"
                  id="chat-input"
                  placeholder="Type a message..."
                  rows="1"
                ></textarea>
                <button class="emoji-btn" id="emoji-btn">&#128512;</button>
                <div class="emoji-picker" id="emoji-picker" style="display: none;">
                  ${this.commonEmojis.map(code => `
                    <button class="emoji-picker-btn" data-emoji="&#${code};">&#${code};</button>
                  `).join('')}
                </div>
              </div>
              <button class="send-btn" id="send-btn">Send</button>
            </div>
          </div>
        </div>

        <div class="sidebar">
          <div class="sidebar-section">
            <div class="sidebar-header">
              Online Players
              <span class="online-count" id="online-count">0</span>
            </div>
            <div class="player-list" id="player-list">
              <div class="empty-state" style="padding: 20px;">Loading...</div>
            </div>
          </div>

          <div class="sidebar-section" id="dm-section" style="display: none;">
            <div class="sidebar-header">Recent Conversations</div>
            <div class="dm-list" id="dm-list"></div>
          </div>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Back button
    this.uiElement.querySelector('#back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Tab switching
    this.uiElement.querySelectorAll('.tavern-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      }, opts);
    });

    // Chat input
    const chatInput = this.uiElement.querySelector('#chat-input');
    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    }, opts);

    chatInput?.addEventListener('input', () => {
      this.handleTyping();
      this.autoResizeInput(chatInput);
    }, opts);

    // Send button
    this.uiElement.querySelector('#send-btn')?.addEventListener('click', () => {
      this.sendMessage();
    }, opts);

    // Emoji picker
    this.uiElement.querySelector('#emoji-btn')?.addEventListener('click', () => {
      this.toggleEmojiPicker();
    }, opts);

    this.uiElement.querySelectorAll('.emoji-picker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.insertEmoji(btn.dataset.emoji);
      }, opts);
    });

    // Close emoji picker on outside click
    document.addEventListener('click', (e) => {
      const picker = this.uiElement?.querySelector('#emoji-picker');
      const btn = this.uiElement?.querySelector('#emoji-btn');
      if (picker && !picker.contains(e.target) && !btn?.contains(e.target)) {
        picker.style.display = 'none';
      }
    }, opts);

    // Presence selector
    this.uiElement.querySelector('#presence-select')?.addEventListener('change', (e) => {
      this.updatePresence(e.target.value);
    }, opts);

    // Scroll to load more
    const messagesEl = this.uiElement.querySelector('#chat-messages');
    messagesEl?.addEventListener('scroll', () => {
      if (messagesEl.scrollTop === 0 && this.hasMoreMessages && !this.loadingMessages) {
        this.loadMoreMessages();
      }
    }, opts);
  }

  setupWebSocketHandlers() {
    const handlers = {
      'chat_message': (payload) => {
        if (this.activeTab === 'global' && payload.room === 'global') {
          this.addMessage({
            id: Date.now(),
            senderUserId: payload.userId,
            senderUsername: payload.username,
            message: payload.message,
            createdAt: new Date(payload.timestamp),
            reactions: []
          });
        }
      },

      'private_message_received': (payload) => {
        if (this.activeTab === 'dm' && this.activeDMUser?.userId === payload.senderId) {
          this.addMessage({
            id: payload.id,
            senderUserId: payload.senderId,
            senderUsername: payload.senderUsername,
            message: payload.message,
            createdAt: new Date(payload.timestamp),
            reactions: []
          });
        }
        // Update badge
        this.updateDMBadge();
      },

      'private_message_sent': (payload) => {
        // Message already added locally
      },

      'presence_changed': (payload) => {
        this.updatePlayerPresence(payload.userId, payload.status, payload.username);
      },

      'user_typing': (payload) => {
        if (payload.userId !== this.game.state.get('user')?.id) {
          this.showTypingIndicator(payload.room, payload.username, payload.isTyping);
        }
      },

      'reaction_added': (payload) => {
        this.updateMessageReactions(payload.messageId, payload.reactions);
      },

      'reaction_removed': (payload) => {
        this.updateMessageReactions(payload.messageId, payload.reactions);
      },

      'user_joined': (payload) => {
        if (payload.room === 'tavern' || payload.room === 'global') {
          this.loadOnlinePlayers();
        }
      },

      'user_left': (payload) => {
        if (payload.room === 'tavern' || payload.room === 'global') {
          this.loadOnlinePlayers();
        }
      }
    };

    // Register handlers
    Object.entries(handlers).forEach(([type, handler]) => {
      this.wsHandlers[type] = handler;
      this.game.socket.on(type, handler);
    });
  }

  async loadChatHistory() {
    try {
      let messages;

      if (this.activeTab === 'dm' && this.activeDMUser) {
        const result = await this.game.api.getDMHistory(this.activeDMUser.userId);
        messages = result.messages;
      } else {
        const roomType = this.activeTab === 'party' ? 'party' : 'global';
        const result = await this.game.api.getChatHistory(roomType);
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
      } else {
        const roomType = this.activeTab === 'party' ? 'party' : 'global';
        result = await this.game.api.getChatHistory(roomType, {
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

  async loadOnlinePlayers() {
    try {
      const result = await this.game.api.getOnlinePlayers();
      this.onlinePlayers = result.players || [];
      this.renderPlayerList();
    } catch (err) {
      console.error('Failed to load online players:', err);
      this.onlinePlayers = [];
      this.renderPlayerList();
    }
  }

  async loadDMConversations() {
    try {
      const result = await this.game.api.getDMConversations();
      this.dmConversations = result.conversations || [];
      this.renderDMList();
    } catch (err) {
      console.error('Failed to load DM conversations:', err);
    }
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.messages = [];
    this.hasMoreMessages = true;

    // Update tab UI
    this.uiElement.querySelectorAll('.tavern-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    // Show/hide DM section
    const dmSection = this.uiElement.querySelector('#dm-section');
    if (dmSection) {
      dmSection.style.display = tab === 'dm' ? 'block' : 'none';
    }

    // Reset active DM if switching away
    if (tab !== 'dm') {
      this.activeDMUser = null;
    }

    // Update placeholder
    const input = this.uiElement.querySelector('#chat-input');
    if (input) {
      if (tab === 'dm' && this.activeDMUser) {
        input.placeholder = `Message ${this.activeDMUser.username}...`;
      } else if (tab === 'party') {
        input.placeholder = 'Message your party...';
      } else {
        input.placeholder = 'Type a message...';
      }
    }

    this.loadChatHistory();
  }

  renderMessages(preserveScroll = false) {
    const container = this.uiElement.querySelector('#chat-messages');
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

    const userId = this.game.state.get('user')?.id;

    let html = '';

    if (this.hasMoreMessages) {
      html += '<button class="load-more-btn" id="load-more-btn">Load older messages</button>';
    }

    html += this.messages.map(msg => this.renderMessage(msg, userId)).join('');

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

  renderMessage(msg, currentUserId) {
    const isSelf = msg.senderUserId === currentUserId;
    const time = this.formatTime(msg.createdAt || msg.created_at);
    const reactions = msg.reactions || [];

    let reactionsHtml = '';
    if (reactions.length > 0) {
      reactionsHtml = `
        <div class="chat-message-reactions">
          ${reactions.map(r => `
            <button class="chat-reaction ${r.userIds?.includes(currentUserId) ? 'user-reacted' : ''}"
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
      <div class="chat-message" data-message-id="${msg.id}">
        <div class="chat-message-header">
          <span class="chat-message-author ${isSelf ? 'self' : ''}">${msg.senderUsername || msg.sender_username}</span>
          <span class="chat-message-time">${time}</span>
        </div>
        <div class="chat-message-text">${this.escapeHtml(msg.message)}</div>
        ${reactionsHtml}
      </div>
    `;
  }

  renderPlayerList() {
    const container = this.uiElement.querySelector('#player-list');
    const countEl = this.uiElement.querySelector('#online-count');
    if (!container) return;

    const userId = this.game.state.get('user')?.id;

    if (countEl) {
      countEl.textContent = this.onlinePlayers.length;
    }

    if (this.onlinePlayers.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          No players online
        </div>
      `;
      return;
    }

    container.innerHTML = this.onlinePlayers.map(player => `
      <div class="player-item ${player.userId === userId ? 'self' : ''}" data-user-id="${player.userId}">
        <div class="player-status status-${player.status || 'online'}"></div>
        <span class="player-name ${player.userId === userId ? 'self' : ''}">${player.username}</span>
        ${player.userId !== userId ? `
          <button class="btn btn-secondary dm-btn" data-user-id="${player.userId}" data-username="${player.username}">
            DM
          </button>
        ` : ''}
      </div>
    `).join('');

    // Add DM button handlers
    container.querySelectorAll('.dm-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startDM(parseInt(btn.dataset.userId), btn.dataset.username);
      });
    });
  }

  renderDMList() {
    const container = this.uiElement.querySelector('#dm-list');
    if (!container) return;

    if (this.dmConversations.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          No conversations yet
        </div>
      `;
      return;
    }

    container.innerHTML = this.dmConversations.map(conv => `
      <div class="dm-item ${this.activeDMUser?.userId === conv.other_user_id ? 'active' : ''}"
           data-user-id="${conv.other_user_id}"
           data-username="${conv.other_username}">
        <div class="dm-item-info">
          <div class="dm-item-name">${conv.other_username}</div>
          <div class="dm-item-preview">${this.escapeHtml(conv.last_message || '')}</div>
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

  startDM(userId, username) {
    this.activeDMUser = { userId, username };
    this.switchTab('dm');
    this.renderDMList();

    const input = this.uiElement.querySelector('#chat-input');
    if (input) {
      input.placeholder = `Message ${username}...`;
      input.focus();
    }
  }

  addMessage(msg) {
    this.messages.push(msg);
    this.renderMessages();
    this.scrollToBottom();
  }

  async sendMessage() {
    const input = this.uiElement.querySelector('#chat-input');
    const message = input?.value.trim();

    if (!message) return;

    input.value = '';
    this.autoResizeInput(input);

    // Stop typing indicator
    this.stopTyping();

    const userId = this.game.state.get('user')?.id;
    const username = this.game.state.get('user')?.username;

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
        senderUserId: userId,
        senderUsername: username,
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

  showTypingIndicator(room, username, isTyping) {
    const indicator = this.uiElement.querySelector('#typing-indicator');
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

  toggleEmojiPicker() {
    const picker = this.uiElement.querySelector('#emoji-picker');
    if (picker) {
      picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    }
  }

  insertEmoji(emoji) {
    const input = this.uiElement.querySelector('#chat-input');
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

  showReactionPicker(messageId) {
    // For simplicity, just add a thumbs up
    this.toggleReaction(messageId, String.fromCodePoint(128077));
  }

  async toggleReaction(messageId, emoji) {
    const room = this.activeTab === 'dm' ? `dm:${this.activeDMUser?.userId}` : this.activeTab;

    // Check if user already reacted
    const msg = this.messages.find(m => m.id === messageId);
    const userId = this.game.state.get('user')?.id;
    const existingReaction = msg?.reactions?.find(r => r.emoji === emoji && r.userIds?.includes(userId));

    if (existingReaction) {
      this.game.socket.send('remove_reaction', { messageId, emoji, room });
    } else {
      this.game.socket.send('add_reaction', { messageId, emoji, room });
    }
  }

  updateMessageReactions(messageId, reactions) {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) {
      msg.reactions = reactions;
      this.renderMessages();
    }
  }

  updatePlayerPresence(userId, status, username) {
    const existingIndex = this.onlinePlayers.findIndex(p => p.userId === userId);

    if (status === 'offline') {
      if (existingIndex !== -1) {
        this.onlinePlayers.splice(existingIndex, 1);
      }
    } else {
      if (existingIndex !== -1) {
        this.onlinePlayers[existingIndex].status = status;
      } else {
        this.onlinePlayers.push({ userId, username, status });
      }
    }

    this.renderPlayerList();
  }

  async updatePresence(status) {
    try {
      await this.game.api.updatePresence(status);
      this.game.socket.send('presence_update', { status });
    } catch (err) {
      console.error('Failed to update presence:', err);
    }
  }

  updateDMBadge() {
    // Placeholder - would track unread messages
    const badge = this.uiElement.querySelector('#dm-badge');
    if (badge) {
      // badge.style.display = count > 0 ? 'inline' : 'none';
      // badge.textContent = count;
    }
  }

  autoResizeInput(input) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  scrollToBottom() {
    const container = this.uiElement.querySelector('#chat-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  update(deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based, canvas shows parchment background
    ctx.fillStyle = P.light;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  /**
   * Handle responsive breakpoint changes
   * @param {string} newBreakpoint - 'mobile', 'tablet', or 'desktop'
   * @param {string} oldBreakpoint - Previous breakpoint
   */
  onBreakpointChange(newBreakpoint, oldBreakpoint) {
    // Rebuild UI for new layout if needed
    if (!this.uiElement) return;

    // On mobile, sidebar moves to bottom
    const sidebar = this.uiElement.querySelector('.sidebar');
    const content = this.uiElement.querySelector('.tavern-content');

    if (newBreakpoint === 'mobile') {
      // Mobile layout: sidebar at bottom
      if (sidebar && content) {
        content.style.flexDirection = 'column';
      }
    } else {
      // Desktop/tablet: sidebar on right
      if (sidebar && content) {
        content.style.flexDirection = 'row';
      }
    }
  }
}
