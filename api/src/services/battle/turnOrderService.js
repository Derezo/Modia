/**
 * Turn Order Service - CT-based turn system and initiative
 *
 * CT system: ctGain = 5 + (AGI / 10) for diminishing returns on turn frequency
 * Uses CT_THRESHOLD (100) from battleMath.js
 */

import * as traitService from '../traitService.js';
import {
  CT_THRESHOLD,
  calculateCTGain,
  calculateInitialCT
} from '../../../../shared/battleMath.js';
import {
  finalizeStatusEffects,
  processStatusEffects,
  resetTurnState
} from './statusEffectManager.js';
import { createBattleVisualIdentity } from './visualIdentityService.js';

function getUnitTeamId(unit) {
  return unit.teamId !== undefined
    ? unit.teamId
    : unit.type === 'enemy' ? 2 : 1;
}

function getLivingTeamIds(state) {
  return new Set(
    state.units
      .filter(unit => unit.hp > 0)
      .map(getUnitTeamId)
  );
}

function clearActiveActor(state) {
  state.activeUnitId = null;
  state.activeUnitIndex = -1;
}

/**
 * Calculate initiative for turn order
 * Includes trait bonus for initiative
 */
export function calculateInitiative(unit) {
  const baseInitiative = unit.agility + Math.floor(Math.random() * 10);
  const initiativeBonus = traitService.getInitiativeBonus(unit);
  return Math.floor(baseInitiative * (1 + initiativeBonus));
}

/**
 * Sort units by initiative (descending)
 */
export function sortByInitiative(units) {
  return [...units].map(unit => ({
    ...unit,
    initiative: calculateInitiative(unit)
  })).sort((a, b) => b.initiative - a.initiative);
}

/**
 * Initialize CT values for all units at battle start
 * Formula: (AGI / 2) + random(0, 20)
 * This gives faster units a head start but with some randomness
 */
export function initializeCT(units) {
  for (const unit of units) {
    unit.ct = calculateInitialCT(unit);
  }
}

/**
 * Advance CT for all alive units until at least one can act
 * CT gain formula: 5 + (AGI / 10) - provides diminishing returns
 * AGI 10 = 6 CT/tick, AGI 50 = 10 CT/tick, AGI 100 = 15 CT/tick
 * Returns the number of ticks advanced
 */
export function advanceCTUntilReady(state) {
  const aliveUnits = state.units.filter(u => u.hp > 0);
  if (aliveUnits.length === 0) return 0;

  let ticks = 0;
  const maxTicks = 1000; // Safety limit

  while (ticks < maxTicks) {
    // Check if any unit can act
    if (aliveUnits.some(u => u.ct >= CT_THRESHOLD)) {
      break;
    }

    // Advance all alive units' CT using formula with diminishing returns
    for (const unit of aliveUnits) {
      const ctGain = calculateCTGain(unit); // 5 + (AGI / 10), affected by haste/slow
      unit.ct += ctGain;
    }
    ticks++;
  }

  return ticks;
}

/**
 * Get the next unit to act (highest CT >= 100)
 * Tie-breakers: highest CT, then highest agility, then players before enemies
 */
export function getNextActor(state) {
  const ready = state.units.filter(u => u.hp > 0 && u.ct >= CT_THRESHOLD);

  if (ready.length === 0) return null;

  ready.sort((a, b) => {
    // Highest CT first
    if (b.ct !== a.ct) return b.ct - a.ct;
    // Highest agility as tie-breaker
    if (b.agility !== a.agility) return b.agility - a.agility;
    // Players before enemies as final tie-breaker
    return (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
  });

  return ready[0];
}

/**
 * Consume CT after a unit acts
 */
export function consumeCT(unit) {
  unit.ct -= CT_THRESHOLD;
  // Ensure CT doesn't go negative
  if (unit.ct < 0) unit.ct = 0;
}

/**
 * Predict the next N turns without modifying actual state
 * Uses CT gain formula: 5 + (AGI / 10)
 * Returns array of { id, name, type, class } for each predicted turn
 */
export function predictTurnOrder(state, count = 10) {
  const predictions = [];
  const aliveUnits = state.units.filter(u => u.hp > 0);

  if (aliveUnits.length === 0) return predictions;

  // Create a simulation copy of CT values
  const simCT = {};
  for (const unit of aliveUnits) {
    simCT[unit.id] = unit.ct || 0;
  }

  const maxIterations = count * 100; // Safety limit
  let iterations = 0;

  while (predictions.length < count && iterations < maxIterations) {
    iterations++;

    // Advance CT until someone is ready
    while (!aliveUnits.some(u => simCT[u.id] >= CT_THRESHOLD)) {
      for (const unit of aliveUnits) {
        const ctGain = calculateCTGain(unit);
        simCT[unit.id] += ctGain;
      }
    }

    // Find who acts (same sorting as getNextActor)
    const ready = aliveUnits.filter(u => simCT[u.id] >= CT_THRESHOLD);
    ready.sort((a, b) => {
      if (simCT[b.id] !== simCT[a.id]) return simCT[b.id] - simCT[a.id];
      if (b.agility !== a.agility) return b.agility - a.agility;
      return (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
    });

    const actor = ready[0];
    const visualIdentity = createBattleVisualIdentity(actor);
    const prediction = {
      id: actor.id,
      type: actor.type,
      visualIdentity
    };
    if (actor.name !== undefined) prediction.name = actor.name;
    if (actor.class !== undefined) prediction.class = actor.class;
    if (visualIdentity.kind === 'npc') {
      prediction.visualId = visualIdentity.visualId;
      prediction.enemyId = visualIdentity.visualId;
      prediction.spriteId = visualIdentity.visualId;
      prediction.primaryBiome = visualIdentity.primaryBiome;
    } else {
      // Optional legacy aliases must be omitted instead of serialized as
      // `undefined`; BattleMutableStateV1 is a canonical JSON protocol.
      if (actor.enemyId !== undefined) prediction.enemyId = actor.enemyId;
      if (actor.spriteId !== undefined) prediction.spriteId = actor.spriteId;
      if (actor.race !== undefined) prediction.race = actor.race;
      if (actor.gender !== undefined) prediction.gender = actor.gender;
    }
    predictions.push(prediction);

    // Consume CT in simulation
    simCT[actor.id] -= CT_THRESHOLD;
  }

  return predictions;
}

/**
 * Find the unit that should act next, advancing CT if needed
 * Updates state.activeUnitId to the next actor and resets their turn state
 */
export function advanceToNextActor(state) {
  while (getLivingTeamIds(state).size > 1) {
    // Advance CT until an alive unit is ready.
    advanceCTUntilReady(state);
    const nextActor = getNextActor(state);
    if (!nextActor) break;

    resetTurnState(nextActor);
    nextActor.turnStartEffects = processStatusEffects(nextActor);

    // Periodic damage can defeat the selected actor. Finalize its expiring
    // effects immediately and continue without exposing a dead active turn.
    if (nextActor.hp <= 0) {
      nextActor.turnStartEffects.push(...finalizeStatusEffects(nextActor));
      continue;
    }

    state.activeUnitId = nextActor.id;
    state.activeUnitIndex = state.units.findIndex(
      unit => unit.id === nextActor.id
    );
    return nextActor;
  }

  clearActiveActor(state);
  return null;
}

/**
 * Advance to the next actor using CT system
 * Consumes the current actor's CT and finds the next one
 * @param {Object} state - Battle state
 */
export function advanceToNextActorWithCT(state) {
  // Consume CT for the unit that just acted
  const currentActor = state.units.find(u => u.id === state.activeUnitId);
  if (currentActor) {
    currentActor.turnEndEffects = finalizeStatusEffects(currentActor);
    consumeCT(currentActor);

    // Decrement skill cooldowns for the actor whose turn just ended
    if (currentActor.skillCooldowns) {
      for (const skillId in currentActor.skillCooldowns) {
        if (currentActor.skillCooldowns[skillId] > 0) {
          currentActor.skillCooldowns[skillId]--;
        }
      }
    }
  }

  // Find the next actor
  advanceToNextActor(state);
}

// Re-export CT_THRESHOLD for consumers that need it
export { CT_THRESHOLD };
