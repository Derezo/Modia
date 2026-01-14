#!/usr/bin/env bash
#
# db-fresh.sh - Fresh database reset for Modia
#
# Drops all tables, re-runs migrations, and seeds the database.
# This is a DESTRUCTIVE operation - all data will be lost!
#

# Colors and symbols
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
CHECK="${GREEN}✓${NC}"
WARN="${YELLOW}!${NC}"

# Initialize USE_DOCKER flag
USE_DOCKER=0

# Change to project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Load .env if it exists
if [ -f ".env" ]; then
    set -a
    source <(grep -v '^#' .env | grep -v '^$' | sed 's/\r$//')
    set +a
fi

# Use defaults if not set
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-modia}"
DB_USER="${DB_USER:-modia}"
DB_PASSWORD="${DB_PASSWORD:-modia_dev_password}"

echo ""
echo -e "${RED}WARNING: This will destroy all data in the database!${NC}"
echo ""
echo "Database: ${DB_NAME} at ${DB_HOST}:${DB_PORT}"
echo ""

# Prompt for confirmation (skip with --force or -y for CI)
if [ "${1:-}" == "--force" ] || [ "${1:-}" == "-y" ]; then
    CONFIRM="yes"
else
    read -p "Are you sure? Type 'yes' to continue: " CONFIRM
fi

if [ "$CONFIRM" != "yes" ]; then
    echo ""
    echo "Aborted. No changes made."
    exit 0
fi

echo ""

# Check database connection first
export PGPASSWORD="$DB_PASSWORD"
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
    # Try via docker
    if ! docker exec modia-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null 2>&1; then
        echo -e "${RED}Error:${NC} Cannot connect to database at ${DB_HOST}:${DB_PORT}"
        echo "Make sure PostgreSQL is running: docker compose up -d"
        exit 1
    fi
    USE_DOCKER=1
fi

# Step 1: Drop all tables
echo "Dropping all tables..."

# Get list of all tables and types, drop them with CASCADE
DROP_SQL="DO \$\$
DECLARE
    r RECORD;
BEGIN
    -- Drop all tables
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
    -- Drop all custom types (enums)
    FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e') LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
    END LOOP;
END \$\$;"

if [ "$USE_DOCKER" == "1" ]; then
    docker exec modia-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "$DROP_SQL" &>/dev/null
else
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$DROP_SQL" &>/dev/null
fi

if [ $? -eq 0 ]; then
    echo -e "${CHECK} Tables dropped"
else
    echo -e "${RED}Error:${NC} Failed to drop tables"
    exit 1
fi

# Step 2: Run migrations
echo "Running migrations..."
if npm run db:migrate; then
    echo -e "${CHECK} Migrations complete"
else
    echo -e "${RED}Error:${NC} Migration failed"
    exit 1
fi

# Step 3: Seed database
echo "Seeding database..."
if npm run db:seed; then
    echo -e "${CHECK} Seeding complete"
else
    echo -e "${RED}Error:${NC} Seeding failed"
    exit 1
fi

echo ""
echo -e "${GREEN}Database reset complete!${NC}"
