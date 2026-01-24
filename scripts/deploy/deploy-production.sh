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
#   --help            Show this help message
#
# Example:
#   ./deploy-production.sh --version v1.0.0
#   ./deploy-production.sh --dry-run --version v1.0.0
#   ./deploy-production.sh --skip-build
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
SERVER_USER="root"
SERVER_HOST="mittonvillage.com"
SERVER_DEPLOY_DIR="/var/www/modia"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Default values
DRY_RUN=false
SKIP_BUILD=false
VERSION=""
FORCE=false

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
    --help|-h)
      head -24 "$0" | tail -20
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

  tar -czf "$TARBALL_PATH" "${TAR_PATHS[@]}"

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
  # Upload tarball
  rsync -avz --progress "$TARBALL_PATH" "${SERVER_USER}@${SERVER_HOST}:/tmp/"

  # Upload install script
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
# Step 6: Health check
# ============================================
step "Verifying deployment..."

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
# Step 7: Cleanup and summary
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
