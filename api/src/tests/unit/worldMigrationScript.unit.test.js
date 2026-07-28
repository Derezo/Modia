import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isPlayerPreservingMigrationAuthorized,
  parseWorldMigrationArgs,
  runWorldMigrationCli,
  WORLD_MIGRATION_AUTHORIZATION_FLAGS
} from '../../scripts/world-migration.js';

function outputCollector() {
  let value = '';
  return {
    stream: { write: (chunk) => { value += chunk; } },
    read: () => value
  };
}

function fakePool(client = {}) {
  return {
    connect: async () => ({
      ...client,
      release() {}
    }),
    async end() {}
  };
}

describe('world migration operator command', () => {
  it('defaults to a read-only plan', () => {
    assert.deepEqual(parseWorldMigrationArgs([]), {
      execute: false,
      fullPlan: false,
      help: false,
      seed: undefined,
      confirm: undefined,
      initiatedBy: undefined
    });
  });

  it('requires an exact lowercase plan hash for execution', () => {
    assert.throws(
      () => parseWorldMigrationArgs(['--execute']),
      /requires --confirm/
    );
    assert.throws(
      () => parseWorldMigrationArgs([
        '--execute',
        `--confirm=${'A'.repeat(64)}`
      ]),
      /lowercase sha256/
    );

    const parsed = parseWorldMigrationArgs([
      '--seed=123456',
      '--execute',
      `--confirm=${'a'.repeat(64)}`,
      '--initiated-by=change-42'
    ]);
    assert.equal(parsed.execute, true);
    assert.equal(parsed.seed, '123456');
    assert.equal(parsed.confirm, 'a'.repeat(64));
    assert.equal(parsed.initiatedBy, 'change-42');
  });

  it('requires every maintenance and backup acknowledgement', () => {
    const env = Object.fromEntries(
      WORLD_MIGRATION_AUTHORIZATION_FLAGS.map((name) => [name, 'true'])
    );
    assert.equal(isPlayerPreservingMigrationAuthorized(env), true);

    for (const missing of WORLD_MIGRATION_AUTHORIZATION_FLAGS) {
      assert.equal(
        isPlayerPreservingMigrationAuthorized({ ...env, [missing]: 'false' }),
        false
      );
    }
  });

  it('plans without invoking the executor', async () => {
    const output = outputCollector();
    let executeCalled = false;
    const plan = {
      planHash: 'b'.repeat(64),
      source: { nodeCount: 571 },
      target: { nodeCount: 582 },
      mappingPlan: { audit: { mappedNodeCount: 571 } },
      preservation: { characterCount: 41 }
    };

    const result = await runWorldMigrationCli({
      argv: ['--seed=123456'],
      env: {},
      stdout: output.stream,
      dependencies: {
        createPool: () => fakePool(),
        plan: async ({ worldSeed }) => {
          assert.equal(worldSeed, 123456);
          return plan;
        },
        execute: async () => {
          executeCalled = true;
        }
      }
    });

    assert.equal(result.mode, 'plan');
    assert.equal(executeCalled, false);
    assert.match(output.read(), /player_preserving_world_migration_plan/);
    assert.match(output.read(), new RegExp(plan.planHash));
  });

  it('refuses execution before calling the transaction core unless authorized', async () => {
    let executeCalled = false;

    await assert.rejects(
      runWorldMigrationCli({
        argv: ['--execute', `--confirm=${'c'.repeat(64)}`],
        env: {},
        stdout: outputCollector().stream,
        dependencies: {
          createPool: () => fakePool(),
          execute: async () => {
            executeCalled = true;
          }
        }
      }),
      /Refusing player-preserving world migration/
    );
    assert.equal(executeCalled, false);
  });

  it('passes the reviewed hash and audit label to the executor', async () => {
    const output = outputCollector();
    const expectedPlanHash = 'd'.repeat(64);
    const env = Object.fromEntries(
      WORLD_MIGRATION_AUTHORIZATION_FLAGS.map((name) => [name, 'true'])
    );

    await runWorldMigrationCli({
      argv: [
        '--seed=-17',
        '--execute',
        `--confirm=${expectedPlanHash}`,
        '--initiated-by=ops-7'
      ],
      env,
      stdout: output.stream,
      dependencies: {
        createPool: () => fakePool(),
        execute: async (input) => {
          assert.equal(input.worldSeed, -17);
          assert.equal(input.expectedPlanHash, expectedPlanHash);
          assert.equal(input.initiatedBy, 'ops-7');
          return { migrationId: 9, planHash: expectedPlanHash };
        }
      }
    });

    assert.match(output.read(), /player_preserving_world_migration_committed/);
    assert.match(output.read(), /"migrationId":9/);
  });
});
