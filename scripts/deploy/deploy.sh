#!/bin/bash
#
# Modia Deployment Script
#
# Deploys the application with zero-downtime using PM2 reload:
# - Creates timestamped release directory
# - Clones repository and installs dependencies
# - Builds frontend with Vite
# - Runs database migrations
# - Swaps symlink atomically
# - Reloads PM2 gracefully
# - Cleans up old releases
#
# Usage: ./deploy.sh [--branch main] [--tag v1.0.0] [--skip-build]
#
# Options:
#   --branch <name>   Git branch to deploy (default: main)
#   --tag <name>      Git tag to deploy (overrides branch)
#   --skip-build      Skip npm install and build (for quick redeploy)
#   --rollback        Rollback to previous release
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
REPO_URL="https://github.com/YOUR_USERNAME/Modia.git"  # Update this!
KEEP_RELEASES=5

# Default values
BRANCH="main"
TAG=""
SKIP_BUILD=false
ROLLBACK=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --rollback)
      ROLLBACK=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
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

# Handle rollback
if [ "$ROLLBACK" = true ]; then
  log "Rolling back to previous release..."

  # Get previous release
  PREVIOUS=$(ls -t "$RELEASES_DIR" | sed -n '2p')

  if [ -z "$PREVIOUS" ]; then
    error "No previous release found to rollback to"
  fi

  log "Rolling back to: $PREVIOUS"
  ln -sfn "$RELEASES_DIR/$PREVIOUS" "$CURRENT_LINK"

  step "Reloading PM2..."
  cd "$CURRENT_LINK"
  pm2 reload ecosystem.config.js --env production || pm2 start ecosystem.config.js --env production

  log "Rollback complete!"
  exit 0
fi

# Verify environment
if [ ! -f "$SHARED_DIR/.env" ]; then
  error "No .env file found at $SHARED_DIR/.env"
fi

# Create release timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RELEASE_DIR="$RELEASES_DIR/$TIMESTAMP"

log "Starting deployment: $TIMESTAMP"
log "Branch: ${TAG:-$BRANCH}"

# 1. Create release directory
step "Creating release directory..."
mkdir -p "$RELEASE_DIR"

# 2. Clone repository
step "Cloning repository..."
if [ -n "$TAG" ]; then
  git clone --depth 1 --branch "$TAG" "$REPO_URL" "$RELEASE_DIR"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR"
fi

# 3. Link shared .env
step "Linking shared .env..."
ln -sf "$SHARED_DIR/.env" "$RELEASE_DIR/.env"

# 4. Install dependencies and build
if [ "$SKIP_BUILD" = false ]; then
  step "Installing dependencies..."
  cd "$RELEASE_DIR"
  npm ci --production=false  # Need dev deps for build

  step "Building frontend..."
  npm run build -w frontend

  # Remove dev dependencies to save space
  step "Pruning dev dependencies..."
  npm prune --production
else
  warn "Skipping build (--skip-build)"
fi

# 5. Run database migrations
step "Running database migrations..."
cd "$RELEASE_DIR"
npm run db:migrate

# 6. Swap current symlink (atomic operation)
step "Swapping current symlink..."
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

# 7. Reload PM2 (zero-downtime)
step "Reloading PM2..."
cd "$CURRENT_LINK"
if pm2 list | grep -q "modia-api"; then
  pm2 reload ecosystem.config.js --env production
else
  pm2 start ecosystem.config.js --env production
fi

# Save PM2 process list
pm2 save

# 8. Health check
step "Verifying deployment..."
sleep 3  # Give server time to start

HEALTH_URL="http://localhost:3000/api/health"
HEALTH_RESPONSE=$(curl -sf "$HEALTH_URL" || echo "failed")

if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
  log "Health check passed!"
else
  error "Health check failed! Response: $HEALTH_RESPONSE"
fi

# 9. Cleanup old releases
step "Cleaning up old releases..."
cd "$RELEASES_DIR"
RELEASE_COUNT=$(ls -1 | wc -l)
if [ "$RELEASE_COUNT" -gt "$KEEP_RELEASES" ]; then
  RELEASES_TO_DELETE=$((RELEASE_COUNT - KEEP_RELEASES))
  ls -t | tail -n "$RELEASES_TO_DELETE" | xargs rm -rf
  log "Removed $RELEASES_TO_DELETE old release(s)"
fi

# 10. Summary
echo ""
log "========================================"
log "Deployment complete!"
log "========================================"
echo ""
echo "Release: $TIMESTAMP"
echo "Current: $CURRENT_LINK -> $RELEASE_DIR"
echo ""
echo "PM2 status:"
pm2 list
echo ""
echo "To rollback: ./deploy.sh --rollback"
echo ""
