/**
 * @module TavernScene
 * @description Social hub scene for chat, online players, and direct messages.
 *
 * Key responsibilities:
 * - UI creation and layout management
 * - Tab switching (global, party, DM)
 * - Online player list management
 * - Presence status updates
 * - WebSocket event coordination
 *
 * @see TavernChatManager.js - Chat message handling
 * @see TavernDMSystem.js - Direct messaging subsystem
 */

import { Scene } from './Scene.js';
import { responsive } from '../core/Responsive.js';
import { PARCHMENT_COLORS, injectParchmentTheme, getParchmentScrollbarCSS } from '../ui/parchment/index.js';
import { TavernChatManager } from '../tavern/TavernChatManager.js';
import { TavernDMSystem } from '../tavern/TavernDMSystem.js';
import { escapeHtml } from '../utils/escapeHtml.js';

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
    this.responsiveUnsubscribe = null;

    // Tab state
    this.activeTab = 'global'; // 'global', 'party', 'dm'
    this.onlinePlayers = [];

    // Subsystems
    this.chatManager = new TavernChatManager(this);
    this.dmSystem = new TavernDMSystem(this);

    // WebSocket handlers
    this.wsHandlers = {};
  }

  /**
   * Get active DM user (delegated to DM system)
   * @returns {{userId: number, username: string}|null}
   */
  get activeDMUser() {
    return this.dmSystem.getActiveDMUser();
  }

  async enter(_data = {}) {
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    // Join tavern room
    this.game.socket.joinRoom('tavern');
    this.game.socket.joinRoom('global');

    // Subscribe to responsive breakpoint changes
    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Play regional tavern music and ambient sounds
    if (this.game.musicContext) {
      this.game.musicContext.playNodeMusic('tavern');
    }
    this.game.audio?.playAmbient('tavern_chatter');

    // Load initial data
    await Promise.all([
      this.chatManager.loadChatHistory(),
      this.loadOnlinePlayers(),
      this.dmSystem.loadConversations()
    ]);
  }

  exit() {
    // Leave rooms
    this.game.socket.leaveRoom('tavern');
    this.game.socket.leaveRoom('global');

    // Stop ambient sounds
    this.game.audio?.stopAmbient();

    // Remove WebSocket handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.off(type, handler);
    });
    this.wsHandlers = {};

    // Unsubscribe from responsive changes
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }

    // Clean up subsystems
    this.chatManager.destroy();
    this.dmSystem.destroy();

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
        color: var(--parchment-burgundy);
        text-shadow: 0 1px 0 var(--parchment-highlight);
        font-size: var(--font-size-lg, 18px);
      }

      .tavern-title-icon {
        font-size: var(--font-size-lg, 18px);
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
        padding: var(--space-sm, 8px) var(--space-lg, 16px);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 2px solid var(--parchment-border);
        border-bottom: none;
        border-radius: var(--parchment-radius-lg) var(--parchment-radius-lg) 0 0;
        color: var(--parchment-text-secondary);
        cursor: pointer;
        transition: all 0.2s;
        font-family: var(--parchment-font);
        font-size: var(--font-size-md, 14px);
        font-weight: bold;
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-sm);
        margin-bottom: -2px;
        min-height: var(--touch-target, 36px);
      }

      .tavern-tab:hover:not(.active) {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        color: var(--parchment-text-primary);
      }

      .tavern-tab.active {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        color: var(--parchment-text-primary);
        border-color: var(--parchment-border);
      }

      .tab-badge {
        background: ${P.copper};
        color: var(--parchment-text-inverse);
        font-size: var(--font-size-sm, 12px);
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
        color: var(--parchment-burgundy);
      }

      .chat-message-time {
        font-size: var(--font-size-sm, 12px);
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
        font-size: var(--font-size-sm, 12px);
        cursor: pointer;
        transition: all 0.2s;
        min-height: var(--touch-target, 36px);
      }

      .chat-reaction:hover {
        background: rgba(139, 115, 85, 0.2);
        border-color: var(--parchment-border-dark);
      }

      .chat-reaction.user-reacted {
        background: rgba(201, 162, 39, 0.25);
        border-color: var(--parchment-burgundy);
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
        font-size: var(--font-size-sm, 12px);
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
        font-size: var(--font-size-md, 14px);
        resize: none;
        min-height: var(--touch-target, 44px);
        max-height: 120px;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
      }

      .chat-input::placeholder {
        color: var(--parchment-text-muted);
      }

      .chat-input:focus {
        outline: none;
        border-color: var(--parchment-burgundy);
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
        font-size: var(--font-size-md, 14px);
        cursor: pointer;
        transition: all 0.15s;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
        min-height: var(--button-height, 36px);
      }

      .send-btn:hover {
        background: linear-gradient(to bottom, var(--parchment-border-light) 0%, var(--parchment-border) 100%);
      }

      .send-btn:active {
        transform: translateY(1px);
      }

      .sidebar {
        width: 280px;
        min-width: 200px;
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
        color: var(--parchment-text-primary);
        margin-bottom: var(--parchment-spacing-md);
        display: flex;
        justify-content: space-between;
        align-items: center;
        text-shadow: 0 1px 0 var(--parchment-highlight);
      }

      .online-count {
        font-size: var(--font-size-sm, 12px);
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
        min-height: var(--touch-target, 36px);
      }

      .player-item:hover {
        background: rgba(139, 115, 85, 0.15);
        border-color: rgba(139, 115, 85, 0.2);
      }

      .player-item.active {
        background: rgba(201, 162, 39, 0.2);
        border-color: var(--parchment-burgundy);
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
        color: var(--parchment-border-dark);
        font-weight: bold;
      }

      .dm-btn {
        padding: var(--parchment-spacing-xs) 10px;
        font-size: var(--font-size-sm, 12px);
        opacity: 0;
        transition: all 0.2s;
        background: linear-gradient(to bottom, var(--parchment-border) 0%, var(--parchment-border-dark) 100%);
        color: var(--parchment-text-inverse);
        border: 1px solid var(--parchment-border-dark);
        border-radius: var(--parchment-radius-md);
        cursor: pointer;
        min-height: var(--touch-target, 36px);
        min-width: var(--touch-target, 36px);
      }

      .player-item:hover .dm-btn,
      .player-item .dm-btn.touch-visible {
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
        padding: var(--space-sm, 8px) var(--parchment-spacing-md);
        border-radius: var(--parchment-radius-lg);
        cursor: pointer;
        transition: all 0.2s;
        border: 1px solid transparent;
        border-bottom: 1px solid rgba(139, 115, 85, 0.2);
        min-height: var(--touch-target, 36px);
      }

      .dm-item:hover {
        background: rgba(139, 115, 85, 0.15);
      }

      .dm-item.active {
        background: rgba(201, 162, 39, 0.2);
        border-color: var(--parchment-burgundy);
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
        font-size: var(--font-size-sm, 12px);
        color: var(--parchment-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dm-item-time {
        font-size: var(--font-size-sm, 12px);
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
        font-size: var(--font-size-md, 14px);
        cursor: pointer;
        min-height: var(--touch-target, 36px);
      }

      .presence-select:focus {
        outline: none;
        border-color: var(--parchment-burgundy);
      }

      /* Back button styling */
      .tavern-back-btn {
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-lg);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        color: var(--parchment-text-primary);
        font-family: var(--parchment-font);
        font-size: var(--font-size-md, 14px);
        font-weight: bold;
        cursor: pointer;
        transition: all 0.15s;
        min-height: var(--button-height, 36px);
      }

      .tavern-back-btn:hover {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
      }

      .tavern-back-btn:active {
        transform: translateY(1px);
      }

      /* ============================================
         Responsive Layout - Mobile (<600px)
         Matches responsive singleton breakpoint
         ============================================ */
      @media (max-width: 599px) {
        .tavern-content {
          flex-direction: column;
        }

        .sidebar {
          width: 100%;
          border-left: none;
          border-top: 2px solid var(--parchment-border);
          max-height: 180px;
          order: 2;
        }

        .tavern-main {
          order: 1;
        }

        .tavern-header {
          padding: var(--space-sm, 8px) var(--space-md, 12px);
          flex-wrap: wrap;
          gap: var(--space-sm, 8px);
        }

        .tavern-title h2 {
          font-size: var(--font-size-md, 14px);
        }

        .tavern-tabs {
          padding: var(--space-xs, 4px) var(--space-sm, 8px) 0;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .tavern-tab {
          padding: var(--space-xs, 4px) var(--space-sm, 8px);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .chat-panel {
          padding: var(--space-sm, 8px);
        }

        .chat-messages {
          padding: var(--space-xs, 4px);
        }

        .chat-input-area {
          flex-direction: column;
          gap: var(--space-sm, 8px);
        }

        .send-btn {
          width: 100%;
        }

        /* Always show DM button on touch devices */
        .dm-btn {
          opacity: 1;
        }

        .player-list {
          max-height: 120px;
        }

        .emoji-picker {
          max-width: 280px;
          grid-template-columns: repeat(6, 1fr);
        }
      }

      /* ============================================
         Responsive Layout - Tablet (600-899px)
         ============================================ */
      @media (min-width: 600px) and (max-width: 899px) {
        .sidebar {
          width: 220px;
        }

        .tavern-header {
          padding: var(--space-md, 12px) var(--space-lg, 16px);
        }
      }

      /* ============================================
         Themed Scrollbars
         ============================================ */
      ${getParchmentScrollbarCSS('.chat-messages')}
      ${getParchmentScrollbarCSS('.player-list')}
      ${getParchmentScrollbarCSS('.dm-list')}
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'tavern-container';

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
                  ${this.chatManager.commonEmojis.map(code => `
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
      this.game.audio?.playUI('button_click');
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
        this.chatManager.sendMessage();
      }
    }, opts);

    chatInput?.addEventListener('input', () => {
      this.chatManager.handleTyping();
      this.chatManager.autoResizeInput(chatInput);
    }, opts);

    // Send button
    this.uiElement.querySelector('#send-btn')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.chatManager.sendMessage();
    }, opts);

    // Emoji picker
    this.uiElement.querySelector('#emoji-btn')?.addEventListener('click', () => {
      this.chatManager.toggleEmojiPicker();
    }, opts);

    this.uiElement.querySelectorAll('.emoji-picker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.chatManager.insertEmoji(btn.dataset.emoji);
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
      if (messagesEl.scrollTop === 0 && this.chatManager.hasMoreMessages && !this.chatManager.loadingMessages) {
        this.chatManager.loadMoreMessages();
      }
    }, opts);
  }

  setupWebSocketHandlers() {
    const handlers = {
      'chat_message': (payload) => {
        if (this.activeTab === 'global' && payload.room === 'global') {
          this.chatManager.addMessage({
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
        this.dmSystem.handleIncomingDM(payload);
      },

      'private_message_sent': (_payload) => {
        // Message already added locally
      },

      'presence_changed': (payload) => {
        this.updatePlayerPresence(payload.userId, payload.status, payload.username);
      },

      'user_typing': (payload) => {
        if (payload.userId !== this.game.state.get('user')?.id) {
          this.chatManager.showTypingIndicator(payload.room, payload.username, payload.isTyping);
        }
      },

      'reaction_added': (payload) => {
        this.chatManager.updateMessageReactions(payload.messageId, payload.reactions);
      },

      'reaction_removed': (payload) => {
        this.chatManager.updateMessageReactions(payload.messageId, payload.reactions);
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

  switchTab(tab) {
    this.activeTab = tab;
    this.chatManager.resetState();

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
      this.dmSystem.resetActiveDM();
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

    this.chatManager.loadChatHistory();
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
        <span class="player-name ${player.userId === userId ? 'self' : ''}">${escapeHtml(player.username || '')}</span>
        ${player.userId !== userId ? `
          <button class="btn btn-secondary dm-btn" data-user-id="${player.userId}" data-username="${escapeHtml(player.username || '')}"
            DM
          </button>
        ` : ''}
      </div>
    `).join('');

    // Add DM button handlers
    container.querySelectorAll('.dm-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dmSystem.startDM(parseInt(btn.dataset.userId), btn.dataset.username);
      });
    });
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

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based, canvas shows parchment background
    ctx.fillStyle = P.light;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);
  }

  /**
   * Handle responsive breakpoint changes
   * Called when viewport crosses breakpoint thresholds
   */
  onBreakpointChange() {
    // CSS media queries handle layout changes automatically
    // This method exists for any JS-driven adjustments needed
    if (!this.uiElement) return;

    const isMobile = responsive.isMobile();

    // On touch devices, always show DM buttons (no hover state)
    if (responsive.hasTouch() || isMobile) {
      this.uiElement.querySelectorAll('.dm-btn').forEach(btn => {
        btn.classList.add('touch-visible');
      });
    } else {
      this.uiElement.querySelectorAll('.dm-btn').forEach(btn => {
        btn.classList.remove('touch-visible');
      });
    }
  }
}
