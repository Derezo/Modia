import { Scene } from './Scene.js';
import { ParchmentCard } from '../components/ParchmentCard.js';

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
      this.game.showNotification('Invalid guild data', 'error');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.abortController = new AbortController();
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    await this.loadData();
    this.startCountdownTimer();
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
      this.game.showNotification('Failed to load guild recruits', 'error');
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

    const countdownEl = this.uiElement?.querySelector('#refresh-countdown');
    if (countdownEl) {
      countdownEl.textContent = this.refreshCountdown;
    }
  }

  addStyles() {
    if (document.getElementById('recruitment-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'recruitment-scene-styles';
    style.textContent = `
      .recruitment-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        display: flex;
        flex-direction: column;
      }

      /* Header */
      .recruitment-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 20px;
        background: rgba(0,0,0,0.4);
        border-bottom: 2px solid #4a4a6a;
      }

      .recruitment-title-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .recruitment-title {
        margin: 0;
        font-size: 20px;
        color: #ffd700;
        text-transform: capitalize;
      }

      .recruitment-subtitle {
        color: #8a8aaa;
        font-size: 12px;
      }

      .recruitment-header-right {
        display: flex;
        align-items: center;
        gap: 20px;
      }

      .recruitment-gold {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #ffd700;
        font-size: 16px;
        font-weight: bold;
      }

      .recruitment-refresh {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #8a8aaa;
        font-size: 13px;
      }

      .recruitment-refresh-icon {
        color: #6ab0f3;
      }

      /* Main Content */
      .recruitment-content {
        flex: 1;
        display: flex;
        padding: 16px;
        gap: 16px;
        overflow: hidden;
      }

      /* Recruits Panel */
      .recruits-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .recruits-grid {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
        padding: 8px;
      }

      /* Recruit Card */
      .recruit-card {
        background:
          linear-gradient(135deg, rgba(180, 160, 130, 0.1) 0%, transparent 50%),
          linear-gradient(225deg, rgba(100, 80, 60, 0.1) 0%, transparent 50%),
          linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-radius: 6px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
      }

      .recruit-card:hover {
        border-color: #a08060;
        transform: translateY(-2px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
      }

      .recruit-card.selected {
        border-color: #ffd700;
        box-shadow: 0 0 15px rgba(255, 215, 0, 0.3);
      }

      .recruit-card.sold {
        opacity: 0.5;
        cursor: not-allowed;
        filter: grayscale(0.5);
      }

      .recruit-card-header {
        display: flex;
        gap: 12px;
        margin-bottom: 10px;
      }

      .recruit-portrait {
        width: 56px;
        height: 56px;
        border: 2px solid #6b5344;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
        background: rgba(0, 0, 0, 0.2);
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
        font-size: 14px;
        font-weight: bold;
        color: #2d2418;
        margin-bottom: 2px;
        font-family: 'Georgia', serif;
      }

      .recruit-subtitle {
        font-size: 11px;
        color: #5a4a3a;
        margin-bottom: 4px;
      }

      .recruit-price {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        font-weight: bold;
        color: #8b6914;
      }

      .recruit-price.cannot-afford {
        color: #8b4444;
      }

      /* Stats Row */
      .recruit-stats-row {
        display: flex;
        justify-content: space-between;
        gap: 4px;
        margin-bottom: 8px;
        padding: 4px 0;
        border-top: 1px solid rgba(0, 0, 0, 0.1);
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      }

      .recruit-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-size: 10px;
      }

      .recruit-stat-label {
        font-weight: bold;
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
        color: #2d2418;
        font-weight: bold;
      }

      /* Traits/Skills badges */
      .recruit-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .recruit-badge {
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: bold;
      }

      .recruit-badge.trait {
        background: rgba(139, 90, 43, 0.3);
        color: #5a3d1a;
        border: 1px solid rgba(139, 90, 43, 0.5);
      }

      .recruit-badge.trait.uncommon {
        background: rgba(76, 175, 80, 0.2);
        color: #2d5a30;
        border-color: rgba(76, 175, 80, 0.4);
      }

      .recruit-badge.trait.rare {
        background: rgba(33, 150, 243, 0.2);
        color: #1565c0;
        border-color: rgba(33, 150, 243, 0.4);
      }

      .recruit-badge.trait.legendary {
        background: rgba(255, 152, 0, 0.2);
        color: #bf6c00;
        border-color: rgba(255, 152, 0, 0.4);
      }

      .recruit-badge.skill {
        background: rgba(106, 90, 205, 0.2);
        color: #483d8b;
        border: 1px solid rgba(106, 90, 205, 0.4);
      }

      /* Detail Panel */
      .detail-panel {
        width: 340px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .detail-card-container {
        min-height: 100px;
      }

      .detail-section {
        background: rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        padding: 12px;
      }

      .detail-section-title {
        color: #ffd700;
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
        margin-bottom: 8px;
        border-bottom: 1px solid rgba(255, 215, 0, 0.3);
        padding-bottom: 4px;
      }

      .detail-traits-list, .detail-skills-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .detail-trait, .detail-skill {
        padding: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        border-left: 3px solid #8b7355;
      }

      .detail-trait.uncommon { border-left-color: #4caf50; }
      .detail-trait.rare { border-left-color: #2196f3; }
      .detail-trait.legendary { border-left-color: #ff9800; }

      .detail-trait-name, .detail-skill-name {
        font-weight: bold;
        color: #fff;
        font-size: 12px;
        margin-bottom: 2px;
      }

      .detail-trait-desc, .detail-skill-desc {
        color: #8a8aaa;
        font-size: 11px;
        line-height: 1.3;
      }

      /* Purchase Section */
      .purchase-section {
        margin-top: auto;
        padding: 12px;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 8px;
        border: 1px solid #4a4a6a;
      }

      .purchase-price-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .purchase-label {
        color: #8a8aaa;
        font-size: 12px;
      }

      .purchase-price {
        font-size: 18px;
        font-weight: bold;
        color: #ffd700;
      }

      .purchase-price.cannot-afford {
        color: #f44336;
      }

      .purchase-btn {
        width: 100%;
        padding: 12px;
        font-size: 14px;
        font-weight: bold;
        background: linear-gradient(to bottom, #4caf50 0%, #388e3c 100%);
        border: 2px solid #2e7d32;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .purchase-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, #66bb6a 0%, #43a047 100%);
        transform: translateY(-1px);
      }

      .purchase-btn:disabled {
        background: linear-gradient(to bottom, #666 0%, #555 100%);
        border-color: #444;
        cursor: not-allowed;
        opacity: 0.7;
      }

      /* Empty States */
      .empty-state {
        text-align: center;
        color: #8a8aaa;
        padding: 40px 20px;
        font-size: 14px;
      }

      .empty-state-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #8a8aaa;
        font-size: 14px;
      }

      .loading-spinner {
        display: inline-block;
        width: 20px;
        height: 20px;
        border: 2px solid #4a4a6a;
        border-top-color: #ffd700;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-right: 8px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* Empty Slot Card */
      .recruit-card.empty-slot {
        background: rgba(0, 0, 0, 0.2);
        border: 2px dashed #4a4a6a;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        cursor: default;
      }

      .empty-slot-text {
        color: #5a5a7a;
        font-size: 12px;
        text-align: center;
      }

      /* Stat variance indicator */
      .variance-indicator {
        font-size: 10px;
        margin-left: 4px;
      }

      .variance-positive { color: #4caf50; }
      .variance-negative { color: #f44336; }

      /* Responsive */
      @media (max-width: 900px) {
        .recruitment-content {
          flex-direction: column;
        }

        .detail-panel {
          width: 100%;
          max-height: 300px;
          overflow-y: auto;
        }

        .recruits-grid {
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        }
      }
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'recruitment-container';

    const guildTitle = this.guildInfo?.nodeName || `${this.capitalize(this.guildClass || 'Guild')}s Guild`;
    const actionLabel = this.guildInfo?.actionLabel || 'Recruit Member';

    container.innerHTML = `
      <div class="recruitment-header">
        <div class="recruitment-title-section">
          <h2 class="recruitment-title">${guildTitle}</h2>
          <div class="recruitment-subtitle">${actionLabel}</div>
        </div>
        <div class="recruitment-header-right">
          <div class="recruitment-refresh">
            <span class="recruitment-refresh-icon">&#8635;</span>
            <span>Next refresh: <span id="refresh-countdown">--:--</span></span>
          </div>
          <div class="recruitment-gold">
            <span>Gold:</span>
            <span id="player-gold">${this.playerGold}</span>
          </div>
          <button class="btn btn-secondary" id="back-btn">Back to Map</button>
        </div>
      </div>

      <div class="recruitment-content">
        <div class="recruits-panel ui-panel">
          <div class="ui-panel-header">Available Recruits (${this.recruits.length}/10)</div>
          <div class="recruits-grid" id="recruits-grid">
            ${this.isLoading ? '<div class="loading-state"><span class="loading-spinner"></span>Loading recruits...</div>' : ''}
          </div>
        </div>

        <div class="detail-panel">
          <div class="ui-panel">
            <div class="ui-panel-header">Recruit Details</div>
            <div class="detail-card-container" id="detail-card-container">
              <div class="empty-state">Select a recruit to view details</div>
            </div>
          </div>

          <div class="detail-section" id="traits-section" style="display: none;">
            <div class="detail-section-title">Traits</div>
            <div class="detail-traits-list" id="traits-list"></div>
          </div>

          <div class="detail-section" id="skills-section" style="display: none;">
            <div class="detail-section-title">Pre-learned Skills</div>
            <div class="detail-skills-list" id="skills-list"></div>
          </div>

          <div class="purchase-section" id="purchase-section" style="display: none;">
            <div class="purchase-price-row">
              <span class="purchase-label">Recruitment Cost</span>
              <span class="purchase-price" id="purchase-price">0g</span>
            </div>
            <button class="purchase-btn" id="purchase-btn" disabled>Recruit</button>
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
    this.uiElement.querySelector('#back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Purchase button
    this.uiElement.querySelector('#purchase-btn')?.addEventListener('click', () => {
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

    const titleEl = this.uiElement?.querySelector('.recruitment-title');
    const subtitleEl = this.uiElement?.querySelector('.recruitment-subtitle');
    const countEl = this.uiElement?.querySelector('.ui-panel-header');

    if (titleEl) titleEl.textContent = guildTitle;
    if (subtitleEl) subtitleEl.textContent = actionLabel;
    if (countEl) countEl.textContent = `Available Recruits (${this.recruits.length}/10)`;
  }

  renderRecruitGrid() {
    const grid = this.uiElement?.querySelector('#recruits-grid');
    if (!grid) return;

    if (this.isLoading) {
      grid.innerHTML = '<div class="loading-state"><span class="loading-spinner"></span>Loading recruits...</div>';
      return;
    }

    if (this.recruits.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#x1F6D2;</div>
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
        <div class="empty-slot-text">Sold</div>
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
      ? `<span class="variance-indicator ${variance > 0 ? 'variance-positive' : 'variance-negative'}">${variance > 0 ? '+' : ''}${variance.toFixed(0)}%</span>`
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
            <div class="recruit-subtitle">${this.capitalize(recruit.race)} ${this.capitalize(recruit.class)}</div>
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
    const cardContainer = this.uiElement?.querySelector('#detail-card-container');
    const traitsSection = this.uiElement?.querySelector('#traits-section');
    const skillsSection = this.uiElement?.querySelector('#skills-section');
    const purchaseSection = this.uiElement?.querySelector('#purchase-section');
    const traitsList = this.uiElement?.querySelector('#traits-list');
    const skillsList = this.uiElement?.querySelector('#skills-list');
    const purchasePrice = this.uiElement?.querySelector('#purchase-price');
    const purchaseBtn = this.uiElement?.querySelector('#purchase-btn');

    if (!this.selectedRecruit) {
      // Clear and hide detail sections
      if (cardContainer) {
        cardContainer.innerHTML = '<div class="empty-state">Select a recruit to view details</div>';
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
        <div class="detail-trait ${t.rarity}">
          <div class="detail-trait-name">${t.name}</div>
          <div class="detail-trait-desc">${t.description || 'No description'}</div>
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
        <div class="detail-skill">
          <div class="detail-skill-name">${this.formatSkillId(s)}</div>
          <div class="detail-skill-desc">Pre-learned at level 1</div>
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
      this.game.showNotification('Not enough gold', 'error');
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
      this.game.showNotification(result.message || `Successfully recruited ${recruit.name}!`, 'success');

      // Remove from local list and refresh
      this.recruits = this.recruits.filter(r => r.id !== recruit.id);
      this.selectedRecruit = null;
      this.updateUI();

    } catch (err) {
      this.game.showNotification(err.message || 'Failed to purchase recruit', 'error');
    }
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement?.querySelector('#player-gold');
    if (goldEl) {
      goldEl.textContent = this.playerGold;
    }
  }

  // Utility methods
  getPortraitUrl(recruit) {
    const race = recruit.race || 'human';
    const gender = recruit.gender || 'other';
    const charClass = recruit.class || 'warrior';
    return `/assets/sprites/portraits/${race}_${gender}_${charClass}.png`;
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

  update(deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
