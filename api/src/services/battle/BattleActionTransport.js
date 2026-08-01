import {
  BATTLE_MAP_V3_SCHEMA_VERSION
} from '../../../../shared/battleMap/index.js';
import {
  assertBattleMutableStateUpdateV1,
  createBattleMutableStateUpdateV1
} from '../../../../shared/battleStateProtocol.js';
import { withBattleStateVisualIdentities } from './visualIdentityService.js';

function assertEnvelopeReferenceMatchesUpdate(battle, update) {
  const expectedFullHash = battle.fullHash ?? battle.map?.hashes?.fullHash;
  if (String(update.battleId) !== String(battle.battleId)
    || update.battleMapSchemaVersion !== battle.battleMapSchemaVersion
    || update.terrainGenerationVersion !== battle.terrainGenerationVersion
    || update.fullHash !== expectedFullHash) {
    throw new TypeError('Battle action update does not match its authoritative map envelope');
  }
}

/**
 * Build the mutable working copy used by the action processor.
 *
 * V3 map data is already schema/hash verified and deeply frozen by the
 * repository. Reusing those immutable nested values avoids cloning the full
 * authored map on every action while mutable combat data remains isolated.
 */
export function createBattleActionProcessingState(battle) {
  if (battle?.battleMapSchemaVersion !== BATTLE_MAP_V3_SCHEMA_VERSION) {
    return structuredClone(
      withBattleStateVisualIdentities(battle?.state)
    );
  }

  const mutableState = structuredClone(
    withBattleStateVisualIdentities(battle.mutableState)
  );
  return {
    ...battle.map,
    ...mutableState
  };
}

/**
 * V3 action responses carry the same revisioned, server-created mutable update
 * used by WebSocket reconciliation. Legacy maps retain their flat-state
 * response for compatibility.
 */
export function createBattleActionStateTransport({
  battle,
  state,
  update
}) {
  if (battle?.battleMapSchemaVersion !== BATTLE_MAP_V3_SCHEMA_VERSION) {
    return { state };
  }

  assertBattleMutableStateUpdateV1(update);
  assertEnvelopeReferenceMatchesUpdate(battle, update);
  return { update };
}

export function createBattleActionReplayStateTransport({
  battle,
  state,
  receipt
}) {
  if (battle?.battleMapSchemaVersion !== BATTLE_MAP_V3_SCHEMA_VERSION) {
    return { state };
  }
  return createBattleActionStateTransport({
    battle,
    update: createBattleMutableStateUpdateV1(receipt)
  });
}
