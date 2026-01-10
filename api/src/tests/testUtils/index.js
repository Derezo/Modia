/**
 * Test utilities and mock factories for Modia tests
 * Provides deterministic data generation for unit testing services
 */

/**
 * Seeded random number generator (Mulberry32)
 * Allows reproducible random values for tests
 */
export class SeededRandom {
  constructor(seed = 12345) {
    this.seed = seed;
  }

  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }
}

/**
 * Create a mock player unit
 */
export function createMockPlayerUnit(overrides = {}) {
  return {
    id: overrides.id ?? 'player_1',
    name: overrides.name ?? 'Test Hero',
    type: 'player',
    characterId: overrides.characterId ?? 1,
    x: overrides.x ?? 5,
    y: overrides.y ?? 5,
    hp: overrides.hp ?? 100,
    maxHp: overrides.maxHp ?? 100,
    mp: overrides.mp ?? 50,
    maxMp: overrides.maxMp ?? 50,
    level: overrides.level ?? 10,
    str: overrides.str ?? 15,
    vit: overrides.vit ?? 12,
    int: overrides.int ?? 10,
    agi: overrides.agi ?? 11,
    luk: overrides.luk ?? 8,
    attack: overrides.attack ?? 20,
    defense: overrides.defense ?? 15,
    magicAttack: overrides.magicAttack ?? 10,
    magicDefense: overrides.magicDefense ?? 8,
    class: overrides.class ?? 'warrior',
    race: overrides.race ?? 'human',
    movementRange: overrides.movementRange ?? 3,
    attackRange: overrides.attackRange ?? 1,
    statusEffects: overrides.statusEffects ?? [],
    skills: overrides.skills ?? [],
    traits: overrides.traits ?? [],
    hasMoved: overrides.hasMoved ?? false,
    hasActed: overrides.hasActed ?? false,
    ct: overrides.ct ?? 0,
    ...overrides
  };
}

/**
 * Create a mock enemy unit
 */
export function createMockEnemyUnit(overrides = {}) {
  return {
    id: overrides.id ?? 'enemy_1',
    name: overrides.name ?? 'Test Goblin',
    type: 'enemy',
    enemyId: overrides.enemyId ?? 1,
    x: overrides.x ?? 10,
    y: overrides.y ?? 10,
    hp: overrides.hp ?? 50,
    maxHp: overrides.maxHp ?? 50,
    mp: overrides.mp ?? 20,
    maxMp: overrides.maxMp ?? 20,
    level: overrides.level ?? 5,
    str: overrides.str ?? 10,
    vit: overrides.vit ?? 8,
    int: overrides.int ?? 5,
    agi: overrides.agi ?? 12,
    luk: overrides.luk ?? 5,
    attack: overrides.attack ?? 12,
    defense: overrides.defense ?? 6,
    magicAttack: overrides.magicAttack ?? 5,
    magicDefense: overrides.magicDefense ?? 4,
    movementRange: overrides.movementRange ?? 4,
    attackRange: overrides.attackRange ?? 1,
    archetype: overrides.archetype ?? 'aggressive',
    statusEffects: overrides.statusEffects ?? [],
    skills: overrides.skills ?? [],
    hasMoved: overrides.hasMoved ?? false,
    hasActed: overrides.hasActed ?? false,
    ct: overrides.ct ?? 0,
    ...overrides
  };
}

/**
 * Create a mock battle state
 */
export function createMockBattleState(overrides = {}) {
  const units = overrides.units ?? [
    createMockPlayerUnit({ id: 'player_1', x: 5, y: 5 }),
    createMockEnemyUnit({ id: 'enemy_1', x: 10, y: 10 })
  ];

  return {
    battleId: overrides.battleId ?? 1,
    battleType: overrides.battleType ?? 'pve',
    status: overrides.status ?? 'active',
    turn: overrides.turn ?? 1,
    activeUnitId: overrides.activeUnitId ?? units[0]?.id,
    units,
    turnOrder: overrides.turnOrder ?? units.map(u => u.id),
    mapWidth: overrides.mapWidth ?? 32,
    mapHeight: overrides.mapHeight ?? 32,
    terrain: overrides.terrain ?? [],
    obstacles: overrides.obstacles ?? [],
    ...overrides
  };
}

/**
 * Create a mock skill
 */
export function createMockSkill(overrides = {}) {
  return {
    id: overrides.id ?? 'slash',
    name: overrides.name ?? 'Slash',
    description: overrides.description ?? 'A basic melee attack',
    type: overrides.type ?? 'physical',
    targetType: overrides.targetType ?? 'enemy',
    range: overrides.range ?? 1,
    aoeSize: overrides.aoeSize ?? 0,
    mpCost: overrides.mpCost ?? 0,
    power: overrides.power ?? 100,
    accuracy: overrides.accuracy ?? 100,
    cooldown: overrides.cooldown ?? 0,
    currentCooldown: overrides.currentCooldown ?? 0,
    effects: overrides.effects ?? [],
    ...overrides
  };
}

/**
 * Create a mock status effect
 */
export function createMockStatusEffect(overrides = {}) {
  return {
    id: overrides.id ?? 'poison',
    name: overrides.name ?? 'Poison',
    duration: overrides.duration ?? 3,
    maxDuration: overrides.maxDuration ?? 3,
    damagePercent: overrides.damagePercent ?? 5,
    stacks: overrides.stacks ?? 1,
    source: overrides.source ?? 'enemy_1',
    ...overrides
  };
}

/**
 * Create a mock trait
 */
export function createMockTrait(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'Test Trait',
    effectType: overrides.effectType ?? 'physical_damage_bonus',
    effectValue: overrides.effectValue ?? 10,
    description: overrides.description ?? 'A test trait',
    ...overrides
  };
}

/**
 * Create a mock terrain tile
 */
export function createMockTerrain(x, y, overrides = {}) {
  return {
    x,
    y,
    type: overrides.type ?? 'grass',
    movementCost: overrides.movementCost ?? 1,
    passable: overrides.passable ?? true,
    ...overrides
  };
}

/**
 * Create a mock grid (2D array of terrain)
 */
export function createMockGrid(width = 16, height = 16, defaultTerrain = 'grass') {
  const grid = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = createMockTerrain(x, y, { type: defaultTerrain });
    }
  }
  return grid;
}

/**
 * Create a mock WebSocket connection
 */
export function createMockWebSocket(overrides = {}) {
  const messages = [];
  const handlers = new Map();

  return {
    userId: overrides.userId ?? 1,
    username: overrides.username ?? 'testuser',
    isAlive: overrides.isAlive ?? true,
    rooms: new Set(overrides.rooms ?? []),
    messages,
    handlers,

    send(data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      messages.push(parsed);
    },

    on(event, handler) {
      handlers.set(event, handler);
    },

    emit(event, data) {
      const handler = handlers.get(event);
      if (handler) handler(data);
    },

    close() {
      this.isAlive = false;
      this.emit('close');
    },

    getLastMessage() {
      return messages[messages.length - 1];
    },

    getMessages() {
      return [...messages];
    },

    clearMessages() {
      messages.length = 0;
    },

    ...overrides
  };
}

/**
 * Create a mock database query function
 */
export function createMockQuery(responses = {}) {
  const calls = [];

  const mockQuery = async (sql, params = []) => {
    calls.push({ sql, params });

    // Check if we have a mock response for this query pattern
    for (const [pattern, response] of Object.entries(responses)) {
      if (sql.includes(pattern)) {
        if (typeof response === 'function') {
          return response(sql, params);
        }
        return response;
      }
    }

    // Default empty response
    return { rows: [], rowCount: 0 };
  };

  mockQuery.getCalls = () => [...calls];
  mockQuery.getLastCall = () => calls[calls.length - 1];
  mockQuery.clearCalls = () => { calls.length = 0; };

  return mockQuery;
}

/**
 * Create a mock API client response
 */
export function createMockApiResponse(overrides = {}) {
  return {
    success: overrides.success ?? true,
    message: overrides.message ?? 'Success',
    data: overrides.data ?? null,
    ...overrides
  };
}

/**
 * Wait for a specified duration (useful for async tests)
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a test function to ensure deterministic random values
 */
export function withSeededRandom(seed, fn) {
  const random = new SeededRandom(seed);
  const originalRandom = Math.random;
  Math.random = () => random.next();

  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

/**
 * Assert helpers for common test patterns
 */
export const assert = {
  isTrue(value, message = 'Expected true') {
    if (value !== true) throw new Error(message);
  },

  isFalse(value, message = 'Expected false') {
    if (value !== false) throw new Error(message);
  },

  equals(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected} but got ${actual}`);
    }
  },

  deepEquals(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message || `Deep equality failed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
    }
  },

  throws(fn, expectedError = null, message = 'Expected function to throw') {
    try {
      fn();
      throw new Error(message);
    } catch (error) {
      if (expectedError && !error.message.includes(expectedError)) {
        throw new Error(`Expected error containing "${expectedError}" but got "${error.message}"`);
      }
    }
  },

  async throwsAsync(fn, expectedError = null, message = 'Expected async function to throw') {
    try {
      await fn();
      throw new Error(message);
    } catch (error) {
      if (expectedError && !error.message.includes(expectedError)) {
        throw new Error(`Expected error containing "${expectedError}" but got "${error.message}"`);
      }
    }
  },

  inRange(value, min, max, message = '') {
    if (value < min || value > max) {
      throw new Error(message || `Expected ${value} to be between ${min} and ${max}`);
    }
  },

  isNull(value, message = 'Expected null') {
    if (value !== null) throw new Error(message);
  },

  isNotNull(value, message = 'Expected non-null value') {
    if (value === null || value === undefined) throw new Error(message);
  },

  arrayLength(arr, length, message = '') {
    if (arr.length !== length) {
      throw new Error(message || `Expected array length ${length} but got ${arr.length}`);
    }
  },

  contains(arr, item, message = '') {
    if (!arr.includes(item)) {
      throw new Error(message || `Expected array to contain ${item}`);
    }
  }
};
