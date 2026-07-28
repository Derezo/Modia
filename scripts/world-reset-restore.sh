#!/usr/bin/env bash
#
# Verify and restore a world-reset snapshot to one explicitly named database.
#

set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage:
  PGHOST=... PGPORT=... PGUSER=... \
    scripts/world-reset-restore.sh \
      --archive /absolute/path/to/world-reset.dump \
      --expected-sha256 <64-hex-digest> \
      --target-database <database> \
      --confirm-target-database <same-database> \
      --confirm-target-host <exact-PGHOST> \
      --confirm-target-port <exact-PGPORT> \
      --confirm-target-user <exact-PGUSER> \
      --authorize-world-reset-restore \
      --maintenance-window-confirmed

The restore uses --clean --if-exists in one transaction. It never creates,
drops, or selects a database; the exact target database must already exist.
DATABASE_URL and PGSERVICE are rejected to prevent an ambiguous target.
EOF
}

die() {
    echo "Error: $*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

ARCHIVE_PATH=""
EXPECTED_SHA256=""
TARGET_DATABASE=""
CONFIRMED_TARGET_DATABASE=""
CONFIRMED_TARGET_HOST=""
CONFIRMED_TARGET_PORT=""
CONFIRMED_TARGET_USER=""
AUTHORIZED=0
MAINTENANCE_CONFIRMED=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --archive)
            [ "$#" -ge 2 ] || die "--archive requires a value"
            ARCHIVE_PATH="$2"
            shift 2
            ;;
        --expected-sha256)
            [ "$#" -ge 2 ] || die "--expected-sha256 requires a value"
            EXPECTED_SHA256="$2"
            shift 2
            ;;
        --target-database)
            [ "$#" -ge 2 ] || die "--target-database requires a value"
            TARGET_DATABASE="$2"
            shift 2
            ;;
        --confirm-target-database)
            [ "$#" -ge 2 ] || die "--confirm-target-database requires a value"
            CONFIRMED_TARGET_DATABASE="$2"
            shift 2
            ;;
        --confirm-target-host)
            [ "$#" -ge 2 ] || die "--confirm-target-host requires a value"
            CONFIRMED_TARGET_HOST="$2"
            shift 2
            ;;
        --confirm-target-port)
            [ "$#" -ge 2 ] || die "--confirm-target-port requires a value"
            CONFIRMED_TARGET_PORT="$2"
            shift 2
            ;;
        --confirm-target-user)
            [ "$#" -ge 2 ] || die "--confirm-target-user requires a value"
            CONFIRMED_TARGET_USER="$2"
            shift 2
            ;;
        --authorize-world-reset-restore)
            AUTHORIZED=1
            shift
            ;;
        --maintenance-window-confirmed)
            MAINTENANCE_CONFIRMED=1
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
done

[ "$AUTHORIZED" -eq 1 ] \
    || die "--authorize-world-reset-restore is required"
[ "$MAINTENANCE_CONFIRMED" -eq 1 ] \
    || die "--maintenance-window-confirmed is required"
[ -n "$ARCHIVE_PATH" ] || die "--archive is required"
[ -n "$EXPECTED_SHA256" ] || die "--expected-sha256 is required"
[ -n "$TARGET_DATABASE" ] || die "--target-database is required"
[ "$TARGET_DATABASE" = "$CONFIRMED_TARGET_DATABASE" ] \
    || die "--confirm-target-database must exactly match --target-database"

case "$TARGET_DATABASE" in
    postgres|template0|template1)
        die "refusing to restore into PostgreSQL system database: $TARGET_DATABASE"
        ;;
    *[!A-Za-z0-9_-]*|"")
        die "target database may contain only letters, digits, underscores, and hyphens"
        ;;
esac

case "$ARCHIVE_PATH" in
    /*) ;;
    *) die "--archive must be an absolute path" ;;
esac
if [ ! -f "$ARCHIVE_PATH" ] || [ -L "$ARCHIVE_PATH" ]; then
    die "archive must be a regular, non-symlink file: $ARCHIVE_PATH"
fi

ARCHIVE_PARENT="$(dirname -- "$ARCHIVE_PATH")"
ARCHIVE_NAME="$(basename -- "$ARCHIVE_PATH")"
CANONICAL_PARENT="$(cd -- "$ARCHIVE_PARENT" && pwd -P)"
CANONICAL_ARCHIVE="${CANONICAL_PARENT}/${ARCHIVE_NAME}"
[ "$ARCHIVE_PATH" = "$CANONICAL_ARCHIVE" ] \
    || die "--archive must use its exact canonical path: $CANONICAL_ARCHIVE"

EXPECTED_SHA256="$(printf '%s' "$EXPECTED_SHA256" | tr '[:upper:]' '[:lower:]')"
case "$EXPECTED_SHA256" in
    *[!0-9a-f]*|"") die "--expected-sha256 must be exactly 64 hexadecimal characters" ;;
esac
[ "${#EXPECTED_SHA256}" -eq 64 ] \
    || die "--expected-sha256 must be exactly 64 hexadecimal characters"

[ -z "${DATABASE_URL:-}" ] \
    || die "DATABASE_URL is rejected for restore; name the target with --target-database"
[ -z "${PGSERVICE:-}" ] \
    || die "PGSERVICE is rejected for restore; use explicit PGHOST, PGPORT, and PGUSER"
for variable in PGHOST PGPORT PGUSER; do
    [ -n "${!variable:-}" ] || die "$variable is required"
done
case "$PGPORT" in
    *[!0-9]*|"") die "PGPORT must be numeric" ;;
esac
case "$PGHOST" in
    *,*) die "PGHOST must name one exact host, not a host list" ;;
esac
[ "$PGHOST" = "$CONFIRMED_TARGET_HOST" ] \
    || die "--confirm-target-host must exactly match PGHOST"
[ "$PGPORT" = "$CONFIRMED_TARGET_PORT" ] \
    || die "--confirm-target-port must exactly match PGPORT"
[ "$PGUSER" = "$CONFIRMED_TARGET_USER" ] \
    || die "--confirm-target-user must exactly match PGUSER"
if [ -n "${PGDATABASE:-}" ] && [ "$PGDATABASE" != "$TARGET_DATABASE" ]; then
    die "PGDATABASE does not match --target-database"
fi
export PGDATABASE="$TARGET_DATABASE"

require_command pg_restore
require_command psql
require_command sha256sum

TARGET_IDENTITY="$(
    psql \
        --no-psqlrc \
        --tuples-only \
        --no-align \
        --dbname="$TARGET_DATABASE" \
        --command="SELECT current_database()
            || '|' || session_user"
)"
# PGHOST and PGPORT above select the exact libpq connection endpoint. The
# server-side listening port can legitimately differ behind a tunnel, proxy, or
# container port mapping, so verify only identities PostgreSQL can authoritatively
# report for the established session.
[ "$TARGET_IDENTITY" = "${TARGET_DATABASE}|${PGUSER}" ] \
    || die "connected PostgreSQL target identity does not match the confirmed database/user"

CHECKSUM_OUTPUT="$(sha256sum "$ARCHIVE_PATH")"
ACTUAL_SHA256="${CHECKSUM_OUTPUT%% *}"
[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] \
    || die "archive checksum mismatch; refusing restore"

echo "Verifying archive catalog..."
pg_restore --list "$ARCHIVE_PATH" >/dev/null

echo "Restoring verified archive to exact database: $TARGET_DATABASE"
pg_restore \
    --clean \
    --if-exists \
    --exit-on-error \
    --single-transaction \
    --no-tablespaces \
    --dbname="$TARGET_DATABASE" \
    "$ARCHIVE_PATH"

RESTORED_DATABASE="$(
    psql \
        --no-psqlrc \
        --tuples-only \
        --no-align \
        --dbname="$TARGET_DATABASE" \
        --command='SELECT current_database()'
)"
[ "$RESTORED_DATABASE" = "$TARGET_DATABASE" ] \
    || die "post-restore connection did not resolve to the exact target database"

echo "Restore completed and target connection verified: $TARGET_DATABASE"
