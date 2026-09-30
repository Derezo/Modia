/**
 * Admin routes (image and audio) have no authentication of their own, so the
 * NODE_ENV gate must fail closed: only development and test are allowed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { requireDevMode } from '../../routes/admin/shared.js';

const originalEnv = process.env.NODE_ENV;

function run(env) {
  if (env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env;
  let nextCalled = false;
  let statusCode = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; }
  };
  requireDevMode({ ip: '127.0.0.1' }, res, () => { nextCalled = true; });
  return { nextCalled, statusCode };
}

describe('admin requireDevMode', () => {
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it('allows development and test', () => {
    assert.deepEqual(run('development'), { nextCalled: true, statusCode: null });
    assert.deepEqual(run('test'), { nextCalled: true, statusCode: null });
  });

  it('refuses production, staging and an unset NODE_ENV', () => {
    for (const env of ['production', 'staging', undefined, '']) {
      assert.deepEqual(run(env), { nextCalled: false, statusCode: 403 }, String(env));
    }
  });

  it('the audio admin router uses the same gate', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../routes/adminAudio.js', import.meta.url), 'utf8');
    assert.match(source, /import \{ requireDevMode \} from '\.\/admin\/shared\.js'/);
    assert.match(source, /router\.use\(requireDevMode\)/);
    assert.doesNotMatch(source, /NODE_ENV === 'production'/);
  });
});
