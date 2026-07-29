import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(testDirectory, '../..');
const callsiteFiles = [
  'services/battleTurnManager.js',
  'services/debugService.js',
  'services/battleReconnection.js',
  'services/messageReliability.js',
  'websocket/messageHandlers.js'
];

async function readCallsite(relativePath) {
  return readFile(resolve(sourceRoot, relativePath), 'utf8');
}

describe('battle state repository callsites', () => {
  it('does not query or mutate authoritative battle rows directly', async () => {
    const sources = await Promise.all(callsiteFiles.map(readCallsite));
    const directBattleSql = /\b(?:from|update|insert\s+into|delete\s+from)\s+battles\b/i;

    for (const [index, source] of sources.entries()) {
      assert.doesNotMatch(
        source,
        directBattleSql,
        `${callsiteFiles[index]} must use BattleStateRepository`
      );
      assert.match(source, /battleStateRepository\./);
    }
  });

  it('commits turn and connection mutations with explicit revisions and keys', async () => {
    const [turnManager, reconnection] = await Promise.all([
      readCallsite('services/battleTurnManager.js'),
      readCallsite('services/battleReconnection.js')
    ]);

    assert.match(turnManager, /expectedRevision/);
    assert.match(turnManager, /battleStateRepository\.commitBattleState\(\{/);
    assert.match(turnManager, /idempotencyKey:/);
    assert.match(turnManager, /stateRevision = commitResult\.stateRevision/);
    assert.match(
      turnManager,
      /state = structuredClone\(commitResult\.envelope\.state\)/
    );
    assert.match(reconnection, /expectedRevision:\s*battle\.stateRevision/);
    assert.match(reconnection, /player_disconnect/);
    assert.match(reconnection, /player_reconnect/);
    assert.match(reconnection, /player_abandon_timeout/);
  });

  it('serves repository-fresh, revisioned snapshots for sync and reconnect', async () => {
    const [reconnection, reliability, handlers] = await Promise.all([
      readCallsite('services/battleReconnection.js'),
      readCallsite('services/messageReliability.js'),
      readCallsite('websocket/messageHandlers.js')
    ]);

    const reconnectFunctionStart = reconnection.indexOf(
      'async function getBattleStateForReconnect'
    );
    assert.ok(reconnectFunctionStart >= 0);
    const reconnectFunction = reconnection.slice(
      reconnectFunctionStart,
      reconnection.indexOf('/**', reconnectFunctionStart)
    );
    assert.match(
      reconnectFunction,
      /battleStateRepository\.loadBattleForParticipant\(\s*battleId,\s*playerId\s*\)/
    );
    assert.doesNotMatch(
      reconnectFunction,
      /battleStateRepository\.loadBattle\(/
    );
    assert.match(reconnection, /stateRevision:\s*battle\.stateRevision/);
    assert.match(reconnection, /mutableState:\s*battle\.mutableState/);
    assert.match(reliability, /createBattleStateSnapshotV1/);
    assert.match(reliability, /stateRevision:\s*battle\.stateRevision/);
    assert.match(handlers, /createNegotiatedBattleStateSnapshot/);
    assert.match(handlers, /requireActive:\s*true/);
  });
});

describe('battle route enemy-turn revision handoff', () => {
  it('keeps lifecycle-locked PvE snapshot reads on the transaction client', async () => {
    const route = await readCallsite('routes/battle.js');
    const startRoute = route.slice(
      route.indexOf("router.post('/start'"),
      route.indexOf("router.get('/current'")
    );

    assert.match(
      startRoute,
      /traitService\.loadCharacterTraits\(\s*authoritativeCharacterIds,\s*\{\s*client\s*\}\s*\)/
    );
    assert.match(
      startRoute,
      /zodiacAbilityService\.loadActiveZodiacAbilities\(\s*req\.user\.userId,\s*\{\s*client\s*\}\s*\)/
    );
    assert.match(
      startRoute,
      /enemyService\.generateEncounter\(\s*currentNodeId,\s*selectedParty,\s*authoritativeCharacterIds,\s*\{\s*client\s*\}\s*\)/
    );
  });

  it('passes the current revision to every enemy-turn processor call', async () => {
    const route = await readCallsite('routes/battle.js');
    const calls = [
      /processEnemyTurnsAsync\(\s*battleId,\s*battleState,\s*aiService,\s*battleService,\s*stateRevision\s*\)/,
      /processEnemyTurnsAsync\(\s*battleId,\s*state,\s*aiService,\s*battleService,\s*battleEnvelope\.stateRevision\s*\)/,
      /processEnemyTurnsAsync\(\s*battleId,\s*committedPlayerState,\s*aiService,\s*battleService,\s*committedRevision\s*\)/
    ];

    for (const call of calls) {
      assert.match(route, call);
    }
    assert.equal(route.match(/processEnemyTurnsAsync\(/g)?.length, calls.length);
  });

  it('returns the current persisted revision from the current-battle route', async () => {
    const route = await readCallsite('routes/battle.js');
    const currentRoute = route.slice(
      route.indexOf("router.get('/current'"),
      route.indexOf("router.get('/:battleId/rejoin'")
    );

    assert.match(
      currentRoute,
      /battleStateRepository\.findActiveBattleForPlayer/
    );
    assert.match(currentRoute, /stateRevision:\s*battleEnvelope\.stateRevision/);
    assert.match(
      currentRoute,
      /getParticipantAvailableActions\(\s*battleEnvelope,\s*state,\s*req\.user\.userId\s*\)/
    );
    assert.doesNotMatch(
      currentRoute,
      /\b(?:SELECT|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+battles\b/i
    );
  });

  it('does not expose another participant action details during rejoin', async () => {
    const route = await readCallsite('routes/battle.js');
    const rejoinRoute = route.slice(
      route.indexOf("router.get('/:battleId/rejoin'"),
      route.indexOf("router.post('/action'")
    );

    assert.match(
      rejoinRoute,
      /getParticipantAvailableActions\(\s*battleEnvelope,\s*battleState,\s*req\.user\.userId\s*\)/
    );
    assert.doesNotMatch(
      rejoinRoute,
      /battleService\.getAvailableActions\(activePlayerUnit/
    );
  });

  it('commits the player successor before launching action enemy turns', async () => {
    const route = await readCallsite('routes/battle.js');
    const actionRoute = route.slice(
      route.indexOf("router.post('/action'"),
      route.indexOf("router.get('/rewards/:battleId'")
    );
    const commitIndex = actionRoute.indexOf(
      'actionCommit = await commitBattleActionState'
    );
    const launchIndex = actionRoute.indexOf('setImmediate(async () => {', commitIndex);

    assert.match(actionRoute, /loadParticipantBattleOr404/);
    assert.match(
      actionRoute,
      /advanceToNextActorWithCT\(state\);[\s\S]*predictTurnOrder\(state, 10\);[\s\S]*commitBattleActionState\(\{[\s\S]*expectedRevision:\s*battle\.stateRevision/
    );
    assert.match(
      actionRoute,
      /committedPlayerState = state;[\s\S]*committedRevision = actionCommit\.envelope\.stateRevision/
    );
    assert.match(
      actionRoute,
      /broadcastStateUpdate\(battleId, actionCommit\.update\)/
    );
    assert.match(
      actionRoute,
      /findCommandReceipt\(\{[\s\S]*idempotencyRequest:\s*actionCommand\.idempotencyRequest/
    );
    assert.match(
      actionRoute,
      /commandType:\s*actionCommand\.commandType,[\s\S]*idempotencyKey:\s*actionCommand\.idempotencyKey,[\s\S]*replayMetadata/
    );
    assert.match(actionRoute, /return sendBattleActionReplay\(/);
    assert.match(actionRoute, /stateRevision:\s*completion\?\.stateRevision \?\? committedRevision/);
    assert.doesNotMatch(actionRoute, /UPDATE battles/);
    assert.ok(commitIndex >= 0 && launchIndex > commitIndex);
  });

  it('serves actionable revision data from the defensive polling endpoint', async () => {
    const route = await readCallsite('routes/battle.js');
    const stateRoute = route.slice(
      route.indexOf("router.get('/:id/state'"),
      route.indexOf("router.post('/:battleId/zodiac-ability'")
    );

    assert.match(stateRoute, /stateRevision:\s*battle\.stateRevision/);
    assert.match(stateRoute, /moveUsed:\s*activeUnit\?\.moveUsed/);
    assert.match(stateRoute, /actUsed:\s*activeUnit\?\.actUsed/);
    assert.match(stateRoute, /turnPhase:\s*activeUnit\?\.turnPhase/);
    assert.match(stateRoute, /hasActed:\s*activeUnit\?\.hasActed/);
    assert.match(stateRoute, /availableActions:\s*participantAvailableActions/);
  });

  it('threads the settled revision into player turn recovery events', async () => {
    const [route, turnManager, websocket] = await Promise.all([
      readCallsite('routes/battle.js'),
      readCallsite('services/battleTurnManager.js'),
      readCallsite('services/battleWebsocket.js')
    ]);

    assert.match(
      route,
      /await battleTurnManager\.notifyPlayerTurn\(\s*battleId,\s*state,\s*stateRevision\s*\)/
    );
    assert.match(
      turnManager,
      /sendYourTurn\([\s\S]*availableActions,[\s\S]*stateRevision/
    );
    assert.match(
      turnManager,
      /broadcastTurnStart\([\s\S]*turnPredictions,[\s\S]*stateRevision,[\s\S]*turnStartAvailability/
    );
    assert.match(
      turnManager,
      /const turnStartAvailability = !isMultiplayer \? availableActions : null/
    );
    assert.match(websocket, /type:\s*'battle:your_turn'[\s\S]*\{ stateRevision \}/);
    assert.match(
      websocket,
      /type:\s*'battle:turn_start'[\s\S]*\{ availableActions \}[\s\S]*\{ stateRevision \}/
    );
  });

  it('binds action command IDs to the complete intent and terminal commit paths', async () => {
    const [route, rewards, coliseum] = await Promise.all([
      readCallsite('routes/battle.js'),
      readCallsite('services/battleRewardService.js'),
      readCallsite('services/coliseum/matchLifecycle.js')
    ]);

    assert.match(
      route,
      /idempotencyRequest:\s*\{[\s\S]*actionType:[\s\S]*unitId:[\s\S]*targetTile:[\s\S]*skillId:[\s\S]*inventoryId:/
    );
    assert.match(
      route,
      /battleCommand:\s*idempotencyRequest === undefined \? null : \{[\s\S]*idempotencyRequest,[\s\S]*replayMetadata/
    );
    assert.match(
      rewards,
      /battleCommand = null[\s\S]*findCommandReceipt\(\{[\s\S]*battleCommand\.idempotencyRequest/
    );
    assert.match(
      rewards,
      /idempotencyKey:\s*`battle-rewards:[\s\S]*\.\.\.\(battleCommand \?\? \{\}\)/
    );
    assert.match(
      coliseum,
      /battleCommand = null[\s\S]*findCommandReceipt\(\{[\s\S]*battleCommand\.idempotencyRequest/
    );
    assert.match(
      coliseum,
      /idempotencyKey:\s*`coliseum-match-complete:[\s\S]*\.\.\.\(battleCommand \?\? \{\}\)/
    );
  });

  it('does not directly overwrite state after enemy processing', async () => {
    const route = await readCallsite('routes/battle.js');
    const processingSegments = [
      ...route.matchAll(
        /const enemyTurnResult = await battleTurnManager\.processEnemyTurnsAsync\([\s\S]*?await handleProcessedEnemyTurns\([\s\S]*?\);/g
      )
    ];

    assert.equal(processingSegments.length, 3);
    for (const [segment] of processingSegments) {
      assert.doesNotMatch(segment, /UPDATE battles/);
    }
  });

  it('uses the committed enemy advance as the player handoff boundary', async () => {
    const route = await readCallsite('routes/battle.js');
    const helperStart = route.indexOf('async function handleProcessedEnemyTurns');
    const helper = route.slice(
      helperStart,
      route.indexOf('// ============================================================================', helperStart)
    );
    const endIndex = helper.indexOf('await handleBattleEnd(');

    assert.match(
      helper,
      /if \(battleStatus !== 'active'\) \{[\s\S]*await handleBattleEnd\(/
    );
    assert.match(helper, /expectedRevision:\s*stateRevision/);
    assert.match(
      helper,
      /const authoritativeBattle = await battleStateRepository\.loadBattle\(battleId\)/
    );
    assert.match(
      helper,
      /authoritativeBattle\.stateRevision === stateRevision[\s\S]*await battleTurnManager\.notifyPlayerTurn\(\s*battleId,\s*state,\s*stateRevision\s*\)/
    );
    assert.doesNotMatch(helper, /enemy_turn_settle/);
    assert.doesNotMatch(helper, /UPDATE battles/);
    assert.ok(endIndex >= 0);
  });

  it('reloads authoritative state and rejects overlapping enemy processors', async () => {
    const turnManager = await readCallsite('services/battleTurnManager.js');

    assert.match(turnManager, /const activeEnemyTurnJobs = new Map\(\)/);
    assert.match(turnManager, /activeEnemyTurnJobs\.has\(jobKey\)/);
    assert.match(
      turnManager,
      /const authoritativeBattle = await battleStateRepository\.loadBattle\(battleId\)/
    );
    assert.match(
      turnManager,
      /processEnemyTurnsFromState\([\s\S]*authoritativeBattle\.state,[\s\S]*authoritativeBattle\.stateRevision/
    );
    assert.match(turnManager, /activeEnemyTurnJobs\.delete\(jobKey\)/);
  });
});
