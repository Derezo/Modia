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
  value: { maxTouchPoints: 0 }
});
globalThis.document = {
  createElement() { return { id: '', textContent: '' }; },
  head: { appendChild() {} }
};

const { BattleUnit, VERTICAL_STRIP_GROUND_INSET } = await import('../BattleUnit.js');

function animationHarness(spriteCache = {}) {
  const unit = Object.create(BattleUnit.prototype);
  const stateChanges = [];
  unit.spriteCache = spriteCache;
  unit.assetLoader = null;
  unit.animationState = 'idle';
  unit.faceToward = () => {};
  unit.getSpriteForAnimation = () => null;
  unit.setAnimationState = (state, force = false) => {
    unit.animationState = state;
    stateChanges.push({ state, force });
  };
  return { unit, stateChanges };
}

describe('BattleUnit authored action fallbacks', () => {
  it('falls back from cast to attack when only the attack strip exists', () => {
    const { unit, stateChanges } = animationHarness({ attack: {} });

    unit.playCastAnimation(2, 3);

    assert.deepEqual(stateChanges, [{ state: 'attack', force: false }]);
  });

  it('selects an authored cast strip before the attack fallback', () => {
    const { unit, stateChanges } = animationHarness({ cast: {}, attack: {} });

    unit.playCastAnimation(2, 3);

    assert.deepEqual(stateChanges, [{ state: 'cast', force: false }]);
  });

  it('normalizes a survivor to idle when no victory strip exists', () => {
    const { unit, stateChanges } = animationHarness();
    unit.animationState = 'cast';

    assert.equal(unit.playVictoryAnimation(), false);
    assert.deepEqual(stateChanges, [{ state: 'idle', force: true }]);
  });

  it('selects an authored victory strip when available', () => {
    const { unit, stateChanges } = animationHarness({ victory: {} });

    assert.equal(unit.playVictoryAnimation(), true);
    assert.deepEqual(stateChanges, [{ state: 'victory', force: false }]);
  });
});

describe('BattleUnit strip presentation', () => {
  it('uses the shared two-second cadence for vertical-strip idle poses', () => {
    const unit = Object.create(BattleUnit.prototype);
    unit.direction = 0;

    const idle = unit.createAnimatedSprite({ width: 64, height: 512 }, 'idle');
    const walk = unit.createAnimatedSprite({ width: 64, height: 512 }, 'walk');

    assert.equal(idle.frameRate, 0.5);
    assert.equal(idle.frameCount, 8);
    assert.equal(walk.frameRate, 12);
  });

  it('grounds canonical vertical strips without shifting legacy layouts', () => {
    function renderBottom(layout) {
      const unit = Object.create(BattleUnit.prototype);
      const drawCalls = [];
      Object.assign(unit, {
        screenX: 30,
        screenY: 80,
        teamId: 1,
        isSelected: false,
        isTargeted: false,
        isMoving: false,
        isCharging: false,
        isThinking: false,
        statusEffects: [],
        traits: [],
        animatedSprite: {
          spriteSheet: {},
          layout,
          draw(_ctx, x, y) { drawCalls.push({ x, y }); }
        },
        isAlive() { return true; },
        renderHPBar() {}
      });
      const ctx = {
        beginPath() {},
        ellipse() {},
        fill() {},
        restore() {},
        save() {},
        setLineDash() {},
        stroke() {}
      };

      unit.render(ctx, null, 1);
      return drawCalls[0];
    }

    assert.equal(VERTICAL_STRIP_GROUND_INSET, 4);
    assert.deepEqual(renderBottom('vertical-strip'), { x: 30, y: 84 });
    assert.deepEqual(renderBottom('directional-grid'), { x: 30, y: 80 });
  });
});

describe('BattleUnit canonical NPC identity', () => {
  const grid = {
    gridToScreenWorld(x, y) { return { x, y }; },
    getElevation() { return 0; }
  };

  function enemyUnit(overrides = {}) {
    return new BattleUnit({
      id: 'enemy_1',
      type: 'enemy',
      name: 'Test NPC',
      class: 'monster',
      hp: 10,
      maxHp: 10,
      tileX: 1,
      tileY: 2,
      ...overrides
    }, grid);
  }

  it('renders from nested visual identity instead of encounter-zone aliases', () => {
    const unit = enemyUnit({
      enemyId: 'wrong_legacy_id',
      biome: 'mountain',
      visualIdentity: {
        kind: 'npc',
        visualId: 'guildmaster_wizard',
        primaryBiome: 'guild'
      }
    });
    const calls = [];
    unit.assetLoader = {
      getEnemySprite(...args) {
        calls.push(args);
        return { width: 64, height: 512 };
      }
    };

    unit.getSpriteForAnimation('attack');

    assert.equal(unit.enemyId, 'guildmaster_wizard');
    assert.equal(unit.biome, 'mountain', 'encounter biome remains available');
    assert.equal(unit.primaryBiome, 'guild');
    assert.deepEqual(calls, [['guildmaster_wizard', 'attack', 'guild']]);
  });

  it('backfills canonical homes for persisted legacy battle units', () => {
    const unit = enemyUnit({
      sprite_id: 'dark_knight',
      biome: 'castle'
    });

    assert.equal(unit.enemyId, 'dark_knight');
    assert.equal(unit.primaryBiome, 'palace');
  });
});

describe('BattleUnit canonical player identity', () => {
  const grid = {
    gridToScreenWorld(x, y) { return { x, y }; },
    getElevation() { return 0; }
  };

  it('uses the nested DTO when legacy aliases disagree', () => {
    const unit = new BattleUnit({
      id: 2,
      type: 'player',
      name: 'Gloin',
      race: 'human',
      gender: 'male',
      class: 'warrior',
      visualIdentity: {
        kind: 'player',
        id: 2,
        race: 'dwarf',
        gender: 'other',
        class: 'monk'
      },
      hp: 10,
      maxHp: 10,
      tileX: 1,
      tileY: 2
    }, grid);
    const calls = [];
    unit.assetLoader = {
      getCharacterSprite(...args) {
        calls.push(args);
        return { width: 64, height: 512 };
      }
    };

    unit.getSpriteForAnimation('idle');

    assert.equal(unit.race, 'dwarf');
    assert.equal(unit.gender, 'other');
    assert.equal(unit.class, 'monk');
    assert.deepEqual(calls, [[{
      race: 'dwarf',
      gender: 'other',
      class: 'monk'
    }, 'idle', 'player']]);
  });
});

describe('BattleUnit defeated-state hydration', () => {
  const grid = {
    gridToScreenWorld(x, y) { return { x, y }; },
    getElevation() { return 0; }
  };
  const spriteSheet = { width: 64, height: 512 };
  const assetLoader = {
    getEnemySprite() { return spriteSheet; }
  };

  function enemyUnit(hp = 10) {
    return new BattleUnit({
      id: 'enemy_defeated_state',
      type: 'enemy',
      name: 'Snapshot Enemy',
      class: 'monster',
      enemyId: 'goblin',
      biome: 'forest',
      hp,
      maxHp: 10,
      tileX: 1,
      tileY: 2
    }, grid);
  }

  it('holds the terminal frame when a defeated unit is hydrated or reinitialized', () => {
    const unit = enemyUnit(0);
    let assetsReady = false;
    const lateAssetLoader = {
      getEnemySprite() { return assetsReady ? spriteSheet : null; }
    };

    // BattleScene constructs units before its asynchronous preload completes.
    unit.setAssetLoader(lateAssetLoader);
    assert.equal(unit.animationState, 'dead');
    assert.equal(unit.animatedSprite, null);

    assetsReady = true;
    unit.initializeSprites();
    assert.equal(unit.animationState, 'dead');
    assert.equal(unit.animatedSprite, unit.spriteCache.dead);
    assert.equal(unit.animatedSprite.currentFrame, 7);
    assert.equal(unit.animatedSprite.isPlaying(), false);
  });

  it('repairs a stale live pose after an authoritative defeated-state sync', () => {
    const unit = enemyUnit();
    unit.setAssetLoader(assetLoader);
    assert.equal(unit.animationState, 'idle');

    unit.hp = 0;
    unit.reconcileAnimationWithHealth();

    assert.equal(unit.animationState, 'dead');
    assert.equal(unit.animatedSprite.currentFrame, 7);
    assert.equal(unit.animatedSprite.isPlaying(), false);
  });

  it('allows an active death transition to finish before holding the corpse pose', () => {
    const unit = enemyUnit();
    unit.setAssetLoader(assetLoader);
    unit.hp = 0;
    unit.playDeathAnimation();
    const activeDeathSprite = unit.animatedSprite;

    unit.reconcileAnimationWithHealth();
    assert.equal(unit.animationState, 'death');
    assert.equal(unit.animatedSprite, activeDeathSprite);
    assert.equal(unit.animatedSprite.isPlaying(), true);

    unit.onAnimationComplete('death');
    assert.equal(unit.animationState, 'dead');
    assert.equal(unit.animatedSprite.currentFrame, 7);
    assert.equal(unit.animatedSprite.isPlaying(), false);
  });

  it('returns a revived unit from its corpse pose to idle', () => {
    const unit = enemyUnit(0);
    unit.setAssetLoader(assetLoader);
    unit.hp = 5;

    unit.reconcileAnimationWithHealth();

    assert.equal(unit.animationState, 'idle');
    assert.equal(unit.animatedSprite, unit.spriteCache.idle);
    assert.equal(unit.animatedSprite.isPlaying(), true);
  });
});
