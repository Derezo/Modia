/**
 * Mock Helpers for AI Unit Tests
 *
 * Shared test factories for creating mock units, battle states,
 * skills, and common battle scenarios.
 */

let nextId = 1;

/**
 * Create a mock unit with realistic stats
 * @param {Object} overrides - Override defaults
 * @returns {Object} Mock unit
 */
export function createMockUnit(overrides = {}) {
  const id = overrides.id || `unit_${nextId++}`;
  return {
    id,
    name: overrides.name || `Unit_${id}`,
    type: overrides.type || 'enemy',
    aiType: overrides.aiType || 'aggressive',
    race: overrides.race || 'human',
    class: overrides.class || 'warrior',
    level: overrides.level || 10,
    hp: overrides.hp ?? 200,
    maxHp: overrides.maxHp ?? 200,
    mp: overrides.mp ?? 50,
    maxMp: overrides.maxMp ?? 50,
    strength: overrides.strength ?? 30,
    intelligence: overrides.intelligence ?? 15,
    agility: overrides.agility ?? 20,
    vitality: overrides.vitality ?? 25,
    luck: overrides.luck ?? 10,
    attack: overrides.attack ?? 15,
    defense: overrides.defense ?? 10,
    magicAttack: overrides.magicAttack ?? 5,
    magicDefense: overrides.magicDefense ?? 5,
    tileX: overrides.tileX ?? 5,
    tileY: overrides.tileY ?? 5,
    ct: overrides.ct ?? 0,
    attackRange: overrides.attackRange ?? 1,
    movement: overrides.movement ?? 3,
    statusEffects: overrides.statusEffects || [],
    skills: overrides.skills || [],
    skillCooldowns: overrides.skillCooldowns || {},
    moveUsed: overrides.moveUsed ?? false,
    actUsed: overrides.actUsed ?? false,
    hasActedThisRound: overrides.hasActedThisRound ?? false,
    ...overrides
  };
}

/**
 * Create a mock battle state
 * @param {Array} playerUnits - Player unit configs
 * @param {Array} enemyUnits - Enemy unit configs
 * @param {Object} options - Additional state options
 * @returns {Object} Mock battle state
 */
export function createMockBattleState(playerUnits = [], enemyUnits = [], options = {}) {
  const width = options.gridWidth || 20;
  const height = options.gridHeight || 20;

  const players = playerUnits.map((config, i) =>
    createMockUnit({
      id: `player_${i + 1}`,
      name: `Player_${i + 1}`,
      type: 'player',
      tileX: config.tileX ?? (2 + i),
      tileY: config.tileY ?? 5,
      ...config
    })
  );

  const enemies = enemyUnits.map((config, i) =>
    createMockUnit({
      id: `enemy_${i + 1}`,
      name: `Enemy_${i + 1}`,
      type: 'enemy',
      tileX: config.tileX ?? (15 + i),
      tileY: config.tileY ?? 5,
      ...config
    })
  );

  // Build terrain grid (plain by default)
  const terrain = options.terrain || Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'grass')
  );

  return {
    units: [...players, ...enemies],
    terrain,
    gridWidth: width,
    gridHeight: height,
    turnNumber: options.turnNumber || 1,
    ...options
  };
}

/**
 * Create a mock skill
 * @param {Object} overrides - Override defaults
 * @returns {Object} Mock skill
 */
export function createMockSkill(overrides = {}) {
  return {
    id: overrides.id || `skill_${nextId++}`,
    name: overrides.name || 'Power Strike',
    power: overrides.power ?? 150,
    damageType: overrides.damageType || 'physical',
    range: overrides.range ?? 1,
    mpCost: overrides.mpCost ?? 10,
    effect: overrides.effect || null,
    targetType: overrides.targetType || 'enemy',
    healPercent: overrides.healPercent ?? 0,
    selfBuff: overrides.selfBuff ?? false,
    aoeRadius: overrides.aoeRadius ?? 0,
    ...overrides
  };
}

/**
 * Create a melee engagement scenario - units adjacent
 * @returns {Object} { state, player, enemy }
 */
export function createMeleeEngagementState() {
  const state = createMockBattleState(
    [{ tileX: 5, tileY: 5, strength: 40, attack: 20, hp: 200, maxHp: 200 }],
    [{ tileX: 6, tileY: 5, strength: 35, attack: 15, hp: 180, maxHp: 180 }]
  );
  return {
    state,
    player: state.units[0],
    enemy: state.units[1]
  };
}

/**
 * Create a long-range scenario - enemies far away
 * @returns {Object} { state, player, enemy }
 */
export function createLongRangeState() {
  const state = createMockBattleState(
    [{ tileX: 2, tileY: 2 }],
    [{ tileX: 18, tileY: 18 }]
  );
  return {
    state,
    player: state.units[0],
    enemy: state.units[1]
  };
}

/**
 * Create a wounded ally scenario
 * @returns {Object} { state, players, enemy }
 */
export function createWoundedAllyState() {
  const state = createMockBattleState(
    [
      { tileX: 5, tileY: 5, hp: 200, maxHp: 200 },
      { tileX: 6, tileY: 5, hp: 40, maxHp: 200 }  // 20% HP
    ],
    [{ tileX: 10, tileY: 5, strength: 50, attack: 25 }]
  );
  return {
    state,
    players: [state.units[0], state.units[1]],
    enemy: state.units[2]
  };
}

/**
 * Reset the ID counter (call in afterEach for clean test isolation)
 */
export function resetIdCounter() {
  nextId = 1;
}
