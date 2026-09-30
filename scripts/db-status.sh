#!/usr/bin/env bash
#
# db-status.sh - Shows migration status for the Modia database
#
# Displays which migrations have been applied and which are pending.
#

# Colors and symbols
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
CHECK="${GREEN}✓${NC}"
PENDING="${YELLOW}○${NC}"

# Change to project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT" || exit 1

# Preserve an explicitly selected target. Loading .env must provide defaults,
# not silently redirect a status check away from caller-supplied connection
# settings.
CALLER_DB_HOST_SET="${DB_HOST+x}"
CALLER_DB_HOST="${DB_HOST-}"
CALLER_DB_PORT_SET="${DB_PORT+x}"
CALLER_DB_PORT="${DB_PORT-}"
CALLER_DB_NAME_SET="${DB_NAME+x}"
CALLER_DB_NAME="${DB_NAME-}"
CALLER_DB_USER_SET="${DB_USER+x}"
CALLER_DB_USER="${DB_USER-}"
CALLER_DB_PASSWORD_SET="${DB_PASSWORD+x}"
CALLER_DB_PASSWORD="${DB_PASSWORD-}"

# Load .env if it exists.
if [ -f ".env" ]; then
    set -a
    # shellcheck source=/dev/null
    source <(grep -v '^#' .env | grep -v '^$' | sed 's/\r$//')
    set +a
fi

[ -z "$CALLER_DB_HOST_SET" ] || DB_HOST="$CALLER_DB_HOST"
[ -z "$CALLER_DB_PORT_SET" ] || DB_PORT="$CALLER_DB_PORT"
[ -z "$CALLER_DB_NAME_SET" ] || DB_NAME="$CALLER_DB_NAME"
[ -z "$CALLER_DB_USER_SET" ] || DB_USER="$CALLER_DB_USER"
[ -z "$CALLER_DB_PASSWORD_SET" ] || DB_PASSWORD="$CALLER_DB_PASSWORD"

# Use defaults if not set
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-modia}"
DB_USER="${DB_USER:-modia}"
DB_PASSWORD="${DB_PASSWORD:-modia_dev_password}"

MIGRATIONS_DIR="$PROJECT_ROOT/api/src/migrations"

# Check if migrations directory exists
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo -e "${RED}Error:${NC} Migrations directory not found: $MIGRATIONS_DIR"
    exit 1
fi

# Get forward migrations only. Rollback companions are executable procedures,
# not pending entries in the forward migration ledger.
MIGRATION_FILES=$(
    find "$MIGRATIONS_DIR" \
        -maxdepth 1 \
        -type f \
        -name '[0-9][0-9][0-9]_*.sql' \
        ! -name '*.rollback.sql' \
        -printf '%f\n' \
        | sort
)

if [ -z "$MIGRATION_FILES" ]; then
    echo "No migration files found in $MIGRATIONS_DIR"
    exit 0
fi

# Query applied migrations from database
export PGPASSWORD="$DB_PASSWORD"

# Check if we can connect to the database
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
    # Try via docker if direct connection fails
    if docker ps --filter "name=modia-postgres" --format "{{.Names}}" 2>/dev/null | grep -q "modia-postgres"; then
        # Use docker exec for psql
        APPLIED_MIGRATIONS=$(docker exec modia-postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT name FROM migrations ORDER BY id" 2>/dev/null || echo "")
    else
        echo -e "${RED}Error:${NC} Cannot connect to database at ${DB_HOST}:${DB_PORT}"
        echo "Make sure PostgreSQL is running: docker compose up -d"
        exit 1
    fi
else
    # Direct psql connection works
    APPLIED_MIGRATIONS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT name FROM migrations ORDER BY id" 2>/dev/null || echo "")
fi

# Convert applied migrations to an associative array for lookup
declare -A APPLIED_MAP
while IFS= read -r migration; do
    if [ -n "$migration" ]; then
        APPLIED_MAP["$migration"]=1
    fi
done <<< "$APPLIED_MIGRATIONS"

# Count applied and pending
APPLIED_COUNT=0
PENDING_COUNT=0

# Separate into applied and pending
APPLIED_LIST=""
PENDING_LIST=""

while IFS= read -r file; do
    if [ -n "$file" ]; then
        if [ "${APPLIED_MAP[$file]}" == "1" ]; then
            APPLIED_LIST="${APPLIED_LIST}${file}\n"
            ((APPLIED_COUNT++))
        else
            PENDING_LIST="${PENDING_LIST}${file}\n"
            ((PENDING_COUNT++))
        fi
    fi
done <<< "$MIGRATION_FILES"

# Display results
echo ""
echo "Applied migrations:"
if [ $APPLIED_COUNT -eq 0 ]; then
    echo "  (none)"
else
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            echo -e "  ${CHECK} ${file}"
        fi
    done <<< "$(echo -e "$APPLIED_LIST")"
fi

echo ""
echo "Pending migrations:"
if [ $PENDING_COUNT -eq 0 ]; then
    echo "  (none)"
else
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            echo -e "  ${PENDING} ${file}"
        fi
    done <<< "$(echo -e "$PENDING_LIST")"
fi

echo ""
echo "Summary: ${APPLIED_COUNT} applied, ${PENDING_COUNT} pending"
