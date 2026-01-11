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
  getParchmentPanelCSS,
  getParchmentInputCSS,
  getParchmentCardCSS
} from '../ui/parchment/index.js';

// Alias for convenient access
const P = PARCHMENT_COLORS;

/**
 * CourtyardScene - Social hub for party finding and player interaction
 * Features: Real-time player lobby, LFG party finder board, player search
 *
 * Uses parchment theme for UI panels while preserving green outdoor ambiance.
 */
export class CourtyardScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // Players in courtyard
    this.playersHere = [];

    // LFG posts
    this.lfgPosts = [];
    this.myPost = null;

    // Player search
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearching = false;

    // Create post modal state
    this.showCreateModal = false;

    // WebSocket handlers
    this.wsHandlers = {};
  }

  async enter(data = {}) {
    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();

    // Join courtyard room
    this.game.socket.joinRoom('courtyard');

    // Load initial data
    await Promise.all([
      this.loadPlayersHere(),
      this.loadLFGPosts(),
      this.loadMyPost()
    ]);
  }

  exit() {
    // Leave courtyard room
    this.game.socket.leaveRoom('courtyard');

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
    if (document.getElementById('courtyard-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'courtyard-scene-styles';
    style.textContent = `
      .courtyard-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #1a2a1a 0%, #0a1a0a 100%);
        display: flex;
        flex-direction: column;
      }

      .courtyard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: ${PARCHMENT_SPACING.lg} ${PARCHMENT_SPACING.xxl};
        background: ${getParchmentGradient('to bottom')};
        border-bottom: ${getParchmentBorder()};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .courtyard-title {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
      }

      .courtyard-title h2 {
        margin: 0;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xxl};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .courtyard-title-icon {
        font-size: 24px;
      }

      .courtyard-back-btn {
        ${getParchmentButtonCSS('secondary')}
      }

      .courtyard-back-btn:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .courtyard-content {
        flex: 1;
        display: flex;
        overflow: hidden;
        padding: ${PARCHMENT_SPACING.lg};
        gap: ${PARCHMENT_SPACING.lg};
      }

      .courtyard-panel {
        ${getParchmentPanelCSS()}
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .courtyard-panel-header {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        background: linear-gradient(to bottom, ${P.mid} 0%, ${P.dark} 100%);
        border-bottom: 1px solid ${P.border};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.primary};
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .courtyard-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
        background: ${P.light};
      }

      /* Left panel - Players Here */
      .courtyard-players-panel {
        width: 280px;
        flex-shrink: 0;
      }

      .courtyard-player-count {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        font-weight: normal;
      }

      .courtyard-player-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        border-radius: ${PARCHMENT_RADIUS.md};
        margin-bottom: ${PARCHMENT_SPACING.xs};
        transition: background 0.2s;
        border: 1px solid transparent;
      }

      .courtyard-player-item:hover {
        background: rgba(139, 115, 85, 0.15);
        border-color: ${P.border};
      }

      .courtyard-player-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: linear-gradient(135deg, ${P.mid}, ${P.dark});
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        color: ${P.text.primary};
        border: 2px solid ${P.border};
      }

      .courtyard-player-info {
        flex: 1;
        min-width: 0;
      }

      .courtyard-player-name {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.primary};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .courtyard-player-details {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
      }

      .courtyard-player-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
        opacity: 0;
        transition: opacity 0.2s;
      }

      .courtyard-player-item:hover .courtyard-player-actions {
        opacity: 1;
      }

      .courtyard-player-action-btn {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.text.secondary};
        cursor: pointer;
        transition: all 0.2s;
      }

      .courtyard-player-action-btn:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
        color: ${P.text.primary};
      }

      /* Right panel - Party Finder */
      .courtyard-lfg-panel {
        flex: 1;
        min-width: 0;
      }

      .courtyard-lfg-create-btn {
        ${getParchmentButtonCSS('primary')}
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .courtyard-lfg-create-btn:hover {
        background: linear-gradient(to bottom, ${P.borderLight} 0%, ${P.border} 100%);
      }

      .courtyard-lfg-create-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .courtyard-lfg-post {
        ${getParchmentCardCSS({ hoverable: true })}
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .courtyard-lfg-post:hover {
        transform: translateY(-1px);
        box-shadow: ${getParchmentShadow(true)};
      }

      .courtyard-lfg-post.courtyard-my-post {
        border-color: ${P.accent.gold};
        box-shadow: ${getParchmentShadow()}, 0 0 0 1px ${P.accent.gold};
      }

      .courtyard-lfg-post-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .courtyard-lfg-post-title {
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.primary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      }

      .courtyard-lfg-post-author {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        margin-top: 2px;
      }

      .courtyard-lfg-post-expires {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
      }

      .courtyard-lfg-post-description {
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        margin-bottom: ${PARCHMENT_SPACING.sm};
        line-height: ${PARCHMENT_TYPOGRAPHY.lineHeight};
      }

      .courtyard-lfg-post-meta {
        display: flex;
        flex-wrap: wrap;
        gap: ${PARCHMENT_SPACING.sm};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .courtyard-lfg-tag {
        padding: 2px ${PARCHMENT_SPACING.sm};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        background: ${P.dark};
        border: 1px solid ${P.border};
        border-radius: 12px;
        color: ${P.text.secondary};
      }

      .courtyard-lfg-tag.courtyard-role {
        border-color: ${P.accent.copper};
        color: ${P.text.primary};
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
      }

      .courtyard-lfg-post-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .courtyard-lfg-action-btn {
        ${getParchmentButtonCSS('secondary')}
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .courtyard-lfg-action-btn:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .courtyard-lfg-action-btn.courtyard-primary {
        ${getParchmentButtonCSS('primary')}
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .courtyard-lfg-action-btn.courtyard-primary:hover {
        background: linear-gradient(to bottom, ${P.borderLight} 0%, ${P.border} 100%);
      }

      .courtyard-lfg-action-btn.courtyard-danger {
        ${getParchmentButtonCSS('danger')}
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .courtyard-lfg-action-btn.courtyard-danger:hover {
        background: linear-gradient(to bottom, #9b5454 0%, ${P.state.error} 100%);
      }

      /* Bottom - Search bar */
      .courtyard-search {
        padding: ${PARCHMENT_SPACING.lg} ${PARCHMENT_SPACING.xxl};
        background: ${getParchmentGradient('to top')};
        border-top: ${getParchmentBorder()};
      }

      .courtyard-search-wrapper {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        max-width: 600px;
        margin: 0 auto;
        position: relative;
      }

      .courtyard-search-input {
        flex: 1;
        ${getParchmentInputCSS()}
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.lg};
      }

      .courtyard-search-input:focus {
        border-color: ${P.borderDark};
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.2);
      }

      .courtyard-search-input::placeholder {
        color: ${P.text.muted};
      }

      .courtyard-search-btn {
        ${getParchmentButtonCSS('primary')}
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.xl};
      }

      .courtyard-search-btn:hover {
        background: linear-gradient(to bottom, ${P.borderLight} 0%, ${P.border} 100%);
      }

      .courtyard-search-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .courtyard-search-results {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md} ${PARCHMENT_RADIUS.md} 0 0;
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
        max-height: 300px;
        overflow-y: auto;
        display: none;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .courtyard-search-results.courtyard-visible {
        display: block;
      }

      .courtyard-search-result-item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.border};
        cursor: pointer;
        transition: background 0.2s;
      }

      .courtyard-search-result-item:hover {
        background: rgba(139, 115, 85, 0.15);
      }

      .courtyard-search-result-item:last-child {
        border-bottom: none;
      }

      /* Create LFG Modal */
      .courtyard-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .courtyard-modal-content {
        ${getParchmentPanelCSS()}
        padding: ${PARCHMENT_SPACING.xxl};
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: ${getParchmentShadow(true)};
      }

      .courtyard-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: ${PARCHMENT_SPACING.xl};
        padding-bottom: ${PARCHMENT_SPACING.md};
        border-bottom: 1px solid ${P.border};
      }

      .courtyard-modal-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${P.text.primary};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .courtyard-modal-close {
        background: none;
        border: none;
        color: ${P.text.muted};
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        transition: color 0.2s;
      }

      .courtyard-modal-close:hover {
        color: ${P.text.primary};
      }

      .courtyard-form-group {
        margin-bottom: ${PARCHMENT_SPACING.lg};
      }

      .courtyard-form-label {
        display: block;
        margin-bottom: ${PARCHMENT_SPACING.xs};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .courtyard-form-input {
        width: 100%;
        ${getParchmentInputCSS()}
        box-sizing: border-box;
      }

      .courtyard-form-input:focus {
        border-color: ${P.borderDark};
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.2);
      }

      .courtyard-form-textarea {
        resize: vertical;
        min-height: 80px;
      }

      .courtyard-form-row {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
      }

      .courtyard-form-row .courtyard-form-group {
        flex: 1;
      }

      .courtyard-role-checkboxes {
        display: flex;
        flex-wrap: wrap;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .courtyard-role-checkbox {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.xs};
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        cursor: pointer;
        transition: all 0.2s;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .courtyard-role-checkbox:hover {
        border-color: ${P.borderDark};
        background: ${P.mid};
      }

      .courtyard-role-checkbox.courtyard-selected {
        background: linear-gradient(to bottom, ${P.border}, ${P.borderDark});
        border-color: ${P.borderDark};
      }

      .courtyard-role-checkbox input {
        display: none;
      }

      .courtyard-role-checkbox span {
        color: ${P.text.secondary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .courtyard-role-checkbox.courtyard-selected span {
        color: ${P.text.inverse};
      }

      .courtyard-modal-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        margin-top: ${PARCHMENT_SPACING.xl};
        padding-top: ${PARCHMENT_SPACING.lg};
        border-top: 1px solid ${P.border};
      }

      .courtyard-modal-actions button {
        flex: 1;
        padding: ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        border-radius: ${PARCHMENT_RADIUS.md};
        cursor: pointer;
        transition: all 0.2s;
      }

      .courtyard-modal-cancel {
        ${getParchmentButtonCSS('secondary')}
      }

      .courtyard-modal-cancel:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .courtyard-modal-submit {
        ${getParchmentButtonCSS('primary')}
      }

      .courtyard-modal-submit:hover {
        background: linear-gradient(to bottom, ${P.borderLight} 0%, ${P.border} 100%);
      }

      .courtyard-modal-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .courtyard-empty-state {
        text-align: center;
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        padding: 40px 20px;
      }

      .courtyard-empty-state-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'courtyard-container';

    container.innerHTML = `
      <div class="courtyard-header">
        <div class="courtyard-title">
          <span class="courtyard-title-icon">&#127970;</span>
          <h2>The Courtyard</h2>
        </div>
        <button class="courtyard-back-btn" id="courtyard-back-btn">Back to World</button>
      </div>

      <div class="courtyard-content">
        <!-- Left Panel: Players Here -->
        <div class="courtyard-panel courtyard-players-panel">
          <div class="courtyard-panel-header">
            Players Here
            <span class="courtyard-player-count" id="player-count">0</span>
          </div>
          <div class="courtyard-panel-content" id="players-list">
            <div class="courtyard-empty-state">
              <div class="courtyard-empty-state-icon">&#128101;</div>
              <div>Loading...</div>
            </div>
          </div>
        </div>

        <!-- Right Panel: Party Finder -->
        <div class="courtyard-panel courtyard-lfg-panel">
          <div class="courtyard-panel-header">
            Party Finder
            <button class="courtyard-lfg-create-btn" id="create-lfg-btn">+ Create LFG Post</button>
          </div>
          <div class="courtyard-panel-content" id="lfg-list">
            <div class="courtyard-empty-state">
              <div class="courtyard-empty-state-icon">&#128220;</div>
              <div>Loading...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom: Search Bar -->
      <div class="courtyard-search">
        <div class="courtyard-search-wrapper">
          <input type="text" class="courtyard-search-input" id="player-search" placeholder="Search for players by username...">
          <button class="courtyard-search-btn" id="search-btn">Search</button>
          <div class="courtyard-search-results" id="search-results"></div>
        </div>
      </div>

      <!-- Create LFG Modal (hidden by default) -->
      <div class="courtyard-modal-overlay" id="create-lfg-modal" style="display: none;">
        <div class="courtyard-modal-content">
          <div class="courtyard-modal-header">
            <span class="courtyard-modal-title">Create LFG Post</span>
            <button class="courtyard-modal-close" id="modal-close">&times;</button>
          </div>
          <form id="lfg-form">
            <div class="courtyard-form-group">
              <label class="courtyard-form-label">Title *</label>
              <input type="text" class="courtyard-form-input" id="lfg-title" placeholder="Looking for tank for dungeon run" maxlength="64" required>
            </div>
            <div class="courtyard-form-group">
              <label class="courtyard-form-label">Description</label>
              <textarea class="courtyard-form-input courtyard-form-textarea" id="lfg-description" placeholder="Describe what you're looking for..." maxlength="256"></textarea>
            </div>
            <div class="courtyard-form-group">
              <label class="courtyard-form-label">Looking For</label>
              <div class="courtyard-role-checkboxes" id="role-checkboxes">
                <label class="courtyard-role-checkbox" data-role="warrior">
                  <input type="checkbox" name="roles" value="warrior">
                  <span>Warrior</span>
                </label>
                <label class="courtyard-role-checkbox" data-role="wizard">
                  <input type="checkbox" name="roles" value="wizard">
                  <span>Wizard</span>
                </label>
                <label class="courtyard-role-checkbox" data-role="monk">
                  <input type="checkbox" name="roles" value="monk">
                  <span>Monk</span>
                </label>
                <label class="courtyard-role-checkbox" data-role="chemist">
                  <input type="checkbox" name="roles" value="chemist">
                  <span>Chemist</span>
                </label>
                <label class="courtyard-role-checkbox" data-role="any">
                  <input type="checkbox" name="roles" value="any">
                  <span>Any</span>
                </label>
              </div>
            </div>
            <div class="courtyard-form-row">
              <div class="courtyard-form-group">
                <label class="courtyard-form-label">Min Level</label>
                <input type="number" class="courtyard-form-input" id="lfg-min-level" value="1" min="1" max="100">
              </div>
              <div class="courtyard-form-group">
                <label class="courtyard-form-label">Max Level</label>
                <input type="number" class="courtyard-form-input" id="lfg-max-level" value="100" min="1" max="100">
              </div>
            </div>
            <div class="courtyard-form-group">
              <label class="courtyard-form-label">Content Tier (optional)</label>
              <select class="courtyard-form-input" id="lfg-content-tier">
                <option value="">Any tier</option>
                <option value="1">Tier 1 - Beginner</option>
                <option value="2">Tier 2 - Normal</option>
                <option value="3">Tier 3 - Hard</option>
                <option value="4">Tier 4 - Expert</option>
                <option value="5">Tier 5 - Legendary</option>
              </select>
            </div>
            <div class="courtyard-modal-actions">
              <button type="button" class="courtyard-modal-cancel" id="modal-cancel-btn">Cancel</button>
              <button type="submit" class="courtyard-modal-submit" id="modal-submit-btn">Create Post</button>
            </div>
          </form>
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
    this.uiElement.querySelector('#courtyard-back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Create LFG button
    this.uiElement.querySelector('#create-lfg-btn')?.addEventListener('click', () => {
      this.openCreateModal();
    }, opts);

    // Modal close buttons
    this.uiElement.querySelector('#modal-close')?.addEventListener('click', () => {
      this.closeCreateModal();
    }, opts);

    this.uiElement.querySelector('#modal-cancel-btn')?.addEventListener('click', () => {
      this.closeCreateModal();
    }, opts);

    // Modal overlay click to close
    this.uiElement.querySelector('#create-lfg-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'create-lfg-modal') {
        this.closeCreateModal();
      }
    }, opts);

    // Role checkboxes
    this.uiElement.querySelectorAll('.courtyard-role-checkbox').forEach(checkbox => {
      checkbox.addEventListener('click', () => {
        checkbox.classList.toggle('courtyard-selected');
        const input = checkbox.querySelector('input');
        input.checked = !input.checked;
      }, opts);
    });

    // LFG form submit
    this.uiElement.querySelector('#lfg-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.createLFGPost();
    }, opts);

    // Player search
    const searchInput = this.uiElement.querySelector('#player-search');
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      if (this.searchQuery.length >= 2) {
        this.searchPlayers();
      } else {
        this.clearSearchResults();
      }
    }, opts);

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.searchPlayers();
      }
    }, opts);

    this.uiElement.querySelector('#search-btn')?.addEventListener('click', () => {
      this.searchPlayers();
    }, opts);

    // Close search results on outside click
    document.addEventListener('click', (e) => {
      const searchWrapper = this.uiElement?.querySelector('.courtyard-search-wrapper');
      if (searchWrapper && !searchWrapper.contains(e.target)) {
        this.clearSearchResults();
      }
    }, opts);
  }

  setupWebSocketHandlers() {
    const handlers = {
      'user_joined': (payload) => {
        if (payload.room === 'courtyard') {
          this.addPlayerToList({
            userId: payload.userId,
            username: payload.username,
            status: 'online'
          });
        }
      },

      'user_left': (payload) => {
        if (payload.room === 'courtyard') {
          this.removePlayerFromList(payload.userId);
        }
      },

      'presence_changed': (payload) => {
        this.updatePlayerStatus(payload.userId, payload.status);
      }
    };

    // Register handlers
    Object.entries(handlers).forEach(([type, handler]) => {
      this.wsHandlers[type] = handler;
      this.game.socket.on(type, handler);
    });
  }

  async loadPlayersHere() {
    try {
      // Get online players from the courtyard room
      const result = await this.game.api.getOnlinePlayers();
      this.playersHere = result.players || [];
      this.renderPlayersList();
    } catch (err) {
      console.error('Failed to load players:', err);
      this.playersHere = [];
      this.renderPlayersList();
    }
  }

  async loadLFGPosts() {
    try {
      const result = await this.game.api.getLFGPosts();
      this.lfgPosts = result.posts || [];
      this.renderLFGList();
    } catch (err) {
      console.error('Failed to load LFG posts:', err);
      this.lfgPosts = [];
      this.renderLFGList();
    }
  }

  async loadMyPost() {
    try {
      const result = await this.game.api.getMyLFGPost();
      this.myPost = result.post;
      this.updateCreateButton();
    } catch (err) {
      console.error('Failed to load my post:', err);
      this.myPost = null;
    }
  }

  renderPlayersList() {
    const container = this.uiElement.querySelector('#players-list');
    const countEl = this.uiElement.querySelector('#player-count');

    if (!container) return;

    if (countEl) {
      countEl.textContent = this.playersHere.length;
    }

    if (this.playersHere.length === 0) {
      container.innerHTML = `
        <div class="courtyard-empty-state">
          <div class="courtyard-empty-state-icon">&#128101;</div>
          <div>No other players here</div>
        </div>
      `;
      return;
    }

    const currentUserId = this.game.state.get('user')?.id;

    container.innerHTML = this.playersHere.map(player => `
      <div class="courtyard-player-item" data-user-id="${player.userId}">
        <div class="courtyard-player-avatar">&#129399;</div>
        <div class="courtyard-player-info">
          <div class="courtyard-player-name">${this.escapeHtml(player.username)}${player.userId === currentUserId ? ' (you)' : ''}</div>
          <div class="courtyard-player-details">Lv. ${player.level || '?'} ${player.class || ''}</div>
        </div>
        ${player.userId !== currentUserId ? `
          <div class="courtyard-player-actions">
            <button class="courtyard-player-action-btn" data-action="inspect" data-user-id="${player.userId}">Inspect</button>
            <button class="courtyard-player-action-btn" data-action="invite" data-user-id="${player.userId}">Invite</button>
            <button class="courtyard-player-action-btn" data-action="friend" data-user-id="${player.userId}">Friend</button>
          </div>
        ` : ''}
      </div>
    `).join('');

    // Add event listeners for player actions
    container.querySelectorAll('.courtyard-player-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const userId = parseInt(btn.dataset.userId, 10);
        this.handlePlayerAction(action, userId);
      });
    });
  }

  renderLFGList() {
    const container = this.uiElement.querySelector('#lfg-list');
    if (!container) return;

    if (this.lfgPosts.length === 0) {
      container.innerHTML = `
        <div class="courtyard-empty-state">
          <div class="courtyard-empty-state-icon">&#128220;</div>
          <div>No active LFG posts</div>
          <div style="font-size: 12px; margin-top: 8px;">Be the first to create one!</div>
        </div>
      `;
      return;
    }

    const currentUserId = this.game.state.get('user')?.id;

    container.innerHTML = this.lfgPosts.map(post => {
      const isMyPost = post.user_id === currentUserId;
      const expiresIn = this.formatTimeRemaining(post.expires_at);
      const roles = post.looking_for || [];

      return `
        <div class="courtyard-lfg-post ${isMyPost ? 'courtyard-my-post' : ''}" data-post-id="${post.id}">
          <div class="courtyard-lfg-post-header">
            <div>
              <div class="courtyard-lfg-post-title">${this.escapeHtml(post.title)}</div>
              <div class="courtyard-lfg-post-author">by ${this.escapeHtml(post.username)}</div>
            </div>
            <div class="courtyard-lfg-post-expires">Expires in ${expiresIn}</div>
          </div>
          ${post.description ? `<div class="courtyard-lfg-post-description">${this.escapeHtml(post.description)}</div>` : ''}
          <div class="courtyard-lfg-post-meta">
            ${roles.length > 0 ? roles.map(role => `<span class="courtyard-lfg-tag courtyard-role">${role}</span>`).join('') : ''}
            <span class="courtyard-lfg-tag">Lv. ${post.min_level}-${post.max_level}</span>
            ${post.content_tier ? `<span class="courtyard-lfg-tag">Tier ${post.content_tier}</span>` : ''}
          </div>
          <div class="courtyard-lfg-post-actions">
            ${isMyPost ? `
              <button class="courtyard-lfg-action-btn courtyard-danger" data-action="delete" data-post-id="${post.id}">Delete Post</button>
            ` : `
              <button class="courtyard-lfg-action-btn courtyard-primary" data-action="apply" data-post-id="${post.id}">Apply</button>
              <button class="courtyard-lfg-action-btn" data-action="whisper" data-user-id="${post.user_id}" data-username="${this.escapeHtml(post.username)}">Whisper</button>
            `}
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners for LFG actions
    container.querySelectorAll('.courtyard-lfg-action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;

        if (action === 'apply') {
          await this.applyToPost(parseInt(btn.dataset.postId, 10));
        } else if (action === 'delete') {
          await this.deletePost(parseInt(btn.dataset.postId, 10));
        } else if (action === 'whisper') {
          this.startWhisper(parseInt(btn.dataset.userId, 10), btn.dataset.username);
        }
      });
    });
  }

  addPlayerToList(player) {
    // Add player if not already in list
    if (!this.playersHere.find(p => p.userId === player.userId)) {
      this.playersHere.push(player);
      this.renderPlayersList();
    }
  }

  removePlayerFromList(userId) {
    this.playersHere = this.playersHere.filter(p => p.userId !== userId);
    this.renderPlayersList();
  }

  updatePlayerStatus(userId, status) {
    const player = this.playersHere.find(p => p.userId === userId);
    if (player) {
      player.status = status;
      this.renderPlayersList();
    }
  }

  handlePlayerAction(action, userId) {
    const player = this.playersHere.find(p => p.userId === userId);
    if (!player) return;

    switch (action) {
      case 'inspect':
        this.game.showNotification(`Inspecting ${player.username} - Coming soon!`, 'info');
        break;
      case 'invite':
        this.game.socket.send('party_invite', { targetUserId: userId });
        this.game.showNotification(`Party invite sent to ${player.username}`, 'success');
        break;
      case 'friend':
        this.game.showNotification(`Friend request to ${player.username} - Coming soon!`, 'info');
        break;
    }
  }

  openCreateModal() {
    if (this.myPost) {
      this.game.showNotification('You already have an active LFG post. Delete it first.', 'warning');
      return;
    }

    const modal = this.uiElement.querySelector('#create-lfg-modal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  closeCreateModal() {
    const modal = this.uiElement.querySelector('#create-lfg-modal');
    if (modal) {
      modal.style.display = 'none';
    }

    // Reset form
    const form = this.uiElement.querySelector('#lfg-form');
    if (form) form.reset();

    // Reset role checkboxes
    this.uiElement.querySelectorAll('.courtyard-role-checkbox').forEach(cb => {
      cb.classList.remove('courtyard-selected');
    });
  }

  updateCreateButton() {
    const btn = this.uiElement.querySelector('#create-lfg-btn');
    if (btn) {
      btn.disabled = !!this.myPost;
      btn.textContent = this.myPost ? 'Post Active' : '+ Create LFG Post';
    }
  }

  async createLFGPost() {
    const title = this.uiElement.querySelector('#lfg-title')?.value.trim();
    const description = this.uiElement.querySelector('#lfg-description')?.value.trim();
    const minLevel = parseInt(this.uiElement.querySelector('#lfg-min-level')?.value, 10) || 1;
    const maxLevel = parseInt(this.uiElement.querySelector('#lfg-max-level')?.value, 10) || 100;
    const contentTier = this.uiElement.querySelector('#lfg-content-tier')?.value;

    // Get selected roles
    const lookingFor = [];
    this.uiElement.querySelectorAll('.courtyard-role-checkbox input:checked').forEach(input => {
      lookingFor.push(input.value);
    });

    if (!title || title.length < 3) {
      this.game.showNotification('Title must be at least 3 characters', 'error');
      return;
    }

    try {
      const result = await this.game.api.createLFGPost({
        title,
        description,
        lookingFor,
        minLevel,
        maxLevel,
        contentTier: contentTier || null
      });

      this.myPost = result.post;
      this.lfgPosts.unshift(result.post);
      this.renderLFGList();
      this.updateCreateButton();
      this.closeCreateModal();
      this.game.showNotification('LFG post created!', 'success');
    } catch (err) {
      this.game.showNotification(err.message || 'Failed to create post', 'error');
    }
  }

  async applyToPost(postId) {
    try {
      const result = await this.game.api.applyToLFGPost(postId);
      this.game.showNotification(result.message || 'Application sent!', 'success');
    } catch (err) {
      this.game.showNotification(err.message || 'Failed to apply', 'error');
    }
  }

  async deletePost(postId) {
    try {
      await this.game.api.deleteLFGPost(postId);
      this.myPost = null;
      this.lfgPosts = this.lfgPosts.filter(p => p.id !== postId);
      this.renderLFGList();
      this.updateCreateButton();
      this.game.showNotification('LFG post deleted', 'success');
    } catch (err) {
      this.game.showNotification(err.message || 'Failed to delete post', 'error');
    }
  }

  startWhisper(userId, username) {
    // Switch to tavern and start DM
    this.game.scenes.switchTo('tavern');
    // The tavern scene will handle starting the DM
    setTimeout(() => {
      const tavernScene = this.game.scenes.scenes.tavern;
      if (tavernScene && typeof tavernScene.startDM === 'function') {
        tavernScene.startDM(userId, username);
      }
    }, 100);
  }

  async searchPlayers() {
    if (!this.searchQuery || this.searchQuery.length < 2) {
      this.clearSearchResults();
      return;
    }

    if (this.isSearching) return;
    this.isSearching = true;

    try {
      const result = await this.game.api.searchPlayers(this.searchQuery);
      this.searchResults = result.players || [];
      this.renderSearchResults();
    } catch (err) {
      console.error('Search failed:', err);
      this.searchResults = [];
      this.renderSearchResults();
    } finally {
      this.isSearching = false;
    }
  }

  renderSearchResults() {
    const container = this.uiElement.querySelector('#search-results');
    if (!container) return;

    if (this.searchResults.length === 0) {
      container.innerHTML = `
        <div class="courtyard-search-result-item" style="justify-content: center; color: ${P.text.muted};">
          No players found
        </div>
      `;
      container.classList.add('courtyard-visible');
      return;
    }

    const currentUserId = this.game.state.get('user')?.id;

    container.innerHTML = this.searchResults.filter(p => p.userId !== currentUserId).map(player => `
      <div class="courtyard-search-result-item" data-user-id="${player.userId}">
        <div class="courtyard-player-avatar" style="width: 32px; height: 32px; font-size: 14px;">&#129399;</div>
        <div class="courtyard-player-info">
          <div class="courtyard-player-name">${this.escapeHtml(player.username)}</div>
          <div class="courtyard-player-details">${player.status || 'offline'}</div>
        </div>
        <div class="courtyard-player-actions" style="opacity: 1;">
          <button class="courtyard-player-action-btn" data-action="invite" data-user-id="${player.userId}">Invite</button>
          <button class="courtyard-player-action-btn" data-action="friend" data-user-id="${player.userId}">Friend</button>
        </div>
      </div>
    `).join('');

    container.classList.add('courtyard-visible');

    // Add event listeners
    container.querySelectorAll('.courtyard-player-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const userId = parseInt(btn.dataset.userId, 10);
        const player = this.searchResults.find(p => p.userId === userId);
        if (player) {
          this.handlePlayerAction(action, userId);
        }
      });
    });
  }

  clearSearchResults() {
    const container = this.uiElement.querySelector('#search-results');
    if (container) {
      container.classList.remove('courtyard-visible');
      container.innerHTML = '';
    }
    this.searchResults = [];
  }

  formatTimeRemaining(expiresAt) {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires - now;

    if (diff <= 0) return 'expired';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
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
    // Keep the green outdoor ambiance for the canvas background
    // UI is HTML-based with parchment theme
    ctx.fillStyle = '#0a1a0a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
