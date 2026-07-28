#!/usr/bin/env bash
#
# Create and verify a PostgreSQL snapshot before an authorized world reset.
#

set -Eeuo pipefail
umask 077

usage() {
    cat <<'EOF'
Usage:
  scripts/world-reset-backup.sh --archive /absolute/path/to/world-reset.dump

Connection (choose exactly one):
  DATABASE_URL=postgresql://...                         URI connection
  PGHOST=... PGPORT=... PGUSER=... PGDATABASE=...     libpq connection

The archive and its <archive>.sha256 checksum file must not already exist.
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
while [ "$#" -gt 0 ]; do
    case "$1" in
        --archive)
            [ "$#" -ge 2 ] || die "--archive requires a value"
            ARCHIVE_PATH="$2"
            shift 2
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

[ -n "$ARCHIVE_PATH" ] || die "--archive is required"
case "$ARCHIVE_PATH" in
    /*) ;;
    *) die "--archive must be an absolute path" ;;
esac

ARCHIVE_PARENT="$(dirname -- "$ARCHIVE_PATH")"
ARCHIVE_NAME="$(basename -- "$ARCHIVE_PATH")"
if [ "$ARCHIVE_NAME" = "." ] || [ "$ARCHIVE_NAME" = ".." ]; then
    die "invalid archive filename"
fi
[ -d "$ARCHIVE_PARENT" ] || die "archive directory does not exist: $ARCHIVE_PARENT"

CANONICAL_PARENT="$(cd -- "$ARCHIVE_PARENT" && pwd -P)"
CANONICAL_ARCHIVE="${CANONICAL_PARENT}/${ARCHIVE_NAME}"
[ "$ARCHIVE_PATH" = "$CANONICAL_ARCHIVE" ] \
    || die "--archive must use its exact canonical path: $CANONICAL_ARCHIVE"

CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
if [ -e "$ARCHIVE_PATH" ] || [ -L "$ARCHIVE_PATH" ]; then
    die "refusing to overwrite archive: $ARCHIVE_PATH"
fi
if [ -e "$CHECKSUM_PATH" ] || [ -L "$CHECKSUM_PATH" ]; then
    die "refusing to overwrite checksum: $CHECKSUM_PATH"
fi

if [ -n "${DATABASE_URL:-}" ]; then
    case "$DATABASE_URL" in
        postgres://*|postgresql://*) ;;
        *) die "DATABASE_URL must be an explicit postgres:// or postgresql:// URI" ;;
    esac
    case "$DATABASE_URL" in
        *,*) die "DATABASE_URL host lists are not supported; use one exact source" ;;
    esac
    for variable in PGHOST PGPORT PGUSER PGDATABASE PGSERVICE; do
        [ -z "${!variable:-}" ] \
            || die "DATABASE_URL cannot be combined with $variable"
    done
    export PGDATABASE="$DATABASE_URL"
else
    for variable in PGHOST PGPORT PGUSER PGDATABASE; do
        [ -n "${!variable:-}" ] || die "$variable is required when DATABASE_URL is unset"
    done
    [ -z "${PGSERVICE:-}" ] || die "PGSERVICE cannot be combined with explicit PG* connection settings"
    case "$PGPORT" in
        *[!0-9]*|"") die "PGPORT must be numeric" ;;
    esac
    case "$PGHOST" in
        *,*) die "PGHOST must name one exact host, not a host list" ;;
    esac
fi

require_command pg_dump
require_command pg_restore
require_command psql
require_command sha256sum
require_command mktemp

SOURCE_IDENTITY_BEFORE="$(
    psql \
        --no-psqlrc \
        --tuples-only \
        --no-align \
        --command="SELECT json_build_object(
            'database', current_database(),
            'session_user', session_user,
            'server_address', COALESCE(inet_server_addr()::text, 'local-socket'),
            'server_port', inet_server_port()
        )::text"
)"
[ -n "$SOURCE_IDENTITY_BEFORE" ] || die "could not resolve backup source identity"

TEMP_ARCHIVE="$(mktemp "${CANONICAL_PARENT}/.${ARCHIVE_NAME}.partial.XXXXXX")"
TEMP_CHECKSUM=""
PUBLISHED_CHECKSUM=0
cleanup() {
    rm -f -- "$TEMP_ARCHIVE"
    if [ -n "$TEMP_CHECKSUM" ]; then
        rm -f -- "$TEMP_CHECKSUM"
    fi
    if [ "$PUBLISHED_CHECKSUM" -eq 1 ]; then
        rm -f -- "$CHECKSUM_PATH"
    fi
}
trap cleanup EXIT

echo "Creating custom-format PostgreSQL archive..."
pg_dump --format=custom --no-tablespaces --file="$TEMP_ARCHIVE"
[ -s "$TEMP_ARCHIVE" ] || die "pg_dump produced an empty archive"

echo "Verifying archive catalog..."
pg_restore --list "$TEMP_ARCHIVE" >/dev/null

SOURCE_IDENTITY_AFTER="$(
    psql \
        --no-psqlrc \
        --tuples-only \
        --no-align \
        --command="SELECT json_build_object(
            'database', current_database(),
            'session_user', session_user,
            'server_address', COALESCE(inet_server_addr()::text, 'local-socket'),
            'server_port', inet_server_port()
        )::text"
)"
[ "$SOURCE_IDENTITY_BEFORE" = "$SOURCE_IDENTITY_AFTER" ] \
    || die "backup source identity changed while the archive was being created"

CHECKSUM_OUTPUT="$(sha256sum "$TEMP_ARCHIVE")"
ARCHIVE_SHA256="${CHECKSUM_OUTPUT%% *}"
case "$ARCHIVE_SHA256" in
    *[!0-9a-f]*|"") die "could not calculate a valid SHA-256 checksum" ;;
esac
[ "${#ARCHIVE_SHA256}" -eq 64 ] || die "could not calculate a valid SHA-256 checksum"

TEMP_CHECKSUM="$(mktemp "${CANONICAL_PARENT}/.${ARCHIVE_NAME}.sha256.partial.XXXXXX")"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE_PATH" > "$TEMP_CHECKSUM"
chmod 600 "$TEMP_ARCHIVE" "$TEMP_CHECKSUM"

# Hard links publish without overwriting a file that appeared after preflight.
ln -- "$TEMP_CHECKSUM" "$CHECKSUM_PATH" \
    || die "could not publish checksum without overwriting an existing file"
PUBLISHED_CHECKSUM=1
ln -- "$TEMP_ARCHIVE" "$ARCHIVE_PATH" \
    || die "could not publish archive without overwriting an existing file"

PUBLISHED_CHECKSUM=0
echo "Verified archive: $ARCHIVE_PATH"
echo "SHA-256: $ARCHIVE_SHA256"
echo "Checksum file: $CHECKSUM_PATH"
echo "Source identity: $SOURCE_IDENTITY_AFTER"
