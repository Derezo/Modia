/**
 * @module GuildAdvancementScene
 * @description Guild hall screen: lists advancement quests for the party,
 * shows quest detail and rewards, and accepts/abandons/turns in quests.
 */
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
import { escapeHtml } from '../utils/escapeHtml.js';
import {
  buildBossBattleSceneData,
  formatClassName,
  getQuestObjectives,
  isCharacterAtNode,
  selectGuildCharacter
} from './guildAdvancementModel.js';
import { parchmentConfirm } from '../ui/parchment/parchmentConfirm.js';

const P = PARCHMENT_COLORS;
const STYLE_ID = 'guild-advancement-styles';

// Guild names and descriptions
const GUILD_INFO = {
  warrior: { name: "Warriors' Guild", icon: '⚔️', description: 'Masters of martial combat and physical prowess' },
  wizard: { name: "Wizards' Guild", icon: '🔮', description: 'Wielders of arcane magic and mystical knowledge' },
  monk: { name: "Monks' Order", icon: '👊', description: 'Disciples of body and spirit, masters of martial arts' },
  chemist: { name: "Chemists' Guild", icon: '⚗️', description: 'Crafters of potions and masters of transmutation' }
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
    this.guildCharacters = [];

    // Quest data
    this.availableQuests = [];
    this.currentQuest = null;
    this.completedQuests = [];
    this.bossEligibility = null;

    // UI state
    this.activeTab = 'quests'; // 'quests', 'progress', 'training', 'guildmaster'
    this.selectedQuest = null;
    this.isLoading = true;
    this.isBusy = false;
    this.loadSequence = 0;
    this.trainingModal = null;
    this.trainingModalPromise = null;
  }

  async enter(data = {}) {
    this.nodeId = data.nodeId;
    this.guildClass = String(data.guildClass || '').toLowerCase();
    this.activeTab = ['quests', 'progress', 'training', 'guildmaster'].includes(data.activeTab)
      ? data.activeTab
      : 'quests';
    this.isLoading = true;

    // Refresh the roster so class and location checks reflect the server, while
    // retaining the cached roster as a fallback for transient read failures.
    let characters = this.game.state.get('characters') || [];
    try {
      const result = await this.game.api.getCharacters();
      characters = result.characters || [];
      this.game.state.set('characters', characters);
    } catch (err) {
      if (characters.length === 0) {
        console.error('Failed to load characters for the guild:', err);
        parchmentToast.error('Roster Unavailable', 'Your characters could not be loaded. Please try again.');
        this.game.scenes.switchTo('worldMap');
        return;
      }
    }

    if (characters.length === 0) {
      parchmentToast.error('No Characters', 'Create a character before visiting the guild.');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    const selection = selectGuildCharacter({
      characters,
      guildClass: this.guildClass,
      preferredCharacterId: data.characterId,
      activeCharacter: this.game.state.get('activeCharacter'),
      nodeId: this.nodeId
    });
    this.guildCharacters = selection.guildCharacters;
    this.character = selection.character;

    if (!this.character) {
      const className = formatClassName(this.guildClass);
      const hasGuildCharacter = this.guildCharacters.length > 0;
      parchmentToast.error(
        hasGuildCharacter ? `${className} Not Present` : `${className} Required`,
        hasGuildCharacter
          ? `Bring a ${className} guild character to this guild before entering.`
          : `You need a ${className} or one of its advanced classes to use this guild.`
      );
      this.game.scenes.switchTo('worldMap');
      return;
    }
    this.characterId = this.character.id;

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
    this.loadSequence += 1;
    if (this.trainingModal) {
      this.trainingModal.close();
      this.trainingModal = null;
    }
    this.trainingModalPromise = null;
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
    const loadSequence = ++this.loadSequence;
    const characterId = this.characterId;
    this.isLoading = true;
    this.availableQuests = [];
    this.currentQuest = null;
    this.completedQuests = [];
    this.bossEligibility = null;
    if (this.uiElement) this.updateUI();

    try {
      const [questsRes, currentRes, historyRes, bossRes] = await Promise.all([
        this.game.api.getAvailableAdvancementQuests(characterId),
        this.game.api.getCurrentAdvancementQuest(characterId),
        this.game.api.getAdvancementHistory(characterId),
        this.game.api.checkBossTrialEligibility(characterId)
      ]);

      if (loadSequence !== this.loadSequence || characterId !== this.characterId) return;
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
      if (loadSequence !== this.loadSequence || characterId !== this.characterId) return;
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

      .character-switcher {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .character-select {
        min-width: 210px;
        max-width: 300px;
        padding: 8px 10px;
        border: 2px solid ${P.border};
        border-radius: 5px;
        background: ${P.light};
        color: ${P.text.primary};
        font-family: Georgia, serif;
        font-size: 13px;
      }

      .character-select:focus {
        outline: 2px solid ${P.accent.burgundy};
        outline-offset: 1px;
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

      .advancement-tab.busy {
        cursor: wait;
        opacity: 0.55;
        pointer-events: none;
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
        .advancement-header {
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 12px;
          padding: 12px;
        }
        .advancement-header-actions {
          width: 100%;
          justify-content: space-between;
        }
        .character-select {
          min-width: 0;
          max-width: 190px;
        }
        .advancement-tabs {
          padding: 8px 12px;
          overflow-x: auto;
        }
        .advancement-tab {
          flex: 0 0 auto;
          padding: 9px 14px;
        }
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

      .training-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .training-feature {
        padding: 14px;
        border: 1px solid ${P.border};
        border-radius: 6px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      .training-feature-title {
        color: ${P.text.primary};
        font-weight: bold;
        margin-bottom: 6px;
      }

      .training-feature-copy {
        color: ${P.text.secondary};
        font-size: 13px;
        line-height: 1.5;
      }

      .training-character-card {
        padding: 16px;
        border: 2px solid ${P.accent.burgundy};
        border-radius: 6px;
        background: ${getParchmentGradient()};
        text-align: center;
      }

      .training-character-icon {
        font-size: 42px;
        margin-bottom: 8px;
      }

      .training-hint {
        color: ${P.text.muted};
        font-size: 12px;
        line-height: 1.5;
        margin-top: 12px;
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
    const characterOptions = this.guildCharacters.map(character => {
      const present = isCharacterAtNode(character, this.nodeId);
      const selected = String(character.id) === String(this.characterId);
      const label = `${character.name} — Lv.${character.level || 1} ${formatClassName(character.class)}${present ? '' : ' (away)'}`;
      return `<option value="${character.id}"${selected ? ' selected' : ''}${present ? '' : ' disabled'}>${escapeHtml(label)}</option>`;
    }).join('');

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
        <div class="advancement-header-actions" style="display: flex; align-items: center; gap: 16px;">
          <div class="character-switcher">
            <select class="character-select" id="guild-character-select"
                    aria-label="Character visiting this guild"
                    ${this.guildCharacters.filter(character => isCharacterAtNode(character, this.nodeId)).length < 2 ? 'disabled' : ''}>
              ${characterOptions}
            </select>
          </div>
          <div class="character-info" id="selected-character-summary">
            <div class="character-name">${escapeHtml(this.character?.name || 'Unknown')}</div>
            <div class="character-class">${escapeHtml(formatClassName(this.character?.class))} · Lv.${this.character?.level || 1}</div>
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
        <div class="advancement-tab ${this.activeTab === 'training' ? 'active' : ''}" data-tab="training">
          Training Grounds
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
      if (this.isBusy) return;
      this.game.scenes.switchTo('worldMap');
    }, opts);

    this.uiElement.querySelector('#guild-character-select')?.addEventListener('change', event => {
      if (this.isBusy) {
        this.updateCharacterSummary();
        return;
      }
      this.handleCharacterChange(event.target.value);
    }, opts);

    this.uiElement.querySelectorAll('.advancement-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (this.isBusy) return;
        this.activeTab = tab.dataset.tab;
        this.selectedQuest = null;
        this.updateUI();
      }, opts);
    });
  }

  updateUI() {
    if (!this.uiElement) return;

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
      case 'training':
        this.renderTrainingGrounds();
        break;
      case 'guildmaster':
        this.renderGuildmaster();
        break;
    }

    this.updateBusyControls();
  }

  updateCharacterSummary() {
    if (!this.uiElement || !this.character) return;

    const select = this.uiElement.querySelector('#guild-character-select');
    if (select) select.value = String(this.characterId);

    const nameEl = this.uiElement.querySelector('#selected-character-summary .character-name');
    const classEl = this.uiElement.querySelector('#selected-character-summary .character-class');
    if (nameEl) nameEl.textContent = this.character.name || 'Unknown';
    if (classEl) {
      classEl.textContent = `${formatClassName(this.character.class)} · Lv.${this.character.level || 1}`;
    }
  }

  async handleCharacterChange(characterId) {
    if (this.isBusy) {
      this.updateCharacterSummary();
      return;
    }

    const nextCharacter = this.guildCharacters.find(character => (
      String(character.id) === String(characterId)
      && isCharacterAtNode(character, this.nodeId)
    ));
    if (!nextCharacter || String(nextCharacter.id) === String(this.characterId)) {
      this.updateCharacterSummary();
      return;
    }

    this.character = nextCharacter;
    this.characterId = nextCharacter.id;
    this.selectedQuest = null;
    this.updateCharacterSummary();
    await this.loadData();
  }

  async refreshSelectedCharacter() {
    try {
      const result = await this.game.api.getCharacters();
      const characters = result.characters || [];
      this.game.state.set('characters', characters);
      const selection = selectGuildCharacter({
        characters,
        guildClass: this.guildClass,
        preferredCharacterId: this.characterId,
        nodeId: this.nodeId
      });
      this.guildCharacters = selection.guildCharacters;
      if (selection.character) {
        this.character = selection.character;
        this.characterId = selection.character.id;
        this.updateCharacterSummary();
      }
    } catch (err) {
      console.warn('Failed to refresh guild character after training:', err);
    }
  }

  renderTrainingGrounds() {
    const listHeader = this.uiElement.querySelector('#list-header');
    const listEl = this.uiElement.querySelector('#quest-list');
    const detailEl = this.uiElement.querySelector('#detail-content');
    const className = formatClassName(this.character?.class);

    listHeader.textContent = 'Training Grounds';
    listEl.innerHTML = `
      <div class="training-panel">
        <div class="training-character-card">
          <div class="training-character-icon">📖</div>
          <div class="quest-name">${escapeHtml(this.character?.name || 'Unknown')}</div>
          <div class="quest-target">Level ${this.character?.level || 1} ${escapeHtml(className)}</div>
        </div>
        <div class="training-feature">
          <div class="training-feature-title">Develop your abilities</div>
          <div class="training-feature-copy">
            Spend earned experience to learn new skills or strengthen known ones.
            Training includes abilities from your base class and every authored
            class tier you have earned.
          </div>
        </div>
        <div class="training-feature">
          <div class="training-feature-title">Prepare for advancement</div>
          <div class="training-feature-copy">
            Build a skill set that suits your party before accepting an
            advancement quest or challenging the guildmaster.
          </div>
        </div>
      </div>
    `;

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">Skill Training</div>
        <div class="detail-class">${escapeHtml(className)}</div>
      </div>
      <div class="requirements-section">
        <div class="requirements-title">Training Profile</div>
        <div class="requirement-item">
          <span class="requirement-label">Current Class</span>
          <span class="requirement-value">${escapeHtml(className)}</span>
        </div>
        <div class="requirement-item">
          <span class="requirement-label">Character Level</span>
          <span class="requirement-value">${this.character?.level || 1}</span>
        </div>
        <div class="requirement-item">
          <span class="requirement-label">Completed Advancements</span>
          <span class="requirement-value">${this.completedQuests.length}</span>
        </div>
      </div>
      <div class="training-hint">
        The training ledger shows available experience, prerequisites, learned
        levels, and the full skill path currently available to this character.
      </div>
      <div class="detail-actions">
        <button class="action-btn primary" id="open-training-btn">
          Open Skill Training
        </button>
      </div>
    `;

    const opts = { signal: this.abortController.signal };
    detailEl.querySelector('#open-training-btn')?.addEventListener(
      'click',
      () => this.openTrainingGrounds(),
      opts
    );
  }

  async openTrainingGrounds() {
    if (this.trainingModal || this.trainingModalPromise) return;

    const sceneController = this.abortController;
    const characterId = this.characterId;
    const opening = (async () => {
      const { CharacterModal } = await import('../components/modals/CharacterModal.js');
      if (
        !sceneController
        || sceneController.signal.aborted
        || this.abortController !== sceneController
        || !this.uiElement
        || characterId !== this.characterId
      ) {
        return;
      }

      const modal = new CharacterModal({
        game: this.game,
        characterId,
        skillsOnly: true,
        title: 'Training Grounds',
        onSkillLevelUp: () => this.refreshSelectedCharacter(),
        onClose: () => {
          if (this.trainingModal === modal) this.trainingModal = null;
        }
      });
      this.trainingModal = modal;
      await modal.open();
    })();
    this.trainingModalPromise = opening;

    try {
      await opening;
    } catch (err) {
      this.trainingModal = null;
      console.error('Failed to open Training Grounds:', err);
      if (!sceneController?.signal.aborted) {
        parchmentToast.error('Training Unavailable', 'Skill training could not be opened.');
      }
    } finally {
      if (this.trainingModalPromise === opening) {
        this.trainingModalPromise = null;
      }
    }
  }

  setBusy(isBusy) {
    this.isBusy = isBusy;
    this.updateBusyControls();
  }

  updateBusyControls() {
    if (!this.uiElement) return;

    this.uiElement.querySelectorAll('.action-btn[id]').forEach(button => {
      button.disabled = this.isBusy;
    });

    const presentCharacterCount = this.guildCharacters.filter(character => (
      isCharacterAtNode(character, this.nodeId)
    )).length;
    const selector = this.uiElement.querySelector('#guild-character-select');
    if (selector) {
      selector.disabled = this.isBusy || presentCharacterCount < 2;
      selector.setAttribute('aria-busy', String(this.isBusy));
    }

    const backButton = this.uiElement.querySelector('#back-btn');
    if (backButton) backButton.disabled = this.isBusy;

    this.uiElement.querySelectorAll('.advancement-tab').forEach(tab => {
      tab.classList.toggle('busy', this.isBusy);
      tab.setAttribute('aria-disabled', String(this.isBusy));
    });
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
          <div class="quest-name">${escapeHtml(quest.questName || 'Advancement Quest')}</div>
          <div class="quest-tier tier-${quest.tier}">${TIER_NAMES[quest.tier - 1] || `T${quest.tier}`}</div>
        </div>
        <div class="quest-target">Advance to: ${escapeHtml(formatClassName(quest.targetClass))}</div>
        <div class="quest-desc">${escapeHtml(quest.questDescription || '')}</div>
      </div>
    `).join('');

    // Add click handlers
    listEl.querySelectorAll('.quest-card').forEach(card => {
      card.addEventListener('click', () => {
        if (this.isBusy) return;
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
          <div class="quest-name">${escapeHtml(quest.questName || 'Advancement Quest')}</div>
          <div class="quest-tier tier-${quest.tier}">${TIER_NAMES[quest.tier - 1] || `T${quest.tier}`}</div>
        </div>
        <div class="quest-target">Advance to: ${escapeHtml(formatClassName(quest.targetClass))}</div>
        <div class="quest-desc">${escapeHtml(quest.questDescription || '')}</div>
      </div>
    `;

    this.renderProgressDetail(quest);
  }

  renderObjectiveSections(quest) {
    const objectives = getQuestObjectives(quest);
    const groups = [
      ['Materials', objectives.materials],
      ['Combat', objectives.enemies],
      ['Exploration', objectives.nodes]
    ];

    return groups
      .filter(([, items]) => items.length > 0)
      .map(([title, items]) => `
        <div class="requirements-section">
          <div class="requirements-title">${title}</div>
          ${items.map(item => `
            <div class="requirement-item">
              <span class="requirement-label">${escapeHtml(item.label)}</span>
              <span class="requirement-value ${item.complete ? 'complete' : 'incomplete'}">
                ${item.current}/${item.required}
              </span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width: ${item.percentage}%"></div>
            </div>
          `).join('')}
        </div>
      `)
      .join('');
  }

  renderProgressDetail(quest) {
    const detailEl = this.uiElement.querySelector('#detail-content');

    if (!quest) {
      detailEl.innerHTML = '<div class="empty-message">No active quest</div>';
      return;
    }

    const requirementsHtml = this.renderObjectiveSections(quest);

    const canStartBoss = this.bossEligibility?.eligible;
    const targetClass = formatClassName(quest.targetClass);

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">${escapeHtml(quest.questName || 'Advancement Quest')}</div>
        <div class="detail-class">${escapeHtml(targetClass)}</div>
      </div>

      ${requirementsHtml || '<div class="empty-message">No requirements</div>'}

      <div class="rewards-section">
        <div class="rewards-title">Rewards</div>
        <div class="reward-item"><span class="reward-icon">⭐</span> Class: ${escapeHtml(targetClass)}</div>
        ${quest.rewards?.gold ? `<div class="reward-item"><span class="reward-icon">${Icon.html('resources', 'gold', { size: 'sm' })}</span> ${quest.rewards.gold} Gold</div>` : ''}
        ${quest.rewards?.xp ? `<div class="reward-item"><span class="reward-icon">✨</span> ${quest.rewards.xp} XP</div>` : ''}
        ${quest.rewards?.title ? `<div class="reward-item"><span class="reward-icon">🏆</span> Title: ${escapeHtml(quest.rewards.title)}</div>` : ''}
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

    const requirementsHtml = this.renderObjectiveSections(quest);
    const targetClass = formatClassName(quest.targetClass);

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">${escapeHtml(quest.questName || 'Advancement Quest')}</div>
        <div class="detail-class">${escapeHtml(targetClass)}</div>
      </div>

      ${requirementsHtml || '<div class="empty-message">No specific requirements</div>'}

      <div class="rewards-section">
        <div class="rewards-title">Rewards</div>
        <div class="reward-item"><span class="reward-icon">⭐</span> Class: ${escapeHtml(targetClass)}</div>
        ${quest.rewards?.gold ? `<div class="reward-item"><span class="reward-icon">${Icon.html('resources', 'gold', { size: 'sm' })}</span> ${quest.rewards.gold} Gold</div>` : ''}
        ${quest.rewards?.xp ? `<div class="reward-item"><span class="reward-icon">✨</span> ${quest.rewards.xp} XP</div>` : ''}
        ${quest.rewards?.title ? `<div class="reward-item"><span class="reward-icon">🏆</span> Title: ${escapeHtml(quest.rewards.title)}</div>` : ''}
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
    if (this.isLoading) {
      listEl.innerHTML = '<div class="empty-message">Consulting the guild records...</div>';
      detailEl.innerHTML = '<div class="empty-message">Loading advancement status...</div>';
      return;
    }

    const guildInfo = GUILD_INFO[this.guildClass] || { name: 'Guild', icon: '🏛️' };

    let dialogText = '';
    let actionHtml = '';

    if (this.bossEligibility?.eligible) {
      dialogText = `You have proven yourself worthy, ${this.character?.name}.
        Your quest is complete, and now you must face the final trial.
        Defeat me in combat to earn the right to advance to ${formatClassName(this.bossEligibility.targetClass)}.`;
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
      dialogText = `Greetings, young ${formatClassName(this.character?.class)}. You show promise, but you must first
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
          <div class="guildmaster-name">${escapeHtml(guildInfo.name.replace(' Guild', '').replace(' Order', ''))} Guildmaster</div>
          <div class="guildmaster-title">Master of the ${escapeHtml(guildInfo.name)}</div>
          ${this.bossEligibility?.eligible ? '<div class="boss-ready-badge">READY FOR TRIAL</div>' : ''}
        </div>

        <div class="guildmaster-dialog">
          <div class="dialog-text">${escapeHtml(dialogText)}</div>
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
          <span class="requirement-value">${escapeHtml(formatClassName(this.character?.class))}</span>
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
    if (this.isBusy) return;
    const characterId = this.characterId;
    this.setBusy(true);
    try {
      const result = await this.game.api.acceptAdvancementQuest(
        characterId,
        quest.id,
        Number(this.nodeId)
      );
      if (characterId !== this.characterId || !this.uiElement) return;
      parchmentToast.success('Quest Accepted', result.message);
      await this.loadData();
      if (characterId !== this.characterId || !this.uiElement) return;
      this.activeTab = 'progress';
      this.updateUI();
    } catch (err) {
      parchmentToast.error('Failed to Accept', err.message);
    } finally {
      this.setBusy(false);
    }
  }

  async handleAbandonQuest() {
    if (!(await parchmentConfirm({ title: 'Abandon Quest', message: 'Are you sure you want to abandon this quest? All progress will be lost.', confirmLabel: 'Abandon', confirmVariant: 'danger' }))) {
      return;
    }

    if (this.isBusy) return;
    const characterId = this.characterId;
    this.setBusy(true);
    try {
      const result = await this.game.api.abandonAdvancementQuest(characterId);
      if (characterId !== this.characterId || !this.uiElement) return;
      parchmentToast.info('Quest Abandoned', result.message);
      await this.loadData();
      if (characterId !== this.characterId || !this.uiElement) return;
      this.activeTab = 'quests';
      this.updateUI();
    } catch (err) {
      parchmentToast.error('Failed to Abandon', err.message);
    } finally {
      this.setBusy(false);
    }
  }

  async handleStartBossTrial() {
    if (!this.bossEligibility?.eligible) {
      parchmentToast.error('Not Ready', 'Complete quest requirements first');
      return;
    }

    if (this.isBusy) return;
    const characterId = this.characterId;
    const sceneController = this.abortController;
    this.setBusy(true);
    try {
      const result = await this.game.api.startBossTrial(
        characterId,
        Number(this.nodeId)
      );

      if (
        characterId !== this.characterId
        || sceneController?.signal.aborted
        || sceneController !== this.abortController
        || !this.uiElement
      ) {
        return;
      }

      // Preserve both the legacy state and negotiated snapshot transports.
      this.game.scenes.switchTo('battle', buildBossBattleSceneData(result));
    } catch (err) {
      parchmentToast.error('Boss Trial Failed', err.message);
    } finally {
      this.setBusy(false);
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
