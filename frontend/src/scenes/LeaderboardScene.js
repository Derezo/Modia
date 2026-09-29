import { Scene } from './Scene.js';
import { PARCHMENT_COLORS, injectParchmentTheme, getParchmentScrollbarCSS, getParchmentSpinnerCSS } from '../ui/parchment/index.js';
import { responsive } from '../core/Responsive.js';
import { escapeHtml } from '../utils/escapeHtml.js';

// Shorthand for colors in CSS template
const P = PARCHMENT_COLORS;

/**
 * LeaderboardScene - Multi-category game leaderboards
 * Features: PvP rating, Level, Gold, Battle wins with time filters
 */
export class LeaderboardScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // State
    this.activeCategory = 'level'; // 'pvp', 'level', 'gold', 'battles'
    this.activeTimeFilter = 'all'; // 'all', 'week', 'today'
    this.pvpQueue = '1v1'; // For PvP category only
    this.leaderboard = [];
    this.userEntry = null;
    this.pagination = { limit: 50, offset: 0, total: 0, hasMore: false };
    this.loading = false;
    // Incremented per request and on exit; a response whose sequence is no
    // longer current is dropped (stale category/time tab, or scene exited).
    this.loadSeq = 0;

    // Responsive subscription
    this._responsiveUnsubscribe = null;
  }

  async enter(_data = {}) {
    try {
      this.addStyles();
      this.createUI();
      this.setupEventListeners();

      // Subscribe to responsive breakpoint changes
      this._responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

      await this.loadLeaderboard();

      // Play exploration music (maintains regional context)
      if (this.game.musicContext) {
        this.game.musicContext.playExplorationMusic();
      }
    } catch (err) {
      console.error('Failed to enter LeaderboardScene:', err);
      if (this.uiElement) {
        this.showError('Failed to load leaderboard. Please try again.');
      }
    }
  }

  exit() {
    // Invalidate any in-flight leaderboard request
    this.loadSeq += 1;
    this.loading = false;

    // Unsubscribe from responsive changes
    if (this._responsiveUnsubscribe) {
      this._responsiveUnsubscribe();
      this._responsiveUnsubscribe = null;
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
    // Ensure parchment CSS variables are available
    injectParchmentTheme();

    if (document.getElementById('leaderboard-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'leaderboard-scene-styles';
    style.textContent = `
      /* ============================================
         Leaderboard Scene - Parchment Theme
         ============================================ */

      .leaderboard-container {
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

      .leaderboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--parchment-spacing-lg) var(--parchment-spacing-xxl);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border-bottom: 2px solid var(--parchment-border);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .leaderboard-title {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-md);
      }

      .leaderboard-title h2 {
        margin: 0;
        color: var(--parchment-burgundy);
        text-shadow: 0 1px 0 var(--parchment-highlight);
        font-size: 22px;
      }

      .leaderboard-title-icon {
        font-size: 24px;
      }

      .leaderboard-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: var(--parchment-spacing-lg);
        gap: var(--parchment-spacing-md);
      }

      /* Category Tabs */
      .category-tabs {
        display: flex;
        gap: var(--parchment-spacing-xs);
        padding: var(--parchment-spacing-sm);
        background: linear-gradient(to bottom, var(--parchment-dark) 0%, ${P.dark}dd 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
      }

      .category-tab {
        flex: 1;
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-md);
        color: var(--parchment-text-secondary);
        cursor: pointer;
        transition: all 0.2s;
        font-family: var(--parchment-font);
        font-size: 14px;
        font-weight: bold;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--parchment-spacing-sm);
      }

      .category-tab:hover:not(.active) {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        color: var(--parchment-text-primary);
      }

      .category-tab.active {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
        color: var(--parchment-text-primary);
        border-color: var(--parchment-burgundy);
      }

      .category-tab-icon {
        font-size: 18px;
      }

      /* Time Filter */
      .filter-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
        background: rgba(139, 115, 85, 0.1);
        border-radius: var(--parchment-radius-md);
      }

      .time-filters {
        display: flex;
        gap: var(--parchment-spacing-xs);
      }

      .time-filter-btn {
        padding: var(--parchment-spacing-xs) var(--parchment-spacing-md);
        background: transparent;
        border: 1px solid var(--parchment-border);
        border-radius: var(--parchment-radius-sm);
        color: var(--parchment-text-secondary);
        cursor: pointer;
        transition: all 0.2s;
        font-family: var(--parchment-font);
        font-size: 12px;
      }

      .time-filter-btn:hover:not(.active) {
        background: rgba(139, 115, 85, 0.15);
        color: var(--parchment-text-primary);
      }

      .time-filter-btn.active {
        background: var(--parchment-border);
        color: var(--parchment-text-inverse);
        border-color: var(--parchment-border-dark);
      }

      .pvp-queue-select {
        padding: var(--parchment-spacing-xs) var(--parchment-spacing-sm);
        background: linear-gradient(to bottom, var(--parchment-text-inverse) 0%, ${P.light}ee 100%);
        border: 1px solid var(--parchment-border);
        border-radius: var(--parchment-radius-sm);
        color: var(--parchment-text-primary);
        font-family: var(--parchment-font);
        font-size: 12px;
        cursor: pointer;
      }

      /* Leaderboard Table */
      .leaderboard-table-container {
        flex: 1;
        overflow-y: auto;
        background: linear-gradient(to bottom, ${P.text.inverse} 0%, ${P.light}ee 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.08);
      }

      .leaderboard-table {
        width: 100%;
        border-collapse: collapse;
      }

      .leaderboard-table th {
        position: sticky;
        top: 0;
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        padding: var(--parchment-spacing-md);
        text-align: left;
        font-weight: bold;
        color: var(--parchment-text-primary);
        border-bottom: 2px solid var(--parchment-border);
        text-shadow: 0 1px 0 var(--parchment-highlight);
      }

      .leaderboard-table th:first-child {
        text-align: center;
        width: 60px;
      }

      .leaderboard-table th:last-child {
        text-align: right;
      }

      .leaderboard-table td {
        padding: var(--parchment-spacing-md);
        border-bottom: 1px solid rgba(139, 115, 85, 0.2);
      }

      .leaderboard-table td:first-child {
        text-align: center;
        font-weight: bold;
      }

      .leaderboard-table td:last-child {
        text-align: right;
        font-weight: bold;
        color: var(--parchment-burgundy);
      }

      .leaderboard-table tr:hover {
        background: rgba(139, 115, 85, 0.1);
      }

      .leaderboard-table tr.current-user {
        background: rgba(107, 45, 61, 0.12);
        border-left: 3px solid var(--parchment-burgundy);
      }

      .leaderboard-table tr.current-user td:first-child {
        color: var(--parchment-burgundy);
      }

      /* Rank badges */
      .rank-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        font-size: 12px;
        font-weight: bold;
      }

      .rank-1 {
        background: linear-gradient(135deg, #ffd700 0%, #ffec8b 50%, #ffd700 100%);
        color: #5a4a00;
        box-shadow: 0 2px 4px rgba(255, 215, 0, 0.4);
      }

      .rank-2 {
        background: linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 50%, #c0c0c0 100%);
        color: #444;
        box-shadow: 0 2px 4px rgba(192, 192, 192, 0.4);
      }

      .rank-3 {
        background: linear-gradient(135deg, #cd7f32 0%, #daa06d 50%, #cd7f32 100%);
        color: #3d2a1a;
        box-shadow: 0 2px 4px rgba(205, 127, 50, 0.4);
      }

      /* Player Name Badges */
      .player-name-container {
        display: flex;
        align-items: center;
        gap: var(--parchment-spacing-sm);
      }

      .perfect-week-badge {
        color: #ffd700;
        font-size: 14px;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        cursor: help;
      }

      .equipped-title {
        font-size: 11px;
        color: #9c27b0;
        font-style: italic;
        margin-left: var(--parchment-spacing-xs);
        background: linear-gradient(90deg, rgba(156, 39, 176, 0.1), transparent);
        padding: 2px 6px;
        border-radius: var(--parchment-radius-sm);
      }

      /* User Entry Footer */
      .user-entry-footer {
        padding: var(--parchment-spacing-md);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 2px solid var(--parchment-border);
        border-radius: var(--parchment-radius-lg);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .user-entry-footer.not-ranked {
        opacity: 0.7;
      }

      .user-rank-label {
        font-size: 12px;
        color: var(--parchment-text-muted);
        margin-bottom: var(--parchment-spacing-xs);
      }

      .user-rank-value {
        font-size: 18px;
        font-weight: bold;
        color: var(--parchment-burgundy);
      }

      .user-score-label {
        font-size: 12px;
        color: var(--parchment-text-muted);
        margin-bottom: var(--parchment-spacing-xs);
        text-align: right;
      }

      .user-score-value {
        font-size: 18px;
        font-weight: bold;
        color: var(--parchment-text-primary);
        text-align: right;
      }

      /* Pagination */
      .pagination-controls {
        display: flex;
        justify-content: center;
        gap: var(--parchment-spacing-sm);
        padding: var(--parchment-spacing-sm) 0;
      }

      .pagination-btn {
        padding: var(--parchment-spacing-xs) var(--parchment-spacing-md);
        background: linear-gradient(to bottom, var(--parchment-mid) 0%, var(--parchment-dark) 100%);
        border: 1px solid var(--parchment-border);
        border-radius: var(--parchment-radius-sm);
        color: var(--parchment-text-primary);
        cursor: pointer;
        font-family: var(--parchment-font);
        font-size: 12px;
        transition: all 0.2s;
      }

      .pagination-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
      }

      .pagination-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .pagination-info {
        display: flex;
        align-items: center;
        font-size: 12px;
        color: var(--parchment-text-muted);
      }

      /* Loading & Empty States */
      .loading-state, .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--parchment-text-secondary);
        padding: 40px;
      }

      /* Parchment themed loading spinner */
      ${getParchmentSpinnerCSS()}

      .loading-spinner {
        width: 40px;
        height: 40px;
      }

      .loading-spinner.parchment-spinner {
        width: 40px;
        height: 40px;
        margin-bottom: var(--parchment-spacing-md);
      }

      .empty-icon {
        font-size: 48px;
        margin-bottom: var(--parchment-spacing-md);
        opacity: 0.5;
      }

      /* Back Button */
      .leaderboard-back-btn {
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

      .leaderboard-back-btn:hover {
        background: linear-gradient(to bottom, var(--parchment-light) 0%, var(--parchment-mid) 100%);
      }

      /* Responsive - Tablet */
      @media (max-width: 768px) {
        .leaderboard-header {
          padding: var(--parchment-spacing-md) var(--parchment-spacing-lg);
          flex-wrap: wrap;
          gap: var(--parchment-spacing-md);
        }

        .category-tabs {
          flex-wrap: wrap;
        }

        .category-tab {
          padding: var(--parchment-spacing-xs) var(--parchment-spacing-sm);
          font-size: 12px;
        }

        .category-tab-label {
          display: none;
        }

        .filter-bar {
          flex-direction: column;
          gap: var(--parchment-spacing-sm);
        }

        .leaderboard-table th,
        .leaderboard-table td {
          padding: var(--parchment-spacing-sm);
        }

        .leaderboard-content {
          padding: var(--parchment-spacing-md);
        }
      }

      /* Responsive - Mobile (< 600px) */
      @media (max-width: 600px) {
        .leaderboard-header {
          padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
          flex-direction: column;
          align-items: stretch;
        }

        .leaderboard-title h2 {
          font-size: 18px;
        }

        .leaderboard-back-btn {
          min-height: var(--touch-target, 44px);
          width: 100%;
        }

        .category-tabs {
          padding: var(--parchment-spacing-xs);
          gap: 2px;
        }

        .category-tab {
          flex: 1 1 calc(50% - 2px);
          min-height: var(--touch-target, 44px);
          padding: var(--parchment-spacing-sm);
          font-size: var(--font-size-sm, 12px);
        }

        .category-tab-icon {
          font-size: 16px;
        }

        .time-filters {
          flex-wrap: wrap;
          justify-content: center;
        }

        .time-filter-btn {
          min-height: var(--touch-target, 44px);
          padding: var(--parchment-spacing-sm) var(--parchment-spacing-md);
          font-size: var(--font-size-sm, 12px);
          flex: 1;
        }

        .pvp-queue-select {
          min-height: var(--touch-target, 44px);
          width: 100%;
          font-size: var(--font-size-md, 14px);
        }

        .leaderboard-table th,
        .leaderboard-table td {
          padding: var(--parchment-spacing-xs) var(--parchment-spacing-sm);
          font-size: var(--font-size-sm, 12px);
        }

        .leaderboard-table th:first-child,
        .leaderboard-table td:first-child {
          width: 40px;
        }

        .rank-badge {
          width: 24px;
          height: 24px;
          font-size: var(--font-size-sm, 12px);
        }

        .user-entry-footer {
          flex-direction: column;
          gap: var(--parchment-spacing-md);
          text-align: center;
        }

        .user-rank-value,
        .user-score-value {
          font-size: 16px;
        }

        .user-score-label,
        .user-rank-label {
          text-align: center;
        }

        .pagination-controls {
          flex-wrap: wrap;
          justify-content: center;
        }

        .pagination-btn {
          min-height: var(--touch-target, 44px);
          padding: var(--parchment-spacing-sm) var(--parchment-spacing-lg);
          font-size: var(--font-size-sm, 12px);
        }

        .leaderboard-content {
          padding: var(--parchment-spacing-sm);
          gap: var(--parchment-spacing-sm);
        }
      }

      /* Themed Scrollbars */
      ${getParchmentScrollbarCSS('.leaderboard-table-container')}
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'leaderboard-container';

    container.innerHTML = `
      <div class="leaderboard-header">
        <div class="leaderboard-title">
          <span class="leaderboard-title-icon">&#127942;</span>
          <h2>Leaderboards</h2>
        </div>
        <button class="leaderboard-back-btn" id="back-btn">Back to Map</button>
      </div>

      <div class="leaderboard-content">
        <div class="category-tabs">
          <button class="category-tab" data-category="pvp">
            <span class="category-tab-icon">&#9876;</span>
            <span class="category-tab-label">PvP Rating</span>
          </button>
          <button class="category-tab active" data-category="level">
            <span class="category-tab-icon">&#11088;</span>
            <span class="category-tab-label">Level</span>
          </button>
          <button class="category-tab" data-category="gold">
            <span class="category-tab-icon">&#128176;</span>
            <span class="category-tab-label">Gold</span>
          </button>
          <button class="category-tab" data-category="battles">
            <span class="category-tab-icon">&#128481;</span>
            <span class="category-tab-label">Battles Won</span>
          </button>
        </div>

        <div class="filter-bar">
          <div class="time-filters">
            <button class="time-filter-btn active" data-time="all">All Time</button>
            <button class="time-filter-btn" data-time="week">This Week</button>
            <button class="time-filter-btn" data-time="today">Today</button>
          </div>
          <select class="pvp-queue-select" id="pvp-queue" style="display: none;">
            <option value="1v1">1v1 Arena</option>
            <option value="3v3">3v3 Arena</option>
            <option value="5v5">5v5 Arena</option>
          </select>
        </div>

        <div class="leaderboard-table-container" id="table-container">
          <div class="loading-state">
            <div class="loading-spinner parchment-spinner"></div>
            <div>Loading leaderboard...</div>
          </div>
        </div>

        <div class="pagination-controls" id="pagination" style="display: none;">
          <button class="pagination-btn" id="prev-page" disabled>Previous</button>
          <span class="pagination-info" id="pagination-info">1-50 of 100</span>
          <button class="pagination-btn" id="next-page">Next</button>
        </div>

        <div class="user-entry-footer" id="user-entry" style="display: none;">
          <div>
            <div class="user-rank-label">Your Rank</div>
            <div class="user-rank-value" id="user-rank">-</div>
          </div>
          <div>
            <div class="user-score-label">Your Score</div>
            <div class="user-score-value" id="user-score">-</div>
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

    // Category tabs
    this.uiElement.querySelectorAll('.category-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        this.switchCategory(tab.dataset.category);
      }, opts);
    });

    // Time filters
    this.uiElement.querySelectorAll('.time-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        this.switchTimeFilter(btn.dataset.time);
      }, opts);
    });

    // PvP queue select
    this.uiElement.querySelector('#pvp-queue')?.addEventListener('change', (e) => {
      this.pvpQueue = e.target.value;
      this.pagination.offset = 0;
      this.loadLeaderboard();
    }, opts);

    // Pagination
    this.uiElement.querySelector('#prev-page')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      if (this.pagination.offset >= this.pagination.limit) {
        this.pagination.offset -= this.pagination.limit;
        this.loadLeaderboard();
      }
    }, opts);

    this.uiElement.querySelector('#next-page')?.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      if (this.pagination.hasMore) {
        this.pagination.offset += this.pagination.limit;
        this.loadLeaderboard();
      }
    }, opts);
  }

  switchCategory(category) {
    this.activeCategory = category;
    this.pagination.offset = 0;

    // Update tab UI
    this.uiElement.querySelectorAll('.category-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.category === category);
    });

    // Show/hide PvP queue select
    const queueSelect = this.uiElement.querySelector('#pvp-queue');
    if (queueSelect) {
      queueSelect.style.display = category === 'pvp' ? 'block' : 'none';
    }

    this.loadLeaderboard();
  }

  switchTimeFilter(time) {
    this.activeTimeFilter = time;
    this.pagination.offset = 0;

    // Update button UI
    this.uiElement.querySelectorAll('.time-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.time === time);
    });

    this.loadLeaderboard();
  }

  async loadLeaderboard() {
    const seq = ++this.loadSeq;
    const isCurrent = () => seq === this.loadSeq && Boolean(this.uiElement);
    this.loading = true;
    this.showLoading();

    try {
      const options = {
        time: this.activeTimeFilter,
        limit: this.pagination.limit,
        offset: this.pagination.offset
      };

      if (this.activeCategory === 'pvp') {
        options.queue = this.pvpQueue;
      }

      const result = await this.game.api.getLeaderboard(this.activeCategory, options);
      if (!isCurrent()) return;

      this.leaderboard = result.leaderboard || [];
      this.userEntry = result.userEntry;
      this.pagination = result.pagination;

      this.renderLeaderboard();
      this.updatePagination();
      this.updateUserEntry();
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Failed to load leaderboard:', err);
      this.showError('Failed to load leaderboard');
    } finally {
      if (seq === this.loadSeq) {
        this.loading = false;
      }
    }
  }

  showLoading() {
    if (!this.uiElement) return;
    const container = this.uiElement.querySelector('#table-container');
    if (container) {
      container.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner parchment-spinner"></div>
          <div>Loading leaderboard...</div>
        </div>
      `;
    }
  }

  showError(message) {
    if (!this.uiElement) return;
    const container = this.uiElement.querySelector('#table-container');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#128533;</div>
          <div>${message}</div>
        </div>
      `;
    }
  }

  renderLeaderboard() {
    if (!this.uiElement) return;
    const container = this.uiElement.querySelector('#table-container');
    if (!container) return;

    if (this.leaderboard.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#128202;</div>
          <div>No entries found for this category.</div>
        </div>
      `;
      return;
    }

    const userId = this.game.state.get('user')?.id;
    const valueLabel = this.getValueLabel();

    let html = `
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>${valueLabel}</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const entry of this.leaderboard) {
      const isCurrentUser = entry.userId === userId;
      const rankBadge = this.getRankBadge(entry.rank);
      const displayValue = this.formatValue(entry.value);
      const playerCell = this.renderPlayerCell(entry);

      html += `
        <tr class="${isCurrentUser ? 'current-user' : ''}">
          <td>${rankBadge}</td>
          <td>${playerCell}</td>
          <td>${displayValue}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  getValueLabel() {
    switch (this.activeCategory) {
      case 'pvp': return 'Rating';
      case 'level': return 'Level';
      case 'gold': return 'Gold';
      case 'battles': return 'Wins';
      default: return 'Score';
    }
  }

  getRankBadge(rank) {
    if (rank <= 3) {
      return `<span class="rank-badge rank-${rank}">${rank}</span>`;
    }
    return `<span>${rank}</span>`;
  }

  renderPlayerCell(entry) {
    const username = escapeHtml(entry.username);
    let badges = '';

    // Perfect Week badge (star)
    if (entry.hasPerfectWeekBadge) {
      badges += '<span class="perfect-week-badge" title="Perfect Week Achiever">&#11088;</span>';
    }

    // Equipped title
    if (entry.equippedTitle) {
      badges += `<span class="equipped-title">${escapeHtml(entry.equippedTitle)}</span>`;
    }

    if (badges) {
      return `<span class="player-name-container">${username}${badges}</span>`;
    }

    return username;
  }

  formatValue(value) {
    if (this.activeCategory === 'gold') {
      return value.toLocaleString() + ' G';
    }
    return value.toLocaleString();
  }

  updatePagination() {
    if (!this.uiElement) return;
    const paginationEl = this.uiElement.querySelector('#pagination');
    const infoEl = this.uiElement.querySelector('#pagination-info');
    const prevBtn = this.uiElement.querySelector('#prev-page');
    const nextBtn = this.uiElement.querySelector('#next-page');

    if (!paginationEl || this.pagination.total === 0) {
      if (paginationEl) paginationEl.style.display = 'none';
      return;
    }

    paginationEl.style.display = 'flex';

    const start = this.pagination.offset + 1;
    const end = Math.min(this.pagination.offset + this.pagination.limit, this.pagination.total);

    if (infoEl) {
      infoEl.textContent = `${start}-${end} of ${this.pagination.total}`;
    }

    if (prevBtn) {
      prevBtn.disabled = this.pagination.offset === 0;
    }

    if (nextBtn) {
      nextBtn.disabled = !this.pagination.hasMore;
    }
  }

  updateUserEntry() {
    if (!this.uiElement) return;
    const entryEl = this.uiElement.querySelector('#user-entry');
    const rankEl = this.uiElement.querySelector('#user-rank');
    const scoreEl = this.uiElement.querySelector('#user-score');

    if (!entryEl) return;

    // Check if user is in visible leaderboard
    const userId = this.game.state.get('user')?.id;
    const userInLeaderboard = this.leaderboard.find(e => e.userId === userId);

    if (userInLeaderboard) {
      // User is visible in current page, hide footer
      entryEl.style.display = 'none';
      return;
    }

    if (this.userEntry) {
      entryEl.style.display = 'flex';
      entryEl.classList.remove('not-ranked');
      if (rankEl) rankEl.textContent = `#${this.userEntry.rank}`;
      if (scoreEl) scoreEl.textContent = this.formatValue(this.userEntry.value);
    } else {
      entryEl.style.display = 'flex';
      entryEl.classList.add('not-ranked');
      if (rankEl) rankEl.textContent = 'Not Ranked';
      if (scoreEl) scoreEl.textContent = '-';
    }
  }


  /**
   * Handle responsive breakpoint changes
   * Re-render the leaderboard table to adapt layout for new breakpoint
   */
  onBreakpointChange() {
    // Re-render the leaderboard - CSS handles responsive styles
    if (this.leaderboard.length > 0) {
      this.renderLeaderboard();
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
}
