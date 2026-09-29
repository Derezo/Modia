# Modia

A browser-based tactical MMORPG with turn-based combat, procedural world generation, and real-time multiplayer features.

## Features

- **Tactical Turn-Based Combat** - Grid-based battles with movement, skills, and strategic positioning
- **Procedural World** - Deterministically generated world map with diverse biomes and encounters
- **Character Progression** - 4 base classes advancing to 4 specialized guilds with unique skill trees
- **Guild Recruitment** - Recruit NPCs with procedurally generated traits and abilities
- **Real-Time Multiplayer** - WebSocket-powered chat, party system, and PvP arena
- **Player Marketplace** - Order book trading system with real-time updates
- **PvP Coliseum** - Ranked matchmaking with ELO-based ratings and leaderboards

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JavaScript, HTML5 Canvas 2D, Vite |
| Backend | Node.js, Express.js |
| Database | PostgreSQL |
| Real-time | Native WebSockets |
| Auth | JWT (access + refresh tokens) |

## Quick Start

### Prerequisites

- Node.js 22.13+ (see `.nvmrc`)
- Docker (for PostgreSQL)
- npm 9+

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd Modia

# Start PostgreSQL
docker compose up -d

# Copy environment variables
cp .env.example .env

# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Seed the world (procedural generation)
npm run db:seed

# Start development servers
npm run dev
```

The API runs on `PORT` from `.env` (`http://localhost:3000` with `.env.example`) and the frontend on `http://localhost:8080`. The API test helper and Playwright read the same `PORT` and fall back to 3001, so export `PORT` (or set it in `.env`) to match the running API when you run integration or e2e tests.

`db:seed`, `db:reset`, and `db:fresh` are destructive bootstrap/reset
operations for empty or disposable environments. They are not a live-world
migration: authorize the reset explicitly and verify a backup before using
them against persistent player data. Assembly and validation complete before
the transaction mutates existing data, and any pre-commit failure rolls back.
Use the [world reset backup and restore runbook](docs/WORLD_RESET_BACKUP_RESTORE.md)
for snapshot verification, a disposable restore drill, and post-commit recovery.

### Development Commands

```bash
# Development (starts both API and frontend)
npm run dev

# Run individually
npm run dev:api        # API on PORT from .env
npm run dev:frontend   # Frontend on port 8080

# Testing
npm run test           # Run all tests
npm run test -w api    # API tests only
npm run test:e2e       # Playwright e2e (starts or reuses the dev servers)
npm run test:shell     # BATS tests for the pre-commit secrets scanner (needs bats)

# Database
npm run db:reset       # Re-run migrations + seed
npm run db:fresh       # Drop all tables, re-migrate, re-seed
npm run db:status      # Show migration status

# Utilities
npm run doctor         # Validate dev environment
npm run lint           # Run ESLint
```

## Project Structure

```
Modia/
├── api/               # Node.js/Express backend
│   ├── src/
│   │   ├── routes/    # REST API endpoints
│   │   ├── services/  # Business logic
│   │   ├── websocket/ # WebSocket handlers
│   │   └── migrations/# Database migrations
├── frontend/          # Vanilla JS client
│   ├── src/
│   │   ├── scenes/    # Game screens (Login, WorldMap, Battle, etc.)
│   │   ├── battle/    # Battle system components
│   │   ├── ui/        # UI component library
│   │   └── core/      # Game loop, state management
├── shared/            # Shared constants and utilities
│   ├── constants.js   # Races, classes, stat formulas
│   ├── battleMath.js  # Damage calculations
│   └── pathfinding.js # A* and Dijkstra algorithms
└── docs/              # Documentation
```

## Documentation

Detailed documentation is available in the `docs/` directory:

- [Project Requirements](docs/PROJECT_REQUIREMENTS.md) - MVP specifications
- [Technical Architecture](docs/TECHNICAL_ARCHITECTURE.md) - System design
- [API Specification](docs/API_SPECIFICATION.md) - REST and WebSocket endpoints
- [Game Design](docs/GAME_DESIGN.md) - Mechanics and formulas
- [Authored Player Animations](docs/AUTHORED_PLAYER_ANIMATIONS.md) - Reproducible character source-art and sprite-strip workflow
- [Development Roadmap](docs/DEVELOPMENT_ROADMAP.md) - Progress tracking
- [Deployment](docs/DEPLOYMENT.md) - Production deploy workflow (lsd CLI)
- [World Reset Backup and Restore](docs/WORLD_RESET_BACKUP_RESTORE.md) - Verified PostgreSQL snapshot and recovery procedure

## Game Overview

### Classes

| Base Class | Advanced Class | Role |
|------------|----------------|------|
| Warrior | Berserker | Melee DPS / Tank |
| Wizard | Sorcerer | Ranged Magic DPS |
| Monk | Ninja | Agile Melee / Stealth |
| Chemist | Alchemist | Support / Utility |

### Combat

Battles take place on a tactical grid where positioning matters:
- Movement costs vary by terrain (forest, water, etc.)
- Skills have range, area of effect, and resource costs
- Turn order based on agility with variance
- Status effects (poison, burn, buffs) persist across turns

### World

The world is procedurally generated from a seed, featuring:
- Guild nodes for class advancement and recruitment
- Towns with shops and taverns
- Battle nodes with scaling encounters
- A central Palace for social features

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

[License information here]
