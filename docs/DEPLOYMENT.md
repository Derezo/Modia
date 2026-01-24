# Modia Production Deployment Guide

This document provides comprehensive instructions for deploying Modia to production at mittonvillage.com.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Server Compatibility](#server-compatibility)
4. [First-Time Setup](#first-time-setup)
5. [Deployment Workflow](#deployment-workflow)
6. [Rollback Procedures](#rollback-procedures)
7. [Troubleshooting](#troubleshooting)
8. [Security Considerations](#security-considerations)
9. [Architecture Diagram](#architecture-diagram)

---

## Overview

Modia uses a **release-based deployment strategy** with:

- **Timestamped release directories** for clean rollbacks
- **Atomic symlink swaps** for zero-downtime deployments
- **PM2 cluster mode** with graceful reloads
- **Automatic rollback** on health check failure
- **Shared resources** (.env, logs) persisted across releases

```
/var/www/modia/
├── releases/           # Timestamped release directories
│   ├── 20260123_143000/
│   └── 20260123_150000/
├── shared/
│   ├── .env           # Production environment (persisted)
│   └── logs/          # PM2 log files (persisted)
├── current -> releases/20260123_150000/  # Active release
└── backups/           # Database backups
```

---

## Prerequisites

### Local Machine

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Node.js | 18+ | `node -v` |
| npm | 8+ | `npm -v` |
| SSH access | - | `ssh root@mittonvillage.com` |
| rsync | - | `rsync --version` |

### Server (mittonvillage.com)

| Requirement | Version | Status |
|-------------|---------|--------|
| Ubuntu | 24.04 LTS | Verified |
| Node.js | v20.20.0 | Verified |
| npm | 10.8.2 | Verified |
| PM2 | 6.0.14+ | Verified |
| nginx | 1.24.0+ | Verified |
| PostgreSQL | 16.x | System service (not Docker) |
| Redis | 7.0.15 | Available at localhost:6379 |

### DNS Configuration

Before first deployment, configure DNS A records:

| Subdomain | Points To | Purpose |
|-----------|-----------|---------|
| `modia.mittonvillage.com` | Server IP | Frontend (static files) |
| `modia-api.mittonvillage.com` | Server IP | API (Node.js backend) |

---

## Server Compatibility

### Resource Analysis (Validated via SSH)

| Resource | Total | Used | Available | Modia Needs | Status |
|----------|-------|------|-----------|-------------|--------|
| Memory | 3.8 GB | 1.0 GB | 2.8 GB | ~512 MB (1 instance) | OK |
| Disk | 79 GB | 30 GB | 45 GB | ~2 GB per release | OK |
| CPUs | 2 | - | 2 | 1 (single instance) | OK |
| Port 3000 | - | - | Free | Required | OK |

### Existing Services

Other services running on the server (no conflicts):

| Service | Port | Memory |
|---------|------|--------|
| accounting-api | 3100 | 284 MB |
| chatbot-api (x2) | - | 232 MB |
| chatbot-webhook-worker | - | 76 MB |
| galaxy-miner | 3388 | 73 MB |
| pm2-logrotate | - | 69 MB |

### Database Compatibility

- PostgreSQL runs as a **system service** (not Docker)
- Existing databases: `accounting_api_production`, `chatbot_api_production`
- Modia creates: `modia_production` database
- Setup script uses `sudo -u postgres psql` for database creation

---

## First-Time Setup

### Single-Command Deployment

From your local machine, run:

```bash
./scripts/deploy/deploy-production.sh --version v1.0.0
```

The deployment script automatically detects first-time setup and handles everything:
1. Checks if server is configured (looks for `/var/www/modia/shared/.env`)
2. If not configured, uploads and runs `setup-mittonvillage.sh --non-interactive`
3. Creates directory structure at `/var/www/modia/`
4. Creates PostgreSQL database and user
5. Generates production `.env` with secure secrets
6. Installs nginx site configurations
7. **Attempts SSL certificate setup via certbot** (continues if DNS not ready)
8. Proceeds with normal deployment (build, upload, install)
9. Runs database migrations
10. Seeds the world (if database is empty)

### Pre-requisites

**Before first deployment:**

1. **DNS Configuration** - Add A records for HTTPS to work:
   - `modia.mittonvillage.com` -> Server IP
   - `modia-api.mittonvillage.com` -> Server IP

2. **SSH Access** - Verify you can connect:
   ```bash
   ssh root@mittonvillage.com
   ```

### If SSL Setup Failed

If DNS wasn't configured before the first deploy, SSL certificates won't be obtained. Once DNS is ready, run:

```bash
ssh root@mittonvillage.com 'certbot --nginx -d modia.mittonvillage.com -d modia-api.mittonvillage.com'
```

### Optional: Customize Environment

Review and update `/var/www/modia/shared/.env`:

```bash
ssh root@mittonvillage.com 'nano /var/www/modia/shared/.env'
```

Key settings:
- `WORLD_SEED` - Change for different world layouts
- `CORS_ORIGIN` - Should match frontend domain
- `JWT_SECRET` / `JWT_REFRESH_SECRET` - Auto-generated (don't change unless rotating)

---

## Deployment Workflow

### Standard Deployment

```bash
# From project root
./scripts/deploy/deploy-production.sh --version v1.0.1
```

This will:
1. Verify clean git state (no uncommitted changes)
2. Build frontend (`npm run build -w frontend`)
3. Create tarball of deployment files
4. Upload to server via rsync
5. Install production dependencies (`npm ci --omit=dev`)
6. Run database migrations
7. Atomic symlink swap to new release
8. PM2 graceful reload
9. Health check verification
10. Cleanup old releases (keeps last 5)

### Command Options

| Option | Description |
|--------|-------------|
| `--version <ver>` | Tag release version (e.g., v1.0.0) |
| `--dry-run` | Show what would happen without executing |
| `--skip-build` | Skip frontend build (for quick redeploys) |
| `--force` | Allow deployment with uncommitted changes |
| `--help` | Show help message |

### Examples

```bash
# Full deployment with version tag
./scripts/deploy/deploy-production.sh --version v1.0.0

# Preview deployment without changes
./scripts/deploy/deploy-production.sh --dry-run --version v1.0.0

# Quick redeploy (API changes only)
./scripts/deploy/deploy-production.sh --skip-build

# Deploy despite uncommitted changes (not recommended)
./scripts/deploy/deploy-production.sh --force --version v1.0.0-dev
```

---

## Rollback Procedures

### Automatic Rollback

If the health check fails after deployment, the system automatically:
1. Reverts symlink to previous release
2. Reloads PM2 with previous code
3. Removes the failed release directory

### Manual Rollback

To manually rollback to the previous release:

```bash
ssh root@mittonvillage.com '/var/www/modia/install-remote.sh --rollback'
```

Or specify via the deployment script output message.

### Rollback to Specific Release

SSH into the server:

```bash
ssh root@mittonvillage.com

# List available releases
ls -lt /var/www/modia/releases/

# Manually switch to a specific release
ln -sfn /var/www/modia/releases/20260123_120000 /var/www/modia/current.new
mv -Tf /var/www/modia/current.new /var/www/modia/current

# Reload PM2
cd /var/www/modia/current
pm2 reload modia-api --update-env
```

---

## Troubleshooting

### Common Errors

#### "Workspace node_modules not found"

**Cause:** npm workspaces hoist dependencies to root `node_modules/`.

**Solution:** This check has been updated. Ensure you have run `npm install` and have a `package-lock.json`.

#### "Port 3000 is in use"

**Cause:** Another process is using port 3000.

**Solution:** The script checks for existing modia-api process. If it's a different process:

```bash
# Find what's using the port
ssh root@mittonvillage.com 'lsof -i :3000'

# Use --force to proceed anyway (will fail if port truly blocked)
./scripts/deploy/deploy-production.sh --force --version v1.0.0
```

#### "Health check failed"

**Cause:** Application didn't start correctly within timeout period.

**Solution:**
1. Check PM2 logs: `ssh root@mittonvillage.com 'pm2 logs modia-api --lines 50'`
2. Check application logs: `ssh root@mittonvillage.com 'cat /var/www/modia/shared/logs/api-error.log'`
3. Verify .env configuration
4. Check database connectivity

#### "No previous release found to rollback to"

**Cause:** Only one release exists (first deployment failed).

**Solution:**
1. Fix the underlying issue
2. Remove the failed release: `rm -rf /var/www/modia/releases/*`
3. Redeploy

#### "psql: connection refused"

**Cause:** PostgreSQL not running or connection parameters wrong.

**Solution:**
```bash
# Check PostgreSQL status
ssh root@mittonvillage.com 'systemctl status postgresql'

# Verify connection
ssh root@mittonvillage.com 'sudo -u postgres psql -c "SELECT 1"'
```

### Debugging Commands

```bash
# Check PM2 status
ssh root@mittonvillage.com 'pm2 list'

# View PM2 logs
ssh root@mittonvillage.com 'pm2 logs modia-api --lines 100'

# Check nginx status
ssh root@mittonvillage.com 'systemctl status nginx'

# Test nginx configuration
ssh root@mittonvillage.com 'nginx -t'

# View nginx logs
ssh root@mittonvillage.com 'tail -f /var/log/nginx/modia*.log'

# Check health endpoint directly
ssh root@mittonvillage.com 'curl -s http://localhost:3000/api/health'

# Check current release
ssh root@mittonvillage.com 'ls -la /var/www/modia/current'

# List all releases
ssh root@mittonvillage.com 'ls -lt /var/www/modia/releases/'

# Check .env file
ssh root@mittonvillage.com 'cat /var/www/modia/shared/.env | grep -v PASSWORD | grep -v SECRET'
```

### Log Locations

| Log | Location |
|-----|----------|
| PM2 output | `/var/www/modia/shared/logs/api-out.log` |
| PM2 errors | `/var/www/modia/shared/logs/api-error.log` |
| nginx access | `/var/log/nginx/modia.access.log` |
| nginx errors | `/var/log/nginx/modia.error.log` |
| nginx API access | `/var/log/nginx/modia-api.access.log` |
| nginx API errors | `/var/log/nginx/modia-api.error.log` |

---

## Security Considerations

### SSH Access

The deployment scripts use root access for simplicity. For production systems, consider:

1. Create a dedicated deploy user:
   ```bash
   useradd -m -s /bin/bash deploy
   usermod -aG www-data deploy
   ```

2. Grant specific sudo permissions for PM2 and nginx reload

3. Update `SERVER_USER` in `deploy-production.sh`

### Secret Management

- **JWT secrets** are auto-generated during setup
- **Database password** is auto-generated with 32 characters
- **.env file** is chmod 600 (owner read/write only)
- **Never commit** `.env` to version control

### Environment Variables

Production `.env` should include:

```bash
NODE_ENV=production
TRUST_PROXY=true          # Required behind nginx
DEBUG=false               # Disable debug logging
```

### Rate Limiting

Rate limiting is configured at multiple levels:

1. **nginx** - `limit_req_zone` in site configs
2. **Express** - `rateLimiterFactory.js` middleware
3. **Production limits** - Stricter than development (600 base vs 1500)

### CORS Configuration

The API is configured for cross-origin requests from the frontend domain only:

```bash
CORS_ORIGIN=https://modia.mittonvillage.com
```

Update this if deploying to a different domain.

### WebSocket Security

- WebSocket connections require authentication after connection
- Connections timeout after inactivity (configured in nginx)
- Currently running single instance to avoid cluster state issues

---

## Architecture Diagram

```
                    Internet
                        │
                        ▼
                   ┌─────────┐
                   │   DNS   │
                   └────┬────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
┌─────────────────┐         ┌─────────────────┐
│modia.mitton...  │         │modia-api.mitton.│
│  (Frontend)     │         │    (API)        │
└────────┬────────┘         └────────┬────────┘
         │                           │
         └───────────┬───────────────┘
                     │
                     ▼
              ┌─────────────┐
              │   nginx     │
              │ (reverse    │
              │   proxy)    │
              └──────┬──────┘
                     │
      ┌──────────────┼──────────────┐
      │              │              │
      ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Static   │  │   API    │  │WebSocket │
│ Files    │  │ (HTTP)   │  │  (WS)    │
│ /dist    │  │  :3000   │  │  :3000   │
└──────────┘  └────┬─────┘  └────┬─────┘
                   │             │
                   └──────┬──────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   PM2       │
                   │ (modia-api) │
                   └──────┬──────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
     ┌───────────┐ ┌───────────┐ ┌───────────┐
     │PostgreSQL │ │  Redis    │ │   Logs    │
     │modia_prod │ │(optional) │ │ /shared/  │
     └───────────┘ └───────────┘ └───────────┘
```

### Request Flow

1. **Frontend requests** hit nginx → served from `/var/www/modia/current/frontend/dist`
2. **API requests** (`/api/*`) → nginx proxy → PM2 → Node.js
3. **WebSocket** (`/ws`) → nginx upgrade → PM2 → Node.js WebSocket handler
4. **Database** → PM2 → PostgreSQL (system service, not Docker)

### Release Activation

```
Before deployment:
current -> releases/20260123_120000/

During deployment:
current.new -> releases/20260123_150000/  (temporary link)

After atomic swap:
current -> releases/20260123_150000/  (mv -Tf is atomic)
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2026-01-23 | Single-command deployment with auto-setup detection |
| 1.0.0 | 2026-01-23 | Initial deployment documentation |
