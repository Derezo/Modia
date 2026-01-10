/**
 * PartyStatusBar - Persistent HUD bar showing current multiplayer party status
 * Displays party name, member avatars, ready status, and leave button
 */

export class PartyStatusBar {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.isVisible = false;
    this.party = null;
    this.isRefreshing = false;

    this.create();
    this.setupWebSocketHandlers();
  }

  /**
   * Create the status bar DOM element
   */
  create() {
    this.element = document.createElement('div');
    this.element.id = 'party-status-bar';
    this.element.style.cssText = `
      position: fixed;
      top: 74px;
      right: 20px;
      z-index: 8900;
      background: linear-gradient(135deg, rgba(20, 20, 30, 0.95), rgba(30, 30, 45, 0.95));
      border: 2px solid #4a4a6a;
      border-radius: 8px;
      padding: 10px 14px;
      display: none;
      align-items: center;
      gap: 12px;
      font-family: 'Georgia', serif;
      color: #e0e0e0;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      max-width: 300px;
      transition: transform 0.2s, opacity 0.2s;
    `;

    // Add keyframes for ready pulse animation
    if (!document.querySelector('#party-status-bar-styles')) {
      const style = document.createElement('style');
      style.id = 'party-status-bar-styles';
      style.textContent = `
        @keyframes readyPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(74, 222, 128, 0); }
        }
        #party-status-bar.all-ready {
          border-color: #4ade80;
          animation: readyPulse 2s ease-in-out infinite;
        }
        #party-status-bar .member-avatar {
          transition: all 0.2s;
        }
        #party-status-bar .member-avatar:hover {
          transform: scale(1.1);
        }
        #party-status-bar .member-avatar.ready {
          border-color: #4ade80 !important;
        }
        #party-status-bar .member-avatar.not-ready {
          border-color: #6b7280 !important;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(this.element);
  }

  /**
   * Setup WebSocket event handlers for real-time updates
   */
  setupWebSocketHandlers() {
    if (!this.game.socket) return;

    // Member joined
    this.game.socket.on('party:member_joined', (data) => {
      if (this.party && this.party.id === data.partyId) {
        this.refresh();
      }
    });

    // Member left
    this.game.socket.on('party:member_left', (data) => {
      if (this.party && this.party.id === data.partyId) {
        // Check if we were the one who left
        const currentUserId = this.game.state.get('user')?.id;
        if (data.userId === currentUserId) {
          this.hide();
          this.party = null;
        } else {
          this.refresh();
        }
      }
    });

    // Member ready status changed
    this.game.socket.on('party:member_ready', (data) => {
      if (this.party && this.party.id === data.partyId) {
        this.updateMemberReady(data.userId, data.isReady);
      }
    });

    // All members ready
    this.game.socket.on('party:all_ready', (data) => {
      if (this.party && this.party.id === data.partyId) {
        this.element.classList.add('all-ready');
      }
    });

    // Party disbanded
    this.game.socket.on('party:disbanded', (data) => {
      if (this.party && this.party.id === data.partyId) {
        this.game.toastManager?.warning('Party Disbanded', data.reason || 'The party has been disbanded');
        this.hide();
        this.party = null;
      }
    });

    // Leader changed
    this.game.socket.on('party:leader_changed', (data) => {
      if (this.party && this.party.id === data.partyId) {
        this.party.leaderId = data.newLeaderId;
        this.party.leaderUsername = data.newLeaderUsername;
        this.refresh();
      }
    });

    // Battle starting
    this.game.socket.on('party:battle_starting', (data) => {
      if (this.party && this.party.id === data.partyId) {
        this.game.toastManager?.info('Battle Starting', 'Your party is entering battle!');
      }
    });
  }

  /**
   * Refresh party data from API
   */
  async refresh() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const response = await this.game.api.getMultiplayerParty();

      if (response.party) {
        this.party = response.party;
        this.render();
        this.show();
      } else {
        this.party = null;
        this.hide();
      }
    } catch (error) {
      console.error('Failed to refresh party status:', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Render the status bar content
   */
  render() {
    if (!this.party) {
      this.element.innerHTML = '';
      return;
    }

    const members = this.party.members || [];
    const currentUserId = this.game.state.get('user')?.id;
    const isLeader = this.party.leaderId === currentUserId;
    const allReady = members.length > 1 && members.every(m => m.is_ready);

    // Update all-ready class
    if (allReady) {
      this.element.classList.add('all-ready');
    } else {
      this.element.classList.remove('all-ready');
    }

    this.element.innerHTML = `
      <div class="party-info" style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <div class="party-name" style="
          font-size: 13px;
          font-weight: bold;
          color: #f59e0b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 120px;
        ">${this.escapeHtml(this.party.name)}</div>
        <div class="party-meta" style="font-size: 11px; color: #888;">
          ${members.length}/${this.party.maxMembers || 4} members
        </div>
      </div>

      <div class="member-avatars" style="display: flex; gap: -4px;">
        ${this.renderMemberAvatars(members)}
      </div>

      <div class="party-actions" style="display: flex; gap: 6px; margin-left: auto;">
        ${isLeader ? '' : this.renderReadyButton()}
        <button id="leave-party-btn" title="Leave Party" style="
          background: transparent;
          border: 1px solid #ef4444;
          color: #ef4444;
          width: 28px;
          height: 28px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: all 0.2s;
        ">X</button>
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Render member avatar circles
   */
  renderMemberAvatars(members) {
    return members.map((member, index) => {
      const isReady = member.is_ready;
      const isLeader = member.user_id === this.party.leaderId;
      const classIcon = this.getClassIcon(member.class);

      return `
        <div class="member-avatar ${isReady ? 'ready' : 'not-ready'}"
             data-user-id="${member.user_id}"
             title="${this.escapeHtml(member.username)}${isLeader ? ' (Leader)' : ''}${isReady ? ' - Ready' : ''}"
             style="
               width: 28px;
               height: 28px;
               border-radius: 50%;
               background: linear-gradient(135deg, #3a3a5a, #2a2a4a);
               border: 2px solid ${isReady ? '#4ade80' : '#6b7280'};
               display: flex;
               align-items: center;
               justify-content: center;
               font-size: 12px;
               margin-left: ${index > 0 ? '-6px' : '0'};
               position: relative;
               z-index: ${10 - index};
               cursor: pointer;
             ">
          ${classIcon}
          ${isReady ? `<span style="
            position: absolute;
            bottom: -2px;
            right: -2px;
            width: 10px;
            height: 10px;
            background: #4ade80;
            border-radius: 50%;
            border: 1px solid #16162a;
            font-size: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #000;
          ">&#10003;</span>` : ''}
          ${isLeader ? `<span style="
            position: absolute;
            top: -4px;
            right: -4px;
            font-size: 10px;
          ">&#9733;</span>` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Render ready toggle button
   */
  renderReadyButton() {
    const currentUserId = this.game.state.get('user')?.id;
    const currentMember = this.party.members?.find(m => m.user_id === currentUserId);
    const isReady = currentMember?.is_ready || this.party.isReady;

    return `
      <button id="toggle-ready-btn" title="${isReady ? 'Not Ready' : 'Ready Up'}" style="
        background: ${isReady ? '#4ade80' : 'transparent'};
        border: 1px solid #4ade80;
        color: ${isReady ? '#000' : '#4ade80'};
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-family: inherit;
        font-weight: bold;
        transition: all 0.2s;
      ">${isReady ? 'READY' : 'Ready?'}</button>
    `;
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    // Leave party button
    const leaveBtn = this.element.querySelector('#leave-party-btn');
    if (leaveBtn) {
      leaveBtn.addEventListener('click', () => this.handleLeave());
      leaveBtn.addEventListener('mouseenter', () => {
        leaveBtn.style.background = 'rgba(239, 68, 68, 0.2)';
      });
      leaveBtn.addEventListener('mouseleave', () => {
        leaveBtn.style.background = 'transparent';
      });
    }

    // Ready toggle button
    const readyBtn = this.element.querySelector('#toggle-ready-btn');
    if (readyBtn) {
      readyBtn.addEventListener('click', () => this.handleToggleReady());
      readyBtn.addEventListener('mouseenter', () => {
        if (!readyBtn.style.background.includes('#4ade80')) {
          readyBtn.style.background = 'rgba(74, 222, 128, 0.2)';
        }
      });
      readyBtn.addEventListener('mouseleave', () => {
        const currentUserId = this.game.state.get('user')?.id;
        const currentMember = this.party?.members?.find(m => m.user_id === currentUserId);
        const isReady = currentMember?.is_ready || this.party?.isReady;
        if (!isReady) {
          readyBtn.style.background = 'transparent';
        }
      });
    }
  }

  /**
   * Handle leave party button click
   */
  async handleLeave() {
    if (!this.party) return;

    // Confirm leave
    const confirmed = confirm('Are you sure you want to leave the party?');
    if (!confirmed) return;

    try {
      await this.game.api.leaveParty(this.party.id);
      this.game.toastManager?.info('Left Party', 'You have left the party');
      this.party = null;
      this.hide();
    } catch (error) {
      console.error('Failed to leave party:', error);
      this.game.toastManager?.error('Error', error.message || 'Failed to leave party');
    }
  }

  /**
   * Handle ready toggle button click
   */
  async handleToggleReady() {
    if (!this.party) return;

    const currentUserId = this.game.state.get('user')?.id;
    const currentMember = this.party.members?.find(m => m.user_id === currentUserId);
    const currentReady = currentMember?.is_ready || this.party.isReady || false;
    const newReady = !currentReady;

    try {
      const response = await this.game.api.setReady(this.party.id, newReady);

      // Update local state
      if (currentMember) {
        currentMember.is_ready = response.isReady;
      }
      this.party.isReady = response.isReady;

      // Re-render to update UI
      this.render();

      if (response.allReady) {
        this.game.toastManager?.success('All Ready', 'All party members are ready!');
      }
    } catch (error) {
      console.error('Failed to toggle ready status:', error);
      this.game.toastManager?.error('Error', error.message || 'Failed to update ready status');
    }
  }

  /**
   * Update a specific member's ready status
   */
  updateMemberReady(userId, isReady) {
    if (!this.party || !this.party.members) return;

    const member = this.party.members.find(m => m.user_id === userId);
    if (member) {
      member.is_ready = isReady;
      this.render();
    }
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
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * Show the status bar
   */
  show() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.element.style.display = 'flex';
    this.element.style.transform = 'translateX(0)';
    this.element.style.opacity = '1';
  }

  /**
   * Hide the status bar
   */
  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.element.style.transform = 'translateX(20px)';
    this.element.style.opacity = '0';

    setTimeout(() => {
      if (!this.isVisible) {
        this.element.style.display = 'none';
      }
    }, 200);
  }

  /**
   * Check if user is in a party and show bar if so
   */
  async checkPartyStatus() {
    await this.refresh();
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.hide();
    this.element?.remove();
    this.element = null;
    this.party = null;
  }
}

export default PartyStatusBar;
