import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

import {
  createSeedPool,
  seedDatabase,
  validatePersistedWorld
} from '../../db/seed.js';
import { assembleWorld } from '../../db/worldgen/worldAssembly.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../../../../');

const optedIn = process.env.RUN_SEED_PERSISTENCE_INTEGRATION === 'true';
const optInSkipReason = optedIn
  ? false
  : 'set RUN_SEED_PERSISTENCE_INTEGRATION=true to run';

const SENTINEL_TABLES = Object.freeze([
  'world_regions',
  'world_nodes',
  'world_node_connections',
  'world_obstacles',
  'item_templates',
  'enemy_templates',
  'npc_shop_inventory',
  'seed_metadata'
]);

const RESET_AUTHORIZATION = Object.freeze({
  ALLOW_DESTRUCTIVE_WORLD_RESET: 'true',
  WORLD_RESET_MAINTENANCE_WINDOW: 'true',
  WORLD_RESET_BACKUP_VERIFIED: 'true'
});

function isUnmistakablyDisposable(databaseName) {
  return /(?:^|[_-])(?:test|testing|ci|disposable|ephemeral)(?:[_-]|$)/i
    .test(databaseName);
}

function normalizedQuery(text) {
  return typeof text === 'string'
    ? text.replace(/\s+/g, ' ').trim().toUpperCase()
    : '';
}

function passthroughClient(client) {
  return {
    query: client.query.bind(client),
    release() {}
  };
}

function failureInjectingClient(client, shouldFail, errorMessage) {
  let injected = false;
  return {
    client: {
      async query(text, params) {
        const result = await client.query(text, params);
        if (!injected && shouldFail(normalizedQuery(text))) {
          injected = true;
          throw new Error(errorMessage);
        }
        return result;
      },
      release() {}
    },
    wasInjected() {
      return injected;
    }
  };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveDeferred) => {
    resolvePromise = resolveDeferred;
  });
  return { promise, resolve: resolvePromise };
}

async function waitForPromise(promise, timeoutMs, errorMessage) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rejectPromise) => {
        timeoutId = setTimeout(
          () => rejectPromise(new Error(errorMessage)),
          timeoutMs
        );
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForBackendLock(client, backendPid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query(
      `SELECT state, wait_event_type, wait_event
       FROM pg_stat_activity
       WHERE pid = $1`,
      [backendPid]
    );
    if (result.rows[0]?.wait_event_type === 'Lock') {
      return result.rows[0];
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error('concurrent foreign key DDL did not wait on the reset lock');
}

async function captureSentinelState(client) {
  const state = {};
  for (const table of SENTINEL_TABLES) {
    const result = await client.query(
      `SELECT COALESCE(
         jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id),
         '[]'::jsonb
       ) AS rows
       FROM ${table} AS row_data`
    );
    state[table] = result.rows[0].rows;
  }
  return state;
}

function assertPopulatedSentinel(state) {
  for (const table of SENTINEL_TABLES) {
    assert.ok(
      state[table].length > 0,
      `expected populated sentinel table ${table}`
    );
  }
  assert.equal(state.seed_metadata.length, 1);
}

async function assertSentinelUnchanged(client, expected, failurePoint) {
  const actual = await captureSentinelState(client);
  for (const table of SENTINEL_TABLES) {
    assert.deepEqual(
      actual[table],
      expected[table],
      `${failurePoint} changed sentinel table ${table}`
    );
  }
}

it('rolls back every PostgreSQL seed failure point to a populated sentinel', {
  skip: optInSkipReason,
  timeout: 240_000
}, async (testContext) => {
  dotenv.config({ path: resolve(projectRoot, '.env') });
  const databaseName = process.env.DB_NAME || 'modia';
  if (!isUnmistakablyDisposable(databaseName)) {
    testContext.skip(`refusing unsafe PostgreSQL target "${databaseName}"`);
    return;
  }

  const sentinelWorld = assembleWorld({ seed: 1357911 });
  const replacementWorld = assembleWorld({ seed: 24681357 });
  const pool = createSeedPool(process.env);
  const client = await pool.connect();

  try {
    const schemaResult = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'world_nodes'
           AND column_name = 'node_key'
       ) AS worldgen_integrity_applied`
    );
    assert.equal(
      schemaResult.rows[0].worldgen_integrity_applied,
      true,
      'apply database migrations through 049 before running this test'
    );

    // The opt-in target is disposable, so establish a known, non-empty baseline.
    await seedDatabase({
      pool: { connect: async () => passthroughClient(client) },
      worldSeed: sentinelWorld.metadata.worldSeed,
      assemble: () => sentinelWorld,
      env: RESET_AUTHORIZATION
    });

    const sentinelState = await captureSentinelState(client);
    assertPopulatedSentinel(sentinelState);

    let preMutationConnected = false;
    await assert.rejects(
      seedDatabase({
        pool: {
          async connect() {
            preMutationConnected = true;
            return passthroughClient(client);
          }
        },
        worldSeed: replacementWorld.metadata.worldSeed,
        assemble: () => ({
          ...replacementWorld,
          validation: {
            valid: false,
            errors: [{ code: 'INJECTED_PRE_MUTATION_FAILURE' }]
          }
        }),
        env: RESET_AUTHORIZATION
      }),
      /Refusing to persist a world that failed hard validation/
    );
    assert.equal(
      preMutationConnected,
      false,
      'pre-mutation validation failure connected to PostgreSQL'
    );
    await assertSentinelUnchanged(
      client,
      sentinelState,
      'pre-mutation validation failure'
    );

    const failureScenarios = [
      {
        name: 'failure after TRUNCATE',
        createClient() {
          return failureInjectingClient(
            client,
            (query) => query.startsWith(
              'TRUNCATE "PUBLIC"."WORLD_REGIONS"'
            ),
            'injected failure after TRUNCATE'
          );
        }
      },
      {
        name: 'failure after world insertion',
        createClient() {
          let updatedRegions = 0;
          return failureInjectingClient(
            client,
            (query) => {
              if (!query.startsWith(
                'UPDATE WORLD_REGIONS SET CASTLE_NODE_ID'
              )) {
                return false;
              }
              updatedRegions += 1;
              return updatedRegions === replacementWorld.regions.length;
            },
            'injected failure after world insertion'
          );
        }
      },
      {
        name: 'failure in late shop inventory helper',
        createClient() {
          return failureInjectingClient(
            client,
            (query) => query.startsWith(
              'INSERT INTO NPC_SHOP_INVENTORY'
            ),
            'injected failure in late helper'
          );
        }
      }
    ];

    for (const scenario of failureScenarios) {
      const injected = scenario.createClient();
      await assert.rejects(
        seedDatabase({
          pool: { connect: async () => injected.client },
          worldSeed: replacementWorld.metadata.worldSeed,
          assemble: () => replacementWorld,
          env: RESET_AUTHORIZATION
        }),
        /injected failure/
      );
      assert.equal(
        injected.wasInjected(),
        true,
        `${scenario.name} did not reach its injection point`
      );
      await assertSentinelUnchanged(
        client,
        sentinelState,
        scenario.name
      );
    }

    await assert.rejects(
      seedDatabase({
        pool: { connect: async () => passthroughClient(client) },
        worldSeed: replacementWorld.metadata.worldSeed,
        assemble: () => replacementWorld,
        env: RESET_AUTHORIZATION,
        async validatePersistence(seedClient, generatedWorld) {
          const validation = await validatePersistedWorld(
            seedClient,
            generatedWorld
          );
          assert.match(validation.persistenceHash, /^[0-9a-f]{64}$/);
          throw new Error(
            'injected failure after round-trip before COMMIT'
          );
        }
      }),
      /injected failure after round-trip before COMMIT/
    );
    await assertSentinelUnchanged(
      client,
      sentinelState,
      'failure after round-trip before COMMIT'
    );
  } finally {
    client.release();
    await pool.end();
  }
});

it('blocks concurrent FK attachment and protects a same-name dependent', {
  skip: optInSkipReason,
  timeout: 240_000
}, async (testContext) => {
  dotenv.config({ path: resolve(projectRoot, '.env') });
  const databaseName = process.env.DB_NAME || 'modia';
  if (!isUnmistakablyDisposable(databaseName)) {
    testContext.skip(`refusing unsafe PostgreSQL target "${databaseName}"`);
    return;
  }

  const pool = createSeedPool(process.env);
  const setupClient = await pool.connect();
  const seedClient = await pool.connect();
  const ddlClient = await pool.connect();
  const observerClient = await pool.connect();
  const rootLocked = deferred();
  const continueReset = deferred();
  let seedPromise;
  let ddlPromise;

  try {
    await setupClient.query(
      'DROP SCHEMA IF EXISTS reset_safety_test CASCADE'
    );
    await seedDatabase({
      pool: { connect: async () => passthroughClient(seedClient) },
      worldSeed: 97531,
      assemble: () => assembleWorld({ seed: 97531 }),
      env: RESET_AUTHORIZATION
    });
    await setupClient.query('CREATE SCHEMA reset_safety_test');
    await setupClient.query(
      `CREATE TABLE reset_safety_test.item_templates (
         id integer PRIMARY KEY,
         item_template_id integer NOT NULL,
         marker text NOT NULL
       )`
    );
    await setupClient.query(
      `INSERT INTO reset_safety_test.item_templates
       (id, item_template_id, marker)
       VALUES (1, 1, 'must-survive')`
    );

    let rootLockObserved = false;
    const gatedSeedClient = {
      async query(text, params) {
        const result = await seedClient.query(text, params);
        if (!rootLockObserved && normalizedQuery(text).startsWith(
          'LOCK TABLE "PUBLIC"."SEED_METADATA"'
        )) {
          rootLockObserved = true;
          rootLocked.resolve();
          await continueReset.promise;
        }
        return result;
      },
      release() {}
    };

    seedPromise = seedDatabase({
      pool: { connect: async () => gatedSeedClient },
      worldSeed: 86420,
      assemble: () => assembleWorld({ seed: 86420 }),
      env: RESET_AUTHORIZATION
    });
    await waitForPromise(
      rootLocked.promise,
      10_000,
      'reset did not acquire its schema-qualified root locks'
    );

    const backend = await ddlClient.query(
      'SELECT pg_backend_pid() AS backend_pid'
    );
    ddlPromise = ddlClient.query(
      `ALTER TABLE reset_safety_test.item_templates
       ADD CONSTRAINT custom_item_templates_template_fk
       FOREIGN KEY (item_template_id)
       REFERENCES public.item_templates(id)`
    );
    const waitState = await waitForBackendLock(
      observerClient,
      backend.rows[0].backend_pid
    );
    assert.equal(waitState.state, 'active');

    continueReset.resolve();
    await Promise.all([seedPromise, ddlPromise]);

    const survivor = await setupClient.query(
      `SELECT id, item_template_id, marker
       FROM reset_safety_test.item_templates`
    );
    assert.deepEqual(survivor.rows, [{
      id: 1,
      item_template_id: 1,
      marker: 'must-survive'
    }]);
    const constraint = await setupClient.query(
      `SELECT convalidated
       FROM pg_constraint
       WHERE conrelid =
         'reset_safety_test.item_templates'::regclass
         AND conname = 'custom_item_templates_template_fk'`
    );
    assert.deepEqual(constraint.rows, [{ convalidated: true }]);

    const reports = [];
    await assert.rejects(
      seedDatabase({
        pool: { connect: async () => passthroughClient(seedClient) },
        worldSeed: 75319,
        assemble: () => assembleWorld({ seed: 75319 }),
        env: {},
        logger: (message) => reports.push(JSON.parse(message))
      }),
      /Refusing destructive world reset/
    );
    assert.deepEqual(
      reports[0].scope.tables.find(
        ({ table }) => table === '"reset_safety_test"."item_templates"'
      ),
      {
        table: '"reset_safety_test"."item_templates"',
        rowCount: '1',
        bootstrapReplaceable: false
      }
    );
  } finally {
    continueReset.resolve();
    await Promise.allSettled(
      [seedPromise, ddlPromise].filter(Boolean)
    );
    await setupClient.query(
      'DROP SCHEMA IF EXISTS reset_safety_test CASCADE'
    );
    setupClient.release();
    seedClient.release();
    ddlClient.release();
    observerClient.release();
    await pool.end();
  }
});

it('refuses to reset a populated inherited same-name table', {
  skip: optInSkipReason,
  timeout: 240_000
}, async (testContext) => {
  dotenv.config({ path: resolve(projectRoot, '.env') });
  const databaseName = process.env.DB_NAME || 'modia';
  if (!isUnmistakablyDisposable(databaseName)) {
    testContext.skip(`refusing unsafe PostgreSQL target "${databaseName}"`);
    return;
  }

  const pool = createSeedPool(process.env);
  const setupClient = await pool.connect();
  const seedClient = await pool.connect();

  try {
    await setupClient.query(
      'DROP SCHEMA IF EXISTS reset_inheritance_test CASCADE'
    );
    await seedDatabase({
      pool: { connect: async () => passthroughClient(seedClient) },
      worldSeed: 314159,
      assemble: () => assembleWorld({ seed: 314159 }),
      env: RESET_AUTHORIZATION
    });
    await setupClient.query('CREATE SCHEMA reset_inheritance_test');
    await setupClient.query(
      `CREATE TABLE reset_inheritance_test.item_templates (
         marker text NOT NULL
       ) INHERITS (public.item_templates)`
    );
    await setupClient.query(
      `INSERT INTO reset_inheritance_test.item_templates
       (name, item_type, marker)
       VALUES ('Inherited Sentinel', 'weapon', 'must-survive')`
    );

    const reports = [];
    await assert.rejects(
      seedDatabase({
        pool: { connect: async () => passthroughClient(seedClient) },
        worldSeed: 271828,
        assemble: () => assembleWorld({ seed: 271828 }),
        env: {},
        logger: (message) => reports.push(JSON.parse(message))
      }),
      /Refusing destructive world reset/
    );

    assert.deepEqual(
      reports[0].scope.tables.find(
        ({ table }) =>
          table === '"reset_inheritance_test"."item_templates"'
      ),
      {
        table: '"reset_inheritance_test"."item_templates"',
        rowCount: '1',
        bootstrapReplaceable: false
      }
    );
    const survivor = await setupClient.query(
      `SELECT name, item_type, marker
       FROM ONLY reset_inheritance_test.item_templates`
    );
    assert.deepEqual(survivor.rows, [{
      name: 'Inherited Sentinel',
      item_type: 'weapon',
      marker: 'must-survive'
    }]);
  } finally {
    await setupClient.query(
      'DROP SCHEMA IF EXISTS reset_inheritance_test CASCADE'
    );
    setupClient.release();
    seedClient.release();
    await pool.end();
  }
});
