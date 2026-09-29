import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HELP_TEXT,
  checkCodexAuthorization,
  main,
  parsePreflightArgs
} from './preflight.mjs';

function stubExecFile(outcomes) {
  const pending = [...outcomes];
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    const outcome = pending.shift();
    if (!outcome) throw new Error('unexpected process execution');
    queueMicrotask(() => callback(
      outcome.error ?? null,
      outcome.stdout ?? '',
      outcome.stderr ?? ''
    ));
  };
  return { calls, execFile, pending };
}

function captureStream() {
  let contents = '';
  return {
    stream: { write: value => { contents += value; } },
    read: () => contents
  };
}

describe('battle-art Codex authorization preflight', () => {
  it('checks the CLI and login status with bounded, shell-free execution', async () => {
    const stub = stubExecFile([
      { stdout: 'codex-cli 0.147.0\n' },
      { stdout: 'Logged in using ChatGPT\n' }
    ]);

    const result = await checkCodexAuthorization({ execFile: stub.execFile });

    assert.deepEqual(result, {
      ok: true,
      code: 'CODEX_AUTHORIZED',
      message: 'Codex CLI is installed and logged in.',
      checks: {
        cli: { ok: true, version: 'codex-cli 0.147.0' },
        authorization: { ok: true, status: 'logged-in' }
      }
    });
    assert.deepEqual(
      stub.calls.map(({ command, args }) => [command, args]),
      [
        ['codex', ['--version']],
        ['codex', ['login', 'status']]
      ]
    );
    for (const call of stub.calls) {
      assert.equal(call.options.shell, false);
      assert.equal(call.options.timeout, 10_000);
      assert.equal(call.options.maxBuffer, 64 * 1024);
    }
    assert.equal(stub.pending.length, 0);
  });

  it('returns actionable failure without a login check when Codex is missing', async () => {
    const missing = Object.assign(new Error('spawn codex ENOENT'), {
      code: 'ENOENT'
    });
    const stub = stubExecFile([{ error: missing }]);

    const result = await checkCodexAuthorization({ execFile: stub.execFile });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CODEX_CLI_MISSING');
    assert.match(result.message, /ensure `codex` is on PATH/);
    assert.equal(result.checks.authorization.status, 'not-checked');
    assert.equal(stub.calls.length, 1);
  });

  it('reports logged-out status without exposing command output', async () => {
    const stub = stubExecFile([
      { stdout: 'codex-cli 0.147.0\n' },
      {
        error: Object.assign(new Error('login status failed'), { code: 1 }),
        stdout: 'private-account-detail\n',
        stderr: 'Not logged in\nsecret-token-material\n'
      }
    ]);

    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = await main(['--json'], {
      execFile: stub.execFile,
      stdout: stdout.stream,
      stderr: stderr.stream
    });
    const result = JSON.parse(stdout.read());

    assert.equal(exitCode, 1);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CODEX_NOT_LOGGED_IN');
    assert.equal(result.checks.authorization.status, 'logged-out');
    assert.match(result.message, /Run `codex login`/);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /private-account-detail/);
    assert.doesNotMatch(serialized, /secret-token-material/);
    assert.equal(stderr.read(), '');
  });

  it('does not classify an unrelated exit 1 as logged out', async () => {
    const stub = stubExecFile([
      { stdout: 'codex-cli 0.147.0\n' },
      {
        error: Object.assign(new Error('login status failed'), { code: 1 }),
        stdout: 'Configuration is invalid: Not logged in to account provider\n',
        stderr: 'private-configuration-detail\n'
      }
    ]);

    const result = await checkCodexAuthorization({ execFile: stub.execFile });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CODEX_LOGIN_STATUS_CHECK_FAILED');
    assert.equal(result.checks.authorization.status, 'not-checked');
    assert.match(result.message, /Verify `codex login status`/);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /Not logged in to account provider/);
    assert.doesNotMatch(serialized, /private-configuration-detail/);
  });

  it('does not misreport a login-status execution failure as logged out', async () => {
    const timeout = Object.assign(new Error('command timed out'), {
      code: null,
      killed: true,
      signal: 'SIGTERM'
    });
    const stub = stubExecFile([
      { stdout: 'codex-cli 0.147.0\n' },
      { error: timeout, stderr: 'private-diagnostic-material\n' }
    ]);

    const result = await checkCodexAuthorization({ execFile: stub.execFile });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CODEX_LOGIN_STATUS_CHECK_FAILED');
    assert.equal(result.checks.authorization.status, 'not-checked');
    assert.match(result.message, /Verify `codex login status`/);
    assert.doesNotMatch(JSON.stringify(result), /private-diagnostic-material/);
  });

  it('parses the supported flags and rejects malformed or repeated options', () => {
    assert.deepEqual(parsePreflightArgs([]), { help: false, json: false });
    assert.deepEqual(parsePreflightArgs(['--json']), {
      help: false,
      json: true
    });
    assert.deepEqual(parsePreflightArgs(['-h']), { help: true, json: false });
    assert.throws(
      () => parsePreflightArgs(['--json=true']),
      /unknown argument --json=true/
    );
    assert.throws(
      () => parsePreflightArgs(['--json', '--json']),
      /--json may only be provided once/
    );
  });

  it('prints help without executing Codex', async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const execFile = () => { throw new Error('must not execute'); };

    const exitCode = await main(['--help'], {
      execFile,
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    assert.equal(exitCode, 0);
    assert.equal(stdout.read(), `${HELP_TEXT}\n`);
    assert.equal(stderr.read(), '');
  });

  it('prints a machine-readable result for --json', async () => {
    const stub = stubExecFile([
      { stdout: 'codex-cli 0.147.0\n' },
      { stdout: 'Logged in\n' }
    ]);
    const stdout = captureStream();
    const stderr = captureStream();

    const exitCode = await main(['--json'], {
      execFile: stub.execFile,
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    assert.equal(exitCode, 0);
    assert.equal(JSON.parse(stdout.read()).code, 'CODEX_AUTHORIZED');
    assert.equal(stderr.read(), '');
  });
});
