# Modia - Technical Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Version | 2.7 |
| Last Updated | January 2026 |
| Focus | Infrastructure, deployment, testing, performance |

---

## Status Summary

| Category | Completion | Status |
|----------|------------|--------|
| Infrastructure | 75% | In Progress |
| CI/CD Pipeline | 40% | In Progress |
| Testing | 85% | In Progress |
| Performance | 50% | In Progress |
| Monitoring | 60% | In Progress |

---

## 1. Infrastructure & Deployment

### 1.1 VPS Server Setup

- [ ] Provision VPS (4GB RAM target)
- [ ] Configure firewall (ufw)
- [ ] Set up SSH keys
- [ ] Configure fail2ban

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

### 1.5 Security

- [ ] SSL certificate (Let's Encrypt)
- [ ] Auto-renewal configuration
- [ ] Security headers (CSP, HSTS)
- [ ] Rate limiting at Nginx level

### 1.6 Domain

- [ ] Domain registration
- [ ] DNS configuration
- [ ] Subdomain setup (api.*, ws.*)

---

## 2. CI/CD Pipeline

### 2.1 GitHub Actions

- [ ] Lint on push
- [ ] Test on pull request
- [ ] Build validation
- [ ] Dependency security scanning

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
- [ ] Settings service tests

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

- [ ] Message size audit
- [ ] Heartbeat tuning
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

### 5.2 Error Tracking

- [ ] Error logging service
- [ ] Alerting configuration
- [ ] Error categorization
- [ ] Stack trace preservation

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
├── portraits/{64,128,256}/       # Player: {race}_{gender}_{class}, Enemy: enemy_{id}
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

### 7.7 Pending

- [ ] Regenerate all ~300 floor tiles with new diamond prompts
- [ ] Regenerate 6 node images marked for regeneration
- [ ] Evaluate player portraits (60 combinations)
- [ ] Evaluate item sprites (49 items)
- [ ] Evaluate UI icons (80 icons)
- [ ] Create `validate-size-variants.js` script for checking missing variants

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
| `frontend/src/scenes/WorldMapScene.js` | 2,861 | WARNING - plan modularization |
| `frontend/src/scenes/BattleScene.js` | 2,680 | WARNING - plan modularization |
| `api/src/services/marketplaceService.js` | 1,956 | WARNING |
| `frontend/src/battle/BattleUI.js` | 1,556 | WARNING - exceeds 1,500 |
| `api/src/services/coliseumService.js` | 1,552 | WARNING |

*Last updated: 2026-01-22*

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
| Missing null check in waveform fallback | adminAudio.js:633 | High | Open |
| Duplicate `validateSFXPrompt()` function | adminAudio.js, adminAudioGenerationService.js | Medium | Open |
| Duplicate `VALID_CATEGORIES` constant | admin.js, adminGenerationService.js | Low | Open |
| Missing JSDoc on admin service exports | adminGenerationService.js | Low | Open |
| No tests for admin generation endpoints | api/src/tests/ | Medium | Open |
| Backend selection not persisted (in-memory) | adminGenerationService.js:90 | Low | Open |
| Socket callbacks not cleared on unmount | useUnifiedGeneration.js:133-147 | Low | Open (admin tooling) |
| Duplicate `parseProgress()` function | adminGenerationService.js:156, adminAudioGenerationService.js:132 | Low | Open |
| Duplicate `generateJobId()` function | adminGenerationService.js:103, adminAudioGenerationService.js:72 | Low | Open |

*Issues audited: 2026-01-25*

**Validation Report:** See `docs/archive/reports/2026-01-25-asset-refactoring-validation.md` for full findings.

### 8.3 Refactoring Opportunities

- [x] **seed.js modularization** - Reduced from 4862 to 918 lines via worldgen/ modules
- [x] **Database performance indexes** - Composite indexes for regional queries (030_performance_indexes.sql)
- [x] **Large file modularization** (Jan 2026) - Split monolithic files into focused modules:
  - Frontend: AudioAssets.js split into 6 manifest modules, MarketplaceScene CSS + tabs extracted, ColiseumScene styles + tabs extracted
  - Backend: battleService.js (1855→66 lines) split into 9 modules in `api/src/services/battle/`, world routes refactored with 5 services in `api/src/services/world/`
- [ ] Consolidate settings modal and scene
- [ ] Unify WebSocket event naming
- [ ] Add TypeScript types (future)
- [ ] API response standardization
- [ ] Database audit trail for gold/item changes (track before/after values)
- [ ] Request validation layer (Zod schemas for consistent input validation)
- [x] Distributed rate limiting (Redis) for horizontal scaling (v9.4: rate-limit-redis with graceful fallback)
- [ ] Structured logging with request correlation IDs

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
| Test coverage | 80% | ~65% |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 2.7 | Jan 2026 | Unified Asset Generation Dashboard: Added Section 7.10 documenting unified view for all generation queues. Created useUnifiedGeneration hook aggregating images/music/SFX queues. Added UnifiedGenerationBar (bottom status bar), UnifiedAssetPanel (split console/assets view), AssetPreviewCard (image thumbnails, audio waveforms). New API endpoints for metadata sync (sync-status, verify-status). Unified WebSocket events (asset:generation_update) with source tagging. Commit 521e3fa. |
| 2.6 | Jan 2026 | Asset Path Standardization: Added Section 7.6 documenting unified asset path system. Rewrote shared/assetPaths.js with single getAssetPath() and getOriginalsPath() functions. Removed getLegacyPath/getStandardizedPath. Updated AssetLoader.js: basePath /assets, forest fallback, enemy_ prefix, no node_ prefix. Updated all generation scripts with new output paths. Updated metadata JSONs. Created migrate-asset-paths.js migration script. Migrated 682 assets. Renumbered sections (7.6→7.7 Pending, 7.7→7.8 Admin). |
| 2.5 | Jan 2026 | Asset Loading System Refactoring: Added Section 7.5 documenting size-aware asset loading. Updated shared/assetPaths.js with getOptimalSize(), size-aware portrait/node paths. Refactored AssetLoader.js with getPortraitUrl, getEnemyPortraitUrl, loadNodeSpriteAtSize. Updated 4 scenes and 4 components. Integrated post-processing into generate-portraits.js/generate-nodes.js. Added getImageDimensions() with timeout. Renumbered sections (7.5→7.6 Pending, 7.6→7.7 Admin). |
| 2.4 | Jan 2026 | Security & Testing Infrastructure (v9.4): Added Redis-backed rate limiting with graceful fallback. Comprehensive endpoint protection (70+ endpoints via economyRateLimiter, characterRateLimiter, socialRateLimiter). Gated debug endpoints in production. Enhanced health checks with Redis, rate limiter stats, liveness/readiness endpoints. Artillery.io load testing infrastructure for 25 concurrent users. E2E tests: character creation, battle flow, error handling. Shared test helpers. Updated status: Testing 85%, Monitoring 60%, Infrastructure 75%. |
| 2.3 | Jan 2026 | Post-Processing Pipeline Overhaul: Added Section 7.4 documenting new asset-specific post-processing functions. Removed --sizes flag, standardized resolutions (256 portraits/nodes, 128 tiles/items/icons). Added diamond mask for tiles, improved prompts for geometry. Renumbered pending items to 7.5. Commit 91ac94b. |
| 2.2 | Jan 2026 | AI Image Quality Evaluation: Added Section 7 for AI Image Generation System. Documented prompt builder improvements (removed white background, added composition constraints). Added quality evaluation system with scoring criteria. Section numbering updated (7→8 for Technical Debt). |
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
