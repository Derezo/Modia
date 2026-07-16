import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BattleStatePoller } from '../BattleStatePoller.js';

const activeState = {
  activeUnitId: 'player',
  turnCount: 1,
  status: 'active',
  units: [{ id: 'player', x: 1, y: 2, hp: 10, mp: 5 }]
};

const terminalState = {
  activeUnitId: null,
  turnCount: 2,
  status: 'defeat',
  units: [{ id: 'player', x: 1, y: 2, hp: 0, mp: 5 }]
};

describe('BattleStatePoller terminal recovery', () => {
  it('prioritizes terminal status over simultaneous turn drift', () => {
    const poller = new BattleStatePoller(1, () => {}, {}, () => {});
    poller.setLocalState(activeState);

    assert.deepEqual(poller.hasCriticalDrift(terminalState), {
      type: 'status_changed',
      serverValue: 'defeat',
      localValue: 'active'
    });
  });

  it('does not cache a critical snapshot before the deferred full sync applies it', async (t) => {
    const previousFetch = globalThis.fetch;
    const requestHeaders = [];
    const criticalDrifts = [];
    const fullDrifts = [];
    let fetchCount = 0;

    globalThis.fetch = async (_url, options) => {
      fetchCount++;
      requestHeaders.push({ ...options.headers });
      const sentUnappliedETag = options.headers['If-None-Match'] === '"v2"';
      if (fetchCount > 1 && sentUnappliedETag) {
        return {
          status: 304,
          ok: false,
          headers: { get() { return null; } }
        };
      }
      return {
        status: 200,
        ok: true,
        headers: { get(name) { return name === 'ETag' ? '"v2"' : null; } },
        async json() { return terminalState; }
      };
    };
    t.after(() => { globalThis.fetch = previousFetch; });

    const poller = new BattleStatePoller(
      7,
      state => fullDrifts.push(state),
      { api: { token: 'token', baseUrl: '/api' } },
      (...args) => criticalDrifts.push(args)
    );
    poller.setLocalState(activeState);
    poller.lastETag = '"v1"';
    poller.setCriticalMode(true);

    await poller.poll();

    assert.equal(poller.lastETag, '"v1"');
    assert.equal(poller.pendingFullSync, true);
    assert.deepEqual(criticalDrifts[0].slice(0, 2), ['status_changed', 'defeat']);

    poller.setCriticalMode(false);
    await new Promise(resolve => globalThis.setImmediate(resolve));
    await new Promise(resolve => globalThis.setImmediate(resolve));

    assert.equal(fetchCount, 2);
    assert.equal(requestHeaders[0]['If-None-Match'], undefined);
    assert.equal(requestHeaders[1]['If-None-Match'], '"v1"');
    assert.deepEqual(fullDrifts, [terminalState]);
    assert.equal(poller.lastETag, '"v2"');
  });
});
