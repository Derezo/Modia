#!/usr/bin/env node

import { execFile as defaultExecFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMAND_OPTIONS = Object.freeze({
  encoding: 'utf8',
  maxBuffer: 64 * 1024,
  shell: false,
  timeout: 10_000,
  windowsHide: true
});

const LOGGED_OUT_STATUS_MARKER = 'Not logged in';

export const HELP_TEXT = `Codex authorization preflight for battle-map art generation

Usage:
  npm run battle-art:preflight -- [--json]
  npm run battle-art:preflight -- --help

Options:
  --json  Print a machine-readable result.
  -h, --help  Show this help text.

This check only runs "codex --version" and "codex login status". This script
never opens authentication files itself or prints login-status output, and it
does not contact image-generation tools or generate assets.`;

export function parsePreflightArgs(argv = process.argv.slice(2)) {
  const options = { help: false, json: false };
  const seen = new Set();
  for (const argument of argv) {
    const key = argument === '-h' ? '--help' : argument;
    if (key !== '--help' && key !== '--json') {
      throw new Error(`unknown argument ${argument}`);
    }
    if (seen.has(key)) throw new Error(`${key} may only be provided once`);
    seen.add(key);
    options[key.slice(2)] = true;
  }
  return options;
}

function executeCodex(execFile, args) {
  return new Promise(resolve => {
    const complete = (error, stdout = '', stderr = '') => {
      resolve({ error, stdout, stderr });
    };
    try {
      execFile('codex', args, COMMAND_OPTIONS, complete);
    } catch (error) {
      complete(error);
    }
  });
}

function isMissingCommand(error) {
  return error?.code === 'ENOENT';
}

function isLoggedOutStatus({ error, stdout, stderr }) {
  if (error?.code !== 1 || error.killed || error.signal) return false;
  return [stdout, stderr].some(output => String(output)
    .split(/\r?\n/u)
    .some(line => line.trim() === LOGGED_OUT_STATUS_MARKER));
}

function normalizedVersion(stdout) {
  const firstLine = String(stdout)
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(Boolean);
  if (!firstLine) return 'unknown';
  return firstLine.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 200);
}

function failure(code, message, checks) {
  return { ok: false, code, message, checks };
}

export async function checkCodexAuthorization({
  execFile = defaultExecFile
} = {}) {
  const versionCheck = await executeCodex(execFile, ['--version']);
  if (versionCheck.error) {
    const missing = isMissingCommand(versionCheck.error);
    return failure(
      missing ? 'CODEX_CLI_MISSING' : 'CODEX_CLI_CHECK_FAILED',
      missing
        ? 'Codex CLI was not found. Install Codex, ensure `codex` is on PATH, '
          + 'then run `codex login`.'
        : 'Codex CLI could not be started. Verify `codex --version` works, '
          + 'then rerun this preflight.',
      {
        cli: { ok: false, version: null },
        authorization: { ok: false, status: 'not-checked' }
      }
    );
  }

  const version = normalizedVersion(versionCheck.stdout);
  const loginCheck = await executeCodex(execFile, ['login', 'status']);
  if (loginCheck.error) {
    if (isMissingCommand(loginCheck.error)) {
      return failure(
        'CODEX_CLI_MISSING',
        'Codex CLI became unavailable while checking login status. Ensure '
          + '`codex` is on PATH, then rerun this preflight.',
        {
          cli: { ok: false, version },
          authorization: { ok: false, status: 'not-checked' }
        }
      );
    }
    if (isLoggedOutStatus(loginCheck)) {
      return failure(
        'CODEX_NOT_LOGGED_IN',
        'Codex CLI is installed but not logged in. Run `codex login`, complete '
          + 'sign-in, then rerun `npm run battle-art:preflight`.',
        {
          cli: { ok: true, version },
          authorization: { ok: false, status: 'logged-out' }
        }
      );
    }
    return failure(
      'CODEX_LOGIN_STATUS_CHECK_FAILED',
      'Codex login status could not be checked. Verify `codex login status` '
        + 'completes successfully, then rerun this preflight.',
      {
        cli: { ok: true, version },
        authorization: { ok: false, status: 'not-checked' }
      }
    );
  }

  return {
    ok: true,
    code: 'CODEX_AUTHORIZED',
    message: 'Codex CLI is installed and logged in.',
    checks: {
      cli: { ok: true, version },
      authorization: { ok: true, status: 'logged-in' }
    }
  };
}

function writeResult(result, { json, stdout, stderr }) {
  if (json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const output = result.ok ? stdout : stderr;
  output.write(`${result.ok ? 'PASS' : 'FAIL'}: ${result.message}\n`);
  if (result.ok) {
    output.write(`Codex version: ${result.checks.cli.version}\n`);
  }
}

export async function main(argv = process.argv.slice(2), {
  execFile = defaultExecFile,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  let options;
  try {
    options = parsePreflightArgs(argv);
  } catch (error) {
    const result = failure(
      'INVALID_ARGUMENTS',
      `${error.message}. Run \`npm run battle-art:preflight -- --help\` for usage.`,
      {
        cli: { ok: false, version: null },
        authorization: { ok: false, status: 'not-checked' }
      }
    );
    writeResult(result, {
      json: argv.includes('--json'),
      stdout,
      stderr
    });
    return 1;
  }

  if (options.help) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const result = await checkCodexAuthorization({ execFile });
  writeResult(result, { json: options.json, stdout, stderr });
  return result.ok ? 0 : 1;
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
