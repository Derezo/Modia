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

function createUnit(id, { hp = 100, maxHp = 100, mp = 20, maxMp = 100, teamId = 1 } = {}) {
  const calls = { hit: 0, death: 0, reconciled: 0, thinking: [] };
  return {
    id,
    name: id,
    hp,
    maxHp,
    mp,
    maxMp,
    teamId,
    screenX: 100,
    screenY: 120,
    gridX: 1,
    gridY: 2,
    calls,
    setThinking(value) { calls.thinking.push(value); },
    playHitAnimation() { calls.hit++; },
    playDeathAnimation() { calls.death++; },
    reconcileAnimationWithHealth() { calls.reconciled++; },
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
    async waitForAnimation(duration) { calls.waits.push(duration); },
    handleBattleEnd(status, rewards) {
      calls.battleEnds.push({ status, rewards });
      this.battleEnded = true;
    }
  };
  return { manager: new BattleWebSocketManager(scene), scene, calls };
}

describe('BattleWebSocketManager action presentation parity', () => {
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
    manager.scene.game.socket = { send(...args) { sent.push(args); } };

    manager.requestFullStateSync();

    assert.deepEqual(sent, [['battle:request_sync', { battleId: 42 }]]);
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
});
