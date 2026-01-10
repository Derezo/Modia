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
 * import { UtilityAI, createAIForUnit } from './services/ai/index.js';
 *
 * // Create AI for a unit
 * const ai = createAIForUnit(enemy);
 *
 * // Get decision
 * const decision = ai.decideTurnActions(enemy, battleState);
 * console.log(decision.action); // { type: 'attack', targetId: '...' }
 * ```
 */

import { UtilityAI, createAIForUnit, quickDecision, batchDecisions } from './utilityAI.js';
import { StateEvaluator } from './stateEvaluator.js';
import { PATTERN_WEIGHTS, OPTIMAL_PLAYER_WEIGHTS, getWeights, getAvailablePatterns, patternExists } from './patternWeights.js';
import {
  generateAllActions,
  generateMoveActionSequences,
  pruneActions,
  orderActionsForPruning,
  generateThreatResponseActions
} from './actionGenerator.js';
import {
  calculateDamageDealt,
  calculateDamageReceived,
  calculateKillPotential,
  calculatePositionQuality,
  calculateAllySupport,
  calculateHealingValue,
  calculateSurvivalPriority,
  calculateMpEfficiency,
  calculateTargetPriority
} from './utilityFactors.js';
import { Lookahead, quickEvaluate } from './lookahead.js';
import {
  TranspositionTable,
  KillerMoves,
  HistoryHeuristic,
  PerformanceTracker,
  cloneState,
  applyActionToState
} from './cache.js';

export {
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
