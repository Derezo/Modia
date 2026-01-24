#!/bin/bash
#
# Modia Remote Installation Script
#
# This script runs ON THE SERVER to install a new release:
# - Extracts tarball to timestamped release directory
# - Installs production dependencies
# - Runs database migrations
# - Auto-seeds if database is empty (first deploy)
# - Activates release via atomic symlink swap
# - PM2 graceful reload for zero-downtime
# - Health check with automatic rollback on failure
# - Cleans up old releases
#
# Usage: ./install-remote.sh --tarball /tmp/modia-xxx.tar.gz [options]
#
# Options:
#   --tarball <path>  Path to deployment tarball (required unless --rollback)
#   --version <ver>   Version tag for logging
#   --rollback        Rollback to previous release
#   --force           Skip port conflict check
#   --help            Show this help message
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
APP_DIR="/var/www/modia"
RELEASES_DIR="$APP_DIR/releases"
SHARED_DIR="$APP_DIR/shared"
CURRENT_LINK="$APP_DIR/current"
KEEP_RELEASES=5
API_PORT=3000

# Default values
TARBALL_PATH=""
VERSION=""
ROLLBACK=false
FORCE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --tarball)
      TARBALL_PATH="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --rollback)
      ROLLBACK=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --help|-h)
      head -25 "$0" | tail -21
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

log() {
  echo -e "${GREEN}[INSTALL]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
  exit 1
}

step() {
  echo -e "${BLUE}[STEP]${NC} $1"
}

# ============================================
# Rollback handler
# ============================================
rollback_to_previous() {
  log "Rolling back to previous release..."

  # Get previous release (second newest)
  PREVIOUS=$(ls -t "$RELEASES_DIR" 2>/dev/null | sed -n '2p')

  if [ -z "$PREVIOUS" ]; then
    error "No previous release found to rollback to"
  fi

  local PREVIOUS_DIR="$RELEASES_DIR/$PREVIOUS"

  log "Rolling back to: $PREVIOUS"

  # Atomic symlink swap
  ln -sfn "$PREVIOUS_DIR" "${CURRENT_LINK}.new"
  mv -Tf "${CURRENT_LINK}.new" "$CURRENT_LINK"

  # Reload PM2
  cd "$CURRENT_LINK"
  if pm2 list | grep -q "modia-api"; then
    pm2 reload modia-api --update-env
  else
    pm2 start ecosystem.config.js --env production
  fi
  pm2 save

  log "Rollback complete!"
}

# Handle explicit rollback request
if [ "$ROLLBACK" = true ]; then
  rollback_to_previous
  exit 0
fi

# Validate required arguments
if [ -z "$TARBALL_PATH" ]; then
  error "Missing required argument: --tarball"
fi

if [ ! -f "$TARBALL_PATH" ]; then
  error "Tarball not found: $TARBALL_PATH"
fi

# ============================================
# Step 1: Check port availability
# ============================================
step "Checking port $API_PORT availability..."

check_port() {
  local pid=$(lsof -ti :$API_PORT 2>/dev/null)
  if [ -n "$pid" ]; then
    local process=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")

    # Check if this is our existing modia-api process
    if pm2 jlist 2>/dev/null | grep -q '"name":"modia-api"'; then
      log "Port $API_PORT is in use by modia-api (expected)"
      return 0
    fi

    if [ "$FORCE" = true ]; then
      warn "Port $API_PORT is in use by: $process (PID: $pid) - continuing due to --force"
      return 0
    fi

    error "Port $API_PORT is in use by: $process (PID: $pid). Cannot deploy - port conflict detected. Use --force to override."
  fi
  log "Port $API_PORT is available"
}

check_port

# ============================================
# Step 2: Verify environment
# ============================================
step "Verifying environment..."

if [ ! -f "$SHARED_DIR/.env" ]; then
  error "No .env file found at $SHARED_DIR/.env. This should have been created automatically by deploy-production.sh. Try re-running deploy-production.sh or manually run setup-mittonvillage.sh on the server."
fi

if [ ! -d "$RELEASES_DIR" ]; then
  mkdir -p "$RELEASES_DIR"
fi

# ============================================
# Step 3: Create release directory
# ============================================
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RELEASE_DIR="$RELEASES_DIR/$TIMESTAMP"

step "Creating release directory: $RELEASE_DIR"

mkdir -p "$RELEASE_DIR"

# ============================================
# Step 4: Extract tarball
# ============================================
step "Extracting tarball..."

tar -xzf "$TARBALL_PATH" -C "$RELEASE_DIR"

log "Extracted to: $RELEASE_DIR"

# ============================================
# Step 5: Link shared resources
# ============================================
step "Linking shared resources..."

# Link .env
ln -sf "$SHARED_DIR/.env" "$RELEASE_DIR/.env"

# Link logs directory
if [ ! -d "$SHARED_DIR/logs" ]; then
  mkdir -p "$SHARED_DIR/logs"
fi
ln -sf "$SHARED_DIR/logs" "$RELEASE_DIR/logs"

log "Shared resources linked"

# ============================================
# Step 6: Install production dependencies
# ============================================
step "Installing production dependencies..."

cd "$RELEASE_DIR"
npm ci --omit=dev

log "Dependencies installed"

# ============================================
# Step 7: Run database migrations
# ============================================
step "Running database migrations..."

cd "$RELEASE_DIR"
npm run db:migrate

log "Migrations complete"

# ============================================
# Step 8: Auto-seed if needed (first deploy)
# ============================================
step "Checking if database needs seeding..."

# Source .env for database connection
set -a
source "$SHARED_DIR/.env"
set +a

# Check if world_nodes table is empty
NODE_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "${DB_HOST:-localhost}" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM world_nodes" 2>/dev/null || echo "0")

if [ "$NODE_COUNT" = "0" ] || [ -z "$NODE_COUNT" ]; then
  log "Empty database detected - running initial seed..."
  cd "$RELEASE_DIR"
  npm run db:seed
  log "Database seeding complete!"
else
  log "Database already seeded ($NODE_COUNT nodes found)"
fi

# ============================================
# Step 9: Activate release (atomic symlink swap)
# ============================================
step "Activating release..."

# Create temporary symlink
ln -sfn "$RELEASE_DIR" "${CURRENT_LINK}.new"

# Atomic rename (POSIX guarantees atomicity for rename on same filesystem)
mv -Tf "${CURRENT_LINK}.new" "$CURRENT_LINK"

log "Release activated: $CURRENT_LINK -> $RELEASE_DIR"

# ============================================
# Step 10: Reload PM2
# ============================================
step "Reloading PM2..."

cd "$CURRENT_LINK"

if pm2 list | grep -q "modia-api"; then
  pm2 reload modia-api --update-env
  log "PM2 reloaded"
else
  pm2 start ecosystem.config.js --env production
  log "PM2 started"
fi

pm2 save

# ============================================
# Step 11: Health check
# ============================================
step "Verifying deployment health..."

HEALTH_URL="http://localhost:$API_PORT/api/health"
MAX_RETRIES=10
RETRY_DELAY=5

for i in $(seq 1 $MAX_RETRIES); do
  sleep $RETRY_DELAY

  HEALTH_RESPONSE=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "failed")

  if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    log "Health check passed!"
    break
  fi

  warn "Health check attempt $i failed, retrying..."

  if [ "$i" -eq "$MAX_RETRIES" ]; then
    error_msg="Health check failed after $MAX_RETRIES attempts"
    echo -e "${RED}[ERROR]${NC} $error_msg"
    echo -e "${RED}[ERROR]${NC} Rolling back to previous release..."

    rollback_to_previous

    # Remove failed release
    rm -rf "$RELEASE_DIR"

    exit 1
  fi
done

# ============================================
# Step 12: Cleanup old releases
# ============================================
step "Cleaning up old releases..."

cd "$RELEASES_DIR"
RELEASE_COUNT=$(ls -1 | wc -l)

if [ "$RELEASE_COUNT" -gt "$KEEP_RELEASES" ]; then
  RELEASES_TO_DELETE=$((RELEASE_COUNT - KEEP_RELEASES))
  ls -t | tail -n "$RELEASES_TO_DELETE" | xargs -d '\n' rm -rf
  log "Removed $RELEASES_TO_DELETE old release(s)"
else
  log "Keeping all $RELEASE_COUNT releases (max: $KEEP_RELEASES)"
fi

# ============================================
# Step 13: Cleanup tarball
# ============================================
rm -f "$TARBALL_PATH"

# ============================================
# Summary
# ============================================
echo ""
log "========================================"
log "Installation complete!"
log "========================================"
echo ""
echo "Release:   $TIMESTAMP"
echo "Version:   ${VERSION:-unknown}"
echo "Directory: $RELEASE_DIR"
echo ""
echo "PM2 status:"
pm2 list | grep -E "modia|Name"
echo ""
echo "Health:    $HEALTH_URL"
echo ""
