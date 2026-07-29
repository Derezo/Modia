import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import express from 'express';

import battleMapOperationsRouter, {
  BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV
} from '../../routes/battleMapOperations.js';

const VALID_TOKEN = 'test-battle-map-operator-token-00000001';

describe('Battle-map operator diagnostics route', () => {
  let server;
  let baseUrl;
  let savedToken;

  before(async () => {
    const app = express();
    app.use('/api/operations/battle-maps', battleMapOperationsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  });

  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV];
    } else {
      process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV] = savedToken;
    }
  });

  it('is unavailable until a strong operator token is configured', async () => {
    savedToken = process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV];
    delete process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV];

    const response = await fetch(
      `${baseUrl}/api/operations/battle-maps/diagnostics`
    );

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('rejects missing and incorrect operator credentials', async () => {
    savedToken = process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV];
    process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV] = VALID_TOKEN;

    const missing = await fetch(
      `${baseUrl}/api/operations/battle-maps/diagnostics`
    );
    const incorrect = await fetch(
      `${baseUrl}/api/operations/battle-maps/diagnostics`,
      { headers: { Authorization: 'Bearer definitely-not-the-token' } }
    );

    assert.equal(missing.status, 401);
    assert.equal(incorrect.status, 403);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.equal(incorrect.headers.get('cache-control'), 'no-store');
  });

  it('returns bounded diagnostics without allowing response caching', async () => {
    savedToken = process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV];
    process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV] = VALID_TOKEN;

    const response = await fetch(
      `${baseUrl}/api/operations/battle-maps/diagnostics`,
      { headers: { Authorization: `Bearer ${VALID_TOKEN}` } }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(body.timestamp);
    assert.ok(body.metrics);
    assert.ok(Array.isArray(body.diagnostics.recentGenerationDiagnostics));
    assert.ok(Array.isArray(body.diagnostics.recentShadowDiagnostics));
  });
});
