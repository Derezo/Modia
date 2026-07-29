import { getAvailableActions } from './actionProcessor.js';

/**
 * Whether a participant may control the battle's current player unit.
 * Ownerless units are supported only for legacy solo battles.
 */
export function canParticipantControlActiveUnit(battle, state, userId) {
  if (!battle || !state || (battle.status ?? state.status ?? 'active') !== 'active') {
    return false;
  }

  const activeUnit = state.units?.find(unit => unit.id === state.activeUnitId);
  if (!activeUnit || activeUnit.type !== 'player') return false;

  if (activeUnit.ownerId !== undefined && activeUnit.ownerId !== null) {
    return String(activeUnit.ownerId) === String(userId);
  }

  return battle.player2Id === null
    && (state.player2Id === null || state.player2Id === undefined)
    && battle.battleType !== 'pvp'
    && battle.battleType !== 'pvp_coliseum'
    && state.battleType !== 'pvp';
}

/**
 * Return complete legal actions only to the participant controlling the actor.
 */
export function getParticipantAvailableActions(battle, state, userId) {
  if (!canParticipantControlActiveUnit(battle, state, userId)) return null;
  const activeUnit = state.units.find(unit => unit.id === state.activeUnitId);
  return getAvailableActions(activeUnit, state);
}
