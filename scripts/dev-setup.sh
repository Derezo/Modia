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
}

# =============================================================================
# Port Cleanup
# =============================================================================
check_and_kill_port() {
    local PORT=$1
    local SERVICE=$2

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
    check_and_kill_port 3000 "API"
    check_and_kill_port 8080 "Frontend"
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
check_migrations() {
    echo -ne "[Migrations] Checking for pending migrations... "

    MIGRATIONS_DIR="$PROJECT_ROOT/api/src/migrations"

    if [ ! -d "$MIGRATIONS_DIR" ]; then
        echo -e "${CROSS} ${RED}migrations directory not found${NC}"
        exit 1
    fi

    # Get all migration files
    MIGRATION_FILES=$(ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null | xargs -n1 basename | sort)

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

    if npm run db:migrate &>/dev/null; then
        echo -e "${GREEN}done${NC} ${CHECK}"
    else
        echo -e "${CROSS} ${RED}failed${NC}"
        echo "       Run 'npm run db:migrate' manually to see errors"
        exit 1
    fi

    echo ""
}

# =============================================================================
# Seed Check
# =============================================================================
check_seed() {
    echo -ne "[Seed] Checking for world data... "

    export PGPASSWORD="$DB_PASSWORD"

    # Query for existing world data
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
        REGION_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT COUNT(*) FROM regions" 2>/dev/null || echo "0")
    else
        REGION_COUNT=$(docker exec modia-postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT COUNT(*) FROM regions" 2>/dev/null || echo "0")
    fi

    # Handle potential errors (non-numeric result means table doesn't exist)
    if ! [[ "$REGION_COUNT" =~ ^[0-9]+$ ]]; then
        REGION_COUNT=0
    fi

    if [ "$REGION_COUNT" -gt 0 ]; then
        echo -e "${GREEN}database has data${NC} ${CHECK}"
        echo ""
        return 0
    fi

    echo -e "${YELLOW}database is empty${NC}"
    echo -ne "[Seed] Running seed script... "

    if npm run db:seed &>/dev/null; then
        echo -e "${GREEN}done${NC} ${CHECK}"
    else
        echo -e "${CROSS} ${RED}failed${NC}"
        echo "       Run 'npm run db:seed' manually to see errors"
        exit 1
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
    echo -e "${CYAN}  API: http://localhost:3000${NC}"
    echo -e "${CYAN}  Frontend: http://localhost:8080${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""

    # Execute npm run dev - this replaces the current shell
    exec npm run dev
}

# =============================================================================
# Main
# =============================================================================
load_env
cleanup_ports
check_docker
check_migrations
check_seed
launch_dev
