# Modia - Technical Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Version | 3.9 |
| Last Updated | February 2026 |
| Focus | Infrastructure, deployment, testing, performance |

---

## Status Summary

| Category | Completion | Status |
|----------|------------|--------|
| Infrastructure | 75% | In Progress |
| CI/CD Pipeline | 40% | In Progress |
| Testing | 90% | In Progress |
| Performance | 50% | In Progress |
| Monitoring | 60% | In Progress |

---

## 1. Infrastructure & Deployment

### 1.1 VPS Server Setup ✅ COMPLETED

- [x] Provision VPS (4GB RAM target) ✅ 2026-04-25 - mittonvillage.com operational
- [x] Configure firewall (ufw) ✅ 2026-04-25 - firewall configured
- [x] Set up SSH keys ✅ 2026-04-25 - SSH keys configured 
- [x] Configure fail2ban ✅ 2026-04-25 - fail2ban active

### 1.2 Database

- [x] PostgreSQL 14+ installation (via Docker Compose for dev, setup.sh for production)
- [x] Database user configuration (via setup.sh)
- [ ] Connection pooling (pgBouncer)
- [x] Automated backups (backup.sh with 7-day retention)

### 1.3 Application Server

- [x] Node.js 20+ LTS installation (via setup.sh)
- [x] PM2 process manager setup (via setup.sh, ecosystem.config.js)
- [x] Environment variable management (.env template in deploy/)
- [ ] Log rotation configuration

### 1.4 Web Server

- [x] Nginx installation (via setup.sh)
- [x] Reverse proxy configuration (nginx.conf.template)
- [x] Gzip compression (nginx.conf.template)
- [x] Static asset caching (nginx.conf.template)
- [x] WebSocket upgrade handling (nginx.conf.template)

### 1.5 Security ✅ COMPLETED

- [x] SSL certificate (Let's Encrypt) ✅ 2026-04-25 - SSL configured
- [x] Auto-renewal configuration ✅ 2026-04-25 - certbot auto-renewal active
- [x] Security headers (CSP, HSTS) ✅ 2026-04-25 - security headers implemented
- [x] Rate limiting at Nginx level ✅ 2026-04-25 - nginx rate limiting configured

### 1.6 Domain ✅ COMPLETED

- [x] Domain registration ✅ 2026-04-25 - mittonvillage.com registered
- [x] DNS configuration ✅ 2026-04-25 - DNS records configured
- [x] Subdomain setup (api.*, ws.*) ✅ 2026-04-25 - subdomain routing configured

---

## 2. CI/CD Pipeline

### 2.1 GitHub Actions (Completed Jan 2026)

- [x] Lint on push (v9.12: ESLint in CI workflow)
- [x] Test on pull request (v9.12: unit tests for API and shared modules)
- [x] Build validation (v9.12: frontend build check)
- [x] Dependency security scanning (v9.12: npm audit + Dependabot automation)
- [x] Simplified CI pipeline (v9.12: removed integration tests from PR, main-only E2E)
- [x] Code coverage reporting (v9.12: Codecov integration)

### 2.2 Deployment Scripts

- [x] Zero-downtime deployment (v8.7: deploy.sh with PM2 reload)
- [x] Database migration automation (v8.7: deploy.sh runs migrations)
- [x] Rollback procedures (v8.7: deploy.sh --rollback)
- [ ] Environment synchronization

### 2.3 Environment Management

- [ ] Staging environment
- [ ] Production environment
- [ ] Environment parity
- [ ] Secret management

---

## 3. Testing

### 3.1 Unit Tests

- [x] Auth service tests
- [x] Battle mechanics tests (75+)
- [x] Chat service tests (21)
- [x] Presence service tests (27)
- [x] WebSocket tests (44)
- [x] Order expiration service tests (orderExpirationService.unit.test.js)
- [x] Shop refresh service tests (shopRefreshService.unit.test.js)
- [x] Quest service (v9.3: elite quest gating, item drops, title awards)
- [x] Shared battleMath tests (v10.7: 360 tests across 16+ function suites - damage, defense, CT, evasion, crit, status, healing, MP cost, skill scaling, range)
- [x] Shared constants tests (v10.7: 5 new sections - SeededRandom, calculateStats, stat formulas, race/class validation, XP thresholds)
- [x] Shared pathfinding tests (v10.7: performance benchmarks, mixed terrain cost, water terrain impassability)
- [x] AI unit tests (v10.7: 224 tests across 72 suites - patternWeights, cache, utilityFactors, stateEvaluator, actionGenerator, lookahead, utilityAI, aiPatternBehavior)
- [x] Worldgen unit tests (v10.7: 125 tests across 19 suites - castlePlacement, nodeGeneration, internalConnections, validation)
- [x] Balance tests extended (v10.7: all 16 advanced classes, elemental damage scaling, CT/status formulas, fishing/caravan economy)
- [ ] Settings service tests

**Test counts (v10.7):**
| Suite | Tests | Failures |
|-------|-------|----------|
| Shared (battleMath + constants + pathfinding) | 360 | 0 |
| API unit (AI + worldgen + balance + services) | 754 | 0 |
| AI unit tests | 224 (72 suites) | 0 |
| Worldgen unit tests | 125 (19 suites) | 0 |

**npm scripts:** `test:unit:ai`, `test:unit:worldgen` (added v10.7)

### 3.2 Integration Tests

- [x] API endpoint tests
- [x] WebSocket integration tests
- [x] Battle reconnection tests (battleReconnection.integration.test.js)
- [x] Coliseum service tests (coliseumService.integration.test.js)
- [x] Item drop service tests (itemDropService.integration.test.js)
- [x] Party WebSocket tests (partyWebsocket.integration.test.js)
- [x] Marketplace API tests (marketplace.integration.test.js)
- [ ] Database transaction tests
- [ ] Migration rollback tests

### 3.3 E2E Tests (Playwright)

- [x] Auth flow
- [x] Quest Board flow (v9.3: daily/weekly tabs, streak display, claim buttons)
- [x] Character creation flow (v9.4: race/class selection, name validation, creation success)
- [x] Battle flow (v9.4: enter battle, turn order, actions, rewards, state persistence)
- [x] Error handling scenarios (v9.4: network errors, session expiration, rate limiting)
- [ ] Shop/marketplace flow
- [ ] Full gameplay walkthrough

### 3.4 Cross-Platform Testing

- [ ] Chrome (desktop)
- [ ] Firefox (desktop)
- [ ] Safari (desktop)
- [ ] Chrome (mobile)
- [ ] Safari (iOS)
- [ ] Edge

### 3.5 Load Testing

- [x] Artillery.io infrastructure setup (v9.4: config.yml with phased load testing)
- [x] 25 concurrent users configuration (v9.4: warm-up, ramp-up, sustained, cool-down phases)
- [x] Gameplay scenario tests (v9.4: shop, inventory, social, quests, leaderboards)
- [ ] WebSocket connection stress testing
- [ ] Database query performance profiling
- [ ] Memory stability over time validation

### 3.6 Security Audit

- [ ] OWASP Top 10 review
- [ ] SQL injection verification
- [ ] XSS prevention verification
- [x] JWT token security (v8.7: 1h access tokens, auto-refresh, per-user rate limits)
- [x] Rate limiting verification (tests added v7.8)
- [x] Configure `trust proxy` for production deployment (v8.7)
- [x] Add rate limiter to auth/refresh endpoint (v8.7: 20/15min IP-based)
- [x] Add rate limiter to world/travel endpoint (v8.7: 60/min per-user)
- [x] Comprehensive endpoint rate limiting (v9.4: 70+ endpoints protected via economyRateLimiter, characterRateLimiter, socialRateLimiter)
- [x] Redis-backed rate limiting (v9.4: distributed rate limiting with in-memory fallback)
- [x] WebSocket rate limit persistence (v9.4: Redis sorted sets for sliding window)
- [x] Gate debug endpoints in production (v9.4: debug.js blocks in production regardless of DEBUG env var)

---

## 4. Performance Optimization

### 4.1 API Performance

- [ ] Response time audit (target: p95 < 200ms)
- [ ] Slow query identification
- [ ] Endpoint profiling
- [ ] Cache header optimization

### 4.2 Database Performance

- [ ] Query optimization
- [ ] Index analysis
- [ ] Connection pool tuning
- [ ] EXPLAIN ANALYZE on slow queries

### 4.3 Frontend Performance

- [ ] Canvas render profiling
- [ ] Asset loading optimization
- [ ] Bundle size analysis
- [ ] Memory leak detection
- [ ] RequestAnimationFrame efficiency

### 4.4 WebSocket Efficiency

- [x] **WebSocket Reliability System** (2026-02-02)
  - Message ACK protocol with retry logic (messageReliability.js)
  - Bidirectional heartbeat with zombie detection (45s timeout)
  - Server-side ping/pong for dead connection detection (30s interval)
  - Client heartbeat ACK tracking for responsive failover
  - Sequence-based message ordering for battle events
  - Auto-recovery via full state sync after max retries
  - Per-connection pending ACK tracking with cleanup
- [ ] Message size audit
- [ ] Room subscription cleanup
- [ ] Connection multiplexing

### 4.5 Asset Optimization

- [ ] Image compression
- [ ] Sprite sheet optimization
- [ ] Lazy loading strategy
- [ ] Cache busting

---

## 5. Monitoring & Operations

### 5.1 Health Checks

- [x] API health endpoint (v9.4: GET /api/health basic, /health/ready for readiness, /health/live for liveness)
- [x] Database connectivity check (v9.4: health/ready verifies DB with latency measurement)
- [x] Redis health check (v9.4: health/ready and health/metrics include Redis status)
- [x] WebSocket health check (v9.4: health/metrics reports connections, rooms)
- [x] Memory metrics (v9.4: health/metrics includes heap, RSS)
- [x] Rate limiter metrics (v9.4: health/metrics reports store type and stats)
- [ ] Disk space monitoring

### 5.2 Error Tracking (Completed Jan 2026)

- [x] Error logging service (v9.12: PostgreSQL-based exception tracking)
- [x] Request correlation IDs (v9.12: X-Request-ID middleware)
- [x] Error categorization (v9.12: fingerprint-based grouping with status workflow)
- [x] Stack trace preservation (v9.12: full stack in exception_events table)
- [x] File-based logging for VPS (v9.12: daily rotation JSON logs)
- [x] User feedback system (v9.12: enhancement/bug/abuse reports via UI)

### 5.3 Performance Monitoring

- [ ] Response time tracking
- [ ] Error rate tracking
- [ ] Memory usage tracking
- [ ] Database connection tracking

### 5.4 Backup Strategy

- [x] Database backup schedule (v8.7: backup.sh with cron)
- [x] Backup verification (v8.7: pg_restore --list validation)
- [ ] Point-in-time recovery
- [ ] Off-site backup storage (v8.7: backup.sh --s3 support ready)

---

## 6. Audio System

### 6.1 Audio Generation Infrastructure (Completed Jan 2026)

- [x] Suno API client for music generation
- [x] ElevenLabs API client for SFX generation
- [x] Metadata-driven prompt system (JSON files)
- [x] Generation orchestrator scripts with CLI options
- [x] Validation and status scripts

### 6.2 Audio Assets (Completed Jan 2026)

- [x] 55 music tracks (regional, battle, core)
- [x] 239 SFX (skills, combat, UI, ambient, interactions)
- [x] Region-themed music for 5 regions
- [x] Battle music for 4 encounter types per region
- [x] 140 skill sounds (72 player + 68 monster)

### 6.3 Frontend Integration (Completed Jan 2026)

- [x] MusicContext for region-aware music playback
- [x] Audio triggers in all 14+ scenes
- [x] Battle audio integration (skills, impacts, status effects)
- [x] Victory/defeat fanfares via MusicContext
- [x] Ambient sound management in TavernScene

### 6.4 npm Scripts

```bash
npm run audio:generate      # Generate all audio
npm run audio:generate:music # Music only
npm run audio:generate:sfx   # SFX only
npm run audio:download       # Download pending tracks
npm run audio:validate       # Validate assets exist
npm run audio:status         # Show asset status
```

### 6.5 Pending

- [ ] Generate actual audio files (requires API keys)
- [ ] Audio variation system for combat sounds
- [ ] Dynamic music intensity layers

---

## 7. AI Image Generation System

### 7.1 Image Generation Infrastructure (Completed Jan 2026)

- [x] HuggingFace API client for Flux LoRA models
- [x] Metadata-driven prompt system (JSON files in ai-image-metadata/)
- [x] Generation orchestrator scripts with CLI options
- [x] Validation and status scripts

### 7.2 Prompt Builder Improvements (Completed Jan 2026)

- [x] Removed "white background for cutout" prompts (caused white framing artifacts)
- [x] Updated portrait prompts: "bust shot from chest up, character centered, hands not visible"
- [x] Updated node prompts: "isolated on plain background"
- [x] Updated item prompts: "isolated subject, plain neutral background"
- [x] Added negative prompt constraints: "holding objects, hands in frame, white framing, white border"

### 7.3 Quality Evaluation System (Completed Jan 2026)

- [x] Evaluation schema added to metadata files (score, issues, regenerate)
- [x] Evaluation criteria: resemblance (25%), style consistency (20%), alpha handling (20%), composition (20%), clarity (15%)
- [x] Score thresholds: >= 6 passing, < 6 needs regeneration
- [x] Generated evaluation-report.json with regeneration queue

**Current Status:**
| Category | Evaluated | Passing | Regeneration Queue |
|----------|-----------|---------|-------------------|
| Nodes | 20 | 14 | 6 (city, forest, cave, mountain, discovery, fishing) |
| Enemy Portraits | 16 | 16 | 0 |
| **Total** | **36** | **30** | **6** |

### 7.4 Post-Processing Pipeline Overhaul (Completed Jan 2026)

> **Note:** Resolutions and size variants superseded by Section 7.16 (Pipeline Refactor). Python now saves 1024x1024 processed originals; Node.js generates all size variants via `generateCanonicalSizeVariants()`.

- [x] Removed `--sizes` CLI flag from all generators (hard-coded post-processing per asset type)
- [x] Added asset-specific post-processing functions in `resizeUtils.js`:
  - `postProcessTile()` - 128x128 → 64x64 with diamond mask
  - `postProcessPortrait()` - 256x256 → 64/128/256 variants
  - `postProcessItem()` - 128x128 → 32/64/128 variants
  - `postProcessIcon()` - 128x128 → 16/24/32/48/64/128 variants
  - `postProcessNode()` - 256x256 → 48/96 variants
  - `postProcessWall()` - 128x32 → 64x16
  - `postProcessSlope()` - 128x160 → 64x80
- [x] Updated `pythonRunner.js` with standardized resolution parameters
- [x] Improved tile prompts for diamond geometry in `promptBuilder.js`
- [x] Added tile-specific negative prompt to `tiles/manifest.json`
- [x] Updated `AI_IMAGE_GENERATION.md` documentation
- [x] Verified wall/slope metadata exists for all 6 biomes

**Commit:** `91ac94b feat(ai-images): Overhaul AI image generation post-processing pipeline`

### 7.5 Asset Loading System Refactoring (Completed Jan 2026)

Refactored asset loading to support multi-size assets with optimal size selection.

- [x] Updated `shared/assetPaths.js` with size-aware path functions
  - Added `getOptimalSize()` utility for selecting smallest size >= display size
  - Unified `getAssetPath()` function for all asset categories
- [x] Refactored `frontend/src/core/AssetLoader.js` with size-aware methods
  - `getPortraitUrl(character, displaySize)` - character portraits
  - `getEnemyPortraitUrl(enemyId, displaySize)` - enemy portraits
  - `loadNodeSpriteAtSize(nodeType, options)` - world map nodes
  - Static exports: `SIZE_PRESETS`, `DEFAULT_SIZES`, `getOptimalSize`
- [x] Updated 4 scenes to use AssetLoader portrait methods
- [x] Updated 4 components to import from shared module
- [x] Integrated post-processing into generation scripts
- [x] Added `getImageDimensions()` with 5-second timeout for subprocess safety

### 7.6 Asset Path Standardization (Completed Jan 2026)

Major refactoring to consolidate and standardize the asset system with unified directory structure, consistent naming conventions, and removal of legacy code.

**Key Changes:**

| Before | After |
|--------|-------|
| `/assets/sprites/portraits/` + `/assets/sprites/enemies/portraits/` | `/assets/portraits/{size}/` (unified) |
| `node_castle.png` | `castle.png` (no prefix) |
| `sword_iron_64.png` | `64/weapons/sword_iron.png` (size in path) |
| `/terrain/base/` fallback | Code fallback to `forest` |
| `getLegacyPath()` / `getStandardizedPath()` | Single `getAssetPath()` |

**Directory Structure:**
```
/assets/
├── portraits/{32,48,64,128,256}/ # Player: {race}_{gender}_{class}, Enemy: enemy_{id}
├── nodes/{48,96}/                # No node_ prefix
├── items/{32,64,128}/{category}/ # Size in path, not filename
├── icons/png/{size}/{category}/  # PNG icons with size directories
├── terrain/{biome}/              # No base/ - forest is fallback
└── overlays/{size}/{category}/   # Rarity and augment effects
```

**Files Modified:**
- `shared/assetPaths.js` - Complete rewrite with unified `getAssetPath()`, `getOriginalsPath()`
- `frontend/src/core/AssetLoader.js` - Updated basePath, biome fallbacks, node/portrait methods
- `scripts/ai-images/*.js` - All generation scripts updated with new output paths
- `ai-image-metadata/manifest.json` - Updated outputPaths
- `ai-image-metadata/nodes/locations.json` - Stripped `node_` prefix from 26 IDs
- `ai-image-metadata/portraits/enemies.json` - Added `enemy_` prefix to 16 IDs
- `ai-image-metadata/tiles/{floors,walls,slopes}/base.json` - Marked deprecated

**Migration:**
- Created `scripts/migrate-asset-paths.js` for file migration
- Migrated 682 assets (316 portraits, 45 nodes, 321 terrain tiles)
- Old files preserved in `/assets/sprites/` for rollback

**API Changes:**
```javascript
// New unified API
getAssetPath('portraits', 'human_male_warrior', { size: 64 })
getAssetPath('portraits', 'enemy_goblin_warrior', { size: 64 })
getAssetPath('nodes', 'castle', { size: 96 })  // No node_ prefix
getAssetPath('items', 'sword_iron', { subcategory: 'weapons', size: 64 })
getOriginalsPath('portraits', 'human_male_warrior')
```

### 7.16 Image Pipeline Refactor: Standardized Generation & Post-Processing (Completed Jan 2026)

Unified the generation pipeline to eliminate dual post-processing and quality loss. Python now handles semantic processing (rembg, crop, square) at full 1024x1024 resolution; Node.js handles all sizing via ImageMagick Lanczos downscaling.

- [x] Added `process_to_original()` utility to Python image_processing.py
- [x] Refactored 5 Python generators (portrait, node, icon, item, obstacle) to save 1024x1024 processed originals
- [x] Created Python overlay generator (`generate_overlay.py`) with `build_overlay_prompt()` template
- [x] Updated AI_RESOLUTIONS to 1024x1024 for portraits, items, icons, nodes
- [x] Extended node SIZE_PRESETS from [48, 96] to [48, 64, 96, 128, 256]
- [x] Removed fragile portrait rembg workaround (copy external 1024x1024 + re-run rembg)
- [x] Added generateCanonicalSizeVariants to generate-icons.js (was missing entirely)
- [x] Converted generate-overlays.js from old postProcessGenerated to generateCanonicalSizeVariants
- [x] Updated AssetLoader.js preloadNodesAtSizes default to match new presets
- [x] Added get_icon_originals_path() to Python OutputManager
- [x] Added build_overlay_prompt() to Python prompt_templates.py

**Architecture:**
- Python: generate 1024x1024 → `process_to_original()` (rembg → crop → square) → save to `originals/`
- Node.js: read from `originals/` → `generateCanonicalSizeVariants()` (ImageMagick Lanczos) → save to `{size}/`
- Tiles exempt: diamond masking is type-specific, single output size, no quality loss

**Files Changed (Python - image-generator):**
- `modia-generators/lib/image_processing.py` - Added `process_to_original()`
- `modia-generators/lib/output_manager.py` - Added `get_icon_originals_path()`
- `modia-generators/lib/prompt_templates.py` - Added `build_overlay_prompt()`
- `modia-generators/generate_portrait.py` - Uses `process_to_original()`, removed resize_with_alpha
- `modia-generators/generate_node.py` - Uses `process_to_original()`, removed manual chain
- `modia-generators/generate_icon.py` - Uses `process_to_original()`, single original output
- `modia-generators/generate_item.py` - Uses `process_to_original()`, removed multi-size loop
- `modia-generators/generate_obstacle.py` - Uses `process_to_original()`
- `modia-generators/generate_overlay.py` - New file

**Files Changed (Node.js - Modia):**
- `shared/assetPaths.js` - nodes presets [48, 64, 96, 128, 256]
- `scripts/ai-images/lib/resizeUtils.js` - nodes presets + AI_RESOLUTIONS to 1024x1024
- `scripts/ai-images/generate-portraits.js` - Removed external copy/rembg workaround, simplified
- `scripts/ai-images/generate-nodes.js` - Sizes [48, 64, 96, 128, 256]
- `scripts/ai-images/generate-icons.js` - Added generateCanonicalSizeVariants [16-128]
- `scripts/ai-images/generate-overlays.js` - Unconditional canonical variants [32-128]
- `frontend/src/core/AssetLoader.js` - Updated preloadNodesAtSizes, comments

### 7.17 Battle Asset Generation Pipeline Expansion (Completed Jan 2026)

Expanded the AI image generation pipeline to support battle-specific asset categories: obstacles and character sprites.

- [x] Created obstacle metadata structure (`ai-image-metadata/obstacles/`)
  - `manifest.json` with categoryFiles for rocks and trees
  - `rocks.json` - 5 rock types
  - `trees.json` - 5 tree types
- [x] Created character sprite metadata structure (`ai-image-metadata/characters/`)
  - `manifest.json` with sprite convention (64x512 vertical strips, 8 frames)
  - `players.json` - 4 classes with animation definitions
  - Per-biome enemy files in `enemies/` subdirectory (forest, cave, mountain, bridge, castle)
- [x] Added admin dashboard pages for new asset categories
  - `ObstaclesPage.jsx` - Subcategory filtering (rocks/trees)
  - `CharactersPage.jsx` - Biome filtering, animation preview
  - `SpritePreview.jsx` - Animated sprite rendering component

**Naming Convention Fixes:**
| Original | Corrected | Reason |
|----------|-----------|--------|
| `player.json` | `players.json` | Plural consistency |
| Array key `"characters"` | `"players"` | Descriptive alignment |
| Flat `enemies.json` | Per-biome `enemies/*.json` | Matches asset loading |

**Manifest Structure:**
```json
{
  "categoryFiles": {
    "players": "players.json",
    "enemies": {
      "forest": "enemies/forest.json",
      "cave": "enemies/cave.json",
      ...
    }
  }
}
```

**Design Document:** `docs/archive/design-docs/2026-01-30-battle-asset-generation-design.md`

### 7.7 Pending

- [ ] Regenerate all ~300 floor tiles with new diamond prompts
- [ ] Regenerate 6 node images marked for regeneration
- [ ] Evaluate player portraits (60 combinations)
- [ ] Evaluate item sprites (49 items)
- [ ] Evaluate UI icons (80 icons)
- [ ] Create `validate-size-variants.js` script for checking missing variants
- [ ] Regenerate all assets using new 1024x1024 pipeline (portraits, nodes, icons, items)

### 7.8 Admin Asset Manager (Completed Jan 2026)

Development-only dashboard for AI asset generation and management. Available at `npm run dev:admin` (port 8081).

- [x] React + Vite workspace with Tailwind CSS + Radix UI
- [x] Dev-only API routes (`/api/admin/*`) with production blocking
- [x] Dashboard with stats cards, quick actions, generation console
- [x] Asset browser with filtering, multi-select, bulk operations
- [x] Asset detail panel for editing metadata, prompts, seeds
- [x] Real-time generation streaming via WebSocket
- [x] Settings page: theme editor, generation config, backup management
- [x] Keyboard shortcuts, toast notifications, responsive design

**Security:** Routes gated by `NODE_ENV !== 'production'`, rate limiting (30/min), timestamp validation for path traversal prevention.

**Files:**
- `admin/` - Complete React workspace (35+ files)
- `api/src/routes/admin.js` - Admin API endpoints
- `api/src/services/adminGenerationService.js` - Generation queue
- `api/src/websocket/index.js` - admin:generation room

### 7.9 Asset Generation System Refactoring (Completed Jan 2026)

Per-asset LoRA model selection and generation backend switching.

- [x] Per-asset LoRA model selection with priority: asset-level > category defaults > fallback
  - Available models: v1 (flat 2D), v2 (isometric), modern-pixel, retro-pixel
  - Category defaults: tiles=v2, portraits/items/icons/nodes/overlays=v1
- [x] Generation backend selection API (ComfyUI local vs HuggingFace cloud)
- [x] Audio status field transformation (generated boolean → status 'exists'|'missing')
- [x] SFX prompt validation at queue time (max 1 comma for ElevenLabs)
- [x] Suno task auto-polling (30s interval) with WebSocket broadcasts
- [x] Incremental seed persistence (`ai-image-metadata/seed-state.json`)
- [x] Waveform data persistence to audio metadata
- [x] Shared script utilities library (`scripts/lib/` - 6 modules)
- [x] Legacy tile metadata cleanup (deleted 5 unused biome files)

**New API Endpoints:**
- `GET /api/admin/generate/settings` - Get current backend preference
- `POST /api/admin/generate/settings` - Set generation backend

**New Files:**
- `ai-image-metadata/seed-state.json` - Persisted seed value
- `scripts/lib/` - Shared utilities (pathUtils, logger, fileUtils, envLoader, generationConfig, index)

**Deleted Files:**
- `ai-image-metadata/tiles/{forest,cave,mountain,bridge,castle}.json` - Legacy biome files

**Commit:** `466b526 feat: Asset Generation System Refactoring - Per-asset LoRA and backend selection`

### 7.10 Unified Asset Generation Dashboard (Completed Jan 2026)

Consolidated view for all three generation queues (images, music, SFX) in the admin dashboard.

- [x] Unified WebSocket events (`asset:generation_update`) across all generators
- [x] `useUnifiedGeneration` hook aggregating all three queue states
- [x] `UnifiedGenerationBar` - persistent bottom status bar with color-coded indicators
- [x] `UnifiedAssetPanel` - split view (40% console / 60% assets grid)
- [x] `AssetPreviewCard` - image thumbnails and audio waveforms with playback
- [x] Metadata sync endpoints for audio file verification
- [x] Renamed "Images" terminology to "Assets" throughout

**New Components:**
- `admin/src/hooks/useUnifiedGeneration.js` - Unified state management
- `admin/src/components/UnifiedGenerationBar.jsx` - Bottom status bar
- `admin/src/components/UnifiedAssetPanel.jsx` - Split console/assets view
- `admin/src/components/AssetPreviewCard.jsx` - Unified preview cards

**New API Endpoints:**
- `POST /api/admin/audio/sync-status` - Verify and sync audio file status
- `GET /api/admin/audio/verify-status` - Check file existence for tracks

**WebSocket Events:**
- `asset:generation_update` - Unified event with source identifier (images/music/sfx)
- Socket joins both `admin:generation` and `admin:audio-generation` rooms

**Commit:** `521e3fa feat: Unified Asset Generation System for Admin Dashboard`

### 7.11 Regeneration Queue Workflow (Completed Jan 2026)

Implemented queue-based workflow for asset regeneration to replace immediate execution pattern:

**Workflow Changes:**
- [x] Replaced `GenerationConsole` with `UnifiedAssetPanel` (file deleted in legacy cleanup)
- [x] Added Queue tab to `UnifiedAssetPanel` showing items marked for regeneration
- [x] Replaced dropdown filters with clickable tabs (All/Images/Music/SFX)
- [x] Refactored bulk actions: "Add to Queue" (marks) vs "Generate Now" (immediate)
- [x] Added queue visibility in `UnifiedGenerationBar` with count badge

**New Frontend Files:**
- `admin/src/hooks/useRegenerationQueue.js` - Queue state management with fetchQueue, markItem, markMultiple, clearCategory, clearAll, startBatchGeneration

**Modified Frontend Files:**
- `admin/src/pages/Dashboard.jsx` - Removed GenerationConsole usage
- ~~`admin/src/components/GenerationConsole.jsx`~~ - Deleted (legacy cleanup)
- ~~`admin/src/hooks/useGeneration.js`~~ - Deleted (legacy cleanup)
- `admin/src/components/UnifiedAssetPanel.jsx` - Queue/Console/Assets tabs, source filtering
- `admin/src/components/UnifiedGenerationBar.jsx` - Queue button with count
- `admin/src/components/AssetGrid.jsx` - "Add to Queue" and "Generate Now" bulk actions
- `admin/src/components/Layout.jsx` - Queue state wiring
- `admin/src/lib/api.js` - Regeneration queue API methods

**New API Endpoints:**
- `PUT /api/admin/assets/mark-multiple` - Bulk mark assets for regeneration
- `POST /api/admin/regeneration-queue/clear` - Clear queue (all or by category)
- `GET /api/admin/audio/regeneration-queue` - List audio items marked for regeneration
- `PUT /api/admin/audio/:type/:id/mark-regeneration` - Mark/unmark single audio item
- `PUT /api/admin/audio/mark-multiple` - Bulk mark audio items

**Commit:** `6a17841 feat: Regeneration queue workflow for admin dashboard`

### 7.12 Asset Loading System Remediation (Completed Jan 2026)

Fixed admin dashboard portrait loading issues where grid thumbnails showed 404 errors while detail panes worked. Root cause was two incompatible path conventions and missing size variant generation.

**Issues Fixed:**
- Admin grid using `assetPaths.js` → `/assets/portraits/{size}/{id}.png` (404 - files didn't exist)
- Detail pane using hardcoded `/assets/sprites/portraits/{id}.png` (worked - legacy location)
- Python image-generator saving 1024x1024 originals to external project, JS only finding 64x64 processed files
- Double directory bug: `ENEMY_OUTPUT_BASE` included `portraits/` but Python added it again

**Solution:**
- Created `admin/src/lib/assetPathHelper.js` - Asset URL helper (legacy fallbacks removed in cleanup)
- Updated admin components to use canonical path helper
- Updated `api/src/routes/admin.js` to compute and include `path` property in responses
- Fixed `generate-portraits.js` to copy 1024x1024 originals from external image-generator project
- Enhanced migration script to scan external originals directory

**Files Modified:**
- `admin/src/lib/assetPathHelper.js` (new) - `getAssetUrls()` (legacy `getAssetUrlsWithFallback()` and `getLegacyPaths()` removed in cleanup)
- `admin/src/components/AssetCard.jsx` - Removed legacy path params, use assetPathHelper
- `admin/src/components/AssetDetail.jsx` - Fallback handling with `imageUrls` state
- `admin/src/components/AssetPreviewCard.jsx` - Compute path from metadata
- `api/src/routes/admin.js` - Added `enrichAssetWithPath()` helper
- `scripts/ai-images/lib/resizeUtils.js` - Added `getCanonicalSizedPath()`, `generateCanonicalSizeVariants()`
- `scripts/ai-images/generate-portraits.js` - External originals integration, fixed `ENEMY_OUTPUT_BASE`
- `scripts/ai-images/migrate-asset-paths.js` - Scan external originals, generate all size variants

**Migration Results:**
- 318 portrait files processed
- 315 new variants generated from 1024x1024 originals
- All enemy portraits (enemy_cave_bat, enemy_giant_spider, etc.) now have 64/128/256 variants

**New npm script:** `npm run ai:migrate-paths` - Migrate legacy assets and generate size variants

### 7.13 LoRA Model Selection UI (Completed Jan 2026)

Added per-asset LoRA model selection to admin dashboard detail panel, enabling style customization for individual assets.

**Features:**
- Style Model dropdown in asset detail panel with 4 LoRA options:
  - Flat 2D Pixel Art (v1) - `GRPZA` trigger
  - Isometric/Textured (v2) - `wbgmsst` trigger
  - Modern Pixel Art - `umempart` trigger
  - Retro 8-bit - `Retro Pixel` trigger
- Category defaults shown when no per-asset selection
- Selection saved to asset metadata JSON files
- Regeneration uses selected model's trigger word

**Files Modified:**
- `api/src/routes/admin.js` - Added `loraModel` to allowedFields, validation, `/api/admin/config` endpoint
- `admin/src/components/AssetDetail.jsx` - Style Model dropdown, config loading
- `admin/src/lib/api.js` - `getConfig()` method
- `scripts/ai-images/migrate-asset-paths.js` - One-time migration header comment

**Path Verification:**
All generation scripts (`generate-portraits.js`, `generate-items.js`, `generate-nodes.js`) confirmed to use canonical paths via `generateCanonicalSizeVariants()`. No migration needed for new assets.

**Design doc:** `docs/plans/2026-01-25-lora-model-selection-design.md`

### 7.14 Asset Pipeline Bug Fix & Deduplication (Completed Jan 2026)

Fixed critical multi-key generation bug and extracted shared modules from generator scripts.

- [x] Fixed multi-key `--key` flag bug in all 6 image generation scripts (overwrite instead of accumulate)
- [x] Created `scripts/ai-images/lib/parseArgs.js` - shared argument parsing module
- [x] Created `scripts/ai-images/lib/filterAssets.js` - shared key-based filtering utility
- [x] Updated `scripts/ai-images/lib/index.js` with new exports
- [x] Refactored all 6 scripts to use shared modules (~500 lines eliminated)
- [x] Normalized `adminAudioGenerationService.js` to use `keys` array consistently
- [x] Fixed `scripts/audio/generate-all.js` to use `keys: []` array pattern
- [x] Added count badges to admin dashboard bulk action buttons

**Bug Impact:** Admin dashboard "Generate Now" with multiple selected assets only generated the last one. Now correctly generates all selected assets.

### 7.15 Asset Path Remediation (Completed Jan 2026)

Resolved all remaining asset path discrepancies between Python OutputManager, JS generation scripts, and the canonical `shared/assetPaths.js` module. Ensures a single source of truth for all asset output directories.

- [x] Updated `backupUtils.js` to use canonical paths from `shared/assetPaths.js`
- [x] Updated `validate-images.js` to use canonical paths from `shared/assetPaths.js`
- [x] Updated `validate-paths.js` to use canonical paths from `shared/assetPaths.js`
- [x] Updated 5 category `manifest.json` `outputDir` fields to match canonical paths
- [x] Deleted obsolete `migrate-sizes.js` (398 lines of dead code)
- [x] Cleaned up legacy asset files on disk
- [x] Fixed admin test factories referencing legacy paths
- [x] Removed dead code (directory/suffix `sizePattern` branches)

**Impact:** All asset pipeline tools now derive paths from `shared/assetPaths.js`, eliminating path drift between Python generators, JS scripts, validation tools, and the admin dashboard.

---

## 8. Technical Debt & Code Quality

### 8.1 File Size Enforcement (Updated Jan 2026)

File size limits are enforced during plan validation and code review:

| Threshold | Level | Action |
|-----------|-------|--------|
| 500 | Target | Ideal file size |
| 1000 | Notice | Note in review |
| 1500 | Warning | Flag prominently, requires module summary comment |
| 2500 | Warning | Strong warning, plan modularization |
| **3500** | **BLOCKING** | Halt validation, require modularization |

**Tracked Large Files:**
| File | Lines | Status |
|------|-------|--------|
| `frontend/src/scenes/BattleScene.js` | 2,708 | OK - reduced from 3,215 |
| `frontend/src/scenes/WorldMapScene.js` | 2,338 | OK - reduced from 3,099 |
| `frontend/src/battle/BattleUI.js` | 1,810 | OK |

*Last updated: 2026-02-02*

**Completed Large File Refactoring (Feb 2026):**
All previously flagged files have been modularized:
- `BattleScene.js`: Extracted `BattleInputHandler.js`, `BattleAudioManager.js`
- `WorldMapScene.js`: Extracted `WorldMapPathSystem.js`, `WorldMapNodeRenderer.js`
- `marketplaceService.js`: Split into `marketplace/` (6 modules, 47-line wrapper)
- `coliseumService.js`: Split into `coliseum/` (6 modules, 71-line wrapper)
- `admin.js`: Split into `admin/` (5 sub-routers, 136-line wrapper)
- `websocket/index.js`: Extracted 4 utility modules (508 lines)
- `SettingsScene.js`: Extracted 3 modules (833 lines)
- `world.js`: Split into `world/` (4 sub-routers, 55-line wrapper)
- `TavernScene.js`: Extracted 2 chat modules (1,112 lines)
- `BattleUI.js`: Extracted `BattlePvPUI.js`, `BattleConfirmationUI.js`

All files are now under the 3500-line blocking threshold.

See **CLAUDE.md > File Size Guidelines** for modularization patterns, module summary requirements, and chunk reading guidance.

### 8.2 Known Issues

| Issue | Location | Priority | Status |
|-------|----------|----------|--------|
| ~~In-memory rate limit state (no distributed storage)~~ | rateLimiterFactory.js | ~~High~~ | **Resolved** v9.4 - Redis store with fallback |
| ~~WebSocket rate limits reset on reconnection~~ | websocket/index.js | ~~High~~ | **Resolved** v9.4 - Redis sorted sets |
| Inline listeners without cleanup | LoginScene.js, WorldMapScene.js | Medium | Open |
| ~~Missing rate limiters on inventory endpoints~~ | inventory.js | ~~Medium~~ | **Resolved** v9.4 - economyRateLimiter |
| API response format inconsistency | Various routes | Low | Open |
| ~~Debug endpoint in production~~ | debug.js | ~~Low~~ | **Resolved** v9.4 - gated by NODE_ENV |
| ~~Event name mismatch (party:invite)~~ | Game.js / partyWebsocket.js | ~~Medium~~ | **Resolved** - uses party:invite_received |
| ~~SkillTreePanel.js potentially unused~~ | frontend/src/components/ | ~~Low~~ | **Resolved** - file removed |
| ~~Missing null check in waveform fallback~~ | ~~adminAudio.js:633~~ | ~~High~~ | **Resolved** 2026-04-25 - error responses sanitized |
| ~~Duplicate `validateSFXPrompt()` function~~ | ~~adminAudio.js, adminAudioGenerationService.js~~ | ~~Medium~~ | **Resolved** 2026-04-25 - consolidated |
| ~~Duplicate `VALID_CATEGORIES` constant~~ | ~~admin.js, adminGenerationService.js~~ | ~~Low~~ | **Resolved** 2026-04-25 - consolidated |
| ~~Missing JSDoc on admin service exports~~ | ~~adminGenerationService.js~~ | ~~Low~~ | **Resolved** 2026-04-25 - documented |
| ~~No tests for admin generation endpoints~~ | ~~api/src/tests/~~ | ~~Medium~~ | **Resolved** v10.2 - 72 admin tests |
| Backend selection not persisted (in-memory) | adminGenerationService.js:90 | Low | Open |
| Socket callbacks not cleared on unmount | useUnifiedGeneration.js:133-147 | Low | Open (admin tooling) |
| ~~Duplicate `parseProgress()` function~~ | ~~adminGenerationService.js:156, adminAudioGenerationService.js:132~~ | ~~Low~~ | **Resolved** 2026-04-25 - consolidated |
| ~~Duplicate `generateJobId()` function~~ | ~~adminGenerationService.js:103, adminAudioGenerationService.js:72~~ | ~~Low~~ | **Resolved** 2026-04-25 - consolidated |
| ~~~200 lines duplicated across 6 generator scripts~~ | ~~scripts/ai-images/generate-{tiles,portraits,items,icons,nodes,overlays}.js~~ | ~~Medium~~ | **Resolved** v10.5 - shared parseArgs.js + filterAssets.js |
| ~~WebSocket character ownership validation~~ | ~~battle.js~~ | ~~High~~ | **Resolved** 2026-04-25 - S1 security validation (Character ownership checks in WebSocket handlers) |
| ~~Fishing session error handling~~ | ~~fishingService.js~~ | ~~Medium~~ | **Resolved** 2026-04-25 - S2 error handling (Session validation and error responses) |
| ~~Missing validateNumericParam utility~~ | ~~multiple files~~ | ~~Medium~~ | **Resolved** 2026-04-25 - C2 code quality (Consolidated parameter validation) |
| ~~Battle business logic coupling~~ | ~~battle.js~~ | ~~High~~ | **Resolved** 2026-04-25 - C1 business logic extraction (Extracted to battleRewardService.js) |

*Issues audited: 2026-01-27 (updated: generator script duplication resolved v10.5)*

**Validation Report:** See `docs/archive/reports/2026-01-25-asset-refactoring-validation.md` for full findings.

### 8.3 Refactoring Opportunities

- [x] **seed.js modularization** - Reduced from 4862 to 918 lines via worldgen/ modules
- [x] **Database performance indexes** - Composite indexes for regional queries (030_performance_indexes.sql)
- [x] **Large file modularization** (Jan 2026) - Split monolithic files into focused modules:
  - Frontend: AudioAssets.js split into 6 manifest modules, MarketplaceScene CSS + tabs extracted, ColiseumScene styles + tabs extracted
  - Backend: battleService.js (1855→66 lines) split into 9 modules in `api/src/services/battle/`, world routes refactored with 5 services in `api/src/services/world/`
- [x] **Legacy code cleanup** (Jan 2026) - 4-phase cleanup removing dead code, migrating deprecated APIs, removing legacy fallbacks, and standardizing property names across admin dashboard, frontend, and shared modules
- [x] **Chest loot system** - Item drops by distance tier (2026-04-25) - `chestLootService.js` with tier-based rewards
- [x] **Lore content system** - Database-driven lore content (2026-04-25) - `shared/loreContent.js` with 48 entries
- [x] **Relic quest validation** - Real database lookups (2026-04-25) - character quest validation via database
- [x] **Social hub tabs integration** - Real tab modules (2026-04-25) - PartyTab, RequestsTab, ClanTab, LFGTab, FriendsTab mounted
- [x] **Battle business logic extraction** - Reward processing modularization (2026-04-25) - `battleRewardService.js`
- [x] **Event listener cleanup** - Memory leak prevention (2026-04-25) - AbortController usage in AuthScene
- [ ] Consolidate settings modal and scene
- [ ] Unify WebSocket event naming
- [ ] Add TypeScript types (future)
- [ ] API response standardization
- [ ] Database audit trail for gold/item changes (track before/after values)
- [ ] Request validation layer (Zod schemas for consistent input validation)
- [x] Distributed rate limiting (Redis) for horizontal scaling (v9.4: rate-limit-redis with graceful fallback)
- [ ] Structured logging with request correlation IDs
- [x] **Generator script deduplication (Phase 1)** — Extracted shared `parseArgs.js` (~80 lines of CLI flag parsing) and `filterAssets.js` (key-based filtering) into `scripts/ai-images/lib/`. All 6 generator scripts refactored to use shared modules, eliminating ~500 lines of duplicated code. Fixed critical multi-key bug where `--key` flags overwrote instead of accumulating. (v10.5)
- [ ] **Generator script deduplication (Phase 2)** — Further extraction of remaining shared boilerplate into `scripts/ai-images/lib/generationRunner.js`: `validateEnvVars()`, `needsGeneration()`, `--queue` mode loading via `loadRegenerationQueue()`/`clearRegenerationMarker()`, generation loop with rate limiting, backup handling, summary output, and post-processing via `generateCanonicalSizeVariants()`. Each script should reduce to ~50-80 lines defining only its category-specific config (output paths, prompt building, metadata loading).

### 8.4 Future Infrastructure

| Item | Priority | Notes |
|------|----------|-------|
| API versioning (/api/v1/...) | Low | Only when breaking changes needed |
| Database connection pooling (pgBouncer) | Medium | For horizontal scaling |
| ~~Health check expansion~~ | ~~High~~ | **Completed** v9.4 - DB, Redis, WebSocket, memory, rate limiter metrics |
| Log aggregation service | Medium | JSON structured logs for monitoring |

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| API uptime | 99% | N/A |
| API response time (p95) | < 200ms | ~150ms |
| WebSocket latency | < 100ms | ~50ms |
| Error rate | < 1% | ~0.5% |
| Concurrent users | 25 | Untested |
| Test coverage | 80% | ~75% |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 3.9 | Feb 2026 | WebSocket Reliability System: Updated Section 4.4 (WebSocket Efficiency) to mark implementation as completed (2026-02-02). Documented message ACK protocol with retry logic, bidirectional heartbeat with zombie detection, sequence-based message ordering, auto-recovery via full state sync. Added implementation details for messageReliability.js (ACK tracking, retry queuing, state sync on max retries), websocket/index.js (ping/pong, zombie cleanup), and battleWebsocket.js integration. Related PR references: battle reconnection tests, hero state persistence. |
| 3.8 | Jan 2026 | Battle Asset Generation Pipeline Expansion: Added Section 7.17 documenting expanded AI image pipeline for battle assets. Created obstacle metadata (rocks.json, trees.json) with manifest.json categoryFiles. Created character sprite metadata (players.json, per-biome enemies/*.json) with 64x512 vertical strip convention. Added admin dashboard pages (ObstaclesPage.jsx, CharactersPage.jsx) with SpritePreview component for animated sprites. Fixed naming conventions (player.json to players.json, flat enemies.json to per-biome structure). Design doc archived to docs/archive/design-docs/2026-01-30-battle-asset-generation-design.md. |
| 3.8 | Jan 2026 | Image Pipeline Refactor (v10.8): Added Section 7.16 documenting standardized generation & post-processing. Python saves 1024x1024 processed originals via process_to_original(), Node.js generates all size variants via ImageMagick. Extended node sizes from [48,96] to [48,64,96,128,256]. Added icon 128px variant. Removed portrait rembg workaround. Created Python overlay generator. Updated AI_IMAGE_GENERATION.md resolution tables. |
| 3.7 | Jan 2026 | Major Test Suite Expansion (v10.7): Added ~4,900 lines across 13 new files + 7 extended files. Shared tests: battleMath.test.js +660 lines (16 new function suites), constants.test.js +235 lines (5 new sections), pathfinding.test.js +3 suites (performance, mixed terrain, water). Created 9 AI unit test files (224 tests/72 suites): patternWeights, cache, utilityFactors, stateEvaluator, actionGenerator, lookahead, utilityAI, aiPatternBehavior with mockHelpers. Created 4 worldgen unit test files (125 tests/19 suites): castlePlacement, nodeGeneration, internalConnections, validation. Extended 4 balance tests: classBalance (all 16 advanced classes), damageScaling (elemental), formulaValidation (CT/status), economyBalance (fishing/caravan). Added npm scripts: test:unit:ai, test:unit:worldgen. Updated test:unit glob for subdirectories. Final counts: Shared 360 tests, API unit 754 tests, all passing. Testing status updated to 90%, coverage to ~75%. |
| 3.6 | Jan 2026 | Asset Path Remediation: Added Section 7.15 documenting resolution of all asset path discrepancies between Python OutputManager, JS scripts, and canonical shared/assetPaths.js. Updated backupUtils.js, validate-images.js, validate-paths.js to use canonical paths. Updated 5 category manifest.json outputDir fields. Deleted obsolete migrate-sizes.js (398 lines). Cleaned up legacy asset files and admin test factories. Removed dead sizePattern code branches. |
| 3.5 | Jan 2026 | Asset Pipeline Bug Fix & Deduplication (v10.5): Fixed critical multi-key generation bug in all 6 AI image scripts (--key flag overwrote instead of accumulating). Created shared parseArgs.js and filterAssets.js modules eliminating ~500 lines of duplicated code. Normalized audio service to use keys array. Added count badges to admin bulk action buttons. Marked generator script duplication as resolved in Section 8.2. Updated Section 8.3 refactoring opportunities with Phase 1 complete, Phase 2 remaining. Added Section 7.14. |
| 3.4 | Jan 2026 | Legacy Code Cleanup (v10.4): 4-phase cleanup removing dead code (GenerationConsole.jsx, useGeneration.js, useAudioGeneration.js, loadElevatedTile, CLASS_ADVANCEMENT, legacyTrigger), migrating deprecated APIs (getAssetUrl→getAssetPath, buildTilePrompt→buildFlatTilePrompt, renderTileAt→renderTileUnified), removing legacy fallbacks (wall/slope naming, getLegacyPaths/getAssetUrlsWithFallback→getAssetUrls, legacy biomeFiles), and standardizing property names (HP/MP fallback chains→snake_case). Updated Section 8.3, known issues, and historical sections. |
| 3.3 | Jan 2026 | UnifiedAssetPanel Fixes (v10.3): Fixed 5 issues - asset path 404s, duplicate Assets/Console entries, UI consolidation (moved tabs from panel top bar to bottom generation bar), queue-to-generation pipeline for all categories. Added `--queue` flag to portraits/items/icons/nodes generators. Documented generator script duplication debt in Section 8.3. |
| 3.2 | Jan 2026 | Admin Dashboard Code Review & Remediation (v10.2): 7-phase remediation addressing 26 issues. SettingsPage.jsx modularized (1,144→215 lines) into 4 tab components. API client split from 425-line god object into 9 focused modules. Hook consolidation: GenerationContext now uses useUnifiedGeneration with backward compatibility. Unified components with configs.js for image/audio asset handling. Testing infrastructure: 72 tests (24 API, 13 format, 17 timeFormat, 18 smoke) with ~88% API coverage, ~98% utility coverage. Marked "No tests for admin generation endpoints" as resolved. |
| 3.1 | Jan 2026 | Production Readiness Implementation: Added home-grown exception tracking system (PostgreSQL-based with fingerprint grouping). Request correlation IDs via X-Request-ID middleware. File-based error logging with daily rotation for VPS. User feedback system (enhancement/bug/abuse reports) with FeedbackModal UI in Settings. Simplified CI pipeline (removed integration tests from PR, main-only E2E). Added npm audit security scanning. Dependabot automation for weekly dependency updates. Codecov integration for coverage reporting. Migration 040_error_tracking.sql with exception_groups, exception_events, user_feedback tables. Updated Section 2.1 GitHub Actions and Section 5.2 Error Tracking to completed status. |
| 3.0 | Jan 2026 | LoRA Model Selection UI: Added Section 7.13 documenting per-asset LoRA model selection in admin dashboard. Style Model dropdown with 4 options (v1, v2, modern-pixel, retro-pixel). Added /api/admin/config endpoint for model definitions. Updated AssetDetail.jsx with dropdown and category default hints. Verified all generation scripts use canonical paths via generateCanonicalSizeVariants(). Marked migrate-asset-paths.js as one-time migration. Design doc: docs/plans/2026-01-25-lora-model-selection-design.md. |
| 2.9 | Jan 2026 | Asset Loading System Remediation: Added Section 7.12 documenting admin dashboard asset loading fixes. Fixed two incompatible path conventions causing 404s on portrait grid. Created admin/src/lib/assetPathHelper.js with fallback URL support. Fixed generate-portraits.js to copy 1024x1024 originals from external image-generator project. Enhanced migrate-asset-paths.js to scan external originals. Fixed double directory bug (ENEMY_OUTPUT_BASE). Added npm run ai:migrate-paths script. Migrated 318 portraits with 315 new size variants generated. |
| 2.8 | Jan 2026 | Regeneration Queue Workflow: Added Section 7.11 documenting queue-based asset regeneration workflow. Deprecated GenerationConsole in favor of UnifiedAssetPanel. Added Queue tab showing marked items grouped by category. Replaced dropdown filters with clickable tabs (All/Images/Music/SFX). Refactored bulk actions: "Add to Queue" (marks) vs "Generate Now" (immediate). New useRegenerationQueue hook. New API endpoints: mark-multiple, regeneration-queue/clear, audio regeneration queue endpoints. Commit 6a17841. |
| 2.7 | Jan 2026 | Unified Asset Generation Dashboard: Added Section 7.10 documenting unified view for all generation queues. Created useUnifiedGeneration hook aggregating images/music/SFX queues. Added UnifiedGenerationBar (bottom status bar), UnifiedAssetPanel (split console/assets view), AssetPreviewCard (image thumbnails, audio waveforms). New API endpoints for metadata sync (sync-status, verify-status). Unified WebSocket events (asset:generation_update) with source tagging. Commit 521e3fa. |
| 2.6 | Jan 2026 | Asset Path Standardization: Added Section 7.6 documenting unified asset path system. Rewrote shared/assetPaths.js with single getAssetPath() and getOriginalsPath() functions. Removed getLegacyPath/getStandardizedPath. Updated AssetLoader.js: basePath /assets, forest fallback, enemy_ prefix, no node_ prefix. Updated all generation scripts with new output paths. Updated metadata JSONs. Created migrate-asset-paths.js migration script. Migrated 682 assets. Renumbered sections (7.6→7.7 Pending, 7.7→7.8 Admin). |
| 2.5 | Jan 2026 | Asset Loading System Refactoring: Added Section 7.5 documenting size-aware asset loading. Updated shared/assetPaths.js with getOptimalSize(), size-aware portrait/node paths. Refactored AssetLoader.js with getPortraitUrl, getEnemyPortraitUrl, loadNodeSpriteAtSize. Updated 4 scenes and 4 components. Integrated post-processing into generate-portraits.js/generate-nodes.js. Added getImageDimensions() with timeout. Renumbered sections (7.5→7.6 Pending, 7.6→7.7 Admin). |
| 2.4 | Jan 2026 | Security & Testing Infrastructure (v9.4): Added Redis-backed rate limiting with graceful fallback. Comprehensive endpoint protection (70+ endpoints via economyRateLimiter, characterRateLimiter, socialRateLimiter). Gated debug endpoints in production. Enhanced health checks with Redis, rate limiter stats, liveness/readiness endpoints. Artillery.io load testing infrastructure for 25 concurrent users. E2E tests: character creation, battle flow, error handling. Shared test helpers. Updated status: Testing 85%, Monitoring 60%, Infrastructure 75%. |
| 2.3 | Jan 2026 | Post-Processing Pipeline Overhaul: Added Section 7.4 documenting new asset-specific post-processing functions. Removed --sizes flag, standardized resolutions (256 portraits/nodes, 128 tiles/items/icons). Added diamond mask for tiles, improved prompts for geometry. Renumbered pending items to 7.5. Commit 91ac94b. |
| 2.2 | Jan 2026 | AI Image Quality Evaluation: Added Section 7 for AI Image Generation System. Documented prompt builder improvements (removed white background, added composition constraints). Added quality evaluation system with scoring criteria. Section numbering updated (7→8 for Technical Debt). |
| 2.2 | Feb 2026 | Large File Refactoring Phase 2: Modularized 10 oversized files. Backend: admin.js (5 sub-routers), world.js (4 sub-routers), marketplaceService.js (6 modules), coliseumService.js (6 modules), websocket/index.js (4 modules). Frontend: BattleScene.js (2 extractors), WorldMapScene.js (2 extractors), SettingsScene.js (3 modules), TavernScene.js (2 modules), BattleUI.js (2 components). All files now under 3500-line threshold. |
| 2.1 | Jan 2026 | Documentation Audit: Updated file size table with verified line counts. Audited known issues - resolved party:invite mismatch (uses party:invite_received) and SkillTreePanel.js (file removed). Added status column to known issues. |
| 2.0 | Jan 2026 | ESLint Warning Cleanup: Resolved all 138 `no-unused-vars` warnings (69 API + 69 frontend) across 58 files. Used `_` prefix convention for intentionally unused parameters required by signatures (Express middleware, base class methods, callbacks). |
| 1.9 | Jan 2026 | File Size Enforcement: Added Section 7.1 with 2500-line blocking threshold, tracked large files table. Fixed section numbering (7.1-7.4). Cross-references CLAUDE.md > File Size Guidelines for patterns. |
| 1.8 | Jan 2026 | Large File Modularization: Split battleService.js (1855→66 lines) into 9 focused modules. Created api/src/services/battle/ with damageCalculator, statusEffectManager, movementService, turnOrderService, chargeSystem, aoeService, skillDefinitionService, actionProcessor. Extracted world services (pathfinding, discovery, region, node). Frontend: AudioAssets split into 6 manifests, MarketplaceScene/ColiseumScene CSS and tabs extracted. |
| 1.7 | Jan 2026 | Quest System Enhancements v9.3: Elite quests with Perfect Week gating (migration 036), rare item drops (15% chance), cosmetic title system, Perfect Week badge on leaderboard. E2E tests for quest flow (quests.spec.js). |
| 1.6 | Jan 2026 | Documentation Consolidation v9.1: Added debug endpoint removal to Security Audit checklist (battle.js:900 /verify-traits). Cross-referenced TODOs from code audit. |
| 1.5 | Jan 2026 | Project cleanup audit: Updated infrastructure completion (60%), marked VPS deployment items as complete (setup.sh, deploy.sh, nginx.conf.template, backup.sh). Added new known issues (inventory rate limits, API inconsistency, debug endpoints). Added refactoring opportunities (audit trail, Zod validation, Redis rate limiting, structured logging). Added Future Infrastructure section. Installed knip for dead code analysis. |
| 1.4 | Jan 2026 | Security & Infrastructure (v8.7): Trust proxy config for proper IP detection. Per-user rate limiting for authenticated requests. New rate limiters: auth/refresh (20/15min), world/travel (60/min), gameplay actions (skill 30/min, inventory 45/min). Increased global limits (300 base). JWT extended to 1h with automatic refresh. TokenRefreshManager for seamless token renewal. VPS deployment scripts: setup.sh, deploy.sh (zero-downtime), nginx.conf.template, backup.sh (7-day retention). |
| 1.3 | Jan 2026 | Technical debt cleanup: seed.js modularization (4862→918 lines, 12 new modules), WorldMapScene pathPreviewCache LRU limits, composite database indexes (030_performance_indexes.sql). |
| 1.2 | Jan 2026 | ItemDataTable & Marketplace plan complete: Added marketplace integration tests, order expiration unit tests, shop refresh unit tests. Testing updated to 70%. |
| 1.1 | Jan 2026 | Roadmap audit v8.0: Added completed integration tests (battle reconnection, coliseum, item drop, party websocket). Updated testing completion to 65%. |
| 1.0 | Jan 2026 | Initial split from DEVELOPMENT_ROADMAP.md |
