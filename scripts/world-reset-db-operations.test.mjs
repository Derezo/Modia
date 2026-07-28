import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const backupScript = join(projectRoot, 'scripts/world-reset-backup.sh');
const restoreScript = join(projectRoot, 'scripts/world-reset-restore.sh');

async function executable(path, contents) {
  await writeFile(path, contents, 'utf8');
  await chmod(path, 0o755);
}

function run(script, args, env) {
  return spawnSync('bash', [script, ...args], {
    cwd: projectRoot,
    env,
    encoding: 'utf8'
  });
}

test('world-reset database scripts have valid Bash syntax', () => {
  for (const script of [backupScript, restoreScript]) {
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('backup fails closed without explicit database connection settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modia-db-backup-test-'));
  const archive = join(directory, 'snapshot.dump');
  const result = run(backupScript, ['--archive', archive], {
    PATH: process.env.PATH
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PGHOST is required/);
});

test('backup creates a verified custom archive and checksum record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modia-db-backup-test-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  await executable(join(bin, 'pg_dump'), `#!/usr/bin/env bash
set -eu
format=0
no_tablespaces=0
for argument in "$@"; do
  case "$argument" in
    --format=custom) format=1 ;;
    --no-tablespaces) no_tablespaces=1 ;;
    --file=*) output="\${argument#--file=}" ;;
  esac
done
[ "$format" -eq 1 ] && [ "$no_tablespaces" -eq 1 ]
printf 'verified custom archive' > "$output"
`);
  await executable(join(bin, 'pg_restore'), `#!/usr/bin/env bash
set -eu
[ "$1" = "--list" ]
`);
  await executable(join(bin, 'psql'), `#!/usr/bin/env bash
printf '%s\\n' '{"database":"modia","session_user":"backup_operator","server_address":"192.0.2.10","server_port":5432}'
`);

  const archive = join(directory, 'snapshot.dump');
  const result = run(backupScript, ['--archive', archive], {
    PATH: `${bin}:${process.env.PATH}`,
    PGHOST: 'db.example.test',
    PGPORT: '5432',
    PGUSER: 'backup_operator',
    PGDATABASE: 'modia'
  });

  assert.equal(result.status, 0, result.stderr);
  const contents = await readFile(archive);
  const digest = createHash('sha256').update(contents).digest('hex');
  assert.equal(
    await readFile(`${archive}.sha256`, 'utf8'),
    `${digest}  ${archive}\n`
  );
});

test('restore refuses a checksum mismatch before invoking pg_restore', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modia-db-restore-test-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const marker = join(directory, 'pg-restore-was-called');
  await executable(join(bin, 'pg_restore'), `#!/usr/bin/env bash
printf called > "${marker}"
`);
  await executable(join(bin, 'psql'), `#!/usr/bin/env bash
printf '%s\\n' 'modia_restore_drill|restore_operator'
`);
  const archive = join(directory, 'snapshot.dump');
  await writeFile(archive, 'archive bytes');

  const result = run(restoreScript, [
    '--archive', archive,
    '--expected-sha256', '0'.repeat(64),
    '--target-database', 'modia_restore_drill',
    '--confirm-target-database', 'modia_restore_drill',
    '--confirm-target-host', 'db.example.test',
    '--confirm-target-port', '5432',
    '--confirm-target-user', 'restore_operator',
    '--authorize-world-reset-restore',
    '--maintenance-window-confirmed'
  ], {
    PATH: `${bin}:${process.env.PATH}`,
    PGHOST: 'db.example.test',
    PGPORT: '5432',
    PGUSER: 'restore_operator'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
  await assert.rejects(readFile(marker));
});

test('restore requires explicit authorization and maintenance confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modia-db-restore-test-'));
  const archive = join(directory, 'snapshot.dump');
  await writeFile(archive, 'archive bytes');
  const digest = createHash('sha256').update('archive bytes').digest('hex');
  const commonArguments = [
    '--archive', archive,
    '--expected-sha256', digest,
    '--target-database', 'modia_restore_drill',
    '--confirm-target-database', 'modia_restore_drill',
    '--confirm-target-host', 'db.example.test',
    '--confirm-target-port', '5432',
    '--confirm-target-user', 'restore_operator'
  ];
  const env = {
    PATH: process.env.PATH,
    PGHOST: 'db.example.test',
    PGPORT: '5432',
    PGUSER: 'restore_operator'
  };

  const missingAuthorization = run(restoreScript, [
    ...commonArguments,
    '--maintenance-window-confirmed'
  ], env);
  assert.notEqual(missingAuthorization.status, 0);
  assert.match(missingAuthorization.stderr, /authorize-world-reset-restore is required/);

  const missingMaintenance = run(restoreScript, [
    ...commonArguments,
    '--authorize-world-reset-restore'
  ], env);
  assert.notEqual(missingMaintenance.status, 0);
  assert.match(missingMaintenance.stderr, /maintenance-window-confirmed is required/);
});

test('restore verifies and targets only the twice-confirmed database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modia-db-restore-test-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const marker = join(directory, 'restore-arguments');
  await executable(join(bin, 'pg_restore'), `#!/usr/bin/env bash
set -eu
if [ "$1" = "--list" ]; then
  exit 0
fi
printf '%s\\n' "$@" > "${marker}"
`);
  await executable(join(bin, 'psql'), `#!/usr/bin/env bash
case "$*" in
  *session_user*) printf '%s\\n' "$PGDATABASE|$PGUSER" ;;
  *) printf '%s\\n' "$PGDATABASE" ;;
esac
`);
  const archive = join(directory, 'snapshot.dump');
  await writeFile(archive, 'archive bytes');
  const digest = createHash('sha256').update('archive bytes').digest('hex');

  const result = run(restoreScript, [
    '--archive', archive,
    '--expected-sha256', digest,
    '--target-database', 'modia_restore_drill',
    '--confirm-target-database', 'modia_restore_drill',
    '--confirm-target-host', 'db.example.test',
    '--confirm-target-port', '5432',
    '--confirm-target-user', 'restore_operator',
    '--authorize-world-reset-restore',
    '--maintenance-window-confirmed'
  ], {
    PATH: `${bin}:${process.env.PATH}`,
    PGHOST: 'db.example.test',
    PGPORT: '5432',
    PGUSER: 'restore_operator'
  });

  assert.equal(result.status, 0, result.stderr);
  const argumentsUsed = await readFile(marker, 'utf8');
  assert.match(argumentsUsed, /^--clean$/m);
  assert.match(argumentsUsed, /^--single-transaction$/m);
  assert.match(argumentsUsed, /^--no-tablespaces$/m);
  assert.match(argumentsUsed, /^--dbname=modia_restore_drill$/m);
  assert.doesNotMatch(argumentsUsed, /postgres|template0|template1/);
});
