/**
 * PartyStatusBar - Persistent HUD bar showing current multiplayer party status
 * Displays party name, member avatars, ready status, and leave button
 */

import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { parchmentConfirm } from '../ui/parchment/parchmentConfirm.js';

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
      /* Anchored to the visible game canvas (Game.publishCanvasAnchor) */
      top: calc(var(--game-canvas-top, 0px) + 74px);
      right: calc(var(--game-canvas-right, 0px) + 20px);
      z-index: 8900;
      background: ${getParchmentGradient('135deg')};
      border: ${getParchmentBorder()};
      border-radius: 8px;
      padding: 10px 14px;
      display: none;
      align-items: center;
      gap: 12px;
      font-family: 'Georgia', serif;
      color: ${PARCHMENT_COLORS.text.primary};
      box-shadow: ${getParchmentShadow()};
      max-width: 300px;
      transition: transform 0.2s, opacity 0.2s;
    `;

    // Add keyframes for ready pulse animation
    if (!document.querySelector('#party-status-bar-styles')) {
      const style = document.createElement('style');
      style.id = 'party-status-bar-styles';
      style.textContent = `
        @keyframes readyPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 117, 72, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(74, 117, 72, 0); }
        }
        #party-status-bar.all-ready {
          border-color: ${PARCHMENT_COLORS.state.success};
          animation: readyPulse 2s ease-in-out infinite;
        }
        #party-status-bar .member-avatar {
          transition: all 0.2s;
        }
        #party-status-bar .member-avatar:hover {
          transform: scale(1.1);
        }
        #party-status-bar .member-avatar.ready {
          border-color: ${PARCHMENT_COLORS.state.success} !important;
        }
        #party-status-bar .member-avatar.not-ready {
          border-color: ${PARCHMENT_COLORS.text.muted} !important;
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
        parchmentToast.warning('Party Disbanded', data.reason || 'The party has been disbanded');
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
        parchmentToast.info('Battle Starting', 'Your party is entering battle!');
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
          color: ${PARCHMENT_COLORS.accent.burgundy};
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 120px;
        ">${escapeHtml(this.party.name)}</div>
        <div class="party-meta" style="font-size: 11px; color: ${PARCHMENT_COLORS.text.muted};">
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
          border: 1px solid ${PARCHMENT_COLORS.state.error};
          color: ${PARCHMENT_COLORS.state.error};
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
             title="${escapeHtml(member.username)}${isLeader ? ' (Leader)' : ''}${isReady ? ' - Ready' : ''}"
             style="
               width: 28px;
               height: 28px;
               border-radius: 50%;
               background: linear-gradient(135deg, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.dark});
               border: 2px solid ${isReady ? PARCHMENT_COLORS.state.success : PARCHMENT_COLORS.text.muted};
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
            background: ${PARCHMENT_COLORS.state.success};
            border-radius: 50%;
            border: 1px solid ${PARCHMENT_COLORS.light};
            font-size: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: ${PARCHMENT_COLORS.text.inverse};
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
        background: ${isReady ? PARCHMENT_COLORS.state.success : 'transparent'};
        border: 1px solid ${PARCHMENT_COLORS.state.success};
        color: ${isReady ? PARCHMENT_COLORS.text.inverse : PARCHMENT_COLORS.state.success};
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
        leaveBtn.style.background = 'rgba(139, 68, 68, 0.2)';
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
        if (!readyBtn.style.background.includes(PARCHMENT_COLORS.state.success)) {
          readyBtn.style.background = 'rgba(74, 117, 72, 0.2)';
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
    const confirmed = await parchmentConfirm({ title: 'Leave Party', message: 'Are you sure you want to leave the party?', confirmLabel: 'Leave', confirmVariant: 'danger' });
    if (!confirmed) return;

    try {
      await this.game.api.leaveParty(this.party.id);
      parchmentToast.info('Left Party', 'You have left the party');
      this.party = null;
      this.hide();
    } catch (error) {
      console.error('Failed to leave party:', error);
      parchmentToast.error('Error', error.message || 'Failed to leave party');
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
        parchmentToast.success('All Ready', 'All party members are ready!');
      }
    } catch (error) {
      console.error('Failed to toggle ready status:', error);
      parchmentToast.error('Error', error.message || 'Failed to update ready status');
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
