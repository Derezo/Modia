# Development Commands

Complete reference for all development, testing, and asset generation commands.

**Last Updated:** 2026-09-29

---

## Quick Start

```bash
npm run dev:setup                       # Smart startup: checks ports, Docker, migrations, seeds, launches
```

## Manual Startup

```bash
docker compose up -d                    # Start PostgreSQL (required first)
npm run dev                             # Start both API (PORT from .env) and frontend (port 8080)
```

The API listens on `PORT` from `.env` and falls back to 3000 (`.env.example` sets 3000; the main dev workstation uses 3001). The API test helper (`api/src/tests/testHelper.js`, or `TEST_API_BASE_URL`) and the Playwright config read `PORT` and fall back to 3001, so keep `PORT` in step with the running API.

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
npm run test:ratelimit -w api           # Rate limit tests (runner starts its own API with TEST_RATE_LIMITS=true)
npm run test:quick -w api               # Alias for test:unit
npm run test:shell                      # BATS tests in tests/ (pre-commit secrets scanner); needs `bats` on PATH

# Single test file (cap concurrency at 4 on this host)
cd api && NODE_ENV=test node --test --test-concurrency=4 src/tests/unit/<file>.test.js
cd api && PORT=3001 NODE_ENV=test node --test --test-concurrency=4 src/tests/integration/<file>.test.js
```

Rate-limit suites fail fast unless launched by `api/src/tests/runRateLimitTests.js`, which spawns a dedicated API on a free loopback port. Run them only through `npm run test:ratelimit -w api`.

`test:shell` runs `bats tests/`. `tests/check-secrets.bats` covers `scripts/check-secrets.sh`, the scanner `.husky/pre-commit` runs on every commit. Run it after editing that script.

## E2E Testing (Playwright)

Playwright starts `npm run dev:api` and `npm run dev:frontend` if they are not already running, and reuses running dev servers otherwise.

- **API port:** `playwright.config.js` loads `.env` and uses `PORT` (default 3001) for the API health check. Keep it in step with the running API. `TEST_BYPASS_SECRET` also comes from `.env`; `e2e/helpers/game.js` sends it as the rate-limit bypass header.
- **Frontend:** fixed at `http://localhost:8080`. Set `E2E_BASE_URL` to point at another already-running frontend (for example a Vite instance with HMR off); Playwright then does not manage the frontend.
- **Workers:** capped at 4 locally.
- **Getting to the login form:** the game is a canvas SPA with a title intro, not URL routes. Use `gotoAuth(page)` from `e2e/helpers/index.js`: it loads `/`, presses Escape until the auth form is visible and waits for focus on `#username`. `login(page, username, password)` builds on it. Use the selectors in `AUTH_SELECTORS` (`#username`, `#password`, `#auth-btn`, ...).
- **Password length:** registration rejects passwords over 72 UTF-8 bytes, so keep fixture passwords short (and containing `test`, for the secrets scanner).

```bash
npx playwright test                     # Run all E2E tests
npx playwright test --project=chromium  # Chromium only
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
npm run world:migrate -- --seed=123456 # Read-only live-world remapping plan
```

World resets are destructive bootstrap operations, not live-world migrations.
For persistent data, follow the [world reset backup and restore
runbook](WORLD_RESET_BACKUP_RESTORE.md) before enabling reset authorization.
The supported safety scripts require explicit connections and exact paths:

```bash
scripts/world-reset-backup.sh --archive /absolute/path/pre-world-reset.dump
scripts/world-reset-restore.sh --help
node --test scripts/world-reset-db-operations.test.mjs
```

For a populated world, do not use `db:seed` or `db:reset`. Use the
[player-preserving world regeneration runbook](PLAYER_PRESERVING_WORLD_REGENERATION.md).
Its default command is read-only; execution requires a reviewed plan hash,
maintenance mode, and a verified backup.

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

### Battle Map V3 Regional Art

```bash
npm run battle-art:preflight             # Codex CLI/version/login check; no generation
npm run battle-art:matrix                # Reviewed biome/ecology/tier readiness
npm run battle-art:scaffold -- --theme forest --ecology-profile forest-heartlands-woodland --tier 1 --category surface
npm run battle-art:generate -- --theme forest --family <exact-family-id> --concurrency 1
npm run battle-art:generate -- --theme forest --family <failed-route-id> --recover --timeout <original-seconds>
npm run battle-art:revalidate-failure -- --theme <theme> --family <route-id> --failure <canonical-failure-record.json>
npm run battle-art:preview -- --theme forest --ecology-profile forest-heartlands-woodland --tier 1
npm run battle-art:review -- --theme forest --family <id> --reviewer <name> --decision rejected --reason "<specific issue>"
npm run battle-art:approve -- --theme forest --family <id> --reviewer <name> --decision approved --reason "<specific acceptance rationale>"
npm run battle-art:compile
npm run battle-art:archive
npm run battle-art:check
```

Candidate generation is available only through these npm commands. See
[BATTLE_MAP_V3_ART_LIFECYCLE.md](BATTLE_MAP_V3_ART_LIFECYCLE.md) for regional
species/geology direction, topology and slope contracts, manual review, and
catalog activation.

Live generation accepts exactly one explicit family, concurrency `1`, and no
`--keep-going`. Codex can run the preview and approval commands, but final
acceptance must name a reviewer who inspected the exact candidate and is
distinct from the generation principal.

The worker timeout defaults to 900 seconds; use `--timeout <seconds>` only for
an explicit bounded override (maximum 1,800 seconds). A timeout never retries
and never publishes candidate image or metadata.

`battle-art:preflight` checks CLI availability and login only; it deliberately
does not spend an Imagegen call. A live zero-artifact result publishes no
candidate and is not recoverable unless a route artifact was actually copied.
Timeout and nonzero-exit failures retain the effective prompt and capped
stdout/stderr evidence for inspection. Make any retry explicit, and stop for
tooling investigation if the zero-artifact result repeats. Draft approval and
resume also require the saved effective prompt to match the current composer
exactly; stale pre-change candidate evidence cannot be promoted.

### Battle Map V3 Content Release

```bash
# Compile and validate one reviewed template.
npm run battle-maps:compile -- --theme <theme> --template <template> --all-approved
npm run battle-maps:validate -- --theme <theme> --template <template> --all-approved

# Render and inspect each final map before recording visual approval.
npm run battle-maps:screenshot -- --map battle-maps/compiled/<theme>/<map>.v<version>.json --output-dir ai-image-metadata/battle-maps/review/<theme>/<template>/<map>
npm run battle-maps:approve -- --theme <theme> --template <template> --map <map> --screenshot <local-review-png> --reviewer <reviewer-id> --reason "<specific visual rationale>"

# Check, create, and activate an immutable cumulative catalog release.
npm run battle-maps:catalog -- --release <release-id> --check
npm run battle-maps:catalog -- --release <release-id>
npm run battle-maps:catalog -- --release <release-id> --activate
```

`battle-maps:catalog -- --check` is the non-writing preflight for an
incremental release. Run `battle-maps:coverage -- --release <release-id>` only
when claiming the complete 16-theme, 144-map corpus; it is not the routine
pilot-release check. Activation changes the tracked catalog pin, so deployment
and rollback use normal code/content releases rather than environment flags.

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
npm run ai:generate:characters:player -- --id human_female_wizard --phase reference
npm run ai:generate:characters:player -- --id human_female_wizard --phase animations
npm run ai:compile:authored-player-animations -- --id elf_other_wizard
npm run ai:check:authored-player-animations
npm run ai:test:authored-player-animations
```

#### Authored Enemy Animations

Enemy generation requires an explicit canonical biome and identity. The retained
chroma and transparent sources are pinned when the reviewed sheet is compiled.

```bash
npm run ai:generate:characters:enemies -- --biome forest --id giant_spider --phase reference
npm run ai:generate:characters:enemies -- --biome forest --id giant_spider --phase animations
npm run ai:compile:authored-enemy-animations -- --biome forest --id giant_spider --update-pins --approve --force
npm run ai:check:authored-enemy-animations
```

`npm run ai:generate -- --category characters` is intentionally unsupported:
the aggregate generator cannot provide the per-identity visual review required
by the authored player and enemy pipelines. The old SD1.5 character generator
is retained only as migration implementation code and is not a supported npm
entry point.

---

## Workspace Structure

The monorepo uses npm workspaces (defined in root `package.json`):

| Workspace | Port | Purpose |
|-----------|------|---------|
| `api/` | `PORT` (3000 default, 3001 in local `.env`) | Node.js/Express backend |
| `frontend/` | 8080 | Vanilla JS game client (Vite) |
| `admin/` | 5173 | React asset manager dashboard (Vite) |
| `shared/` | - | Constants and utilities used by api/frontend |
| `e2e/` | - | Playwright E2E tests (starts or reuses dev servers) |

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
