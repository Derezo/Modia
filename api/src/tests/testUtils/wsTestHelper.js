/**
 * WebSocket testing utilities for Modia
 * Provides mock WebSocket server/client for testing real-time features
 */

import { EventEmitter } from 'events';

/**
 * Mock WebSocket client for testing
 * Simulates the browser WebSocket API
 */
export class MockWebSocketClient extends EventEmitter {
  constructor(userId, username) {
    super();
    this.userId = userId;
    this.username = username;
    this.readyState = 1; // WebSocket.OPEN
    this.sentMessages = [];
    this.receivedMessages = [];
    this.rooms = new Set();
    this.isAlive = true;
    this.authenticated = false;
  }

  send(data) {
    const message = typeof data === 'string' ? JSON.parse(data) : data;
    this.sentMessages.push(message);
    this.emit('sent', message);
  }

  receive(message) {
    this.receivedMessages.push(message);
    this.emit('message', { data: JSON.stringify(message) });
  }

  close(code = 1000, reason = '') {
    this.readyState = 3; // WebSocket.CLOSED
    this.isAlive = false;
    this.emit('close', { code, reason });
  }

  ping() {
    this.emit('ping');
  }

  pong() {
    this.emit('pong');
  }

  // Test helpers
  getLastSent() {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  getLastReceived() {
    return this.receivedMessages[this.receivedMessages.length - 1];
  }

  getSentByType(type) {
    return this.sentMessages.filter(m => m.type === type);
  }

  getReceivedByType(type) {
    return this.receivedMessages.filter(m => m.type === type);
  }

  clearMessages() {
    this.sentMessages = [];
    this.receivedMessages = [];
  }

  joinRoom(roomId) {
    this.rooms.add(roomId);
  }

  leaveRoom(roomId) {
    this.rooms.delete(roomId);
  }
}

/**
 * Mock WebSocket server for testing
 * Simulates the server-side WebSocket handling
 */
export class MockWebSocketServer extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // userId -> MockWebSocketClient
    this.rooms = new Map();   // roomId -> Set<userId>
    this.messageHandlers = new Map();
    this.broadcastLog = [];
  }

  /**
   * Add a client to the server
   */
  addClient(client) {
    this.clients.set(client.userId, client);
    this.emit('connection', client);
  }

  /**
   * Remove a client from the server
   */
  removeClient(userId) {
    const client = this.clients.get(userId);
    if (client) {
      // Remove from all rooms
      for (const [roomId, members] of this.rooms) {
        members.delete(userId);
        if (members.size === 0) {
          this.rooms.delete(roomId);
        }
      }
      this.clients.delete(userId);
    }
    return client;
  }

  /**
   * Get a client by userId
   */
  getClient(userId) {
    return this.clients.get(userId);
  }

  /**
   * Join a user to a room
   */
  joinRoom(userId, roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(userId);

    const client = this.clients.get(userId);
    if (client) {
      client.joinRoom(roomId);
    }
  }

  /**
   * Remove a user from a room
   */
  leaveRoom(userId, roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    const client = this.clients.get(userId);
    if (client) {
      client.leaveRoom(roomId);
    }
  }

  /**
   * Get all users in a room
   */
  getRoomMembers(roomId) {
    return Array.from(this.rooms.get(roomId) || []);
  }

  /**
   * Send a message to a specific user
   */
  sendToUser(userId, message) {
    const client = this.clients.get(userId);
    if (client && client.readyState === 1) {
      client.receive(message);
      return true;
    }
    return false;
  }

  /**
   * Broadcast a message to all users in a room
   */
  broadcastToRoom(roomId, message, excludeUserId = null) {
    const members = this.rooms.get(roomId);
    if (!members) return 0;

    let count = 0;
    for (const userId of members) {
      if (userId !== excludeUserId) {
        if (this.sendToUser(userId, message)) {
          count++;
        }
      }
    }

    this.broadcastLog.push({ roomId, message, excludeUserId, count });
    return count;
  }

  /**
   * Broadcast to all connected clients
   */
  broadcastAll(message, excludeUserId = null) {
    let count = 0;
    for (const [userId, client] of this.clients) {
      if (userId !== excludeUserId && client.readyState === 1) {
        client.receive(message);
        count++;
      }
    }
    return count;
  }

  /**
   * Register a message handler
   */
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Process an incoming message from a client
   */
  async handleMessage(client, message) {
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      await handler(client, message.payload || {});
    }
    this.emit('message', { client, message });
  }

  /**
   * Simulate processing a message from a client
   */
  async simulateClientMessage(userId, message) {
    const client = this.clients.get(userId);
    if (client) {
      await this.handleMessage(client, message);
    }
  }

  // Test helpers
  getBroadcastLog() {
    return [...this.broadcastLog];
  }

  clearBroadcastLog() {
    this.broadcastLog = [];
  }

  getClientCount() {
    return this.clients.size;
  }

  getRoomCount() {
    return this.rooms.size;
  }

  reset() {
    this.clients.clear();
    this.rooms.clear();
    this.broadcastLog = [];
    this.messageHandlers.clear();
  }
}

/**
 * Create a test scenario with multiple connected clients
 */
export function createTestScenario(options = {}) {
  const server = new MockWebSocketServer();
  const clients = [];

  const userCount = options.userCount || 2;
  for (let i = 1; i <= userCount; i++) {
    const client = new MockWebSocketClient(i, `user${i}`);
    client.authenticated = true;
    server.addClient(client);
    clients.push(client);
  }

  return { server, clients };
}

/**
 * Create a battle room test scenario
 */
export function createBattleRoomScenario(battleId = 1, playerCount = 2) {
  const { server, clients } = createTestScenario({ userCount: playerCount });
  const roomId = `battle:${battleId}`;

  // Join all clients to battle room
  for (const client of clients) {
    server.joinRoom(client.userId, roomId);
  }

  return { server, clients, roomId, battleId };
}

/**
 * Create a chat room test scenario
 */
export function createChatRoomScenario(roomId = 'chat:global', userCount = 3) {
  const { server, clients } = createTestScenario({ userCount });

  // Join all clients to chat room
  for (const client of clients) {
    server.joinRoom(client.userId, roomId);
  }

  return { server, clients, roomId };
}

/**
 * Wait for a message of a specific type
 */
export function waitForMessage(client, type, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeout);

    const handler = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === type) {
        clearTimeout(timer);
        client.off('message', handler);
        resolve(message);
      }
    };

    client.on('message', handler);
  });
}

/**
 * Assert that a client received a specific message
 */
export function assertReceivedMessage(client, type, payloadMatcher = null) {
  const messages = client.getReceivedByType(type);
  if (messages.length === 0) {
    throw new Error(`Expected to receive message of type "${type}" but none found`);
  }

  if (payloadMatcher) {
    const matching = messages.find(m => {
      for (const [key, value] of Object.entries(payloadMatcher)) {
        if (m.payload?.[key] !== value) return false;
      }
      return true;
    });

    if (!matching) {
      throw new Error(
        `Expected message with payload matching ${JSON.stringify(payloadMatcher)} ` +
        `but got: ${JSON.stringify(messages.map(m => m.payload))}`
      );
    }
  }

  return messages;
}

/**
 * Assert that a client did NOT receive a specific message
 */
export function assertNotReceivedMessage(client, type) {
  const messages = client.getReceivedByType(type);
  if (messages.length > 0) {
    throw new Error(
      `Expected NOT to receive message of type "${type}" but found ${messages.length}`
    );
  }
}

/**
 * Assert that a broadcast was sent to a room
 */
export function assertBroadcast(server, roomId, type, payloadMatcher = null) {
  const broadcasts = server.getBroadcastLog().filter(
    b => b.roomId === roomId && b.message.type === type
  );

  if (broadcasts.length === 0) {
    throw new Error(`Expected broadcast of type "${type}" to room "${roomId}" but none found`);
  }

  if (payloadMatcher) {
    const matching = broadcasts.find(b => {
      for (const [key, value] of Object.entries(payloadMatcher)) {
        if (b.message.payload?.[key] !== value) return false;
      }
      return true;
    });

    if (!matching) {
      throw new Error(
        `Expected broadcast with payload matching ${JSON.stringify(payloadMatcher)}`
      );
    }
  }

  return broadcasts;
}

export default {
  MockWebSocketClient,
  MockWebSocketServer,
  createTestScenario,
  createBattleRoomScenario,
  createChatRoomScenario,
  waitForMessage,
  assertReceivedMessage,
  assertNotReceivedMessage,
  assertBroadcast
};
