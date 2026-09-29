import { Scene } from './Scene.js';
import { ParchmentCard } from '../components/ParchmentCard.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentButtonCSS,
  getParchmentPanelCSS,
  getParchmentScrollbarCSS,
  getParchmentSpinnerCSS
} from '../ui/parchment/index.js';
import { ParchmentModal } from '../ui/parchment/ParchmentModal.js';
import ParchmentInput from '../ui/parchment/ParchmentInput.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { GARRISON_CONFIG } from '@shared/constants.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { installImageFallbackHandler } from '../utils/imageFallback.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

const STYLE_ID = 'garrison-scene-styles';

/**
 * GarrisonScene - Castle garrison recruitment interface
 * Displays recruits available at a castle node with hourly refresh
 * Players can view recruit details, traits, skills, and hire them
 */
export class GarrisonScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // Scene data
    this.nodeId = null;
    this.nodeName = null;
    this.regionId = null;
    this.recruits = [];
    this.playerGold = 0;

    // UI state
    this.selectedRecruit = null;
    this.isLoading = true;
    this.refreshCountdown = null;
    this.countdownInterval = null;
    this.nextRefreshTime = null;

    // Components
    this.recruitCard = null;
    this.nameInputModal = null;
    this.nameInput = null;

    // WebSocket handlers
    this.wsHandlers = {};
  }

  async enter(data = {}) {
    this.nodeId = data.nodeId;
    this.nodeName = data.nodeName || 'Castle Garrison';
    this.regionId = data.regionId;
    this.playerGold = this.game.state.get('user')?.gold || 0;
    this.isLoading = true;
    this.selectedRecruit = null;

    if (!this.nodeId) {
      parchmentToast.error('Error', 'Invalid garrison data');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.abortController = new AbortController();
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocket();
    await this.loadData();
    this.startCountdownTimer();

    // Play castle/garrison music
    if (this.game.musicContext) {
      this.game.musicContext.playCastle?.() || this.game.musicContext.playTown?.();
    }
  }

  exit() {
    // Stop countdown timer
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Abort HTTP requests
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Leave WebSocket room
    this.cleanupWebSocket();

    // Destroy components
    if (this.recruitCard) {
      this.recruitCard.destroy();
      this.recruitCard = null;
    }

    if (this.nameInputModal) {
      this.nameInputModal.destroy();
      this.nameInputModal = null;
    }

    if (this.nameInput) {
      this.nameInput.destroy();
      this.nameInput = null;
    }

    // Remove UI
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }

    // Clean up styles
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  setupWebSocket() {
    const ws = this.game.ws;
    if (!ws) return;

    const room = `garrison:${this.nodeId}`;

    // Join garrison room
    ws.joinRoom(room);

    // Handle real-time recruit purchase events
    this.wsHandlers.garrisonPurchase = (payload) => {
      if (payload.nodeId === this.nodeId) {
        // Remove the purchased recruit from the list
        this.recruits = this.recruits.filter(r => r.id !== payload.recruitId);
        if (this.selectedRecruit?.id === payload.recruitId) {
          this.selectedRecruit = null;
        }
        this.updateUI();

        if (payload.purchasedBy !== this.game.state.get('user')?.id) {
          parchmentToast.info('Recruit Hired', `${payload.recruitName} was hired by another player`);
        }
      }
    };

    // Handle hourly refresh events
    this.wsHandlers.garrisonRefresh = (payload) => {
      if (payload.nodeId === this.nodeId) {
        this.recruits = payload.recruits || [];
        this.nextRefreshTime = payload.nextRefresh ? new Date(payload.nextRefresh) : null;
        this.selectedRecruit = null;
        this.updateUI();
        parchmentToast.info('Garrison Refreshed', 'New recruits are now available!');
      }
    };

    // Register handlers
    ws.on('garrison_purchase', this.wsHandlers.garrisonPurchase);
    ws.on('garrison_refresh', this.wsHandlers.garrisonRefresh);
  }

  cleanupWebSocket() {
    const ws = this.game.ws;
    if (!ws) return;

    const room = `garrison:${this.nodeId}`;
    ws.leaveRoom(room);

    // Unregister handlers
    if (this.wsHandlers.garrisonPurchase) {
      ws.off('garrison_purchase', this.wsHandlers.garrisonPurchase);
    }
    if (this.wsHandlers.garrisonRefresh) {
      ws.off('garrison_refresh', this.wsHandlers.garrisonRefresh);
    }
    this.wsHandlers = {};
  }

  async loadData() {
    try {
      const result = await this.game.api.get(`/garrison/${this.nodeId}`);

      this.recruits = result.recruits || [];
      this.nodeName = result.nodeName || this.nodeName;
      this.nextRefreshTime = result.nextRefresh ? new Date(result.nextRefresh) : null;
      this.isLoading = false;

      this.updateUI();
    } catch (err) {
      console.error('Failed to load garrison data:', err);
      parchmentToast.error('Load Failed', 'Failed to load garrison recruits');
      this.isLoading = false;
      this.updateUI();
    }
  }

  startCountdownTimer() {
    this.updateCountdown();
    this.countdownInterval = setInterval(() => {
      this.updateCountdown();
    }, 1000);
  }

  updateCountdown() {
    if (!this.nextRefreshTime) return;

    const now = new Date();
    const diffMs = this.nextRefreshTime - now;

    if (diffMs <= 0) {
      this.refreshCountdown = 'Refreshing soon...';
    } else {
      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);

      if (hours > 0) {
        this.refreshCountdown = `${hours}h ${minutes}m`;
      } else if (minutes > 0) {
        this.refreshCountdown = `${minutes}m ${seconds}s`;
      } else {
        this.refreshCountdown = `${seconds}s`;
      }
    }

    const countdownEl = this.uiElement?.querySelector('#garrison-refresh-countdown');
    if (countdownEl) {
      countdownEl.textContent = this.refreshCountdown;
    }
  }

  addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .garrison-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        /* Opaque page background so the letterboxed canvas never shows through */
        background: ${getParchmentGradient()};
        display: flex;
        flex-direction: column;
      }

      /* Header */
      .garrison-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        background: ${getParchmentGradient()};
        border-bottom: ${getParchmentBorder()};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .garrison-title-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .garrison-title {
        margin: 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
      }

      .garrison-subtitle {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .garrison-header-right {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.lg};
      }

      .garrison-gold {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        color: ${P.accent.burgundy};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .garrison-refresh {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .garrison-refresh-icon {
        color: ${P.accent.blue};
      }

      .garrison-back-btn {
        ${getParchmentButtonCSS('secondary')}
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .garrison-back-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.2);
      }

      /* Main Content */
      .garrison-content {
        flex: 1;
        display: flex;
        padding: ${PARCHMENT_SPACING.md};
        gap: ${PARCHMENT_SPACING.md};
        overflow: hidden;
      }

      /* Recruits Panel */
      .garrison-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        ${getParchmentPanelCSS()}
      }

      .garrison-panel-header {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        border-bottom: 1px solid ${P.border};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        background: rgba(139, 115, 85, 0.1);
      }

      .garrison-grid {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md};
      }

      /* Recruit Card */
      .garrison-card {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        padding: ${PARCHMENT_SPACING.md};
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: ${getParchmentShadow()};
      }

      .garrison-card:hover {
        border-color: ${P.borderDark};
        transform: translateY(-2px);
        box-shadow: ${getParchmentShadow(true)};
      }

      .garrison-card.selected {
        border-color: ${P.accent.burgundy};
        box-shadow: 0 0 15px rgba(107, 45, 61, 0.3);
      }

      .garrison-card-header {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .garrison-portrait {
        width: 56px;
        height: 56px;
        border: 2px solid ${P.borderDark};
        border-radius: ${PARCHMENT_RADIUS.sm};
        overflow: hidden;
        flex-shrink: 0;
        background: rgba(0, 0, 0, 0.1);
      }

      .garrison-portrait img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        image-rendering: pixelated;
      }

      .garrison-portrait-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        font-weight: bold;
        color: #fff;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
      }

      .garrison-info {
        flex: 1;
        min-width: 0;
      }

      .garrison-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        margin-bottom: 2px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .garrison-class-info {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.secondary};
        margin-bottom: 4px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .garrison-price {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.accent.burgundy};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .garrison-price.cannot-afford {
        color: ${P.state.error};
      }

      /* Stats Row */
      .garrison-stats-row {
        display: flex;
        justify-content: space-between;
        gap: 4px;
        margin-bottom: ${PARCHMENT_SPACING.sm};
        padding: 4px 0;
        border-top: 1px solid ${P.border};
        border-bottom: 1px solid ${P.border};
      }

      .garrison-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-size: 10px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .garrison-stat-label {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-transform: uppercase;
      }

      .garrison-stat-label.hp { color: #3d6b35; }
      .garrison-stat-label.mp { color: #35527a; }
      .garrison-stat-label.str { color: #8b4444; }
      .garrison-stat-label.int { color: #6b4488; }
      .garrison-stat-label.agi { color: #448844; }
      .garrison-stat-label.vit { color: #aa7733; }
      .garrison-stat-label.lck { color: #aa8833; }

      .garrison-stat-value {
        color: ${P.text.primary};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      /* Traits/Skills badges */
      .garrison-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .garrison-badge {
        padding: 2px 6px;
        border-radius: ${PARCHMENT_RADIUS.xs};
        font-size: 10px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .garrison-badge.trait {
        background: rgba(139, 90, 43, 0.3);
        color: ${P.text.primary};
        border: 1px solid ${P.border};
      }

      .garrison-badge.trait.uncommon {
        background: rgba(74, 117, 72, 0.2);
        color: ${P.state.success};
        border-color: ${P.state.success};
      }

      .garrison-badge.trait.rare {
        background: rgba(66, 133, 183, 0.2);
        color: ${P.accent.blue};
        border-color: ${P.accent.blue};
      }

      .garrison-badge.trait.legendary {
        background: rgba(107, 45, 61, 0.2);
        color: ${P.accent.burgundy};
        border-color: ${P.accent.burgundy};
      }

      .garrison-badge.skill {
        background: rgba(106, 90, 155, 0.2);
        color: #6b5a9b;
        border: 1px solid rgba(106, 90, 155, 0.4);
      }

      /* Detail Panel */
      .garrison-detail-panel {
        width: 340px;
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
      }

      .garrison-detail-container {
        min-height: 100px;
      }

      .garrison-detail-section {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.md};
      }

      .garrison-detail-section-title {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-transform: uppercase;
        margin-bottom: ${PARCHMENT_SPACING.sm};
        border-bottom: 1px solid ${P.border};
        padding-bottom: 4px;
      }

      .garrison-traits-list, .garrison-skills-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .garrison-detail-trait, .garrison-detail-skill {
        padding: ${PARCHMENT_SPACING.sm};
        background: rgba(139, 115, 85, 0.1);
        border-radius: ${PARCHMENT_RADIUS.sm};
        border-left: 3px solid ${P.border};
      }

      .garrison-detail-trait.uncommon { border-left-color: ${P.state.success}; }
      .garrison-detail-trait.rare { border-left-color: ${P.accent.blue}; }
      .garrison-detail-trait.legendary { border-left-color: ${P.accent.burgundy}; }

      .garrison-trait-name, .garrison-skill-name {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        margin-bottom: 2px;
      }

      .garrison-trait-desc, .garrison-skill-desc {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        line-height: 1.3;
      }

      /* Purchase Section */
      .garrison-purchase-section {
        margin-top: auto;
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.md};
        border: 2px solid ${P.border};
      }

      .garrison-purchase-price-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .garrison-purchase-label {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .garrison-purchase-price {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.accent.burgundy};
      }

      .garrison-purchase-price.cannot-afford {
        color: ${P.state.error};
      }

      .garrison-purchase-btn {
        width: 100%;
        ${getParchmentButtonCSS('primary')}
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .garrison-purchase-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      }

      .garrison-purchase-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        background: ${P.border};
      }

      /* Empty States */
      .garrison-empty-state {
        text-align: center;
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        padding: ${PARCHMENT_SPACING.xxl} ${PARCHMENT_SPACING.lg};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .garrison-empty-state-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .garrison-loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .garrison-loading-spinner {
        display: inline-block;
        width: 20px;
        height: 20px;
        border: 2px solid ${P.border};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: garrison-spin 0.8s linear infinite;
        margin-right: ${PARCHMENT_SPACING.sm};
      }

      @keyframes garrison-spin {
        to { transform: rotate(360deg); }
      }

      /* Empty Slot Card */
      .garrison-card.empty-slot {
        background: rgba(139, 115, 85, 0.1);
        border: 2px dashed ${P.border};
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        cursor: default;
      }

      .garrison-empty-slot-text {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        text-align: center;
      }

      /* Responsive */
      @media (max-width: 900px) {
        .garrison-content {
          flex-direction: column;
        }

        .garrison-detail-panel {
          width: 100%;
          max-height: 300px;
          overflow-y: auto;
        }

        .garrison-grid {
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        }
      }

      /* Themed Scrollbars */
      ${getParchmentScrollbarCSS('.garrison-grid')}
      ${getParchmentScrollbarCSS('.garrison-detail-panel')}
      ${getParchmentScrollbarCSS('.garrison-content')}

      /* Parchment Spinner */
      ${getParchmentSpinnerCSS()}
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'garrison-container';

    const { max } = GARRISON_CONFIG.recruitsPerCastle;

    container.innerHTML = `
      <div class="garrison-header">
        <div class="garrison-title-section">
          <h2 class="garrison-title">${escapeHtml(this.nodeName)}</h2>
          <div class="garrison-subtitle">Castle Garrison - Hire Soldiers</div>
        </div>
        <div class="garrison-header-right">
          <div class="garrison-refresh">
            <span class="garrison-refresh-icon">&#8635;</span>
            <span>Next refresh: <span id="garrison-refresh-countdown">--:--</span></span>
          </div>
          <div class="garrison-gold">
            <span>Gold:</span>
            <span id="garrison-player-gold">${this.playerGold}</span>
          </div>
          <button class="garrison-back-btn" id="garrison-back-btn">Back to Map</button>
        </div>
      </div>

      <div class="garrison-content">
        <div class="garrison-panel">
          <div class="garrison-panel-header">Available Recruits (${this.recruits.length}/${max})</div>
          <div class="garrison-grid" id="garrison-grid">
            ${this.isLoading ? '<div class="garrison-loading-state"><span class="garrison-loading-spinner"></span>Loading recruits...</div>' : ''}
          </div>
        </div>

        <div class="garrison-detail-panel">
          <div class="garrison-detail-section">
            <div class="garrison-detail-section-title">Recruit Details</div>
            <div class="garrison-detail-container" id="garrison-detail-container">
              <div class="garrison-empty-state">Select a recruit to view details</div>
            </div>
          </div>

          <div class="garrison-detail-section" id="garrison-traits-section" style="display: none;">
            <div class="garrison-detail-section-title">Traits</div>
            <div class="garrison-traits-list" id="garrison-traits-list"></div>
          </div>

          <div class="garrison-detail-section" id="garrison-skills-section" style="display: none;">
            <div class="garrison-detail-section-title">Pre-learned Skills</div>
            <div class="garrison-skills-list" id="garrison-skills-list"></div>
          </div>

          <div class="garrison-purchase-section" id="garrison-purchase-section" style="display: none;">
            <div class="garrison-purchase-price-row">
              <span class="garrison-purchase-label">Recruitment Cost</span>
              <span class="garrison-purchase-price" id="garrison-purchase-price">0g</span>
            </div>
            <button class="garrison-purchase-btn" id="garrison-purchase-btn" disabled>Hire</button>
          </div>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Initialize ParchmentCard for detail view
    this.recruitCard = new ParchmentCard({ mode: 'detailed', type: 'player' });
  }

  setupEventListeners() {
    const opts = { signal: this.abortController.signal };

    // Back button
    this.uiElement.querySelector('#garrison-back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Purchase button
    this.uiElement.querySelector('#garrison-purchase-btn')?.addEventListener('click', () => {
      this.openNameInputModal();
    }, opts);
  }

  updateUI() {
    this.renderRecruitGrid();
    this.updateHeaderInfo();
    this.updateDetailPanel();
  }

  updateHeaderInfo() {
    const { max } = GARRISON_CONFIG.recruitsPerCastle;
    const countEl = this.uiElement?.querySelector('.garrison-panel-header');
    if (countEl) countEl.textContent = `Available Recruits (${this.recruits.length}/${max})`;
  }

  renderRecruitGrid() {
    installImageFallbackHandler();

    const grid = this.uiElement?.querySelector('#garrison-grid');
    if (!grid) return;

    if (this.isLoading) {
      grid.innerHTML = '<div class="garrison-loading-state"><span class="garrison-loading-spinner"></span>Loading recruits...</div>';
      return;
    }

    if (this.recruits.length === 0) {
      grid.innerHTML = `
        <div class="garrison-empty-state">
          <div class="garrison-empty-state-icon">&#x2694;</div>
          <div>No recruits available</div>
          <div style="font-size: 12px; margin-top: 8px;">Check back after the next hourly refresh</div>
        </div>
      `;
      return;
    }

    // Render recruit cards
    const cardsHtml = this.recruits.map(recruit => this.renderRecruitCard(recruit)).join('');

    // Add empty slots to fill up to max
    const { max } = GARRISON_CONFIG.recruitsPerCastle;
    const emptySlots = Math.max(0, max - this.recruits.length);
    const emptySlotsHtml = Array(emptySlots).fill(0).map(() => `
      <div class="garrison-card empty-slot">
        <div class="garrison-empty-slot-text">Hired</div>
      </div>
    `).join('');

    grid.innerHTML = cardsHtml + emptySlotsHtml;

    // Add click handlers
    grid.querySelectorAll('.garrison-card[data-recruit-id]').forEach(card => {
      card.addEventListener('click', () => {
        const recruitId = parseInt(card.dataset.recruitId);
        this.selectRecruit(recruitId);
      }, { signal: this.abortController.signal });
    });
  }

  renderRecruitCard(recruit) {
    const isSelected = this.selectedRecruit?.id === recruit.id;
    const canAfford = this.playerGold >= recruit.price;
    const portraitUrl = this.getPortraitUrl(recruit);

    // Build badges for traits and skills
    const traitBadges = (recruit.traits || []).map(t =>
      `<span class="garrison-badge trait ${t.rarity}">${escapeHtml(t.name)}</span>`
    ).join('');

    const skillBadges = (recruit.skills || []).map(s =>
      `<span class="garrison-badge skill">${this.formatSkillId(s)}</span>`
    ).join('');

    return `
      <div class="garrison-card ${isSelected ? 'selected' : ''}" data-recruit-id="${recruit.id}">
        <div class="garrison-card-header">
          <div class="garrison-portrait">
            <img src="${portraitUrl}" alt="${escapeHtml(recruit.name)}"
                 data-image-fallback data-fallback-display="flex">
            <div class="garrison-portrait-fallback" style="display: none; background: ${this.getClassColor(recruit.class)};">
              ${recruit.name.charAt(0)}
            </div>
          </div>
          <div class="garrison-info">
            <div class="garrison-name">${escapeHtml(recruit.name)}</div>
            <div class="garrison-class-info">Lv.${recruit.level || 1} ${this.capitalize(recruit.race)} ${this.capitalize(recruit.class)}</div>
            <div class="garrison-price ${canAfford ? '' : 'cannot-afford'}">${recruit.price}g</div>
          </div>
        </div>
        <div class="garrison-stats-row">
          <div class="garrison-stat">
            <span class="garrison-stat-label hp">HP</span>
            <span class="garrison-stat-value">${recruit.stats?.hpMax || 0}</span>
          </div>
          <div class="garrison-stat">
            <span class="garrison-stat-label mp">MP</span>
            <span class="garrison-stat-value">${recruit.stats?.mpMax || 0}</span>
          </div>
          <div class="garrison-stat">
            <span class="garrison-stat-label str">STR</span>
            <span class="garrison-stat-value">${recruit.stats?.strength || 0}</span>
          </div>
          <div class="garrison-stat">
            <span class="garrison-stat-label int">INT</span>
            <span class="garrison-stat-value">${recruit.stats?.intelligence || 0}</span>
          </div>
          <div class="garrison-stat">
            <span class="garrison-stat-label agi">AGI</span>
            <span class="garrison-stat-value">${recruit.stats?.agility || 0}</span>
          </div>
          <div class="garrison-stat">
            <span class="garrison-stat-label vit">VIT</span>
            <span class="garrison-stat-value">${recruit.stats?.vitality || 0}</span>
          </div>
          <div class="garrison-stat">
            <span class="garrison-stat-label lck">LCK</span>
            <span class="garrison-stat-value">${recruit.stats?.luck || 0}</span>
          </div>
        </div>
        <div class="garrison-badges">
          ${traitBadges}
          ${skillBadges}
        </div>
      </div>
    `;
  }

  selectRecruit(recruitId) {
    this.selectedRecruit = this.recruits.find(r => r.id === recruitId);
    this.renderRecruitGrid();
    this.updateDetailPanel();
  }

  updateDetailPanel() {
    const cardContainer = this.uiElement?.querySelector('#garrison-detail-container');
    const traitsSection = this.uiElement?.querySelector('#garrison-traits-section');
    const skillsSection = this.uiElement?.querySelector('#garrison-skills-section');
    const purchaseSection = this.uiElement?.querySelector('#garrison-purchase-section');
    const traitsList = this.uiElement?.querySelector('#garrison-traits-list');
    const skillsList = this.uiElement?.querySelector('#garrison-skills-list');
    const purchasePrice = this.uiElement?.querySelector('#garrison-purchase-price');
    const purchaseBtn = this.uiElement?.querySelector('#garrison-purchase-btn');

    if (!this.selectedRecruit) {
      // Clear and hide detail sections
      if (cardContainer) {
        cardContainer.innerHTML = '<div class="garrison-empty-state">Select a recruit to view details</div>';
      }
      if (traitsSection) traitsSection.style.display = 'none';
      if (skillsSection) skillsSection.style.display = 'none';
      if (purchaseSection) purchaseSection.style.display = 'none';
      return;
    }

    const recruit = this.selectedRecruit;
    const canAfford = this.playerGold >= recruit.price;

    // Update parchment card
    if (cardContainer) {
      cardContainer.innerHTML = '';
      // Transform recruit data to match ParchmentCard expected format (camelCase)
      const cardData = {
        id: recruit.id,
        name: recruit.name,
        race: recruit.race,
        class: recruit.class,
        gender: recruit.gender,
        level: recruit.level || 1,
        hp: recruit.stats?.hpMax,
        maxHp: recruit.stats?.hpMax,
        mp: recruit.stats?.mpMax,
        maxMp: recruit.stats?.mpMax,
        strength: recruit.stats?.strength,
        intelligence: recruit.stats?.intelligence,
        agility: recruit.stats?.agility,
        vitality: recruit.stats?.vitality,
        luck: recruit.stats?.luck
      };
      this.recruitCard.setCharacter(cardData);
      cardContainer.appendChild(this.recruitCard.element);
    }

    // Update traits section
    const traits = recruit.traits || [];
    if (traitsSection) {
      traitsSection.style.display = traits.length > 0 ? 'block' : 'none';
    }
    if (traitsList) {
      traitsList.innerHTML = traits.map(t => `
        <div class="garrison-detail-trait ${t.rarity}">
          <div class="garrison-trait-name">${escapeHtml(t.name)}</div>
          <div class="garrison-trait-desc">${escapeHtml(t.description || 'No description')}</div>
        </div>
      `).join('');
    }

    // Update skills section
    const skills = recruit.skills || [];
    if (skillsSection) {
      skillsSection.style.display = skills.length > 0 ? 'block' : 'none';
    }
    if (skillsList) {
      skillsList.innerHTML = skills.map(s => `
        <div class="garrison-detail-skill">
          <div class="garrison-skill-name">${this.formatSkillId(s)}</div>
          <div class="garrison-skill-desc">Pre-learned at level 1</div>
        </div>
      `).join('');
    }

    // Update purchase section
    if (purchaseSection) purchaseSection.style.display = 'block';
    if (purchasePrice) {
      purchasePrice.textContent = `${recruit.price}g`;
      purchasePrice.classList.toggle('cannot-afford', !canAfford);
    }
    if (purchaseBtn) {
      purchaseBtn.disabled = !canAfford;
      purchaseBtn.textContent = canAfford ? 'Hire' : 'Not Enough Gold';
    }
  }

  openNameInputModal() {
    if (!this.selectedRecruit) return;

    const recruit = this.selectedRecruit;

    // Create name input component
    this.nameInput = new ParchmentInput({
      type: 'text',
      label: 'Character Name',
      placeholder: 'Enter name for your new soldier...',
      value: recruit.name,
      maxLength: 24,
      required: true
    });

    // Create modal with input
    this.nameInputModal = new ParchmentModal({
      title: `Hire ${this.capitalize(recruit.race)} ${this.capitalize(recruit.class)}`,
      content: this.nameInput.element,
      size: 'sm',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      actions: [
        {
          label: 'Cancel',
          variant: 'secondary',
          onClick: () => {
            this.nameInputModal.close();
          }
        },
        {
          label: `Hire (${recruit.price}g)`,
          variant: 'primary',
          onClick: () => {
            this.handlePurchase();
          }
        }
      ],
      onClose: () => {
        if (this.nameInput) {
          this.nameInput.destroy();
          this.nameInput = null;
        }
        this.nameInputModal = null;
      }
    });

    this.nameInputModal.open();

    // Focus the input after modal opens
    setTimeout(() => {
      this.nameInput?.focus();
      this.nameInput?.select();
    }, 100);
  }

  async handlePurchase() {
    if (!this.selectedRecruit || !this.nameInput) return;

    const recruit = this.selectedRecruit;
    const characterName = this.nameInput.getValue().trim();

    // Validate name
    if (!characterName || characterName.length < 2) {
      this.nameInput.setError('Name must be at least 2 characters');
      return;
    }

    if (characterName.length > 24) {
      this.nameInput.setError('Name cannot exceed 24 characters');
      return;
    }

    if (this.playerGold < recruit.price) {
      parchmentToast.error('Insufficient Gold', 'Not enough gold to hire this recruit');
      return;
    }

    try {
      // Disable the hire button while processing
      this.nameInputModal?.updateAction(1, { disabled: true, label: 'Hiring...' });

      const result = await this.game.api.post(
        `/garrison/${this.nodeId}/purchase/${recruit.id}`,
        { characterName }
      );

      // Update local gold
      this.playerGold = result.remainingGold;
      this.game.state.set('user', { ...this.game.state.get('user'), gold: result.remainingGold });
      this.updateGoldDisplay();

      // Close modal
      this.nameInputModal?.close();

      // Show success
      parchmentToast.success('Soldier Hired!', result.message || `${characterName} has joined your party!`);

      // Remove from local list and refresh
      this.recruits = this.recruits.filter(r => r.id !== recruit.id);
      this.selectedRecruit = null;
      this.updateUI();

      // Navigate back to world map after a short delay
      setTimeout(() => {
        this.game.scenes.switchTo('worldMap');
      }, 1500);

    } catch (err) {
      // Re-enable the button
      this.nameInputModal?.updateAction(1, { disabled: false, label: `Hire (${recruit.price}g)` });

      if (err.message?.includes('name')) {
        this.nameInput?.setError(err.message);
      } else {
        parchmentToast.error('Hire Failed', err.message || 'Failed to hire recruit');
      }
    }
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement?.querySelector('#garrison-player-gold');
    if (goldEl) {
      goldEl.textContent = this.playerGold;
    }
  }

  // Utility methods
  getPortraitUrl(recruit) {
    return this.game.assetLoader.getPortraitUrl(recruit, 56);
  }

  getClassColor(className) {
    const colors = {
      warrior: '#c62828',
      wizard: '#1565c0',
      monk: '#f9a825',
      chemist: '#2e7d32',
      berserker: '#b71c1c',
      sorcerer: '#0d47a1',
      ninja: '#4a148c',
      alchemist: '#1b5e20'
    };
    return colors[className] || '#666';
  }

  formatSkillId(skillId) {
    // Convert skill_id to Title Case
    if (typeof skillId === 'object') skillId = skillId.skill_id || skillId.id || '';
    return String(skillId)
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }


  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // Draw parchment-themed background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, this.game.targetHeight);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);

    // Draw subtle decorative elements with gold accents
    ctx.fillStyle = 'rgba(201, 162, 39, 0.08)';
    for (let i = 0; i < 5; i++) {
      const x = 100 + i * 150;
      const y = 450 + Math.sin(Date.now() / 1000 + i) * 20;
      ctx.beginPath();
      ctx.arc(x, y, 30 + i * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add subtle corner flourishes
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;

    // Top-left flourish
    ctx.beginPath();
    ctx.moveTo(20, 60);
    ctx.quadraticCurveTo(20, 20, 60, 20);
    ctx.stroke();

    // Top-right flourish
    ctx.beginPath();
    ctx.moveTo(this.game.targetWidth - 20, 60);
    ctx.quadraticCurveTo(this.game.targetWidth - 20, 20, this.game.targetWidth - 60, 20);
    ctx.stroke();

    // Bottom-left flourish
    ctx.beginPath();
    ctx.moveTo(20, this.game.targetHeight - 60);
    ctx.quadraticCurveTo(20, this.game.targetHeight - 20, 60, this.game.targetHeight - 20);
    ctx.stroke();

    // Bottom-right flourish
    ctx.beginPath();
    ctx.moveTo(this.game.targetWidth - 20, this.game.targetHeight - 60);
    ctx.quadraticCurveTo(this.game.targetWidth - 20, this.game.targetHeight - 20, this.game.targetWidth - 60, this.game.targetHeight - 20);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }
}
