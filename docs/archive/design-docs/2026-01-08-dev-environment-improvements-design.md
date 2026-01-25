# Development Environment Improvements Design

## Overview

Improvements to the Modia development environment focused on developer experience, safety, and CI/CD automation.

## Components

### 1. Smart Dev Startup Script

**File:** `scripts/dev-setup.sh`
**npm Script:** `npm run dev:setup`

A comprehensive startup script that handles the full development environment setup:

#### Port Cleanup
- Check ports 3000 (API) and 8080 (frontend)
- Kill any processes occupying required ports
- Output: `Killed process <PID> on port <PORT>`

#### Docker Check
- Verify Docker daemon is running
- Start PostgreSQL container via `docker compose up -d` if not running
- Wait for PostgreSQL readiness with connection retry loop

#### Migration Check
- Query migrations table for applied migrations
- Compare against migration files in `api/src/migrations/`
- Auto-run `npm run db:migrate` if pending migrations exist

#### Seed Check
- Query for existing world data (`SELECT COUNT(*) FROM regions`)
- Run `npm run db:seed` if database is empty

#### Launch
- Execute `npm run dev` to start API and frontend concurrently

### 2. Git Hooks - Secrets Detection

**Files:**
- `scripts/check-secrets.sh` - Pattern-based secrets scanner
- `.husky/pre-commit` - Hook that runs the scanner

**Detection Patterns:**
- AWS keys (`AKIA[0-9A-Z]{16}`)
- Generic API keys (`api[_-]?key\s*[=:]\s*['"]?[a-zA-Z0-9]{20,}`)
- JWT secrets (`jwt[_-]?secret\s*[=:]\s*['"]?[^\s'"]+`)
- Private keys (`-----BEGIN .* PRIVATE KEY-----`)
- Hardcoded passwords (`password\s*[=:]\s*['"]?[^\s'"]+` excluding placeholders)

**Behavior:**
- Scans only staged files (fast execution)
- Blocks commit on detection with clear error message
- Bypassable with `git commit --no-verify` for emergencies

**Setup:**
- Uses Husky for hook management
- Auto-installed via `npm run prepare` (runs after `npm install`)

### 3. GitHub Actions CI Pipeline

**File:** `.github/workflows/ci.yml`

**Triggers:**
- Push to `main` or `master` branches
- All pull requests

**Job Configuration:**
```yaml
runs-on: ubuntu-latest

services:
  postgres:
    image: postgres:15
    env:
      POSTGRES_USER: modia
      POSTGRES_PASSWORD: modia_dev_password
      POSTGRES_DB: modia
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

**Steps:**
1. Checkout code
2. Setup Node.js 18
3. Install dependencies (`npm ci`)
4. Run migrations
5. Run linter (`npm run lint`)
6. Run tests (`npm run test`)

### 4. Health Check Script

**File:** `scripts/doctor.sh`
**npm Script:** `npm run doctor`

**Checks Performed:**
| Check | Pass Criteria | Failure Suggestion |
|-------|---------------|-------------------|
| Node.js version | >=18.0.0 | Install Node 18+ via nvm |
| Docker running | daemon accessible | Start Docker Desktop |
| PostgreSQL container | container up | `docker compose up -d` |
| Database connection | can connect | Check DB credentials |
| .env file | exists | `cp .env.example .env` |
| Required env vars | all set | List missing vars |
| Port 3000 | available | Show blocking process |
| Port 8080 | available | Show blocking process |

**Output Format:**
```
Checking development environment...

* Node.js v20.10.0 (>=18 required)
* Docker is running
x PostgreSQL container is not running
  -> Run: docker compose up -d
```

### 5. Database Utilities

#### DB Status

**File:** `scripts/db-status.sh`
**npm Script:** `npm run db:status`

Shows migration state:
```
Applied migrations:
  * 001_initial_schema.sql
  * 002_add_inventory.sql

Pending migrations:
  o 003_add_guilds.sql
```

#### DB Fresh

**File:** `scripts/db-fresh.sh`
**npm Script:** `npm run db:fresh`

- Prompts for confirmation (destructive operation)
- Drops all tables
- Re-runs all migrations
- Re-runs seed script

## File Summary

| File | Purpose |
|------|---------|
| `scripts/dev-setup.sh` | Smart dev startup |
| `scripts/check-secrets.sh` | Secrets pattern scanner |
| `scripts/doctor.sh` | Environment health check |
| `scripts/db-status.sh` | Migration status display |
| `scripts/db-fresh.sh` | Database reset utility |
| `.husky/pre-commit` | Git pre-commit hook |
| `.github/workflows/ci.yml` | CI pipeline |

## Dependencies

**New dev dependencies:**
- `husky` - Git hooks management

## Changes to Existing Files

**`package.json`:**
```json
{
  "scripts": {
    "dev:setup": "./scripts/dev-setup.sh",
    "doctor": "./scripts/doctor.sh",
    "db:status": "./scripts/db-status.sh",
    "db:fresh": "./scripts/db-fresh.sh",
    "prepare": "husky"
  }
}
```

## Implementation Order

1. Create `scripts/` directory structure
2. Implement `doctor.sh` (foundational, used by other scripts)
3. Implement `db-status.sh` and `db-fresh.sh`
4. Implement `dev-setup.sh` (depends on doctor logic)
5. Implement `check-secrets.sh`
6. Set up Husky and pre-commit hook
7. Create GitHub Actions workflow
8. Update `package.json` with new scripts
9. Update `README.md` with new commands (optional)
