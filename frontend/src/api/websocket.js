export class GameWebSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.token = null;
    this.connected = false;
  }

  connect(token) {
    this.token = token;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.connected = true;

        // Authenticate
        this.send('auth', { token: this.token });
      };

      this.ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data);
          this.handleMessage(type, payload);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.connected = false;
        this.attemptReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      this.attemptReconnect();
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.token) {
        this.connect(this.token);
      }
    }, delay);
  }

  handleMessage(type, payload) {
    // Notify registered handlers
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      typeHandlers.forEach(handler => handler(payload));
    }

    // Notify wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach(handler => handler(type, payload));
    }
  }

  on(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type).add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type).delete(handler);
    };
  }

  off(type, handler) {
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      typeHandlers.delete(handler);
    }
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket not connected, message not sent:', type);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.token = null;
  }

  // Convenience methods
  joinRoom(room) {
    this.send('join_room', { room });
  }

  leaveRoom(room) {
    this.send('leave_room', { room });
  }

  sendChatMessage(room, message, characterId = null) {
    this.send('chat_message', { room, message, characterId });
  }

  joinColiseumQueue(partyCharacterIds) {
    this.send('coliseum_queue_join', { partyCharacterIds });
  }

  leaveColiseumQueue() {
    this.send('coliseum_queue_leave');
  }

  // Chat methods
  sendPrivateMessage(targetUserId, message, characterId = null) {
    this.send('private_message', { targetUserId, message, characterId });
  }

  updatePresence(status, customMessage = null) {
    this.send('presence_update', { status, customMessage });
  }

  sendTypingIndicator(room, isTyping = true) {
    this.send('typing_indicator', { room, isTyping });
  }

  addReaction(messageId, emoji, room = null) {
    this.send('add_reaction', { messageId, emoji, room });
  }

  removeReaction(messageId, emoji, room = null) {
    this.send('remove_reaction', { messageId, emoji, room });
  }

  // Battle methods
  joinBattleRoom(battleId) {
    this.send('join_battle', { battleId });
  }

  leaveBattleRoom(battleId) {
    this.send('leave_battle', { battleId });
  }

  // Party methods
  sendPartyInvite(targetUserId, characterId) {
    this.send('party_invite', { targetUserId, characterId });
  }

  acceptPartyInvite(inviteId) {
    this.send('party_invite_accept', { inviteId });
  }

  declinePartyInvite(inviteId) {
    this.send('party_invite_decline', { inviteId });
  }

  leaveParty() {
    this.send('party_leave', {});
  }

  kickPartyMember(userId) {
    this.send('party_kick', { userId });
  }

  // Node presence methods
  joinNodeRoom(nodeId) {
    this.send('join_node', { nodeId });
  }

  leaveNodeRoom(nodeId) {
    this.send('leave_node', { nodeId });
  }

  // Coliseum queue methods (enhanced)
  joinColiseumQueueWithDetails(queueType, partyLevel, partySize) {
    this.send('coliseum_queue_join', { queueType, partyLevel, partySize });
  }

  leaveColiseumQueueByType(queueType) {
    this.send('coliseum_queue_leave', { queueType });
  }

  coliseumReady(matchId) {
    this.send('coliseum_ready', { matchId });
  }

  // Marketplace methods

  /**
   * Join the marketplace room for general updates
   */
  joinMarketplace() {
    this.send('join_room', { room: 'marketplace' });
  }

  /**
   * Leave the marketplace room
   */
  leaveMarketplace() {
    this.send('leave_room', { room: 'marketplace' });
  }

  /**
   * Subscribe to a specific item's order book updates
   */
  subscribeToItem(itemTemplateId) {
    this.send('marketplace_subscribe', { itemTemplateId });
  }

  /**
   * Unsubscribe from item order book updates
   */
  unsubscribeFromItem(itemTemplateId) {
    this.send('marketplace_unsubscribe', { itemTemplateId });
  }
}
