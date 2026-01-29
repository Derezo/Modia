/**
 * QuestBoardScene - Daily and Weekly quest management interface
 *
 * Features:
 * - Tab-based UI (Daily/Weekly tabs)
 * - Quest cards with progress bars
 * - Streak display with fire animation
 * - Live countdown to next reset
 * - Claim All + individual Claim buttons
 * - First Blood banner showing today's winners
 */

import { Scene } from './Scene.js';
import { responsive } from '../core/Responsive.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentScrollbarCSS
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { Icon } from '../components/Icon.js';

const P = PARCHMENT_COLORS;

// Difficulty colors
const DIFFICULTY_COLORS = {
  easy: '#4CAF50',
  normal: '#2196F3',
  hard: '#FF9800',
  elite: '#9C27B0'
};

// Objective type icons - use menu for locations, actions for combat
const OBJECTIVE_ICONS = {
  kill_enemies: { category: 'actions', name: 'attack' },
  complete_battles: { category: 'actions', name: 'attack' },
  party_battles: { category: 'menu', name: 'party' },
  visit_nodes: { category: 'actions', name: 'move' },
  visit_regions: { category: 'actions', name: 'move' },
  fish_catches: { category: 'menu', name: 'fishing' },
  puzzle_solves: { category: 'menu', name: 'ruins' },
  gold_earned: { category: 'resources', name: 'gold' },
  items_sold: { category: 'menu', name: 'shop' },
  coliseum_wins: { category: 'menu', name: 'coliseum' }
};

export class QuestBoardScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;
    this.responsiveUnsubscribe = null;

    // Quest data
    this.dailyQuests = [];
    this.weeklyQuests = [];
    this.streak = null;
    this.perfectWeek = null;
    this.dailyPeriodEnd = null;
    this.weeklyPeriodEnd = null;
    this.firstBloodWinners = [];

    // UI state
    this.activeTab = 'daily';
    this.countdownInterval = null;
    this.loading = false;
    this.characterId = null;
  }

  async enter(_data = {}) {
    // Get character ID from state
    const characters = this.game.state.get('characters') || [];
    const partyLeader = characters.find(c => c.party_slot === 1) || characters[0];
    this.characterId = partyLeader?.id;

    if (!this.characterId) {
      parchmentToast.error('Error', 'No active character found');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.addStyles();
    this.createUI();
    this.setupEventListeners();

    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Load initial data
    await this.loadQuestData();

    // Start countdown timer
    this.startCountdownTimer();
  }

  exit() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
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
  }

  addStyles() {
    if (document.getElementById('quest-board-styles')) return;

    const style = document.createElement('style');
    style.id = 'quest-board-styles';
    style.textContent = `
      .quest-board-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: ${getParchmentGradient()};
        ${getParchmentBorder()}
        overflow: hidden;
      }

      .quest-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 2px solid ${P.borderDark};
        background: linear-gradient(to bottom, rgba(0,0,0,0.05), transparent);
      }

      .quest-title {
        font-family: 'Cinzel', Georgia, serif;
        font-size: 24px;
        color: ${P.text.primary};
        margin: 0;
        text-shadow: 1px 1px 0 rgba(255,255,255,0.5);
      }

      .quest-tabs {
        display: flex;
        gap: 8px;
        padding: 0 16px;
        margin-top: -1px;
        border-bottom: 1px solid ${P.border};
      }

      .quest-tab {
        padding: 10px 20px;
        background: transparent;
        border: none;
        border-bottom: 3px solid transparent;
        font-family: Georgia, serif;
        font-size: 14px;
        color: ${P.text.secondary};
        cursor: pointer;
        transition: all 0.2s;
      }

      .quest-tab:hover {
        color: ${P.text.primary};
      }

      .quest-tab.active {
        color: ${P.accent.copper};
        border-bottom-color: ${P.accent.copper};
        font-weight: bold;
      }

      .quest-tab .tab-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        margin-left: 6px;
        background: ${P.accent.copper};
        color: white;
        border-radius: 9px;
        font-size: 11px;
        font-weight: bold;
      }

      .quest-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        ${getParchmentScrollbarCSS()}
      }

      .streak-display {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 12px;
        margin-bottom: 16px;
        background: linear-gradient(to right, rgba(255,127,0,0.1), rgba(255,69,0,0.1));
        border: 1px solid ${P.accent.copper};
        border-radius: 8px;
      }

      .streak-icon {
        font-size: 28px;
        animation: flame-pulse 1s ease-in-out infinite;
      }

      @keyframes flame-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.8; }
      }

      .streak-info {
        text-align: center;
      }

      .streak-count {
        font-family: 'Cinzel', Georgia, serif;
        font-size: 28px;
        font-weight: bold;
        color: ${P.accent.copper};
      }

      .streak-label {
        font-size: 12px;
        color: ${P.text.secondary};
      }

      .streak-bonus {
        font-size: 14px;
        color: #4CAF50;
        font-weight: bold;
      }

      .quest-card {
        display: flex;
        flex-direction: column;
        padding: 12px 16px;
        margin-bottom: 12px;
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: 6px;
        transition: all 0.2s;
      }

      .quest-card:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }

      .quest-card.completed {
        border-color: #4CAF50;
        background: linear-gradient(to right, rgba(76,175,80,0.05), transparent);
      }

      .quest-card.claimable {
        border-color: ${P.accent.copper};
        animation: quest-glow 2s ease-in-out infinite;
      }

      @keyframes quest-glow {
        0%, 100% { box-shadow: 0 0 5px rgba(183, 110, 44, 0.3); }
        50% { box-shadow: 0 0 15px rgba(183, 110, 44, 0.6); }
      }

      .quest-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }

      .quest-info {
        flex: 1;
      }

      .quest-name {
        font-family: Georgia, serif;
        font-size: 16px;
        font-weight: bold;
        color: ${P.text.primary};
        margin: 0 0 4px 0;
      }

      .quest-description {
        font-size: 13px;
        color: ${P.text.secondary};
        margin: 0;
      }

      .quest-difficulty {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
        color: white;
      }

      .quest-progress-bar {
        height: 8px;
        background: ${P.dark};
        border-radius: 4px;
        overflow: hidden;
        margin: 8px 0;
      }

      .quest-progress-fill {
        height: 100%;
        background: linear-gradient(to right, ${P.accent.copper}, #FFB347);
        border-radius: 4px;
        transition: width 0.3s;
      }

      .quest-progress-fill.complete {
        background: linear-gradient(to right, #4CAF50, #8BC34A);
      }

      .quest-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .quest-progress-text {
        font-size: 12px;
        color: ${P.text.secondary};
      }

      .quest-rewards {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 13px;
      }

      .quest-reward {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .quest-reward-gold {
        color: #DAA520;
      }

      .quest-reward-xp {
        color: #2196F3;
      }

      .claim-btn {
        padding: 6px 12px;
        background: linear-gradient(to bottom, ${P.accent.copper}, #9a5f23);
        border: 1px solid ${P.borderDark};
        border-radius: 4px;
        color: white;
        font-family: Georgia, serif;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }

      .claim-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .claim-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .claim-all-section {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.03));
        border-top: 1px solid ${P.border};
      }

      .claim-all-btn {
        padding: 10px 24px;
        background: linear-gradient(to bottom, #4CAF50, #388E3C);
        border: 1px solid #2E7D32;
        border-radius: 6px;
        color: white;
        font-family: Georgia, serif;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }

      .claim-all-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }

      .claim-all-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .countdown-display {
        font-size: 14px;
        color: ${P.text.secondary};
      }

      .countdown-time {
        font-family: monospace;
        font-size: 16px;
        color: ${P.text.primary};
        font-weight: bold;
      }

      .back-btn {
        padding: 8px 16px;
        background: linear-gradient(to bottom, ${P.light}, ${P.dark});
        border: 1px solid ${P.border};
        border-radius: 4px;
        color: ${P.text.primary};
        font-family: Georgia, serif;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .back-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .empty-state {
        text-align: center;
        padding: 40px;
        color: ${P.text.secondary};
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: ${P.text.secondary};
      }

      .first-blood-banner {
        padding: 12px;
        margin-bottom: 16px;
        background: linear-gradient(to right, rgba(255,0,0,0.1), rgba(139,0,0,0.1));
        border: 1px solid #B71C1C;
        border-radius: 6px;
      }

      .first-blood-title {
        font-family: 'Cinzel', Georgia, serif;
        font-size: 14px;
        color: #B71C1C;
        margin: 0 0 8px 0;
      }

      .first-blood-winners {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .first-blood-winner {
        padding: 4px 8px;
        background: rgba(183, 28, 28, 0.1);
        border-radius: 4px;
        font-size: 12px;
        color: ${P.text.primary};
      }

      .perfect-week-display {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 8px 12px;
        margin-bottom: 12px;
        background: linear-gradient(to right, rgba(156,39,176,0.1), rgba(103,58,183,0.1));
        border: 1px solid #7B1FA2;
        border-radius: 6px;
      }

      .perfect-week-days {
        display: flex;
        gap: 4px;
      }

      .perfect-week-day {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${P.dark};
        border-radius: 4px;
        font-size: 10px;
        color: ${P.text.secondary};
      }

      .perfect-week-day.complete {
        background: #7B1FA2;
        color: white;
      }

      /* Elite Quest Styling */
      .quest-card.elite-quest {
        border: 2px solid transparent;
        background: linear-gradient(${P.light}, ${P.light}) padding-box,
                    linear-gradient(135deg, #9C27B0, #FFD700, #9C27B0) border-box;
        position: relative;
      }

      .quest-card.elite-quest::before {
        content: 'ELITE';
        position: absolute;
        top: -8px;
        right: 12px;
        padding: 2px 8px;
        background: linear-gradient(135deg, #9C27B0, #7B1FA2);
        color: white;
        font-size: 10px;
        font-weight: bold;
        border-radius: 3px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }

      .elite-item-drop-hint {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 8px;
        padding: 4px 8px;
        background: linear-gradient(to right, rgba(156,39,176,0.1), rgba(255,215,0,0.1));
        border: 1px dashed #9C27B0;
        border-radius: 4px;
        font-size: 11px;
        color: #7B1FA2;
      }

      .elite-item-drop-hint .gift-icon {
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const isMobile = responsive.isMobile();

    const container = document.createElement('div');
    container.className = 'quest-board-container';
    container.style.cssText = `
      position: absolute;
      top: ${isMobile ? '0' : '20px'};
      left: ${isMobile ? '0' : '50%'};
      ${isMobile ? 'right: 0;' : 'transform: translateX(-50%);'}
      width: ${isMobile ? '100%' : '600px'};
      max-width: 100%;
      height: ${isMobile ? '100%' : 'calc(100% - 40px)'};
      max-height: ${isMobile ? '100%' : '700px'};
      pointer-events: auto;
    `;

    container.innerHTML = `
      <div class="quest-header">
        <h1 class="quest-title">Quest Board</h1>
        <button class="back-btn" id="quest-back-btn">Back to Map</button>
      </div>

      <div class="quest-tabs">
        <button class="quest-tab active" data-tab="daily">
          Daily Quests
          <span class="tab-badge" id="daily-badge" style="display: none;">0</span>
        </button>
        <button class="quest-tab" data-tab="weekly">
          Weekly Quests
          <span class="tab-badge" id="weekly-badge" style="display: none;">0</span>
        </button>
      </div>

      <div class="quest-content" id="quest-content">
        <div class="loading-state">Loading quests...</div>
      </div>

      <div class="claim-all-section">
        <div class="countdown-display">
          Reset in: <span class="countdown-time" id="countdown-time">--:--:--</span>
        </div>
        <button class="claim-all-btn" id="claim-all-btn" disabled>Claim All</button>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Back button
    this.uiElement.querySelector('#quest-back-btn').addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Tab switching
    this.uiElement.querySelectorAll('.quest-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      }, opts);
    });

    // Claim all button
    this.uiElement.querySelector('#claim-all-btn').addEventListener('click', () => {
      this.claimAllRewards();
    }, opts);
  }

  async loadQuestData() {
    this.loading = true;
    this.renderContent();

    try {
      // Load daily and weekly quests in parallel
      const [dailyResult, weeklyResult, firstBloodResult] = await Promise.all([
        this.game.api.getDailyQuests(this.characterId),
        this.game.api.getWeeklyQuests(this.characterId),
        this.game.api.getFirstBloodWinners()
      ]);

      this.dailyQuests = dailyResult.quests || [];
      this.streak = dailyResult.streak || null;
      this.perfectWeek = dailyResult.perfectWeek || null;
      this.dailyPeriodEnd = dailyResult.periodEnd;

      this.weeklyQuests = weeklyResult.quests || [];
      this.weeklyPeriodEnd = weeklyResult.periodEnd;

      this.firstBloodWinners = firstBloodResult.winners || [];

      this.loading = false;
      this.updateBadges();
      this.renderContent();
    } catch (err) {
      this.loading = false;
      parchmentToast.error('Error', err.message);
      this.renderContent();
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;

    // Update tab styling
    this.uiElement.querySelectorAll('.quest-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    this.renderContent();
  }

  updateBadges() {
    const dailyClaimable = this.dailyQuests.filter(q => q.isCompleted && !q.rewardsClaimed).length;
    const weeklyClaimable = this.weeklyQuests.filter(q => q.isCompleted && !q.rewardsClaimed).length;

    const dailyBadge = this.uiElement.querySelector('#daily-badge');
    const weeklyBadge = this.uiElement.querySelector('#weekly-badge');

    if (dailyClaimable > 0) {
      dailyBadge.textContent = dailyClaimable;
      dailyBadge.style.display = 'inline-flex';
    } else {
      dailyBadge.style.display = 'none';
    }

    if (weeklyClaimable > 0) {
      weeklyBadge.textContent = weeklyClaimable;
      weeklyBadge.style.display = 'inline-flex';
    } else {
      weeklyBadge.style.display = 'none';
    }

    // Update claim all button
    const totalClaimable = (this.activeTab === 'daily' ? dailyClaimable : weeklyClaimable);
    const claimAllBtn = this.uiElement.querySelector('#claim-all-btn');
    claimAllBtn.disabled = totalClaimable === 0;
  }

  renderContent() {
    const content = this.uiElement.querySelector('#quest-content');
    const quests = this.activeTab === 'daily' ? this.dailyQuests : this.weeklyQuests;

    if (this.loading) {
      content.innerHTML = '<div class="loading-state">Loading quests...</div>';
      return;
    }

    if (quests.length === 0) {
      content.innerHTML = '<div class="empty-state">No quests available. Check back later!</div>';
      return;
    }

    let html = '';

    // Streak display (daily only)
    if (this.activeTab === 'daily' && this.streak) {
      const fireEmoji = this.streak.currentStreak >= 5 ? '🔥' : '✨';
      html += `
        <div class="streak-display">
          <span class="streak-icon">${fireEmoji}</span>
          <div class="streak-info">
            <div class="streak-count">${this.streak.currentStreak} Day Streak</div>
            <div class="streak-label">Longest: ${this.streak.longestStreak} days</div>
            ${this.streak.bonusPercentage > 0 ? `<div class="streak-bonus">+${Math.round(this.streak.bonusPercentage)}% Bonus Rewards</div>` : ''}
          </div>
        </div>
      `;
    }

    // Perfect Week progress (daily only)
    if (this.activeTab === 'daily' && this.perfectWeek && !this.perfectWeek.isPerfect) {
      const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      html += `
        <div class="perfect-week-display">
          <span>Perfect Week Progress:</span>
          <div class="perfect-week-days">
            ${this.perfectWeek.dayStatus.map((complete, i) =>
    `<div class="perfect-week-day ${complete ? 'complete' : ''}">${days[i]}</div>`
  ).join('')}
          </div>
        </div>
      `;
    }

    // First Blood banner
    if (this.activeTab === 'daily' && this.firstBloodWinners.length > 0) {
      html += `
        <div class="first-blood-banner">
          <h4 class="first-blood-title">🩸 Today's First Blood Champions</h4>
          <div class="first-blood-winners">
            ${this.firstBloodWinners.map(w =>
    `<span class="first-blood-winner">${this.escapeHtml(w.character_name)} - ${this.escapeHtml(w.quest_name)}</span>`
  ).join('')}
          </div>
        </div>
      `;
    }

    // Quest cards
    html += quests.map(quest => this.renderQuestCard(quest)).join('');

    content.innerHTML = html;

    // Attach claim button handlers
    content.querySelectorAll('.claim-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const questId = parseInt(btn.dataset.questId, 10);
        await this.claimReward(questId, btn);
      });
    });

    this.updateBadges();
  }

  renderQuestCard(quest) {
    const progressPercent = Math.min(100, (quest.currentProgress / quest.targetProgress) * 100);
    const isComplete = quest.isCompleted;
    const isClaimable = isComplete && !quest.rewardsClaimed;
    const isElite = quest.difficulty === 'elite';

    const diffColor = DIFFICULTY_COLORS[quest.difficulty] || DIFFICULTY_COLORS.normal;
    const iconConfig = OBJECTIVE_ICONS[quest.objectiveType] || { category: 'misc', name: 'scroll' };

    // Card classes
    const cardClasses = [
      'quest-card',
      isComplete ? 'completed' : '',
      isClaimable ? 'claimable' : '',
      isElite ? 'elite-quest' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClasses}">
        <div class="quest-card-header">
          <div class="quest-info">
            <h3 class="quest-name">
              ${Icon.html(iconConfig.category, iconConfig.name, { size: 'sm' })}
              ${quest.questName}
            </h3>
            <p class="quest-description">${quest.description}</p>
          </div>
          <span class="quest-difficulty" style="background: ${diffColor}">${quest.difficulty}</span>
        </div>

        <div class="quest-progress-bar">
          <div class="quest-progress-fill ${isComplete ? 'complete' : ''}"
               style="width: ${progressPercent}%"></div>
        </div>

        <div class="quest-footer">
          <span class="quest-progress-text">
            ${quest.currentProgress} / ${quest.targetProgress}
            ${isComplete ? '✓ Complete!' : ''}
          </span>

          <div class="quest-rewards">
            ${quest.rewards.gold ? `<span class="quest-reward quest-reward-gold">💰 ${quest.rewards.gold}</span>` : ''}
            ${quest.rewards.xp ? `<span class="quest-reward quest-reward-xp">⭐ ${quest.rewards.xp} XP</span>` : ''}
            ${isClaimable ? `<button class="claim-btn" data-quest-id="${quest.id}">Claim</button>` : ''}
            ${quest.rewardsClaimed ? '<span style="color: #4CAF50; font-size: 12px;">✓ Claimed</span>' : ''}
          </div>
        </div>

        ${isElite && !quest.rewardsClaimed ? `
          <div class="elite-item-drop-hint">
            <span class="gift-icon">🎁</span>
            <span>15% chance for rare equipment drop!</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  async claimReward(questId, btn) {
    btn.disabled = true;
    btn.textContent = '...';

    try {
      const result = await this.game.api.claimQuestReward(questId, this.characterId);

      // Update gold in state
      if (result.newGold !== undefined) {
        this.game.state.set('gold', result.newGold);
      }

      // Show reward toast
      const reward = result.reward;
      let message = `+${reward.gold} gold, +${reward.xp} XP`;
      if (reward.firstBloodBonus) {
        message += ' (First Blood +50%!)';
      }
      if (reward.streakBonus > 0) {
        message += ` (+${Math.round(reward.streakBonus * 100)}% streak)`;
      }

      parchmentToast.success('Reward Claimed!', message);

      // Show item drop notification if one occurred
      if (reward.itemDrop) {
        setTimeout(() => {
          parchmentToast.success(
            '🎁 Rare Item Drop!',
            `You received: ${reward.itemDrop.name}`,
            { duration: 5000 }
          );
        }, 1500);
      }

      // Reload quest data
      await this.loadQuestData();
    } catch (err) {
      parchmentToast.error('Claim Failed', err.message);
      btn.disabled = false;
      btn.textContent = 'Claim';
    }
  }

  async claimAllRewards() {
    const btn = this.uiElement.querySelector('#claim-all-btn');
    btn.disabled = true;
    btn.textContent = 'Claiming...';

    try {
      const result = await this.game.api.claimAllQuestRewards(this.characterId);

      // Update gold in state
      if (result.newGold !== undefined) {
        this.game.state.set('gold', result.newGold);
      }

      // Show reward toast
      let message = `${result.questsClaimed} quests: +${result.totalGold} gold, +${result.totalXp} XP`;
      if (result.completionBonus) {
        message += ` (Completion Bonus: +${result.completionBonus.gold}g, +${result.completionBonus.xp} XP!)`;
      }

      parchmentToast.success('All Rewards Claimed!', message);

      // Show item drop notifications
      if (result.itemDrops && result.itemDrops.length > 0) {
        setTimeout(() => {
          const itemNames = result.itemDrops.map(item => item.name).join(', ');
          parchmentToast.success(
            `🎁 ${result.itemDrops.length} Rare Item${result.itemDrops.length > 1 ? 's' : ''} Dropped!`,
            `You received: ${itemNames}`,
            { duration: 6000 }
          );
        }, 1500);
      }

      // Reload quest data
      await this.loadQuestData();
    } catch (err) {
      parchmentToast.error('Claim Failed', err.message);
    }

    btn.disabled = false;
    btn.textContent = 'Claim All';
  }

  startCountdownTimer() {
    this.updateCountdown();
    this.countdownInterval = setInterval(() => this.updateCountdown(), 1000);
  }

  updateCountdown() {
    const periodEnd = this.activeTab === 'daily' ? this.dailyPeriodEnd : this.weeklyPeriodEnd;
    const countdownEl = this.uiElement.querySelector('#countdown-time');

    if (!periodEnd) {
      countdownEl.textContent = '--:--:--';
      return;
    }

    const now = new Date();
    const end = new Date(periodEnd);
    const diff = end - now;

    if (diff <= 0) {
      countdownEl.textContent = 'Refreshing...';
      // Reload quests when timer expires (prevent multiple simultaneous refreshes)
      if (!this.isRefreshing) {
        this.isRefreshing = true;
        this.loadQuestData().finally(() => {
          this.isRefreshing = false;
        });
      }
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    countdownEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  onBreakpointChange() {
    // Rebuild UI for responsive changes
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    this.createUI();
    this.setupEventListeners();
    this.renderContent();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // Canvas-based rendering not used for this UI scene
    ctx.fillStyle = '#3d3426';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
