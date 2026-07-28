#!/usr/bin/env bash
#
# dev-setup.sh - Comprehensive development environment setup for Modia
#
# Handles the full startup sequence: port cleanup, Docker, migrations, seeding, and launch.
#

# Colors and symbols
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color
CHECK="${GREEN}✓${NC}"
CROSS="${RED}✗${NC}"

# Change to project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Header
echo ""
echo -e "${BOLD}Modia Development Setup${NC}"
echo "======================="
echo ""

# =============================================================================
# Load environment variables
# =============================================================================
load_env() {
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
    PORT="${PORT:-3000}"
    FRONTEND_PORT="${VITE_FRONTEND_PORT:-8080}"
}

# =============================================================================
# Port Cleanup
# =============================================================================
check_and_kill_port() {
    local PORT=$1

    echo -ne "[Ports] Checking port ${PORT}... "

    # Use lsof if available (most reliable)
    if command -v lsof &> /dev/null; then
        PIDS=$(lsof -i ":${PORT}" -t 2>/dev/null)
        if [ -z "$PIDS" ]; then
            echo -e "${GREEN}free${NC}"
            return 0
        fi

        # Get first PID and process name
        FIRST_PID=$(echo "$PIDS" | head -1)
        PROCESS_NAME=$(ps -p "$FIRST_PID" -o comm= 2>/dev/null || echo "unknown")
        echo -e "${YELLOW}in use by ${PROCESS_NAME} (PID ${FIRST_PID})${NC}"

        # Kill all processes on this port
        for PID in $PIDS; do
            kill "$PID" 2>/dev/null
            echo -e "[Ports] Killed process ${PID} on port ${PORT}"
        done

        # Wait a moment for ports to be released
        sleep 1
        return 0
    fi

    # Fallback: use ss if available
    if command -v ss &> /dev/null; then
        if ss -tuln | grep -q ":${PORT} "; then
            # Try to get PID from ss
            PID_INFO=$(ss -tulnp 2>/dev/null | grep ":${PORT} " | grep -oP 'pid=\K[0-9]+' | head -1)
            if [ -n "$PID_INFO" ]; then
                PROCESS_NAME=$(ps -p "$PID_INFO" -o comm= 2>/dev/null || echo "unknown")
                echo -e "${YELLOW}in use by ${PROCESS_NAME} (PID ${PID_INFO})${NC}"
                kill "$PID_INFO" 2>/dev/null
                echo -e "[Ports] Killed process ${PID_INFO} on port ${PORT}"
                sleep 1
            else
                echo -e "${YELLOW}in use (could not identify process)${NC}"
            fi
        else
            echo -e "${GREEN}free${NC}"
        fi
        return 0
    fi

    # Fallback: use fuser if available
    if command -v fuser &> /dev/null; then
        PIDS=$(fuser "${PORT}/tcp" 2>/dev/null)
        if [ -z "$PIDS" ]; then
            echo -e "${GREEN}free${NC}"
        else
            echo -e "${YELLOW}in use (PIDs: ${PIDS})${NC}"
            fuser -k "${PORT}/tcp" 2>/dev/null
            echo -e "[Ports] Killed processes on port ${PORT}"
            sleep 1
        fi
        return 0
    fi

    echo -e "${YELLOW}(cannot check - no lsof/ss/fuser)${NC}"
    return 0
}

cleanup_ports() {
    check_and_kill_port "$PORT"
    check_and_kill_port "$FRONTEND_PORT"
    echo ""
}

# =============================================================================
# Docker Check
# =============================================================================
check_docker() {
    echo -ne "[Docker] Checking Docker daemon... "

    if ! command -v docker &> /dev/null; then
        echo -e "${CROSS} ${RED}Docker is not installed${NC}"
        echo "       Please install Docker: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo -e "${YELLOW}not running${NC}"
        echo -e "[Docker] Please start Docker and run this script again"
        exit 1
    fi

    echo -e "${GREEN}running${NC}"

    # Check PostgreSQL container
    echo -ne "[Docker] Checking PostgreSQL container... "

    CONTAINER_STATUS=$(docker ps --filter "name=modia-postgres" --format "{{.Status}}" 2>/dev/null)

    if [ -n "$CONTAINER_STATUS" ] && echo "$CONTAINER_STATUS" | grep -q "Up"; then
        echo -e "${GREEN}running${NC} ${CHECK}"
    else
        echo -e "${YELLOW}not running${NC}"
        echo -ne "[Docker] Starting PostgreSQL container... "

        if docker compose up -d &>/dev/null; then
            echo -e "${GREEN}started${NC}"
        else
            echo -e "${CROSS} ${RED}failed${NC}"
            echo "       Run 'docker compose up -d' manually to see errors"
            exit 1
        fi
    fi

    # Wait for PostgreSQL readiness
    echo -ne "[Docker] Waiting for PostgreSQL to be ready... "

    MAX_RETRIES=30
    RETRY_COUNT=0

    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        # Try to connect via docker exec
        if docker exec modia-postgres pg_isready -U "$DB_USER" -d "$DB_NAME" &>/dev/null; then
            echo -e "${GREEN}ready${NC} ${CHECK}"
            echo ""
            return 0
        fi

        RETRY_COUNT=$((RETRY_COUNT + 1))
        sleep 1
    done

    echo -e "${CROSS} ${RED}timed out after ${MAX_RETRIES}s${NC}"
    exit 1
}

# =============================================================================
# Migration Check
# =============================================================================
list_forward_migrations() {
    find "$1" -maxdepth 1 -type f \
        -name '*.sql' ! -name '*.rollback.sql' -printf '%f\n' | sort
}

check_migrations() {
    echo -ne "[Migrations] Checking for pending migrations... "

    MIGRATIONS_DIR="$PROJECT_ROOT/api/src/migrations"

    if [ ! -d "$MIGRATIONS_DIR" ]; then
        echo -e "${CROSS} ${RED}migrations directory not found${NC}"
        exit 1
    fi

    # Match the migration runner's inventory (rollback scripts are not applied).
    MIGRATION_FILES=$(list_forward_migrations "$MIGRATIONS_DIR")

    if [ -z "$MIGRATION_FILES" ]; then
        echo -e "${GREEN}no migration files found${NC}"
        echo ""
        return 0
    fi

    # Query applied migrations from database
    export PGPASSWORD="$DB_PASSWORD"

    # Try direct psql first, then docker exec
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
        APPLIED_MIGRATIONS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT name FROM migrations ORDER BY id" 2>/dev/null || echo "")
    else
        APPLIED_MIGRATIONS=$(docker exec modia-postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT name FROM migrations ORDER BY id" 2>/dev/null || echo "")
    fi

    # Count pending migrations
    declare -A APPLIED_MAP
    while IFS= read -r migration; do
        if [ -n "$migration" ]; then
            APPLIED_MAP["$migration"]=1
        fi
    done <<< "$APPLIED_MIGRATIONS"

    PENDING_COUNT=0
    while IFS= read -r file; do
        if [ -n "$file" ] && [ "${APPLIED_MAP[$file]}" != "1" ]; then
            ((PENDING_COUNT++))
        fi
    done <<< "$MIGRATION_FILES"

    if [ $PENDING_COUNT -eq 0 ]; then
        echo -e "${GREEN}none pending${NC} ${CHECK}"
        echo ""
        return 0
    fi

    echo -e "${YELLOW}${PENDING_COUNT} pending${NC}"
    echo -ne "[Migrations] Running migrations... "

    MIGRATE_OUTPUT=$(npm run db:migrate 2>&1)
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}done${NC} ${CHECK}"
    else
        echo -e "${CROSS} ${RED}failed${NC}"
        echo "$MIGRATE_OUTPUT" | tail -20
        exit 1
    fi

    echo ""
}

# =============================================================================
# Seed Check - Smart detection for when seeding is needed
# =============================================================================
# Defined outside check_seed so focused tests and alternate callers can inject a
# fail-closed query runner without accidentally reaching a real database.
run_query() {
    local query="$1"
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "$query" 2>/dev/null
    else
        docker exec modia-postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "$query" 2>/dev/null
    fi
}

check_seed() {
    echo -e "[Seed] Checking database state..."

    export PGPASSWORD="$DB_PASSWORD"

    # Read the import-safe seed contract from the same modules used by seeding.
    if ! EXPECTED_CONTRACT=$(
        cd "$PROJECT_ROOT/api" &&
        node --input-type=module -e '
            import { SEED_VERSION } from "./src/db/seed.js";
            import { createWorldgenConfig } from "./src/db/worldgen/randomStreams.js";
            const config = createWorldgenConfig({ seed: process.env.WORLD_SEED });
            console.log([
                SEED_VERSION,
                config.worldSeed,
                config.generatorVersion,
                config.randomStreamVersion
            ].join("|"));
        '
    ); then
        echo -e "${CROSS} ${RED}could not load the current seed contract${NC}"
        exit 1
    fi
    if [ -z "$EXPECTED_CONTRACT" ]; then
        echo -e "${CROSS} ${RED}could not load the current seed contract${NC}"
        exit 1
    fi
    IFS='|' read -r EXPECTED_SEED_VERSION EXPECTED_WORLD_SEED \
        EXPECTED_GENERATOR_VERSION EXPECTED_RANDOM_STREAM_VERSION \
        <<< "$EXPECTED_CONTRACT"

    # Check if seed_metadata table exists and has data
    METADATA_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'seed_metadata')" || echo "f")

    if [ "$METADATA_EXISTS" = "t" ]; then
        # Read the persisted contract atomically so its fields cannot be mixed.
        STORED_CONTRACT=$(run_query "
            SELECT seed_version || '|' || world_seed || '|' ||
                   generator_version || '|' || random_stream_version || '|' ||
                   world_node_count
            FROM seed_metadata
            WHERE id = 1
        " || echo "")
        IFS='|' read -r STORED_VERSION STORED_WORLD_SEED \
            STORED_GENERATOR_VERSION STORED_RANDOM_STREAM_VERSION \
            STORED_NODE_COUNT <<< "$STORED_CONTRACT"
    else
        STORED_VERSION=""
        STORED_WORLD_SEED=""
        STORED_GENERATOR_VERSION=""
        STORED_RANDOM_STREAM_VERSION=""
        STORED_NODE_COUNT="0"
    fi

    # Check actual world_nodes count
    if ! NODE_COUNT=$(run_query "SELECT COUNT(*) FROM world_nodes" 2>/dev/null); then
        echo -e "${CROSS} ${RED}could not read the persisted world node count${NC}"
        exit 1
    fi
    if ! [[ "$NODE_COUNT" =~ ^[0-9]+$ ]]; then
        echo -e "${CROSS} ${RED}database returned an invalid world node count${NC}"
        exit 1
    fi

    # Decision logic
    SEED_REASON=""

    if [ "$NODE_COUNT" -eq 0 ]; then
        SEED_REASON="database is empty"
    else
        MISMATCH_DETAILS=()
        if [ -z "$STORED_VERSION" ]; then
            MISMATCH_DETAILS+=("seed metadata is missing")
        else
            if [ "$STORED_WORLD_SEED" != "$EXPECTED_WORLD_SEED" ]; then
                MISMATCH_DETAILS+=("world seed ${STORED_WORLD_SEED} -> ${EXPECTED_WORLD_SEED}")
            fi
            if [ "$STORED_VERSION" != "$EXPECTED_SEED_VERSION" ]; then
                MISMATCH_DETAILS+=("content version ${STORED_VERSION} -> ${EXPECTED_SEED_VERSION}")
            fi
            if [ "$STORED_GENERATOR_VERSION" != "$EXPECTED_GENERATOR_VERSION" ]; then
                MISMATCH_DETAILS+=("generator version ${STORED_GENERATOR_VERSION} -> ${EXPECTED_GENERATOR_VERSION}")
            fi
            if [ "$STORED_RANDOM_STREAM_VERSION" != "$EXPECTED_RANDOM_STREAM_VERSION" ]; then
                MISMATCH_DETAILS+=("random-stream version ${STORED_RANDOM_STREAM_VERSION} -> ${EXPECTED_RANDOM_STREAM_VERSION}")
            fi
            if [ "$STORED_NODE_COUNT" != "$NODE_COUNT" ]; then
                MISMATCH_DETAILS+=("persisted node count ${STORED_NODE_COUNT} != actual ${NODE_COUNT}")
            fi
        fi

        if [ ${#MISMATCH_DETAILS[@]} -eq 0 ]; then
            echo -ne "       World data (${NODE_COUNT} nodes, seed v${STORED_VERSION})... "
            echo -e "${GREEN}up to date${NC} ${CHECK}"
            echo ""
            return 0
        fi

        echo -e "       ${YELLOW}World seed contract mismatch detected:${NC}"
        for DETAIL in "${MISMATCH_DETAILS[@]}"; do
            echo "       - ${DETAIL}"
        done

        if [ "${ALLOW_DESTRUCTIVE_WORLD_RESET:-false}" != "true" ] ||
           [ "${WORLD_RESET_MAINTENANCE_WINDOW:-false}" != "true" ] ||
           [ "${WORLD_RESET_BACKUP_VERIFIED:-false}" != "true" ]; then
            echo -e "       ${RED}Refusing to replace a nonempty world.${NC}"
            echo "       Set all of the following only for an authorized disposable/reset environment:"
            echo "       ALLOW_DESTRUCTIVE_WORLD_RESET=true"
            echo "       WORLD_RESET_MAINTENANCE_WINDOW=true"
            echo "       WORLD_RESET_BACKUP_VERIFIED=true"
            exit 1
        fi

        SEED_REASON="authorized seed-contract reset"
    fi

    # Run seeding if needed
    echo -ne "       ${SEED_REASON}... "
    echo -e "${YELLOW}seeding${NC}"
    echo -ne "[Seed] Running seed script... "

    SEED_OUTPUT=$(npm run db:seed 2>&1)
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}done${NC} ${CHECK}"
    else
        echo -e "${CROSS} ${RED}failed${NC}"
        echo "$SEED_OUTPUT" | tail -20
        exit 1
    fi

    echo ""
}

# =============================================================================
# Icon Generation Check
# =============================================================================
check_icons() {
    echo -ne "[Icons] Checking for icon assets... "

    SVG_DIR="$PROJECT_ROOT/frontend/public/assets/icons/svg"
    PNG_DIR="$PROJECT_ROOT/frontend/public/assets/icons/png"

    if [ ! -d "$SVG_DIR" ]; then
        echo -e "${YELLOW}no SVG icons directory${NC}"
        echo ""
        return 0
    fi

    # Count SVG files
    SVG_COUNT=$(find "$SVG_DIR" -name "*.svg" 2>/dev/null | wc -l)

    if [ "$SVG_COUNT" -eq 0 ]; then
        echo -e "${YELLOW}no icons to generate${NC}"
        echo ""
        return 0
    fi

    # Check if PNG directory exists and has files
    PNG_COUNT=0
    if [ -d "$PNG_DIR" ]; then
        PNG_COUNT=$(find "$PNG_DIR" -name "*.png" 2>/dev/null | wc -l)
    fi

    if [ "$PNG_COUNT" -eq 0 ]; then
        echo -e "${YELLOW}generating ${SVG_COUNT} icons${NC}"
        npm run generate:icons --silent
        echo -e "[Icons] ${GREEN}done${NC} ${CHECK}"
    else
        echo -e "${GREEN}${PNG_COUNT} icons cached${NC} ${CHECK}"
    fi

    echo ""
}

# =============================================================================
# Launch Development Servers
# =============================================================================
launch_dev() {
    echo -e "[Launch] Starting development servers..."
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  API: http://localhost:${PORT}${NC}"
    echo -e "${CYAN}  Frontend: http://localhost:${FRONTEND_PORT}${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""

    # Execute npm run dev - this replaces the current shell
    exec npm run dev
}

# =============================================================================
# Main
# =============================================================================
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    load_env
    cleanup_ports
    check_docker
    check_migrations
    check_seed
    check_icons
    launch_dev
fi
