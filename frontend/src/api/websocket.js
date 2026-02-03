import { debugLog } from '../utils/debugLogger.js';
import { MessageReliabilityManager } from './messageReliability.js';
import { HeartbeatManager } from './heartbeat.js';
import { connectionQuality } from './connectionQuality.js';

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
    this.reconnecting = false;
    this.connectionId = null;

    // Initialize reliability manager
    this.reliabilityManager = new MessageReliabilityManager((msg) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    });

    // Initialize heartbeat manager
    // Send callback returns true if send succeeded, false otherwise
    this.heartbeatManager = new HeartbeatManager(
      (msg) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(msg));
          return true;
        }
        return false;
      },
      () => this.handleUnhealthyConnection()
    );
  }

  /**
   * Generate a unique connection ID for this connection attempt.
   * Uses crypto.randomUUID() when available, falls back to timestamp + random.
   * @returns {string} A unique connection identifier
   */
  generateConnectionId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older browsers
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  connect(token) {
    this.token = token;

    // Generate a new connectionId for this connection attempt
    this.connectionId = this.generateConnectionId();

    // Pass connectionId to heartbeat manager
    this.heartbeatManager.setConnectionId(this.connectionId);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected with connectionId:', this.connectionId);
        this.reconnectAttempts = 0;
        this.connected = true;
        this.reconnecting = false;

        // Update connection quality state
        connectionQuality.onConnected();

        // Start heartbeat monitoring
        this.heartbeatManager.start();

        // Authenticate with connectionId
        this.send('auth', { token: this.token, connectionId: this.connectionId });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle heartbeat_ack specially (before reliability manager)
          if (message.type === 'heartbeat_ack') {
            const latency = this.heartbeatManager.handleAck(message.timestamp, message.id);
            // Only update latency if ACK was valid (not stale)
            if (latency >= 0) {
              connectionQuality.updateLatency(latency);
            }
            return;
          }

          // Process through reliability manager for ACK handling and deduplication
          const processedMessage = this.reliabilityManager.handleMessage(message);
          if (!processedMessage) {
            return; // Duplicate message, skip
          }

          // Update connection quality on any message
          connectionQuality.onMessageReceived();

          // Continue with normal message routing
          const { type, payload } = processedMessage;
          this.handleMessage(type, payload);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.connected = false;

        // Update connection quality state
        connectionQuality.onDisconnect();

        // Stop heartbeat monitoring
        this.heartbeatManager.stop();

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
    // Prevent multiple concurrent reconnection attempts
    if (this.reconnecting) {
      console.log('Reconnection already in progress, skipping');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.reconnecting = false;
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    // Update connection quality state
    connectionQuality.onReconnecting();

    setTimeout(() => {
      if (this.token) {
        try {
          this.connect(this.token);
        } catch (err) {
          // Ensure reconnecting flag is cleared even if connect() throws synchronously
          console.error('Reconnection connect() failed:', err);
          this.reconnecting = false;
        }
      } else {
        // No token, can't reconnect - clear the flag
        this.reconnecting = false;
      }
    }, delay);
  }

  /**
   * Handle an unhealthy connection detected by the heartbeat manager.
   * Triggers a reconnection attempt.
   */
  handleUnhealthyConnection() {
    console.warn('Connection unhealthy - triggering reconnect');
    connectionQuality.onReconnecting();
    this.reconnect();
  }

  /**
   * Force a reconnection by closing the current connection.
   */
  reconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  handleMessage(type, payload) {
    debugLog('network.logWebSocketMessages', 'WS received:', type, payload);

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
      debugLog('network.logWebSocketMessages', 'WS sending:', type, payload);
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket not connected, message not sent:', type);
    }
  }

  disconnect() {
    // Stop heartbeat monitoring
    this.heartbeatManager.stop();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.reconnecting = false;
    this.token = null;
    this.connectionId = null;
  }

  /**
   * Clean up all resources.
   * Call this when the WebSocket client is being destroyed.
   */
  destroy() {
    this.heartbeatManager.stop();
    this.disconnect();
  }

  /**
   * Get the current connection quality state.
   * @returns {{state: string, latencyMs: number, pendingRetries: number, lastMessageTime: number|null}}
   */
  getConnectionQuality() {
    return connectionQuality.getState();
  }

  /**
   * Get the connection quality manager for external use (e.g., BattleWebSocketManager).
   * @returns {ConnectionQualityManager}
   */
  getConnectionQualityManager() {
    return connectionQuality;
  }

  /**
   * Get the reliability manager for external use (e.g., cleanup on battle end).
   * @returns {MessageReliabilityManager}
   */
  getReliabilityManager() {
    return this.reliabilityManager;
  }

  /**
   * Get the current connection ID.
   * @returns {string|null} The current connection identifier, or null if not connected
   */
  getConnectionId() {
    return this.connectionId;
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
