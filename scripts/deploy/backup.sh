#!/bin/bash
#
# Modia PostgreSQL Backup Script
#
# Creates compressed database backups with:
# - Timestamped filenames
# - Backup verification
# - Retention policy (default: 7 days)
# - Optional S3 upload
#
# Usage: ./backup.sh [--retention 7] [--s3 bucket-name]
#
# Recommended cron setup (daily at 3 AM):
#   0 3 * * * /var/www/modia/scripts/deploy/backup.sh >> /var/www/modia/shared/logs/backup.log 2>&1
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
BACKUP_DIR="/var/www/modia/backups/postgres"
SHARED_DIR="/var/www/modia/shared"
RETENTION_DAYS=7
S3_BUCKET=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --retention)
      RETENTION_DAYS="$2"
      shift 2
      ;;
    --s3)
      S3_BUCKET="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

log() {
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${GREEN}[BACKUP]${NC} $1"
}

warn() {
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${YELLOW}[WARN]${NC} $1"
}

error() {
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${RED}[ERROR]${NC} $1"
  exit 1
}

# Load environment variables
if [ -f "$SHARED_DIR/.env" ]; then
  export $(grep -v '^#' "$SHARED_DIR/.env" | xargs)
fi

# Validate required variables
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  error "Database configuration not found. Check $SHARED_DIR/.env"
fi

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

# Generate backup filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/modia_backup_${TIMESTAMP}.dump"

log "Starting database backup..."
log "Database: $DB_NAME @ $DB_HOST"
log "Backup file: $BACKUP_FILE"

# Create backup using pg_dump with custom format (compressed)
export PGPASSWORD="$DB_PASSWORD"
pg_dump \
  -h "$DB_HOST" \
  -p "${DB_PORT:-5432}" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -Fc \
  -f "$BACKUP_FILE"

unset PGPASSWORD

# Get backup size
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "Backup created: $BACKUP_SIZE"

# Verify backup integrity
log "Verifying backup integrity..."
export PGPASSWORD="$DB_PASSWORD"
if pg_restore --list "$BACKUP_FILE" > /dev/null 2>&1; then
  log "Backup verification passed!"
else
  error "Backup verification FAILED!"
fi
unset PGPASSWORD

# Upload to S3 if configured
if [ -n "$S3_BUCKET" ]; then
  if command -v aws &> /dev/null; then
    log "Uploading to S3: s3://$S3_BUCKET/backups/"
    aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/backups/$(basename "$BACKUP_FILE")"
    log "S3 upload complete"
  else
    warn "AWS CLI not installed, skipping S3 upload"
  fi
fi

# Cleanup old backups
log "Cleaning up backups older than $RETENTION_DAYS days..."
DELETED_COUNT=$(find "$BACKUP_DIR" -name "*.dump" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED_COUNT" -gt 0 ]; then
  log "Deleted $DELETED_COUNT old backup(s)"
else
  log "No old backups to delete"
fi

# List current backups
log "Current backups:"
ls -lh "$BACKUP_DIR"/*.dump 2>/dev/null | tail -5 || echo "  (none)"

# Calculate total backup size
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
log "Total backup storage: $TOTAL_SIZE"

log "Backup complete!"
