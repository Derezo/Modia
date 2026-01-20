import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS
} from '../../ui/parchment/index.js';

const P = PARCHMENT_COLORS;

/**
 * FriendCard - Compact Discord-like friend list item
 *
 * Displays friend with:
 * - Avatar/class icon with status indicator
 * - Username and level/class info
 * - Real-time activity status
 * - Quick action buttons (invite, message, etc.)
 */
export class FriendCard {
  /**
   * @param {Object} options
   * @param {Object} options.friend - Friend data object
   * @param {Function} options.onInvite - Party invite callback
   * @param {Function} options.onMessage - Start DM callback
   * @param {Function} options.onRemove - Unfriend callback
   * @param {Function} options.onBlock - Block callback
   * @param {Function} options.onFavoriteToggle - Toggle favorite callback
   * @param {boolean} options.showActions - Show action buttons (default true)
   */
  constructor(options) {
    this.friend = options.friend;
    this.onInvite = options.onInvite;
    this.onMessage = options.onMessage;
    this.onRemove = options.onRemove;
    this.onBlock = options.onBlock;
    this.onFavoriteToggle = options.onFavoriteToggle;
    this.showActions = options.showActions !== false;

    this.element = null;
    this.abortController = null;
  }

  /**
   * Add component styles to document (once)
   */
  static addStyles() {
    if (document.getElementById('friend-card-styles')) return;

    const style = document.createElement('style');
    style.id = 'friend-card-styles';
    style.textContent = `
      .friend-card {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: transparent;
        border-radius: ${PARCHMENT_RADIUS.md};
        transition: background 0.15s ease;
        cursor: pointer;
      }

      .friend-card:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .friend-card.offline {
        opacity: 0.6;
      }

      .friend-card.offline:hover {
        opacity: 0.8;
      }

      /* Avatar section */
      .friend-card-avatar {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: ${P.mid};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
        overflow: hidden;
      }

      .friend-card-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .friend-card-status {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid ${P.light};
        background: ${P.text.muted};
      }

      .friend-card-status.online { background: ${P.state.success}; }
      .friend-card-status.away { background: ${P.state.warning}; }
      .friend-card-status.busy { background: ${P.state.error}; }
      .friend-card-status.offline { background: ${P.text.muted}; }

      /* Info section */
      .friend-card-info {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .friend-card-name-row {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.xs};
      }

      .friend-card-name {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.md};
        font-weight: 600;
        color: ${P.text.primary};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .friend-card-favorite {
        color: ${P.accent.burgundy};
        font-size: 12px;
      }

      .friend-card-meta {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.muted};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .friend-card-activity {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.secondary};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .friend-card-activity.in-battle {
        color: ${P.state.error};
      }

      .friend-card-activity.in-party {
        color: ${P.state.success};
      }

      /* Actions section */
      .friend-card-actions {
        display: flex;
        gap: ${PARCHMENT_SPACING.xs};
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      .friend-card:hover .friend-card-actions {
        opacity: 1;
      }

      .friend-card-action {
        width: 32px;
        height: 32px;
        padding: 0;
        background: ${P.mid};
        border: 1px solid ${P.borderLight};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.text.secondary};
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }

      .friend-card-action:hover {
        background: ${P.dark};
        border-color: ${P.border};
        color: ${P.text.inverse};
      }

      .friend-card-action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .friend-card-action.invite:hover {
        background: ${P.state.success};
        border-color: ${P.state.success};
      }

      .friend-card-action.message:hover {
        background: #4a9eff;
        border-color: #4a9eff;
      }

      /* Context menu */
      .friend-card-menu {
        position: absolute;
        background: ${P.light};
        border: ${PARCHMENT_RADIUS.md};
        border-radius: ${PARCHMENT_RADIUS.md};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        min-width: 150px;
        z-index: 1000;
        overflow: hidden;
      }

      .friend-card-menu-item {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${P.text.primary};
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .friend-card-menu-item:hover {
        background: ${P.mid};
      }

      .friend-card-menu-item.danger {
        color: ${P.state.error};
      }

      .friend-card-menu-divider {
        height: 1px;
        background: ${P.borderLight};
        margin: ${PARCHMENT_SPACING.xs} 0;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Get status color based on friend status
   */
  getStatusClass() {
    switch (this.friend.status) {
      case 'online': return 'online';
      case 'away': return 'away';
      case 'busy': return 'busy';
      default: return 'offline';
    }
  }

  /**
   * Get activity display text
   */
  getActivityText() {
    const { activity, status } = this.friend;

    if (status !== 'online') {
      // Show last online time for offline friends
      if (this.friend.lastOnline) {
        return `Last seen ${this.formatRelativeTime(this.friend.lastOnline)}`;
      }
      return 'Offline';
    }

    if (!activity) return 'Online';

    // Use displayText if available, otherwise format from activity data
    if (activity.displayText) return activity.displayText;

    switch (activity.type) {
      case 'battle':
        return activity.context ? `In Battle - ${activity.context}` : 'In Battle';
      case 'worldMap':
        return activity.context ? `At ${activity.context}` : 'Exploring';
      case 'shop':
        return activity.context ? `Shopping at ${activity.context}` : 'Shopping';
      case 'tavern':
        return 'In Tavern';
      case 'coliseum':
        return 'In Coliseum';
      case 'socialHub':
        return 'In Social Hub';
      case 'idle':
      default:
        return 'Online';
    }
  }

  /**
   * Get activity CSS class for styling
   */
  getActivityClass() {
    const { activity, status } = this.friend;
    if (status !== 'online' || !activity) return '';

    if (activity.type === 'battle') return 'in-battle';
    if (activity.inParty) return 'in-party';
    return '';
  }

  /**
   * Format relative time (e.g., "2h ago")
   */
  formatRelativeTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  /**
   * Get class icon emoji for avatar fallback
   */
  getClassIcon() {
    const classIcons = {
      warrior: '&#x2694;&#xFE0F;', // Crossed swords
      wizard: '&#x1F9D9;',         // Mage
      monk: '&#x1F94B;',           // Martial arts
      chemist: '&#x2697;&#xFE0F;'  // Alembic
    };
    return classIcons[this.friend.characterClass] || '&#x1F464;'; // Person silhouette fallback
  }

  /**
   * Render the friend card and return the DOM element
   */
  render() {
    FriendCard.addStyles();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const isOffline = this.friend.status !== 'online';
    const activityText = this.getActivityText();
    const activityClass = this.getActivityClass();
    const canInvite = !isOffline && this.friend.activity?.type !== 'battle';

    this.element = document.createElement('div');
    this.element.className = `friend-card ${isOffline ? 'offline' : ''}`;
    this.element.dataset.friendId = this.friend.id;

    this.element.innerHTML = `
      <div class="friend-card-avatar">
        ${this.friend.avatarUrl
    ? `<img src="${this.escapeHtml(this.friend.avatarUrl)}" alt="">`
    : `<span>${this.getClassIcon()}</span>`
}
        <div class="friend-card-status ${this.getStatusClass()}"></div>
      </div>
      <div class="friend-card-info">
        <div class="friend-card-name-row">
          <span class="friend-card-name">${this.escapeHtml(this.friend.username)}</span>
          ${this.friend.isFavorite ? '<span class="friend-card-favorite">&#x2B50;</span>' : ''}
        </div>
        ${this.friend.characterLevel ? `
          <div class="friend-card-meta">Lv.${this.friend.characterLevel} ${this.friend.characterClass || ''}</div>
        ` : ''}
        <div class="friend-card-activity ${activityClass}">${this.escapeHtml(activityText)}</div>
      </div>
      ${this.showActions ? `
        <div class="friend-card-actions">
          <button class="friend-card-action invite" data-action="invite" title="Invite to Party" ${!canInvite ? 'disabled' : ''}>
            &#x2694;&#xFE0F;
          </button>
          <button class="friend-card-action message" data-action="message" title="Send Message">
            &#x1F4AC;
          </button>
        </div>
      ` : ''}
    `;

    // Event listeners
    if (this.showActions) {
      this.element.querySelector('[data-action="invite"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (canInvite && this.onInvite) {
          this.onInvite(this.friend);
        }
      }, { signal });

      this.element.querySelector('[data-action="message"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onMessage) {
          this.onMessage(this.friend);
        }
      }, { signal });
    }

    return this.element;
  }

  /**
   * Update friend data and re-render
   */
  update(newFriendData) {
    this.friend = { ...this.friend, ...newFriendData };

    if (this.element) {
      // Update status indicator
      const statusEl = this.element.querySelector('.friend-card-status');
      if (statusEl) {
        statusEl.className = `friend-card-status ${this.getStatusClass()}`;
      }

      // Update activity text
      const activityEl = this.element.querySelector('.friend-card-activity');
      if (activityEl) {
        activityEl.textContent = this.getActivityText();
        activityEl.className = `friend-card-activity ${this.getActivityClass()}`;
      }

      // Update offline state
      const isOffline = this.friend.status !== 'online';
      this.element.classList.toggle('offline', isOffline);

      // Update invite button state
      const inviteBtn = this.element.querySelector('[data-action="invite"]');
      if (inviteBtn) {
        const canInvite = !isOffline && this.friend.activity?.type !== 'battle';
        inviteBtn.disabled = !canInvite;
      }
    }
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
