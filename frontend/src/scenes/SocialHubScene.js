import { Scene } from './Scene.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentButtonCSS,
  getParchmentPanelCSS
} from '../ui/parchment/index.js';
import { FriendsTab } from '../social/tabs/FriendsTab.js';
import { RequestsTab } from '../social/tabs/RequestsTab.js';
import { PartyTab } from '../social/tabs/PartyTab.js';
import { LFGTab } from '../social/tabs/LFGTab.js';
import { ClanTab } from '../social/tabs/ClanTab.js';

// Alias for convenient access
const P = PARCHMENT_COLORS;

/**
 * SocialHubScene - Unified social hub for friends, party, requests, LFG, and clan
 *
 * Tab structure:
 * - Friends: Online/offline friends with activity status
 * - Party: Party management and quick formation
 * - Requests: Unified inbox (friend requests + party invites + clan invites)
 * - LFG: Looking for group posts (migrated from CourtyardScene)
 * - Clan: Create/join/manage clans with chat
 */
export class SocialHubScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // Tab state
    this.activeTab = 'friends';
    this.tabs = {
      friends: { label: 'Friends', icon: '👥' },
      party: { label: 'Party', icon: '⚔️' },
      requests: { label: 'Requests', icon: '📬' },
      lfg: { label: 'LFG', icon: '🔍' },
      clan: { label: 'Clan', icon: '🏰' }
    };

    // Tab content containers
    this.tabContents = {};

    // Active tab instances (for cleanup)
    this.tabInstances = {};

    // Data state (populated by tabs)
    this.friends = [];
    this.friendRequests = [];
    this.partyInvites = [];
    this.clanInvites = [];

    // Badge counts for notifications
    this.badges = {
      friends: 0,
      party: 0,
      requests: 0,
      lfg: 0,
      clan: 0
    };

    // WebSocket handlers
    this.wsHandlers = {};
  }

  async enter(data = {}) {
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    // Join the global room for presence updates. The server only broadcasts
    // presence_changed to 'global' (validateRoomAccess in
    // api/src/websocket/roomManager.js rejects a bare 'socialHub' room).
    this.game.socket.joinRoom('global');

    // Play social hub theme music
    if (this.game.musicContext) {
      this.game.musicContext.playSocialHubTheme();
    }

    // Set initial tab from data or default
    const initialTab = data.tab || 'friends';
    await this.switchTab(initialTab);

    // Load badge counts
    await this.loadBadgeCounts();
  }

  exit() {
    // Leave the global presence room joined in enter()
    this.game.socket.leaveRoom('global');

    // Clean up tab instances
    Object.values(this.tabInstances).forEach(tab => {
      if (tab?.destroy) tab.destroy();
    });
    this.tabInstances = {};

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
    if (document.getElementById('social-hub-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'social-hub-scene-styles';
    style.textContent = `
      .social-hub-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
        display: flex;
        flex-direction: column;
      }

      .social-hub-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: ${PARCHMENT_SPACING.lg} ${PARCHMENT_SPACING.xxl};
        background: ${getParchmentGradient('to bottom')};
        border-bottom: ${getParchmentBorder()};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .social-hub-title {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
      }

      .social-hub-title h2 {
        margin: 0;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xxl};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .social-hub-back-btn {
        ${getParchmentButtonCSS('secondary')}
      }

      .social-hub-back-btn:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      /* Tab navigation */
      .social-hub-tabs {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.xxl};
        background: ${getParchmentGradient('to bottom')};
        border-bottom: ${getParchmentBorder()};
      }

      .social-hub-tab {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.xs};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.lg};
        background: transparent;
        border: 2px solid transparent;
        border-radius: ${PARCHMENT_RADIUS.md} ${PARCHMENT_RADIUS.md} 0 0;
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
      }

      .social-hub-tab:hover {
        background: rgba(255, 255, 255, 0.1);
        color: ${P.text.primary};
      }

      .social-hub-tab.active {
        background: ${P.light};
        border-color: ${P.border};
        border-bottom-color: ${P.light};
        color: ${P.text.primary};
        margin-bottom: -2px;
      }

      .social-hub-tab-icon {
        font-size: 16px;
      }

      .social-hub-tab-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        background: ${P.state.error};
        border-radius: 9px;
        color: white;
        font-size: 11px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .social-hub-tab-badge.hidden {
        display: none;
      }

      /* Content area */
      .social-hub-content {
        flex: 1;
        overflow: hidden;
        padding: ${PARCHMENT_SPACING.lg};
        background: rgba(0, 0, 0, 0.2);
      }

      .social-hub-tab-content {
        display: none;
        height: 100%;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        box-shadow: ${getParchmentShadow()};
        overflow: hidden;
      }

      .social-hub-tab-content.active {
        display: flex;
        flex-direction: column;
      }

      /* Tab content panels */
      .social-hub-panel {
        ${getParchmentPanelCSS()}
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .social-hub-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderLight};
      }

      .social-hub-panel-title {
        margin: 0;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      }

      .social-hub-panel-body {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
      }

      /* Loading state */
      .social-hub-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .social-hub-loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid ${P.borderLight};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* Empty state */
      .social-hub-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        text-align: center;
        padding: ${PARCHMENT_SPACING.lg};
      }

      .social-hub-empty-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .social-hub-empty-text {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .social-hub-empty-subtext {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        opacity: 0.7;
      }

      /* Tab mounting state */
      .social-hub-tab-mounting {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      /* Scrollbar styling */
      .social-hub-panel-body::-webkit-scrollbar {
        width: 8px;
      }

      .social-hub-panel-body::-webkit-scrollbar-track {
        background: ${P.mid};
        border-radius: 4px;
      }

      .social-hub-panel-body::-webkit-scrollbar-thumb {
        background: ${P.border};
        border-radius: 4px;
      }

      .social-hub-panel-body::-webkit-scrollbar-thumb:hover {
        background: ${P.borderDark};
      }

      /* Phone widths: the five tabs scroll horizontally instead of being
         pushed off-screen. A scroll container clips overflow, so the badge
         moves inside the tab and the active tab drops its -2px overlap. */
      @media (max-width: 767px) {
        .social-hub-header {
          padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        }

        .social-hub-title h2 {
          font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        }

        .social-hub-tabs {
          flex-wrap: nowrap;
          overflow-x: auto;
          overflow-y: hidden;
          padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md} 0;
          scrollbar-width: thin;
        }

        .social-hub-tab {
          flex: 0 0 auto;
          min-height: 44px;
          padding: 6px 10px;
        }

        .social-hub-tab.active {
          margin-bottom: 0;
        }

        .social-hub-tab-badge {
          top: 2px;
          right: 2px;
        }

        .social-hub-content {
          padding: ${PARCHMENT_SPACING.sm};
        }
      }

      /* Narrow phones: stack a small label under the icon. Icon-only tabs
         were unreadable (touch has no hover title); the row scrolls anyway. */
      @media (max-width: 420px) {
        .social-hub-tab {
          flex-direction: column;
          gap: 0;
          padding: 4px 10px;
        }

        .social-hub-tab-label {
          font-size: 10px;
          line-height: 1.2;
        }
      }
    `;
    document.head.appendChild(style);
  }

  createUI() {
    this.abortController = new AbortController();

    this.uiElement = document.createElement('div');
    this.uiElement.className = 'social-hub-container';
    this.uiElement.innerHTML = `
      <div class="social-hub-header">
        <div class="social-hub-title">
          <span class="social-hub-title-icon">🏠</span>
          <h2>Social Hub</h2>
        </div>
        <button class="social-hub-back-btn" data-action="back">
          ← Back to World
        </button>
      </div>

      <div class="social-hub-tabs">
        ${Object.entries(this.tabs).map(([key, tab]) => `
          <button class="social-hub-tab ${key === this.activeTab ? 'active' : ''}" data-tab="${key}"
                  aria-label="${tab.label}" title="${tab.label}">
            <span class="social-hub-tab-icon" aria-hidden="true">${tab.icon}</span>
            <span class="social-hub-tab-label">${tab.label}</span>
            <span class="social-hub-tab-badge ${this.badges[key] > 0 ? '' : 'hidden'}" data-badge="${key}">
              ${this.badges[key]}
            </span>
          </button>
        `).join('')}
      </div>

      <div class="social-hub-content">
        ${Object.keys(this.tabs).map(key => `
          <div class="social-hub-tab-content ${key === this.activeTab ? 'active' : ''}" data-content="${key}">
            ${this.renderTabContent(key)}
          </div>
        `).join('')}
      </div>
    `;

    this.game.uiOverlay.appendChild(this.uiElement);

    // Store references to tab content containers
    Object.keys(this.tabs).forEach(key => {
      this.tabContents[key] = this.uiElement.querySelector(`[data-content="${key}"]`);
    });
  }

  renderTabContent(_tabKey) {
    // Tab content will be rendered by the tab modules when they mount
    return '<div class="social-hub-tab-mounting"><!-- Tab content will be mounted here --></div>';
  }


  setupEventListeners() {
    const signal = this.abortController.signal;

    // Tab clicks
    this.uiElement.querySelectorAll('.social-hub-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        const tabKey = tab.dataset.tab;
        this.switchTab(tabKey);
      }, { signal });
    });

    // Back button
    this.uiElement.querySelector('[data-action="back"]').addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.game.scenes.switchTo('worldMap');
    }, { signal });
  }

  setupWebSocketHandlers() {
    // Presence updates for friends
    this.wsHandlers['presence_changed'] = (data) => {
      this.handlePresenceChange(data);
    };

    // Friend request received
    this.wsHandlers['notification:new'] = (data) => {
      this.handleNewNotification(data);
    };

    // Party invite received
    this.wsHandlers['party:invite_received'] = (data) => {
      this.handlePartyInvite(data);
    };

    // Register all handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.on(type, handler);
    });
  }

  handlePresenceChange(data) {
    // Update friend status in list if FriendsTab is active
    if (this.activeTab === 'friends' && this.tabInstances.friends) {
      this.tabInstances.friends.handlePresenceUpdate?.(data);
    }
  }

  handleNewNotification(data) {
    // Update badge counts
    if (data.type === 'friend_request') {
      this.badges.requests++;
      this.updateBadge('requests');
    }
  }

  handlePartyInvite(_data) {
    // Update party invites badge
    this.badges.requests++;
    this.updateBadge('requests');
  }

  async switchTab(tabKey) {
    if (!this.tabs[tabKey]) return;

    // Clean up previous tab instance if it exists
    if (this.tabInstances[this.activeTab]?.destroy) {
      this.tabInstances[this.activeTab].destroy();
      delete this.tabInstances[this.activeTab];
    }

    // Update active state
    this.activeTab = tabKey;

    // Update tab buttons
    this.uiElement.querySelectorAll('.social-hub-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabKey);
    });

    // Update content visibility
    Object.entries(this.tabContents).forEach(([key, content]) => {
      content.classList.toggle('active', key === tabKey);
    });

    // Initialize tab component
    await this.initializeTab(tabKey);
  }

  async initializeTab(tabKey) {
    const container = this.tabContents[tabKey];
    if (!container || this.tabInstances[tabKey]) return;

    // Map of tab keys to their respective classes
    const tabClasses = {
      friends: FriendsTab,
      party: PartyTab,
      requests: RequestsTab,
      lfg: LFGTab,
      clan: ClanTab
    };

    const TabClass = tabClasses[tabKey];
    if (!TabClass) return;

    try {
      // Create tab instance
      this.tabInstances[tabKey] = new TabClass({
        container,
        game: this.game,
        onBadgeUpdate: (count) => {
          this.badges[tabKey] = count;
          this.updateBadge(tabKey);
        }
      });

      // Initialize the tab
      await this.tabInstances[tabKey].init();
    } catch (error) {
      console.error(`Failed to initialize ${tabKey} tab:`, error);
      // Clean up failed instance
      delete this.tabInstances[tabKey];
    }
  }

  async loadBadgeCounts() {
    try {
      // Load friend requests count
      const friendRequests = await this.game.api.getFriendRequests();
      if (friendRequests.success) {
        this.friendRequests = friendRequests.requests;
      }

      // Load party invites count
      const partyInvites = await this.game.api.getPartyInvites();
      if (partyInvites.success) {
        this.partyInvites = partyInvites.invites || [];
      }

      // Load clan invites count
      const clanInvites = await this.game.api.getClanInvites();
      if (clanInvites.success) {
        this.clanInvites = clanInvites.invites || [];
        this.badges.clan = this.clanInvites.length;
        this.updateBadge('clan');
      }

      // Update requests badge (friend + party invites)
      this.badges.requests = this.friendRequests.length + this.partyInvites.length;
      this.updateBadge('requests');
    } catch (error) {
      console.error('Failed to load badge counts:', error);
    }
  }

  updateBadge(tabKey) {
    const badge = this.uiElement.querySelector(`[data-badge="${tabKey}"]`);
    if (badge) {
      const count = this.badges[tabKey];
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    }
  }

  // Scene lifecycle methods
  update(_deltaTime) {
    // No game loop updates needed for this UI scene
  }

  render(_ctx) {
    // No canvas rendering needed - this is a DOM-based UI scene
  }
}
