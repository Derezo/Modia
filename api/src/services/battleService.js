/**
 * Battle Service - Re-exports from modular battle services
 *
 * This file maintains backwards compatibility by re-exporting all functions
 * from api/src/services/battle/. For new code, prefer importing directly
 * from the specific service modules.
 *
 * FORMULA DESIGN (FFT-inspired):
 * - Defense uses diminishing returns: reduction = DEF / (DEF + 100)
 * - CT system: ctGain = 5 + (AGI / 10) for diminishing returns on turn frequency
 * - Crit: 5% base + LCK/300 (max 50%)
 * - Evasion: 2% base + (defAGI - atkAGI)/400 + defLCK/400 (max 35%)
 * - Status resistance: 10% base + LCK/200 (max 50%)
 */

export {
  // Damage calculations
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateExperienceReward,
  calculateGoldReward,
  checkHit,
  // Status effects
  processStatusEffects,
  finalizeStatusEffects,
  canUnitAct,
  canUnitMove,
  canUnitUseSkills,
  resetTurnState,
  shouldAutoEndTurn,
  applyStatusEffect,
  // Zodiac signature abilities
  hasZodiacAbility,
  getAvailableZodiacAbility,
  getAvailableZodiacAbilities,
  markZodiacAbilityUsed,
  applyZodiacAbility,
  processZodiacPoison,
  checkMoonshield,
  getDefenseMultiplier,
  // Movement and range
  getMovementRange,
  getAttackRange,
  getManhattanDistance,
  getSkillDefinition,
  serializeBattleSkill,
  resolveBattleSkill,
  resolveBattleSkills,
  NPC_PRIMARY_BIOMES,
  createBattleVisualIdentity,
  withBattleVisualIdentity,
  withBattleStateVisualIdentities,
  // Unified tile/action availability
  getReachableTiles,
  getTargetsInRange,
  getAvailableActions,
  getOppositeType,
  // Team-based unit filtering
  getOpposingUnits,
  getAlliedUnits,
  areOpponents,
  areAllies,
  isForcedMovementImmune,
  // AoE system
  getAoETiles,
  // Charge time system
  calculateChargeTime,
  checkChargeInterrupt,
  getChargingDamageMultiplier,
  startCharging,
  cancelCharging,
  updateChargeProgress,
  // CT-based turn system
  initializeCT,
  advanceCTUntilReady,
  getNextActor,
  consumeCT,
  predictTurnOrder,
  advanceToNextActor,
  // Background terminal transition handoff
  setBattleTerminalCompletionHandler,
  completeBattleTerminalTransition,
  // Initiative (legacy)
  calculateInitiative,
  sortByInitiative,
  // Action processing
  processAction,
  advanceToNextActorWithCT,
  checkBattleEnd,
  getBattleStatusString,
  // Pathfinding (for AI movement validation)
  calculatePathCost,
  // Encounter generation
  MAP_SEED_MODULUS,
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  generateMapSeed,
  generateBattleTerrain,
  generateEncounterTerrain
} from './battle/index.js';
