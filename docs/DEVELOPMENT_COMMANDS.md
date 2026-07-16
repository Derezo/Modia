# Development Commands

Complete reference for all development, testing, and asset generation commands.

**Last Updated:** 2026-02-03

---

## Quick Start

```bash
npm run dev:setup                       # Smart startup: checks ports, Docker, migrations, seeds, launches
```

## Manual Startup

```bash
docker compose up -d                    # Start PostgreSQL (required first)
npm run dev                             # Start both API (port 3000) and frontend (port 8080)
```

## Individual Services

```bash
npm run dev:api                         # API only
npm run dev:frontend                    # Frontend only
npm run dev:admin                       # Admin dashboard only (port 5173)
npm run dev:all                         # API + frontend + admin concurrently
```

## Testing

```bash
# Full test suites
npm run test                            # All workspaces (unit + integration + ratelimit)
npm run test -w api                     # API tests only
npm run test -w shared                  # Shared module tests (battleMath, pathfinding, etc.)

# Targeted testing
npm run test:unit -w api                # Unit tests + balance tests (fast, no server needed)
npm run test:integration -w api         # Integration tests (requires running server)
npm run test:ratelimit -w api           # Rate limit tests (TEST_RATE_LIMITS=true)
npm run test:quick -w api               # Alias for test:unit

# Single test file
node --test api/src/tests/integration/auth.integration.test.js
```

## E2E Testing (Playwright)

Playwright auto-starts servers, so no manual startup needed.

```bash
npx playwright test                     # Run all E2E tests
npx playwright test e2e/auth.spec.js    # Single spec file
npx playwright test --ui                # Interactive UI mode
npx playwright test --headed            # Run with visible browser
npx playwright test --debug             # Debug mode with inspector
```

## Database Utilities

```bash
npm run db:migrate                      # Run pending migrations
npm run db:seed                         # Seed the world (procedural generation)
npm run db:reset                        # Re-run migrations + seed
npm run db:fresh                        # Drop all tables, re-migrate, re-seed
npm run db:status                       # Show migration status
npm -w api run migrate:rollback         # Roll back last migration
```

## Linting & Validation

```bash
npm run lint                            # Run ESLint
npm run doctor                          # Validate dev environment
```

---

## Asset Generation

### Sprite Assets (requires Sharp)

```bash
npm run generate:all                    # Generate all sprite assets
npm run generate:characters             # Character sprites only
npm run generate:enemies                # Enemy sprites only
npm run generate:nodes                  # World map node icons
npm run generate:items                  # Item/equipment icons
npm run generate:icons                  # UI icons
```

### Audio Generation (requires Suno/ElevenLabs API keys)

```bash
# Full generation
npm run audio:generate                  # Generate all audio (music + SFX)
npm run audio:generate:music            # Generate music tracks only
npm run audio:generate:sfx              # Generate sound effects only

# Download and validation
npm run audio:download                  # Download generated audio from Suno
npm run audio:validate                  # Validate audio file coverage
npm run audio:status                    # Quick status check of audio files
npm run audio:check                     # Full validation (status + manifest sync)

# Single-track generation with automatic download
npm run audio:generate:music -- --key heartlands_tavern --wait

# Batch generation (two-step process for music)
npm run audio:generate:music -- --region heartlands
npm run audio:download

# SFX generation is synchronous (files download immediately)
npm run audio:generate:sfx -- --key attack_sword_1
```

### Deterministic Battle Tiles

Battle tiles do not use an AI backend or API token. See [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md) for the geometry contract and admin workflow.

```bash
npm run tiles:generate                   # Compile missing canonical tiles
npm run tiles:generate -- --dry-run      # Preview the selection
npm run tiles:generate -- --biome forest --category floors
npm run tiles:generate -- --biome forest --category floors --key grass_0 --force
npm run tiles:rebuild                    # Full rebuild and legacy-file pruning
npm run tiles:check                      # Compiler tests plus strict live validation
```

### AI Image Generation

```bash
# Category generation
npm run ai:generate                     # Generate all pending image categories; tiles compile deterministically
npm run ai:generate:portraits           # Generate character portraits only
npm run ai:generate:items               # Generate item sprites only
npm run ai:generate:icons               # Generate UI icons only
npm run ai:generate:nodes               # Generate world map nodes only
npm run ai:generate:overlays            # Generate item overlay effects only

# Validation
npm run ai:status                       # Quick status check of generated images
npm run ai:validate                     # Full validation of image files
npm run ai:migrate-paths                # Migrate assets to canonical paths with size variants

# Single asset generation
npm run ai:generate:portraits -- --race elf --class wizard

# Batch generation by filter
npm run ai:generate:icons -- --category actions

# Preview without generating
npm run ai:generate:portraits -- --dry-run
```

#### Authored Player Animations

See [AUTHORED_PLAYER_ANIMATIONS.md](AUTHORED_PLAYER_ANIMATIONS.md) for the complete source-art and rebuild workflow. The spec `status` field is a build switch, not a separate workflow system: `draft-*` disables the override and `approved`, `approved-*`, or `approved_*` enables it.

```bash
npm run ai:draft:authored-player-animation -- --id human_female_wizard
npm run ai:compile:authored-player-animations -- --id elf_other_wizard
npm run ai:check:authored-player-animations
npm run ai:test:authored-player-animations
```

### SD1.5 Animation Generation (ControlNet + IP-Adapter)

Uses Stable Diffusion 1.5 with pose control and style reference for character animations.

```bash
# Basic SD1.5 generation (uses default weights)
npm run ai:generate:characters -- --mode sd15 --id warrior
npm run ai:generate:characters -- --mode sd15 --id goblin

# Custom ControlNet weight (pose accuracy, 0-1)
npm run ai:generate:characters -- --mode sd15 --controlnet-weight 0.8 --id warrior

# Custom IP-Adapter weight (style/character consistency, 0-1)
npm run ai:generate:characters -- --mode sd15 --ipadapter-weight 0.8 --id warrior

# Both weights customized
npm run ai:generate:characters -- --mode sd15 --controlnet-weight 0.8 --ipadapter-weight 0.6 --id warrior

# Generate only reference image (for testing style transfer)
# Note: Reference images preserve background for better IP-Adapter style transfer
npm run ai:generate:characters -- --mode sd15 --reference-only --id warrior

# Use external reference image
npm run ai:generate:characters -- --mode sd15 --reference ./assets/my-character.png --id warrior
```

**SD1.5 Weight Presets (recommended combinations):**

| Preset | ControlNet | IP-Adapter | Use Case |
|--------|------------|------------|----------|
| balanced | 0.7 | 0.7 | Equal pose/style priority |
| maxConsistency | 0.6 | 0.8 | Maximum character consistency |
| precisePoses | 0.8 | 0.5 | Accurate poses, more style variation |
| creative | 0.4 | 0.4 | More generation variation |

---

## Workspace Structure

The monorepo uses npm workspaces (defined in root `package.json`):

| Workspace | Port | Purpose |
|-----------|------|---------|
| `api/` | 3000 | Node.js/Express backend |
| `frontend/` | 8080 | Vanilla JS game client (Vite) |
| `admin/` | 5173 | React asset manager dashboard (Vite) |
| `shared/` | - | Constants and utilities used by api/frontend |
| `e2e/` | - | Playwright E2E tests (auto-starts servers) |

Workspace-specific commands use `-w` flag: `npm run test -w api`, `npm run lint -w frontend`

---

## Audio Prompt Guidelines (ElevenLabs SFX)

**CRITICAL: Maximum 1 comma per prompt.** ElevenLabs interprets commas as separate sounds, generating each sequentially (causing 16s files instead of 1s).

| Commas | Status |
|--------|--------|
| 0-1 | OK |
| 2+ | **BLOCKED** |

**Pattern:** Use "with" and "and" instead of commas: `"Fantasy sword slash with sharp metallic whoosh and light impact"`

The `generate-sfx.js` script blocks 2+ commas. Run with `--dry-run` to validate. See `docs/AUDIO_STYLE_GUIDE.md` for full guidelines.
