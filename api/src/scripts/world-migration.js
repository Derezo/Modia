#!/usr/bin/env node

import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  executePlayerPreservingWorldMigration,
  planPlayerPreservingWorldMigration
} from '../db/worldMigration.js';
import { createSeedPool } from '../db/seed.js';
import {
  canonicalStringify,
  parseWorldSeed
} from '../db/worldgen/randomStreams.js';

export const WORLD_MIGRATION_AUTHORIZATION_FLAGS = Object.freeze([
  'ALLOW_PLAYER_PRESERVING_WORLD_MIGRATION',
  'WORLD_RESET_MAINTENANCE_WINDOW',
  'WORLD_RESET_BACKUP_VERIFIED'
]);

const PLAN_HASH = /^[0-9a-f]{64}$/;

const HELP = `Player-preserving world regeneration

Read-only plan (default):
  npm run world:migrate -- --seed=123456

Execute the exact reviewed plan:
  npm run world:migrate -- --seed=123456 --execute --confirm=<plan-hash>

Options:
  --seed=<signed-int32>       Target world seed (defaults to WORLD_SEED/123456)
  --execute                   Apply the migration transaction
  --confirm=<sha256>          Exact plan hash printed by the read-only run
  --initiated-by=<label>      Operator/change-ticket label for the audit row
  --full-plan                 Print the complete mapping instead of a summary
  --help                      Show this help

Execution also requires these environment variables to equal "true":
  ${WORLD_MIGRATION_AUTHORIZATION_FLAGS.join('\n  ')}
`;

function requiredValue(argument, name) {
  const value = argument.slice(name.length + 1);
  if (value.length === 0) throw new Error(`${name} requires a value`);
  return value;
}

export function parseWorldMigrationArgs(argv = []) {
  const options = {
    execute: false,
    fullPlan: false,
    help: false,
    seed: undefined,
    confirm: undefined,
    initiatedBy: undefined
  };

  for (const argument of argv) {
    if (argument === '--execute') {
      options.execute = true;
    } else if (argument === '--full-plan') {
      options.fullPlan = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--seed=')) {
      options.seed = requiredValue(argument, '--seed');
    } else if (argument.startsWith('--confirm=')) {
      options.confirm = requiredValue(argument, '--confirm');
    } else if (argument.startsWith('--initiated-by=')) {
      options.initiatedBy = requiredValue(argument, '--initiated-by');
    } else {
      throw new Error(`Unknown world migration option: ${argument}`);
    }
  }

  if (!options.execute && options.confirm !== undefined) {
    throw new Error('--confirm is only valid with --execute');
  }
  if (options.execute && !PLAN_HASH.test(options.confirm ?? '')) {
    throw new Error('--execute requires --confirm=<64-character lowercase sha256>');
  }
  return options;
}

export function isPlayerPreservingMigrationAuthorized(env = process.env) {
  return WORLD_MIGRATION_AUTHORIZATION_FLAGS.every(
    (name) => env[name] === 'true'
  );
}

function assertExecutionAuthorized(env) {
  if (!isPlayerPreservingMigrationAuthorized(env)) {
    throw new Error(
      'Refusing player-preserving world migration: set '
      + WORLD_MIGRATION_AUTHORIZATION_FLAGS.join(', ')
      + ' to exact value true after entering maintenance mode and verifying '
      + 'the database backup'
    );
  }
}

export function summarizeWorldMigrationPlan(plan) {
  return Object.fromEntries(Object.entries({
    event: 'player_preserving_world_migration_plan',
    mode: 'read_only',
    planHash: plan.planHash,
    source: plan.source,
    target: plan.target,
    mappingAudit: plan.mappingPlan?.audit ?? plan.mapping?.audit ?? plan.audit,
    preservation: plan.preservation,
    verification: plan.verification,
    warnings: plan.warnings ?? []
  }).filter(([, value]) => value !== undefined));
}

async function buildReadOnlyPlan({ pool, worldSeed, dependencies }) {
  const client = await pool.connect();
  try {
    return await dependencies.plan({
      client,
      worldSeed
    });
  } finally {
    client.release();
  }
}

export async function runWorldMigrationCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  dependencies = {}
} = {}) {
  const options = parseWorldMigrationArgs(argv);
  if (options.help) {
    stdout.write(HELP);
    return { mode: 'help' };
  }

  const worldSeed = parseWorldSeed(options.seed ?? env.WORLD_SEED);
  const resolved = {
    createPool: dependencies.createPool ?? createSeedPool,
    plan: dependencies.plan ?? planPlayerPreservingWorldMigration,
    execute: dependencies.execute ?? executePlayerPreservingWorldMigration
  };
  const pool = resolved.createPool(env);

  try {
    if (!options.execute) {
      const plan = await buildReadOnlyPlan({
        pool,
        worldSeed,
        dependencies: resolved
      });
      const output = options.fullPlan
        ? plan
        : summarizeWorldMigrationPlan(plan);
      stdout.write(`${canonicalStringify(output)}\n`);
      return { mode: 'plan', plan };
    }

    assertExecutionAuthorized(env);
    const result = await resolved.execute({
      pool,
      worldSeed,
      expectedPlanHash: options.confirm,
      initiatedBy: options.initiatedBy
    });
    stdout.write(`${canonicalStringify({
      event: 'player_preserving_world_migration_committed',
      mode: 'execute',
      ...result
    })}\n`);
    return { mode: 'execute', result };
  } finally {
    await pool.end?.();
  }
}

function isMainModule() {
  return process.argv[1] !== undefined
    && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: resolve(scriptDirectory, '../../../.env') });
  runWorldMigrationCli().catch((error) => {
    console.error(`World migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
