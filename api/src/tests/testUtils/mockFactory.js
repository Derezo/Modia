/**
 * Unified Mock Factory for Modia Tests
 *
 * Provides a structured, fluent interface for creating mocks
 * with built-in verification and tracking capabilities.
 */

// Re-export existing mock creators for convenience
export {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState,
  createMockSkill,
  createMockStatusEffect,
  createMockTrait,
  createMockTerrain,
  createMockGrid,
  createMockWebSocket,
  createMockQuery,
  SeededRandom,
  withSeededRandom
} from './index.js';

// ============================================================================
// Database Mock Factory
// ============================================================================

/**
 * Create a fluent database mock builder
 * Allows registering query patterns and responses
 *
 * @example
 * const db = createMockDatabase()
 *   .on('SELECT * FROM users', { rows: [{ id: 1, username: 'test' }] })
 *   .on('INSERT INTO users', (sql, params) => ({ rows: [{ id: params[0] }] }))
 *   .build();
 *
 * const result = await db.query('SELECT * FROM users WHERE id = $1', [1]);
 */
export function createMockDatabase() {
  const patterns = new Map();
  const calls = [];
  const expectations = [];

  const builder = {
    /**
     * Register a response for a query pattern
     * @param {string} pattern - SQL pattern to match (partial match)
     * @param {object|function} response - Response object or function(sql, params)
     */
    on(pattern, response) {
      patterns.set(pattern, response);
      return builder;
    },

    /**
     * Register a regex pattern for more complex matching
     */
    onRegex(regex, response) {
      patterns.set(regex, { regex: true, response });
      return builder;
    },

    /**
     * Expect a specific query to be called
     * Call verify() after tests to check expectations
     */
    expect(pattern, times = 1) {
      expectations.push({ pattern, times, actual: 0 });
      return builder;
    },

    /**
     * Build the mock database object
     */
    build() {
      const query = async (sql, params = []) => {
        const call = { sql, params, timestamp: Date.now() };
        calls.push(call);

        // Update expectations
        for (const exp of expectations) {
          if (sql.includes(exp.pattern)) {
            exp.actual++;
          }
        }

        // Find matching pattern
        for (const [pattern, handler] of patterns) {
          if (typeof pattern === 'object' && pattern.regex) {
            if (pattern.test(sql)) {
              const response = handler.response;
              return typeof response === 'function' ? response(sql, params) : response;
            }
          } else if (sql.includes(pattern)) {
            return typeof handler === 'function' ? handler(sql, params) : handler;
          }
        }

        // Default response
        return { rows: [], rowCount: 0 };
      };

      return {
        query,

        /**
         * Get all recorded query calls
         */
        getCalls() {
          return [...calls];
        },

        /**
         * Get the last query call
         */
        getLastCall() {
          return calls[calls.length - 1];
        },

        /**
         * Find all calls matching a pattern
         */
        findCalls(pattern) {
          return calls.filter(c => c.sql.includes(pattern));
        },

        /**
         * Clear recorded calls
         */
        clearCalls() {
          calls.length = 0;
        },

        /**
         * Verify all expectations were met
         * Throws if any expectation failed
         */
        verify() {
          const failures = [];
          for (const exp of expectations) {
            if (exp.actual !== exp.times) {
              failures.push(
                `Expected "${exp.pattern}" to be called ${exp.times} times, but was called ${exp.actual} times`
              );
            }
          }
          if (failures.length > 0) {
            throw new Error(`Mock verification failed:\n${failures.join('\n')}`);
          }
        },

        /**
         * Reset expectations
         */
        resetExpectations() {
          for (const exp of expectations) {
            exp.actual = 0;
          }
        }
      };
    }
  };

  return builder;
}

// ============================================================================
// HTTP Request Mock Factory
// ============================================================================

/**
 * Create a mock HTTP request object
 */
export function createMockRequest(overrides = {}) {
  return {
    method: overrides.method || 'GET',
    path: overrides.path || '/',
    url: overrides.url || overrides.path || '/',
    params: overrides.params || {},
    query: overrides.query || {},
    body: overrides.body || {},
    headers: {
      'content-type': 'application/json',
      ...overrides.headers
    },
    user: overrides.user || null,
    ip: overrides.ip || '127.0.0.1',
    get(header) {
      return this.headers[header.toLowerCase()];
    },
    ...overrides
  };
}

/**
 * Create a mock HTTP response object
 */
export function createMockResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      this.headers['content-type'] = 'application/json';
      return this;
    },

    send(data) {
      this.body = data;
      return this;
    },

    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },

    end() {
      this.ended = true;
      return this;
    },

    // Test helpers
    getStatus() {
      return this.statusCode;
    },

    getBody() {
      return this.body;
    },

    getHeader(name) {
      return this.headers[name.toLowerCase()];
    }
  };

  return response;
}

// ============================================================================
// WebSocket Mock Factory (Enhanced)
// ============================================================================

/**
 * Create a mock WebSocket server for testing
 */
export function createMockWebSocketServer() {
  const clients = new Map();
  const rooms = new Map();
  const broadcasts = [];

  return {
    clients,
    rooms,
    broadcasts,

    /**
     * Add a client to the server
     */
    addClient(ws) {
      clients.set(ws.userId || Math.random(), ws);
      return ws;
    },

    /**
     * Remove a client from the server
     */
    removeClient(ws) {
      const userId = ws.userId || [...clients.entries()].find(([, v]) => v === ws)?.[0];
      if (userId) clients.delete(userId);
    },

    /**
     * Join a room
     */
    joinRoom(roomName, ws) {
      if (!rooms.has(roomName)) {
        rooms.set(roomName, new Set());
      }
      rooms.get(roomName).add(ws);
      ws.rooms = ws.rooms || new Set();
      ws.rooms.add(roomName);
    },

    /**
     * Leave a room
     */
    leaveRoom(roomName, ws) {
      const room = rooms.get(roomName);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          rooms.delete(roomName);
        }
      }
      if (ws.rooms) {
        ws.rooms.delete(roomName);
      }
    },

    /**
     * Broadcast to a room
     */
    broadcastToRoom(roomName, message, excludeWs = null) {
      const room = rooms.get(roomName);
      broadcasts.push({ roomName, message, timestamp: Date.now() });

      if (room) {
        for (const ws of room) {
          if (ws !== excludeWs && ws.isAlive) {
            ws.send(JSON.stringify(message));
          }
        }
      }
    },

    /**
     * Broadcast to all clients
     */
    broadcastAll(message, excludeWs = null) {
      broadcasts.push({ roomName: '*', message, timestamp: Date.now() });

      for (const [, ws] of clients) {
        if (ws !== excludeWs && ws.isAlive) {
          ws.send(JSON.stringify(message));
        }
      }
    },

    /**
     * Get room members
     */
    getRoomMembers(roomName) {
      return [...(rooms.get(roomName) || [])];
    },

    /**
     * Get all broadcasts
     */
    getBroadcasts() {
      return [...broadcasts];
    },

    /**
     * Get broadcasts to a specific room
     */
    getRoomBroadcasts(roomName) {
      return broadcasts.filter(b => b.roomName === roomName);
    },

    /**
     * Clear broadcast history
     */
    clearBroadcasts() {
      broadcasts.length = 0;
    }
  };
}

// ============================================================================
// Service Mock Factory
// ============================================================================

/**
 * Create a mock service with spied methods
 */
export function createMockService(methods = {}) {
  const calls = new Map();

  const service = {};

  for (const [name, implementation] of Object.entries(methods)) {
    calls.set(name, []);

    service[name] = async (...args) => {
      const callRecord = { args, timestamp: Date.now() };
      calls.get(name).push(callRecord);

      if (typeof implementation === 'function') {
        callRecord.result = await implementation(...args);
        return callRecord.result;
      }
      return implementation;
    };
  }

  service._getCalls = (methodName) => calls.get(methodName) || [];
  service._getLastCall = (methodName) => {
    const methodCalls = calls.get(methodName) || [];
    return methodCalls[methodCalls.length - 1];
  };
  service._clearCalls = () => {
    for (const [, methodCalls] of calls) {
      methodCalls.length = 0;
    }
  };

  return service;
}

// ============================================================================
// Test Scenario Factories
// ============================================================================

/**
 * Create a complete battle test scenario
 */
export function createBattleScenario(options = {}) {
  const {
    playerCount = 1,
    enemyCount = 1,
    mapSize = 16,
    playerPositions = null,
    enemyPositions = null
  } = options;

  const { createMockPlayerUnit, createMockEnemyUnit, createMockBattleState, createMockGrid } = require('./index.js');

  const units = [];

  // Create players
  for (let i = 0; i < playerCount; i++) {
    const pos = playerPositions?.[i] || { x: 2 + i, y: 8 };
    units.push(createMockPlayerUnit({
      id: `player_${i + 1}`,
      name: `Hero ${i + 1}`,
      ...pos
    }));
  }

  // Create enemies
  for (let i = 0; i < enemyCount; i++) {
    const pos = enemyPositions?.[i] || { x: 13 - i, y: 8 };
    units.push(createMockEnemyUnit({
      id: `enemy_${i + 1}`,
      name: `Goblin ${i + 1}`,
      ...pos
    }));
  }

  const grid = createMockGrid(mapSize, mapSize);
  const battleState = createMockBattleState({
    units,
    mapWidth: mapSize,
    mapHeight: mapSize,
    terrain: grid.flat()
  });

  return {
    units,
    players: units.filter(u => u.type === 'player'),
    enemies: units.filter(u => u.type === 'enemy'),
    grid,
    battleState,

    /**
     * Get unit by ID
     */
    getUnit(id) {
      return units.find(u => u.id === id);
    },

    /**
     * Move a unit
     */
    moveUnit(id, x, y) {
      const unit = this.getUnit(id);
      if (unit) {
        unit.x = x;
        unit.y = y;
        unit.tileX = x;
        unit.tileY = y;
      }
    },

    /**
     * Damage a unit
     */
    damageUnit(id, amount) {
      const unit = this.getUnit(id);
      if (unit) {
        unit.hp = Math.max(0, unit.hp - amount);
      }
    },

    /**
     * Kill a unit
     */
    killUnit(id) {
      const unit = this.getUnit(id);
      if (unit) {
        unit.hp = 0;
      }
    }
  };
}

/**
 * Create a party test scenario
 */
export function createPartyScenario(options = {}) {
  const { memberCount = 3 } = options;

  const leader = {
    id: 1,
    name: 'Leader',
    level: 10,
    class: 'warrior'
  };

  const members = [leader];
  for (let i = 1; i < memberCount; i++) {
    members.push({
      id: i + 1,
      name: `Member ${i}`,
      level: 5 + i,
      class: ['wizard', 'monk', 'chemist'][i % 3]
    });
  }

  return {
    partyId: 1,
    leader,
    members,
    formation: members.map((m, i) => ({
      characterId: m.id,
      position: i
    }))
  };
}

// ============================================================================
// Timer Mock
// ============================================================================

/**
 * Create a mock timer for testing time-dependent code
 */
export function createMockTimer() {
  let currentTime = Date.now();
  const originalDateNow = Date.now;

  return {
    /**
     * Install the mock timer
     */
    install() {
      Date.now = () => currentTime;
    },

    /**
     * Restore real timer
     */
    restore() {
      Date.now = originalDateNow;
    },

    /**
     * Advance time by milliseconds
     */
    advance(ms) {
      currentTime += ms;
    },

    /**
     * Set absolute time
     */
    setTime(timestamp) {
      currentTime = timestamp;
    },

    /**
     * Get current mocked time
     */
    getTime() {
      return currentTime;
    }
  };
}
