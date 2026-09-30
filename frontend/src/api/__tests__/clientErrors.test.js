import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, isCredentialEndpoint, readResponseBody } from '../client.js';

const originalFetch = globalThis.fetch;

function makeResponse(status, body, contentType = 'application/json') {
  return new Response(body, {
    status,
    headers: body == null ? {} : { 'content-type': contentType }
  });
}

function makeClient() {
  const client = new ApiClient('/api');
  const calls = { refresh: 0, unauthorized: 0 };
  client.setTokenRefreshManager({
    handle401: async () => { calls.refresh += 1; return false; }
  });
  client.setUnauthorizedHandler(() => { calls.unauthorized += 1; });
  return { client, calls };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ApiClient credential endpoints', () => {
  it('recognises only login and register paths as credential endpoints', () => {
    assert.equal(isCredentialEndpoint('/auth/login'), true);
    assert.equal(isCredentialEndpoint('/auth/register'), true);
    assert.equal(isCredentialEndpoint('/auth/register-with-character'), true);
    assert.equal(isCredentialEndpoint('/auth/refresh'), false);
    assert.equal(isCredentialEndpoint('/characters'), false);
  });

  for (const endpoint of ['/auth/login', '/auth/register', '/auth/register-with-character']) {
    it(`surfaces the server message for a 401 from ${endpoint} without refreshing`, async () => {
      const { client, calls } = makeClient();
      globalThis.fetch = async () => makeResponse(401, JSON.stringify({ error: 'Invalid username or password' }));

      await assert.rejects(client.post(endpoint, { username: 'test-user', password: 'test-password' }), (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 401);
        assert.equal(err.message, 'Invalid username or password');
        return true;
      });
      assert.equal(calls.refresh, 0);
      assert.equal(calls.unauthorized, 0);
    });
  }

  it('still refreshes and reports session expiry for a 401 on other endpoints', async () => {
    const { client, calls } = makeClient();
    globalThis.fetch = async () => makeResponse(401, JSON.stringify({ error: 'Token expired' }));

    await assert.rejects(client.get('/characters'), (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Unauthorized');
      return true;
    });
    assert.equal(calls.refresh, 1);
    assert.equal(calls.unauthorized, 1);
  });
});

describe('ApiClient defensive body parsing', () => {
  it('turns an empty 500 body into a friendly error instead of a JSON parse error', async () => {
    const { client } = makeClient();
    globalThis.fetch = async () => makeResponse(500, null);

    await assert.rejects(client.get('/shop/1'), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      assert.doesNotMatch(err.message, /json/i);
      assert.match(err.message, /server/i);
      return true;
    });
  });

  it('turns an HTML 502 body into a friendly error', async () => {
    const { client } = makeClient();
    globalThis.fetch = async () => makeResponse(502, '<html>Bad Gateway</html>', 'text/html');

    await assert.rejects(client.get('/shop/1'), (err) => {
      assert.equal(err.status, 502);
      assert.doesNotMatch(err.message, /json|Unexpected token/i);
      return true;
    });
  });

  it('keeps the server error message for JSON error bodies', async () => {
    const { client } = makeClient();
    globalThis.fetch = async () => makeResponse(400, JSON.stringify({ error: 'Not enough gold' }));

    await assert.rejects(client.post('/shop/buy', {}), { message: 'Not enough gold', status: 400 });
  });

  it('resolves an empty 204 success to an empty object', async () => {
    const { client } = makeClient();
    globalThis.fetch = async () => new Response(null, { status: 204 });

    assert.deepEqual(await client.delete('/marketplace/listings/1'), {});
  });

  it('readResponseBody absorbs parse errors but not body-read failures', async () => {
    assert.deepEqual(
      await readResponseBody({ text: async () => 'not json' }),
      { data: null, text: 'not json' }
    );
    assert.deepEqual(
      await readResponseBody({ json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }),
      { data: null, text: null }
    );
    await assert.rejects(
      readResponseBody({ text: async () => { throw new Error('boom'); } }),
      { message: 'boom' }
    );
    await assert.rejects(
      readResponseBody({ json: async () => { throw new TypeError('network error'); } }),
      { name: 'TypeError' }
    );
  });
});

function abortError() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

describe('ApiClient body read failures on a 2xx', () => {
  it('rejects with a timeout error when the timeout fires during the body read', async () => {
    const { client } = makeClient();
    globalThis.fetch = async (_url, options) => ({
      status: 200,
      ok: true,
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      })
    });

    await assert.rejects(client.get('/battle/9/state', { timeoutMs: 10 }), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.isTimeout, true);
      assert.equal(err.isNetworkError, true);
      return true;
    });
  });

  it('rejects instead of resolving to {} when the body read fails without a timeout', async () => {
    const { client } = makeClient();
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      text: async () => { throw abortError(); }
    });

    await assert.rejects(client.get('/battle/9/state'), { name: 'AbortError' });
  });
});

describe('ApiClient transport failures', () => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    it(`classifies a fetch TypeError '${message}' as a network error`, async () => {
      const { client } = makeClient();
      globalThis.fetch = async () => { throw new TypeError(message); };

      await assert.rejects(client.post('/auth/refresh', { refreshToken: 'test-token' }), (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.isNetworkError, true);
        assert.equal(err.status, null);
        return true;
      });
    });
  }

  it('classifies a TypeError while reading the body as a network error', async () => {
    const { client } = makeClient();
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      text: async () => { throw new TypeError('Load failed'); }
    });

    await assert.rejects(client.get('/characters'), (err) => {
      assert.equal(err.isNetworkError, true);
      return true;
    });
  });
});
