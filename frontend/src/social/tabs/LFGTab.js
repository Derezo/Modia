import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentButtonCSS,
  getParchmentInputCSS,
  getParchmentGradient
} from '../../ui/parchment/index.js';
import { parchmentToast } from '../../ui/parchment/ParchmentToast.js';

const P = PARCHMENT_COLORS;

/**
 * LFGTab - Looking for Group posts
 *
 * Features:
 * - Browse LFG posts
 * - Create new LFG post
 * - Apply to posts
 * - Manage own post
 */
export class LFGTab {
  constructor(options) {
    this.container = options.container;
    this.game = options.game;
    this.onBadgeUpdate = options.onBadgeUpdate;

    this.posts = [];
    this.myPost = null;
    this.isLoading = true;
    this.showCreateModal = false;

    this.abortController = null;
  }

  static addStyles() {
    if (document.getElementById('lfg-tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'lfg-tab-styles';
    style.textContent = `
      .lfg-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .lfg-tab-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderLight};
        background: ${P.light};
      }

      .lfg-tab-title {
        margin: 0;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .lfg-create-btn {
        ${getParchmentButtonCSS('primary')}
      }

      .lfg-tab-body {
        flex: 1;
        overflow-y: auto;
        padding: ${PARCHMENT_SPACING.md};
      }

      /* Post card */
      .lfg-post {
        background: ${P.mid};
        border-radius: ${PARCHMENT_RADIUS.md};
        padding: ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .lfg-post.my-post {
        border: 2px solid ${P.accent.burgundy};
      }

      .lfg-post-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .lfg-post-title {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .lfg-post-meta {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.muted};
      }

      .lfg-post-description {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .lfg-post-tags {
        display: flex;
        flex-wrap: wrap;
        gap: ${PARCHMENT_SPACING.xs};
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .lfg-post-tag {
        padding: 2px 8px;
        background: ${P.light};
        border-radius: ${PARCHMENT_RADIUS.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${P.text.secondary};
      }

      .lfg-post-tag.role {
        background: ${P.accent.copper};
        color: ${P.text.primary};
      }

      .lfg-post-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .lfg-post-btn {
        ${getParchmentButtonCSS('secondary')}
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .lfg-post-btn.apply {
        ${getParchmentButtonCSS('primary')}
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.md};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .lfg-post-btn.delete {
        background: ${P.state.error};
        border-color: ${P.state.error};
        color: white;
      }

      /* Empty state */
      .lfg-tab-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
        text-align: center;
      }

      .lfg-tab-empty-icon {
        font-size: 48px;
        margin-bottom: ${PARCHMENT_SPACING.md};
        opacity: 0.5;
      }

      .lfg-tab-empty-text {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        color: ${P.text.secondary};
      }

      /* Create Modal */
      .lfg-modal-overlay {
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

      .lfg-modal {
        background: ${getParchmentGradient()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.lg};
        width: 90%;
        max-width: 450px;
        max-height: 80vh;
        overflow-y: auto;
      }

      .lfg-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .lfg-modal-title {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: 600;
        color: ${P.text.primary};
      }

      .lfg-modal-close {
        background: none;
        border: none;
        font-size: 24px;
        color: ${P.text.muted};
        cursor: pointer;
      }

      .lfg-form-group {
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      .lfg-form-label {
        display: block;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.secondary};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .lfg-form-input {
        width: 100%;
        ${getParchmentInputCSS()}
        box-sizing: border-box;
      }

      .lfg-form-textarea {
        min-height: 80px;
        resize: vertical;
      }

      .lfg-form-row {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
      }

      .lfg-form-row .lfg-form-group {
        flex: 1;
      }

      .lfg-role-grid {
        display: flex;
        flex-wrap: wrap;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .lfg-role-option {
        padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .lfg-role-option:hover {
        border-color: ${P.borderDark};
      }

      .lfg-role-option.selected {
        background: ${P.accent.copper};
        border-color: ${P.accent.copper};
      }

      .lfg-modal-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.sm};
        margin-top: ${PARCHMENT_SPACING.lg};
      }

      .lfg-modal-btn {
        flex: 1;
        ${getParchmentButtonCSS('secondary')}
      }

      .lfg-modal-btn.primary {
        ${getParchmentButtonCSS('primary')}
      }

      /* Loading */
      .lfg-tab-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.xxl};
      }

      .lfg-tab-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid ${P.borderLight};
        border-top-color: ${P.accent.burgundy};
        border-radius: 50%;
        animation: lfg-spin 1s linear infinite;
        margin-bottom: ${PARCHMENT_SPACING.md};
      }

      @keyframes lfg-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  async init() {
    LFGTab.addStyles();
    this.abortController = new AbortController();

    this.render();
    await this.loadData();
  }

  render() {
    this.container.innerHTML = `
      <div class="lfg-tab">
        <div class="lfg-tab-header">
          <h3 class="lfg-tab-title">Looking for Group</h3>
          <button class="lfg-create-btn" data-action="create" ${this.myPost ? 'disabled' : ''}>
            ${this.myPost ? 'Post Active' : 'Create Post'}
          </button>
        </div>
        <div class="lfg-tab-body">
          ${this.isLoading ? this.renderLoading() : this.renderContent()}
        </div>
      </div>
      ${this.showCreateModal ? this.renderCreateModal() : ''}
    `;

    if (!this.isLoading) {
      this.setupEventListeners();
    }
  }

  renderLoading() {
    return `
      <div class="lfg-tab-loading">
        <div class="lfg-tab-spinner"></div>
        <span>Loading posts...</span>
      </div>
    `;
  }

  renderContent() {
    if (this.posts.length === 0) {
      return `
        <div class="lfg-tab-empty">
          <div class="lfg-tab-empty-icon">&#x1F50D;</div>
          <div class="lfg-tab-empty-text">No LFG posts yet</div>
        </div>
      `;
    }

    return this.posts.map(post => this.renderPost(post)).join('');
  }

  renderPost(post) {
    const isMyPost = post.user_id === this.game.userId;
    const roles = post.looking_for || [];

    return `
      <div class="lfg-post ${isMyPost ? 'my-post' : ''}" data-post-id="${post.id}">
        <div class="lfg-post-header">
          <div class="lfg-post-title">${this.escapeHtml(post.title)}</div>
          <div class="lfg-post-meta">
            by ${this.escapeHtml(post.username)} · Lv.${post.min_level}-${post.max_level}
          </div>
        </div>
        ${post.description ? `
          <div class="lfg-post-description">${this.escapeHtml(post.description)}</div>
        ` : ''}
        <div class="lfg-post-tags">
          ${roles.map(role => `<span class="lfg-post-tag role">${role}</span>`).join('')}
          <span class="lfg-post-tag">Tier ${post.content_tier || 1}</span>
        </div>
        <div class="lfg-post-actions">
          ${isMyPost ? `
            <button class="lfg-post-btn delete" data-action="delete" data-id="${post.id}">Delete</button>
          ` : `
            <button class="lfg-post-btn apply" data-action="apply" data-id="${post.id}">Apply</button>
          `}
        </div>
      </div>
    `;
  }

  renderCreateModal() {
    const ROLES = ['warrior', 'wizard', 'monk', 'chemist', 'tank', 'healer', 'dps', 'any'];

    return `
      <div class="lfg-modal-overlay" data-action="close-modal">
        <div class="lfg-modal" onclick="event.stopPropagation()">
          <div class="lfg-modal-header">
            <span class="lfg-modal-title">Create LFG Post</span>
            <button class="lfg-modal-close" data-action="close-modal">&times;</button>
          </div>

          <div class="lfg-form-group">
            <label class="lfg-form-label">Title</label>
            <input type="text" class="lfg-form-input" id="lfg-title" placeholder="Looking for..." maxlength="64">
          </div>

          <div class="lfg-form-group">
            <label class="lfg-form-label">Description (optional)</label>
            <textarea class="lfg-form-input lfg-form-textarea" id="lfg-description" placeholder="Details..." maxlength="256"></textarea>
          </div>

          <div class="lfg-form-row">
            <div class="lfg-form-group">
              <label class="lfg-form-label">Min Level</label>
              <input type="number" class="lfg-form-input" id="lfg-min-level" value="1" min="1" max="100">
            </div>
            <div class="lfg-form-group">
              <label class="lfg-form-label">Max Level</label>
              <input type="number" class="lfg-form-input" id="lfg-max-level" value="100" min="1" max="100">
            </div>
            <div class="lfg-form-group">
              <label class="lfg-form-label">Tier</label>
              <input type="number" class="lfg-form-input" id="lfg-tier" value="1" min="1" max="5">
            </div>
          </div>

          <div class="lfg-form-group">
            <label class="lfg-form-label">Looking for</label>
            <div class="lfg-role-grid" id="lfg-roles">
              ${ROLES.map(role => `
                <div class="lfg-role-option" data-role="${role}">${role}</div>
              `).join('')}
            </div>
          </div>

          <div class="lfg-modal-actions">
            <button class="lfg-modal-btn" data-action="close-modal">Cancel</button>
            <button class="lfg-modal-btn primary" data-action="submit-post">Create Post</button>
          </div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    // Reset AbortController to prevent duplicate listeners on re-render
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Create button
    this.container.querySelector('[data-action="create"]')?.addEventListener('click', () => {
      this.showCreateModal = true;
      this.render();
    }, { signal });

    // Close modal
    this.container.querySelectorAll('[data-action="close-modal"]').forEach(el => {
      el.addEventListener('click', () => {
        this.showCreateModal = false;
        this.render();
      }, { signal });
    });

    // Role selection
    this.container.querySelectorAll('.lfg-role-option').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('selected');
      }, { signal });
    });

    // Submit post
    this.container.querySelector('[data-action="submit-post"]')?.addEventListener('click', () => {
      this.submitPost();
    }, { signal });

    // Apply to post
    this.container.querySelectorAll('[data-action="apply"]').forEach(btn => {
      btn.addEventListener('click', () => this.applyToPost(btn.dataset.id), { signal });
    });

    // Delete post
    this.container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => this.deletePost(btn.dataset.id), { signal });
    });
  }

  async loadData() {
    this.isLoading = true;
    this.render();

    try {
      const [postsResponse, myPostResponse] = await Promise.all([
        this.game.api.getLFGPosts(),
        this.game.api.getMyLFGPost()
      ]);

      this.posts = postsResponse.posts || [];
      this.myPost = myPostResponse.post || null;

      this.isLoading = false;
      this.render();
    } catch (error) {
      console.error('Failed to load LFG data:', error);
      this.isLoading = false;
      this.render();
    }
  }

  async submitPost() {
    const title = document.getElementById('lfg-title')?.value?.trim();
    const description = document.getElementById('lfg-description')?.value?.trim();
    const minLevel = parseInt(document.getElementById('lfg-min-level')?.value) || 1;
    const maxLevel = parseInt(document.getElementById('lfg-max-level')?.value) || 100;
    const contentTier = parseInt(document.getElementById('lfg-tier')?.value) || 1;
    const selectedRoles = Array.from(this.container.querySelectorAll('.lfg-role-option.selected'))
      .map(el => el.dataset.role);

    if (!title || title.length < 3) {
      parchmentToast.error('Error', 'Title must be at least 3 characters');
      return;
    }

    try {
      const response = await this.game.api.createLFGPost({
        title,
        description,
        minLevel,
        maxLevel,
        contentTier,
        lookingFor: selectedRoles.length > 0 ? selectedRoles : ['any']
      });

      if (response.success) {
        this.showCreateModal = false;
        parchmentToast.success('Post Created', 'Your LFG post is now live!');
        await this.loadData();
      }
    } catch (error) {
      console.error('Failed to create post:', error);
      parchmentToast.error('Error', error.message || 'Failed to create post');
    }
  }

  async applyToPost(postId) {
    try {
      const response = await this.game.api.applyToLFGPost(postId);
      if (response.success) {
        parchmentToast.success('Applied', 'Application sent to post owner');
      }
    } catch (error) {
      console.error('Failed to apply:', error);
      parchmentToast.error('Error', error.message || 'Failed to apply');
    }
  }

  async deletePost(postId) {
    try {
      const response = await this.game.api.deleteLFGPost(postId);
      if (response.success) {
        parchmentToast.info('Deleted', 'Your LFG post has been removed');
        await this.loadData();
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      parchmentToast.error('Error', error.message || 'Failed to delete post');
    }
  }

  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
