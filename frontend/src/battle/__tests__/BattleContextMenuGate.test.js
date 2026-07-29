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
    return { style: {}, classList: { add() {}, remove() {} } };
  },
  getElementById() { return null; },
  head: { appendChild() {} }
};

const { BattleContextMenu } = await import('../BattleContextMenu.js');

describe('BattleContextMenu authoritative gate delegation', () => {
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
