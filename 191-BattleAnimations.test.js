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

const { BattleAnimations, withColorAlpha } = await import('../BattleAnimations.js');
const { SKILL_EFFECT_CATEGORIES } = await import('../SkillEffectCategories.js');

function createCanvasContext({ rejectColor = null } = {}) {
  const colorStops = [];
  const calls = {
    fills: 0,
    restores: 0,
    saves: 0
  };

  return {
    colorStops,
    calls,
    save() { calls.saves++; },
    restore() { calls.restores++; },
    beginPath() {},
    arc() {},
    fill() { calls.fills++; },
    createRadialGradient() {
      return {
        addColorStop(offset, color) {
          if (rejectColor?.(color)) {
            throw new DOMException('Invalid color');
          }
          colorStops.push({ offset, color });
        }
      };
    },
    set fillStyle(_value) {},
    set globalAlpha(_value) {}
  };
}

describe('BattleAnimations skill action effects', () => {
  it('resolves a projectile into exactly one impact', () => {
    const animations = new BattleAnimations();
    const impacts = [];
    animations.addSkillEffect = (...args) => impacts.push(args);

    animations.addSkillActionEffect(10, 20, 90, 100, {
      category: 'fire',
      projectile: true,
      selfTarget: false,
      trailEnabled: true,
      primaryColor: '#ff4400'
    }, { id: 'fireball' });

    assert.equal(animations.animations.filter(anim => anim.type === 'skill_projectile').length, 1);
    animations.update(321);
    animations.update(1000);

    assert.equal(impacts.length, 1);
    assert.deepEqual(impacts[0].slice(0, 3), [90, 100, 'fire']);
    assert.equal(animations.animations.some(anim => anim.type === 'skill_projectile'), false);
  });

  it('uses one direct impact for non-projectile skills', () => {
    const animations = new BattleAnimations();
    const impacts = [];
    animations.addSkillEffect = (...args) => impacts.push(args);

    animations.addSkillActionEffect(10, 20, 30, 40, {
      category: 'buff',
      projectile: false,
      selfTarget: false
    });

    assert.equal(impacts.length, 1);
    assert.deepEqual(impacts[0].slice(0, 3), [30, 40, 'buff']);
    assert.equal(animations.animations.length, 0);
  });

  it('uses an aura without also scheduling an impact for self-targeted skills', () => {
    const animations = new BattleAnimations();
    const auras = [];
    const impacts = [];
    animations.addSelfAuraEffect = (...args) => auras.push(args);
    animations.addSkillEffect = (...args) => impacts.push(args);

    animations.addSkillActionEffect(10, 20, 10, 20, {
      category: 'selfAura',
      projectile: false,
      selfTarget: true
    });

    assert.deepEqual(auras, [[10, 20, 'selfAura']]);
    assert.deepEqual(impacts, []);
  });
});

describe('BattleAnimations glow rendering', () => {
  it('renders the Lightning rgba glow with a valid midpoint alpha', () => {
    const animations = new BattleAnimations();
    const ctx = createCanvasContext();

    animations.addGlow(20, 30, SKILL_EFFECT_CATEGORIES.lightning.glowColor, 40);
    animations.render(ctx);

    assert.deepEqual(ctx.colorStops, [
      { offset: 0, color: 'rgba(255, 255, 68, 0.5)' },
      { offset: 0.5, color: 'rgba(255, 255, 68, 0.3)' },
      { offset: 1, color: 'transparent' }
    ]);
    assert.equal(ctx.calls.fills, 1);
    assert.equal(ctx.calls.saves, ctx.calls.restores);
  });

  it('applies alpha to rgb and short, long, and alpha hex colors', () => {
    assert.equal(withColorAlpha('rgb(10, 20, 30)', 0.3), 'rgba(10, 20, 30, 0.3)');
    assert.equal(withColorAlpha('#0af', 0.3), 'rgba(0, 170, 255, 0.3)');
    assert.equal(withColorAlpha('#00aaff', 0.3), 'rgba(0, 170, 255, 0.3)');
    assert.equal(withColorAlpha('#0af8', 0.3), 'rgba(0, 170, 255, 0.3)');
    assert.equal(withColorAlpha('#00aaff88', 0.3), 'rgba(0, 170, 255, 0.3)');
  });

  it('isolates a malformed animation and restores context before rendering the next one', () => {
    const animations = new BattleAnimations();
    const ctx = createCanvasContext({ rejectColor: color => color === 'invalid-color' });
    const errors = [];
    const originalError = console.error;

    animations.addGlow(20, 30, 'invalid-color', 40);
    animations.addBurstParticle(20, 30, 0, '#ffffff');
    console.error = (...args) => errors.push(args);

    try {
      assert.doesNotThrow(() => animations.render(ctx));
    } finally {
      console.error = originalError;
    }

    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /Failed to render glow animation/);
    assert.equal(animations.animations[0].timer, animations.animations[0].duration);
    assert.equal(ctx.calls.fills, 1, 'the particle after the invalid glow still renders');
    assert.equal(ctx.calls.saves, 2);
    assert.equal(ctx.calls.restores, 2);
  });
});
