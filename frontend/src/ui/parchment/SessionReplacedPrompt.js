/**
 * SessionReplacedPrompt - "Signed in elsewhere" state for the realtime socket.
 *
 * The server replaces a user's older WebSocket session when the same account
 * connects from another tab or device. GameWebSocket emits 'session_replaced'
 * and stops auto-reconnecting; without a user decision, two tabs would keep
 * kicking each other off. This prompt waits for the player to choose:
 *   - "Reconnect here": take the session back (the other tab gets the prompt)
 *   - "Stay disconnected": dismiss and leave this tab offline
 *
 * The modal factory is injected so the state logic is unit-testable without a DOM.
 */

import { ParchmentModal } from './ParchmentModal.js';

export const SESSION_REPLACED_EVENT = 'session_replaced';

function defaultCreateModal(options) {
  const content = document.createElement('p');
  content.textContent = options.message;
  return new ParchmentModal({
    title: options.title,
    content,
    size: 'sm',
    closable: false,
    closeOnOverlay: false,
    closeOnEscape: false,
    actions: options.actions
  });
}

export class SessionReplacedPrompt {
  /**
   * @param {Object} deps
   * @param {Object} deps.socket - GameWebSocket (needs on/connect, optionally reconnectNow)
   * @param {Function} deps.getToken - returns the current access token, or null
   * @param {Function} [deps.createModal] - (options) => modal with open()/close()
   */
  constructor({ socket, getToken, createModal = defaultCreateModal }) {
    this.socket = socket;
    this.getToken = getToken;
    this.createModal = createModal;
    this.modal = null;
    this.active = false;
    this._unsubscribe = socket?.on?.(SESSION_REPLACED_EVENT, () => this.show()) ?? null;
  }

  /** Show the prompt once; repeated events while it is open are ignored. */
  show() {
    if (this.active) return;
    this.active = true;
    this.modal = this.createModal({
      title: 'Signed in elsewhere',
      message: 'Your account was opened in another tab or on another device, so this window has been disconnected.',
      actions: [
        { label: 'Stay disconnected', variant: 'secondary', onClick: () => this.dismiss() },
        { label: 'Reconnect here', variant: 'primary', onClick: () => this.reconnectHere() }
      ]
    });
    this.modal.open();
  }

  dismiss() {
    this.modal?.close();
    this.modal = null;
    this.active = false;
  }

  /** User-initiated reconnect: the only path that resumes this tab's session. */
  reconnectHere() {
    const token = this.getToken();
    this.dismiss();
    if (!token || !this.socket) return;
    if (typeof this.socket.reconnectNow === 'function') {
      this.socket.reconnectNow(token);
      return;
    }
    // Older socket client without an explicit manual-reconnect path.
    this.socket.sessionReplaced = false;
    this.socket.reconnectAttempts = 0;
    this.socket.connect(token);
  }

  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.dismiss();
  }
}
