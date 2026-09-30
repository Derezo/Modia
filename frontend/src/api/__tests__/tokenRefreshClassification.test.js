import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { TokenRefreshManager, isRefreshRejected } = await import('../TokenRefreshManager.js');
const { ApiError } = await import('../client.js');

function networkError(message) {
  const err = new ApiError('Unable to connect to server', { cause: new TypeError(message) });
  err.isNetworkError = true;
  return err;
}

function createManager(refreshError) {
  const state = new Map([['refreshToken', 'test-refresh-token'], ['token', 'test-access-token']]);
  const game = {
    state: { get: (k) => state.get(k), set: (k, v) => state.set(k, v), persist() {} },
    api: {
      refresh: async () => { throw refreshError; },
      setToken() {}
    },
    socket: null,
    toast: null,
    scenes: { switchTo() {} }
  };
  const manager = new TokenRefreshManager(game);
  let loggedOut = 0;
  manager.handleRefreshFailure = () => { loggedOut++; };
  return { manager, state, loggedOut: () => loggedOut };
}

describe('isRefreshRejected', () => {
  it('ends the session only when the server rejects the refresh token', () => {
    assert.equal(isRefreshRejected(new ApiError('Invalid or expired refresh token', { status: 401 })), true);
    assert.equal(isRefreshRejected(new ApiError('Refresh token is required', { status: 400 })), true);
    assert.equal(isRefreshRejected(new ApiError('Forbidden', { status: 403 })), true);
  });

  it('retries network drops, timeouts, rate limits and server errors', () => {
    assert.equal(isRefreshRejected(networkError('Load failed')), false);
    assert.equal(isRefreshRejected(new TypeError('Load failed')), false);
    assert.equal(isRefreshRejected(new ApiError('Too many requests', { status: 429 })), false);
    assert.equal(isRefreshRejected(new ApiError('Server error', { status: 503 })), false);
  });
});

describe('TokenRefreshManager refresh failure', () => {
  it('keeps the session on a Safari network drop and schedules a retry', async () => {
    const { manager, state, loggedOut } = createManager(networkError('Load failed'));
    const result = await manager._doRefresh();
    assert.equal(result, false);
    assert.equal(loggedOut(), 0);
    assert.equal(state.get('refreshToken'), 'test-refresh-token');
    assert.ok(manager.refreshTimer);
    manager.stop();
  });

  it('logs out when the refresh token is rejected', async () => {
    const { manager, loggedOut } = createManager(new ApiError('Invalid refresh token', { status: 401 }));
    await manager._doRefresh();
    assert.equal(loggedOut(), 1);
    manager.stop();
  });
});
