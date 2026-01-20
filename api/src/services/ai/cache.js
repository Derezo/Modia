/**
 * AI Cache - Transposition table and optimization utilities
 *
 * Provides caching for lookahead search to avoid re-evaluating
 * identical positions.
 */

/**
 * TranspositionTable - Caches evaluated positions
 */
class TranspositionTable {
  constructor(maxSize = 10000) {
    this.table = new Map();
    this.maxSize = maxSize;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generate a hash key for a battle state
   * @param {Object} state - Battle state
   * @param {number} depth - Search depth
   * @param {string} perspective - 'player' or 'enemy'
   * @returns {string} Hash key
   */
  hashState(state, depth, perspective) {
    // Create a deterministic hash from state
    const parts = [];

    // Include depth and perspective
    parts.push(`d${depth}${perspective[0]}`);

    // Hash unit positions and HP (most important state)
    const sortedUnits = [...state.units]
      .filter(u => u.hp > 0)
      .sort((a, b) => a.id < b.id ? -1 : 1);

    for (const unit of sortedUnits) {
      parts.push(`${unit.id}:${unit.tileX},${unit.tileY}:${unit.hp}:${unit.mp}`);
    }

    return parts.join('|');
  }

  /**
   * Store evaluation result
   * @param {string} key - Hash key
   * @param {Object} entry - { score, depth, flag, bestAction }
   */
  store(key, entry) {
    // Evict if at capacity
    if (this.table.size >= this.maxSize) {
      // Remove oldest entry (first inserted)
      const firstKey = this.table.keys().next().value;
      this.table.delete(firstKey);
    }

    this.table.set(key, {
      ...entry,
      timestamp: Date.now()
    });
  }

  /**
   * Retrieve cached evaluation
   * @param {string} key - Hash key
   * @param {number} minDepth - Minimum acceptable depth
   * @returns {Object|null} Cached entry or null
   */
  lookup(key, minDepth = 0) {
    const entry = this.table.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if cached depth is sufficient
    if (entry.depth < minDepth) {
      this.misses++;
      return null;
    }

    this.hits++;
    return entry;
  }

  /**
   * Clear the cache
   */
  clear() {
    this.table.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.table.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : 'N/A'
    };
  }
}

/**
 * KillerMoves - Tracks moves that caused cutoffs
 * Used for move ordering optimization
 */
class KillerMoves {
  constructor(maxDepth = 10) {
    this.killers = new Array(maxDepth).fill(null).map(() => [null, null]);
  }

  /**
   * Store a killer move
   * @param {number} depth - Depth where cutoff occurred
   * @param {Object} action - Action that caused cutoff
   */
  store(depth, action) {
    if (depth >= this.killers.length) return;

    const killerSlots = this.killers[depth];

    // Don't store duplicates
    if (this.actionsEqual(killerSlots[0], action)) return;

    // Shift and insert
    killerSlots[1] = killerSlots[0];
    killerSlots[0] = action;
  }

  /**
   * Get killer moves for a depth
   * @param {number} depth - Search depth
   * @returns {Array} Killer moves (may be null)
   */
  get(depth) {
    if (depth >= this.killers.length) return [];
    return this.killers[depth].filter(k => k !== null);
  }

  /**
   * Check if two actions are equal
   */
  actionsEqual(a, b) {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.targetId !== b.targetId) return false;
    if (a.skillId !== b.skillId) return false;
    if (a.position?.x !== b.position?.x) return false;
    if (a.position?.y !== b.position?.y) return false;
    return true;
  }

  /**
   * Clear all killer moves
   */
  clear() {
    for (let i = 0; i < this.killers.length; i++) {
      this.killers[i] = [null, null];
    }
  }
}

/**
 * HistoryHeuristic - Tracks historically good moves
 */
class HistoryHeuristic {
  constructor() {
    this.history = new Map();
  }

  /**
   * Get history score for an action
   * @param {Object} action - Action to check
   * @returns {number} History score
   */
  getScore(action) {
    const key = this.actionKey(action);
    return this.history.get(key) || 0;
  }

  /**
   * Update history score
   * @param {Object} action - Action that was good
   * @param {number} depth - Search depth
   */
  update(action, depth) {
    const key = this.actionKey(action);
    const current = this.history.get(key) || 0;
    // Bonus scales with depth (deeper cutoffs more valuable)
    this.history.set(key, current + depth * depth);
  }

  /**
   * Generate key for action
   */
  actionKey(action) {
    return `${action.type}:${action.targetId || ''}:${action.skillId || ''}:${action.position?.x || ''},${action.position?.y || ''}`;
  }

  /**
   * Clear history
   */
  clear() {
    this.history.clear();
  }

  /**
   * Age history (decay old scores)
   */
  age() {
    for (const [key, value] of this.history.entries()) {
      const aged = Math.floor(value * 0.9);
      if (aged === 0) {
        this.history.delete(key);
      } else {
        this.history.set(key, aged);
      }
    }
  }
}

/**
 * Performance tracker for AI decisions
 */
class PerformanceTracker {
  constructor() {
    this.decisions = [];
    this.currentDecision = null;
  }

  /**
   * Start tracking a decision
   * @param {string} unitId - Unit making decision
   */
  startDecision(unitId) {
    this.currentDecision = {
      unitId,
      startTime: Date.now(),
      nodesEvaluated: 0,
      maxDepthReached: 0,
      prunedBranches: 0,
      cacheHits: 0
    };
  }

  /**
   * Record node evaluation
   * @param {number} depth - Depth of evaluation
   */
  nodeEvaluated(depth) {
    if (!this.currentDecision) return;
    this.currentDecision.nodesEvaluated++;
    if (depth > this.currentDecision.maxDepthReached) {
      this.currentDecision.maxDepthReached = depth;
    }
  }

  /**
   * Record branch pruning
   */
  branchPruned() {
    if (!this.currentDecision) return;
    this.currentDecision.prunedBranches++;
  }

  /**
   * Record cache hit
   */
  cacheHit() {
    if (!this.currentDecision) return;
    this.currentDecision.cacheHits++;
  }

  /**
   * End decision tracking
   * @param {Object} result - Decision result
   * @returns {Object} Decision stats
   */
  endDecision(result) {
    if (!this.currentDecision) return null;

    const decision = {
      ...this.currentDecision,
      endTime: Date.now(),
      duration: Date.now() - this.currentDecision.startTime,
      result
    };

    this.decisions.push(decision);
    this.currentDecision = null;

    // Keep only last 100 decisions
    if (this.decisions.length > 100) {
      this.decisions.shift();
    }

    return decision;
  }

  /**
   * Get average stats
   * @returns {Object} Average statistics
   */
  getAverageStats() {
    if (this.decisions.length === 0) return null;

    const sum = this.decisions.reduce((acc, d) => ({
      duration: acc.duration + d.duration,
      nodesEvaluated: acc.nodesEvaluated + d.nodesEvaluated,
      maxDepthReached: Math.max(acc.maxDepthReached, d.maxDepthReached),
      prunedBranches: acc.prunedBranches + d.prunedBranches,
      cacheHits: acc.cacheHits + d.cacheHits
    }), { duration: 0, nodesEvaluated: 0, maxDepthReached: 0, prunedBranches: 0, cacheHits: 0 });

    const count = this.decisions.length;
    return {
      count,
      avgDuration: Math.round(sum.duration / count),
      avgNodesEvaluated: Math.round(sum.nodesEvaluated / count),
      maxDepthReached: sum.maxDepthReached,
      avgPrunedBranches: Math.round(sum.prunedBranches / count),
      avgCacheHits: Math.round(sum.cacheHits / count)
    };
  }
}

/**
 * Clone battle state efficiently for lookahead
 * @param {Object} state - Original state
 * @returns {Object} Cloned state
 */
function cloneState(state) {
  return {
    ...state,
    units: state.units.map(unit => ({
      ...unit,
      statusEffects: [...(unit.statusEffects || [])],
      skillCooldowns: { ...(unit.skillCooldowns || {}) }
    })),
    // Terrain is immutable, no need to clone
    terrain: state.terrain
  };
}

/**
 * Apply an action to a state (for lookahead simulation)
 * @param {Object} state - Battle state (will be modified)
 * @param {Object} unit - Acting unit
 * @param {Object} action - Action to apply
 * @returns {Object} Modified state
 */
function applyActionToState(state, unit, action) {
  const stateUnit = state.units.find(u => u.id === unit.id);
  if (!stateUnit) return state;

  switch (action.type) {
    case 'move':
      stateUnit.tileX = action.position.x;
      stateUnit.tileY = action.position.y;
      stateUnit.moveUsed = true;
      break;

    case 'attack':
    case 'skill': {
      const targetUnit = state.units.find(u => u.id === action.targetId);
      if (targetUnit) {
        // Simplified damage for lookahead (actual damage calculated elsewhere)
        const damage = estimateActionDamage(stateUnit, targetUnit, action);
        targetUnit.hp = Math.max(0, targetUnit.hp - damage);
      }
      stateUnit.actUsed = true;
      if (action.skill?.mpCost) {
        stateUnit.mp = Math.max(0, stateUnit.mp - action.skill.mpCost);
      }
      break;
    }

    case 'wait':
      stateUnit.moveUsed = true;
      stateUnit.actUsed = true;
      break;
  }

  return state;
}

/**
 * Estimate damage for lookahead (simplified calculation)
 * @param {Object} attacker - Attacking unit
 * @param {Object} target - Target unit
 * @param {Object} action - Action being taken
 * @returns {number} Estimated damage
 */
function estimateActionDamage(attacker, target, action) {
  const power = action.skill?.power || 100;
  const baseDamage = (attacker.strength + attacker.attack) * (power / 100);
  const defense = (target.vitality + target.defense) * 0.15;
  return Math.max(1, Math.floor(baseDamage - defense));
}

export {
  TranspositionTable,
  KillerMoves,
  HistoryHeuristic,
  PerformanceTracker,
  cloneState,
  applyActionToState,
  estimateActionDamage
};
