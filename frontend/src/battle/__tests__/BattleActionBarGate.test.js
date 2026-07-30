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
  value: globalThis.navigator || { maxTouchPoints: 0 }
});
globalThis.document ??= {
  createElement() {
    let text = '';
    return {
      style: {},
      classList: { add() {}, remove() {} },
      set textContent(value) { text = String(value); },
      get textContent() { return text; },
      get innerHTML() {
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
    };
  },
  head: { appendChild() {} }
};

const { BattleActionBar } = await import('../BattleActionBar.js');

describe('BattleActionBar authoritative gate delegation', () => {
  it('renders a dedicated escaped Zodiac dropdown with canonical icons', () => {
    const bar = new BattleActionBar({});
    const container = {
      innerHTML: '',
      querySelectorAll() { return []; }
    };
    bar.callbacks = {
      getZodiacAbilities: () => [{
        key: 'dreamwave',
        name: 'Dreamwave <unsafe>',
        description: 'Sleep <img src=x>'
      }]
    };

    assert.match(bar.generateHTML(), /data-action="zodiac"/);
    assert.match(bar.generateHTML(), /id="zodiac-dropdown"/);
    bar.populateZodiacList(container);
    assert.match(container.innerHTML, /\/assets\/abilities\/icons\/zodiac\/dreamwave\.webp/);
    assert.match(container.innerHTML, /Dreamwave &lt;unsafe&gt;/);
    assert.doesNotMatch(container.innerHTML, /Sleep <img/);
  });

  it('routes Z through the same authoritative Zodiac gate', () => {
    const calls = [];
    const bar = new BattleActionBar({});
    bar.isVisible = true;
    bar.callbacks = {
      canUseAction(action) {
        calls.push(['gate', action]);
        return false;
      }
    };
    bar.closeDropdown = () => calls.push(['closed']);

    bar.handleKeydown({
      key: 'z',
      preventDefault() { calls.push(['prevented']); }
    });

    assert.deepEqual(calls, [
      ['prevented'],
      ['gate', 'zodiac'],
      ['closed']
    ]);
  });

  it('navigates and activates Zodiac choices by keyboard', () => {
    const calls = [];
    const bar = new BattleActionBar({});
    const first = {
      focus() { document.activeElement = this; },
      click() { calls.push('first'); }
    };
    const second = {
      focus() { document.activeElement = this; },
      click() { calls.push('second'); }
    };
    bar.isVisible = true;
    bar.activeDropdown = 'zodiac';
    bar.element = {
      querySelectorAll() { return [first, second]; }
    };
    document.activeElement = first;

    bar.handleKeydown({
      key: 'ArrowDown',
      preventDefault() { calls.push('arrow-prevented'); }
    });
    bar.handleKeydown({
      key: 'Enter',
      preventDefault() { calls.push('enter-prevented'); }
    });

    assert.equal(document.activeElement, second);
    assert.deepEqual(calls, [
      'arrow-prevented',
      'enter-prevented',
      'second'
    ]);
  });

  it('delegates button clicks instead of trusting stale private booleans', () => {
    const calls = [];
    const bar = new BattleActionBar({});
    bar.canAct = false;
    bar.callbacks = {
      canUseAction(action) {
        calls.push(['gate', action]);
        return true;
      },
      onAttack() {
        calls.push(['attack']);
      }
    };

    assert.equal(bar.handleActionClick('attack'), true);
    assert.deepEqual(calls, [['gate', 'attack'], ['attack']]);
  });

  it('routes keyboard shortcuts through the same gate and blocks callbacks', () => {
    const calls = [];
    const bar = new BattleActionBar({});
    bar.isVisible = true;
    bar.canAct = true;
    bar.closeDropdown = () => calls.push(['closed']);
    bar.callbacks = {
      canUseAction(action) {
        calls.push(['gate', action]);
        return false;
      },
      onSkillSelect() {
        calls.push(['skill']);
      }
    };
    const event = {
      key: 's',
      preventDefault() {
        calls.push(['prevented']);
      }
    };

    bar.handleKeydown(event);

    assert.deepEqual(calls, [
      ['prevented'],
      ['gate', 'skill'],
      ['closed']
    ]);
  });
});
