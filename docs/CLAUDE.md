# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

This directory (`docs/`) contains **pure markdown documentation only** — no code, no documentation framework, no build process. Changes should be limited to documentation updates.

## Documentation Structure

- **PROJECT_REQUIREMENTS.md** — MVP specifications, technical requirements, infrastructure targets
- **TECHNICAL_ARCHITECTURE.md** — System design, backend structure, database schemas
- **API_SPECIFICATION.md** — Complete REST and WebSocket API endpoint definitions
- **GAME_DESIGN.md** — Game mechanics, base classes, combat formulas, world design
- **DEVELOPMENT_ROADMAP.md** — Phased development plan with task breakdowns
- **CHARACTER_PROGRESSION.md** — Formation screen, skill trees, guild advancement, advanced classes
- **ITEM_SYSTEM.md** — Item generation, equipment slots, rarity system, item templates, drop tables
- **ECONOMY_SYSTEM.md** — NPC shops, player marketplace, gold flow, pricing systems
- **SKILL_TREES.md** — Skill definitions for 8 MVP guilds (4 base + 4 advanced)
- **ENEMY_SYSTEM.md** — Enemy templates, AI archetypes, level scaling, drop tables

## Parent Project Context

The parent directory (`/home/wizard/Projects/Modia/`) is a monorepo for a browser-based MMORPG:

```
Modia/
├── docs/          # This directory (documentation only)
├── api/           # Node.js/Express backend
├── frontend/      # Vanilla JS client with Canvas 2D
├── shared/        # Shared constants (races, classes, etc.)
└── package.json   # Monorepo workspace config
```

**Tech stack:** Express.js, PostgreSQL, WebSockets, Vanilla JS (no framework), HTML5 Canvas 2D

## Documentation Conventions

- Use GitHub-flavored markdown
- ASCII box diagrams for architecture visualizations
- Tables for API endpoints, database schemas, and game stats
- Code blocks with language hints for examples
- Cross-reference other docs by filename when needed

## Key Technical Details Referenced in Docs

- **Target scale:** 25 concurrent users on 4GB VPS
- **Database:** PostgreSQL 14+ with migration system
- **Auth:** JWT with refresh tokens (15m access / 7d refresh)
- **Real-time:** WebSocket message protocol with room-based subscriptions
- **Frontend:** Scene-based architecture (LoginScene, WorldMapScene, etc.)
- **World generation:** Seeded random (Mulberry32) for deterministic tile generation
