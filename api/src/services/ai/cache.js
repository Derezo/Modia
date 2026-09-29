/**
 * AI Cache - Transposition table and optimization utilities
 *
 * Provides caching for lookahead search to avoid re-evaluating
 * identical positions.
 */

import { getUnitsInAoE } from '../battle/aoeService.js';
import {
  isBeneficialStatusEffect,
  CURE_ALL_EFFECTS,
  CURE_POISON_EFFECTS
} from '../../../../shared/battleMath.js';

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
   * @param {string|number|Object} perspective - Team being optimized
   * @param {string|number|null} currentActorId - Unit whose turn is being searched
   * @returns {string} Hash key
   */
  hashState(state, depth, perspective, currentActorId = null) {
    // Create a deterministic hash from state
    const parts = [];

    const perspectiveTeam = perspective && typeof perspective === 'object'
      ? getUnitTeamId(perspective)
      : perspective;
    parts.push(
      `d:${depth}`,
      `p:${String(perspectiveTeam)}`,
      `a:${String(currentActorId ?? '')}`,
      `items:${stableSerialize(state.consumables || [])}`
    );

    // Include every mutable field that can change legal actions, turn order, or
    // evaluation. Otherwise two superficially similar boards can incorrectly
    // share a minimax result.
    const sortedUnits = [...state.units]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    for (const unit of sortedUnits) {
      const statuses = [...(unit.statusEffects || [])]
        .map(effect => stableSerialize(effect))
        .sort()
        .join(',');
      const cooldowns = stableSerialize(unit.skillCooldowns || {});
      parts.push([
        String(unit.id),
        `t:${String(getUnitTeamId(unit))}`,
        `p:${unit.tileX},${unit.tileY}`,
        `hp:${unit.hp}`,
        `mp:${unit.mp}`,
        `ct:${unit.ct ?? 0}`,
        `ar:${unit.hasActedThisRound ? 1 : 0}`,
        `mu:${unit.moveUsed ? 1 : 0}`,
        `au:${unit.actUsed ? 1 : 0}`,
        `s:${statuses}`,
        `c:${cooldowns}`,
        `i:${stableSerialize(unit.consumables || [])}`
      ].join(';'));
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
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      return a.every((action, index) => this.actionsEqual(action, b[index]));
    }
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
    if (Array.isArray(action)) {
      return action.map(sequenceAction => this.actionKey(sequenceAction)).join('>');
    }
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
      skillCooldowns: { ...(unit.skillCooldowns || {}) },
      consumables: unit.consumables?.map(item => ({ ...item }))
    })),
    consumables: state.consumables?.map(item => ({ ...item })),
    // Terrain is immutable, no need to clone
    terrain: state.terrain
  };
}

const CURE_ALL_EFFECT_SET = new Set(CURE_ALL_EFFECTS);
const CURE_POISON_EFFECT_SET = new Set(CURE_POISON_EFFECTS);

function getStatusEffectType(effect) {
  return typeof effect === 'string' ? effect : effect?.type;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${key}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }
  return String(value ?? '');
}

function getUnitTeamId(unit) {
  return unit.teamId !== undefined ? unit.teamId : (unit.type === 'enemy' ? 2 : 1);
}

function getManhattanDistance(first, second) {
  return Math.abs(first.tileX - second.tileX) +
    Math.abs(first.tileY - second.tileY);
}

function hasSupportSkillComponent(skill) {
  return skill?.targetAllAllies === true ||
    skill?.targetAlly === true ||
    skill?.targetSelf === true ||
    Boolean(skill?.selfBuff) ||
    Boolean(skill?.cleanse) ||
    skill?.healPercent > 0 ||
    skill?.mpRestore > 0 ||
    skill?.damageType === 'heal' ||
    skill?.effect === 'heal';
}

function hasOffensiveSkillComponent(skill) {
  return Number(skill?.power) > 0 &&
    skill?.targetSelf !== true &&
    skill?.targetAlly !== true &&
    skill?.targetAllAllies !== true &&
    skill?.damageType !== 'support' &&
    skill?.damageType !== 'heal' &&
    skill?.effect !== 'heal';
}

function getSkillBuffEffect(skill) {
  if (typeof skill?.selfBuff === 'string') return skill.selfBuff;
  if (skill?.selfBuff && typeof skill.selfBuff === 'object') {
    return skill.selfBuff.type || `${skill.id || 'skill'}_buff`;
  }
  if (skill?.effect && skill.effect !== 'heal') return skill.effect;
  return null;
}

function isSkillEffectHandledAsBuff(skill) {
  return Boolean(skill?.selfBuff) &&
    skill.effect === getSkillBuffEffect(skill);
}

function isCasterCenteredSupportBuffAoe(skill) {
  return Boolean(skill?.selfBuff) &&
    Number(skill?.aoeRadius) > 0 &&
    (skill.range ?? 1) === 0 &&
    skill.targetAlly !== true &&
    skill.targetAllAllies !== true &&
    !hasOffensiveSkillComponent(skill);
}

function hasHostileStatusSkillComponent(skill) {
  if (!skill?.effect || skill.effect === 'heal' ||
      isSkillEffectHandledAsBuff(skill) ||
      skill.targetSelf === true ||
      skill.targetAlly === true ||
      skill.targetAllAllies === true) {
    return false;
  }

  if (!hasOffensiveSkillComponent(skill) &&
      (skill.selfBuff || skill.cleanse || skill.mpRestore > 0 ||
       skill.healPercent > 0 || skill.damageType === 'heal')) {
    return false;
  }

  return true;
}

function getSupportRecipients(state, caster, requestedTarget, skill) {
  if (skill.targetAllAllies === true) {
    const range = Number(skill.range ?? 1);
    return state.units.filter(candidate =>
      candidate.hp > 0 &&
      getUnitTeamId(candidate) === getUnitTeamId(caster) &&
      (range <= 0 || getManhattanDistance(caster, candidate) <= range)
    );
  }

  if (skill.targetAlly === true) {
    return requestedTarget?.hp > 0 &&
      getUnitTeamId(requestedTarget) === getUnitTeamId(caster)
      ? [requestedTarget]
      : [];
  }

  if (isCasterCenteredSupportBuffAoe(skill)) {
    return getUnitsInAoE(
      state.units,
      caster.tileX,
      caster.tileY,
      skill.aoeRadius,
      skill.aoePattern || 'circle'
    )
      .map(({ unit }) => unit)
      .filter(candidate =>
        getUnitTeamId(candidate) === getUnitTeamId(caster)
      );
  }

  return [caster];
}

function applySimulatedStatusEffect(unit, effectType, duration) {
  if (typeof effectType !== 'string' || effectType === 'heal') return;

  const existing = (unit.statusEffects || []).find(effect => effect.type === effectType);
  if (existing) {
    unit.statusEffects = unit.statusEffects.map(effect =>
      effect === existing
        ? { ...effect, duration: Math.max(effect.duration || 0, duration) }
        : effect
    );
    return;
  }

  unit.statusEffects = [
    ...(unit.statusEffects || []),
    { type: effectType, duration }
  ];
}

function applySupportSkill(
  recipients,
  skill,
  { applyRecovery = true, applyBuff = true } = {}
) {
  const duration = skill.buffDuration || skill.effectDuration || 3;
  const buffEffect = getSkillBuffEffect(skill);

  for (const recipient of recipients) {
    if (applyRecovery && skill.healPercent > 0) {
      const healAmount = Math.max(
        0,
        Math.floor((recipient.maxHp || 0) * skill.healPercent / 100)
      );
      recipient.hp = Math.min(recipient.maxHp, recipient.hp + healAmount);
    }

    if (applyRecovery && skill.mpRestore > 0) {
      const mpAmount = Math.max(
        0,
        Math.floor((recipient.maxMp || 0) * skill.mpRestore / 100)
      );
      recipient.mp = Math.min(recipient.maxMp, recipient.mp + mpAmount);
    }

    if (applyRecovery && skill.cleanse) {
      recipient.statusEffects = (recipient.statusEffects || [])
        .filter(isBeneficialStatusEffect);
    }

    if (applyBuff &&
        (skill.selfBuff || (buffEffect && (skill.effectChance ?? 1) > 0))) {
      applySimulatedStatusEffect(recipient, buffEffect, duration);
      if (skill.selfBuff && typeof skill.selfBuff === 'object') {
        const appliedEffect = recipient.statusEffects?.find(effect =>
          effect.type === buffEffect
        );
        if (appliedEffect) {
          appliedEffect.modifiers = { ...skill.selfBuff };
        }
      }
    }
  }
}

function getItemTarget(state, caster, action) {
  const requestedTarget = state.units.find(unit => unit.id === action.targetId);
  if (!requestedTarget) return caster;
  return getUnitTeamId(requestedTarget) === getUnitTeamId(caster)
    ? requestedTarget
    : caster;
}

function applySimulatedItem(state, caster, action) {
  const item = action.item || {};
  const target = getItemTarget(state, caster, action);
  const amount = Math.max(0, Number(item.effectValue) || 0);

  switch (item.effectType) {
    case 'heal_hp':
      if (target.hp > 0) target.hp = Math.min(target.maxHp, target.hp + amount);
      break;
    case 'heal_mp':
      if (target.hp > 0) target.mp = Math.min(target.maxMp, target.mp + amount);
      break;
    case 'heal_both':
      if (target.hp > 0) {
        target.hp = Math.min(target.maxHp, target.hp + amount);
        target.mp = Math.min(target.maxMp, target.mp + Math.floor(amount / 2));
      }
      break;
    case 'cure_poison':
      target.statusEffects = (target.statusEffects || [])
        .filter(effect =>
          !CURE_POISON_EFFECT_SET.has(getStatusEffectType(effect))
        );
      break;
    case 'cure_all':
      target.statusEffects = (target.statusEffects || [])
        .filter(effect =>
          !CURE_ALL_EFFECT_SET.has(getStatusEffectType(effect))
        );
      break;
    case 'revive':
      if (target.hp <= 0) {
        target.hp = Math.max(1, Math.floor(target.maxHp * amount / 100));
      }
      break;
  }

  const inventory = caster.type === 'player'
    ? state.consumables
    : caster.consumables;
  const inventoryItem = inventory?.find(candidate =>
    candidate.itemId === action.itemId ||
    candidate.itemId === item.itemId
  );
  if (inventoryItem?.quantity > 0) inventoryItem.quantity--;
}

function getAoeCenter(state, caster, action) {
  const skill = action.skill || {};
  if ((skill.range ?? 1) === 0 && Number(skill.aoeRadius) > 0) {
    return { x: caster.tileX, y: caster.tileY };
  }

  const center = action.aoeCenter || action.target;
  const x = center?.x ?? center?.tileX;
  const y = center?.y ?? center?.tileY;
  if (x !== undefined && y !== undefined) return { x, y };

  const target = state.units.find(candidate => candidate.id === action.targetId);
  return target ? { x: target.tileX, y: target.tileY } : null;
}

function applySimulatedAoe(state, caster, action) {
  const skill = action.skill || {};
  const center = getAoeCenter(state, caster, action);
  if (!center) return;

  const affectedUnits = getUnitsInAoE(
    state.units,
    center.x,
    center.y,
    skill.aoeRadius,
    skill.aoePattern || 'circle'
  );
  const hits = Math.max(1, Number(skill.hits) || 1);
  const hasDamage = hasOffensiveSkillComponent(skill);
  const hasHostileStatus = hasHostileStatusSkillComponent(skill);
  const isOffensive = hasDamage || hasHostileStatus;

  for (const { unit: affectedUnit, isCenter } of affectedUnits) {
    // Exclude caster from offensive AoE unless skill explicitly includes self
    if (isOffensive && affectedUnit.id === caster.id && !skill.includesSelf) {
      continue;
    }

    if (hasDamage) {
      let damage = estimateActionDamage(caster, affectedUnit, action) * hits;
      if (!isCenter) damage = Math.floor(damage * 0.75);
      affectedUnit.hp = Math.max(0, affectedUnit.hp - damage);
    }

    if (hasHostileStatus && (skill.effectChance ?? 1) > 0) {
      applySimulatedStatusEffect(
        affectedUnit,
        skill.effect,
        skill.effectDuration || 3
      );
    }
  }
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
      const requestedTarget = state.units.find(u => u.id === action.targetId);
      const skill = action.skill || {};
      const hasSupport = action.type === 'skill' &&
        hasSupportSkillComponent(skill);
      const hasOffense = action.type === 'attack' ||
        hasOffensiveSkillComponent(skill);
      const hasHostileStatus = action.type === 'skill' &&
        hasHostileStatusSkillComponent(skill);

      if (action.type === 'skill' && skill.targetAlly === true) {
        const recipients = getSupportRecipients(state, stateUnit, requestedTarget, skill);
        // Invalid ally targets are rejected by the real action processor before
        // it spends resources or consumes the action.
        if (recipients.length === 0) return state;
      }

      if (action.type === 'skill') {
        const mpCost = Math.max(
          0,
          Number(skill.mpCost ??
            (skill.baseCost ? Math.floor(skill.baseCost / 10) : 5)) || 0
        );
        stateUnit.mp = Math.max(0, stateUnit.mp - mpCost);
        const cooldown = Number(skill.cooldown) || 0;
        const skillId = action.skillId || skill.id;
        if (skillId && cooldown > 0) {
          stateUnit.skillCooldowns ||= {};
          stateUnit.skillCooldowns[skillId] = cooldown;
        }
      }

      if ((hasOffense || hasHostileStatus) && Number(skill.aoeRadius) > 0) {
        // Runtime AoEs affect every living unit in the pattern, including the
        // caster and allies, with reduced damage outside the center tile.
        applySimulatedAoe(state, stateUnit, action);
      } else if (hasOffense && requestedTarget) {
        // Simplified damage for lookahead (actual damage calculated elsewhere).
        const damage = estimateActionDamage(stateUnit, requestedTarget, action);
        requestedTarget.hp = Math.max(0, requestedTarget.hp - damage);
      }

      if (hasHostileStatus && !Number(skill.aoeRadius) && requestedTarget &&
          (skill.effectChance ?? 1) > 0) {
        applySimulatedStatusEffect(
          requestedTarget,
          skill.effect,
          skill.effectDuration || 3
        );
      }

      if (hasSupport) {
        const recipients = getSupportRecipients(state, stateUnit, requestedTarget, skill);
        if (isCasterCenteredSupportBuffAoe(skill)) {
          applySupportSkill(recipients, skill, { applyRecovery: false });
          // Runtime applies non-buff self effects after the radial buff. Keep
          // those caster-only without refreshing the caster's buff twice.
          applySupportSkill([stateUnit], skill, { applyBuff: false });
        } else {
          applySupportSkill(recipients, skill);
        }
      }

      stateUnit.actUsed = true;
      break;
    }

    case 'item':
      applySimulatedItem(state, stateUnit, action);
      stateUnit.actUsed = true;
      break;

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
  const power = action.skill?.power ?? 100;
  const baseDamage = (
    (attacker.strength ?? 0) + (attacker.attack ?? 0)
  ) * (power / 100);
  const defense = (
    (target.vitality ?? 0) + (target.defense ?? 0)
  ) * 0.15;
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
