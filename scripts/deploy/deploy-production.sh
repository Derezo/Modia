#!/bin/bash
#
# Modia Production Deployment Script
#
# Builds, packages, and deploys the application from local machine to mittonvillage.com
#
# Usage: ./deploy-production.sh [options]
#
# Options:
#   --dry-run         Show what would happen without executing
#   --skip-build      Skip frontend build step for quick redeploys
#   --version <ver>   Tag release version (e.g., v1.0.0)
#   --force           Allow deployment with uncommitted changes
#   --reseed          Run migrations and reseed database after deploy
#   --refresh-db      DANGEROUS: Drop and recreate modia database (wipes all data)
#   --help            Show this help message
#
# Example:
#   ./deploy-production.sh --version v1.0.0
#   ./deploy-production.sh --dry-run --version v1.0.0
#   ./deploy-production.sh --skip-build
#   ./deploy-production.sh --reseed
#   ./deploy-production.sh --refresh-db   # DANGEROUS: wipes production database
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SERVER_USER="<SSH_USER>"
SERVER_HOST="mittonvillage.com"
SERVER_DEPLOY_DIR="<APP_DIR>"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Default values
DRY_RUN=false
SKIP_BUILD=false
VERSION=""
FORCE=false
RESEED=false
REFRESH_DB=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --reseed)
      RESEED=true
      shift
      ;;
    --refresh-db)
      REFRESH_DB=true
      shift
      ;;
    --help|-h)
      head -25 "$0" | tail -21
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

log() {
  echo -e "${GREEN}[DEPLOY]${NC} $1"
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

dry_run() {
  echo -e "${CYAN}[DRY-RUN]${NC} $1"
}

# Generate timestamp and tarball name
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
VERSION_TAG="${VERSION:-$TIMESTAMP}"
TARBALL_NAME="modia-${VERSION_TAG/v/}-${TIMESTAMP}.tar.gz"
TARBALL_PATH="/tmp/$TARBALL_NAME"

echo ""
echo "=========================================="
echo "  Modia Production Deployment"
echo "=========================================="
echo ""
echo "Server:    ${SERVER_USER}@${SERVER_HOST}"
echo "Version:   ${VERSION_TAG}"
echo "Tarball:   ${TARBALL_NAME}"
echo "Dry Run:   ${DRY_RUN}"
echo "Reseed:    ${RESEED}"
if [ "$REFRESH_DB" = true ]; then
  echo -e "Refresh DB: ${RED}YES - WILL DROP ALL DATA${NC}"
fi
echo ""

# ============================================
# Step 1: Pre-flight checks
# ============================================
step "Running pre-flight checks..."

cd "$PROJECT_ROOT"

# Check for uncommitted changes
if [ "$FORCE" = false ]; then
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    error "Uncommitted changes detected. Commit your changes or use --force"
  fi
  if [ -n "$(git status --porcelain)" ]; then
    warn "Untracked files detected"
    git status --short
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi
fi

# Check node_modules exist
if [ ! -d "node_modules" ]; then
  error "node_modules not found. Run 'npm install' first"
fi

# Verify npm workspace installation (hoisted deps in root node_modules)
# Note: npm workspaces hoist dependencies to root, so api/node_modules may not exist
if [ ! -f "package-lock.json" ]; then
  error "package-lock.json not found. Run 'npm install' first"
fi

log "Pre-flight checks passed"

# ============================================
# Step 1.5: Check/Run Server Setup
# ============================================
step "Checking server setup..."

# Check if .env exists (indicates server is set up)
SERVER_SETUP_NEEDED=$(ssh "${SERVER_USER}@${SERVER_HOST}" "[ -f '${SERVER_DEPLOY_DIR}/shared/.env' ] && echo 'no' || echo 'yes'" 2>/dev/null)

if [ "$SERVER_SETUP_NEEDED" = "yes" ]; then
  log "First-time deployment detected - running server setup..."

  if [ "$DRY_RUN" = true ]; then
    dry_run "Would upload and run setup-mittonvillage.sh --non-interactive"
  else
    # Upload setup script
    rsync -avz "$PROJECT_ROOT/scripts/deploy/setup-mittonvillage.sh" "${SERVER_USER}@${SERVER_HOST}:/tmp/"

    # Run setup in non-interactive mode (attempts SSL, continues if DNS not ready)
    ssh "${SERVER_USER}@${SERVER_HOST}" "chmod +x /tmp/setup-mittonvillage.sh && /tmp/setup-mittonvillage.sh --non-interactive"

    log "Server setup complete"
  fi
else
  log "Server already configured"
fi

# ============================================
# Step 2: Build frontend
# ============================================
if [ "$SKIP_BUILD" = false ]; then
  step "Building frontend..."

  if [ "$DRY_RUN" = true ]; then
    dry_run "Would run: npm run build -w frontend"
  else
    cd "$PROJECT_ROOT"
    npm run build -w frontend
    log "Frontend build complete"
  fi
else
  warn "Skipping frontend build (--skip-build)"
fi

# Verify build output exists
if [ "$DRY_RUN" = false ] && [ ! -d "$PROJECT_ROOT/frontend/dist" ]; then
  error "Frontend build output not found at frontend/dist"
fi

# ============================================
# Step 3: Create tarball
# ============================================
step "Creating deployment tarball..."

cd "$PROJECT_ROOT"

# Files and directories to include
INCLUDE_PATHS=(
  "api/src"
  "api/package.json"
  "frontend/dist"
  "frontend/package.json"
  "shared"
  "package.json"
  "package-lock.json"
  "ecosystem.config.js"
  "scripts/deploy/install-remote.sh"
  "scripts/deploy/setup-mittonvillage.sh"
)

if [ "$DRY_RUN" = true ]; then
  dry_run "Would create tarball: $TARBALL_PATH"
  dry_run "Including: ${INCLUDE_PATHS[*]}"
  dry_run "Excluding: */originals/* (source images not needed in production)"
else
  # Build array of paths to include
  TAR_PATHS=()
  for path in "${INCLUDE_PATHS[@]}"; do
    if [ -e "$path" ]; then
      TAR_PATHS+=("$path")
    else
      warn "Path not found, skipping: $path"
    fi
  done

  # Exclude originals directories from tarball - these contain full-resolution
  # AI-generated source images (~80MB) that are only needed for reprocessing.
  # Production only needs the resized variants.
  tar -czf "$TARBALL_PATH" \
    --exclude='*/originals/*' \
    "${TAR_PATHS[@]}"

  TARBALL_SIZE=$(du -h "$TARBALL_PATH" | cut -f1)
  log "Created tarball: $TARBALL_NAME ($TARBALL_SIZE)"
fi

# ============================================
# Step 4: Upload to server
# ============================================
step "Uploading to server..."

if [ "$DRY_RUN" = true ]; then
  dry_run "Would upload: $TARBALL_PATH -> ${SERVER_USER}@${SERVER_HOST}:/tmp/"
  dry_run "Would upload: install-remote.sh -> ${SERVER_USER}@${SERVER_HOST}:${SERVER_DEPLOY_DIR}/"
else
  # Upload tarball with optimized settings for large file transfers
  # Key optimizations:
  # - scp instead of rsync: no delta/checksum overhead for new files
  # - aes128-gcm cipher: fastest authenticated cipher
  # - Compression=no: file is already gzipped
  # - IPQoS=throughput: optimize for bandwidth over latency
  # - TCPKeepAlive/ServerAliveInterval: prevent connection drops
  SSH_OPTS="-c aes128-gcm@openssh.com -o Compression=no -o IPQoS=throughput -o TCPKeepAlive=yes -o ServerAliveInterval=60"

  TARBALL_SIZE_BYTES=$(stat -c%s "$TARBALL_PATH" 2>/dev/null || stat -f%z "$TARBALL_PATH")
  TARBALL_SIZE_MB=$((TARBALL_SIZE_BYTES / 1024 / 1024))

  # Always show progress bar with pv if available
  if command -v pv >/dev/null 2>&1; then
    log "Uploading ${TARBALL_SIZE_MB}MB with progress..."
    pv -pterab "$TARBALL_PATH" | ssh $SSH_OPTS "${SERVER_USER}@${SERVER_HOST}" "cat > /tmp/${TARBALL_NAME}"
  else
    # Fallback: scp with verbose output for progress indication
    log "Uploading ${TARBALL_SIZE_MB}MB... (install 'pv' for progress bar)"
    scp $SSH_OPTS -v -O "$TARBALL_PATH" "${SERVER_USER}@${SERVER_HOST}:/tmp/" 2>&1 | \
      grep -E "^(Sending|Transferred)" || true
  fi

  # Upload install script (small file, compression doesn't matter)
  rsync -avz "$PROJECT_ROOT/scripts/deploy/install-remote.sh" "${SERVER_USER}@${SERVER_HOST}:${SERVER_DEPLOY_DIR}/"

  log "Upload complete"
fi

# ============================================
# Step 5: Execute remote installation
# ============================================
step "Executing remote installation..."

if [ "$DRY_RUN" = true ]; then
  dry_run "Would SSH to ${SERVER_HOST} and execute:"
  dry_run "  chmod +x ${SERVER_DEPLOY_DIR}/install-remote.sh"
  dry_run "  ${SERVER_DEPLOY_DIR}/install-remote.sh --tarball /tmp/${TARBALL_NAME} --version ${VERSION_TAG}"
else
  ssh "${SERVER_USER}@${SERVER_HOST}" << REMOTE_SCRIPT
    set -e
    chmod +x "${SERVER_DEPLOY_DIR}/install-remote.sh"
    "${SERVER_DEPLOY_DIR}/install-remote.sh" --tarball "/tmp/${TARBALL_NAME}" --version "${VERSION_TAG}"
REMOTE_SCRIPT

  log "Remote installation complete"
fi

# ============================================
# Step 5.5: Refresh database (optional - DANGEROUS)
# ============================================
if [ "$REFRESH_DB" = true ]; then
  step "DANGEROUS: Refreshing production database..."

  echo ""
  echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║                    ⚠️  WARNING ⚠️                            ║${NC}"
  echo -e "${RED}║                                                            ║${NC}"
  echo -e "${RED}║  This will PERMANENTLY DELETE all data in the modia       ║${NC}"
  echo -e "${RED}║  database including:                                      ║${NC}"
  echo -e "${RED}║    - All user accounts                                    ║${NC}"
  echo -e "${RED}║    - All characters and progress                          ║${NC}"
  echo -e "${RED}║    - All marketplace listings                             ║${NC}"
  echo -e "${RED}║    - All guilds and clans                                 ║${NC}"
  echo -e "${RED}║    - ALL OTHER DATA                                       ║${NC}"
  echo -e "${RED}║                                                            ║${NC}"
  echo -e "${RED}║  Only the 'modia' database will be affected.              ║${NC}"
  echo -e "${RED}║  Other databases on the server will NOT be touched.       ║${NC}"
  echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    dry_run "Would drop and recreate the 'modia' database"
    dry_run "Would run: DROP DATABASE modia; CREATE DATABASE modia;"
  else
    # Require explicit confirmation
    echo -e "${YELLOW}Type 'DELETE MODIA DATABASE' to confirm:${NC}"
    read -r CONFIRM_TEXT

    if [ "$CONFIRM_TEXT" != "DELETE MODIA DATABASE" ]; then
      error "Confirmation text did not match. Aborting database refresh."
    fi

    echo ""
    log "Dropping and recreating modia database..."

    ssh "${SERVER_USER}@${SERVER_HOST}" << 'REFRESH_SCRIPT'
      set -e

      # Load environment to get database credentials
      if [ -f <APP_DIR>/shared/.env ]; then
        source <APP_DIR>/shared/.env
      else
        echo "ERROR: .env file not found"
        exit 1
      fi

      # Extract database name from DATABASE_URL or use default
      # DATABASE_URL format: postgres://user:pass@host:port/dbname
      if [ -n "$DATABASE_URL" ]; then
        DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*://[^/]+/([^?]+).*|\1|')
      else
        DB_NAME="${DB_NAME:-modia}"
      fi

      # Safety check: Only allow dropping 'modia' or 'modia_production' database
      if [ "$DB_NAME" != "modia" ] && [ "$DB_NAME" != "modia_production" ]; then
        echo "ERROR: Database name is '$DB_NAME', not 'modia' or 'modia_production'. Refusing to drop for safety."
        exit 1
      fi

      echo "Verified database name: $DB_NAME"
      echo ""

      # Get postgres user from DATABASE_URL or use default
      if [ -n "$DATABASE_URL" ]; then
        DB_USER=$(echo "$DATABASE_URL" | sed -E 's|.*://([^:]+):.*|\1|')
        DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):.*|\1|')
        DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
      else
        DB_USER="${DB_USER:-modia}"
        DB_HOST="${DB_HOST:-localhost}"
        DB_PORT="${DB_PORT:-5432}"
      fi

      echo "Terminating active connections to $DB_NAME database..."
      sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>/dev/null || true

      echo "Dropping $DB_NAME database..."
      sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;"

      echo "Creating fresh $DB_NAME database..."
      sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

      echo ""
      echo "Database '$DB_NAME' has been refreshed (dropped and recreated)."
REFRESH_SCRIPT

    log "Database refresh complete - modia database is now empty"

    # Auto-enable reseed since database is empty
    if [ "$RESEED" = false ]; then
      warn "Auto-enabling --reseed since database was refreshed"
      RESEED=true
    fi
  fi
fi

# ============================================
# Step 6: Run migrations and reseed (optional)
# ============================================
if [ "$RESEED" = true ]; then
  step "Running migrations and reseeding database..."

  if [ "$DRY_RUN" = true ]; then
    dry_run "Would SSH to ${SERVER_HOST} and execute:"
    dry_run "  cd ${SERVER_DEPLOY_DIR}/current && npm run db:migrate && npm run db:seed"
  else
    ssh "${SERVER_USER}@${SERVER_HOST}" << RESEED_SCRIPT
      set -e
      cd "${SERVER_DEPLOY_DIR}/current"

      echo "Running database migrations..."
      npm run db:migrate

      echo ""
      echo "Reseeding database..."
      npm run db:seed

      echo ""
      echo "Database refresh complete!"
RESEED_SCRIPT

    log "Database migrations and reseed complete"
  fi
fi

# ============================================
# Step 7: Health check
# ============================================
step "Verifying deployment (health check)..."

HEALTH_URL="https://modia-api.mittonvillage.com/api/health"

if [ "$DRY_RUN" = true ]; then
  dry_run "Would check: $HEALTH_URL"
else
  sleep 3

  MAX_RETRIES=10
  RETRY_DELAY=5

  for i in $(seq 1 $MAX_RETRIES); do
    HEALTH_RESPONSE=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "failed")

    if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
      log "Health check passed!"
      break
    fi

    if [ "$i" -eq "$MAX_RETRIES" ]; then
      error "Health check failed after $MAX_RETRIES attempts"
    fi

    warn "Health check attempt $i failed, retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
  done
fi

# ============================================
# Step 8: Cleanup and summary
# ============================================
if [ "$DRY_RUN" = false ]; then
  # Clean up local tarball
  rm -f "$TARBALL_PATH"
fi

echo ""
log "========================================"
log "Deployment successful!"
log "========================================"
echo ""
echo "Version:   ${VERSION_TAG}"
echo "Server:    ${SERVER_USER}@${SERVER_HOST}"
echo "Frontend:  https://modia.mittonvillage.com"
echo "API:       https://modia-api.mittonvillage.com"
echo ""
echo "To rollback:"
echo "  ssh ${SERVER_USER}@${SERVER_HOST} '${SERVER_DEPLOY_DIR}/install-remote.sh --rollback'"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${CYAN}This was a dry run. No changes were made.${NC}"
  echo ""
fi
