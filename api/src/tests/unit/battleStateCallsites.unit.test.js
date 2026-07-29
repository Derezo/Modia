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
    assert.doesNotMatch(
      currentRoute,
      /\b(?:SELECT|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+battles\b/i
    );
  });

  it('commits the player successor before launching action enemy turns', async () => {
    const route = await readCallsite('routes/battle.js');
    const actionRoute = route.slice(
      route.indexOf("router.post('/action'"),
      route.indexOf("router.get('/rewards/:battleId'")
    );
    const commitIndex = actionRoute.indexOf(
      'const actionCommit = await commitBattleActionState'
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
      /if \(actionCommit\.idempotent\) \{\s*throw new AppError\('Battle state has changed - please retry', 409\)/
    );
    assert.match(
      actionRoute,
      /\$\{result\.turnEnded \? 'player-turn' : 'player-action'\}:[\s\S]*\$\{battleId\}:\$\{battle\.stateRevision\}:\$\{req\.user\.userId\}:\$\{actionSequence\}/
    );
    assert.doesNotMatch(actionRoute, /UPDATE battles/);
    assert.ok(commitIndex >= 0 && launchIndex > commitIndex);
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

  it('commits terminal enemy state before publishing end side effects', async () => {
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
      /else \{\s*const activeCommit[\s\S]*commandType:\s*'enemy_turn_settle'[\s\S]*stateRevision = activeCommit\.envelope\.stateRevision/
    );
    assert.match(
      helper,
      /else \{[\s\S]*battleTurnManager\.notifyPlayerTurn\(battleId, state\)/
    );
    assert.doesNotMatch(helper, /UPDATE battles/);
    assert.ok(endIndex >= 0);
  });
});
