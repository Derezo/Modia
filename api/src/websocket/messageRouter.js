/**
 * @module WebSocketMessageRouter
 * @description Registry-based message routing for WebSocket handlers.
 *
 * Key responsibilities:
 * - Message type handler registration
 * - Message routing and dispatch
 * - Handler context management
 * - Error handling for message processing
 *
 * Usage:
 * ```javascript
 * const router = new MessageRouter();
 * router.register('chat_message', async (ctx, payload) => {
 *   // Handle chat message
 * });
 * await router.route(ctx, 'chat_message', { message: 'Hello' });
 * ```
 *
 * @see index.js - Main WebSocket handler that uses this module
 */

// ============================================================
// Message Router Class
// ============================================================

/**
 * WebSocket message router with handler registry
 */
class MessageRouter {
  constructor() {
    /** @type {Map<string, Function>} */
    this.handlers = new Map();

    /** @type {Function|null} */
    this.defaultHandler = null;
  }

  /**
   * Register a handler for a message type
   * @param {string} messageType - Message type to handle
   * @param {Function} handler - Handler function (ctx, payload) => Promise<void>
   * @returns {MessageRouter} this (for chaining)
   */
  register(messageType, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for ${messageType} must be a function`);
    }
    this.handlers.set(messageType, handler);
    return this;
  }

  /**
   * Register multiple handlers at once
   * @param {Object<string, Function>} handlers - Map of message types to handlers
   * @returns {MessageRouter} this (for chaining)
   */
  registerAll(handlers) {
    for (const [type, handler] of Object.entries(handlers)) {
      this.register(type, handler);
    }
    return this;
  }

  /**
   * Set the default handler for unknown message types
   * @param {Function} handler - Handler function (ctx, type, payload) => Promise<void>
   * @returns {MessageRouter} this (for chaining)
   */
  setDefaultHandler(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Default handler must be a function');
    }
    this.defaultHandler = handler;
    return this;
  }

  /**
   * Check if a handler is registered for a message type
   * @param {string} messageType - Message type
   * @returns {boolean}
   */
  hasHandler(messageType) {
    return this.handlers.has(messageType);
  }

  /**
   * Get all registered message types
   * @returns {string[]}
   */
  getRegisteredTypes() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Route a message to its handler
   * @param {Object} ctx - Handler context
   * @param {string} messageType - Message type
   * @param {Object} payload - Message payload
   * @returns {Promise<boolean>} True if handled, false if no handler found
   */
  async route(ctx, messageType, payload) {
    const handler = this.handlers.get(messageType);

    if (handler) {
      await handler(ctx, payload);
      return true;
    }

    if (this.defaultHandler) {
      await this.defaultHandler(ctx, messageType, payload);
      return true;
    }

    return false;
  }

  /**
   * Remove a handler
   * @param {string} messageType - Message type
   * @returns {boolean} True if handler was removed
   */
  unregister(messageType) {
    return this.handlers.delete(messageType);
  }

  /**
   * Clear all handlers
   */
  clear() {
    this.handlers.clear();
    this.defaultHandler = null;
  }
}

// ============================================================
// Handler Context Factory
// ============================================================

/**
 * Create a handler context object for message routing
 * @param {Object} options - Context options
 * @param {WebSocket} options.ws - WebSocket connection
 * @param {number|null} options.userId - Authenticated user ID
 * @param {string|null} options.username - Authenticated username
 * @param {Object} options.roomManager - Room manager instance
 * @param {Function} options.send - Send function (message) => void
 * @param {Function} options.sendError - Send error function (message) => void
 * @returns {Object} Handler context
 */
function createHandlerContext({
  ws,
  userId = null,
  username = null,
  roomManager,
  send,
  sendError
}) {
  return {
    ws,
    userId,
    username,
    roomManager,

    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    isAuthenticated() {
      return userId !== null;
    },

    /**
     * Send a message to this connection
     * @param {Object} message - Message to send
     */
    send(message) {
      send(message);
    },

    /**
     * Send an error message to this connection
     * @param {string} errorMessage - Error message
     */
    sendError(errorMessage) {
      sendError(errorMessage);
    },

    /**
     * Require authentication - sends error if not authenticated
     * @returns {boolean} True if authenticated
     */
    requireAuth() {
      if (!this.isAuthenticated()) {
        this.sendError('Not authenticated');
        return false;
      }
      return true;
    },

    /**
     * Broadcast to a room
     * @param {string} roomName - Room name
     * @param {Object} message - Message to broadcast
     * @param {boolean} excludeSelf - Whether to exclude this user
     */
    broadcastToRoom(roomName, message, excludeSelf = false) {
      roomManager.broadcastToRoom(roomName, message, excludeSelf ? userId : null);
    },

    /**
     * Send to a specific user
     * @param {number} targetUserId - Target user ID
     * @param {Object} message - Message to send
     * @returns {boolean} True if sent
     */
    sendToUser(targetUserId, message) {
      return roomManager.sendToUser(targetUserId, message);
    }
  };
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Parse a WebSocket message safely
 * @param {string|Buffer} data - Raw message data
 * @returns {{ success: boolean, message?: Object, error?: string }}
 */
function parseMessage(data) {
  try {
    const message = JSON.parse(data);
    if (!message.type) {
      return { success: false, error: 'Missing message type' };
    }
    return { success: true, message };
  } catch {
    return { success: false, error: 'Invalid JSON' };
  }
}

/**
 * Create a standard WebSocket response
 * @param {string} type - Response type
 * @param {Object} payload - Response payload
 * @returns {Object}
 */
function createResponse(type, payload) {
  return { type, payload };
}

/**
 * Create a standard error response
 * @param {string} message - Error message
 * @returns {Object}
 */
function createErrorResponse(message) {
  return { type: 'error', payload: { message } };
}

// ============================================================
// Exports
// ============================================================

export {
  MessageRouter,
  createHandlerContext,
  parseMessage,
  createResponse,
  createErrorResponse
};

export default MessageRouter;
