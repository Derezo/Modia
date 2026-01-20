/**
 * Battle Services - Re-export all battle-related services
 *
 * This module provides backwards compatibility by re-exporting all functions
 * from the split service modules. Code can import from here or directly from
 * individual modules.
 */

// Damage calculations and hit checks
export {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  checkHit,
  calculateExperienceReward,
  calculateGoldReward
} from './damageCalculator.js';

// Status effects and turn state
export {
  processStatusEffects,
  canUnitAct,
  canUnitMove,
  canUnitUseSkills,
  resetTurnState,
  shouldAutoEndTurn,
  applyStatusEffect,
  initializeTurnState
} from './statusEffectManager.js';

// Movement and pathfinding
export {
  getMovementRange,
  getAttackRange,
  getReachableTiles,
  getTargetsInRange,
  findAdjacentTileToTarget,
  getOppositeType,
  calculatePathCost,
  getManhattanDistance
} from './movementService.js';

// Turn order (CT system)
export {
  calculateInitiative,
  sortByInitiative,
  initializeCT,
  advanceCTUntilReady,
  getNextActor,
  consumeCT,
  predictTurnOrder,
  advanceToNextActor,
  advanceToNextActorWithCT,
  CT_THRESHOLD
} from './turnOrderService.js';

// Charge time system
export {
  calculateChargeTime,
  checkChargeInterrupt,
  getChargingDamageMultiplier,
  startCharging,
  cancelCharging,
  updateChargeProgress
} from './chargeSystem.js';

// AoE system
export {
  getAoETiles,
  getUnitsInAoE
} from './aoeService.js';

// Skill definitions
export {
  getSkillDefinition
} from './skillDefinitionService.js';

// Action processing
export {
  getAvailableActions,
  processAction,
  checkBattleEnd
} from './actionProcessor.js';
