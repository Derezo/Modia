/**
 * PartyInviteModal - Modal for party invite notifications
 * Shows party details and allows accepting/declining invites
 */

export class PartyInviteModal {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.overlay = null;
    this.abortController = null;
    this.isVisible = false;
    this.onClose = null;

    // Invite data
    this.inviteId = null;
    this.partyId = null;
    this.partyName = null;
    this.leaderUsername = null;
    this.members = [];
    this.expiresAt = null;

    // Countdown timer
    this.countdownInterval = null;
    this.remainingSeconds = 0;
  }

  /**
   * Show the party invite modal
   * @param {Object} options - Invite details
   * @param {number} options.inviteId - Invite ID
   * @param {number} options.partyId - Party ID
   * @param {string} options.partyName - Party name
   * @param {string} options.leaderUsername - Leader's username
   * @param {string} options.expiresAt - Expiration timestamp
   * @param {Function} options.onClose - Callback when modal closes
   */
  async show(options = {}) {
    if (this.isVisible) return;

    this.isVisible = true;
    this.abortController = new AbortController();
    this.onClose = options.onClose;

    // Store invite data
    this.inviteId = options.inviteId;
    this.partyId = options.partyId;
    this.partyName = options.partyName || 'Party';
    this.leaderUsername = options.leaderUsername || 'Unknown';
    this.expiresAt = options.expiresAt ? new Date(options.expiresAt) : null;

    // Fetch full party details
    await this.fetchPartyDetails();

    // Calculate remaining time
    if (this.expiresAt) {
      this.remainingSeconds = Math.max(0, Math.floor((this.expiresAt - Date.now()) / 1000));
    } else {
      this.remainingSeconds = 300; // Default 5 minutes
    }

    this.createModal();
    this.startCountdown();

    // Animate in
    requestAnimationFrame(() => {
      this.overlay.style.opacity = '1';
      this.overlay.style.visibility = 'visible';
      this.element.style.transform = 'scale(1)';
      this.element.style.opacity = '1';
    });
  }

  /**
   * Fetch party details from API
   */
  async fetchPartyDetails() {
    if (!this.partyId) return;

    try {
      const response = await this.game.api.getMultiplayerPartyById(this.partyId);
      if (response.party) {
        this.partyName = response.party.name || this.partyName;
        this.leaderUsername = response.party.leaderUsername || this.leaderUsername;
        this.members = response.party.members || [];
      }
    } catch (error) {
      console.error('Failed to fetch party details:', error);
    }
  }

  /**
   * Create the modal DOM structure
   */
  createModal() {
    // Overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'party-invite-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 9700;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s, visibility 0.2s;
      display: flex;
      justify-content: center;
      align-items: center;
    `;

    // Modal container
    this.element = document.createElement('div');
    this.element.id = 'party-invite-modal';
    this.element.style.cssText = `
      background: linear-gradient(180deg, #1a1a2e 0%, #16162a 100%);
      border: 2px solid #4a4a6a;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      min-width: 350px;
      max-width: 450px;
      transform: scale(0.9);
      opacity: 0;
      transition: transform 0.2s ease-out, opacity 0.2s ease-out;
      font-family: 'Georgia', serif;
      color: #e0e0e0;
      overflow: hidden;
    `;

    this.element.innerHTML = this.renderContent();
    this.overlay.appendChild(this.element);
    document.body.appendChild(this.overlay);

    this.bindEvents();
  }

  /**
   * Render modal content
   */
  renderContent() {
    const memberCount = this.members.length;

    return `
      <style>
        #party-invite-modal .modal-header {
          padding: 16px 20px;
          border-bottom: 1px solid #3a3a5a;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #party-invite-modal .modal-title {
          margin: 0;
          font-size: 18px;
          color: #f59e0b;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        #party-invite-modal .countdown {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid #ef4444;
          color: #ef4444;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-family: monospace;
        }
        #party-invite-modal .modal-body {
          padding: 20px;
        }
        #party-invite-modal .party-info {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          padding: 12px 16px;
          margin-bottom: 16px;
        }
        #party-invite-modal .party-name {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 4px;
        }
        #party-invite-modal .party-leader {
          font-size: 13px;
          color: #a0a0a0;
        }
        #party-invite-modal .party-leader span {
          color: #4ade80;
        }
        #party-invite-modal .members-section {
          margin-bottom: 16px;
        }
        #party-invite-modal .members-header {
          font-size: 13px;
          color: #a0a0a0;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        #party-invite-modal .member-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        #party-invite-modal .member-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 4px;
          border: 1px solid #3a3a5a;
        }
        #party-invite-modal .member-avatar {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #4a4a6a, #3a3a5a);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
        }
        #party-invite-modal .member-info {
          flex: 1;
        }
        #party-invite-modal .member-name {
          font-size: 14px;
          color: #e0e0e0;
        }
        #party-invite-modal .member-details {
          font-size: 12px;
          color: #888;
        }
        #party-invite-modal .member-leader-badge {
          font-size: 10px;
          background: #f59e0b;
          color: #000;
          padding: 2px 6px;
          border-radius: 3px;
          font-weight: bold;
        }
        #party-invite-modal .modal-footer {
          padding: 16px 20px;
          border-top: 1px solid #3a3a5a;
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        #party-invite-modal .btn {
          padding: 10px 24px;
          border-radius: 4px;
          font-family: 'Georgia', serif;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }
        #party-invite-modal .btn-accept {
          background: linear-gradient(180deg, #4ade80, #22c55e);
          color: #000;
          font-weight: bold;
        }
        #party-invite-modal .btn-accept:hover {
          background: linear-gradient(180deg, #5ee891, #34d56b);
          transform: translateY(-1px);
        }
        #party-invite-modal .btn-decline {
          background: transparent;
          border: 1px solid #ef4444;
          color: #ef4444;
        }
        #party-invite-modal .btn-decline:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        #party-invite-modal .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      </style>

      <div class="modal-header">
        <h2 class="modal-title">
          <span>Party Invite</span>
        </h2>
        <div class="countdown" id="countdown-timer">${this.formatTime(this.remainingSeconds)}</div>
      </div>

      <div class="modal-body">
        <div class="party-info">
          <div class="party-name">${this.escapeHtml(this.partyName)}</div>
          <div class="party-leader">Led by <span>${this.escapeHtml(this.leaderUsername)}</span></div>
        </div>

        <div class="members-section">
          <div class="members-header">Members (${memberCount})</div>
          <div class="member-list">
            ${this.renderMembers()}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-decline" id="btn-decline">Decline</button>
        <button class="btn btn-accept" id="btn-accept">Join Party</button>
      </div>
    `;
  }

  /**
   * Render member list
   */
  renderMembers() {
    if (this.members.length === 0) {
      return `
        <div class="member-item">
          <div class="member-avatar">?</div>
          <div class="member-info">
            <div class="member-name">${this.escapeHtml(this.leaderUsername)}</div>
            <div class="member-details">Party Leader</div>
          </div>
        </div>
      `;
    }

    return this.members.map(member => {
      const isLeader = member.user_id === this.members.find(m => m.is_leader)?.user_id ||
                       member.username === this.leaderUsername;
      const classIcon = this.getClassIcon(member.class);

      return `
        <div class="member-item">
          <div class="member-avatar">${classIcon}</div>
          <div class="member-info">
            <div class="member-name">${this.escapeHtml(member.username || member.character_name || 'Unknown')}</div>
            <div class="member-details">
              ${member.class ? `${member.class} ` : ''}
              ${member.level ? `Lv.${member.level}` : ''}
            </div>
          </div>
          ${isLeader ? '<span class="member-leader-badge">LEADER</span>' : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Get icon for character class
   */
  getClassIcon(characterClass) {
    const icons = {
      warrior: '🗡️',
      mage: '🔮',
      rogue: '🗡️',
      cleric: '✨',
      ranger: '🏹',
      paladin: '🛡️',
      necromancer: '💀',
      bard: '🎵'
    };
    return icons[characterClass?.toLowerCase()] || '👤';
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    const signal = this.abortController.signal;

    // Accept button
    this.element.querySelector('#btn-accept').addEventListener('click', () => {
      this.accept();
    }, { signal });

    // Decline button
    this.element.querySelector('#btn-decline').addEventListener('click', () => {
      this.decline();
    }, { signal });

    // Click overlay to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.decline();
      }
    }, { signal });

    // ESC key to decline
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.decline();
      }
    }, { signal });
  }

  /**
   * Start countdown timer
   */
  startCountdown() {
    this.countdownInterval = setInterval(() => {
      this.remainingSeconds--;

      if (this.remainingSeconds <= 0) {
        this.handleExpired();
        return;
      }

      // Update display
      const timerElement = this.element.querySelector('#countdown-timer');
      if (timerElement) {
        timerElement.textContent = this.formatTime(this.remainingSeconds);

        // Warning pulse when low
        if (this.remainingSeconds <= 30) {
          timerElement.style.animation = 'pulse 1s ease-in-out infinite';
          if (!document.querySelector('#party-invite-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'party-invite-pulse-style';
            style.textContent = `
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
              }
            `;
            document.head.appendChild(style);
          }
        }
      }
    }, 1000);
  }

  /**
   * Handle invite expiration
   */
  handleExpired() {
    this.stopCountdown();
    this.game.toastManager?.warning('Invite Expired', 'The party invite has expired');
    this.close(false);
  }

  /**
   * Stop countdown timer
   */
  stopCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  /**
   * Format seconds as MM:SS
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Accept the party invite
   */
  async accept() {
    const acceptBtn = this.element.querySelector('#btn-accept');
    const declineBtn = this.element.querySelector('#btn-decline');

    try {
      // Disable buttons
      acceptBtn.disabled = true;
      declineBtn.disabled = true;
      acceptBtn.textContent = 'Joining...';

      await this.game.api.acceptPartyInvite(this.inviteId);

      this.game.toastManager?.success('Joined Party', `You have joined ${this.partyName}`);

      // Update party status bar if it exists
      if (this.game.partyStatusBar) {
        this.game.partyStatusBar.refresh();
      }

      this.close(true);
    } catch (error) {
      console.error('Failed to accept invite:', error);
      this.game.toastManager?.error('Failed to Join', error.message || 'Could not join the party');

      // Re-enable buttons
      acceptBtn.disabled = false;
      declineBtn.disabled = false;
      acceptBtn.textContent = 'Join Party';
    }
  }

  /**
   * Decline the party invite
   */
  async decline() {
    try {
      await this.game.api.declinePartyInvite(this.inviteId);
    } catch (error) {
      console.error('Failed to decline invite:', error);
    }

    this.close(false);
  }

  /**
   * Close the modal
   * @param {boolean} accepted - Whether the invite was accepted
   */
  close(accepted = false) {
    if (!this.isVisible) return;

    this.stopCountdown();

    // Animate out
    this.overlay.style.opacity = '0';
    this.overlay.style.visibility = 'hidden';
    this.element.style.transform = 'scale(0.9)';
    this.element.style.opacity = '0';

    setTimeout(() => {
      this.destroy();

      if (this.onClose) {
        this.onClose(accepted);
      }
    }, 200);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.isVisible = false;
    this.stopCountdown();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }

    this.element = null;
  }
}

export default PartyInviteModal;
