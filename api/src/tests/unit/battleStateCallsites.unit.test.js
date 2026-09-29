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
  it('commits trusted action successors through the mutable-state hot path', async () => {
    const route = await readCallsite('routes/battle.js');
    const helperStart = route.indexOf('async function commitBattleActionState');
    const commitHelper = route.slice(
      helperStart,
      route.indexOf('// ============================================================================', helperStart)
    );

    assert.match(
      commitHelper,
      /battleStateRepository\.commitMutableState\(\{[\s\S]*mutableState:\s*extractBattleMutableStateForCommit\(flatState\)/
    );
    assert.doesNotMatch(commitHelper, /commitBattleState/);
  });

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
      /loadZodiacCollectionBonus\(\s*req\.user\.userId,\s*\{\s*client\s*\}\s*\)/
    );
    // Check that the options object closes properly (after equipmentAugmentEffects or zodiacCollectionBonus)
    assert.match(
      startRoute,
      /equipmentAugmentEffects:\s*characterAugmentEffects\[character\.id\]\s*\|\|\s*\{\}/
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
      /processEnemyTurnsAsync\(\s*battleId,\s*authoritativeBattle\.state,\s*aiService,\s*battleService,\s*authoritativeBattle\.stateRevision\s*\)/,
      // Rejoin endpoint resumes enemy turn processing if the active unit is an enemy
      /processEnemyTurnsAsync\(\s*parseInt\(battleId\),\s*battleEnvelope\.state,\s*aiService,\s*battleService,\s*battleEnvelope\.stateRevision\s*\)/
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
    const actionEventIndex = actionRoute.indexOf(
      'await battleWebsocket.broadcastActionExecuted(',
      commitIndex
    );
    const stateUpdateIndex = actionRoute.indexOf(
      'await battleWebsocket.broadcastStateUpdate(',
      actionEventIndex
    );
    const launchIndex = actionRoute.indexOf(
      'await ensureCurrentSuccessorProgress(',
      stateUpdateIndex
    );

    assert.match(actionRoute, /loadParticipantBattleOr404/);
    assert.match(
      actionRoute,
      /advanceToNextActorWithCT\(state\);[\s\S]*predictTurnOrder\(state, 10\);[\s\S]*commitBattleActionState\(\{[\s\S]*expectedRevision:\s*battle\.stateRevision/
    );
    assert.match(
      actionRoute,
      /advanceToNextActorWithCT\(state\);[\s\S]*battleEndResult = battleService\.checkBattleEnd\(state, \{ actingTeamId \}\);[\s\S]*battleStatus = battleService\.getBattleStatusString\(battleEndResult\)/
    );
    assert.match(
      actionRoute,
      /advanceToNextActorWithCT\(state\);[\s\S]*availableActions = getParticipantAvailableActions\(\s*battle,\s*state,\s*req\.user\.userId\s*\);[\s\S]*replayMetadata = \{[\s\S]*availableActions[\s\S]*commitBattleActionState\(/
    );
    assert.match(
      actionRoute,
      /state = battle\.battleMapSchemaVersion === 3[\s\S]*actionCommit\.envelope\.state[\s\S]*structuredClone\(actionCommit\.envelope\.state\);[\s\S]*committedRevision = actionCommit\.envelope\.stateRevision/
    );
    assert.match(
      actionRoute,
      /const committedUpdate = completion\?\.committedUpdate \?\? actionCommit\?\.update;[\s\S]*broadcastStateUpdate\(battleId, committedUpdate\)/
    );
    assert.match(actionRoute, /let state = createBattleActionProcessingState\(battle\)/);
    assert.match(
      actionRoute,
      /createBattleActionStateTransport\(\{[\s\S]*battle,[\s\S]*state,[\s\S]*update:\s*committedUpdate/
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
    assert.match(
      actionRoute,
      /availableActions:\s*replayMetadata\.availableActions/
    );
    assert.match(
      actionRoute,
      /res\.json\(\{[\s\S]*availableActions,[\s\S]*stateRevision:\s*completion\?\.stateRevision \?\? committedRevision/
    );
    assert.match(actionRoute, /stateRevision:\s*completion\?\.stateRevision \?\? committedRevision/);
    assert.doesNotMatch(actionRoute, /UPDATE battles/);
    assert.ok(commitIndex >= 0 && launchIndex > commitIndex);
    assert.ok(
      actionEventIndex > commitIndex &&
      stateUpdateIndex > actionEventIndex &&
      launchIndex > stateUpdateIndex
    );
  });

  it('serializes enemy presentation broadcasts before authoritative checkpoints', async () => {
    const manager = await readCallsite('services/battleTurnManager.js');
    const functionStart = manager.indexOf(
      'async function processEnemyTurnWithVisualization'
    );
    const enemyPresentation = manager.slice(
      functionStart,
      manager.indexOf('/**', functionStart)
    );

    assert.doesNotMatch(
      enemyPresentation,
      /(?<!await )battleWebsocket\.broadcast(?:IntentHighlight|UnitMoved|ActionExecuted)/
    );
  });

  it('checks terminal turn-start damage before committing an active successor', async () => {
    const [manager, turnTimer, reconnection] = await Promise.all([
      readCallsite('services/battleTurnManager.js'),
      readCallsite('services/coliseum/turnTimer.js'),
      readCallsite('services/battleReconnection.js')
    ]);
    const enemyLoop = manager.slice(
      manager.indexOf('async function processEnemyTurnsFromState'),
      manager.indexOf('async function processEnemyTurnWithVisualization')
    );

    assert.match(
      enemyLoop,
      /advanceToNextActorWithCT\(state\);[\s\S]*battleStatus = battleService\.checkBattleEnd\(state\);[\s\S]*if \(battleStatus\.status !== 'active'\) \{[\s\S]*break;[\s\S]*updateBattleState\(/
    );
    assert.match(
      turnTimer,
      /const actingTeamId = battleService\.getUnitTeamId\(activeUnit\);[\s\S]*advanceToNextActorWithCT\(state\);[\s\S]*const battleEndResult = battleService\.checkBattleEnd\(state, \{ actingTeamId \}\);[\s\S]*if \(battleEndResult\.status !== 'active'\) \{[\s\S]*completeBattleTerminalTransition\(\{[\s\S]*return \{ outcome: 'terminal'/
    );
    assert.match(
      reconnection,
      /const actingTeamId = battleService\.getUnitTeamId\(activeUnit\);[\s\S]*advanceToNextActorWithCT\(state\);[\s\S]*const battleEndResult = battleService\.checkBattleEnd\(state, \{ actingTeamId \}\);[\s\S]*if \(battleEndResult\.status !== 'active'\) \{[\s\S]*completeBattleTerminalTransition\(\{[\s\S]*return \{[\s\S]*outcome: 'terminal'/
    );
  });

  it('keeps timed terminal transitions outside active commits and turn presentation', async () => {
    const [route, turnTimer, reconnection, transition] = await Promise.all([
      readCallsite('routes/battle.js'),
      readCallsite('services/coliseum/turnTimer.js'),
      readCallsite('services/battleReconnection.js'),
      readCallsite('services/battle/BattleTerminalTransition.js')
    ]);

    const timeoutTerminalBranch = turnTimer.slice(
      turnTimer.indexOf("if (battleEndResult.status !== 'active')"),
      turnTimer.indexOf('const commit = await', turnTimer.indexOf(
        "if (battleEndResult.status !== 'active')"
      ))
    );
    const abandonTerminalBranch = reconnection.slice(
      reconnection.indexOf("if (battleEndResult.status !== 'active')"),
      reconnection.indexOf('autoWaitedUnit = activeUnit')
    );

    assert.doesNotMatch(timeoutTerminalBranch, /commitBattleState|broadcastTurnStart|turn_skipped/);
    assert.doesNotMatch(abandonTerminalBranch, /commitBattleState|broadcastTurnStart|broadcastActionExecuted/);
    assert.match(transition, /expectedRevision/);
    assert.match(transition, /idempotencyKey/);
    assert.match(transition, /terminalCompletionHandler\(\{/);
    assert.match(
      route,
      /setBattleTerminalCompletionHandler\(async \(\{[\s\S]*handleBattleEnd\([\s\S]*expectedRevision,[\s\S]*commandIdentity:\s*idempotencyKey,[\s\S]*publish:\s*true[\s\S]*publishColiseumMatchResultEvents/
    );
  });

  it('guards delayed reconnect timers with captured revision and active ownership', async () => {
    const [route, reconnection, timer] = await Promise.all([
      readCallsite('routes/battle.js'),
      readCallsite('services/battleReconnection.js'),
      readCallsite('services/coliseum/turnTimer.js')
    ]);

    assert.match(
      route,
      /const expectedTimerRevision = battleEnvelope\.stateRevision;[\s\S]*startTurnTimerIfCurrent\(\s*battleId,\s*req\.user\.userId,\s*false,\s*expectedTimerRevision\s*\)/
    );
    assert.match(
      reconnection,
      /const expectedRevision = battleState\.stateRevision;[\s\S]*startTurnTimerIfCurrent\(\s*battleId,\s*playerId,\s*false,\s*expectedRevision\s*\)/
    );
    assert.match(
      timer,
      /battle\.stateRevision !== expectedRevision[\s\S]*activeUnit\?\.type !== 'player'[\s\S]*String\(activeUnit\.ownerId\) !== String\(playerId\)[\s\S]*if \(turnTimers\.has\(battleId\)\)/
    );
    assert.match(
      timer,
      /export function handlePlayerReconnect[\s\S]*startTurnTimerIfCurrent\(\s*battleId,\s*playerId,\s*false,\s*battle\.stateRevision\s*\)/
    );
  });

  it('gates the post-action launcher on the committed successor type', async () => {
    const route = await readCallsite('routes/battle.js');
    const actionRoute = route.slice(
      route.indexOf("router.post('/action'"),
      route.indexOf("router.get('/rewards/:battleId'")
    );
    const helperStart = route.indexOf(
      'async function ensureCurrentSuccessorProgress'
    );
    const helper = route.slice(
      helperStart,
      route.indexOf('/**', helperStart + 1)
    );

    assert.ok(helperStart >= 0);
    assert.match(
      helper,
      /replayMetadata\?\.battleStatus !== 'active'[\s\S]*replayMetadata\.turnContinues !== false/
    );
    assert.match(
      helper,
      /battleStateRepository\.loadBattle\(battleId\)[\s\S]*authoritativeBattle\.stateRevision !== receipt\.stateRevision/
    );
    assert.match(
      helper,
      /if \(successor\?\.type === 'player'\) \{[\s\S]*notifyPlayerTurnIfCurrent\(\s*battleId,\s*expectedState,\s*receipt\.stateRevision\s*\)/
    );
    assert.match(
      helper,
      /setImmediate\(async \(\) => \{[\s\S]*processEnemyTurnsAsync\(\s*battleId,\s*authoritativeBattle\.state,\s*aiService,\s*battleService,\s*authoritativeBattle\.stateRevision\s*\)[\s\S]*handleProcessedEnemyTurns\(\s*battleId,\s*enemyTurnResult,\s*userId/
    );
    assert.doesNotMatch(
      helper,
      /Battle successor progress error|progress_check_failed/
    );
    assert.match(
      actionRoute,
      /if \(priorReceipt\) \{[\s\S]*ensureCurrentSuccessorProgress\(\s*battleId,\s*priorReceipt,\s*req\.user\.userId\s*\);[\s\S]*return sendBattleActionReplay\(/
    );
    assert.match(
      actionRoute,
      /if \(actionCommit\.idempotent\) \{[\s\S]*ensureCurrentSuccessorProgress\(\s*battleId,\s*actionCommit,\s*req\.user\.userId\s*\);[\s\S]*return sendBattleActionReplay\(/
    );
    assert.match(
      actionRoute,
      /\} else if \(result\.turnEnded\) \{[\s\S]*ensureCurrentSuccessorProgress\(\s*battleId,\s*actionCommit,\s*req\.user\.userId\s*\);/
    );
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

  it('resolves zodiac actions through stable character identity', async () => {
    const route = await readCallsite('routes/battle.js');
    const zodiacRoute = route.slice(
      route.indexOf("router.post('/:battleId/zodiac-ability'"),
      route.indexOf('export default router')
    );

    assert.match(
      route,
      /Number\(unit\.characterId \?\? unit\.id\) === normalizedCharacterId/
    );
    assert.match(
      zodiacRoute,
      /findOwnedPlayerUnitByCharacterId\(\s*state,\s*characterId,\s*req\.user\.userId\s*\)/
    );
    assert.match(
      zodiacRoute,
      /const activeUnit = findActiveBattleUnit\(state\)/
    );
    assert.match(
      zodiacRoute,
      /String\(activeUnit\.id\) !== String\(sourceUnit\.id\)/
    );
    assert.ok(
      zodiacRoute.indexOf('await battleWebsocket.broadcastActionExecuted(') <
      zodiacRoute.indexOf('await battleWebsocket.broadcastStateUpdate(')
    );
  });

  it('threads the settled revision into player turn recovery events', async () => {
    const [route, coordinator, turnManager, websocket] = await Promise.all([
      readCallsite('routes/battle.js'),
      readCallsite('services/battle/playerHandoffCoordinator.js'),
      readCallsite('services/battleTurnManager.js'),
      readCallsite('services/battleWebsocket.js')
    ]);

    assert.match(
      route,
      /createPlayerHandoffCoordinator\(\{[\s\S]*loadBattle:[\s\S]*battleStateRepository\.loadBattle\(battleId\)[\s\S]*notifyPlayerTurn:[\s\S]*battleTurnManager\.notifyPlayerTurn/
    );
    assert.match(
      coordinator,
      /await notifyPlayerTurn\(\s*battleId,\s*authoritativeState,\s*authoritativeBattle\.stateRevision\s*\)/
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

    // 4 callsites: action processing, start route, current route, rejoin route
    assert.equal(processingSegments.length, 4);
    for (const [segment] of processingSegments) {
      assert.doesNotMatch(segment, /UPDATE battles/);
    }
  });

  it('uses the committed enemy advance as the player handoff boundary', async () => {
    const coordinator = await readCallsite(
      'services/battle/playerHandoffCoordinator.js'
    );
    assert.match(
      coordinator,
      /const authoritativeBattle = await loadBattle\(battleId\)/
    );
    assert.match(
      coordinator,
      /authoritativeBattle\.stateRevision === expectedRevision[\s\S]*await notifyPlayerTurn\(\s*battleId,\s*authoritativeState,\s*authoritativeBattle\.stateRevision\s*\)/
    );
    assert.match(coordinator, /activeNotifications\.get\(activeJobKey\)/);
    assert.match(
      coordinator,
      /activeNotifications\.set\(activeJobKey, notification\)/
    );
    assert.match(
      coordinator,
      /pruneCompletedNotifications\(\s*battleId,\s*authoritativeBattle\.stateRevision\s*\)/
    );
    assert.match(
      coordinator,
      /completedNotifications\.has\(jobKey\)[\s\S]*duplicate:\s*true/
    );
    assert.match(
      coordinator,
      /await notifyPlayerTurn\([\s\S]*rememberCompletedNotification\(jobKey/
    );
    assert.match(
      coordinator,
      /DEFAULT_MAX_COMPLETED_NOTIFICATIONS = 512[\s\S]*while \(completedNotifications\.size > maxCompletedNotifications\)[\s\S]*completedNotifications\.delete\(oldestJobKey\)/
    );
    assert.doesNotMatch(coordinator, /enemy_turn_settle/);
    assert.doesNotMatch(coordinator, /UPDATE battles/);
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
