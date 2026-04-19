import { Scene } from './Scene.js';
import { responsive } from '../core/Responsive.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentScrollbarCSS,
  getParchmentSpinnerCSS
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { Icon } from '../components/Icon.js';

const P = PARCHMENT_COLORS;
const STYLE_ID = 'guild-advancement-styles';

// Guild names and descriptions
const GUILD_INFO = {
  warrior: { name: 'Warriors Guild', icon: '⚔️', description: 'Masters of martial combat and physical prowess' },
  wizard: { name: 'Mages Guild', icon: '🔮', description: 'Wielders of arcane magic and mystical knowledge' },
  monk: { name: 'Monks Order', icon: '👊', description: 'Disciples of body and spirit, masters of martial arts' },
  chemist: { name: 'Alchemists Guild', icon: '⚗️', description: 'Crafters of potions and masters of transmutation' }
};

// Tier names for display
const TIER_NAMES = ['Initiate', 'Adept', 'Expert', 'Master'];

/**
 * GuildAdvancementScene - Class advancement quest interface
 * Displays available advancement quests, current quest progress,
 * and guildmaster interactions for boss trials
 */
export class GuildAdvancementScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;
    this.responsiveUnsubscribe = null;

    // Scene data
    this.nodeId = null;
    this.guildClass = null;
    this.characterId = null;
    this.character = null;

    // Quest data
    this.availableQuests = [];
    this.currentQuest = null;
    this.completedQuests = [];
    this.bossEligibility = null;

    // UI state
    this.activeTab = 'quests'; // 'quests', 'progress', 'guildmaster'
    this.selectedQuest = null;
    this.isLoading = true;
  }

  async enter(data = {}) {
    this.nodeId = data.nodeId;
    this.guildClass = data.guildClass;
    this.isLoading = true;

    // Get lead character
    const party = this.game.state.get('party');
    if (!party?.formation || party.formation.length === 0) {
      parchmentToast.error('No Character', 'You need a character to access the guild');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.characterId = party.formation[0];
    const characters = this.game.state.get('characters') || [];
    this.character = characters.find(c => c.id === this.characterId);

    if (!this.character) {
      parchmentToast.error('Character Error', 'Could not find your character');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.abortController = new AbortController();
    this.addStyles();
    this.createUI();
    this.setupEventListeners();

    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Play guild advancement music
    if (this.game.musicContext) {
      this.game.musicContext.playGuildAdvancement();
    }

    await this.loadData();
  }

  exit() {
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  onBreakpointChange() {
    if (this.uiElement) {
      const prevTab = this.activeTab;
      const prevSelected = this.selectedQuest;

      // Abort existing event listeners before recreating UI
      if (this.abortController) {
        this.abortController.abort();
      }
      this.abortController = new AbortController();

      this.uiElement.remove();
      this.createUI();
      this.setupEventListeners();
      this.activeTab = prevTab;
      this.selectedQuest = prevSelected;
      this.updateUI();
    }
  }

  async loadData() {
    try {
      const [questsRes, currentRes, historyRes, bossRes] = await Promise.all([
        this.game.api.getAvailableAdvancementQuests(this.characterId),
        this.game.api.getCurrentAdvancementQuest(this.characterId),
        this.game.api.getAdvancementHistory(this.characterId),
        this.game.api.checkBossTrialEligibility(this.characterId)
      ]);

      this.availableQuests = questsRes.availableQuests || [];
      this.currentQuest = currentRes.hasActiveQuest ? currentRes.quest : null;
      this.completedQuests = historyRes.completedQuests || [];
      this.bossEligibility = bossRes;
      this.isLoading = false;

      // Auto-switch to progress tab if there's an active quest
      if (this.currentQuest && this.activeTab === 'quests') {
        this.activeTab = 'progress';
      }

      this.updateUI();
    } catch (err) {
      console.error('Failed to load advancement data:', err);
      parchmentToast.error('Load Error', 'Failed to load advancement data');
      this.isLoading = false;
      this.updateUI();
    }
  }

  addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .advancement-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: ${getParchmentGradientTextured()};
        display: flex;
        flex-direction: column;
        font-family: Georgia, 'Times New Roman', serif;
        color: ${P.text.primary};
      }

      .advancement-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder(3)};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .advancement-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .advancement-title h2 {
        margin: 0;
        color: ${P.text.primary};
        font-size: 22px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .advancement-title .guild-icon {
        font-size: 28px;
      }

      .advancement-subtitle {
        font-size: 13px;
        color: ${P.text.secondary};
        margin-top: 2px;
      }

      .character-info {
        text-align: right;
      }

      .character-name {
        color: ${P.text.primary};
        font-weight: bold;
        font-size: 14px;
      }

      .character-class {
        color: ${P.text.secondary};
        font-size: 12px;
        text-transform: capitalize;
      }

      .advancement-tabs {
        display: flex;
        gap: 4px;
        padding: 12px 24px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.light});
        border-bottom: ${getParchmentBorder()};
      }

      .advancement-tab {
        padding: 10px 24px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 2px solid ${P.border};
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        color: ${P.text.secondary};
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
        font-weight: bold;
        font-family: Georgia, serif;
      }

      .advancement-tab:hover {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        color: ${P.text.primary};
      }

      .advancement-tab.active {
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        border-color: ${P.accent.burgundy};
        color: ${P.text.primary};
        box-shadow: 0 -2px 6px rgba(107, 45, 61, 0.3);
      }

      .advancement-tab .tab-badge {
        background: ${P.state.success};
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: 6px;
      }

      .advancement-content {
        flex: 1;
        display: flex;
        padding: 16px;
        gap: 16px;
        overflow: hidden;
      }

      @media (max-width: 768px) {
        .advancement-content {
          flex-direction: column;
        }
        .advancement-detail-panel {
          width: 100% !important;
          max-height: 300px;
        }
      }

      .advancement-list-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: 6px;
        box-shadow: ${getParchmentShadow()};
        overflow: hidden;
      }

      .panel-header {
        padding: 12px 16px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        color: ${P.text.primary};
        font-weight: bold;
        font-size: 14px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .quest-list {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      .quest-card {
        background: ${getParchmentGradient()};
        border: 2px solid ${P.border};
        border-radius: 6px;
        padding: 16px;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
      }

      .quest-card:hover {
        border-color: ${P.accent.burgundy};
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .quest-card.selected {
        border-color: ${P.accent.burgundy};
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        box-shadow: 0 0 0 2px rgba(107, 45, 61, 0.3);
      }

      .quest-card.locked {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .quest-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }

      .quest-name {
        font-weight: bold;
        color: ${P.text.primary};
        font-size: 15px;
      }

      .quest-tier {
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
      }

      .tier-1 { background: #4caf50; color: white; }
      .tier-2 { background: #2196f3; color: white; }
      .tier-3 { background: #9c27b0; color: white; }
      .tier-4 { background: #ff9800; color: white; }

      .quest-target {
        color: ${P.state.info};
        font-size: 13px;
        margin-bottom: 8px;
        text-transform: capitalize;
      }

      .quest-desc {
        color: ${P.text.secondary};
        font-size: 12px;
        font-style: italic;
        line-height: 1.4;
      }

      .advancement-detail-panel {
        width: 320px;
        display: flex;
        flex-direction: column;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: 6px;
        box-shadow: ${getParchmentShadow()};
        overflow: hidden;
      }

      .detail-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 16px;
        overflow-y: auto;
      }

      .detail-header {
        text-align: center;
        padding-bottom: 16px;
        border-bottom: 1px solid ${P.border};
        margin-bottom: 16px;
      }

      .detail-name {
        font-size: 18px;
        font-weight: bold;
        color: ${P.text.primary};
        margin-bottom: 4px;
      }

      .detail-class {
        color: ${P.state.info};
        font-size: 14px;
        text-transform: capitalize;
      }

      .requirements-section {
        margin-bottom: 16px;
      }

      .requirements-title {
        color: ${P.text.primary};
        font-weight: bold;
        font-size: 13px;
        margin-bottom: 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid ${P.border};
      }

      .requirement-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
        font-size: 12px;
      }

      .requirement-label {
        color: ${P.text.secondary};
      }

      .requirement-value {
        font-weight: bold;
      }

      .requirement-value.complete {
        color: ${P.state.success};
      }

      .requirement-value.incomplete {
        color: ${P.text.secondary};
      }

      .progress-bar-container {
        margin-top: 4px;
        height: 6px;
        background: ${P.dark};
        border-radius: 3px;
        overflow: hidden;
      }

      .progress-bar-fill {
        height: 100%;
        background: ${P.state.success};
        transition: width 0.3s ease;
      }

      .rewards-section {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border: 1px solid ${P.border};
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .rewards-title {
        color: ${P.text.primary};
        font-weight: bold;
        font-size: 12px;
        margin-bottom: 8px;
      }

      .reward-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: ${P.text.secondary};
        padding: 4px 0;
      }

      .reward-icon {
        font-size: 14px;
      }

      .detail-actions {
        margin-top: auto;
        padding-top: 16px;
        border-top: 1px solid ${P.border};
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .action-btn {
        width: 100%;
        padding: 12px;
        font-size: 14px;
        font-weight: bold;
        font-family: Georgia, serif;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .action-btn.primary {
        background: linear-gradient(to bottom, ${P.state.info}, #3a5068);
        border: 2px solid ${P.borderDark};
        color: white;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .action-btn.primary:hover:not(:disabled) {
        background: linear-gradient(to bottom, #3a5068, ${P.state.info});
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .action-btn.danger {
        background: linear-gradient(to bottom, ${P.state.error}, #6b2020);
        border: 2px solid ${P.borderDark};
        color: white;
      }

      .action-btn.danger:hover:not(:disabled) {
        background: linear-gradient(to bottom, #6b2020, ${P.state.error});
      }

      .action-btn.boss {
        background: linear-gradient(to bottom, #ff9800, #f57c00);
        border: 2px solid ${P.borderDark};
        color: white;
      }

      .action-btn.boss:hover:not(:disabled) {
        background: linear-gradient(to bottom, #f57c00, #ff9800);
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .back-btn {
        padding: 10px 20px;
        font-size: 14px;
        font-weight: bold;
        font-family: Georgia, serif;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 2px solid ${P.border};
        border-radius: 6px;
        color: ${P.text.primary};
        cursor: pointer;
        transition: all 0.2s;
      }

      .back-btn:hover {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border-color: ${P.borderDark};
      }

      .empty-message {
        text-align: center;
        color: ${P.text.muted};
        padding: 40px 20px;
        font-size: 14px;
        font-style: italic;
      }

      .guildmaster-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .guildmaster-portrait {
        text-align: center;
        padding: 20px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border: ${getParchmentBorder()};
        border-radius: 6px;
      }

      .guildmaster-icon {
        font-size: 64px;
        margin-bottom: 12px;
      }

      .guildmaster-name {
        color: ${P.text.primary};
        font-weight: bold;
        font-size: 18px;
        margin-bottom: 4px;
      }

      .guildmaster-title {
        color: ${P.text.secondary};
        font-size: 13px;
        font-style: italic;
      }

      .guildmaster-dialog {
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: ${getParchmentBorder()};
        border-radius: 6px;
        padding: 16px;
      }

      .dialog-text {
        color: ${P.text.primary};
        font-size: 14px;
        line-height: 1.6;
        font-style: italic;
      }

      .dialog-text::before {
        content: '"';
        color: ${P.accent.burgundy};
        font-size: 20px;
      }

      .dialog-text::after {
        content: '"';
        color: ${P.accent.burgundy};
        font-size: 20px;
      }

      .boss-ready-badge {
        display: inline-block;
        background: linear-gradient(to bottom, #ff9800, #f57c00);
        color: white;
        padding: 6px 12px;
        border-radius: 4px;
        font-weight: bold;
        font-size: 12px;
        margin-top: 12px;
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      .level-warning {
        background: ${P.state.warning};
        color: ${P.text.primary};
        padding: 12px;
        border-radius: 4px;
        text-align: center;
        font-size: 13px;
      }

      /* Themed Scrollbars */
      ${getParchmentScrollbarCSS('.quest-list')}
      ${getParchmentScrollbarCSS('.advancement-list-panel')}
      ${getParchmentScrollbarCSS('.advancement-detail-panel')}

      /* Parchment Spinner */
      ${getParchmentSpinnerCSS()}
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const guildInfo = GUILD_INFO[this.guildClass] || { name: 'Guild Hall', icon: '🏛️', description: '' };

    const container = document.createElement('div');
    container.className = 'advancement-container';

    container.innerHTML = `
      <div class="advancement-header">
        <div class="advancement-title">
          <span class="guild-icon">${guildInfo.icon}</span>
          <div>
            <h2>${guildInfo.name}</h2>
            <div class="advancement-subtitle">${guildInfo.description}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <div class="character-info">
            <div class="character-name">${this.character?.name || 'Unknown'}</div>
            <div class="character-class">${this.character?.class || 'Unknown'} Lv.${this.character?.level || 1}</div>
          </div>
          <button class="back-btn" id="back-btn">Back to Map</button>
        </div>
      </div>

      <div class="advancement-tabs">
        <div class="advancement-tab ${this.activeTab === 'quests' ? 'active' : ''}" data-tab="quests">
          Quest Board
          ${this.availableQuests.length > 0 ? `<span class="tab-badge">${this.availableQuests.length}</span>` : ''}
        </div>
        <div class="advancement-tab ${this.activeTab === 'progress' ? 'active' : ''}" data-tab="progress">
          Current Quest
          ${this.currentQuest ? '<span class="tab-badge">1</span>' : ''}
        </div>
        <div class="advancement-tab ${this.activeTab === 'guildmaster' ? 'active' : ''}" data-tab="guildmaster">
          Guildmaster
          ${this.bossEligibility?.eligible ? '<span class="tab-badge">!</span>' : ''}
        </div>
      </div>

      <div class="advancement-content">
        <div class="advancement-list-panel">
          <div class="panel-header" id="list-header">Available Quests</div>
          <div class="quest-list" id="quest-list">
            <div class="empty-message">Loading...</div>
          </div>
        </div>

        <div class="advancement-detail-panel">
          <div class="panel-header">Details</div>
          <div class="detail-content" id="detail-content">
            <div class="empty-message">Select a quest to view details</div>
          </div>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  setupEventListeners() {
    const opts = { signal: this.abortController.signal };

    this.uiElement.querySelector('#back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    this.uiElement.querySelectorAll('.advancement-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        this.selectedQuest = null;
        this.updateUI();
      }, opts);
    });
  }

  updateUI() {
    // Update tab states
    this.uiElement.querySelectorAll('.advancement-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === this.activeTab);
    });

    // Update content based on active tab
    switch (this.activeTab) {
      case 'quests':
        this.renderQuestBoard();
        break;
      case 'progress':
        this.renderQuestProgress();
        break;
      case 'guildmaster':
        this.renderGuildmaster();
        break;
    }
  }

  renderQuestBoard() {
    const listHeader = this.uiElement.querySelector('#list-header');
    const listEl = this.uiElement.querySelector('#quest-list');
    const _detailEl = this.uiElement.querySelector('#detail-content');

    listHeader.textContent = 'Available Advancement Quests';

    if (this.isLoading) {
      listEl.innerHTML = '<div class="empty-message">Loading quests...</div>';
      return;
    }

    if (this.currentQuest) {
      listEl.innerHTML = `
        <div class="empty-message">
          You already have an active advancement quest.<br>
          Complete or abandon it before starting a new one.
        </div>
      `;
      this.renderQuestDetail(null);
      return;
    }

    if (this.character?.level < 10) {
      listEl.innerHTML = `
        <div class="level-warning">
          You must reach level 10 before you can start advancement quests.
          <br><br>
          Current Level: ${this.character?.level || 1}
        </div>
      `;
      this.renderQuestDetail(null);
      return;
    }

    if (this.availableQuests.length === 0) {
      listEl.innerHTML = `
        <div class="empty-message">
          No advancement quests available for your character at this time.
          <br><br>
          You may have already completed all available tiers.
        </div>
      `;
      this.renderQuestDetail(null);
      return;
    }

    listEl.innerHTML = this.availableQuests.map(quest => `
      <div class="quest-card ${this.selectedQuest?.id === quest.id ? 'selected' : ''}"
           data-quest-id="${quest.id}">
        <div class="quest-header">
          <div class="quest-name">${quest.questName}</div>
          <div class="quest-tier tier-${quest.tier}">${TIER_NAMES[quest.tier - 1] || `T${quest.tier}`}</div>
        </div>
        <div class="quest-target">Advance to: ${quest.targetClass.replace('_', ' ')}</div>
        <div class="quest-desc">${quest.questDescription}</div>
      </div>
    `).join('');

    // Add click handlers
    listEl.querySelectorAll('.quest-card').forEach(card => {
      card.addEventListener('click', () => {
        const questId = parseInt(card.dataset.questId);
        this.selectedQuest = this.availableQuests.find(q => q.id === questId);
        this.renderQuestBoard();
      });
    });

    this.renderQuestDetail(this.selectedQuest);
  }

  renderQuestProgress() {
    const listHeader = this.uiElement.querySelector('#list-header');
    const listEl = this.uiElement.querySelector('#quest-list');

    listHeader.textContent = 'Current Advancement Quest';

    if (this.isLoading) {
      listEl.innerHTML = '<div class="empty-message">Loading...</div>';
      return;
    }

    if (!this.currentQuest) {
      listEl.innerHTML = `
        <div class="empty-message">
          You don't have an active advancement quest.<br><br>
          Visit the Quest Board to accept one!
        </div>
      `;
      this.renderProgressDetail(null);
      return;
    }

    const quest = this.currentQuest;

    listEl.innerHTML = `
      <div class="quest-card selected">
        <div class="quest-header">
          <div class="quest-name">${quest.questName}</div>
          <div class="quest-tier tier-${quest.tier}">${TIER_NAMES[quest.tier - 1] || `T${quest.tier}`}</div>
        </div>
        <div class="quest-target">Advance to: ${quest.targetClass.replace('_', ' ')}</div>
        <div class="quest-desc">${quest.questDescription}</div>
      </div>
    `;

    this.renderProgressDetail(quest);
  }

  renderProgressDetail(quest) {
    const detailEl = this.uiElement.querySelector('#detail-content');

    if (!quest) {
      detailEl.innerHTML = '<div class="empty-message">No active quest</div>';
      return;
    }

    const { materialProgress, enemyProgress, nodeProgress } = quest;

    let requirementsHtml = '';

    // Material requirements
    if (quest.materialRequirements?.length > 0) {
      const matItems = quest.materialRequirements.map(req => {
        const current = materialProgress?.[req.itemId] || 0;
        const complete = current >= req.quantity;
        const pct = Math.min(100, (current / req.quantity) * 100);
        return `
          <div class="requirement-item">
            <span class="requirement-label">${req.name || req.itemId}</span>
            <span class="requirement-value ${complete ? 'complete' : 'incomplete'}">
              ${current}/${req.quantity}
            </span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${pct}%"></div>
          </div>
        `;
      }).join('');

      requirementsHtml += `
        <div class="requirements-section">
          <div class="requirements-title">Materials</div>
          ${matItems}
        </div>
      `;
    }

    // Enemy requirements
    if (quest.enemyRequirements?.length > 0) {
      const enemyItems = quest.enemyRequirements.map(req => {
        const current = enemyProgress?.[req.type] || 0;
        const complete = current >= req.count;
        const pct = Math.min(100, (current / req.count) * 100);
        return `
          <div class="requirement-item">
            <span class="requirement-label">Defeat ${req.type}</span>
            <span class="requirement-value ${complete ? 'complete' : 'incomplete'}">
              ${current}/${req.count}
            </span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${pct}%"></div>
          </div>
        `;
      }).join('');

      requirementsHtml += `
        <div class="requirements-section">
          <div class="requirements-title">Combat</div>
          ${enemyItems}
        </div>
      `;
    }

    // Node requirements
    if (quest.nodeRequirements?.length > 0) {
      const nodeItems = quest.nodeRequirements.map(req => {
        const visited = nodeProgress?.[req.nodeType] || 0;
        const complete = visited >= req.count;
        const pct = Math.min(100, (visited / req.count) * 100);
        return `
          <div class="requirement-item">
            <span class="requirement-label">Visit ${req.nodeType} nodes</span>
            <span class="requirement-value ${complete ? 'complete' : 'incomplete'}">
              ${visited}/${req.count}
            </span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${pct}%"></div>
          </div>
        `;
      }).join('');

      requirementsHtml += `
        <div class="requirements-section">
          <div class="requirements-title">Exploration</div>
          ${nodeItems}
        </div>
      `;
    }

    const canStartBoss = this.bossEligibility?.eligible;

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">${quest.questName}</div>
        <div class="detail-class">${quest.targetClass.replace('_', ' ')}</div>
      </div>

      ${requirementsHtml || '<div class="empty-message">No requirements</div>'}

      <div class="rewards-section">
        <div class="rewards-title">Rewards</div>
        <div class="reward-item"><span class="reward-icon">⭐</span> Class: ${quest.targetClass.replace('_', ' ')}</div>
        ${quest.rewards?.gold ? `<div class="reward-item"><span class="reward-icon">${Icon.html('resources', 'gold', { size: 'sm' })}</span> ${quest.rewards.gold} Gold</div>` : ''}
        ${quest.rewards?.xp ? `<div class="reward-item"><span class="reward-icon">✨</span> ${quest.rewards.xp} XP</div>` : ''}
        ${quest.rewards?.title ? `<div class="reward-item"><span class="reward-icon">🏆</span> Title: ${quest.rewards.title}</div>` : ''}
      </div>

      <div class="detail-actions">
        ${canStartBoss ? `
          <button class="action-btn boss" id="start-boss-btn">
            Challenge Guildmaster
          </button>
        ` : `
          <button class="action-btn primary" disabled>
            Complete Requirements First
          </button>
        `}
        <button class="action-btn danger" id="abandon-btn">Abandon Quest</button>
      </div>
    `;

    // Add event listeners with abort signal for cleanup
    const opts = { signal: this.abortController.signal };
    detailEl.querySelector('#start-boss-btn')?.addEventListener('click', () => this.handleStartBossTrial(), opts);
    detailEl.querySelector('#abandon-btn')?.addEventListener('click', () => this.handleAbandonQuest(), opts);
  }

  renderQuestDetail(quest) {
    const detailEl = this.uiElement.querySelector('#detail-content');

    if (!quest) {
      detailEl.innerHTML = '<div class="empty-message">Select a quest to view details</div>';
      return;
    }

    let requirementsHtml = '';

    // Material requirements
    if (quest.materialRequirements?.length > 0) {
      const items = quest.materialRequirements.map(req => `
        <div class="requirement-item">
          <span class="requirement-label">${req.name || req.itemId}</span>
          <span class="requirement-value incomplete">0/${req.quantity}</span>
        </div>
      `).join('');
      requirementsHtml += `
        <div class="requirements-section">
          <div class="requirements-title">Materials Required</div>
          ${items}
        </div>
      `;
    }

    // Enemy requirements
    if (quest.enemyRequirements?.length > 0) {
      const items = quest.enemyRequirements.map(req => `
        <div class="requirement-item">
          <span class="requirement-label">Defeat ${req.type}</span>
          <span class="requirement-value incomplete">0/${req.count}</span>
        </div>
      `).join('');
      requirementsHtml += `
        <div class="requirements-section">
          <div class="requirements-title">Combat Requirements</div>
          ${items}
        </div>
      `;
    }

    // Node requirements
    if (quest.nodeRequirements?.length > 0) {
      const items = quest.nodeRequirements.map(req => `
        <div class="requirement-item">
          <span class="requirement-label">Visit ${req.nodeType} nodes</span>
          <span class="requirement-value incomplete">0/${req.count}</span>
        </div>
      `).join('');
      requirementsHtml += `
        <div class="requirements-section">
          <div class="requirements-title">Exploration Requirements</div>
          ${items}
        </div>
      `;
    }

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">${quest.questName}</div>
        <div class="detail-class">${quest.targetClass.replace('_', ' ')}</div>
      </div>

      ${requirementsHtml || '<div class="empty-message">No specific requirements</div>'}

      <div class="rewards-section">
        <div class="rewards-title">Rewards</div>
        <div class="reward-item"><span class="reward-icon">⭐</span> Class: ${quest.targetClass.replace('_', ' ')}</div>
        ${quest.rewards?.gold ? `<div class="reward-item"><span class="reward-icon">${Icon.html('resources', 'gold', { size: 'sm' })}</span> ${quest.rewards.gold} Gold</div>` : ''}
        ${quest.rewards?.xp ? `<div class="reward-item"><span class="reward-icon">✨</span> ${quest.rewards.xp} XP</div>` : ''}
        ${quest.rewards?.title ? `<div class="reward-item"><span class="reward-icon">🏆</span> Title: ${quest.rewards.title}</div>` : ''}
      </div>

      <div class="detail-actions">
        <button class="action-btn primary" id="accept-btn">Accept Quest</button>
      </div>
    `;

    // Add event listener with abort signal for cleanup
    const opts = { signal: this.abortController.signal };
    detailEl.querySelector('#accept-btn')?.addEventListener('click', () => this.handleAcceptQuest(quest), opts);
  }

  renderGuildmaster() {
    const listHeader = this.uiElement.querySelector('#list-header');
    const listEl = this.uiElement.querySelector('#quest-list');
    const detailEl = this.uiElement.querySelector('#detail-content');

    listHeader.textContent = 'Guildmaster';

    const guildInfo = GUILD_INFO[this.guildClass] || { name: 'Guild', icon: '🏛️' };

    let dialogText = '';
    let actionHtml = '';

    if (this.bossEligibility?.eligible) {
      dialogText = `You have proven yourself worthy, ${this.character?.name}.
        Your quest is complete, and now you must face the final trial.
        Defeat me in combat to earn the right to advance to ${this.bossEligibility.targetClass?.replace('_', ' ')}.`;
      actionHtml = `
        <button class="action-btn boss" id="gm-boss-btn">
          Begin Boss Trial
        </button>
      `;
    } else if (this.currentQuest) {
      dialogText = `You have embarked on the path of advancement, ${this.character?.name}.
        Complete your quest objectives and return to me when you are ready for the final trial.`;
      actionHtml = `
        <button class="action-btn primary" disabled>
          Complete Quest First
        </button>
      `;
    } else if (this.character?.level < 10) {
      dialogText = `Greetings, young ${this.character?.class}. You show promise, but you must first
        gain more experience before you can walk the path of advancement.
        Return when you have reached level 10.`;
      actionHtml = `
        <div class="level-warning">Requires Level 10</div>
      `;
    } else {
      dialogText = `Welcome to the ${guildInfo.name}, ${this.character?.name}.
        When you are ready to advance your skills, visit the Quest Board and accept an advancement quest.
        Complete the quest objectives and return to challenge me for your advancement.`;
      actionHtml = `
        <button class="action-btn primary" id="gm-quests-btn">
          View Quest Board
        </button>
      `;
    }

    listEl.innerHTML = `
      <div class="guildmaster-panel">
        <div class="guildmaster-portrait">
          <div class="guildmaster-icon">${guildInfo.icon}</div>
          <div class="guildmaster-name">${guildInfo.name.replace(' Guild', '').replace(' Order', '')} Guildmaster</div>
          <div class="guildmaster-title">Master of the ${guildInfo.name}</div>
          ${this.bossEligibility?.eligible ? '<div class="boss-ready-badge">READY FOR TRIAL</div>' : ''}
        </div>

        <div class="guildmaster-dialog">
          <div class="dialog-text">${dialogText}</div>
        </div>
      </div>
    `;

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">Advancement Status</div>
      </div>

      <div class="requirements-section">
        <div class="requirements-title">Your Progress</div>
        <div class="requirement-item">
          <span class="requirement-label">Character Level</span>
          <span class="requirement-value ${this.character?.level >= 10 ? 'complete' : 'incomplete'}">
            ${this.character?.level || 1}
          </span>
        </div>
        <div class="requirement-item">
          <span class="requirement-label">Current Class</span>
          <span class="requirement-value">${this.character?.class || 'Unknown'}</span>
        </div>
        <div class="requirement-item">
          <span class="requirement-label">Active Quest</span>
          <span class="requirement-value ${this.currentQuest ? 'complete' : 'incomplete'}">
            ${this.currentQuest ? 'Yes' : 'None'}
          </span>
        </div>
        <div class="requirement-item">
          <span class="requirement-label">Completed Tiers</span>
          <span class="requirement-value">${this.completedQuests.length}</span>
        </div>
      </div>

      <div class="detail-actions">
        ${actionHtml}
      </div>
    `;

    // Add event listeners with abort signal for cleanup
    const opts = { signal: this.abortController.signal };
    listEl.querySelector('#gm-boss-btn')?.addEventListener('click', () => this.handleStartBossTrial(), opts);
    detailEl.querySelector('#gm-boss-btn')?.addEventListener('click', () => this.handleStartBossTrial(), opts);
    detailEl.querySelector('#gm-quests-btn')?.addEventListener('click', () => {
      this.activeTab = 'quests';
      this.updateUI();
    }, opts);
  }

  async handleAcceptQuest(quest) {
    try {
      const result = await this.game.api.acceptAdvancementQuest(this.characterId, quest.id);
      parchmentToast.success('Quest Accepted', result.message);
      await this.loadData();
      this.activeTab = 'progress';
      this.updateUI();
    } catch (err) {
      parchmentToast.error('Failed to Accept', err.message);
    }
  }

  async handleAbandonQuest() {
    if (!confirm('Are you sure you want to abandon this quest? All progress will be lost.')) {
      return;
    }

    try {
      const result = await this.game.api.abandonAdvancementQuest(this.characterId);
      parchmentToast.info('Quest Abandoned', result.message);
      await this.loadData();
      this.activeTab = 'quests';
      this.updateUI();
    } catch (err) {
      parchmentToast.error('Failed to Abandon', err.message);
    }
  }

  async handleStartBossTrial() {
    if (!this.bossEligibility?.eligible) {
      parchmentToast.error('Not Ready', 'Complete quest requirements first');
      return;
    }

    try {
      const result = await this.game.api.startBossTrial(this.characterId);

      // Switch to battle scene
      this.game.scenes.switchTo('battle', {
        battleId: result.battleId,
        state: result.state,
        mapSeed: result.mapSeed,
        mapWidth: result.mapWidth,
        mapHeight: result.mapHeight,
        isBossBattle: true,
        guildmaster: result.guildmaster,
        availableActions: result.availableActions
      });
    } catch (err) {
      parchmentToast.error('Boss Trial Failed', err.message);
    }
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // Draw parchment background
    const gradient = ctx.createLinearGradient(0, 0, 0, this.game.targetHeight);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);
  }
}
