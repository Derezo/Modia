#!/bin/bash
#
# Modia Server Setup Script for mittonvillage.com
#
# One-time setup for Modia production deployment (idempotent - safe to re-run):
# - Creates directory structure
# - Creates PostgreSQL user and database (using system service)
# - Generates production .env with secure defaults
# - Installs nginx site configurations
# - Obtains SSL certificates via certbot
#
# Usage: ./setup-mittonvillage.sh [options]
#
# Options:
#   --skip-ssl          Skip SSL certificate setup
#   --skip-db           Skip database setup
#   --non-interactive   Run without prompts (auto-generates passwords, skips SSL)
#   --dry-run           Show what would happen without executing
#   --help              Show this help message
#
# Prerequisites:
# - Ubuntu 24.04+ with nginx, PostgreSQL, PM2, and Node.js installed
# - DNS A records pointing to this server:
#   - modia.mittonvillage.com
#   - modia-api.mittonvillage.com
# - Run as root or with sudo
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
APP_DIR="/var/www/modia"
DOMAIN_FRONTEND="modia.mittonvillage.com"
DOMAIN_API="modia-api.mittonvillage.com"
DB_NAME="modia_production"
DB_USER="modia"

# Default values
SKIP_SSL=false
SKIP_DB=false
DRY_RUN=false
NON_INTERACTIVE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-ssl)
      SKIP_SSL=true
      shift
      ;;
    --skip-db)
      SKIP_DB=true
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      head -31 "$0" | tail -27
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

log() {
  echo -e "${GREEN}[SETUP]${NC} $1"
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

# Check root
if [ "$EUID" -ne 0 ] && [ "$DRY_RUN" = false ]; then
  error "Please run as root or with sudo"
fi

echo ""
echo "=========================================="
echo "  Modia Server Setup - mittonvillage.com"
echo "=========================================="
echo ""
echo "Frontend:        $DOMAIN_FRONTEND"
echo "API:             $DOMAIN_API"
echo "App Dir:         $APP_DIR"
echo "Database:        $DB_NAME"
echo "Dry Run:         $DRY_RUN"
echo "Non-Interactive: $NON_INTERACTIVE"
echo ""

# ============================================
# Step 1: Create directory structure
# ============================================
step "Creating directory structure..."

DIRS=(
  "$APP_DIR"
  "$APP_DIR/releases"
  "$APP_DIR/shared"
  "$APP_DIR/shared/logs"
  "$APP_DIR/backups"
)

for dir in "${DIRS[@]}"; do
  if [ "$DRY_RUN" = true ]; then
    if [ -d "$dir" ]; then
      dry_run "Directory exists: $dir"
    else
      dry_run "Would create: $dir"
    fi
  else
    if [ -d "$dir" ]; then
      log "Directory exists: $dir"
    else
      mkdir -p "$dir"
      log "Created: $dir"
    fi
  fi
done

# ============================================
# Step 2: Setup PostgreSQL database
# ============================================
if [ "$SKIP_DB" = false ]; then
  step "Setting up PostgreSQL database..."

  # Generate secure password
  DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)

  if [ "$DRY_RUN" = true ]; then
    dry_run "Would create PostgreSQL user: $DB_USER"
    dry_run "Would create database: $DB_NAME"
    dry_run "Generated password: [hidden]"
  else
    # Check if user exists
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
      log "PostgreSQL user '$DB_USER' already exists"
      if [ "$NON_INTERACTIVE" = true ]; then
        # In non-interactive mode, generate new password and update
        sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD'"
        log "Password reset for user: $DB_USER"
      else
        # Interactive: ask for existing password
        warn "User exists - you'll need to provide the existing password for .env"
        read -p "Enter existing DB password (or press Enter to reset): " -s EXISTING_PASS
        echo
        if [ -n "$EXISTING_PASS" ]; then
          DB_PASSWORD="$EXISTING_PASS"
        else
          sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD'"
          log "Password reset for user: $DB_USER"
        fi
      fi
    else
      sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD'"
      log "Created PostgreSQL user: $DB_USER"
    fi

    # Check if database exists
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
      log "Database '$DB_NAME' already exists"
    else
      sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
      log "Created database: $DB_NAME"
    fi

    # Grant privileges
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER"
    sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER"
  fi
else
  warn "Skipping database setup (--skip-db)"
  DB_PASSWORD="REPLACE_WITH_YOUR_PASSWORD"
fi

# ============================================
# Step 3: Generate .env file
# ============================================
step "Generating production .env file..."

# Generate JWT secrets
JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)
JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)
WORLD_SEED=$((RANDOM * RANDOM))

ENV_FILE="$APP_DIR/shared/.env"

if [ "$DRY_RUN" = true ]; then
  dry_run "Would create: $ENV_FILE"
  dry_run "JWT secrets would be generated"
else
  SHOULD_CREATE_ENV=false

  if [ -f "$ENV_FILE" ]; then
    if [ "$NON_INTERACTIVE" = true ]; then
      log "Keeping existing .env file (non-interactive mode)"
      JWT_SECRET="[EXISTING]"
      JWT_REFRESH_SECRET="[EXISTING]"
      DB_PASSWORD="[EXISTING]"
    else
      warn ".env file already exists at $ENV_FILE"
      read -p "Overwrite? (y/N) " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        SHOULD_CREATE_ENV=true
      else
        log "Keeping existing .env"
        JWT_SECRET="[EXISTING]"
        JWT_REFRESH_SECRET="[EXISTING]"
        DB_PASSWORD="[EXISTING]"
      fi
    fi
  else
    SHOULD_CREATE_ENV=true
  fi

  if [ "$SHOULD_CREATE_ENV" = true ]; then
    cat > "$ENV_FILE" << EOF
# Modia Production Environment
# Generated: $(date)
# Server: mittonvillage.com

# Server
NODE_ENV=production
PORT=3000
TRUST_PROXY=true

# Database (system PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# JWT Authentication
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_REFRESH_EXPIRES_IN=7d

# World Generation (change for different world layouts)
WORLD_SEED=$WORLD_SEED

# CORS - Allow frontend domain
CORS_ORIGIN=https://$DOMAIN_FRONTEND

# Logging (set to 'true' for debug output)
DEBUG=false

# Rate Limiting (production defaults)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Audio/Image Generation (optional - for asset generation scripts)
# SUNO_API_KEY=
# ELEVENLABS_API_KEY=
# HUGGINGFACE_API_TOKEN=
EOF

    chmod 600 "$ENV_FILE"
    log "Created .env at: $ENV_FILE"
  fi
fi

# ============================================
# Step 4: Install nginx configurations
# ============================================
step "Installing nginx configurations..."

NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

# Frontend config
NGINX_FRONTEND_CONF="$NGINX_AVAILABLE/modia"
if [ "$DRY_RUN" = true ]; then
  dry_run "Would install: $NGINX_FRONTEND_CONF"
else
  cat > "$NGINX_FRONTEND_CONF" << 'EOF'
# Modia Frontend - modia.mittonvillage.com
# Serves static files with SPA fallback and proxies API/WS requests

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=modia_frontend:10m rate=10r/s;

server {
    listen 80;
    listen [::]:80;
    server_name modia.mittonvillage.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name modia.mittonvillage.com;

    # SSL configuration (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/modia.mittonvillage.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/modia.mittonvillage.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Document root
    root /var/www/modia/current/frontend/dist;
    index index.html;

    # Hide nginx version
    server_tokens off;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml;

    # Static assets with long cache (Vite hash-busted)
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # API proxy (same-origin pattern)
    location /api/ {
        limit_req zone=modia_frontend burst=20 nodelay;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 1-hour timeout for WebSocket connections (consistent with API config)
        proxy_connect_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }

    # SPA fallback - serve index.html for all non-file routes
    location / {
        limit_req zone=modia_frontend burst=50 nodelay;
        try_files $uri $uri/ /index.html;
    }

    # Deny access to hidden files
    location ~ /\. {
        deny all;
    }

    # Access and error logs
    access_log /var/log/nginx/modia.access.log;
    error_log /var/log/nginx/modia.error.log;
}
EOF
  log "Installed: $NGINX_FRONTEND_CONF"
fi

# API config
NGINX_API_CONF="$NGINX_AVAILABLE/modia-api"
if [ "$DRY_RUN" = true ]; then
  dry_run "Would install: $NGINX_API_CONF"
else
  cat > "$NGINX_API_CONF" << 'EOF'
# Modia API - modia-api.mittonvillage.com
# Proxies all requests to Node.js backend with WebSocket support

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=modia_api_auth:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=modia_api_general:10m rate=10r/s;

server {
    listen 80;
    listen [::]:80;
    server_name modia-api.mittonvillage.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name modia-api.mittonvillage.com;

    # SSL configuration (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/modia-api.mittonvillage.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/modia-api.mittonvillage.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Hide nginx version
    server_tokens off;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # CORS headers for cross-origin requests
    add_header Access-Control-Allow-Origin "https://modia.mittonvillage.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With" always;
    add_header Access-Control-Allow-Credentials "true" always;

    # Handle preflight requests
    if ($request_method = 'OPTIONS') {
        add_header Access-Control-Allow-Origin "https://modia.mittonvillage.com";
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS";
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With";
        add_header Access-Control-Allow-Credentials "true";
        add_header Access-Control-Max-Age 1728000;
        add_header Content-Type "text/plain charset=UTF-8";
        add_header Content-Length 0;
        return 204;
    }

    # Health check endpoint (no rate limiting)
    location /api/health {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Auth endpoints (stricter rate limiting)
    location ~ ^/api/auth/(login|register|refresh) {
        limit_req zone=modia_api_auth burst=10 nodelay;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 1-hour timeout for WebSocket connections (reconnects if idle)
        proxy_connect_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }

    # General API endpoints
    location /api/ {
        limit_req zone=modia_api_general burst=30 nodelay;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Catch-all for non-API requests
    location / {
        return 404;
    }

    # Access and error logs
    access_log /var/log/nginx/modia-api.access.log;
    error_log /var/log/nginx/modia-api.error.log;
}
EOF
  log "Installed: $NGINX_API_CONF"
fi

# ============================================
# Step 5: Enable nginx sites
# ============================================
step "Enabling nginx sites..."

if [ "$DRY_RUN" = true ]; then
  dry_run "Would enable: modia"
  dry_run "Would enable: modia-api"
  dry_run "Would test nginx configuration"
  dry_run "Would reload nginx"
else
  # Enable sites
  ln -sf "$NGINX_FRONTEND_CONF" "$NGINX_ENABLED/modia"
  ln -sf "$NGINX_API_CONF" "$NGINX_ENABLED/modia-api"
  log "Enabled nginx sites"

  # Test configuration (don't fail if SSL certs don't exist yet)
  if nginx -t 2>/dev/null; then
    nginx -s reload
    log "Nginx configuration reloaded"
  else
    warn "Nginx config test failed - likely missing SSL certificates"
    warn "Run certbot after DNS is configured to obtain certificates"
  fi
fi

# ============================================
# Step 6: Setup SSL certificates
# ============================================
if [ "$SKIP_SSL" = false ]; then
  step "Setting up SSL certificates..."

  if [ "$DRY_RUN" = true ]; then
    dry_run "Would run certbot for: $DOMAIN_FRONTEND $DOMAIN_API"
  else
    # Check if certificates already exist
    if [ -f "/etc/letsencrypt/live/$DOMAIN_FRONTEND/fullchain.pem" ] && \
       [ -f "/etc/letsencrypt/live/$DOMAIN_API/fullchain.pem" ]; then
      log "SSL certificates already exist"
    else
      warn "SSL certificates not found"

      if [ "$NON_INTERACTIVE" = true ]; then
        # In non-interactive mode, attempt certbot automatically
        log "Attempting to obtain SSL certificates..."
        if certbot --nginx -d "$DOMAIN_FRONTEND" -d "$DOMAIN_API" --non-interactive --agree-tos --email "admin@mittonvillage.com" 2>/dev/null; then
          log "SSL certificates obtained successfully!"
        else
          warn "Certbot failed - DNS may not be configured yet"
          warn "HTTPS will not work until you run:"
          warn "  certbot --nginx -d $DOMAIN_FRONTEND -d $DOMAIN_API"
        fi
      else
        echo ""
        echo "To obtain certificates, run:"
        echo "  certbot --nginx -d $DOMAIN_FRONTEND -d $DOMAIN_API"
        echo ""
        echo "Make sure DNS records are configured first:"
        echo "  $DOMAIN_FRONTEND -> [server IP]"
        echo "  $DOMAIN_API -> [server IP]"
        echo ""
        read -p "Attempt to obtain certificates now? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
          certbot --nginx -d "$DOMAIN_FRONTEND" -d "$DOMAIN_API" --non-interactive --agree-tos --email "admin@mittonvillage.com" || {
            warn "Certbot failed - you may need to configure DNS first"
          }
        fi
      fi
    fi
  fi
else
  warn "Skipping SSL setup (--skip-ssl)"
fi

# ============================================
# Step 7: Set permissions
# ============================================
step "Setting permissions..."

if [ "$DRY_RUN" = true ]; then
  dry_run "Would set ownership of $APP_DIR"
else
  # Ensure www-data can read
  chown -R root:www-data "$APP_DIR"
  chmod -R 755 "$APP_DIR"
  chmod 600 "$ENV_FILE"
  log "Permissions set"
fi

# ============================================
# Summary
# ============================================
echo ""
log "========================================"
log "Server setup complete!"
log "========================================"
echo ""
echo "Directory structure:"
echo "  $APP_DIR/"
echo "  +-- releases/      # Timestamped release directories"
echo "  +-- shared/"
echo "  |   +-- .env       # Production environment"
echo "  |   +-- logs/      # PM2 log files"
echo "  +-- backups/       # Database backups"
echo "  +-- current -> releases/xxx  # Active release symlink"
echo ""
echo "Database:"
echo "  Host:     localhost:5432"
echo "  Database: $DB_NAME"
echo "  User:     $DB_USER"
echo ""
echo "Nginx sites:"
echo "  $DOMAIN_FRONTEND -> /var/www/modia/current/frontend/dist"
echo "  $DOMAIN_API -> localhost:3000"
echo ""

if [ "$DRY_RUN" = false ]; then
  echo "Next steps:"
  echo "  1. Verify DNS records point to this server"
  echo "  2. Run certbot if SSL certificates were not obtained"
  echo "  3. Review and customize: $ENV_FILE"
  echo "  4. Deploy from local machine:"
  echo "     ./scripts/deploy/deploy-production.sh --version v1.0.0"
  echo ""
fi

if [ "$DRY_RUN" = true ]; then
  echo -e "${CYAN}This was a dry run. No changes were made.${NC}"
  echo ""
fi
