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
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

const STYLE_ID = 'recruitment-scene-styles';

/**
 * RecruitmentScene - Guild recruitment interface
 * Displays available recruits at a guild node in a card grid layout
 * Players can view recruit details, traits, skills, and purchase them
 */
export class RecruitmentScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // Scene data
    this.nodeId = null;
    this.guildClass = null;
    this.guildInfo = null;
    this.recruits = [];
    this.playerGold = 0;

    // UI state
    this.selectedRecruit = null;
    this.isLoading = true;
    this.refreshCountdown = null;
    this.countdownInterval = null;

    // Components
    this.recruitCard = null;
  }

  async enter(data = {}) {
    this.nodeId = data.nodeId;
    this.guildClass = data.guildClass;
    this.playerGold = this.game.state.get('user')?.gold || 0;
    this.isLoading = true;
    this.selectedRecruit = null;

    if (!this.nodeId) {
      parchmentToast.error('Error', 'Invalid guild data');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.abortController = new AbortController();
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    await this.loadData();
    this.startCountdownTimer();

    // Play guild advancement music (same as guild advancement scene)
    if (this.game.musicContext) {
      this.game.musicContext.playGuildAdvancement();
    }
  }

  exit() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.recruitCard) {
      this.recruitCard.destroy();
      this.recruitCard = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    // Clean up styles
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  async loadData() {
    try {
      const [infoResult, recruitsResult] = await Promise.all([
        this.game.api.getGuildInfo(this.nodeId),
        this.game.api.getGuildRecruits(this.nodeId)
      ]);

      this.guildInfo = infoResult;
      this.recruits = recruitsResult.recruits || [];
      this.guildClass = infoResult.guildClass || this.guildClass;
      this.isLoading = false;

      this.updateUI();
    } catch (err) {
      console.error('Failed to load recruitment data:', err);
      parchmentToast.error('Load Failed', 'Failed to load guild recruits');
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
    if (!this.guildInfo?.nextRefresh) return;

    const nextRefresh = new Date(this.guildInfo.nextRefresh);
    const now = new Date();
    const diffMs = nextRefresh - now;

    if (diffMs <= 0) {
      this.refreshCountdown = 'Refreshing soon...';
      // Trigger a data reload after a short delay
      setTimeout(() => this.loadData(), 2000);
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

    const countdownEl = this.uiElement?.querySelector('#recruit-refresh-countdown');
    if (countdownEl) {
      countdownEl.textContent = this.refreshCountdown;
    }
  }

  addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .recruit-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      /* Header */
      .recruit-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        background: ${getParchmentGradient()};
        border-bottom: ${getParchmentBorder()};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .recruit-title-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .recruit-title {
        margin: 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        text-transform: capitalize;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
      }

      .recruit-subtitle {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .recruit-header-right {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.lg};
      }

      .recruit-gold {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        color: ${P.accent.burgundy};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .recruit-refresh {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .recruit-refresh-icon {
        color: ${P.accent.blue};
      }

      .recruit-back-btn {
        ${getParchmentButtonCSS('secondary')}
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .recruit-back-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.2);
      }

      /* Main Content */
      .recruit-content {
        flex: 1;
        display: flex;
        padding: ${PARCHMENT_SPACING.md};
        gap: ${PARCHMENT_SPACING.md};
        overflow: hidden;
      }

      /* Recruits Panel */
      .recruit-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        ${getParchmentPanelCSS()}
      }

      .recruit-panel-header {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        border-bottom: 1px solid ${P.border};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        background: rgba(139, 115, 85, 0.1);
      }

      .recruit-grid {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.md};
      }

      /* Recruit Card */
      .recruit-card {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        padding: ${PARCHMENT_SPACING.md};
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: ${getParchmentShadow()};
      }

      .recruit-card:hover {
        border-color: ${P.borderDark};
        transform: translateY(-2px);
        box-shadow: ${getParchmentShadow(true)};
      }

      .recruit-card.selected {
        border-color: ${P.accent.burgundy};
        box-shadow: 0 0 15px rgba(107, 45, 61, 0.3);
      }

      .recruit-card.sold {
        opacity: 0.5;
        cursor: not-allowed;
        filter: grayscale(0.5);
      }

      .recruit-card-header {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .recruit-portrait {
        width: 56px;
        height: 56px;
        border: 2px solid ${P.borderDark};
        border-radius: ${PARCHMENT_RADIUS.sm};
        overflow: hidden;
        flex-shrink: 0;
        background: rgba(0, 0, 0, 0.1);
      }

      .recruit-portrait img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        image-rendering: pixelated;
      }

      .recruit-portrait-fallback {
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

      .recruit-info {
        flex: 1;
        min-width: 0;
      }

      .recruit-name {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        margin-bottom: 2px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .recruit-class-info {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.secondary};
        margin-bottom: 4px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .recruit-price {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.accent.burgundy};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .recruit-price.cannot-afford {
        color: ${P.state.error};
      }

      /* Stats Row */
      .recruit-stats-row {
        display: flex;
        justify-content: space-between;
        gap: 4px;
        margin-bottom: ${PARCHMENT_SPACING.sm};
        padding: 4px 0;
        border-top: 1px solid ${P.border};
        border-bottom: 1px solid ${P.border};
      }

      .recruit-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-size: 10px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .recruit-stat-label {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-transform: uppercase;
      }

      .recruit-stat-label.hp { color: #3d6b35; }
      .recruit-stat-label.mp { color: #35527a; }
      .recruit-stat-label.str { color: #8b4444; }
      .recruit-stat-label.int { color: #6b4488; }
      .recruit-stat-label.agi { color: #448844; }
      .recruit-stat-label.vit { color: #aa7733; }
      .recruit-stat-label.lck { color: #aa8833; }

      .recruit-stat-value {
        color: ${P.text.primary};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      /* Traits/Skills badges */
      .recruit-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .recruit-badge {
        padding: 2px 6px;
        border-radius: ${PARCHMENT_RADIUS.xs};
        font-size: 10px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .recruit-badge.trait {
        background: rgba(139, 90, 43, 0.3);
        color: ${P.text.primary};
        border: 1px solid ${P.border};
      }

      .recruit-badge.trait.uncommon {
        background: rgba(74, 117, 72, 0.2);
        color: ${P.state.success};
        border-color: ${P.state.success};
      }

      .recruit-badge.trait.rare {
        background: rgba(66, 133, 183, 0.2);
        color: ${P.accent.blue};
        border-color: ${P.accent.blue};
      }

      .recruit-badge.trait.legendary {
        background: rgba(107, 45, 61, 0.2);
        color: ${P.accent.burgundy};
        border-color: ${P.accent.burgundy};
      }

      .recruit-badge.skill {
        background: rgba(106, 90, 155, 0.2);
        color: #6b5a9b;
        border: 1px solid rgba(106, 90, 155, 0.4);
      }

      /* Detail Panel */
      .recruit-detail-panel {
        width: 340px;
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
      }

      .recruit-detail-container {
        min-height: 100px;
      }

      .recruit-detail-section {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.md};
      }

      .recruit-detail-section-title {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-transform: uppercase;
        margin-bottom: ${PARCHMENT_SPACING.sm};
        border-bottom: 1px solid ${P.border};
        padding-bottom: 4px;
      }

      .recruit-traits-list, .recruit-skills-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .recruit-detail-trait, .recruit-detail-skill {
        padding: ${PARCHMENT_SPACING.sm};
        background: rgba(139, 115, 85, 0.1);
        border-radius: ${PARCHMENT_RADIUS.sm};
        border-left: 3px solid ${P.border};
      }

      .recruit-detail-trait.uncommon { border-left-color: ${P.state.success}; }
      .recruit-detail-trait.rare { border-left-color: ${P.accent.blue}; }
      .recruit-detail-trait.legendary { border-left-color: ${P.accent.burgundy}; }

      .recruit-trait-name, .recruit-skill-name {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        margin-bottom: 2px;
      }

      .recruit-trait-desc, .recruit-skill-desc {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        line-height: 1.3;
      }

      /* Purchase Section */
      .recruit-purchase-section {
        margin-top: auto;
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.md};
        border: 2px solid ${P.border};
      }

      .recruit-purchase-price-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .recruit-purchase-label {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .recruit-purchase-price {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.accent.burgundy};
      }

      .recruit-purchase-price.cannot-afford {
        color: ${P.state.error};
      }

      .recruit-purchase-btn {
        width: 100%;
        ${getParchmentButtonCSS('primary')}
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .recruit-purchase-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      }

      .recruit-purchase-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        background: ${P.border};
      }

      /* Empty States */
      .recruit-empty-state {
        text-align: center;
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        padding: ${PARCHMENT_SPACING.xxl} ${PARCHMENT_SPACING.lg};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .recruit-empty-state-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .recruit-loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .recruit-loading-spinner {
        display: inline-block;
        width: 20px;
        height: 20px;
        border: 2px solid ${P.border};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: recruit-spin 0.8s linear infinite;
        margin-right: ${PARCHMENT_SPACING.sm};
      }

      @keyframes recruit-spin {
        to { transform: rotate(360deg); }
      }

      /* Empty Slot Card */
      .recruit-card.empty-slot {
        background: rgba(139, 115, 85, 0.1);
        border: 2px dashed ${P.border};
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        cursor: default;
      }

      .recruit-empty-slot-text {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        text-align: center;
      }

      /* Stat variance indicator */
      .recruit-variance-indicator {
        font-size: 10px;
        margin-left: 4px;
      }

      .recruit-variance-positive { color: ${P.state.success}; }
      .recruit-variance-negative { color: ${P.state.error}; }

      /* Responsive */
      @media (max-width: 900px) {
        .recruit-content {
          flex-direction: column;
        }

        .recruit-detail-panel {
          width: 100%;
          max-height: 300px;
          overflow-y: auto;
        }

        .recruit-grid {
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        }
      }

      /* Themed Scrollbars */
      ${getParchmentScrollbarCSS('.recruit-grid')}
      ${getParchmentScrollbarCSS('.recruit-detail-panel')}
      ${getParchmentScrollbarCSS('.recruit-content')}

      /* Parchment Spinner */
      ${getParchmentSpinnerCSS()}
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'recruit-container';

    const guildTitle = this.guildInfo?.nodeName || `${this.capitalize(this.guildClass || 'Guild')}s Guild`;
    const actionLabel = this.guildInfo?.actionLabel || 'Recruit Member';

    container.innerHTML = `
      <div class="recruit-header">
        <div class="recruit-title-section">
          <h2 class="recruit-title">${guildTitle}</h2>
          <div class="recruit-subtitle">${actionLabel}</div>
        </div>
        <div class="recruit-header-right">
          <div class="recruit-refresh">
            <span class="recruit-refresh-icon">&#8635;</span>
            <span>Next refresh: <span id="recruit-refresh-countdown">--:--</span></span>
          </div>
          <div class="recruit-gold">
            <span>Gold:</span>
            <span id="recruit-player-gold">${this.playerGold}</span>
          </div>
          <button class="recruit-back-btn" id="recruit-back-btn">Back to Map</button>
        </div>
      </div>

      <div class="recruit-content">
        <div class="recruit-panel">
          <div class="recruit-panel-header">Available Recruits (${this.recruits.length}/10)</div>
          <div class="recruit-grid" id="recruit-grid">
            ${this.isLoading ? '<div class="recruit-loading-state"><span class="recruit-loading-spinner"></span>Loading recruits...</div>' : ''}
          </div>
        </div>

        <div class="recruit-detail-panel">
          <div class="recruit-detail-section">
            <div class="recruit-detail-section-title">Recruit Details</div>
            <div class="recruit-detail-container" id="recruit-detail-container">
              <div class="recruit-empty-state">Select a recruit to view details</div>
            </div>
          </div>

          <div class="recruit-detail-section" id="recruit-traits-section" style="display: none;">
            <div class="recruit-detail-section-title">Traits</div>
            <div class="recruit-traits-list" id="recruit-traits-list"></div>
          </div>

          <div class="recruit-detail-section" id="recruit-skills-section" style="display: none;">
            <div class="recruit-detail-section-title">Pre-learned Skills</div>
            <div class="recruit-skills-list" id="recruit-skills-list"></div>
          </div>

          <div class="recruit-purchase-section" id="recruit-purchase-section" style="display: none;">
            <div class="recruit-purchase-price-row">
              <span class="recruit-purchase-label">Recruitment Cost</span>
              <span class="recruit-purchase-price" id="recruit-purchase-price">0g</span>
            </div>
            <button class="recruit-purchase-btn" id="recruit-purchase-btn" disabled>Recruit</button>
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
    this.uiElement.querySelector('#recruit-back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Purchase button
    this.uiElement.querySelector('#recruit-purchase-btn')?.addEventListener('click', () => {
      this.handlePurchase();
    }, opts);
  }

  updateUI() {
    this.renderRecruitGrid();
    this.updateHeaderInfo();
    this.updateDetailPanel();
  }

  updateHeaderInfo() {
    const guildTitle = this.guildInfo?.nodeName || `${this.capitalize(this.guildClass || 'Guild')}s Guild`;
    const actionLabel = this.guildInfo?.actionLabel || 'Recruit Member';

    const titleEl = this.uiElement?.querySelector('.recruit-title');
    const subtitleEl = this.uiElement?.querySelector('.recruit-subtitle');
    const countEl = this.uiElement?.querySelector('.recruit-panel-header');

    if (titleEl) titleEl.textContent = guildTitle;
    if (subtitleEl) subtitleEl.textContent = actionLabel;
    if (countEl) countEl.textContent = `Available Recruits (${this.recruits.length}/10)`;
  }

  renderRecruitGrid() {
    const grid = this.uiElement?.querySelector('#recruit-grid');
    if (!grid) return;

    if (this.isLoading) {
      grid.innerHTML = '<div class="recruit-loading-state"><span class="recruit-loading-spinner"></span>Loading recruits...</div>';
      return;
    }

    if (this.recruits.length === 0) {
      grid.innerHTML = `
        <div class="recruit-empty-state">
          <div class="recruit-empty-state-icon">&#x1F6D2;</div>
          <div>No recruits available</div>
          <div style="font-size: 12px; margin-top: 8px;">Check back after the next refresh</div>
        </div>
      `;
      return;
    }

    // Render recruit cards
    const cardsHtml = this.recruits.map(recruit => this.renderRecruitCard(recruit)).join('');

    // Add empty slots to fill up to 10
    const emptySlots = Math.max(0, 10 - this.recruits.length);
    const emptySlotsHtml = Array(emptySlots).fill(0).map(() => `
      <div class="recruit-card empty-slot">
        <div class="recruit-empty-slot-text">Sold</div>
      </div>
    `).join('');

    grid.innerHTML = cardsHtml + emptySlotsHtml;

    // Add click handlers
    grid.querySelectorAll('.recruit-card[data-recruit-id]').forEach(card => {
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
      `<span class="recruit-badge trait ${t.rarity}">${t.name}</span>`
    ).join('');

    const skillBadges = (recruit.skills || []).map(s =>
      `<span class="recruit-badge skill">${this.formatSkillId(s)}</span>`
    ).join('');

    // Variance indicator
    const variance = recruit.statVariancePercent || 0;
    const varianceHtml = variance !== 0
      ? `<span class="recruit-variance-indicator ${variance > 0 ? 'recruit-variance-positive' : 'recruit-variance-negative'}">${variance > 0 ? '+' : ''}${variance.toFixed(0)}%</span>`
      : '';

    return `
      <div class="recruit-card ${isSelected ? 'selected' : ''}" data-recruit-id="${recruit.id}">
        <div class="recruit-card-header">
          <div class="recruit-portrait">
            <img src="${portraitUrl}" alt="${recruit.name}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="recruit-portrait-fallback" style="display: none; background: ${this.getClassColor(recruit.class)};">
              ${recruit.name.charAt(0)}
            </div>
          </div>
          <div class="recruit-info">
            <div class="recruit-name">${recruit.name}${varianceHtml}</div>
            <div class="recruit-class-info">${this.capitalize(recruit.race)} ${this.capitalize(recruit.class)}</div>
            <div class="recruit-price ${canAfford ? '' : 'cannot-afford'}">${recruit.price}g</div>
          </div>
        </div>
        <div class="recruit-stats-row">
          <div class="recruit-stat">
            <span class="recruit-stat-label hp">HP</span>
            <span class="recruit-stat-value">${recruit.stats?.hpMax || 0}</span>
          </div>
          <div class="recruit-stat">
            <span class="recruit-stat-label mp">MP</span>
            <span class="recruit-stat-value">${recruit.stats?.mpMax || 0}</span>
          </div>
          <div class="recruit-stat">
            <span class="recruit-stat-label str">STR</span>
            <span class="recruit-stat-value">${recruit.stats?.strength || 0}</span>
          </div>
          <div class="recruit-stat">
            <span class="recruit-stat-label int">INT</span>
            <span class="recruit-stat-value">${recruit.stats?.intelligence || 0}</span>
          </div>
          <div class="recruit-stat">
            <span class="recruit-stat-label agi">AGI</span>
            <span class="recruit-stat-value">${recruit.stats?.agility || 0}</span>
          </div>
          <div class="recruit-stat">
            <span class="recruit-stat-label vit">VIT</span>
            <span class="recruit-stat-value">${recruit.stats?.vitality || 0}</span>
          </div>
          <div class="recruit-stat">
            <span class="recruit-stat-label lck">LCK</span>
            <span class="recruit-stat-value">${recruit.stats?.luck || 0}</span>
          </div>
        </div>
        <div class="recruit-badges">
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
    const cardContainer = this.uiElement?.querySelector('#recruit-detail-container');
    const traitsSection = this.uiElement?.querySelector('#recruit-traits-section');
    const skillsSection = this.uiElement?.querySelector('#recruit-skills-section');
    const purchaseSection = this.uiElement?.querySelector('#recruit-purchase-section');
    const traitsList = this.uiElement?.querySelector('#recruit-traits-list');
    const skillsList = this.uiElement?.querySelector('#recruit-skills-list');
    const purchasePrice = this.uiElement?.querySelector('#recruit-purchase-price');
    const purchaseBtn = this.uiElement?.querySelector('#recruit-purchase-btn');

    if (!this.selectedRecruit) {
      // Clear and hide detail sections
      if (cardContainer) {
        cardContainer.innerHTML = '<div class="recruit-empty-state">Select a recruit to view details</div>';
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
      // Transform recruit data to match ParchmentCard expected format
      const cardData = {
        id: recruit.id,
        name: recruit.name,
        race: recruit.race,
        class: recruit.class,
        gender: recruit.gender,
        level: recruit.level || 1,
        hp_current: recruit.stats?.hpMax,
        hp_max: recruit.stats?.hpMax,
        mp_current: recruit.stats?.mpMax,
        mp_max: recruit.stats?.mpMax,
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
        <div class="recruit-detail-trait ${t.rarity}">
          <div class="recruit-trait-name">${t.name}</div>
          <div class="recruit-trait-desc">${t.description || 'No description'}</div>
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
        <div class="recruit-detail-skill">
          <div class="recruit-skill-name">${this.formatSkillId(s)}</div>
          <div class="recruit-skill-desc">Pre-learned at level 1</div>
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
      purchaseBtn.textContent = canAfford ? 'Recruit' : 'Not Enough Gold';
    }
  }

  async handlePurchase() {
    if (!this.selectedRecruit) return;

    const recruit = this.selectedRecruit;
    if (this.playerGold < recruit.price) {
      parchmentToast.error('Insufficient Gold', 'Not enough gold');
      return;
    }

    // Confirm purchase
    const confirmed = confirm(`Recruit ${recruit.name} for ${recruit.price}g?`);
    if (!confirmed) return;

    try {
      const result = await this.game.api.purchaseRecruit(this.nodeId, recruit.id);

      // Update local gold
      this.playerGold = result.remainingGold;
      this.game.state.set('user', { ...this.game.state.get('user'), gold: result.remainingGold });
      this.updateGoldDisplay();

      // Show success
      parchmentToast.success('Recruited!', result.message || `Successfully recruited ${recruit.name}!`);

      // Remove from local list and refresh
      this.recruits = this.recruits.filter(r => r.id !== recruit.id);
      this.selectedRecruit = null;
      this.updateUI();

    } catch (err) {
      parchmentToast.error('Recruit Failed', err.message || 'Failed to purchase recruit');
    }
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement?.querySelector('#recruit-player-gold');
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
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

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
    ctx.moveTo(ctx.canvas.width - 20, 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, 20, ctx.canvas.width - 60, 20);
    ctx.stroke();

    // Bottom-left flourish
    ctx.beginPath();
    ctx.moveTo(20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(20, ctx.canvas.height - 20, 60, ctx.canvas.height - 20);
    ctx.stroke();

    // Bottom-right flourish
    ctx.beginPath();
    ctx.moveTo(ctx.canvas.width - 20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, ctx.canvas.height - 20, ctx.canvas.width - 60, ctx.canvas.height - 20);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }
}
