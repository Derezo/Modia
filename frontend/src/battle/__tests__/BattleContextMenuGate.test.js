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
  getElementById() { return null; },
  head: { appendChild() {} }
};

const { BattleContextMenu } = await import('../BattleContextMenu.js');

describe('BattleContextMenu authoritative gate delegation', () => {
  it('renders a separately gated Zodiac submenu with escaped AbilityIcon markup', () => {
    const menu = new BattleContextMenu({});
    menu.callbacks = {
      canUseAction(action) {
        return action === 'zodiac';
      },
      getZodiacAbilities: () => [{
        key: 'venom_sting',
        name: 'Venom <Sting>'
      }]
    };

    const menuHtml = menu.generateMenuHTML();
    const submenuHtml = menu.generateZodiacSubmenuHTML();

    assert.match(menuHtml, /data-action="zodiac"/);
    assert.match(menuHtml, /data-action="zodiac"[^]*item-key">Z</);
    assert.match(submenuHtml, /\/assets\/abilities\/icons\/zodiac\/venom_sting\.webp/);
    assert.match(submenuHtml, /Venom &lt;Sting&gt;/);
    assert.match(submenuHtml, /<button[^>]+role="menuitem"/);
  });

  it('navigates and activates Zodiac submenu choices by keyboard', () => {
    const calls = [];
    const menu = new BattleContextMenu({});
    const first = {
      focus() { document.activeElement = this; },
      click() { calls.push('first'); }
    };
    const second = {
      focus() { document.activeElement = this; },
      click() { calls.push('second'); }
    };
    menu.isVisible = true;
    menu.submenuOpen = true;
    menu.submenuType = 'zodiac';
    menu.submenuElement = {
      querySelectorAll() { return [first, second]; }
    };
    document.activeElement = first;

    menu.handleKeydown({
      key: 'ArrowDown',
      preventDefault() { calls.push('arrow-prevented'); }
    });
    menu.handleKeydown({
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

  it('executes a server-authorized click despite stale private booleans', () => {
    const calls = [];
    const menu = new BattleContextMenu({});
    menu.canAct = false;
    menu.hide = () => calls.push(['hidden']);
    menu.callbacks = {
      canUseAction(action) {
        calls.push(['gate', action]);
        return true;
      },
      onAttack() {
        calls.push(['attack']);
      }
    };

    assert.equal(menu.handleActionClick('attack'), true);
    assert.deepEqual(calls, [
      ['gate', 'attack'],
      ['hidden'],
      ['attack']
    ]);
  });

  it('routes shortcuts through the authoritative gate', () => {
    const calls = [];
    const menu = new BattleContextMenu({});
    menu.isVisible = true;
    menu.canMove = true;
    menu.callbacks = {
      canUseAction(action) {
        calls.push(['gate', action]);
        return false;
      },
      onMove() {
        calls.push(['move']);
      }
    };

    menu.handleKeydown({
      key: 'm',
      preventDefault() {
        calls.push(['prevented']);
      }
    });

    assert.deepEqual(calls, [
      ['prevented'],
      ['gate', 'move']
    ]);
  });

  it('renders availability from the authoritative gate, not private state', () => {
    const menu = new BattleContextMenu({});
    menu.canMove = false;
    menu.canAct = false;
    menu.callbacks = {
      canUseAction(action, options) {
        assert.equal(options.notify, false);
        return action === 'move';
      }
    };

    const html = menu.generateMenuHTML();

    assert.match(
      html,
      /class="context-menu-item\s+selected"\s+data-action="move"/
    );
    assert.match(
      html,
      /class="context-menu-item disabled\s*"\s+data-action="attack"/
    );
  });
});
