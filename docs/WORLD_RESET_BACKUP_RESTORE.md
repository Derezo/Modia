# World Reset Backup and Restore

This runbook is the supported recovery procedure for an explicitly authorized
PostgreSQL world reset. A world reset is a destructive bootstrap operation,
not a live-world migration. It does not map player locations, discoveries,
battles, market state, or other records to a replacement world.

The scripts in this runbook fail closed. They do not load `.env`, infer a
database, select a default archive, overwrite a backup, or create/drop a
database. The asset backup used by AI image tooling is unrelated and cannot
recover PostgreSQL or player data.

## What the snapshot covers

`world-reset-backup.sh` uses `pg_dump` to create a full, custom-format database
archive, including object ownership and access grants but excluding tablespace
placement. It then verifies the archive catalog with `pg_restore --list`,
calculates SHA-256, and publishes the archive and `<archive>.sha256` without
overwriting existing files.

It does not back up PostgreSQL roles, tablespaces, cluster configuration,
secrets, Redis, uploaded files, or other external services. The restore cluster
must already contain the archived roles so ownership and grants can be
reapplied. The restore operator must have permission to restore those owners
and grants; prove that in the drill. Back cluster-level and external state up
using the owning platform's procedure.

## Required preflight

Before resetting a database with persistent data:

1. Name the incident/change owner and the exact target database.
2. Schedule and begin a maintenance window. Stop API workers, job workers, and
   every other writer; block new sessions as appropriate for the environment.
3. Confirm enough protected storage for the snapshot. Use a new absolute,
   canonical path on a filesystem that is not deployed with the application.
4. Record the current release identifier and `WORLD_SEED`.
5. Inventory affected player/world records and announce the destructive scope.
6. Confirm `pg_dump`, `pg_restore`, and the target PostgreSQL server use
   compatible versions.

Do not set the reset authorization variables merely to test connectivity.

## Create and verify the backup

Supply the connection through the deployment secret manager. Choose one
connection form; do not put a credential-bearing URI in source control or a
ticket:

```bash
# Option A: a secret-injected URI
export DATABASE_URL='postgresql://...'

# Option B: explicit libpq settings (PGPASSWORD or .pgpass may provide auth)
export PGHOST='db.example.internal'
export PGPORT='5432'
export PGUSER='modia_backup'
export PGDATABASE='modia'
```

Create the archive at an exact path. Its parent directory must already exist:

```bash
scripts/world-reset-backup.sh \
  --archive /protected/modia-backups/pre-world-reset-20260727T180000Z.dump
```

The command succeeds only after `pg_restore --list` accepts the archive and
the checksum is recorded. Copy both files to protected, durable storage. Record
the absolute archive path, printed source identity, and SHA-256 in the change
record through a separate trusted channel. A digest stored only beside a
compromised archive is not independent recovery evidence.

Before continuing, have a second operator confirm:

- both files exist in protected storage;
- the independently recorded SHA-256 matches the script output;
- the archive path and source database are the intended ones; and
- the latest disposable restore drill for this archive passed.

## Disposable restore drill

Run this before the reset, using an isolated PostgreSQL instance or an exact,
new disposable database with no application traffic. The example name is
intentionally explicit; choose and record a similarly unambiguous name.

```bash
export PGHOST='drill-db.example.internal'
export PGPORT='5432'
export PGUSER='modia_restore'

createdb --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  modia_restore_drill_20260727

scripts/world-reset-restore.sh \
  --archive /protected/modia-backups/pre-world-reset-20260727T180000Z.dump \
  --expected-sha256 '<digest-from-the-independent-change-record>' \
  --target-database modia_restore_drill_20260727 \
  --confirm-target-database modia_restore_drill_20260727 \
  --confirm-target-host drill-db.example.internal \
  --confirm-target-port 5432 \
  --confirm-target-user modia_restore \
  --authorize-world-reset-restore \
  --maintenance-window-confirmed
```

The restore script verifies the exact, canonical, non-symlink archive path,
checksum, and archive catalog before changing the database. It rejects
`DATABASE_URL`, `PGSERVICE`, conflicting `PGDATABASE`, host lists, PostgreSQL
system databases, and different target/confirmation values. Host, port, user,
and database must all be explicitly confirmed, and a read-only identity query
must match first. It restores archived owners and grants with
`--clean --if-exists`, `--exit-on-error`, and `--single-transaction` against
only the named, pre-existing database.

After the drill:

1. Run migrations in status-only mode with the drill database connection.
2. Start an isolated API against the drill database.
3. Check `/api/health/ready` and `/api/world/seed`.
4. Exercise login plus representative world loading, navigation, battle entry,
   ruins, shop, and marketplace reads using test accounts.
5. Compare key player/world row counts and seed/hash metadata to the source
   preflight record.
6. Record the drill result, operator, time, archive digest, and observations.

Only after verifying the exact target name and disconnecting the isolated API,
remove the disposable database with an explicit command such as:

```bash
dropdb --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  modia_restore_drill_20260727
```

Never adapt that cleanup command to a wildcard, loop, unresolved variable, or
shared/production database.

## Authorize and run the world reset

With the maintenance window active, the verified archive protected, and the
drill passed, compare the seed command's `world_reset_preflight` JSON to the
identity recorded by the backup. The preflight is emitted inside the reset
transaction after every recursively cascade-affected table has an
`ACCESS EXCLUSIVE` lock. It lists the database, user, resolved server
address/port, every affected table, each exact row count from that locked
snapshot, and the total row count. Independently verify that target and
destructive scope before proceeding.
Persistent data requires all three acknowledgements at the exact value `true`:

```bash
export ALLOW_DESTRUCTIVE_WORLD_RESET=true
export WORLD_RESET_MAINTENANCE_WINDOW=true
export WORLD_RESET_BACKUP_VERIFIED=true
npm run db:seed
```

Unset those acknowledgements immediately after the command. A failed
pre-commit seed transaction should preserve the previous database state;
capture the failure and investigate instead of retrying blindly.

## Post-commit smoke and recovery decision

Keep the maintenance window active after a successful commit:

1. Capture the seed command output and query `/api/world/seed`. Compare its
   seed, versions, structural/output/route hashes, node count, and timestamp to
   the approved reset record.
2. Check `/api/health/ready`, server logs, database errors, and migration
   status.
3. Smoke world rendering, navigation/path previews, battle entry and rejoin,
   ruins access/solve, shops, marketplace, discoveries, and representative
   existing player accounts.
4. If checks pass, have the change owner record acceptance, re-enable writers,
   end maintenance, and retain the backup according to policy.
5. If a material check fails, keep writers stopped. Do not attempt an
   incremental repair against uncertain state. The incident/change owner must
   choose either a reviewed forward fix or restoration of the verified
   pre-reset archive.

An ordinary database transaction cannot roll back a reset after commit.
Restoration is therefore an explicit incident decision, not an automatic
script fallback.

## Restore the pre-reset snapshot

Confirm the maintenance window is still active, all writers and connection
pools are stopped, the target database already exists, and the independent
change record provides the expected digest. Then run:

```bash
export PGHOST='db.example.internal'
export PGPORT='5432'
export PGUSER='modia_restore'

scripts/world-reset-restore.sh \
  --archive /protected/modia-backups/pre-world-reset-20260727T180000Z.dump \
  --expected-sha256 '<digest-from-the-independent-change-record>' \
  --target-database modia \
  --confirm-target-database modia \
  --confirm-target-host db.example.internal \
  --confirm-target-port 5432 \
  --confirm-target-user modia_restore \
  --authorize-world-reset-restore \
  --maintenance-window-confirmed
```

For an exact snapshot, restore into a newly created empty replacement database
and switch the application only after validation. Restoring into an existing
database cleans objects present in the archive, but it cannot remove unrelated
objects created after the snapshot; inventory and reject such drift before
accepting recovery.

If the restore fails, its single transaction rolls back the restore attempt.
Keep maintenance active and preserve logs and the archive; do not switch to
`pg_restore --force`, a guessed archive, or a broader database target.

After a successful restore, repeat the readiness, seed metadata, row-count,
player-account, and gameplay smoke checks from the drill. Re-enable writers
only after the incident owner confirms that the restored pre-reset state is
the intended recovery point.

## Static safety checks

These checks use fake PostgreSQL executables and never connect to a database:

```bash
node --test scripts/world-reset-db-operations.test.mjs
```
