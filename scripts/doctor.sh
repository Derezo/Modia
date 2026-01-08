#!/usr/bin/env bash
#
# doctor.sh - Health check script for Modia development environment
#
# Validates that all required tools and services are properly configured.
# Exit code 0 = all checks pass, 1 = one or more checks failed.
#

set -e

# Colors and symbols
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color
CHECK="${GREEN}✓${NC}"
CROSS="${RED}✗${NC}"
ARROW="${YELLOW}→${NC}"

# Track failures
FAILED=0

# Helper function to print success
pass() {
    echo -e "${CHECK} $1"
}

# Helper function to print failure with suggestion
fail() {
    echo -e "${CROSS} $1"
    echo -e "  ${ARROW} $2"
    FAILED=1
}

# Change to project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "Checking development environment..."
echo ""

# =============================================================================
# Check 1: Node.js version (>=18.0.0)
# =============================================================================
check_node() {
    if ! command -v node &> /dev/null; then
        fail "Node.js is not installed" "Install Node.js 18+ via nvm: https://github.com/nvm-sh/nvm"
        return
    fi

    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

    if [ "$NODE_MAJOR" -ge 18 ]; then
        pass "Node.js v${NODE_VERSION} (>=18 required)"
    else
        fail "Node.js v${NODE_VERSION} is too old (>=18 required)" "Install Node 18+ via nvm: nvm install 18 && nvm use 18"
    fi
}

# =============================================================================
# Check 2: Docker running
# =============================================================================
check_docker() {
    if ! command -v docker &> /dev/null; then
        fail "Docker is not installed" "Install Docker: https://docs.docker.com/get-docker/"
        return
    fi

    if docker info &> /dev/null; then
        pass "Docker is running"
    else
        fail "Docker daemon is not running" "Start Docker Desktop or run: sudo systemctl start docker"
    fi
}

# =============================================================================
# Check 3: PostgreSQL container
# =============================================================================
check_postgres_container() {
    if ! command -v docker &> /dev/null; then
        # Already reported in docker check
        return
    fi

    if ! docker info &> /dev/null; then
        # Docker not running, can't check container
        return
    fi

    CONTAINER_STATUS=$(docker ps --filter "name=modia-postgres" --format "{{.Status}}" 2>/dev/null)

    if [ -n "$CONTAINER_STATUS" ]; then
        # Check if healthy
        if echo "$CONTAINER_STATUS" | grep -q "healthy"; then
            pass "PostgreSQL container is running (healthy)"
        elif echo "$CONTAINER_STATUS" | grep -q "Up"; then
            pass "PostgreSQL container is running"
        else
            fail "PostgreSQL container status: ${CONTAINER_STATUS}" "Run: docker compose up -d"
        fi
    else
        # Check if container exists but stopped
        STOPPED_CONTAINER=$(docker ps -a --filter "name=modia-postgres" --format "{{.Status}}" 2>/dev/null)
        if [ -n "$STOPPED_CONTAINER" ]; then
            fail "PostgreSQL container exists but is stopped" "Run: docker compose up -d"
        else
            fail "PostgreSQL container is not running" "Run: docker compose up -d"
        fi
    fi
}

# =============================================================================
# Check 4: Database connection
# =============================================================================
check_db_connection() {
    # Load .env if it exists
    if [ -f ".env" ]; then
        # Export env vars, handling comments and empty lines
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

    # Try to connect using pg_isready if available
    if command -v pg_isready &> /dev/null; then
        if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
            pass "Database connection successful (${DB_HOST}:${DB_PORT}/${DB_NAME})"
        else
            fail "Cannot connect to database at ${DB_HOST}:${DB_PORT}" "Check DB credentials in .env and ensure PostgreSQL is running"
        fi
        return
    fi

    # Fallback: try using docker exec if container is running
    if docker ps --filter "name=modia-postgres" --format "{{.Names}}" 2>/dev/null | grep -q "modia-postgres"; then
        if docker exec modia-postgres pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
            pass "Database connection successful (via container)"
        else
            fail "Cannot connect to database" "Database may still be starting. Wait a moment and try again"
        fi
        return
    fi

    # Fallback: try using nc/netcat to check port
    if command -v nc &> /dev/null; then
        if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
            pass "Database port ${DB_PORT} is accessible"
        else
            fail "Cannot connect to database at ${DB_HOST}:${DB_PORT}" "Check DB credentials in .env and ensure PostgreSQL is running"
        fi
        return
    fi

    # Can't check without tools
    echo -e "${YELLOW}!${NC} Cannot verify database connection (pg_isready/nc not available)"
}

# =============================================================================
# Check 5: .env file exists
# =============================================================================
check_env_file() {
    if [ -f ".env" ]; then
        pass ".env file exists"
    else
        fail ".env file not found" "Run: cp .env.example .env"
    fi
}

# =============================================================================
# Check 6: Required environment variables
# =============================================================================
check_env_vars() {
    if [ ! -f ".env" ]; then
        # Already reported in env file check
        return
    fi

    # Load .env
    set -a
    source <(grep -v '^#' .env | grep -v '^$' | sed 's/\r$//')
    set +a

    REQUIRED_VARS="DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD JWT_SECRET"
    MISSING_VARS=""

    for var in $REQUIRED_VARS; do
        if [ -z "${!var}" ]; then
            MISSING_VARS="${MISSING_VARS} ${var}"
        fi
    done

    if [ -z "$MISSING_VARS" ]; then
        pass "All required environment variables are set"
    else
        fail "Missing environment variables:${MISSING_VARS}" "Add these variables to your .env file"
    fi
}

# =============================================================================
# Check 7: Port 3000 available
# =============================================================================
check_port_3000() {
    check_port 3000 "API server"
}

# =============================================================================
# Check 8: Port 8080 available
# =============================================================================
check_port_8080() {
    check_port 8080 "Frontend server"
}

# Helper function to check if a port is available
check_port() {
    local PORT=$1
    local SERVICE=$2

    # Use lsof if available (most reliable)
    if command -v lsof &> /dev/null; then
        PROCESS=$(lsof -i ":${PORT}" -t 2>/dev/null | head -1)
        if [ -z "$PROCESS" ]; then
            pass "Port ${PORT} is available (${SERVICE})"
        else
            PROCESS_NAME=$(ps -p "$PROCESS" -o comm= 2>/dev/null || echo "unknown")
            fail "Port ${PORT} is in use by ${PROCESS_NAME} (PID: ${PROCESS})" "Kill the process: kill ${PROCESS}"
        fi
        return
    fi

    # Fallback: use ss if available
    if command -v ss &> /dev/null; then
        if ss -tuln | grep -q ":${PORT} "; then
            fail "Port ${PORT} is in use" "Find and kill the process: ss -tulnp | grep :${PORT}"
        else
            pass "Port ${PORT} is available (${SERVICE})"
        fi
        return
    fi

    # Fallback: use netstat if available
    if command -v netstat &> /dev/null; then
        if netstat -tuln | grep -q ":${PORT} "; then
            fail "Port ${PORT} is in use" "Find and kill the process: netstat -tulnp | grep :${PORT}"
        else
            pass "Port ${PORT} is available (${SERVICE})"
        fi
        return
    fi

    # Fallback: try to bind with nc
    if command -v nc &> /dev/null; then
        if nc -z localhost "$PORT" 2>/dev/null; then
            fail "Port ${PORT} is in use" "Find the blocking process with: lsof -i :${PORT}"
        else
            pass "Port ${PORT} is available (${SERVICE})"
        fi
        return
    fi

    echo -e "${YELLOW}!${NC} Cannot check port ${PORT} (no lsof/ss/netstat/nc available)"
}

# =============================================================================
# Run all checks
# =============================================================================
check_node
check_docker
check_postgres_container
check_db_connection
check_env_file
check_env_vars
check_port_3000
check_port_8080

# =============================================================================
# Summary
# =============================================================================
echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All checks passed!${NC} Your development environment is ready."
    exit 0
else
    echo -e "${RED}Some checks failed.${NC} Please fix the issues above and run this script again."
    exit 1
fi
