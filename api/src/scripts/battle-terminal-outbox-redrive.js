#!/usr/bin/env node

import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool as databasePool } from '../config/database.js';
import { battleTerminalOutbox } from '../services/battle/BattleTerminalOutbox.js';

const HELP = `Redrive one exhausted battle terminal outbox event

Usage:
  npm run battle:outbox:redrive -- \\
    --event-key=<stable-event-key> \\
    --confirm=<same-stable-event-key> \\
    --actor=<operator-or-ticket> \\
    --reason=<investigation-and-remediation>

The command fails closed unless the event exists, is unprocessed, has exhausted
its delivery attempts, and has no unexpired worker claim. Actor, reason, prior
failure state, and database time are written to the immutable audit ledger in
the same statement that makes the event immediately eligible for delivery.
`;

function requiredValue(argument, name) {
  const value = argument.slice(name.length + 1).trim();
  if (value.length === 0) throw new Error(`${name} requires a value`);
  return value;
}

export function parseBattleTerminalOutboxRedriveArgs(argv = []) {
  const options = {
    help: false,
    eventKey: undefined,
    confirm: undefined,
    actor: undefined,
    reason: undefined
  };

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--event-key=')) {
      options.eventKey = requiredValue(argument, '--event-key');
    } else if (argument.startsWith('--confirm=')) {
      options.confirm = requiredValue(argument, '--confirm');
    } else if (argument.startsWith('--actor=')) {
      options.actor = requiredValue(argument, '--actor');
    } else if (argument.startsWith('--reason=')) {
      options.reason = requiredValue(argument, '--reason');
    } else {
      throw new Error(`Unknown battle terminal outbox redrive option: ${argument}`);
    }
  }

  if (options.help) return options;
  for (const [name, value] of [
    ['--event-key', options.eventKey],
    ['--confirm', options.confirm],
    ['--actor', options.actor],
    ['--reason', options.reason]
  ]) {
    if (value === undefined) throw new Error(`${name} is required`);
  }
  if (options.confirm !== options.eventKey) {
    throw new Error('--confirm must exactly match --event-key');
  }
  return options;
}

export async function runBattleTerminalOutboxRedriveCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  dependencies = {}
} = {}) {
  const options = parseBattleTerminalOutboxRedriveArgs(argv);
  if (options.help) {
    stdout.write(HELP);
    return { mode: 'help' };
  }

  const outbox = dependencies.outbox ?? battleTerminalOutbox;
  const close = dependencies.close ?? (() => databasePool.end());
  try {
    const result = await outbox.redriveExhausted(options.eventKey, {
      actor: options.actor,
      reason: options.reason
    });
    const output = {
      event: 'battle_terminal_outbox_redriven',
      eventKey: result.event.eventKey,
      attempts: result.event.attempts,
      nextAttemptAt: result.event.nextAttemptAt,
      audit: result.audit
    };
    stdout.write(`${JSON.stringify(output)}\n`);
    return { mode: 'redrive', result };
  } finally {
    await close();
  }
}

function isMainModule() {
  return process.argv[1] !== undefined
    && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: resolve(scriptDirectory, '../../../.env') });
  runBattleTerminalOutboxRedriveCli().catch((error) => {
    console.error(`Battle terminal outbox redrive failed: ${error.message}`);
    process.exitCode = 1;
  });
}
