import { debugLog } from '../utils/debugLogger.js';
import { MessageReliabilityManager } from './messageReliability.js';
import { HeartbeatManager } from './heartbeat.js';
import { connectionQuality } from './connectionQuality.js';
import { getBattleMapCapabilities } from '../battle/BattleMapSession.js';

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

    // Track joined rooms for replay after reconnect
    this.rooms = new Set();

    // Track node room separately (only one at a time, keyed by nodeId)
    this.nodeRoom = null;

    // Track marketplace item subscriptions for replay
    this.itemSubscriptions = new Set();

    // Session replacement flag - prevents reconnect loops
    this.sessionReplaced = false;

    // Track if we've successfully authenticated before (for reconnect detection)
    this.hasAuthenticatedOnce = false;

    // Initialize reliability manager
    this.reliabilityManager = new MessageReliabilityManager((msg) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    }, { getBattleMapCapabilities });

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

    // Track whether this socket is a reconnection (for dispatching 'connect' only
    // on the first auth_success of a new socket after we've authenticated before)
    const isReconnectSocket = this.hasAuthenticatedOnce;

    try {
      this.ws = new WebSocket(this.url);

      // Store the reconnect flag on the socket for access in onmessage.
      // _socketAuthed tracks whether this specific socket has received its
      // first auth_success (to distinguish from token refresh re-auth).
      this.ws._isReconnectSocket = isReconnectSocket;
      this.ws._socketAuthed = false;

      this.ws.onopen = () => {
        console.log('WebSocket connected with connectionId:', this.connectionId);
        // Note: reconnectAttempts is reset only on auth_success, not here.
        // This prevents infinite reconnect loops if the server accepts the socket but then drops it.
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

          // Handle rate_limited response
          if (message.type === 'rate_limited') {
            this.handleRateLimited(message.payload);
            return;
          }

          // Handle session_replaced - mark session as replaced to prevent reconnect loop
          if (message.type === 'session_replaced') {
            console.warn('Session replaced by another connection');
            this.sessionReplaced = true;
            this.handleMessage('session_replaced', message.payload);
            return;
          }

          // Handle STALE_CONNECTION error - also marks session as replaced
          if (message.type === 'error' && message.payload?.code === 'STALE_CONNECTION') {
            console.warn('Connection superseded by newer session');
            this.sessionReplaced = true;
            this.handleMessage('session_replaced', message.payload);
            return;
          }

          // Handle auth_success - reset reconnect attempts and dispatch connect on reconnect
          if (message.type === 'auth_success') {
            this.reconnectAttempts = 0;

            // A reconnect is the first auth_success on a newly opened socket after we
            // have authenticated at least once before. Subsequent auth_success messages
            // on the same socket (e.g., hourly token refresh) are NOT reconnects.
            const isReconnect = this.ws._isReconnectSocket && !this.ws._socketAuthed;
            this.ws._socketAuthed = true;
            this.hasAuthenticatedOnce = true;

            // Route auth_success to handlers first
            this.handleMessage('auth_success', message.payload);

            // On reconnect, dispatch 'connect' event and replay rooms
            if (isReconnect) {
              console.log('Reconnected - dispatching connect event and replaying rooms');
              this.handleMessage('connect', message.payload);

              // Replay non-battle rooms after a short delay to let battle rejoin go first
              setTimeout(() => {
                this.replayRooms();
              }, 100);
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

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        this.connected = false;

        // Update connection quality state
        connectionQuality.onDisconnect();

        // Stop heartbeat monitoring
        this.heartbeatManager.stop();

        // Dispatch disconnect event so BattleWebSocketManager and others can react
        this.handleMessage('disconnect', { code: event.code, reason: event.reason });

        // Don't reconnect if session was replaced (prevents infinite loop with multiple tabs)
        if (this.sessionReplaced) {
          console.log('Session was replaced - not reconnecting');
          return;
        }

        // Also check close reason for session replacement (fallback)
        if (event.reason === 'Session replaced by new connection' ||
            event.reason === 'Connection superseded') {
          console.log('Session replaced by close reason - not reconnecting');
          this.sessionReplaced = true;
          return;
        }

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
   * Handle a rate_limited response from the server.
   * Notifies heartbeat manager, updates connection quality, and passes to handlers.
   * @param {Object} payload - Rate limit response payload
   * @param {string} payload.message - Human-readable message
   * @param {string} payload.category - Rate limit category that was hit
   * @param {number} payload.retryAfter - Milliseconds until rate limit resets
   * @param {string} [payload.blockedMessageType] - The message type that was blocked
   */
  handleRateLimited(payload) {
    console.warn(
      `Rate limited: ${payload.category}, blocked: ${payload.blockedMessageType || 'unknown'}, retry after ${payload.retryAfter}ms`
    );

    // If heartbeat was rate limited, notify heartbeat manager
    // This prevents false "missed heartbeat" detection
    if (payload.blockedMessageType === 'heartbeat') {
      this.heartbeatManager.onRateLimited(payload.retryAfter);
    }

    // Update connection quality state
    connectionQuality.onRateLimited(payload.retryAfter);

    // Notify any registered handlers so UI can respond
    this.handleMessage('rate_limited', payload);
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
    // Guard: type must be a string
    if (typeof type !== 'string') {
      console.warn('WebSocket send called with non-string type:', type);
      return;
    }

    const outgoingPayload = type === 'coliseum_queue_join'
      && !Object.hasOwn(payload ?? {}, 'battleMapCapabilities')
      ? {
        ...(payload ?? {}),
        battleMapCapabilities: getBattleMapCapabilities()
      }
      : payload;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      debugLog('network.logWebSocketMessages', 'WS sending:', type, outgoingPayload);
      this.ws.send(JSON.stringify({ type, payload: outgoingPayload }));
    } else {
      console.warn('WebSocket not connected, message not sent:', type);
    }
  }

  sendRaw(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      debugLog('network.logWebSocketMessages', 'WS sending:', message.type, message);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, message not sent:', message?.type);
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
    this.rooms.clear();
    this.nodeRoom = null;
    this.itemSubscriptions.clear();
    this.sessionReplaced = false;
    this.hasAuthenticatedOnce = false;
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
    this.rooms.add(room);
    this.send('join_room', { room });
  }

  leaveRoom(room) {
    this.rooms.delete(room);
    this.send('leave_room', { room });
  }

  /**
   * Replay tracked rooms after reconnection.
   * Battle rooms are handled separately by BattleWebSocketManager.
   */
  replayRooms() {
    for (const room of this.rooms) {
      // Skip battle rooms - BattleWebSocketManager handles those
      if (room.startsWith('battle:')) continue;
      console.log('Replaying room join:', room);
      this.send('join_room', { room });
    }

    // Replay node room if we were in one
    if (this.nodeRoom !== null) {
      console.log('Replaying node room join:', this.nodeRoom);
      this.send('join_node', { nodeId: this.nodeRoom });
    }

    // Replay marketplace item subscriptions
    for (const itemTemplateId of this.itemSubscriptions) {
      console.log('Replaying marketplace item subscription:', itemTemplateId);
      this.send('marketplace_subscribe', { itemTemplateId });
    }
  }

  sendChatMessage(room, message, characterId = null) {
    this.send('chat_message', { room, message, characterId });
  }

  joinColiseumQueue(
    partyCharacterIds,
    battleMapCapabilities = getBattleMapCapabilities()
  ) {
    this.send('coliseum_queue_join', {
      partyCharacterIds,
      battleMapCapabilities
    });
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
  joinBattleRoom(battleId, battleMapCapabilities = getBattleMapCapabilities()) {
    this.send('join_battle', { battleId, battleMapCapabilities });
  }

  leaveBattleRoom(battleId) {
    this.send('leave_battle', { battleId });
  }

  requestBattleSync(
    battleId,
    battleMapCapabilities = getBattleMapCapabilities(),
    reason = 'client_requested'
  ) {
    this.sendRaw({
      type: 'battle:request_sync',
      battleId,
      battleMapCapabilities,
      reason
    });
  }

  // Party methods
  // Note: Party invites now use REST API (POST /api/party/multiplayer/:partyId/invite)
  // sendPartyInvite, acceptPartyInvite, declinePartyInvite have been removed

  leaveParty() {
    this.send('party_leave', {});
  }

  kickPartyMember(userId) {
    this.send('party_kick', { userId });
  }

  // Node presence methods

  /**
   * Join a node room for presence updates.
   * Tracked for reconnection replay.
   */
  joinNodeRoom(nodeId) {
    this.nodeRoom = nodeId;
    this.send('join_node', { nodeId });
  }

  /**
   * Leave a node room.
   * Clears reconnection tracking.
   */
  leaveNodeRoom(nodeId) {
    if (this.nodeRoom === nodeId) {
      this.nodeRoom = null;
    }
    this.send('leave_node', { nodeId });
  }

  // Coliseum queue methods (enhanced)
  joinColiseumQueueWithDetails(
    queueType,
    partyLevel,
    partySize,
    battleMapCapabilities = getBattleMapCapabilities()
  ) {
    this.send('coliseum_queue_join', {
      queueType,
      partyLevel,
      partySize,
      battleMapCapabilities
    });
  }

  leaveColiseumQueueByType(queueType) {
    this.send('coliseum_queue_leave', { queueType });
  }

  coliseumReady(matchId) {
    this.send('coliseum_ready', { matchId });
  }

  // Marketplace methods

  /**
   * Join the marketplace room for general updates.
   * Routes through joinRoom for reconnection replay tracking.
   */
  joinMarketplace() {
    this.joinRoom('marketplace');
  }

  /**
   * Leave the marketplace room.
   * Routes through leaveRoom for reconnection tracking.
   */
  leaveMarketplace() {
    this.leaveRoom('marketplace');
  }

  /**
   * Subscribe to a specific item's order book updates.
   * Tracked for reconnection replay.
   */
  subscribeToItem(itemTemplateId) {
    this.itemSubscriptions.add(itemTemplateId);
    this.send('marketplace_subscribe', { itemTemplateId });
  }

  /**
   * Unsubscribe from item order book updates.
   * Removes from reconnection tracking.
   */
  unsubscribeFromItem(itemTemplateId) {
    this.itemSubscriptions.delete(itemTemplateId);
    this.send('marketplace_unsubscribe', { itemTemplateId });
  }
}
