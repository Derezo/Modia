import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0, onLine: true }
});
globalThis.document = {
  createElement() {
    return {
      id: '',
      textContent: '',
      style: {},
      classList: { add() {}, remove() {} }
    };
  },
  head: { appendChild() {} },
  body: { appendChild() {} }
};

const {
  BattleWebSocketManager,
  getActionWaitDuration,
  getActorAnimationDurationMs
} = await import('../BattleWebSocketManager.js');
const { BattleStatePoller } = await import('../BattleStatePoller.js');
const { parchmentToast } =
  await import('../../ui/parchment/ParchmentToast.js');
const { BattleMapSession, clearBattleMapSessionCache } =
  await import('../BattleMapSession.js');
const {
  createMinimalBattleMapV2FinalFixture
} = await import('../../../../shared/battleMap/index.js');
const {
  createBattleMutableStateUpdateV1,
  createBattleMutableStateV1,
  createBattleStateSnapshotV1
} = await import('../../../../shared/battleStateProtocol.js');

function createUnit(id, {
  hp = 100,
  maxHp = 100,
  mp = 20,
  maxMp = 100,
  teamId = 1,
  type = 'player',
  ownerId = 1
} = {}) {
  const calls = { hit: 0, death: 0, reconciled: 0, thinking: [] };
  return {
    id,
    name: id,
    hp,
    maxHp,
    mp,
    maxMp,
    teamId,
    type,
    ownerId,
    screenX: 100,
    screenY: 120,
    gridX: 1,
    gridY: 2,
    calls,
    setThinking(value) { calls.thinking.push(value); },
    playHitAnimation() { calls.hit++; },
    playDeathAnimation() { calls.death++; },
    reconcileAnimationWithHealth() { calls.reconciled++; },
    isLocalPlayerUnit(localUserId) {
      return this.type === 'player' && this.ownerId === localUserId;
    },
    isAlive() { return this.hp > 0; }
  };
}

function createHarness(units) {
  const calls = {
    presentations: [],
    waits: [],
    damage: [],
    healing: [],
    mp: [],
    particles: [],
    statuses: [],
    skillSounds: [],
    statusSounds: [],
    zodiacPresentations: [],
    battleEnds: []
  };
  const scene = {
    game: {},
    battleState: { status: 'active', activeUnitId: null },
    battleEnded: false,
    battleLogTurnCounter: 0,
    units: new Map(units.map(unit => [unit.id, unit])),
    grid: {
      gridToScreenWorld(x, y) { return { x, y }; }
    },
    animations: {
      addDamageNumber(...args) { calls.damage.push(args); },
      addHealNumber(...args) { calls.healing.push(args); },
      addMpRestoreNumber(...args) { calls.mp.push(args); },
      addParticleBurst(...args) { calls.particles.push(args); },
      addStatusEffect(...args) { calls.statuses.push(args); },
      addFlash() {},
      addMiss() {}
    },
    audioManager: {
      playSound() {},
      playSkillSound(...args) { calls.skillSounds.push(args); },
      playImpactSound() {},
      playStatusEffectSound(...args) { calls.statusSounds.push(args); }
    },
    addBattleLogEntry() {},
    playActionPresentation(args) {
      calls.presentations.push(args);
      return {
        descriptor: {
          category: 'fire',
          primaryColor: '#ff4400',
          selfTarget: args.result.targetId === args.actor.id && !args.result.isAoE
        }
      };
    },
    presentZodiacAbility(...args) {
      calls.zodiacPresentations.push(args);
    },
    async waitForAnimation(duration) { calls.waits.push(duration); },
    isLocalActiveUnit(unit = this.units.get(this.battleState.activeUnitId)) {
      return unit?.type === 'player' && unit.ownerId === 1;
    },
    isStaleStateRevision(revision) {
      return revision != null && this.stateRevision != null &&
        Number(revision) < Number(this.stateRevision);
    },
    noteStateRevision(revision) {
      if (revision != null) this.stateRevision = revision;
    },
    applyAuthoritativeAvailability(availableActions) {
      this.serverAvailableActions = availableActions || null;
      this.canMove = availableActions?.canMove === true;
      this.canAct = availableActions?.canAct === true;
    },
    reconcileAuthoritativePayload(payload) {
      if (this.isStaleStateRevision(payload.stateRevision)) return false;
      this.noteStateRevision(payload.stateRevision);
      if (payload.state) this.battleState = payload.state;
      this.syncUnitsWithState?.(payload.state?.units || []);
      if (payload.availableActions !== undefined) {
        this.applyAuthoritativeAvailability(payload.availableActions);
      }
      return true;
    },
    refreshActionControls() {},
    clearActionTargetingState() {
      this.currentAction = null;
      this.validTiles = [];
    },
    updateUI() {},
    handleBattleEnd(status, rewards) {
      calls.battleEnds.push({ status, rewards });
      this.battleEnded = true;
    }
  };
  return { manager: new BattleWebSocketManager(scene), scene, calls };
}

describe('BattleWebSocketManager local turn recovery', () => {
  it('fully recovers your_turn when turn_start is missing', () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    const recoveries = [];
    scene.game.localUserId = 1;
    scene.currentAction = 'attack';
    scene.validTiles = [{ x: 2, y: 2 }];
    scene.inEnemySequence = true;
    scene.syncUnitsWithState = units => {
      player.hp = units[0].hp;
    };
    scene.recoverLocalTurn = payload => {
      recoveries.push(payload);
      scene.battleState.activeUnitId = payload.unitId;
      scene.applyAuthoritativeAvailability(payload.availableActions);
      scene.clearActionTargetingState();
      scene.inEnemySequence = false;
      scene.inputEnabled = true;
      return true;
    };

    manager.handleRemoteYourTurn({
      unitId: player.id,
      availableActions: { canMove: true, canAct: false },
      stateRevision: 7,
      state: {
        status: 'active',
        activeUnitId: player.id,
        units: [{ id: player.id, hp: 42 }]
      }
    });

    assert.deepEqual(recoveries, [{
      unitId: player.id,
      availableActions: { canMove: true, canAct: false },
      stateRevision: 7
    }]);
    assert.equal(scene.battleState.activeUnitId, player.id);
    assert.equal(scene.inputEnabled, true);
    assert.equal(scene.currentAction, null);
    assert.equal(scene.inEnemySequence, false);
    assert.equal(player.hp, 42);
  });

  it('unlocks from turn_start before optional camera presentation', async () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    scene.game.localUserId = 1;
    scene.ui = {
      updateTurnOrder() {},
      showTurnIndicator() {}
    };
    scene.recoverLocalTurn = payload => {
      scene.battleState.activeUnitId = payload.unitId;
      scene.applyAuthoritativeAvailability(payload.availableActions);
      scene.inputEnabled = true;
      return true;
    };

    await manager.processTurnStartEvent({
      type: 'turn_start',
      unitId: player.id,
      unitName: 'Player',
      unitType: 'player',
      position: null,
      availableActions: { canMove: true, canAct: true },
      stateRevision: 8
    });

    assert.equal(scene.inputEnabled, true);
    assert.equal(scene.battleState.activeUnitId, player.id);
    assert.equal(scene.canMove, true);
    assert.equal(scene.canAct, true);
  });

  it('ignores a reordered revisionless enemy turn_start after your_turn recovery', () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    scene.game.localUserId = 1;
    scene.battleState.activeUnitId = player.id;
    scene.inputEnabled = true;
    manager.lastYourTurnUnitId = player.id;
    manager.processTurnEventQueue = () => {};

    manager.handleRemoteTurnStart({
      unitId: 'old-enemy',
      unitName: 'Old Enemy',
      unitType: 'enemy'
    });

    assert.deepEqual(manager.turnEventQueue, []);
    assert.equal(scene.battleState.activeUnitId, player.id);
    assert.equal(scene.inputEnabled, true);
  });

  it('ignores a revisionless enemy turn_start queued before your_turn recovery', async () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    scene.game.localUserId = 1;
    scene.recoverLocalTurn = payload => {
      scene.battleState.activeUnitId = payload.unitId;
      scene.inputEnabled = true;
      return true;
    };
    const oldTurnStart = {
      type: 'turn_start',
      unitId: 'old-enemy',
      unitName: 'Old Enemy',
      unitType: 'enemy'
    };
    manager.turnEventQueue.push(oldTurnStart);

    manager.handleRemoteYourTurn({
      unitId: player.id,
      availableActions: { canMove: true, canAct: true }
    });
    await manager.processTurnStartEvent(manager.turnEventQueue.shift());

    assert.equal(scene.battleState.activeUnitId, player.id);
    assert.equal(scene.inputEnabled, true);
    assert.equal(scene.battleLogTurnCounter, 0);
  });

  it('does not relock after your_turn supersedes an in-flight camera transition', async () => {
    const player = createUnit('player');
    const enemy = createUnit('enemy', { type: 'enemy', ownerId: null });
    const { manager, scene } = createHarness([player, enemy]);
    scene.game.localUserId = 1;
    scene.battleState.activeUnitId = enemy.id;
    scene.ui = {
      updateTurnOrder() {},
      showTurnIndicator() {},
      showTargetInfo() {},
      setTargetSticky() {}
    };
    scene.grid.clearIntentHighlights = () => {};
    let finishCamera;
    let followTarget = null;
    scene.camera = {
      setFollowTarget(unit) {
        followTarget = unit;
      },
      startTurnTransition(_x, _y, callback) {
        finishCamera = callback;
      }
    };
    scene.recoverLocalTurn = payload => {
      scene.battleState.activeUnitId = payload.unitId;
      scene.inputEnabled = true;
      scene.inEnemySequence = false;
      return true;
    };

    const presentation = manager.processTurnStartEvent({
      type: 'turn_start',
      unitId: enemy.id,
      unitName: 'Enemy',
      unitType: 'enemy',
      position: { x: 1, y: 2 }
    });
    manager.handleRemoteYourTurn({
      unitId: player.id,
      availableActions: { canMove: true, canAct: true }
    });
    finishCamera();
    await presentation;

    assert.equal(scene.battleState.activeUnitId, player.id);
    assert.equal(scene.inputEnabled, true);
    assert.equal(scene.inEnemySequence, false);
    assert.equal(followTarget, player);
  });

  it('keeps distinct revisioned turns for the same fast unit', () => {
    const player = createUnit('player');
    const { manager } = createHarness([player]);
    manager.processTurnEventQueue = () => {};

    manager.queueTurnEvent({
      type: 'turn_start',
      unitId: player.id,
      stateRevision: 12
    });
    manager.queueTurnEvent({
      type: 'turn_start',
      unitId: player.id,
      stateRevision: 13
    });
    manager.queueTurnEvent({
      type: 'turn_start',
      unitId: player.id,
      stateRevision: 13
    });

    assert.deepEqual(
      manager.turnEventQueue.map(event => event.stateRevision),
      [12, 13]
    );
  });
});

describe('BattleWebSocketManager action presentation parity', () => {
  it('keeps enemy intent and movement logging map-version independent', async () => {
    const enemy = createUnit('enemy', { type: 'enemy', ownerId: null });
    const { manager, scene } = createHarness([enemy]);
    const highlights = [];
    const logs = [];
    const moves = [];
    scene.grid.showIntentHighlight = (...args) => highlights.push(args);
    scene.addBattleLogEntry = (...args) => logs.push(args);
    enemy.moveTo = (x, y) => moves.push({ x, y });

    await manager.processIntentHighlightEvent({
      unitId: enemy.id,
      highlightType: 'target_path',
      tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }],
      duration: 400
    });
    await manager.processUnitMovedEvent({
      unitId: enemy.id,
      from: { x: 1, y: 2 },
      to: { x: 3, y: 2 }
    });

    assert.deepEqual(highlights, [[
      'target_path',
      [{ x: 2, y: 2 }, { x: 3, y: 2 }],
      400
    ]]);
    assert.deepEqual(moves, [{ x: 3, y: 2 }]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], enemy);
    assert.equal(logs[0][1], 'move');
    assert.deepEqual(logs[0][3], {
      from: { x: 1, y: 2 },
      to: { x: 3, y: 2 }
    });
  });

  it('presents remote Zodiac actions lightly without generic action presentation', async (t) => {
    const actor = createUnit('caster');
    const target = createUnit('target', { teamId: 2 });
    const { manager, calls, scene } = createHarness([actor, target]);
    const logs = [];
    scene.addBattleLogEntry = (...args) => logs.push(args);
    const previousInfo = parchmentToast.info;
    parchmentToast.info = () => {};
    t.after(() => { parchmentToast.info = previousInfo; });

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'zodiac_ability',
      result: {
        abilityKey: 'dreamwave',
        abilityName: 'Dreamwave',
        targetId: target.id,
        message: 'Dreamwave activated',
        effects: [{ type: 'debuff', target: target.id, effect: 'sleep' }]
      }
    });

    assert.equal(calls.presentations.length, 0);
    assert.equal(calls.zodiacPresentations.length, 1);
    assert.equal(logs[0][1], 'zodiac_ability');
    assert.deepEqual(calls.waits, [600]);
  });

  it('uses the AoE center and applies damage/absorb feedback once per target', async () => {
    const actor = createUnit('caster', { teamId: 1 });
    const damaged = createUnit('damaged', { hp: 80, teamId: 2 });
    const absorbed = createUnit('absorbed', { hp: 50, teamId: 2 });
    const { manager, calls } = createHarness([actor, damaged, absorbed]);

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'skill',
      result: {
        skillId: 'firestorm',
        isAoE: true,
        targetId: damaged.id,
        damage: 30,
        aoeTiles: [{ x: 4, y: 5, isCenter: true }],
        aoeTargets: [
          { targetId: damaged.id, damage: 30 },
          { targetId: absorbed.id, healing: 10, isAbsorb: true }
        ]
      }
    });

    assert.equal(calls.presentations.length, 1);
    assert.equal(calls.presentations[0].target, null);
    assert.deepEqual(calls.presentations[0].targetTile, { x: 4, y: 5 });
    assert.equal(damaged.hp, 50);
    assert.equal(absorbed.hp, 60);
    assert.equal(calls.damage.length, 1);
    assert.equal(calls.healing.length, 1);
    assert.equal(calls.particles.length, 2);
  });

  it('uses result.targetTile for empty-tile observer presentations', async () => {
    const actor = createUnit('caster');
    const { manager, calls } = createHarness([actor]);

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'skill',
      result: {
        skillId: 'smoke_bomb',
        attackedEmptyTile: true,
        targetTile: { x: 7, y: 8 }
      }
    });

    assert.deepEqual(calls.presentations[0].targetTile, { x: 7, y: 8 });
  });

  it('shows canonical single-target skill outcomes and animates defeat', async () => {
    const actor = createUnit('caster');
    const target = createUnit('target', { hp: 20, teamId: 2 });
    const { manager, calls } = createHarness([actor, target]);

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'skill',
      result: {
        skillUsed: 'death_mark',
        targetId: target.id,
        damage: 25,
        skillEffects: [{ type: 'debuff', effect: 'marked', targetId: target.id }]
      }
    });

    assert.equal(target.hp, 0);
    assert.equal(target.calls.hit, 1);
    assert.equal(target.calls.death, 1);
    assert.deepEqual(calls.statuses.map(args => args[2]), ['MARKED']);
    assert.deepEqual(calls.statusSounds.map(args => args[0]), ['marked']);
  });

  it('applies healing and MP restoration exactly once', async () => {
    const actor = createUnit('caster', { hp: 40, mp: 10 });
    const { manager, calls } = createHarness([actor]);

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'skill',
      result: {
        skillUsed: 'meditation',
        targetId: actor.id,
        healing: 15,
        mpRestored: 20
      }
    });

    assert.equal(actor.hp, 55);
    assert.equal(actor.mp, 30);
    assert.equal(calls.healing.length, 1);
    assert.equal(calls.mp.length, 1);
  });
});

describe('BattleWebSocketManager authored action timing', () => {
  it('rounds an eight-frame attack duration up to the next millisecond', async () => {
    const actor = createUnit('fighter');
    const attackSprite = { frameCount: 8, frameRate: 12 };
    actor.animationState = 'attack';
    actor.animatedSprite = attackSprite;
    actor.spriteCache = { attack: attackSprite };
    const { manager, calls } = createHarness([actor]);

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'attack',
      result: {}
    });

    assert.deepEqual(calls.waits, [180, 667]);
  });

  it('waits for all frames of the selected cast animation', async () => {
    const actor = createUnit('caster');
    const castSprite = { frameCount: 8, frameRate: 10 };
    actor.animationState = 'cast';
    actor.animatedSprite = castSprite;
    actor.spriteCache = { cast: castSprite };
    const { manager, calls } = createHarness([actor]);

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'skill',
      result: { skillUsed: 'arcane_burst' }
    });

    assert.deepEqual(calls.waits, [180, 800]);
  });

  it('keeps the established queue wait when animation timing is unavailable', async () => {
    const actor = createUnit('fighter');
    const { manager, calls } = createHarness([actor]);

    await manager.processActionExecutedEvent({
      actorId: actor.id,
      actionType: 'attack',
      result: {}
    });

    assert.deepEqual(calls.waits, [180, 600]);
  });

  it('ignores a stale previous sprite and retains safe timing floors', () => {
    const idleSprite = { frameCount: 8, frameRate: 8 };
    const actor = {
      animationState: 'attack',
      animatedSprite: idleSprite,
      spriteCache: { idle: idleSprite }
    };

    assert.equal(getActorAnimationDurationMs(actor), null);
    assert.equal(getActionWaitDuration(null, 1200), 1200);
    assert.equal(getActionWaitDuration(800, 1200), 1200);
    assert.equal(getActionWaitDuration(800, 600), 800);
  });
});

describe('BattleWebSocketManager authoritative battle end recovery', () => {
  it('seeds state and immediately recovers an outcome missed before setup', async (t) => {
    const solePlayer = createUnit('sole-player', { hp: 10, teamId: 1 });
    const enemy = createUnit('enemy', { hp: 30, teamId: 2 });
    const { manager, scene } = createHarness([solePlayer, enemy]);
    const previousFetch = globalThis.fetch;
    const baselinesAtFetch = [];
    let fetchCount = 0;

    scene.battleId = 71;
    scene.battleState.activeUnitId = solePlayer.id;
    scene.game.api = { token: 'token', baseUrl: '/api' };
    scene.game.socket = {
      joinBattleRoom() {},
      leaveBattleRoom() {},
      on() { return () => {}; }
    };
    manager.processTurnEventQueue = () => {};

    globalThis.fetch = async () => {
      fetchCount++;
      baselinesAtFetch.push(structuredClone(manager.statePoller.localState));
      return {
        status: 200,
        ok: true,
        headers: { get() { return '"terminal"'; } },
        async json() {
          return {
            activeUnitId: null,
            turnCount: 4,
            status: 'defeat',
            rewards: null,
            units: [
              { id: solePlayer.id, x: 1, y: 2, hp: 0, mp: 20 },
              { id: enemy.id, x: 1, y: 2, hp: 30, mp: 20 }
            ]
          };
        }
      };
    };
    t.after(() => {
      manager.cleanup();
      globalThis.fetch = previousFetch;
    });

    manager.setup();
    await new Promise(resolve => globalThis.setImmediate(resolve));
    await new Promise(resolve => globalThis.setImmediate(resolve));

    assert.equal(fetchCount, 1, 'setup should poll without waiting for the interval');
    assert.equal(baselinesAtFetch[0].status, 'active');
    assert.equal(baselinesAtFetch[0].units[0].hp, 10);
    assert.equal(solePlayer.hp, 0);
    assert.deepEqual(manager.turnEventQueue.map(event => event.type), ['battle_end']);
    assert.equal(manager.turnEventQueue[0].status, 'defeat');
  });

  it('recovers a missed one-player defeat from polled server state', async () => {
    const solePlayer = createUnit('sole-player', { hp: 10, teamId: 1 });
    const enemy = createUnit('enemy', { hp: 30, teamId: 2 });
    const { manager, calls } = createHarness([solePlayer, enemy]);
    manager.processTurnEventQueue = () => {};

    manager.handleStateDrift({
      status: 'defeat',
      activeUnitId: null,
      turnCount: 4,
      units: [
        { id: solePlayer.id, x: 1, y: 2, hp: 0, mp: 20 },
        { id: enemy.id, x: 3, y: 2, hp: 30, mp: 20 }
      ]
    });

    assert.equal(solePlayer.hp, 0);
    assert.equal(solePlayer.calls.reconciled, 1);
    assert.equal(manager.battleState.status, 'defeat');
    assert.deepEqual(manager.turnEventQueue.map(event => event.type), ['battle_end']);

    const event = manager.turnEventQueue.shift();
    await manager.processSingleTurnEvent(event);
    assert.deepEqual(calls.battleEnds, [{ status: 'defeat', rewards: null }]);
    assert.deepEqual(calls.waits, [800]);

    manager.handleRemoteBattleEnd({ status: 'defeat', rewards: null });
    assert.equal(manager.turnEventQueue.length, 0, 'late WebSocket delivery must not queue a second outro');
  });

  it('queues a critical terminal drift only once while animations are active', () => {
    const player = createUnit('player');
    const { manager } = createHarness([player]);
    const critical = [];
    manager.scene.onCriticalDrift = (...args) => critical.push(args);
    manager.processTurnEventQueue = () => {};

    const serverState = { status: 'defeat', rewards: null };
    manager.handleCriticalDrift('status_changed', 'defeat', serverState);
    manager.handleCriticalDrift('status_changed', 'defeat', serverState);

    assert.equal(critical.length, 2, 'scene animation fast-forward notifications remain observable');
    assert.deepEqual(manager.turnEventQueue.map(event => event.type), ['battle_end']);
  });

  it('sends full-state sync requests through the socket type/payload contract', () => {
    const player = createUnit('player');
    const { manager } = createHarness([player]);
    const sent = [];
    manager.scene.battleId = 42;
    manager.scene.game.socket = {
      requestBattleSync(...args) { sent.push(args); }
    };

    manager.requestFullStateSync();

    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 42);
    assert.deepEqual(sent[0][1].supportedBattleMapSchemaVersions, [1, 2]);
    assert.deepEqual(sent[0][1].supportedMutableStateProtocolVersions, [1]);
  });

  it('allows a terminal outcome to be requeued after reconnect state clearing', () => {
    const player = createUnit('player');
    const { manager } = createHarness([player]);
    manager.processTurnEventQueue = () => {};

    assert.equal(manager.queueAuthoritativeBattleEnd('defeat'), true);
    assert.equal(manager.queueAuthoritativeBattleEnd('defeat'), false);
    assert.equal(manager.battleEndPending, true);

    manager.clearPendingActions();

    assert.equal(manager.turnEventQueue.length, 0);
    assert.equal(manager.battleEndPending, false);
    assert.equal(manager.queueAuthoritativeBattleEnd('defeat'), true);
    assert.deepEqual(manager.turnEventQueue.map(event => event.type), ['battle_end']);
  });

  it('defers a pending critical poll recovery while local presentation remains active', async () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    scene.stateRevision = 4;
    scene.battleState = {
      status: 'active',
      activeUnitId: player.id,
      turn: 4,
      turnCount: 4
    };
    scene.isActionSubmitting = true;
    const serverState = {
      stateRevision: 5,
      status: 'active',
      activeUnitId: player.id,
      turnCount: 5,
      units: [{
        id: player.id,
        x: 9,
        y: 8,
        hp: 40,
        mp: 12
      }]
    };
    const poller = {
      pendingFullSync: true,
      criticalOnly: true,
      localState: null,
      setLocalState(state) { this.localState = state; },
      setCriticalMode(enabled) {
        this.criticalOnly = enabled;
        if (!enabled && this.pendingFullSync) {
          this.pendingFullSync = false;
          manager.handleStateDrift(serverState);
        }
      }
    };
    manager.statePoller = poller;
    manager.processSingleTurnEventWithTimeout = async () => {};
    manager.turnEventQueue.push({ type: 'action_executed' });

    await manager.processTurnEventQueue();

    assert.equal(poller.criticalOnly, true,
      'queue drain must not release a pending full sync during local presentation');
    assert.equal(poller.pendingFullSync, true);
    assert.equal(player.gridX, 1);
    assert.equal(player.gridY, 2);
    assert.equal(scene.battleState.turn, 4);

    // An already in-flight poll can still complete while presentation is
    // active, and must use the same deferred application gate.
    poller.pendingFullSync = false;
    manager.handleStateDrift(serverState);
    assert.equal(manager.deferredPolledState, serverState);
    assert.equal(player.gridX, 1);

    scene.isActionSubmitting = false;
    assert.equal(manager.flushDeferredAuthoritativeState(), true);
    assert.equal(poller.criticalOnly, false);
    assert.equal(player.gridX, 9);
    assert.equal(player.gridY, 8);
    assert.equal(scene.battleState.turn, 5);
    assert.equal(scene.battleState.turnCount, 5);
    assert.equal(manager.deferredPolledState, null);
    assert.equal(poller.localState.turnCount, 5);
  });

  it('updates canonical turn state so poll recovery converges', () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    scene.stateRevision = 7;
    scene.battleState = {
      status: 'active',
      activeUnitId: player.id,
      turn: 2,
      turnCount: 2
    };
    const poller = new BattleStatePoller(74, () => {}, scene.game);
    manager.statePoller = poller;
    const serverState = {
      stateRevision: 7,
      status: 'active',
      activeUnitId: player.id,
      turnCount: 7,
      units: [{
        id: player.id,
        x: player.gridX,
        y: player.gridY,
        hp: player.hp,
        mp: player.mp
      }]
    };

    assert.equal(manager.handleStateDrift(serverState), true);
    assert.equal(scene.battleState.turn, 7);
    assert.equal(scene.battleState.turnCount, 7);
    assert.equal(poller.localState.turnCount, 7);
    assert.equal(poller.hasStateDrift(serverState), false);
  });

  it('keeps critical polling active when a deferred terminal state starts a new queue', async () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    scene.stateRevision = 1;
    scene.battleState = {
      status: 'active',
      activeUnitId: player.id,
      turn: 1,
      units: []
    };
    const criticalModes = [];
    manager.statePoller = {
      setCriticalMode(enabled) { criticalModes.push(enabled); },
      setLocalState() {}
    };
    let releaseTerminal;
    let markTerminalStarted;
    const terminalBlocked = new Promise(resolve => {
      releaseTerminal = resolve;
    });
    const terminalStarted = new Promise(resolve => {
      markTerminalStarted = resolve;
    });
    manager.processSingleTurnEventWithTimeout = async event => {
      if (event.type === 'battle_end') {
        markTerminalStarted();
        await terminalBlocked;
      }
    };
    manager.deferredAuthoritativeState = {
      nextState: {
        ...scene.battleState,
        status: 'defeat',
        stateRevision: 2
      },
      mapPatch: null,
      stateRevision: 2,
      availableActions: null
    };
    manager.turnEventQueue.push({ type: 'action_executed' });

    await manager.processTurnEventQueue();
    await terminalStarted;

    assert.equal(manager.isProcessingQueue, true);
    assert.equal(criticalModes.at(-1), true,
      'the completed queue must not disable critical mode for its successor');

    releaseTerminal();
    await new Promise(resolve => globalThis.setImmediate(resolve));
    assert.equal(manager.isProcessingQueue, false);
    assert.equal(criticalModes.at(-1), false);
  });
});

describe('BattleWebSocketManager revisioned state updates', () => {
  it('lets a deferred full terminal state supersede same-revision polling', async () => {
    clearBattleMapSessionCache();
    const map = await createMinimalBattleMapV2FinalFixture();
    const mutable = overrides => createBattleMutableStateV1({
      turn: 1,
      turnCount: 1,
      activeUnitId: 'enemy',
      status: 'active',
      units: [{ id: 'enemy', hp: 20, tileX: 0, tileY: 0 }],
      ...overrides
    });
    const session = new BattleMapSession();
    await session.acceptSnapshot(createBattleStateSnapshotV1({
      battleId: 85,
      stateRevision: 2,
      battleMap: map,
      mutableState: mutable()
    }));

    const enemy = createUnit('enemy', { hp: 20, type: 'enemy', ownerId: null });
    const { manager, scene } = createHarness([enemy]);
    let criticalNotifications = 0;
    let forceCompletions = 0;
    let polledApplications = 0;
    scene.battleId = 85;
    scene.mapSession = session;
    scene.battleState = session.state;
    scene.stateRevision = 2;
    scene.isActionSubmitting = true;
    scene.onCriticalDrift = () => {
      criticalNotifications++;
      scene.animations.forceComplete();
    };
    scene.animations.forceComplete = () => { forceCompletions++; };
    scene.onStateSync = () => { polledApplications++; };
    manager.processTurnEventQueue = () => {};

    const update = createBattleMutableStateUpdateV1({
      battleId: 85,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: map.diagnostics.hashes.fullHash,
      baseStateRevision: 2,
      stateRevision: 3,
      mutableState: mutable({
        turn: 2,
        turnCount: 2,
        status: 'defeat',
        activeUnitId: null,
        units: [{ id: 'enemy', hp: 0, tileX: 1, tileY: 0 }]
      })
    });
    const accepted = await manager.handleRemoteStateUpdate({
      battleId: 85,
      update
    });
    const criticalPoll = {
      stateRevision: 3,
      status: 'defeat',
      activeUnitId: null,
      turnCount: 2,
      units: [{ id: 'enemy', x: 1, y: 0, hp: 0, mp: enemy.mp }]
    };

    assert.equal(accepted.deferred, true);
    manager.handleStateDrift(criticalPoll);
    assert.equal(manager.deferredPolledState, criticalPoll);
    manager.handleCriticalDrift('status_changed', 'defeat', criticalPoll);

    assert.equal(criticalNotifications, 0);
    assert.equal(forceCompletions, 0);
    assert.equal(manager.battleEndPending, false);
    assert.equal(manager.turnEventQueue.length, 0);

    scene.isActionSubmitting = false;
    assert.equal(manager.flushDeferredAuthoritativeState(), true);
    assert.equal(scene.battleState.status, 'defeat');
    assert.equal(polledApplications, 0,
      'the equal-revision lightweight poll must not apply after full WS state');
    assert.deepEqual(manager.turnEventQueue.map(event => event.type), [
      'battle_end'
    ]);
  });

  it('keeps V2 scene reconciliation behind queued semantic presentation', async () => {
    clearBattleMapSessionCache();
    const map = await createMinimalBattleMapV2FinalFixture();
    const mutable = overrides => createBattleMutableStateV1({
      turn: 1,
      turnCount: 1,
      activeUnitId: 'enemy',
      units: [{ id: 'enemy', hp: 20, tileX: 0, tileY: 0 }],
      ...overrides
    });
    const session = new BattleMapSession();
    await session.acceptSnapshot(createBattleStateSnapshotV1({
      battleId: 87,
      stateRevision: 2,
      battleMap: map,
      mutableState: mutable()
    }));

    const enemy = createUnit('enemy', { hp: 20, type: 'enemy', ownerId: null });
    const { manager, scene } = createHarness([enemy]);
    const presentationOrder = [];
    let releaseFirstEvent;
    const firstEventBlocked = new Promise(resolve => {
      releaseFirstEvent = resolve;
    });
    scene.battleId = 87;
    scene.mapSession = session;
    scene.battleState = session.state;
    scene.stateRevision = 2;
    scene.syncUnitsWithState = () => presentationOrder.push('state_sync');
    manager.processSingleTurnEventWithTimeout = async event => {
      presentationOrder.push({
        turn_start: 'camera',
        intent_highlight: 'intent',
        unit_moved: 'move',
        action_executed: 'battle_log'
      }[event.type]);
      if (event.type === 'turn_start') await firstEventBlocked;
    };
    manager.turnEventQueue.push(
      { type: 'turn_start', unitId: 'enemy' },
      { type: 'intent_highlight', unitId: 'enemy' },
      { type: 'unit_moved', unitId: 'enemy' },
      { type: 'action_executed', actorId: 'enemy' }
    );

    const queueDrain = manager.processTurnEventQueue();
    await Promise.resolve();
    const update = createBattleMutableStateUpdateV1({
      battleId: 87,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: map.diagnostics.hashes.fullHash,
      baseStateRevision: 2,
      stateRevision: 3,
      mutableState: mutable({
        turn: 2,
        turnCount: 2,
        units: [{ id: 'enemy', hp: 20, tileX: 3, tileY: 2 }]
      })
    });

    const result = await manager.handleRemoteStateUpdate({
      battleId: 87,
      update
    });

    assert.equal(result.status, 'applied');
    assert.equal(result.deferred, true);
    assert.equal(session.current.stateRevision, 3,
      'the verified map session should advance immediately');
    assert.equal(scene.battleState.turn, 1,
      'the scene must stay at the presented revision while events are queued');
    assert.deepEqual(presentationOrder, ['camera']);

    releaseFirstEvent();
    await queueDrain;

    assert.deepEqual(presentationOrder, [
      'camera',
      'intent',
      'move',
      'battle_log',
      'state_sync'
    ]);
    assert.equal(scene.battleState.turn, 2);
    assert.equal(scene.stateRevision, 3);
    assert.equal(manager.deferredAuthoritativeState, null);
  });

  it('retains only the newest accepted update until local presentation ends', async () => {
    clearBattleMapSessionCache();
    const map = await createMinimalBattleMapV2FinalFixture();
    const mutable = turn => createBattleMutableStateV1({
      turn,
      turnCount: turn,
      units: [{ id: 'player', hp: 20, tileX: turn, tileY: 0 }]
    });
    const session = new BattleMapSession();
    await session.acceptSnapshot(createBattleStateSnapshotV1({
      battleId: 86,
      stateRevision: 2,
      battleMap: map,
      mutableState: mutable(1)
    }));

    const player = createUnit('player', { hp: 20 });
    const { manager, scene } = createHarness([player]);
    const synchronizedTurns = [];
    scene.battleId = 86;
    scene.mapSession = session;
    scene.battleState = session.state;
    scene.stateRevision = 2;
    scene.isActionSubmitting = true;
    scene.syncUnitsWithState = () => {
      synchronizedTurns.push(scene.battleState.turn);
    };

    for (const [baseStateRevision, stateRevision, turn] of [
      [2, 3, 2],
      [3, 4, 3]
    ]) {
      const update = createBattleMutableStateUpdateV1({
        battleId: 86,
        battleMapSchemaVersion: 2,
        terrainGenerationVersion: 2,
        fullHash: map.diagnostics.hashes.fullHash,
        baseStateRevision,
        stateRevision,
        mutableState: mutable(turn)
      });
      const result = await manager.handleRemoteStateUpdate({
        battleId: 86,
        update
      });
      assert.equal(result.deferred, true);
    }

    assert.equal(session.current.stateRevision, 4);
    assert.equal(scene.battleState.turn, 1);
    manager.handleStateDrift({
      stateRevision: 3,
      status: 'defeat',
      turnCount: 2,
      units: []
    });
    assert.equal(manager.deferredPolledState, null,
      'a lightweight poll cannot supersede the accepted map session');
    assert.equal(manager.battleEndPending, false,
      'a stale polled terminal state must not queue battle end');
    const staleSnapshot = createBattleStateSnapshotV1({
      battleId: 86,
      stateRevision: 3,
      battleMap: map,
      mutableState: mutable(2)
    });
    assert.deepEqual(
      await manager.handleRemoteStateUpdate({
        battleId: 86,
        snapshot: staleSnapshot
      }),
      { status: 'duplicate', reason: 'stale_revision' }
    );
    assert.equal(session.current.stateRevision, 4,
      'a reordered snapshot cannot roll back the accepted session');
    assert.equal(manager.flushDeferredAuthoritativeState(), false,
      'a caller cannot flush while local presentation is still active');

    scene.isActionSubmitting = false;
    assert.equal(manager.flushDeferredAuthoritativeState(), true);
    assert.equal(scene.battleState.turn, 3);
    assert.equal(scene.stateRevision, 4);
    assert.deepEqual(synchronizedTurns, [3]);

    scene.isActionSubmitting = true;
    manager.deferredAuthoritativeState = { nextState: { turn: 99 } };
    manager.cleanup();
    assert.equal(manager.deferredAuthoritativeState, null);
  });

  it('uses canonical battle state turns for the poller baseline', () => {
    const player = createUnit('player');
    const { manager, scene } = createHarness([player]);
    let baseline;
    manager.statePoller = {
      setLocalState(state) { baseline = state; },
      stop() {}
    };
    scene.battleLogTurnCounter = 99;
    scene.battleState = {
      status: 'active',
      activeUnitId: player.id,
      turn: 7,
      turnCount: 3
    };

    manager.updatePollerState();
    assert.equal(baseline.turnCount, 7);

    delete scene.battleState.turn;
    manager.updatePollerState();
    assert.equal(baseline.turnCount, 3);
  });

  it('applies an ordered update once and recovers from gaps and map mismatches', async () => {
    clearBattleMapSessionCache();
    const map = await createMinimalBattleMapV2FinalFixture();
    const mutable = overrides => createBattleMutableStateV1({
      units: [{ id: 'player', hp: 20, tileX: 0, tileY: 0 }],
      ...overrides
    });
    const session = new BattleMapSession();
    await session.acceptSnapshot(createBattleStateSnapshotV1({
      battleId: 88,
      stateRevision: 2,
      battleMap: map,
      mutableState: mutable({ turn: 1 })
    }));

    const unit = createUnit('player', { hp: 20 });
    const { manager, scene } = createHarness([unit]);
    const synced = [];
    const syncRequests = [];
    scene.battleId = 88;
    scene.mapSession = session;
    scene.battleState = session.state;
    scene.syncUnitsWithState = units => synced.push(units);
    scene.grid = {
      setTerrain() {},
      setElevation() {},
      setTileVariants() {},
      setObstacles() {},
      setElevationConnections() {},
      setTransitions() {},
      setDecorations() {}
    };
    scene.game.socket = {
      requestBattleSync(...args) { syncRequests.push(args); }
    };

    const update = createBattleMutableStateUpdateV1({
      battleId: 88,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: map.diagnostics.hashes.fullHash,
      baseStateRevision: 2,
      stateRevision: 3,
      mutableState: mutable({ turn: 2 })
    });

    assert.equal((await manager.handleRemoteStateUpdate({ battleId: 88, update })).status, 'applied');
    assert.equal(manager.battleState.turn, 2);
    assert.equal(synced.length, 1);
    assert.equal((await manager.handleRemoteStateUpdate({ battleId: 88, update })).status, 'duplicate');
    assert.equal(synced.length, 1);

    const gap = createBattleMutableStateUpdateV1({
      battleId: 88,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: map.diagnostics.hashes.fullHash,
      baseStateRevision: 4,
      stateRevision: 5,
      mutableState: mutable({ turn: 3 })
    });
    const result = await manager.handleRemoteStateUpdate({ battleId: 88, update: gap });

    assert.equal(result.reason, 'revision_gap');
    assert.equal(syncRequests.length, 1);
    assert.equal(syncRequests[0][0], 88);
    assert.equal(syncRequests[0][1].cachedMaps.length, 1);
    assert.equal(manager.battleState.turn, 2);

    const wrongMap = createBattleMutableStateUpdateV1({
      battleId: 88,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: `sha256:${'f'.repeat(64)}`,
      baseStateRevision: 3,
      stateRevision: 4,
      mutableState: mutable({ turn: 4 })
    });
    const mismatchResult = await manager.handleRemoteStateUpdate({
      battleId: 88,
      update: wrongMap
    });

    assert.equal(mismatchResult.reason, 'map_reference_mismatch');
    assert.equal(syncRequests.length, 2);
    assert.equal(syncRequests[1][1].cachedMaps.length, 0);
    assert.equal(manager.battleState.turn, 2);
  });

  it('rejects a stale full snapshot before mutating the map session', async () => {
    clearBattleMapSessionCache();
    const map = await createMinimalBattleMapV2FinalFixture();
    const session = new BattleMapSession();
    await session.acceptSnapshot(createBattleStateSnapshotV1({
      battleId: 89,
      stateRevision: 10,
      battleMap: map,
      mutableState: createBattleMutableStateV1({
        turn: 10,
        units: [{ id: 'player', hp: 20, tileX: 0, tileY: 0 }]
      })
    }));

    const player = createUnit('player', { hp: 20 });
    const { manager, scene } = createHarness([player]);
    let synchronized = 0;
    scene.stateRevision = 10;
    scene.mapSession = session;
    scene.battleState = session.state;
    scene.syncUnitsWithState = () => { synchronized++; };

    const staleSnapshot = createBattleStateSnapshotV1({
      battleId: 89,
      stateRevision: 8,
      battleMap: map,
      mutableState: createBattleMutableStateV1({
        turn: 8,
        units: [{ id: 'player', hp: 1, tileX: 4, tileY: 4 }]
      })
    });
    const result = await manager.handleRemoteStateUpdate({
      battleId: 89,
      snapshot: staleSnapshot
    });

    assert.equal(result.status, 'duplicate');
    assert.equal(result.reason, 'stale_revision');
    assert.equal(session.current.stateRevision, 10);
    assert.equal(session.state.turn, 10);
    assert.equal(synchronized, 0);
  });

  it('sends BattleMap capabilities on the rejoin HTTP request', async (t) => {
    clearBattleMapSessionCache();
    const { manager, scene } = createHarness([]);
    let request = null;
    scene.battleId = 91;
    scene.mapSession = new BattleMapSession();
    scene.game.api = {
      async get(path, options) {
        request = { path, options };
        return { success: false };
      }
    };

    const previousInfo = parchmentToast.info;
    parchmentToast.info = () => {};
    t.after(() => {
      parchmentToast.info = previousInfo;
    });

    assert.equal(await manager.attemptRejoin(), false);
    assert.equal(request.path, '/battle/91/rejoin');
    const capabilities = JSON.parse(
      request.options.headers['x-battle-map-capabilities']
    );
    assert.deepEqual(capabilities.supportedBattleMapSchemaVersions, [1, 2]);
    assert.deepEqual(capabilities.supportedHashVersions, ['sha256-cjson-v1']);
    assert.deepEqual(capabilities.supportedMutableStateProtocolVersions, [1]);
    assert.deepEqual(capabilities.cachedMaps, []);
  });

  it('does not hydrate or apply a rejoin snapshot older than WebSocket state', async (t) => {
    const player = createUnit('player', { hp: 80 });
    const { manager, scene } = createHarness([player]);
    let hydrateCount = 0;
    scene.battleId = 92;
    scene.stateRevision = 6;
    scene.inputEnabled = true;
    scene.serverAvailableActions = {
      canMove: true,
      canAct: false,
      canWait: true
    };
    scene.battleState = {
      status: 'active',
      activeUnitId: player.id,
      stateRevision: 6,
      units: [{ id: player.id, hp: 80 }]
    };
    scene.mapSession = {
      capabilities: {},
      getCapabilities() {
        return {};
      },
      async hydrateResponse(response) {
        hydrateCount++;
        return response;
      }
    };
    scene.game.api = {
      async get() {
        return {
          success: true,
          stateRevision: 5,
          state: {
            status: 'active',
            activeUnitId: player.id,
            units: [{ id: player.id, hp: 10 }]
          }
        };
      }
    };
    const syncRequests = [];
    scene.game.socket = {
      joinBattleRoom() {},
      requestBattleSync(...args) {
        syncRequests.push(args);
      }
    };
    scene.recoverLocalTurn = payload => {
      scene.battleState.activeUnitId = payload.unitId;
      scene.applyAuthoritativeAvailability(payload.availableActions);
      scene.inputEnabled = true;
      return true;
    };
    let pollCount = 0;
    manager.statePoller = {
      poll() {
        pollCount++;
      },
      setLocalState() {}
    };

    const previousInfo = parchmentToast.info;
    const previousSuccess = parchmentToast.success;
    parchmentToast.info = () => {};
    parchmentToast.success = () => {};
    t.after(() => {
      parchmentToast.info = previousInfo;
      parchmentToast.success = previousSuccess;
    });

    assert.equal(await manager.attemptRejoin(), true);
    assert.equal(hydrateCount, 0);
    assert.equal(manager.battleState.stateRevision, 6);
    assert.equal(player.hp, 80);
    assert.equal(scene.inputEnabled, true);
    assert.equal(manager.lastYourTurnUnitId, player.id);
    assert.equal(syncRequests.length, 1);
    assert.equal(syncRequests[0][2], 'stale_rejoin_snapshot');
    assert.equal(pollCount, 1);
  });
});
