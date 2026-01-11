# Contributing to Modia

Thank you for your interest in contributing to Modia! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js 18+ (check with `node --version`)
- Docker (for PostgreSQL)
- npm 9+

### Quick Setup

```bash
# Clone and enter the repository
git clone <repository-url>
cd Modia

# Run the setup script (checks environment, starts services, runs migrations)
npm run dev:setup

# Or manually:
docker compose up -d          # Start PostgreSQL
cp .env.example .env          # Copy environment variables
npm install                   # Install dependencies
npm run db:migrate            # Run migrations
npm run db:seed               # Seed world data
npm run dev                   # Start dev servers
```

### Validate Environment

```bash
npm run doctor   # Checks Node, Docker, database, ports, and .env
```

## Project Structure

```
Modia/
├── api/           # Backend (Node.js/Express)
├── frontend/      # Frontend (Vanilla JS, Canvas 2D)
├── shared/        # Shared code (constants, formulas)
└── docs/          # Documentation
```

## Code Style

### JavaScript

- ES Modules (`import`/`export`)
- Single quotes for strings
- 2-space indentation
- Trailing commas in multi-line structures
- Semicolons required

### Linting

```bash
npm run lint          # Check all workspaces
npm run lint -- --fix # Auto-fix issues
```

ESLint is configured at the project root. All code must pass linting before merge.

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files (components) | PascalCase | `BattleScene.js` |
| Files (utilities) | camelCase | `battleMath.js` |
| Classes | PascalCase | `class GameState` |
| Functions | camelCase | `calculateDamage()` |
| Constants | SCREAMING_SNAKE | `MAX_PARTY_SIZE` |
| Database tables | snake_case | `character_skills` |

## Git Workflow

### Branches

- `master` - Production-ready code
- `feature/<name>` - New features
- `fix/<name>` - Bug fixes
- `refactor/<name>` - Code improvements

### Commit Messages

Follow conventional commits:

```
type(scope): description

[optional body]
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

Examples:
```
feat(battle): add boss phase transition system
fix(marketplace): prevent negative order quantities
docs(api): update WebSocket message specification
test(auth): add refresh token expiration tests
```

### Pull Request Process

1. Create a feature branch from `master`
2. Make changes with clear, atomic commits
3. Ensure all tests pass: `npm test`
4. Ensure linting passes: `npm run lint`
5. Update documentation if needed
6. Create PR with description of changes
7. Address review feedback
8. Squash and merge when approved

## Testing

### Running Tests

```bash
npm test                              # All tests
npm run test -w api                   # API tests only
node --test api/src/tests/auth.test.js  # Single file
```

### Test Requirements

- All new features must have tests
- Bug fixes should include regression tests
- Tests must be independent (no order dependency)
- Use the test utilities in `api/src/tests/testUtils/`

### Test Patterns

**Integration tests** (hit live database):
```javascript
import { describe, it, before, after } from 'node:test';
import { createTestUser, request } from './testHelper.js';

describe('Feature', () => {
  let user;

  before(async () => {
    user = await createTestUser();
  });

  it('should do something', async () => {
    const res = await request('GET', '/api/endpoint', null, user.token);
    assert.strictEqual(res.status, 200);
  });
});
```

**Unit tests** (mocked):
```javascript
import { createMockBattleState, createMockPlayerUnit } from './testUtils/index.js';

describe('Damage Calculation', () => {
  it('should calculate physical damage', () => {
    const attacker = createMockPlayerUnit({ strength: 50 });
    const defender = createMockPlayerUnit({ vitality: 30 });
    const damage = calculateDamage(attacker, defender);
    assert.ok(damage > 0);
  });
});
```

## Documentation

### When to Update Docs

- New API endpoints → `docs/API_SPECIFICATION.md`
- Game mechanics changes → `docs/GAME_DESIGN.md`
- Database schema changes → `docs/TECHNICAL_ARCHITECTURE.md`
- New features → `docs/DEVELOPMENT_ROADMAP.md`

### Documentation Style

- Use GitHub-flavored Markdown
- Include code examples where helpful
- Use tables for structured data
- Cross-reference other docs by filename

## Database Changes

### Creating Migrations

Migrations are in `api/src/migrations/` with sequential numbering:

```sql
-- 020_feature_name.sql

-- Description of what this migration does

CREATE TABLE new_table (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed data if needed
INSERT INTO new_table (name) VALUES ('example');
```

### Migration Commands

```bash
npm run db:migrate           # Apply pending migrations
npm run db:status            # Show migration status
npm -w api run migrate:rollback  # Roll back last migration
npm run db:fresh             # Drop all, re-migrate, re-seed
```

## Architecture Guidelines

### Backend

- Routes handle HTTP/validation only
- Business logic goes in services
- Use parameterized queries for SQL (prevent injection)
- Use `asyncHandler` wrapper for async routes
- WebSocket handlers in `api/src/websocket/`

### Frontend

- Scene-based architecture (each screen is a Scene class)
- Scenes have `enter()`, `update(dt)`, `render(ctx)`, `exit()` lifecycle
- Canvas for game rendering, DOM for UI overlays
- Use parchment UI components from `frontend/src/ui/parchment/`

### Shared

- Constants used by both API and frontend
- Battle math formulas (for client preview and server authority)
- Pathfinding algorithms

## Getting Help

- Check existing documentation in `docs/`
- Review `CLAUDE.md` for codebase patterns and gotchas
- Open an issue for questions or problems

## Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Help others learn and improve
