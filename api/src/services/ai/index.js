/**
 * AI Module - Utility-based AI with multi-actor lookahead
 *
 * This module provides sophisticated AI decision making for NPCs in battle.
 *
 * Features:
 * - Utility-based scoring with configurable weight patterns
 * - Multi-actor lookahead (2-3 turns, all characters)
 * - Alpha-beta pruning with killer moves and history heuristic
 * - Transposition table caching
 * - Performance tracking
 *
 * Usage:
 * ```javascript
 * const { UtilityAI, createAIForUnit } = require('./services/ai');
 *
 * // Create AI for a unit
 * const ai = createAIForUnit(enemy);
 *
 * // Get decision
 * const decision = ai.decideTurnActions(enemy, battleState);
 * console.log(decision.action); // { type: 'attack', targetId: '...' }
 * ```
 */

const { UtilityAI, createAIForUnit, quickDecision, batchDecisions } = require('./utilityAI');
const { StateEvaluator } = require('./stateEvaluator');
const { PATTERN_WEIGHTS, OPTIMAL_PLAYER_WEIGHTS, getWeights, getAvailablePatterns, patternExists } = require('./patternWeights');
const {
  generateAllActions,
  generateMoveActionSequences,
  pruneActions,
  orderActionsForPruning,
  generateThreatResponseActions
} = require('./actionGenerator');
const {
  calculateDamageDealt,
  calculateDamageReceived,
  calculateKillPotential,
  calculatePositionQuality,
  calculateAllySupport,
  calculateHealingValue,
  calculateSurvivalPriority,
  calculateMpEfficiency,
  calculateTargetPriority
} = require('./utilityFactors');
const { Lookahead, quickEvaluate } = require('./lookahead');
const {
  TranspositionTable,
  KillerMoves,
  HistoryHeuristic,
  PerformanceTracker,
  cloneState,
  applyActionToState
} = require('./cache');

module.exports = {
  // Main AI classes
  UtilityAI,
  StateEvaluator,
  Lookahead,

  // Factory functions
  createAIForUnit,
  quickDecision,
  batchDecisions,
  quickEvaluate,

  // Pattern configuration
  PATTERN_WEIGHTS,
  OPTIMAL_PLAYER_WEIGHTS,
  getWeights,
  getAvailablePatterns,
  patternExists,

  // Action generation
  generateAllActions,
  generateMoveActionSequences,
  pruneActions,
  orderActionsForPruning,
  generateThreatResponseActions,

  // Utility factors
  calculateDamageDealt,
  calculateDamageReceived,
  calculateKillPotential,
  calculatePositionQuality,
  calculateAllySupport,
  calculateHealingValue,
  calculateSurvivalPriority,
  calculateMpEfficiency,
  calculateTargetPriority,

  // Cache and optimization
  TranspositionTable,
  KillerMoves,
  HistoryHeuristic,
  PerformanceTracker,
  cloneState,
  applyActionToState
};
