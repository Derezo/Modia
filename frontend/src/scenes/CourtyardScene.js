import { Scene } from './Scene.js';

/**
 * CourtyardScene - Social hub for party finding and player interaction
 * Features: Real-time player lobby, LFG party finder board, player search
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
        padding: 16px 24px;
        background: rgba(0,0,0,0.3);
        border-bottom: 1px solid #2a4a2a;
      }

      .courtyard-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .courtyard-title h2 {
        margin: 0;
        color: #7fff7f;
      }

      .courtyard-title-icon {
        font-size: 24px;
      }

      .courtyard-content {
        flex: 1;
        display: flex;
        overflow: hidden;
        padding: 16px;
        gap: 16px;
      }

      .courtyard-panel {
        background: rgba(0,0,0,0.4);
        border: 2px solid #2a4a2a;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .courtyard-panel-header {
        padding: 12px 16px;
        background: rgba(0,0,0,0.3);
        border-bottom: 1px solid #2a4a2a;
        font-weight: bold;
        color: #7fff7f;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .courtyard-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }

      /* Left panel - Players Here */
      .players-panel {
        width: 280px;
        flex-shrink: 0;
      }

      .player-count {
        font-size: 12px;
        color: #8a8aaa;
        font-weight: normal;
      }

      .player-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 4px;
        transition: background 0.2s;
      }

      .player-item:hover {
        background: rgba(127, 255, 127, 0.1);
      }

      .player-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2a4a2a, #1a3a1a);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        color: #7fff7f;
        border: 2px solid #3a5a3a;
      }

      .player-info {
        flex: 1;
        min-width: 0;
      }

      .player-name {
        font-weight: bold;
        color: #e0e0e0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .player-details {
        font-size: 12px;
        color: #8a8aaa;
      }

      .player-actions {
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .player-item:hover .player-actions {
        opacity: 1;
      }

      .player-action-btn {
        padding: 4px 8px;
        font-size: 10px;
        background: rgba(0,0,0,0.4);
        border: 1px solid #3a5a3a;
        border-radius: 4px;
        color: #8a8aaa;
        cursor: pointer;
        transition: all 0.2s;
      }

      .player-action-btn:hover {
        background: rgba(127, 255, 127, 0.2);
        border-color: #7fff7f;
        color: #7fff7f;
      }

      /* Right panel - Party Finder */
      .lfg-panel {
        flex: 1;
        min-width: 0;
      }

      .lfg-create-btn {
        padding: 6px 12px;
        font-size: 12px;
        background: linear-gradient(180deg, #4a7a4a, #3a5a3a);
        border: none;
        border-radius: 6px;
        color: white;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.2s;
      }

      .lfg-create-btn:hover {
        background: linear-gradient(180deg, #5a9a5a, #4a7a4a);
      }

      .lfg-create-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .lfg-post {
        background: rgba(0,0,0,0.3);
        border: 1px solid #2a4a2a;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        transition: all 0.2s;
      }

      .lfg-post:hover {
        border-color: #4a7a4a;
        background: rgba(0,0,0,0.4);
      }

      .lfg-post.my-post {
        border-color: #7fff7f;
        background: rgba(127, 255, 127, 0.05);
      }

      .lfg-post-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }

      .lfg-post-title {
        font-weight: bold;
        color: #7fff7f;
        font-size: 14px;
      }

      .lfg-post-author {
        font-size: 12px;
        color: #8a8aaa;
        margin-top: 2px;
      }

      .lfg-post-expires {
        font-size: 11px;
        color: #666;
      }

      .lfg-post-description {
        color: #c0c0c0;
        font-size: 13px;
        margin-bottom: 8px;
        line-height: 1.4;
      }

      .lfg-post-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }

      .lfg-tag {
        padding: 2px 8px;
        font-size: 11px;
        background: rgba(0,0,0,0.3);
        border: 1px solid #3a5a3a;
        border-radius: 12px;
        color: #8a8aaa;
      }

      .lfg-tag.role {
        border-color: #4a7a4a;
        color: #7fff7f;
      }

      .lfg-post-actions {
        display: flex;
        gap: 8px;
      }

      .lfg-action-btn {
        padding: 6px 12px;
        font-size: 12px;
        background: rgba(0,0,0,0.4);
        border: 1px solid #3a5a3a;
        border-radius: 6px;
        color: #8a8aaa;
        cursor: pointer;
        transition: all 0.2s;
      }

      .lfg-action-btn:hover {
        background: rgba(127, 255, 127, 0.2);
        border-color: #7fff7f;
        color: #7fff7f;
      }

      .lfg-action-btn.primary {
        background: linear-gradient(180deg, #4a7a4a, #3a5a3a);
        border-color: #5a9a5a;
        color: white;
      }

      .lfg-action-btn.primary:hover {
        background: linear-gradient(180deg, #5a9a5a, #4a7a4a);
      }

      .lfg-action-btn.danger {
        border-color: #c62828;
        color: #ff6666;
      }

      .lfg-action-btn.danger:hover {
        background: rgba(198, 40, 40, 0.2);
      }

      /* Bottom - Search bar */
      .courtyard-search {
        padding: 16px 24px;
        background: rgba(0,0,0,0.3);
        border-top: 1px solid #2a4a2a;
      }

      .search-wrapper {
        display: flex;
        gap: 12px;
        max-width: 600px;
        margin: 0 auto;
      }

      .search-input {
        flex: 1;
        padding: 10px 16px;
        background: rgba(0,0,0,0.4);
        border: 2px solid #2a4a2a;
        border-radius: 8px;
        color: #fff;
        font-size: 14px;
      }

      .search-input:focus {
        outline: none;
        border-color: #7fff7f;
      }

      .search-input::placeholder {
        color: #666;
      }

      .search-btn {
        padding: 10px 20px;
        background: linear-gradient(180deg, #4a7a4a, #3a5a3a);
        border: none;
        border-radius: 8px;
        color: white;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }

      .search-btn:hover {
        background: linear-gradient(180deg, #5a9a5a, #4a7a4a);
      }

      .search-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .search-results {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        background: #1a2a1a;
        border: 2px solid #2a4a2a;
        border-radius: 8px 8px 0 0;
        max-height: 300px;
        overflow-y: auto;
        display: none;
      }

      .search-results.visible {
        display: block;
      }

      .search-result-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        border-bottom: 1px solid #2a4a2a;
        cursor: pointer;
        transition: background 0.2s;
      }

      .search-result-item:hover {
        background: rgba(127, 255, 127, 0.1);
      }

      .search-result-item:last-child {
        border-bottom: none;
      }

      /* Create LFG Modal */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .modal-content {
        background: #1a2a1a;
        border: 2px solid #2a4a2a;
        border-radius: 12px;
        padding: 24px;
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .modal-title {
        font-size: 18px;
        font-weight: bold;
        color: #7fff7f;
      }

      .modal-close {
        background: none;
        border: none;
        color: #8a8aaa;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .modal-close:hover {
        color: #fff;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .form-label {
        display: block;
        margin-bottom: 6px;
        color: #8a8aaa;
        font-size: 13px;
      }

      .form-input {
        width: 100%;
        padding: 10px 12px;
        background: rgba(0,0,0,0.4);
        border: 2px solid #2a4a2a;
        border-radius: 6px;
        color: #fff;
        font-size: 14px;
        box-sizing: border-box;
      }

      .form-input:focus {
        outline: none;
        border-color: #7fff7f;
      }

      .form-textarea {
        resize: vertical;
        min-height: 80px;
      }

      .form-row {
        display: flex;
        gap: 12px;
      }

      .form-row .form-group {
        flex: 1;
      }

      .role-checkboxes {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .role-checkbox {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(0,0,0,0.3);
        border: 1px solid #2a4a2a;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .role-checkbox:hover {
        border-color: #4a7a4a;
      }

      .role-checkbox.selected {
        background: rgba(127, 255, 127, 0.2);
        border-color: #7fff7f;
      }

      .role-checkbox input {
        display: none;
      }

      .role-checkbox span {
        color: #8a8aaa;
        font-size: 13px;
      }

      .role-checkbox.selected span {
        color: #7fff7f;
      }

      .modal-actions {
        display: flex;
        gap: 12px;
        margin-top: 20px;
      }

      .modal-actions button {
        flex: 1;
        padding: 12px;
        font-size: 14px;
        font-weight: bold;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .modal-cancel {
        background: rgba(0,0,0,0.4);
        border: 2px solid #3a5a3a;
        color: #8a8aaa;
      }

      .modal-cancel:hover {
        border-color: #5a7a5a;
        color: #fff;
      }

      .modal-submit {
        background: linear-gradient(180deg, #4a7a4a, #3a5a3a);
        border: none;
        color: white;
      }

      .modal-submit:hover {
        background: linear-gradient(180deg, #5a9a5a, #4a7a4a);
      }

      .modal-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .empty-state {
        text-align: center;
        color: #666;
        padding: 40px 20px;
      }

      .empty-state-icon {
        font-size: 48px;
        margin-bottom: 12px;
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
        <button class="btn btn-secondary" id="courtyard-back-btn">Back to World</button>
      </div>

      <div class="courtyard-content">
        <!-- Left Panel: Players Here -->
        <div class="courtyard-panel players-panel">
          <div class="courtyard-panel-header">
            Players Here
            <span class="player-count" id="player-count">0</span>
          </div>
          <div class="courtyard-panel-content" id="players-list">
            <div class="empty-state">
              <div class="empty-state-icon">&#128101;</div>
              <div>Loading...</div>
            </div>
          </div>
        </div>

        <!-- Right Panel: Party Finder -->
        <div class="courtyard-panel lfg-panel">
          <div class="courtyard-panel-header">
            Party Finder
            <button class="lfg-create-btn" id="create-lfg-btn">+ Create LFG Post</button>
          </div>
          <div class="courtyard-panel-content" id="lfg-list">
            <div class="empty-state">
              <div class="empty-state-icon">&#128220;</div>
              <div>Loading...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom: Search Bar -->
      <div class="courtyard-search">
        <div class="search-wrapper" style="position: relative;">
          <input type="text" class="search-input" id="player-search" placeholder="Search for players by username...">
          <button class="search-btn" id="search-btn">Search</button>
          <div class="search-results" id="search-results"></div>
        </div>
      </div>

      <!-- Create LFG Modal (hidden by default) -->
      <div class="modal-overlay" id="create-lfg-modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <span class="modal-title">Create LFG Post</span>
            <button class="modal-close" id="modal-close">&times;</button>
          </div>
          <form id="lfg-form">
            <div class="form-group">
              <label class="form-label">Title *</label>
              <input type="text" class="form-input" id="lfg-title" placeholder="Looking for tank for dungeon run" maxlength="64" required>
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <textarea class="form-input form-textarea" id="lfg-description" placeholder="Describe what you're looking for..." maxlength="256"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Looking For</label>
              <div class="role-checkboxes" id="role-checkboxes">
                <label class="role-checkbox" data-role="warrior">
                  <input type="checkbox" name="roles" value="warrior">
                  <span>Warrior</span>
                </label>
                <label class="role-checkbox" data-role="wizard">
                  <input type="checkbox" name="roles" value="wizard">
                  <span>Wizard</span>
                </label>
                <label class="role-checkbox" data-role="monk">
                  <input type="checkbox" name="roles" value="monk">
                  <span>Monk</span>
                </label>
                <label class="role-checkbox" data-role="chemist">
                  <input type="checkbox" name="roles" value="chemist">
                  <span>Chemist</span>
                </label>
                <label class="role-checkbox" data-role="any">
                  <input type="checkbox" name="roles" value="any">
                  <span>Any</span>
                </label>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Min Level</label>
                <input type="number" class="form-input" id="lfg-min-level" value="1" min="1" max="100">
              </div>
              <div class="form-group">
                <label class="form-label">Max Level</label>
                <input type="number" class="form-input" id="lfg-max-level" value="100" min="1" max="100">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Content Tier (optional)</label>
              <select class="form-input" id="lfg-content-tier">
                <option value="">Any tier</option>
                <option value="1">Tier 1 - Beginner</option>
                <option value="2">Tier 2 - Normal</option>
                <option value="3">Tier 3 - Hard</option>
                <option value="4">Tier 4 - Expert</option>
                <option value="5">Tier 5 - Legendary</option>
              </select>
            </div>
            <div class="modal-actions">
              <button type="button" class="modal-cancel" id="modal-cancel-btn">Cancel</button>
              <button type="submit" class="modal-submit" id="modal-submit-btn">Create Post</button>
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
    this.uiElement.querySelectorAll('.role-checkbox').forEach(checkbox => {
      checkbox.addEventListener('click', () => {
        checkbox.classList.toggle('selected');
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
      const searchWrapper = this.uiElement?.querySelector('.search-wrapper');
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
        <div class="empty-state">
          <div class="empty-state-icon">&#128101;</div>
          <div>No other players here</div>
        </div>
      `;
      return;
    }

    const currentUserId = this.game.state.get('user')?.id;

    container.innerHTML = this.playersHere.map(player => `
      <div class="player-item" data-user-id="${player.userId}">
        <div class="player-avatar">&#129399;</div>
        <div class="player-info">
          <div class="player-name">${this.escapeHtml(player.username)}${player.userId === currentUserId ? ' (you)' : ''}</div>
          <div class="player-details">Lv. ${player.level || '?'} ${player.class || ''}</div>
        </div>
        ${player.userId !== currentUserId ? `
          <div class="player-actions">
            <button class="player-action-btn" data-action="inspect" data-user-id="${player.userId}">Inspect</button>
            <button class="player-action-btn" data-action="invite" data-user-id="${player.userId}">Invite</button>
            <button class="player-action-btn" data-action="friend" data-user-id="${player.userId}">Friend</button>
          </div>
        ` : ''}
      </div>
    `).join('');

    // Add event listeners for player actions
    container.querySelectorAll('.player-action-btn').forEach(btn => {
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
        <div class="empty-state">
          <div class="empty-state-icon">&#128220;</div>
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
        <div class="lfg-post ${isMyPost ? 'my-post' : ''}" data-post-id="${post.id}">
          <div class="lfg-post-header">
            <div>
              <div class="lfg-post-title">${this.escapeHtml(post.title)}</div>
              <div class="lfg-post-author">by ${this.escapeHtml(post.username)}</div>
            </div>
            <div class="lfg-post-expires">Expires in ${expiresIn}</div>
          </div>
          ${post.description ? `<div class="lfg-post-description">${this.escapeHtml(post.description)}</div>` : ''}
          <div class="lfg-post-meta">
            ${roles.length > 0 ? roles.map(role => `<span class="lfg-tag role">${role}</span>`).join('') : ''}
            <span class="lfg-tag">Lv. ${post.min_level}-${post.max_level}</span>
            ${post.content_tier ? `<span class="lfg-tag">Tier ${post.content_tier}</span>` : ''}
          </div>
          <div class="lfg-post-actions">
            ${isMyPost ? `
              <button class="lfg-action-btn danger" data-action="delete" data-post-id="${post.id}">Delete Post</button>
            ` : `
              <button class="lfg-action-btn primary" data-action="apply" data-post-id="${post.id}">Apply</button>
              <button class="lfg-action-btn" data-action="whisper" data-user-id="${post.user_id}" data-username="${this.escapeHtml(post.username)}">Whisper</button>
            `}
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners for LFG actions
    container.querySelectorAll('.lfg-action-btn').forEach(btn => {
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
    this.uiElement.querySelectorAll('.role-checkbox').forEach(cb => {
      cb.classList.remove('selected');
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
    this.uiElement.querySelectorAll('.role-checkbox input:checked').forEach(input => {
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
        <div class="search-result-item" style="justify-content: center; color: #666;">
          No players found
        </div>
      `;
      container.classList.add('visible');
      return;
    }

    const currentUserId = this.game.state.get('user')?.id;

    container.innerHTML = this.searchResults.filter(p => p.userId !== currentUserId).map(player => `
      <div class="search-result-item" data-user-id="${player.userId}">
        <div class="player-avatar" style="width: 32px; height: 32px; font-size: 14px;">&#129399;</div>
        <div class="player-info">
          <div class="player-name">${this.escapeHtml(player.username)}</div>
          <div class="player-details">${player.status || 'offline'}</div>
        </div>
        <div class="player-actions" style="opacity: 1;">
          <button class="player-action-btn" data-action="invite" data-user-id="${player.userId}">Invite</button>
          <button class="player-action-btn" data-action="friend" data-user-id="${player.userId}">Friend</button>
        </div>
      </div>
    `).join('');

    container.classList.add('visible');

    // Add event listeners
    container.querySelectorAll('.player-action-btn').forEach(btn => {
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
      container.classList.remove('visible');
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
    // UI is HTML-based
    ctx.fillStyle = '#0a1a0a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
