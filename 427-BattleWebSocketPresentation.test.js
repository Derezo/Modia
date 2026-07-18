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

const { BattleWebSocketManager } = await import('../BattleWebSocketManager.js');

function createUnit(id, { hp = 100, maxHp = 100, mp = 20, maxMp = 100, teamId = 1 } = {}) {
  const calls = { hit: 0, death: 0, thinking: [] };
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
    statusSounds: []
  };
  const scene = {
    game: {},
    units: new Map(units.map(unit => [unit.id, unit])),
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
    async waitForAnimation(duration) { calls.waits.push(duration); }
  };
  return { manager: new BattleWebSocketManager(scene), calls };
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
