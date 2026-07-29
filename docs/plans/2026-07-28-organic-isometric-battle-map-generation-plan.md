# Organic Isometric Battle Map Generation Audit and Implementation Plan

**Date:** 2026-07-28

**Generator audit baseline:** `dc8c40b2b3349c6b7da8f815dc33fbf0305ada10`

**Current review baseline:** `0cfa674a9b6c86bcf60effd800a127490ae106ce`

**Status:** Implemented in the current worktree; production activation remains
rollout-gated

**Validated:** 2026-07-28 against `0cfa674a` plus the implementation in this
worktree. Validation covers the frozen V1 contract, V2 generation and schemas,
authoritative traversal, persistence/transport, terminal effects, all battle
entry modes, exact renderer assets, focused tests, production builds, database
migrations, a 1,600-map V2 corpus, and fixed/holdout runtime screenshots.

**Scope:** Tactical battle-map generation, authoritative traversal, elevation, hydrology, paths, props, visual variation, isometric rendering, persistence, testing, and rollout

**Related:** [Isometric Tile System](../ISOMETRIC_TILE_SYSTEM.md), [Battle Asset Generation Design](./2026-01-30-battle-asset-generation-design.md), [Isometric Tile Projection Design](./2026-01-28-isometric-tile-projection-design.md)

## Current Implementation Disposition

The architecture specified below is implemented in the current worktree. The
audit narrative and source line references in the following historical sections
describe the two recorded baselines; they are retained to explain why the
architecture exists and must not be read as defects still present in the V2
implementation.

| Workstream | Current disposition | Primary implementation evidence |
|---|---|---|
| V1 compatibility and version dispatch | Complete. V1 is isolated behind immutable compatibility fixtures; unknown versions fail closed. | `shared/mapgen/v1/`, `shared/mapgen/v1Compatibility.test.js`, `shared/mapGeneration.js` |
| V2 schema, canonical hashes, and adapters | Complete. Candidate/final schemas are closed, hashes are domain-separated, and only verified final maps cross persistence/wire boundaries. | `shared/battleMap/`, `shared/battleMapV2.test.js` |
| Shared traversal, spawns, validation, and bounded attempts | Complete. Runtime and generator consumers share the same obstacle/elevation/connection semantics; V2 retries deterministically and fails closed. | `shared/traversal.js`, `shared/mapgen/v2/SpawnLayoutContract.js`, `Validation.js`, `BattleMapGenerator.js` |
| Organic landscape generation | Complete. Correlated fields drive regions, elevation, hydrology, routes, ecology, variants, transitions, and decorations. Wetland abundance and ecology have recipe-specific gates rather than passing on generic integrity alone. | `shared/mapgen/v2/` |
| Rendering and exact assets | Complete. Initial hydration and rendering consume every V2 layer; exact capability validation rejects undeclared fallback. | `shared/mapgen/v2/RenderCapabilities.js`, `frontend/src/battle/BattleGrid.js`, `frontend/src/core/AssetLoader.js` |
| Persistence and lifecycle atomicity | Complete. Migration 052 adds revisioned state ownership; migrations 053-056 provide durable, idempotent terminal effects and redrive support. | `api/src/services/battle/BattleStateRepository.js`, `BattleTerminalOutbox*.js`, `api/src/migrations/052_*` through `056_*` |
| HTTP/WebSocket transport | Complete. Capabilities are negotiated, immutable maps are hash-verified, mutable updates are revisioned/ACKed, and cache or sequence failures recover through a fresh snapshot. Reference/delta delivery remains disabled by default. | `shared/battleStateProtocol.js`, `api/src/services/battleWebsocket.js`, `frontend/src/battle/BattleMapSession.js` |
| Authoritative mode integration | Complete for the existing PvE, guild/advancement, and Coliseum creation paths. The generator and telemetry reserve `pve_coop` and generic `pvp`, but those values are not rollout targets until authoritative creation paths exist. New V2 creation still requires both server rollout and client capability opt-in. | `api/src/services/battle/battleMapGenerationService.js` and entry-path tests |
| Audit, telemetry, and rollout controls | Implemented. Corpus sharding, diversity gates, shadow generation, bounded public metrics, protected replay diagnostics, active-V2 generation SLOs, wire budgets, per-mode enablement, health degradation, and rollback switches are present. Deployment evidence is still required before production activation. | `scripts/audit-battle-maps.js`, `.github/workflows/worldgen-ci.yml`, `api/src/services/battle/BattleMapOperations.js`, `api/src/routes/battleMapOperations.js`, `docs/DEPLOYMENT.md` |

Implementation completion is intentionally separate from production release
readiness. V2 defaults off unless `BATTLE_MAP_V2_ENABLED_MODES` enables a mode,
shadow sampling defaults off, and immutable-map reference/delta delivery
defaults off. A release must first apply migrations 052-056, gather deployed
shadow and wire telemetry, set an explicit generation-p95 SLO, review fixed and
unseen-seed galleries, exercise rollback, and then enable one mode at a time.

### Operational corrections discovered during implementation

The implementation review also reproduced and corrected the four reported
runtime failures plus two acceptance-hardening gaps that could otherwise
obscure or invalidate architecture acceptance:

| Failure | Confirmed cause and correction | Regression evidence |
|---|---|---|
| First battle rejected with `battle_map_capabilities_invalid` | Optional capability fields were forwarded as present-but-`undefined`, violating the closed request schema, while the route over-classified unrelated negotiation exceptions. Capability construction now omits absent fields and the route maps only actual negotiation failures. | `api/src/services/battle/turnOrderService.js`, `api/src/routes/battle.js`, capability and battle-start integration tests |
| Terminal outbox worker repeatedly logged a missing relation | The local schema had not applied migrations 052-056, and the worker treated an absent optional-at-startup relation as a high-frequency generic failure. The migrations are present and applied locally; schema absence now makes readiness fail, suppresses log flooding, and uses a bounded recovery probe. | `api/src/services/battle/BattleTerminalOutboxWorker.js`, `api/src/routes/health.js`, migrations 052-056, worker/readiness tests |
| A player teleported instead of walking | A committed state update could ask an already-moving unit to move to the same logical destination a second time, replacing the non-empty path with a zero-length move. `BattleUnit` now ignores that duplicate destination while movement is active. | `frontend/src/battle/BattleUnit.js`, `frontend/src/battle/__tests__/BattleUnitAnimations.test.js` |
| Merchant Caravan remained on `Calculating...` with no inventory | The API and scene disagreed about canonical versus legacy caravan item/date fields, and an invalid refresh timestamp left the prior label untouched. The presenter/adapter now normalize both shapes, preserve item identity, and always settle the refresh label—even for missing or invalid timestamps. | `api/src/routes/shop.js`, `frontend/src/scenes/ShopScene.js`, shop/caravan API and frontend tests |
| An inaccessible corrupt battle could return a state-corruption 500 before returning an existence-concealing 404 | The participant check happened after authoritative state hydration. Participant membership is now part of the repository query, so an unauthorized row is never hydrated; reconnect recovery uses the same participant-filtered boundary. | `api/src/services/battle/BattleStateRepository.js`, `api/src/services/battleReconnection.js`, repository, reconnect, and battle-access tests |
| Battle-map SLO degradation appeared only in the nested metrics payload | Overall health aggregation did not consume the battle-map operational status. A pure status aggregator now preserves required-dependency failure precedence while promoting worker, outbox, Redis, and battle-map alerts to top-level degradation. | `api/src/services/healthStatus.js`, `api/src/routes/health.js`, unit and health integration tests |

## Historical Audit Outcome and Implemented Direction

At the generator audit baseline, the existing generator had a sound deterministic foundation, a useful archetype
catalog, a versioned PvE seed contract, and an exact isometric tile
geometry/compiler contract.
It did not produce consistently natural landscapes because its major
systems do not share one coherent landscape model:

- elevation, categorical terrain, paths, blocking props, and floor variants are
  generated largely independently;
- several intended algorithm-cooperation paths are configured but never
  dispatched;
- rolling elevation changes the noise seed for every tile instead of sampling
  one field;
- hydrology is categorical placement rather than drainage over elevation;
- path repair carves hard-edged material through the result without reconciling
  elevation or visual transitions;
- blocking obstacles are not part of the shared movement API even though the
  validator treats them as blocking;
- validation can return an invalid map, after which spawn clearing mutates it
  again, and generation still succeeds; and
- the renderer has elevation-connection and slope-asset support available, but
  the production map contract does not carry or draw it;
- the client hydration/patch path handles only the existing four map layers,
  while WebSocket state updates resend the full mutable battle state; and
- runtime asset fallbacks can conceal incomplete recipe, material, slope, and
  transition coverage.

The implemented change is a versioned `BattleMapV2` pipeline. It builds
continuous, correlated landscape fields first; derives elevation, drainage,
regions, routes, ecology, and semantic terrain from those fields; validates the
same traversal contract used by the server and client; derives transition and
decoration layers; then freezes and persists the complete result. A size-aware
recipe preflight, strict asset-coverage matrix, and immutable-map transport
protocol backed by a single revisioned battle-state repository are required
parts of that architecture. Existing version-1 battle maps and their
deterministic digest must remain unchanged.

This is not primarily a request for more random detail. Naturalness will improve
by giving features shared causes: water follows height, vegetation follows
moisture and disturbance, roads respond to slope and crossings, banks follow
water boundaries, and props inhabit regions rather than independent tiles.

## Goals

The implementation should produce maps that are:

1. **Correct:** server movement, client previews, AI, spawning, validation, and
   generation agree about traversal.
2. **Deterministic and versioned:** identical version-2 inputs produce identical
   serialized outputs, while version-1 outputs remain stable.
3. **Organic at multiple scales:** maps contain coherent landforms, connected
   terrain regions, plausible drainage, curved routes, ecologically clustered
   props, and correlated surface variation.
4. **Tactically readable:** both sides have valid formations, multiple usable
   approaches where the recipe requires them, controlled choke points, and no
   hidden visual/collision disagreement.
5. **Isometrically legible:** elevation changes, cliffs, ramps, shores, paths,
   and props use the existing exact 2:1 projection and shared painter order.
6. **Measurable:** correctness has hard automated gates; artifact metrics and a
   deterministic visual corpus make aesthetic regressions reviewable.
7. **Incrementally releasable:** correctness fixes can land before the full
   landscape rewrite, and version 2 can be compared with version 1 before it
   becomes the default.

## Non-goals

- Replacing the deterministic tile compiler with generative-image output.
- Making purely decorative props affect movement, cover, line of sight, or AI.
- Forcing natural geometry onto arenas, castles, crypts, and other deliberately
  constructed spaces. Those recipes should combine structured topology with a
  natural substrate, damage, overgrowth, or weathering.
- Preserving the exact terrain produced by an existing seed under generation
  version 2. Compatibility is provided by retaining version 1.
- Treating a single numeric “organic score” as a substitute for visual review.
- Adding diagonal combat movement. Hydrology and visual masks may inspect eight
  neighbors, but authoritative movement remains governed by the current
  movement rules unless separately redesigned.
- Reintroducing decorative cover as gameplay state. The current roadmap removed
  that coupling; decoration must remain nonblocking.

## Historical Baseline Contracts (Validated at Audit Time)

These contracts constrained the design and were preserved deliberately. Source
locations in this table refer to the recorded review baseline, not the
post-implementation worktree:

| Contract | Current evidence | Required treatment |
|---|---|---|
| Public size | `generateTerrain()` accepts integer dimensions at least 10; arenas require at least 11x16 (`shared/mapGeneration.js:69-97`). | Keep explicit validation and add corpus coverage for compact and non-square maps. Remove algorithm-local 32x32 assumptions. |
| PvE determinism | `generateEncounterTerrain()` derives a seed from `localSeed`, `nodeType`, and `terrainGenerationVersion`; production currently uses version 1 (`api/src/services/battle/encounterService.js:140-158`). | Preserve the version-1 digest. Introduce version 2 explicitly rather than changing version-1 output in place. |
| Battle persistence | PvE state is assembled with dimensions, seed, version, terrain, elevation, elevation format, obstacles, and variants (`api/src/routes/battle.js:322-370`) and inserted with its seed/dimension mirrors (`api/src/routes/battle.js:468-472`). Multiple later call sites update `battle_state` directly; completion paths also update `status`, `winner_id`, `rewards`, or `ended_at` without a shared revision. | Add new version-2 layers, a persisted state revision, and one repository/CAS boundary for the complete authoritative battle envelope. Use persisted state on rejoin and never regenerate a live battle implicitly. |
| Terrain projection | The renderer uses a 2:1 diamond and owns projection, elevation offset, visible wall faces, depth ordering, and hit testing. | Do not bake projection, shadows, or incompatible edges into generation data or assets. |
| Tile assets | `iso64-retina-v3` uses 128x128 floor/slope sources drawn into 64x64 logical boxes with a 64x32 visible diamond. Variant edges must agree. | Transition/slope assets must be added through the manifest/compiler and pass `npm run tiles:check`. |
| Elevation format | Public generated elevation is normalized and discretized by shared terrain helpers; current consumers recognize only `auto`, `discrete`, and `normalized` (`shared/terrain.js:89-115`). | Version 2 uses the existing `normalized` label unless shared parsing is deliberately extended. Do not let integer levels be misread as normalized values. |
| Spawn safety | Player and enemy formations require obstacle-free, traversable tiles; arena formations have additional protected rectangles. | Replace duplicated hard-coded widths with one shared spawn-layout contract. Preserve guaranteed capacity. |

## Historical V1 Production Process (Audit Baseline)

```text
world node or match context
  -> seed/version selection
  -> archetype selection
  -> base terrain + empty obstacles + independent tile variants
  -> optional profile elevation
  -> configured algorithms mutate categorical terrain
  -> independent capped obstacle pass
       (blocking props also rewrite terrain)
  -> special bridge elevation normalization
  -> clear broad spawn strips
  -> ConstraintValidator validate-and-repair
  -> fallback elevation when no profile supplied
  -> clear spawn strips again
  -> optional spawn placement
  -> return/persist layers
  -> BattleGrid projects and draws floors, exposed vertical faces, props, units
```

The principal code path is:

- `shared/mapGeneration.js:370-533` for orchestration;
- `shared/mapgen/AlgorithmPipeline.js:777-1020` for archetype execution;
- `shared/mapgen/ConstraintValidator.js:83-216` for validation/repair;
- `api/src/services/battle/encounterService.js:140-163` for the PvE seed contract;
- `api/src/routes/battle.js:322-370,468-472` for authoritative PvE assembly and
  persistence; and
- `frontend/src/battle/BattleGrid.js:722-815,923-990` for painter ordering and
  terrain/elevation rendering.

Other battle modes do not use the same complete versioned contract:

- Coliseum generation calls `generateTerrain()` directly with a random match
  seed in `api/src/services/coliseum/matchLifecycle.js`.
- Guildmaster battles call `generateTerrain()` directly with a time-derived
  seed in `api/src/services/guildmasterBattleService.js`.
- `BattleScene` can create a local fallback map before applying persisted
  server state (`frontend/src/scenes/BattleScene.js:189-201`). That fallback
  must remain presentation-only and must never run for a version-2 map.

## Historical Components Retained

- `PRNGStreams` defines isolated structure, terrain, detail, variants, spawns,
  obstacles, elevation, cover, and repair streams.
- Archetypes express useful intent for open fields, forest clearings, plains,
  caves, tunnels, crystal caverns, dungeons, crypts, arenas, bridges, mountain
  passes, ruins, swamps, and volcanoes.
- `LayerContext` is the right place to exchange typed intermediate features.
- `ElevationMapper` already contains tested concepts for coherent base
  elevation, connections, slopes, and reachability. It is a useful source to
  refactor, though not a drop-in production replacement.
- Blocking obstacle catalogs and isometric obstacle rendering already exist.
- The shared terrain module centralizes movement costs and normalized elevation
  conversion.
- Focused tests already cover basic determinism, dimensions, spawn clearing,
  terrain/asset validity, 2D/3D spawn connectivity, elevation drawing, and the
  version-1 encounter digest.
- The tile compiler provides a strong geometry, alpha, edge, and identity
  contract for any new slope, bank, shore, and transition assets.

## Historical Audit Findings and Required Resolutions

Every finding in this section was rechecked against the recorded baseline. Its
resolution is implemented by the workstreams in
[Current Implementation Disposition](#current-implementation-disposition);
the tables remain a traceable problem statement rather than a description of
the current V2 path.

### Confirmed Correctness Defects

| Priority | Finding | Evidence | Resolution |
|---|---|---|---|
| Critical | Blocking obstacles are absent from the shared pathfinding contract. | Both the 2D and 3D APIs omit the obstacle layer (`shared/pathfinding.js:31-176,498-600,620-715,779-850`). Generated battle states normally include elevation, so the server selects the 3D APIs (`api/src/services/battle/movementService.js:91-106,326-342`); strategic AI still imports legacy 2D `findPath()` (`api/src/services/ai/strategicPathfinding.js:8-34`). The client also passes no elevation connections, and `BattleGrid.isWalkable()` checks terrain only. Both 2D and 3D contract fixtures return a `passable:false` rock on grass at cost 1. | Introduce one object-based traversal view consumed by generation, validator, server, client, AI, landing rules, and spawn placement. It must combine terrain, obstacles, elevation, connections, and units without duplicating collision state. |
| Critical | Validation is diagnostic, not an acceptance gate. | `generateWithArchetypes()` uses the returned metrics but never checks `validationResult.valid` (`shared/mapGeneration.js:444-453,514-524`). A fresh final validation of seeds 0-99 across all 16 configured node types found invalid output for 1,598 of 1,600 maps. | Separate hard correctness from soft quality, repair deterministically, retry candidates, and fail closed when no hard-valid map is available. Persist the final result and violations in diagnostics. |
| High | The final map is mutated after validation. | Spawn clearing is run before validation and again afterward (`shared/mapGeneration.js:441,465`). Profile elevation is created before repairs; fallback elevation is created after repairs. | Complete every authoritative mutation, including spawn integration and elevation reconciliation, before a final read-only validation and freeze. |
| High | Rolling elevation does not sample one coherent seeded field. | `_noiseAt()` draws a new `seedOffset` on every tile call (`shared/mapgen/AlgorithmPipeline.js:553-577`), so neighboring cells interpolate different hash fields. The declared elevation stream is not used; the terrain stream is used instead (`shared/mapgen/AlgorithmPipeline.js:810`). | Construct each field/noise instance once per map from the elevation stream and sample it by coordinate. Refactor the useful parts of `ElevationMapper` into the active pipeline. |
| High | Configured algorithm cooperation is inert. | Archetypes declare `outputSeedRegions` and `seedFromPrevious` (`shared/mapgen/archetypes/archetypeDefinitions.js:188-195`), and algorithms implement enhanced seed-region methods, but `runArchetype()` always invokes `instance.apply()` (`shared/mapgen/AlgorithmPipeline.js:884,934`). | Define one stage interface and make the dispatcher explicitly publish/consume named context outputs. Add contract tests for every configured stage capability. |
| High | Algorithm results and failures do not control generation. | Return values from room/path algorithms are discarded, required-stage exceptions are caught, recorded, and generation continues (`shared/mapgen/AlgorithmPipeline.js:858-946`). Context room/path counts can therefore remain zero without rejecting the map. | Required-stage errors and missing declared outputs invalidate the candidate. Optional-stage failure may be recorded only when the recipe explicitly permits omission. |
| High | Validator metrics do not measure their names reliably. | “Approach paths” count vertical runs through the center column; “minimum passage width” scans vertical runs, and the repair switch has no cases for `walkableTooHigh` or `insufficientPaths` (`shared/mapgen/ConstraintValidator.js:459-545`). Low-severity violations still make `valid` false but are never repaired. | Replace them with traversal-graph metrics: vertex-capacitated route diversity and clearance/distance-to-blocker along required routes. Split hard validity from recipe quality scoring. |
| Medium | Some algorithms embed 32x32 formation assumptions. | `ClusterPlacer` hard-codes left spawn end 5 and right spawn start 27 (`shared/mapgen/algorithms/ClusterPlacer.js:96-99`); validator spawn probes and repair corridors use separate midpoint/margin assumptions. | Pass a shared protected-zone mask and anchors through context. No algorithm may infer spawn geometry from magic columns. |
| Medium | Versioning is inconsistent across battle modes. | PvE has a persisted versioned contract; coliseum and guildmaster entry points generate directly, and frontend fallback generation can run locally. | Route every authoritative mode through a common versioned map service. Generate and validate the final map before atomically inserting its seed, version, mirrors, and initial state; expose no partial battle. Keep client generation non-authoritative. |

### Confirmed Quality and Architecture Gaps

| Priority | Finding | Effect on appearance or maintainability | Resolution |
|---|---|---|---|
| High | Elevation and categorical terrain are generated in different passes and only weakly reconciled. | Cliffs, water, repairs, and paths can disagree with slope and landform shape. Abrupt normalized levels can appear as arbitrary steps. | Generate continuous height first, derive semantic levels deliberately, and let terrain, drainage, route cost, banks, and connections consume it. Reconcile all repairs through a typed edit operation. |
| High | Water/lava placement is not hydrology. | Isolated pools and threshold blobs have no upstream/downstream reason, shore structure, or controlled crossings. | Condition the height field, calculate flow direction/accumulation, choose source/outlet/basin features by recipe, and derive banks/wetness/crossings from feature identity. |
| High | Paths do not respond to landscape costs. | Default endpoints are left-to-right; direct paths are orthogonal, Bezier paths are sampled and rounded, and all styles overwrite terrain with a fixed width. There are no shoulders, erosion, elevation limits, or ecology clearing. | Route anchors with deterministic least-cost A* over slope, water, roughness, protected features, and previous heading. Expand a centerline through a width field and derive shoulders/transitions. |
| High | Blocking props are sampled independently after terrain. | Candidates are independent, capped at roughly 4-6.5%, and ignore feature regions, spacing, elevation, water edges, and routes. Tree terrain and tree obstacle rules can describe different groves. | Use suitability fields, feature-owned clusters, and deterministic minimum-distance sampling. Place blocking features before final traversal validation. |
| Medium | Decorative and blocking concerns share the obstacle layer. | Visual density is constrained by collision density, and adding richer ground detail risks changing movement. | Add a persisted deterministic `decorations` layer whose schema cannot express blocking. Keep gameplay obstacles explicit. |
| Medium | Floor variants are independent per tile. | Four uniform variants produce salt-and-pepper texture rather than patches, material age, wetness, wear, or feature-aligned variation. | Select variants from stable coordinate hashes plus low-frequency fields, feature IDs, and route/shore masks. Keep boundary-compatible variants. |
| Medium | Style profiles are mostly aspirational. | Profiles define density, path, room, cluster, preferred-shape, and algorithm-weight parameters, but the active pipeline primarily reads obstacle count. | Compile a recipe/profile into validated stage parameters once and record the resolved values in diagnostics. Remove unused profile APIs or wire them completely. |
| Medium | Two configuration systems can drift. | Archetypes drive production stage sequences; `nodeTypeAlgorithms.js` still defines algorithm pools and helpers that `runArchetype()` does not consume. Unknown node config falls back to forest while archetype selection uses a weighted default set (`shared/mapgen/nodeTypeAlgorithms.js:836-869`; `shared/mapgen/archetypes/ArchetypeSelector.js:193-201`). | Make one recipe registry authoritative and reject or explicitly map unknown V2 recipes. Retain node configuration only for data it actually owns, such as biome obstacle catalogs, until migrated. |
| Medium | Renderer support stops short of the generated elevation model. | `AssetLoader.getSlopeSprite()` exists, but `BattleGrid` draws floor tops and exposed vertical faces without slope/stair selection. Elevation connections are neither persisted nor supplied by the client pathfinder. | Persist connections and transition masks, render slope/bank/cliff overlays in the shared depth queue, and supply the same connections to client/server traversal. |
| High | Recipe coverage exceeds the explicit tile-asset palette. | The tile manifest declares five biomes—forest, cave, mountain, bridge, and castle—while generation exposes 16 node types (`ai-image-metadata/tiles/manifest.json:10-13,67-88`). Runtime slope/top-tile loaders fall back to another level or base/forest assets (`frontend/src/core/AssetLoader.js:1035-1080,1089-1123`), which can make missing exact coverage look successful. | Compile every V2 recipe to an explicit render palette and require an exact recipe × material × transition/slope capability matrix. Intentional reuse of the five palettes is valid; undeclared runtime fallback is not. |
| High | Obstacles and proposed decorations do not share the tile asset contract. | Obstacles use `shared/obstacles.js` plus separate metadata and arbitrary source sprites scaled into category-based logical bounds (`frontend/src/battle/BattleGrid.js:663-671`). No closed exact-key decoration asset pipeline exists yet. | Keep tile-bound assets under the 2:1 compiler contract, but define separate closed obstacle/decoration catalogs with metadata-owned anchors, logical/occlusion bounds, alpha/scaling rules, exact runtime validation, and no V2 fallback. |
| Low | Header comments and phase names describe removed or unused systems. | The main module still advertises tactical cover and style integration beyond what production executes. | Update documentation as each stage is replaced; delete dead helpers once version 1 is isolated. |

### Confirmed Operational Integration Gaps

| Priority | Finding | Evidence | Resolution |
|---|---|---|---|
| High | Independent battle-envelope SQL writers cannot safely support immutable maps or ordered live state. | Turn actions, coliseum timers, reconnect/debug flows, and battle routes directly update `battle_state` (`api/src/services/battleTurnManager.js:553-555`; `api/src/services/coliseum/turnTimer.js:145-160`; `api/src/services/debugService.js:69-74`; `api/src/routes/battle.js:509,616,834-914,1108`). Coliseum completion separately updates `status`/`winner_id` (`api/src/services/coliseum/matchLifecycle.js:1066-1070`), while PvE reward distribution separately updates `rewards`/`ended_at` inside its reward transaction (`api/src/services/battleRewardService.js:84-100`). There is no persisted compare-and-swap revision across these changes. | Add one `BattleStateRepository`, a `state_revision` column, expected-revision commands that preserve immutable map hashes and own every authoritative/client-visible `battles` mutation, migration of all production writers, a static boundary check, and lifecycle/action/reward race tests. |
| High | Current state transport would repeatedly carry a much larger immutable map. | `broadcastStateUpdate()` sends the full battle state on each update (`api/src/services/battleWebsocket.js:82-99`). A complete V2 map adds connections, transitions, decorations, feature records, and diagnostics. | Define an initial/rejoin full-map snapshot and subsequent versioned, revisioned mutable-state deltas that carry a verified map reference/hash instead of resending unchanged map layers. Specify gap/duplicate/out-of-order recovery, compressed and uncompressed byte budgets, observability, and reconnect/cache-miss behavior before rollout. |
| High | Client hydration and patches cannot represent the proposed V2 contract. | `BattleScene` locally generates all layers and replaces only terrain, elevation, variants, and obstacles (`frontend/src/scenes/BattleScene.js:189-201`); `applyBattleMapPatch()` handles the same four fields (`frontend/src/battle/mergeBattleState.js:51-68`). | Extend initial hydration, state patches, rejoin, and grid APIs for connections, transitions, decorations, feature identity, V2 metadata, and hashes. A V2 map may never fall back to local generation or silently ignore a layer. |
| High | Capability negotiation is not an existing protocol. | The current battle response returns state without a battle-map capability exchange (`api/src/routes/battle.js:637-650`), and WebSocket updates assume the existing state shape. | Define capability fields and incompatibility behavior for create/current/rejoin and the WebSocket join/update flow. Unsupported clients remain on V1 only when creating a new battle; an existing V2 battle must return an explicit upgrade-required response. |
| Medium | Database mirror/index assumptions and creation failure semantics are unspecified. | `map_seed`, `map_width`, and `map_height` are columns, but the initial schema indexes only status/player columns (`api/src/migrations/001_initial_schema.sql:177-197`). Map generation currently precedes the final battle `INSERT`. | Treat the columns as atomic mirrors, not as currently indexed fields. Add an index only for a demonstrated query. Specify transaction, rollback, retry/idempotency, mixed-version migration, and corrupt-state behavior for every battle mode. |

## Historical Reproduced Baseline

### Focused regression suites

The following command passed **120 tests, 0 failures** on the current review
baseline:

```bash
NODE_ENV=test node --test --test-concurrency=1 \
  shared/mapgen/mapGeneration.test.js \
  shared/pathfinding.test.js \
  api/src/tests/unit/battle/encounterService.unit.test.js \
  api/src/tests/integration/mapGeneration.integration.test.js \
  frontend/src/battle/__tests__/BattleGrid.test.js
```

That result confirms the existing tested contract. It does not contradict the
findings above: current pathfinding tests use terrain called “obstacles,” not the
separate obstacle layer, and integration tests primarily prove that at least one
spawn-to-spawn route exists.

Two supplemental current-baseline runs passed **113 shared generator,
validator, PRNG, and pathfinding tests** and **66 world-seed/migration tests**,
both with zero failures. `npm run build` also passed for the frontend and admin
applications. Vite reported existing chunk-splitting and greater-than-500-kB
minified-chunk warnings; those are not map-generation failures, but the rollout
must continue to measure client bundle and map-wire cost rather than assuming
that added V2 code and layers are free.

### Blocking-obstacle contract reproduction

For a 3x3 grass grid with `{ passable: false }` at `(1,1)`, starting from
`(0,1)` with movement range 1, both current APIs ignore the separate obstacle
grid:

```json
{
  "reachable2D": { "x": 1, "y": 1, "cost": 1 },
  "pathCost2D": 1,
  "reachable3D": { "x": 1, "y": 1, "z": 0, "cost": 1 },
  "pathCost3D": 1
}
```

This is a contract defect and a future/external-state regression fixture, not a
claim that ordinary current generated maps let units walk through their rocks.
The legacy pipeline currently mirrors generated blocking props into impassable
terrain (`shared/mapgen/AlgorithmPipeline.js:421`), so its emitted maps usually
remain blocked through incidental duplication. Independently loaded, migrated,
edited, or future obstacle state can violate that coupling, and the validator
already treats the obstacle object itself as authoritative.

### Final-validation corpus

On the generator audit baseline, the audit generated 32x32 maps with
`{ includeMetadata: true }`, then constructed a fresh `ConstraintValidator` from
each emitted recipe constraint and validated the final public terrain/obstacle
arrays. Seeds were `0..99`. A scoped diff confirmed that the generator,
validator, traversal, persistence, and renderer inputs exercised by this corpus
are unchanged at the current review baseline; BMG-00 still requires the corpus
to become a reproducible current-checkout CI command.

| Node type | Invalid maps |
|---|---:|
| forest | 100/100 |
| cave | 100/100 |
| mountain | 100/100 |
| bridge | 100/100 |
| castle | 100/100 |
| dungeon | 100/100 |
| swamp | 100/100 |
| volcano | 98/100 |
| plains | 100/100 |
| arena | 100/100 |
| guild | 100/100 |
| elven_grove | 100/100 |
| dwarven_mine | 100/100 |
| vampiric_crypt | 100/100 |
| orcish_warcamp | 100/100 |
| human_ruins | 100/100 |

The frequent violations were `walkableTooHigh`, `insufficientPaths`, and
`bottleneckTooNarrow`. This does **not** establish that 1,598 maps are
unplayable. It establishes that the current definition of `valid`, its metrics,
its repair coverage, and the generator's decision to ignore it are mutually
inconsistent. Version 2 must distinguish:

- hard correctness failures, which reject a map;
- tactical recipe failures, which trigger repair/retry or reject a map; and
- soft aesthetic targets, which score candidates and surface diagnostics.

Generation time in this diagnostic run was approximately 3.56 ms p50, 4.17 ms
p95, 4.86 ms p99, with a 19.14 ms maximum on the audit machine using Node
22.22.2. These numbers are a local baseline, not a portable service-level
objective.

## Target `BattleMapV2` Contract

```js
{
  battleMapSchemaVersion: 2,
  terrainGenerationVersion: 2,
  terrainSeed,
  mapWidth,
  mapHeight,
  nodeType,
  biome,
  archetype,
  elevationFormat: 'normalized',

  // Authoritative gameplay/render inputs
  terrain,                 // semantic material / base movement cost
  elevation,               // always present; normalized public height
  elevationConnections,   // directional ramp/stair/ledge/cliff metadata
  obstacles,               // explicit gameplay props; may be blocking
  spawnLayout,             // protected zones/exits and selected initial slots

  // Nonblocking presentation inputs
  variants,                // feature-correlated floor variant indices
  transitions,             // shore/path/cliff/terrain edge masks and kinds
  decorations,             // schema is incapable of blocking

  // Stable feature identity and reproducibility
  features: {
    regions,
    waterBodies,
    routes,
    clearings,
    structures
  },
  diagnostics: {
    resolvedRecipe,
    attempt,
    streamVersion,
    hashVersion,
    algorithms,
    hardValidation,
    tacticalValidation,
    qualityMetrics,
    hashes
  }
}
```

The object shown above is the persisted and initial/rejoin
`BattleMapV2Final` schema. Live mutable-state deltas reference this immutable
map by version and verified hash; they do not carry a partial map under the same
schema. Define two explicit validation schemas rather than treating hashing as
an in-place exception:

- `BattleMapV2Candidate` contains every field shown above except
  `diagnostics.hashes`; `diagnostics.hashVersion` is already required;
- `BattleMapV2Final` is a candidate plus exactly the three required,
  correctly formatted hashes.

The pre-hash gate accepts only a candidate. Hash attachment is the sole mutation
permitted after that gate. A second gate validates the final schema and
independently recomputes all three projections before the value is frozen and
persisted. No API, adapter, cache, or database path may accept
`BattleMapV2Candidate`.

That freeze is recursive, not merely a freeze of the top-level envelope.
BMG-05 must publish closed nested schemas, record identities/reference rules,
and required enums for terrain/material cells, normalized elevation,
elevation connections, gameplay obstacles, spawn/protected-zone records,
variants, transitions, nonblocking decorations, every feature collection
(regions, water bodies, routes, clearings, and structures), diagnostics,
resolved recipes, algorithms, validation results, quality metrics, and hashes.
Catalog and asset keys remain schema-valid strings resolved against separately
versioned capability catalogs, but their field location, type, nullability, and
reference semantics are frozen. An empty collection is valid only where the
closed schema declares it optional in content; it is not a placeholder for an
unspecified future record shape.

Every later BMG task must populate and test those already-frozen records rather
than extending the V2 schema in place. A subsequent change to a serialized
path, record shape, type, requiredness, enum, identity/reference rule, or hash
projection requires a new `battleMapSchemaVersion`, updated capability
negotiation and canonical/hash vectors, plus explicit migration or
coexistence behavior. Generator algorithms and catalog contents may evolve
under their own declared versions without changing the map schema, provided
their output still validates against the frozen V2 contract.

Existing-compatible names deliberately match the current battle-state fields;
`battleMapSchemaVersion` is the new serialized-map discriminator and is distinct
from generator behavior, canonical-hash version, and mutable-delta protocol
version. During the initial rollout, `BattleMapV2` is an internal value object
mapped by one `BattleMapAdapter` to and from the existing flattened
`battle_state`/wire representation; it is not a second independently editable
nested copy. The database columns `map_seed`, `map_width`, and `map_height`
remain envelope mirrors; they are not currently indexed as a group or by
seed/dimension. Writes must update the JSON state and mirror columns atomically,
and reads must validate equality rather than guessing which copy is newer. Add
an index only when a measured query pattern and query plan justify it. The
existing top-level response field `mapSeed` may remain as a compatibility alias
derived from `terrainSeed`/`map_seed`; it is never another stored or hashed map
field. A missing map schema/generation version is interpreted as version 1 only
by the version-1 load adapter. Only that adapter may synthesize absent new
layers; an authoritative version-2 map must contain both version fields and
every required layer, including a flat elevation grid when its recipe has no
relief. V2 uses the existing `normalized` elevation-format value; a new label is
forbidden unless every shared, server, and client parser is extended and
compatibility-tested.

`collision` should **not** be a second persisted grid. A canonical
`TraversalView` derives traversal from terrain, obstacles, elevation,
connections, units, and movement policy. This avoids another representation
that can drift.

Base terrain and props also have separate ownership. A terrain material may be
intrinsically impassable, but placing a blocking tree, rock, or pillar must not
rewrite its substrate merely to duplicate collision. Removing a prop reveals
the original substrate; traversal combines both layers.

Feature records should be compact, and the persisted and initial version-2 wire
representations must retain them with stable feature IDs. Those IDs let
variants, banks, paths, props, and diagnostics refer to the same generated
cause, and they are covered by the authoritative and full hashes. Do not omit
them ad hoc from a client response. If payload measurements later justify a
reduced client representation, define a separately versioned
`BattleMapV2ClientProjection` with its own schema, hash coverage, and
round-trip/omission tests before serving it; that optimization is outside this
plan's initial contract.

After initial hydration, a versioned state-update envelope may omit the
unchanged map only by carrying its `battleMapSchemaVersion`,
`terrainGenerationVersion`, and `fullHash`. It also carries a delta protocol
version plus persisted monotonic `baseStateRevision` and `stateRevision`. The
client applies a delta only when the map reference is verified and its current
revision equals `baseStateRevision`; duplicate revisions are idempotently
ignored, while a gap, out-of-order update, or conflicting same revision triggers
a current-state snapshot before further deltas are applied. The authoritative
service must advance the revision atomically with each persisted mutable-state
change, through serialized battle commands or compare-and-swap.

The first wire protocol is a closed `BattleMutableStateUpdateV1`, not an
arbitrary JSON Patch. It contains exactly `{ protocolVersion: 1, battleId,
battleMapSchemaVersion, terrainGenerationVersion, fullHash, baseStateRevision,
stateRevision, updateId, mutableState }`; `updateId` is the stable
`battleId:stateRevision` identity. BMG-05 must inventory current battle fields
and publish a closed `BattleMutableStateV1` schema that contains every mutable
unit, turn, status, winner, reward, end-time, boss, disconnection, and mode
field—regardless of whether the database stores it in JSON or a dedicated
column—but cannot express any map layer, dimension, seed, generation metadata,
feature, diagnostic, or hash.
Version 1 sends that complete bounded mutable projection on each committed
change. A future sparse-operation protocol requires a new negotiated version
and path allowlist; it may not reuse this schema.

All production creation and mutation of a `battles` row, plus every read used
to construct authoritative live state, must pass through one
`BattleStateRepository`; despite its narrow name, it owns the complete battle
envelope. That envelope includes the immutable map and identity mirrors, the
JSON mutable projection, lifecycle fields such as `status`, `winner_id`,
`rewards`, and `ended_at`, and the revision. Explicitly allowlisted read-only
analytics/leaderboard projections may query the row without becoming a live
state authority. A delta protocol layered over today's independent SQL writers
is not safe.

Store the current revision in a dedicated nonnegative `state_revision` column
initialized to zero. Every command that changes an authoritative or
client-visible battle field advances that revision exactly once, even when it
does not change `battle_state`. A mutation uses a transaction or
`UPDATE ... WHERE id = ? AND state_revision = ?`, preserves the immutable
map/hash fields, checks command-specific lifecycle preconditions, and returns
the committed successor revision. A stale action or timer therefore conflicts
after battle completion instead of overwriting the terminal state.

Battle-completion commands must update the terminal battle envelope and their
current PostgreSQL side effects atomically under the same expected revision and
idempotency key. For PvE rewards, that includes the related user gold,
character experience, inventory/drop, and node-clearance writes already in the
reward transaction. Coliseum completion likewise must not commit ratings,
match history, character availability, or a winner independently of the
terminal revision; use one database transaction or a durable idempotent outbox
for any effect that cannot participate. Publish terminal WebSocket events only
after that commit. Direct production `INSERT`, `UPDATE`, or `DELETE` access to
`battles` outside this repository and approved migrations is forbidden and
enforced by a static boundary test; any exceptional read-only projection is
named in a minimal allowlist.

Publish a state update only after its transaction commits, using the existing
ACK/retry channel upgraded to carry the revisioned envelope. When retries are
exhausted, load a fresh repository snapshot rather than broadcasting a captured
in-memory object. Join/rejoin and a lightweight revision heartbeat let a client
detect a committed update lost before broadcast, including a process crash, and
request the current snapshot. Push delivery is therefore at-least-once and
idempotent; persisted repository state remains authoritative.

The client must already hold and verify that exact final map; otherwise it
requests/receives the complete snapshot before applying mutable state. Rejoin
returns the complete final map unless the request explicitly presents a matching
cached-map capability and hash, and it always returns the current mutable state
plus revision. Map replacement, hash mismatch, unknown delta schema, revision
gap, or a missing cached map fails closed and must never invoke local generation.

Persist only compact, bounded diagnostics needed to reproduce and audit the
selected map. Timing, environment, rejected-candidate detail, and full working
fields belong in an optional retention-limited audit sidecar keyed by map hashes,
with explicit size, redaction, and access policy. The persisted-map,
initial/rejoin payload, and mutable-delta protocols each receive measured
compressed and uncompressed byte limits before rollout.

### Canonical serialization and hashes

Hashing applies to the `BattleMapV2` value object, not the enclosing mutable
battle state. Record `hashVersion: "sha256-cjson-v1"` and define canonical JSON
as the RFC 8785 JSON Canonicalization Scheme byte serialization: UTF-8 JSON,
UTF-16-code-unit object-key order, semantic array order, finite numbers only,
ECMAScript shortest round-trip number serialization, and `-0` serialized as
`0`. Reject `undefined`, non-finite numbers, lone Unicode surrogates, duplicate
keys at parse boundaries, and unsupported values rather than silently dropping
them.

Generation must quantize or use integer/fixed-point representations at every
threshold, sort key, tie-break, and candidate-ranking boundary. Record the
rounding rule and scale in the recipe/hash version so supported generator
runtimes cannot choose different discrete output, and Node/browser
canonicalizers cannot disagree about a finalized map, because of insignificant
floating-point drift. Publish canonical serialization/hash test vectors and run
them in Node and supported browsers; hash verification failure is a hard
protocol error.

Use three closed, versioned projection schemas; `additionalProperties` is false
at every level and adapters resolve compatibility aliases before projection:

- `BattleMapAuthoritativeProjectionV1` is
  `{ projectionSchema, battleMapSchemaVersion, terrainGenerationVersion,
  terrainSeed, mapWidth, mapHeight, nodeType, biome, archetype, generation,
  terrain, elevation, elevationConnections, obstacles, spawnLayout, features }`.
  `projectionSchema` is the fixed string
  `battle-map-authoritative-v2/projection-v1`; `generation` contains exactly
  `diagnostics.resolvedRecipe`, `attempt`, `streamVersion`, and `algorithms`.
  It contains no mutable in-battle unit state.
- `BattleMapVisualProjectionV1` is
  `{ projectionSchema, battleMapSchemaVersion, mapWidth, mapHeight, variants,
  transitions, decorations }`, with fixed `projectionSchema`
  `battle-map-visual-v2/projection-v1`.
- `BattleMapFullProjectionV1` is
  `{ projectionSchema, map }`, with fixed `projectionSchema`
  `battle-map-full-v2/projection-v1` and `map` exactly equal to the closed
  `BattleMapV2Candidate`. Timing/environment/audit-sidecar fields and
  compatibility aliases are not legal candidate fields, and
  `diagnostics.hashes` is absent by candidate definition, so the exclusions are
  exhaustive rather than implementation-dependent.

For each hash, feed SHA-256 the ASCII domain prefix followed immediately by one
NUL byte and the canonical UTF-8 projection bytes. The prefixes are
`battle-map-authoritative-v2`, `battle-map-visual-v2`, and
`battle-map-full-v2`. Store every digest as `sha256:` followed by exactly 64
lowercase hexadecimal characters; base64, uppercase hex, bare hex, and
algorithm aliases are invalid. Publish at least one complete candidate fixture,
the three materialized projection objects, their exact canonical UTF-8 bytes,
and all three expected digest strings. Run the same vectors in server Node and
every supported browser. JSONB may reorder object keys; re-canonicalizing a
loaded value must reproduce the same hashes.

## Target Generation Flow

```text
normalized versioned request
  -> version dispatcher (frozen legacy branch for version 1)
  -> authoritative biome recipe + resolved style parameters
  -> size/mode feasibility profile + exact render-palette preflight
  -> named deterministic streams and coordinate-hash salt
  -> shared spawn/structure anchors and protected-distance mask
  -> coherent FieldSet
       height, moisture, roughness, detail, disturbance, optional warp/ridges
  -> macro regions / cave solids / constructed structure reservations
  -> height conditioning + drainage/flow features
  -> least-cost routes, clearings, rooms, crossings, and route width fields
  -> semantic terrain classification with connected-region cleanup
  -> elevation quantization and explicit connections
  -> actual spawn selection/integration with a feathered protected mask
  -> blocking ecology/structures using suitability + minimum spacing
  -> candidate-level hard/tactical validation and typed repair
  -> deterministic retry/selection if required
  -> transitions, correlated variants, and nonblocking decorations
  -> candidate schema + asset + authoritative traversal validation
  -> canonical projections + hash attachment
  -> final schema + independent hash verification
  -> deep-freeze and persist
  -> renderer consumes the persisted result
```

No field may mutate after the candidate gate except attachment of the hash
record, and no field may mutate after final verification. Visual-only layers
are generated before the candidate schema/asset check and are included in the
visual and full output hashes.

## Required Invariants

1. Identical normalized version-2 inputs produce byte-identical canonical
   persisted projections and hashes. Timing/environment telemetry is a separate
   audit sidecar, not mutable map data.
2. The version-1 encounter seed and representative full-layer map digests remain
   unchanged for every supported node/archetype, seed, and size fixture.
3. A draw-count change in `decorations` cannot change fields, topology,
   traversal, spawns, or blocking props.
4. Every required stage either publishes its declared outputs or rejects that
   candidate. Required-stage exceptions never yield a successful map.
5. Every coordinate-bearing layer has exactly `mapHeight` rows and `mapWidth`
   columns; every value is finite and schema-valid.
6. All generated and actual unit spawn positions are in bounds, unoccupied,
   nonblocking, and reachable under the authoritative traversal policy.
7. Required side-to-side routes exist in the final terrain, obstacle, elevation,
   and connection state—not merely in an intermediate terrain grid.
8. Blocking props affect server movement, client reachability/path preview, AI,
   spawn placement, and validation identically.
9. Decorations never affect any traversal or tactical hash.
10. Every ramp/stair connection is reciprocal and agrees with adjacent
    elevation. Every unconnected height transition follows the cliff/ledge
    policy.
11. Non-lake drainage features have a downstream chain to a declared outlet;
    declared lakes/basins have explicit identities rather than accidental pits.
12. Routes respect recipe maximum slope or carry an explicit bridge, stair, or
    ramp connection.
13. Terrain repairs are typed edits that update dependent elevation,
    connections, obstacles, transitions, and feature records.
14. Natural-biome region cleanup does not leave accidental one-tile islands
    above the recipe threshold.
15. Every referenced render asset resolves exactly through the recipe's declared
    render palette without an undeclared fallback. Floors, exposed faces,
    slopes, and tile-bound transition overlays pass the isometric tile/compiler
    contract; obstacles and free-standing decorations pass their separate
    closed-catalog contracts for key, category, anchor, logical bounds, alpha,
    and runtime scaling.
16. Rejoin/reload uses the persisted map and never silently regenerates it with
    a different version.
17. Every recipe declares supported dimension/mode/capacity profiles, minimum
    feature footprints, feature budgets, and a deterministic degradation order.
    An unsupported request fails preflight rather than exhausting candidate
    retries.
18. Every tactically required region is reachable. Recipe metrics bound usable
    area, detour, clearance/choke distribution, dead ends, and—where relevant—
    approach and line-of-sight parity.
19. Hydrology parameters scale with the feasible map profile. Channel width,
    contributing area, basin/outlet count, and alignment metrics cannot create
    accidental full-map or long grid-parallel channels.
20. Overlapping transitions have one deterministic composition/occlusion rule;
    shore + route, route + slope, cliff + wetness, and decoration + prop
    combinations cannot depend on iteration order.
21. Initial/rejoin hydration carries or verifies the complete immutable map;
    every later mutable-state delta references the same version/hash and cannot
    partially replace map layers.
22. Mutable-state snapshots and deltas carry a persisted monotonic revision.
    A delta is applied only to its declared base revision; duplicates are
    idempotent, and gaps, reordering, or conflicts force authoritative resync.
23. One repository owns every production live-battle read and every
    `battles`-row create/mutation, including lifecycle, winner, reward, and
    end-time fields. Each accepted command preserves the immutable map, checks
    its lifecycle precondition and expected revision, and commits one unique
    successor revision; direct mutation SQL outside that boundary fails a
    static architecture check.
24. The V1 live-update schema can replace only the complete mutable projection.
    Updates publish after commit through ACK/retry; lost delivery, retry
    exhaustion, and heartbeat/revision mismatch converge by loading a fresh
    authoritative snapshot, never an in-memory precommit value.
25. Terminal lifecycle/reward commands are idempotent and atomic with their
    current database side effects. A concurrent or retried action, timer,
    completion, or reward command cannot reopen a battle, duplicate an award,
    or commit a terminal state without advancing the shared revision.

## New Generation Strategies

### 1. Correlated landscape fields

Create one `LandscapeFieldSet` per candidate. Each field owns one seeded noise
instance and is sampled by coordinate; it must not consume random values per
tile. Recommended fields:

| Field | Scale | Consumers |
|---|---|---|
| `heightBase` | macro, 1-3 broad features/map | elevation, drainage, ridge/valley identity |
| `heightDetail` | meso | local relief, erosion/talus masks |
| `moisture` | macro + meso | water likelihood, wetlands, vegetation suitability |
| `roughness` | meso | rocks, travel cost, cliff likelihood |
| `disturbance` | feature-derived | paths, clearings, ruins, sparse vegetation |
| `materialDetail` | fine | variants and nonblocking decoration only |
| `warpX/warpY` | low frequency, recipe-limited | bends otherwise axis-aligned thresholds without changing determinism |

Use a small number of octaves with explicit frequencies, amplitudes, and salts
recorded in the resolved recipe. Structured maps may set warp to zero. Quantize
height for gameplay only after drainage and route planning; retain the
continuous working field for slopes, banks, cost, and visual classification.
Quantize all threshold/sort/ranking inputs to recipe-declared precision before
they affect discrete output.

`disturbance` must also have an interpretable source—route wear, clearing,
construction, damage, fire, flooding, or age—not merely another unrelated noise
texture. Recipes can combine those causes, but record them so ecology and
surface variation respond to the same event.

The current `PerlinNoiseAlgorithm` actually wraps simplex/fBm concepts and adds
an independent intensity roll per tile. Refactor/rename it so the field
generator and the categorical classifier are separate responsibilities.

### 2. Region-based terrain classification

Replace independent tile mutation with:

1. continuous suitability values;
2. recipe thresholds with hysteresis;
3. seed regions or feature anchors;
4. connected-component minimum sizes;
5. one or two deterministic morphology passes; and
6. transition-band classification.

For example, forest should not mean “tree on any tile that passed a roll.” It
should mean moist, undisturbed regions own grove IDs; grove interiors can
contain blocking trunks, edges can contain sparse trees/shrubs, and clearings
are explicit disturbance features. Cellular automata remains useful for caves
and edge cleanup when it consumes a meaningful prior mask.

### 3. Height-driven hydrology

For recipes with water:

1. condition accidental sinks using a Priority-Flood implementation;
2. retain deliberately selected basins as named lakes/ponds;
3. compute deterministic flow direction and accumulation;
4. select source count, minimum contributing area, outlet/basin policy, and
   thresholds from the feasible map-size profile;
5. widen the centerline according to accumulation and recipe;
6. derive bank, wetness, mud/reed, and crossing masks from distance to water;
7. reserve valid crossings before route planning; and
8. revalidate downstream continuity after terrain edits.

Swamps should use low relief, multiple shallow accumulation areas, broad wetness
bands, and sparse channels. Mountains should favor incised runoff and narrow
streams. Volcanoes can reuse the directed-flow abstraction for lava only with a
separate material/behavior recipe; they should not inherit water movement or
asset semantics accidentally. Hydrology quality checks should detect long
axis-parallel runs, repeated right-angle stair steps, implausible width jumps,
and features whose scale consumes the usable map.

### 4. Landscape-aware routes

Use A* to route between spawn, room, clearing, structure, and crossing anchors.
The search state should include prior direction when the recipe applies a
curvature penalty. A candidate step cost can combine:

```text
base distance
+ slope penalty
+ water/lava crossing penalty
+ roughness penalty
+ protected-feature penalty
+ heading-change penalty
- preferred clearing/valley/crossing bonus
```

Every resulting edge cost must remain strictly positive after bonuses. Use an
admissible, consistent heuristic for the resolved cost model; if that cannot be
demonstrated for a recipe, use Dijkstra's algorithm. Equal-cost choices require
stable coordinate/direction tie-breaking so heap or iteration order cannot
change the route.

After finding a centerline:

- remove single-tile zigzags without changing connectivity;
- expand it with a distance field and slowly varying width;
- generate shoulders/wear rather than a hard material edge;
- lower or ramp elevation within allowed limits;
- clear only conflicting blocking ecology;
- tag crossings and structural transitions; and
- keep the centerline and feature ID for validation and rendering.

Route validation should measure more than existence: detour ratio against an
unobstructed lower bound, sinuosity and turn density, minimum straight-run
length, clearance/choke distribution, and the accessible required-region graph.
Constructed recipes should additionally budget intentional dead ends; symmetric
competitive recipes should measure approach and line-of-sight parity.

For cave/dungeon recipes, connect room/portal anchors with a graph first. Add
selected loop edges before carving so route diversity is intentional, not
estimated from center-column openings.

### 5. Ecological prop placement

Split placement into:

- **blocking features:** trunks, boulders, pillars, walls, large crystals;
- **nonblocking decorations:** grass tufts, flowers, reeds, pebbles, roots,
  leaf litter, small debris, water plants.

Blocking candidates come from suitability masks and must respect routes,
connections, formation capacity, line-of-travel clearance, water, height, and
other blockers. Use parent grove/outcrop features for natural clustering and a
deterministic Poisson-disk/minimum-distance sampler within each feature to avoid
both grids and accidental piles.

Decoration uses a separate stream, schema, budget, and depth entry. Changing its
density must leave the traversal hash unchanged.

### 6. Organic spawn integration

Replace broad destructive clearing with a shared `SpawnLayoutContract`:

- exact player formation slots;
- enemy candidate/staging regions by AI strategy;
- arena north/south formation slots;
- minimum approach exits; and
- a distance-to-protected-zone field.

Reserve these constraints before blocking topology and props are finalized.
When flattening or material replacement is needed, blend the change over a
recipe-defined distance and reclassify its boundary. The protected core remains
strictly flat and clear; the feather can retain already walkable substrate and
remove only incompatible features. This preserves capacity without drawing
straight full-height biome cuts at both map edges.

### 7. Feature-correlated variants and transitions

Generate variants from stable coordinate hashes combined with material detail,
feature ID, moisture, disturbance, and distance masks. The result should have
small coherent patches, not a scan-order random value at each cell.

Add explicit transition records for at least:

- water shore/bank direction;
- route center/shoulder/edge;
- terrain-material adjacency where an overlay is supported;
- cliff/exposed-face kind;
- slope/stair direction; and
- wetness, talus, snow/ash, or overgrowth bands used by a recipe.

Prefer composable overlays and bitmasks over a full Cartesian product of floor
assets. All overlays must keep detail inside the 64x32 footprint/shared-edge
contract or use renderer-owned face geometry. The transition schema must define
layer precedence, legal combinations, anchors, and whether each overlay belongs
below a prop, on the tile top, on an exposed face, or above a connection. The
renderer and strict asset validator consume the same composition table.

### 8. Feasible recipe profiles and render palettes

Compile each recipe against map dimensions, mode, party/enemy capacity, and the
runtime asset catalog before consuming a candidate seed. The compiled profile
declares:

- required and optional macro features with minimum footprint/clearance;
- per-size counts, widths, and density budgets;
- deterministic omission/degradation order for optional features;
- tactical metrics and supported formation capacities; and
- the exact tile biome, material, slope/connection, transition, obstacle, and
  decoration capabilities that may be emitted.

A compact forest can intentionally use one small grove and no stream; it cannot
silently squeeze three groves, drainage, two routes, formations, and blocker
clearances into 10x10. Recipes may intentionally share one of the five current
tile palettes, but that mapping is explicit and exact-resolution tests disable
loader fallbacks. A request with unsatisfied required features or assets is
reported as unsupported before retry, not “repaired” into a different recipe.

## Biome Recipe Direction

| Recipe family | Macro form | Signature processes | Tactical guardrails |
|---|---|---|---|
| Forest / elven grove | Rolling substrate, 1-3 grove masses, explicit clearings | Moisture-driven groves, ecotones, clustered trunks, leaf/grass decoration | Two or more usable approaches where requested; trunks stay off routes and formations |
| Plains / orcish warcamp | Broad low relief with sparse thickets and worn routes | Low-frequency grass variation, drainage swales, outcrops, camp disturbance | Preserve long sightlines but add bounded flank features |
| Swamp | Low relief, named ponds/channels, broad saturated bands | Flow accumulation, mud/reed bands, hummocks, deadwood clusters | Guaranteed dry or shallow traversable routes; no accidental isolated spawn island |
| Mountain | Ridges/valleys, runoff gullies, talus | Ridge field, slope classification, outcrops, ramps/switchbacks | Every required elevation region reachable; cliffs readable; path slope capped |
| Volcano | Ridge/caldera recipe plus directed lava features | Ash/detail field, lava flow graph, cooled margins, rock clusters | Lava never enters formations; crossings/connections explicit |
| Cave / crystal cavern | Field-seeded solid/open mask plus chambers | CA cleanup, chamber graph, moisture/mineral fields, crystal suitability | Required room graph connected; intentional dead ends/loops tracked |
| Mine / dungeon / crypt | Constructed room/corridor graph over cave/stone substrate | Structured graph, erosion/damage/overgrowth overlays | Geometry remains readable; route width and room entrances validated |
| Bridge | Drainage/water feature first, crossing structure second | Select a valid narrow crossing, banks, abutments, bridge deck | Both landings connected and level-compatible; no implicit water traversal |
| Castle / ruins / guild | Structured footprint over natural local relief | Courtyards, broken walls, paths, rubble/overgrowth suitability | Multiple entries only when recipe allows; blockers and breaches explicit |
| Arena | Deliberately formal and symmetric/asymmetric by arena recipe | Minimal natural substrate variation, controlled props | Formation capacity, fairness, and approach parity override organic metrics |

## Implementation Work Plan

### Wave 0 — Make the Current Contract Truthful

Execution rule: complete the BMG-00 baseline and land BMG-04 before BMG-01,
before any task that changes generated output, and before modifying any
dependency imported by the legacy generator. BMG-02, BMG-03, and every Wave 1
generator implementation are version-2-only. Legacy code may be extracted for
isolation only when the immutable version-1 digest corpus proves byte-equivalent
output before and after the extraction.

#### BMG-00: Add a reusable audit harness

**Files**

- Add `scripts/audit-battle-maps.js`.
- Add focused tests under `shared/mapgen/`.
- Add a package script such as `battle-maps:audit`.
- Update `.github/workflows/worldgen-ci.yml` and artifact configuration.

**Implementation**

- Accept versions, node types, seed range/list, dimensions, and output directory.
- Emit machine-readable per-map hard/tactical/quality metrics, stage results,
  hashes, timings, and aggregate percentiles.
- Optionally emit deterministic render fixtures/gallery manifests without
  requiring a browser for the metric-only mode.
- Check for non-finite/ragged grids, unknown assets, stage failures, final
  mutations, and stream-isolation violations.
- Record environment and generator version with results.
- Replace or explicitly retain the current seeds `1..500` PR and `1..5000`
  scheduled corpus jobs; wire the new version/type/size matrix deliberately
  instead of assuming the existing script covers it.
- Set CI timeouts, shard boundaries, artifact names/retention, and a compact
  failure summary so an invalid or timed-out corpus is diagnosable.

**Acceptance**

- Reproduces the 16-type, seeds `0..99`, 32x32 baseline above.
- Two identical runs produce identical data apart from explicitly excluded
  timing/environment fields.
- CI runs the declared 1,600-map PR corpus and uploads the exact matrix,
  aggregate report, and bounded failure samples; a larger seeded corpus runs
  nightly without exceeding its documented timeout/performance budget.

#### BMG-04: Freeze version 1 and install a version dispatcher

**Files**

- `shared/mapGeneration.js`
- `api/src/services/battle/encounterService.js`
- add an isolated legacy/version dispatcher boundary under `shared/mapgen/`
- immutable version-1 fixtures and dispatcher tests

**Implementation**

- Add one explicit dispatcher keyed by `terrainGenerationVersion`.
- Isolate the current generator and every transitive dependency that can affect
  its output—including pipeline dispatch, algorithms, recipe/style data, seed
  and PRNG helpers, `ConstraintValidator`, `SpawnPlacer`, repair behavior, and
  output serialization—as the version-1 implementation.
- Make the frozen branch import only frozen V1 modules or proven-pure
  compatibility adapters. It must not import mutable V2 stages, the new runtime
  traversal implementation, or shared helpers whose changed semantics could
  alter seed derivation, stream consumption, iteration order, repair order,
  metadata, or serialized layer values.
- Reserve a separate `shared/mapgen/v2/` boundary for all new stage, field,
  route, ecology, and variant code.
- Capture immutable serialized-output fixtures and their test digests from the
  generator audit baseline recorded at the top of this document before
  refactoring; do not regenerate expected values from the refactored branch.
- Reject unknown future versions; treat a missing persisted version as version
  1 only at the load/dispatch boundary.
- Preserve absent-version direct `generateTerrain()` calls through a deprecated
  V1 adapter during migration; every new normalized authoritative request must
  provide a version explicitly.

**Acceptance**

- Version-1 seed derivation and representative serialized full-layer digests are
  unchanged for every configured node type/archetype, selected seeds, standard
  and edge supported sizes.
- Calling the dispatcher with version 1 is byte-equivalent to the pre-dispatch
  public output.
- Calling an unsupported version fails explicitly and cannot fall through to
  version 1 or the newest implementation.
- A static import-boundary test prevents version-2 recipes, stages, mutable
  runtime traversal code, and unfrozen generator dependencies from being
  imported by the version-1 branch.
- The immutable V1 digest suite is a release-blocking check for every later
  Wave 0 shared-code change, including BMG-01.

#### BMG-01: Unify authoritative traversal

**Files**

- add a shared object-based traversal module
- `shared/pathfinding.js`
- `shared/obstacles.js`
- `api/src/services/battle/movementService.js`
- `api/src/services/ai/strategicPathfinding.js`
- server landing/ability/path call sites found during implementation
- `frontend/src/battle/BattlePathfinding.js`
- `frontend/src/battle/BattleGrid.js`
- focused shared, server, and frontend tests

**Implementation**

- Add object-based APIs that accept a `TraversalView` containing terrain,
  obstacles, elevation, elevation connections, units, dimensions, and movement
  policy.
- Centralize `canEnterTile`, step cost, connection lookup, and occupancy.
- Keep narrow legacy adapters temporarily; prohibit new positional call sites.
- Make `BattleGrid.isWalkable()` and path preview call the shared contract.
- Make server movement, AI, and landing selection call the same contract; expose
  it for BMG-02 validation and BMG-06/BMG-14 spawn work.
- Supply persisted elevation connections to the client pathfinder instead of
  the current `null` placeholder.
- Do not switch the frozen legacy generator's `ConstraintValidator`,
  `SpawnPlacer`, or repair path to new behavior. Version 2 consumes the unified
  runtime contract in BMG-02, BMG-06, and BMG-14 through separate V2 modules.
- Preserve special abilities through explicit movement policies rather than
  local obstacle exceptions.
- Audit existing generated version-1 maps under both the old terrain-only rule
  and the new combined runtime rule. Generated blockers currently duplicate
  impassability in terrain, but any historic inconsistent obstacle state must be
  reported and handled explicitly rather than silently changing a live battle.

**Acceptance**

- A `passable:false` obstacle on walkable terrain is unreachable for ordinary
  movement in shared, server, client, AI, and landing tests; BMG-02/BMG-14 add
  the validator/spawn legs of the same fixture.
- A `passable:true` gameplay obstacle remains traversable at the terrain cost;
  a decoration is ignored because its schema cannot express collision.
- Elevation connections produce identical costs and reachability on client and
  server.
- Existing ability-specific movement tests remain valid.
- The version-1 parity audit either proves no generated-state traversal changes
  or produces an approved migration/compatibility decision and release note for
  each discrepant fixture.
- The immutable V1 serialized full-layer digest corpus remains byte-identical
  after BMG-01; any difference blocks merge.

#### BMG-05: Define the V2 envelope, hashes, and persistence protocol

**Files**

- add `BattleMapV2Candidate`/`BattleMapV2Final` schemas, `BattleMapAdapter`,
  exhaustive closed schemas for every nested layer/record, canonical
  serializer, and hash helpers under shared code
- add `api/src/services/battle/BattleStateRepository.js` as the sole production
  persistence boundary for the complete authoritative battle envelope and its
  state revision
- `api/src/services/battle/encounterService.js`
- `api/src/services/battleRewardService.js`
- `api/src/routes/battle.js`
- `api/src/services/battleWebsocket.js`
- `api/src/services/battleReconnection.js`
- `api/src/services/battleTurnManager.js`
- `api/src/services/coliseum/matchLifecycle.js`
- `api/src/services/coliseum/statistics.js`
- `api/src/services/coliseum/turnTimer.js`
- `api/src/services/debugService.js`
- `api/src/services/guildmasterBattleService.js`
- `api/src/services/messageReliability.js`
- `api/src/websocket/messageHandlers.js`
- `frontend/src/scenes/BattleScene.js`
- `frontend/src/battle/mergeBattleState.js` and battle-state serializers
- database migration/rollback files for `state_revision` and any other
  persisted-envelope changes
- schema, canonical-vector, JSONB round-trip, transport, persistence, rejoin,
  mixed-version migration, static persistence-boundary, concurrent-writer, and
  lifecycle/reward transaction tests

**Implementation**

- Implement the exact field names, required layers, and flat-state adapter
  described in the target contract, including distinct
  `battleMapSchemaVersion` and `terrainGenerationVersion` fields. Do not
  introduce competing aliases such as `generationVersion`, `seed`, `width`, or
  `height`.
- Define and enforce separate `BattleMapV2Candidate` and `BattleMapV2Final`
  schemas. The candidate omits only `diagnostics.hashes`; only the final schema
  is legal at persistence, cache, and wire boundaries.
- Freeze every nested record shape, enum, identity/reference rule, and
  serialized value contract listed in the target contract during this task.
  Include a schema-valid empty/minimal fixture and a representative fixture
  containing at least one instance of every optional record kind. Later
  generator, renderer, and asset tasks may populate these records but may not
  silently add fields or record kinds to schema version 2.
- Implement `sha256-cjson-v1`, its three closed projection schemas, exact
  domain-prefix/digest encoding, canonical bytes, numeric normalization,
  excluded fields, and rejection rules in browser-compatible shared code.
  Publish complete fixed vectors and hard-failure behavior.
- Implement the repository create/load/mutate contracts with injected,
  schema-valid `BattleMapV2Final` fixtures. The create contract atomically
  inserts the map, mirrors, revision zero, and initial mutable state; its
  mode-specific request/match idempotency contract prevents duplicate rows or
  seed changes after an ambiguous commit.
- Keep real production creation on the frozen version-1 dispatcher during this
  task. BMG-31 connects authoritative modes to the real V2 generator and final
  gate after BMG-22 exists; BMG-05 must not add a provisional generator or
  second finalizer.
- Persist version-2 connections, transitions, decorations, stable feature
  identity, bounded diagnostics, and hashes through the adapter.
- Send the complete `BattleMapV2Final`, including feature records, over the
  initial/rejoin version-2 wire contract so the receiver can independently
  recompute every hash. Subsequent updates use a versioned mutable-state delta
  plus matching map versions/hash and persisted `baseStateRevision`/
  `stateRevision`; no unversioned response projection may silently omit hashed
  data.
- Extend `BattleScene` hydration and `applyBattleMapPatch()` for every V2 layer,
  metadata field, and hash. Disable local fallback generation whenever the
  response declares V2.
- Define explicit `battleMapCapabilities` request/response and WebSocket
  handshake fields, including supported `battleMapSchemaVersion`,
  `hashVersion`, and mutable-delta protocol versions plus the server-required
  values. BMG-31 controls assignment policy, but no endpoint may infer
  capability from an absent field.
- Define cached-map hit/miss, reconnect, map replacement, hash mismatch, and
  unknown-delta behavior. Define duplicate, gap, out-of-order, and conflicting
  revision behavior. A client applies no mutable delta until its immutable map
  reference and exact base revision are satisfied.
- Inventory the current mutable JSON fields and authoritative/client-visible
  battle-row lifecycle fields, then publish closed
  `BattleMutableStateV1`/`BattleMutableStateUpdateV1` schemas. The repository
  accepts typed mutable commands/projections rather than caller-supplied full
  battle-state replacements, so a command cannot express an immutable map
  mutation.
- Inventory and migrate every production `battles`-row create/mutation and
  every live-state read to `BattleStateRepository`. At minimum, cover the
  route, turn manager, battle rewards, coliseum lifecycle/statistics/timer,
  reconnection, debug, guildmaster, reliability, and WebSocket-handler call
  sites listed above. Repository commands compare the expected revision,
  enforce lifecycle preconditions, preserve immutable map fields and hashes,
  advance exactly once for every client-visible change, and return the
  committed successor revision.
- Make PvE reward completion and coliseum completion idempotent revisioned
  commands. The battle terminal fields and current related database side
  effects commit together using the same transaction client; a duplicate
  idempotency key returns the prior result, while a stale revision or
  non-active lifecycle state awards nothing.
- Add a static architecture test that rejects production
  `INSERT`/`UPDATE`/`DELETE` access to `battles` outside the repository and
  approved migration code. Keep any direct read-only analytics/leaderboard
  queries on a named minimal allowlist and prohibit them from constructing
  authoritative live state.
- Send committed updates through ACK/retry, make retry exhaustion read a fresh
  repository snapshot, and add a revision heartbeat/snapshot request. Never
  broadcast an uncommitted or stale captured state object.
- Validate the `map_seed`/`map_width`/`map_height` mirrors against flattened JSON
  state on write and load. Reject or quarantine conflicts; never choose by
  precedence.
- Define persisted diagnostic and wire byte budgets. Put timings, environment,
  rejected-attempt detail, and full fields in an optional retention/redaction
  controlled audit sidecar rather than ordinary battle state.
- Let only the version-1 adapter supply absent-layer defaults. A version-2
  missing layer, missing flat elevation grid, or hash mismatch is corruption.
- Never let a client fallback overwrite or substitute for persisted server map
  state.

**Acceptance**

- Canonicalization is invariant to object-key insertion order and JSONB
  key reordering, while semantic array reordering changes the appropriate hash.
- The same fixed canonical/hash vectors pass in Node and each supported browser;
  malformed, unsupported, or unverifiable hashes fail closed.
- A candidate passes its schema without hashes but is rejected by every
  adapter/persistence/wire boundary; a final value is rejected unless it has
  exactly three `sha256:` plus 64-lowercase-hex hashes whose independent
  recomputation matches.
- Recursive closed-schema tests reject unknown fields and unknown record kinds
  at every depth. The representative fixture exercises every nested record
  kind and reference relation; a test demonstrates that any structural
  extension requires a new map-schema discriminator and corresponding
  negotiation, hash-vector, and migration/coexistence fixtures.
- One complete fixture publishes the exact three projection objects, canonical
  bytes, and expected digests, and produces identical results in Node, every
  supported browser, and after a JSONB round trip.
- Serialize/load/rejoin, WebSocket delta/cache-miss recovery, and database JSONB
  round trips reproduce all three hashes and byte-equivalent authoritative
  layers.
- Ordered, duplicate, gapped, out-of-order, and conflicting-revision fixtures
  prove idempotent application or fail-closed snapshot recovery, and concurrent
  state writes cannot reuse or skip an accepted revision silently.
- The closed V1 update carries the complete mutable projection and cannot carry
  a map field or arbitrary patch path. ACK retry, exhausted-retry fresh
  snapshot, lost-post-commit broadcast, heartbeat mismatch, and reconnect
  fixtures converge to the persisted revision without resending a verified
  cached map.
- Races between action, AI, timer, disconnect/reconnect, debug, route,
  completion, and reward paths prove each repository command either commits one
  unique lifecycle-valid successor revision without changing the immutable map
  or receives a retryable/non-active conflict. Completing a battle makes a
  stale or newly issued gameplay command fail even if that command has the
  otherwise-current revision.
- PvE reward and coliseum terminal fixtures inject failures at every database
  step and prove the terminal battle fields, revision, user/character/inventory
  awards, node clearance, match/rating records, and character availability
  commit together or not at all. Duplicate and ambiguous-commit retries do not
  duplicate rewards, ratings, history, or terminal broadcasts.
- A static check finds no direct production `battles` mutation SQL outside the
  repository and migrations, and each exceptional direct read matches the
  explicit analytics/leaderboard allowlist.
- A version-2 wire round trip retains the complete feature records and permits
  independent recomputation of every hash.
- The full hash cannot reference itself, and changes to excluded timing or
  environment fields do not change it.
- Repository creation with an injected final-map fixture is atomic and
  idempotent: map, seed, version, mirrors, revision zero, and initial mutable
  state become visible together, and injected failures leave no
  partial/duplicate battle. Real PvE, guild, and coliseum V2 integration is a
  BMG-31 acceptance gate; production creation remains V1 after BMG-05.
- A version-1 fixture still loads/renders; a version-2 fixture with an absent
  required layer or conflicting database mirror is rejected.
- Create/current/rejoin and WebSocket-join fixtures prove declared capability,
  upgrade-required, and absent-capability behavior; V2 never reaches a client
  that would flatten or locally regenerate it.
- Clean-schema, upgrade, rollback, mixed V1/V2, corrupt-JSONB, and mirror-conflict
  tests pass; any new index has a demonstrated query plan.

#### BMG-06: Define spawn geometry and protected masks before topology

**Files**

- add `shared/mapgen/v2/SpawnLayoutContract.js`
- `shared/mapgen/SpawnPlacer.js`
- party/formation limit definitions and mode adapters
- compact, non-square, arena, and capacity tests

**Implementation**

- Resolve exact player formation slots, maximum required enemy capacity,
  arena-specific slots, minimum exits, strategy candidate/staging masks, and a
  distance-to-protected-zone field from the normalized request.
- Publish immutable protected core and feather masks before fields, hydrology,
  regions, routes, or blockers run.
- Define capacity and clearance requirements without mutating terrain or
  selecting the final enemy positions; BMG-14 performs landscape-aware
  selection and integration.
- Remove algorithm-local spawn-column constants from every version-2 API.

**Acceptance**

- Every supported mode, map size, party size, and enemy-cap fixture resolves
  enough in-bounds slots or fails request validation before generation.
- Protected masks are deterministic, dimension-correct, and available to every
  topology stage without hard-coded columns.
- Natural-map fixtures reserve capacity without requiring a full-height
  rectangular edge strip.

#### BMG-02: Build the V2 validation and deterministic-repair framework

**Files**

- add V2 validator/metric/typed-edit helpers under `shared/mapgen/v2/`
- V2 recipe constraint definitions
- shared traversal integration and validator contract tests

**Implementation**

- Return separate `hardValid`, `tacticalPass`, and `qualityScore` results.
- Define an extensible check registry. Initial hard checks cover dimensions,
  finite values, palette/schema basics, spawn-layout capacity, and authoritative
  connectivity; later tasks must register feature-, connection-, and
  asset-specific checks.
- Measure route diversity with a vertex-capacitated tile graph between protected
  zones; measure corridor clearance from a distance-to-blocker field along
  required routes.
- Measure the accessible required-region graph, usable-area ratio, route detour,
  choke/clearance distribution, and intentional versus accidental dead ends.
  Competitive recipes also measure approach-distance and line-of-sight parity.
- Move maximum walkable ratio and similar style preferences to recipe quality
  unless a specific mode declares them tactical requirements.
- Express repair as typed edits that declare and update dependent layers.
- Add bounded attempt seeds derived from `(terrainSeed,
  terrainGenerationVersion, attempt)`. Rank with a documented lexicographic
  tuple of quantized/integer metrics and stable final tie-break, not raw float
  comparisons or an underspecified aggregate score.

**Acceptance**

- Hard, tactical, and soft results cannot be conflated by the API or recipe
  schema.
- Known graph fixtures report the expected disjoint-route count, required-region
  reachability, usable area, detour, clearance/chokes, dead ends, and parity.
- A typed repair that omits a declared dependency fails a contract test.
- Retry order and selected candidate are deterministic; exhausting the attempt
  budget fails explicitly.
- This task does not claim final-map validity; BMG-22 installs the authoritative
  gate after all V2 layers and asset contracts exist.

#### BMG-03: Implement V2 stage dispatch and consolidate V2 recipes

**Files**

- add V2 pipeline/context/recipe registry under `shared/mapgen/v2/`
- V2 algorithm implementations and contract tests
- read legacy archetype/style/node configuration only through an explicit
  migration/compiler adapter

**Implementation**

- Define a stage interface with declared inputs, outputs, required/optional
  status, deterministic stream, and `run(context, parameters)` entry point.
- Publish stage results and feature records into typed context keys.
- Make seed-region consumption explicit; do not repeat the legacy implicit
  selection among `apply`, `applyEnhanced`, and `applyWithSeedRegions`.
- Treat missing required outputs and required-stage errors as candidate failure.
- Compile style/archetype/node data once, apply all resolved multipliers
  consistently, record them, and establish one explicit reject-or-map
  unknown-node policy.
- Compile a feasibility profile before candidate generation from recipe,
  dimensions, mode, and formation capacity. It declares required/optional
  features, minimum footprints, per-size budgets, and deterministic degradation;
  an unsatisfied required feature rejects the request before retry.
- Compile a declared render palette for every production recipe, mapping it
  deliberately to required tile biome/material/connection/transition/prop
  capabilities. Consume the early BMG-21 inventory artifact for current
  capabilities, report planned-but-missing V2 keys explicitly, and do not reuse
  enemy-biome aliases as an implicit tile fallback. BMG-21 fills approved gaps;
  BMG-22 is the enablement gate that requires exact runtime resolution.
- Migrate unique live configuration into one V2 registry; leave legacy
  `algorithmPool` and dispatcher behavior frozen until version 1 retires.

**Acceptance**

- A forest/cave fixture proves a macro stage publishes regions and the next
  stage consumes the same IDs.
- Room/path stage fixtures populate context counts and geometry.
- Every V2 production recipe passes an interface/config schema test.
- Every declared recipe × size/mode/capacity fixture has a feasible budget or an
  explicit unsupported result and a complete render-capability requirement
  list. Unsupported compact requests fail preflight with a stable reason and
  consume no attempt seed.
- All 16 production node types have an explicit render-palette mapping; unknown
  nodes and missing asset capabilities never fall through to forest. A recipe
  remains disabled until BMG-21/BMG-22 prove exact resolution.
- Injected required-stage failure rejects a candidate; an explicitly optional
  stage records an omission without corrupting downstream inputs.
- The immutable version-1 digest corpus remains unchanged.

### Wave 1 — Build the Organic Landscape Core

#### BMG-10: Implement `LandscapeFieldSet` and coherent elevation

**Files**

- Add V2 field/elevation modules under `shared/mapgen/v2/`.
- Port useful logic from `shared/mapgen/ElevationMapper.js` without changing the
  frozen legacy implementation.
- Integrate through the V2 stage registry.
- Add field/elevation property tests.

**Implementation**

- Seed one noise object per named field and sample it by coordinate.
- Use the named elevation stream/salts for elevation; do not consume the terrain
  stream or draw a new seed while visiting each tile.
- Support explicit octave, amplitude, scale, ridge, and limited warp settings.
- Resolve spatial frequencies/features-per-map from the feasible dimension
  profile so compact and non-square maps retain the intended macro/meso scales.
- Produce continuous working height and declared normalized/discrete outputs.
- Quantize values at every classifier, sorting, connection-selection, and
  ranking boundary using the recipe/hash-version precision contract.
- Smooth/terrace according to recipe without changing protected cores.
- Generate reciprocal connection candidates from height differences and
  protected-layout requirements for BMG-13 to select/reconcile; do not create
  random ramps merely to satisfy a count.

**Acceptance**

- Neighbor sampling is independent of scan order and unrelated stream draws.
- Threshold-adjacent fixtures and scan orders select byte-identical discrete
  output under the documented quantization rules.
- All values are finite/in range for compact, non-square, and standard maps.
- For natural rolling recipes, at least 95% of four-neighbor semantic elevation
  transitions are no more than one level, excluding declared cliffs.
- Connection candidates are reciprocal, in bounds, scan-order invariant, and
  agree with the continuous/quantized height relationship.

#### BMG-11: Implement connected terrain regions and recipe compilation

**Files**

- Add region/classification helpers under `shared/mapgen/v2/`.
- Add V2 field classifiers and CA refinement rather than changing legacy
  `PerlinNoise.js` or `CellularAutomata.js`.
- Update V2 recipe definitions and tests.

**Implementation**

- Convert field suitability into named regions with hysteresis and minimum
  component sizes.
- Make CA consume a prior mask for caves/refinement.
- Separate material classification from stochastic intensity.
- Store region ID, type, bounds, area, adjacency, and parent feature.
- Provide structured-overlay stages for constructed recipes.

**Acceptance**

- Natural recipes have no accidental semantic components smaller than the
  recipe minimum after exclusions for authored single-tile features.
- Seed regions are observable in diagnostics and consumed by the next stage.
- Structured recipes retain their required geometry with natural variation
  limited to configured layers.

#### BMG-12: Add drainage-derived water and lava features

**Files**

- Add `shared/mapgen/v2/Hydrology.js`.
- Add recipe water/lava parameters, populate the frozen water-body feature
  records, and add property tests.
- Integrate with fields, routes, terrain classification, and transitions.

**Implementation**

- Implement deterministic Priority-Flood conditioning and flow
  direction/accumulation.
- Represent intentional closed basins separately from accidental sinks.
- Resolve source count, minimum contributing area, width curve, outlet/basin
  policy, and alignment thresholds from the feasible map-size profile.
- Derive feature width, bank, moisture, and crossing candidate masks.
- Protect formations and required structure footprints.
- Use a separate directed-flow recipe for lava material and rules.

**Acceptance**

- Every non-basin water/lava centerline has a valid downstream chain to its
  declared outlet.
- No feature enters a protected core.
- Banks and wetness masks are derived from the same feature boundary.
- Channels stay within recipe width/area budgets and pass bounds for long
  axis-parallel runs, stair-step turns, and abrupt width changes.
- Every required route-anchor pair exposes at least one legal crossing candidate
  or a verified land-only corridor for BMG-13.

#### BMG-13: Add least-cost V2 feature routes

**Files**

- Add `RoutePlanner` plus route graph/cost/width helpers under
  `shared/mapgen/v2/`.
- Integrate room/clearing/crossing anchors and tests.

**Implementation**

- Route centerlines with deterministic A* and recipe-defined costs.
- Include prior heading in state where curvature is scored.
- Enforce strictly positive edge costs, stable tie-breaking, and an admissible,
  consistent heuristic; use Dijkstra when the resolved cost model cannot prove
  that heuristic contract.
- Add deterministic cleanup, variable width, shoulders, wear, and feature IDs.
- For rooms/caves, construct anchor graphs and deliberate loop edges first.
- Reconcile route elevation and connections through typed edits.
- Record and validate detour ratio, sinuosity, turn density, minimum straight
  run, clearance/choke distribution, required-region coverage, and intentional
  dead-end budget; add LOS/approach parity for competitive recipes.

**Acceptance**

- Every declared route connects its anchors under authoritative traversal.
- A* results match a Dijkstra cost oracle on deterministic small-grid/property
  fixtures for every enabled cost term.
- Centerlines contain no immediate backtracking or avoidable one-tile
  left-right zigzags.
- Route-shape, required-region, clearance, dead-end, and parity metrics meet the
  resolved recipe profile rather than one global threshold.
- Route slope/crossing limits satisfy the recipe.
- Every required higher region is reachable through selected reciprocal
  ramps/stairs or another explicitly permitted connection.
- Path material, shoulder, vegetation clearing, and transition masks agree.

#### BMG-14: Select and integrate actual spawns

**Files**

- `shared/mapgen/SpawnPlacer.js`
- V2 spawn-selection/integration stage
- coliseum/guild formation call sites and tests

**Implementation**

- Consume the BMG-06 formation slots, strategy masks, protected cores, and
  approach exits already used by topology stages.
- Select actual enemy positions against the completed terrain/routes and reserve
  all selected positions before blocker placement.
- Feather terrain/elevation integration at the protected boundary.
- Remove the legacy-style final blanket mutation from the V2 branch and validate
  actual selected spawns.

**Acceptance**

- Every supported party/enemy count has the required number of valid positions.
- All actual spawns pass authoritative traversal and occupancy validation.
- Protected cores remain flat/clear; natural recipes have no straight
  full-height replacement seam caused solely by spawn clearing.

#### BMG-15: Add ecology-aware blockers and nonblocking decoration

**Files**

- Add V2 ecology/blocker placement and suitability/minimum-distance helpers.
- Implement runtime catalogs, serializers, and population for the frozen
  obstacle and `decorations` record schemas; renderer work remains in BMG-20.
- Add traversal-isolation and distribution tests.

**Implementation**

- Place feature-owned blocker clusters from suitability masks.
- Use deterministic Poisson-disk or equivalent spatial indexing for minimum
  distances within a feature.
- Align grove/outcrop semantic terrain, blocker kind, and assets.
- Keep substrate and prop collision independent: a blocking prop must not rewrite
  otherwise walkable base terrain solely to duplicate its collision.
- Populate the separately frozen decoration record, whose schema has no
  `passable` or collision field.
- Apply independent per-biome budgets and culling rules.

**Acceptance**

- Blockers never overlap protected cores, required centerlines, connections, or
  invalid substrate.
- Minimum spacing and recipe coverage bands hold across the corpus.
- Per-recipe association checks confirm placement responds as declared to
  moisture, slope, distance to water/routes, disturbance, and parent
  grove/outcrop regions; cluster/void statistics reject uniform scatter.
- Removing a blocker exposes the unchanged substrate and changes traversal only
  through removal of that obstacle.
- Changing only decoration parameters leaves the authoritative traversal hash
  and all unit positions unchanged.

#### BMG-16: Generate correlated variants and transition masks

**Files**

- Add V2 transition/variant helpers and populators for the frozen record schemas
  without changing legacy `createInitialVariants()`.
- Update runtime asset catalogs and tests.

**Implementation**

- Use coordinate hashes and continuous/material/feature inputs instead of
  scan-order random draws.
- Calculate canonical directional masks after all semantic edits.
- Keep variants within available counts for the resolved biome/material.
- Produce composable route, shore, cliff, slope, and environment overlays.
- Resolve overlapping overlays through one catalogued precedence/composition
  table with explicit anchors and painter strata.

**Acceptance**

- Reordering iteration does not change variants.
- Natural recipes keep accidental isolated variant tiles below 10% while no
  single variant occupies more than its configured maximum.
- Every transition mask matches its final neighbors and maps to a registered
  transition kind/catalog key. BMG-21 supplies assets and BMG-22 enforces final
  strict resolution.
- Shore + route, route + slope, cliff + wetness, and decoration/prop overlap
  fixtures are iteration-order invariant and either resolve to a declared
  composition or fail validation.

### Wave 2 — Render the Landscape Model

#### BMG-20: Draw connections, transitions, and decorations

**Files**

- `frontend/src/battle/BattleGrid.js`
- `frontend/src/battle/BattlePathfinding.js`
- `frontend/src/core/AssetLoader.js`
- `frontend/src/scenes/BattleScene.js`
- `frontend/src/battle/mergeBattleState.js`
- renderer tests and deterministic screenshots

**Implementation**

- Select slope/stair sprites from persisted reciprocal connections.
- Draw shore/bank/path/cliff overlays from transition masks.
- Insert decorations into the existing floor/prop/unit painter queue with
  explicit anchors and bounds.
- Apply the shared transition composition table at explicit painter strata,
  including tile-top, exposed-face, connection, prop, and foreground overlays.
- Preserve renderer-owned exposed-face geometry and hit testing.
- Supply persisted connections to client traversal.

**Acceptance**

- Slope/stair fixtures use `getSlopeSprite()` with the expected biome,
  direction, and variant.
- Client/server reachability is identical on fixtures containing blockers,
  ramps, stairs, ledges, cliffs, and units.
- Foreground props/decorations occlude correctly without changing hit targets.
- Deterministic screenshot fixtures cover shore + route, route + slope, cliff +
  wetness, and decoration + prop overlaps from all four transition directions.
- Existing projection/elevation tests remain green.

#### BMG-21: Extend the deterministic render-asset contracts

**Files**

- `ai-image-metadata/tiles/manifest.json`
- relevant floor/wall/slope metadata
- `scripts/tiles/isometricCompiler.js`
- `shared/obstacles.js`, `ai-image-metadata/obstacles/manifest.json`, and its
  category metadata
- add a closed shared decoration catalog and dedicated decoration metadata
- `scripts/tiles/obstacles/index.js`
- `scripts/ai-images/validate-runtime-assets.mjs` and its tests
- `frontend/src/core/AssetLoader.js`
- `frontend/src/battle/BattleGrid.js` and focused asset/render tests
- tile compiler plus obstacle/decoration catalog/runtime validator tests
- generated canonical assets

**Implementation**

- Inventory existing tile, slope, obstacle, and reusable decoration assets
  before adding keys.
- Compile a recipe × render palette × material × transition kind/direction/level
  tile-coverage matrix for all production recipes. Separately compile each
  recipe's obstacle and decoration key/category coverage against their closed
  shared catalogs and on-disk runtime manifests.
- Prefer small reusable overlay families for shores, route edges, wetness, and
  talus instead of material-pair permutations.
- For floor, exposed-face, slope, and tile-bound transition assets, define key
  identity, direction, anchor, logical box, and boundary behavior in tile
  metadata and generate/rebuild through the deterministic isometric compiler.
- For obstacles and free-standing decorations, define exact runtime URL,
  category, straight-alpha rule, logical render box, ground-contact anchor,
  footprint/occlusion bounds, and allowed source scaling in their own metadata.
  Replace renderer-only category size guesses with those declared values;
  props do not inherit the 2:1 tile-footprint requirement.
- Add strict V2 resolvers that never substitute a category default or fallback
  shape for an unknown key. Preserve legacy fallback behavior only on the
  isolated V1 rendering path.
- Cross-check recipe declarations, shared catalogs, metadata, published files,
  loader URLs, and renderer anchors in `validate-runtime-assets`; a declaration
  present in only one source is an error.

**Acceptance**

- `npm run tiles:check` passes.
- Tile-bound assets retain the exact 2:1 footprint, straight alpha, shared
  boundary pixels, logical dimensions, and supported biome mapping.
- Every obstacle and decoration key has one catalog/metadata/file/loader match
  and passes its declared alpha, logical-bound, anchor, footprint, occlusion,
  and scaling contract without being treated as a floor tile.
- Exact-resolution tests disable `AssetLoader` fallbacks and prove every
  declared tile, obstacle, and decoration recipe capability resolves the
  intended key; intentional sharing of a five-biome palette remains explicit.
- Strict validation rejects a missing or fallback-only floor, wall,
  transition, slope, obstacle, or decoration key referenced by a recipe.

#### BMG-22: Install the authoritative V2 final-output gate

**Files**

- V2 map assembler/finalizer under `shared/mapgen/v2/`
- BMG-02 validator registry and typed repair integration
- canonical hash and `BattleMapAdapter` integration
- final schema/asset/traversal/corpus tests

**Implementation**

- Run candidate repair/retry before finalization and complete every
  authoritative and visual-layer mutation, including actual spawns, blockers,
  elevation connections, transitions, variants, and decorations.
- First run a read-only pre-hash gate covering the
  `BattleMapV2Candidate` schema, dimensions, finite values, recipe palette,
  actual spawn/occupancy state, authoritative traversal, reciprocal elevation
  connections, satisfied feasibility profile, required feature/tactical
  invariants, transition-neighbor/composition agreement, bounded diagnostics,
  and strict no-fallback runtime asset resolution.
- Reject a candidate on any hard failure. Apply bounded deterministic retry and
  fail generation explicitly when no candidate qualifies.
- After the candidate gate passes, canonicalize the three BMG-05 projections,
  calculate their hashes, and attach only `diagnostics.hashes`; no other
  post-gate mutation is allowed.
- Validate the resulting `BattleMapV2Final` schema, independently recompute all
  three hashes and compare them, then deep-freeze the result. Any mismatch or
  mutation fails finalization.
- Persist only through the adapter that revalidates the frozen final value.

**Acceptance**

- No authoritative API can return or persist a version-2 map with
  `hardValid:false`, a missing required layer, an unsupported feasibility
  profile, or an unresolved/fallback-only asset key.
- No candidate without hashes can cross a cache, adapter, wire, or persistence
  boundary, and no finalized value can cross one with missing, extra, stale, or
  malformed hashes.
- No post-gate layer mutation is possible without changing a hash and failing a
  contract test.
- The PR corpus is 100% hard-valid. Tactical pass rates meet each recipe's
  declared policy; soft targets remain diagnostics rather than correctness
  failures.
- Repairs never introduce material outside the recipe palette or leave stale
  connections, transitions, obstacles, or feature records.
- Serialize/load/rejoin preserves the finalized hashes and layers exactly.
- The persisted and initial/rejoin representations meet their declared byte
  budgets; audit-sidecar fields cannot leak into or inflate ordinary state.

### Wave 3 — Tune, Prove, and Roll Out Version 2

#### BMG-30: Establish quality gates and a deterministic gallery

**Files**

- Extend the audit harness.
- Add deterministic browser screenshot tooling/fixtures.
- Add versioned macro-layout/feature-signature and similarity helpers.
- Add reviewed recipe baselines under test data rather than production code.
- Update `.github/workflows/worldgen-ci.yml` with the final V2 corpus matrix,
  shards, timeouts, and artifacts.

**Implementation**

- Measure hard validity; required-region accessibility; usable-area, detour,
  route diversity/clearance/chokes/dead ends and competitive parity; adjacent
  elevation deltas; water continuity/scale/alignment; route
  sinuosity/turn-density; prop spacing/coverage and ecological association;
  variant patch statistics; component compactness/boundary roughness;
  multiscale field/region spectra; generation timing; and payload size.
- Build an identity-excluding macro-layout signature from normalized/downsampled
  terrain regions, elevation bands, water/route masks, protected zones, and the
  region/route/connection topology graph. It deliberately excludes seed,
  attempt, variants, and decorations so cosmetic or identity changes cannot
  hide repeated structure.
- For each recipe/size profile, report exact macro-signature collisions,
  deterministic pairwise or locality-sensitive near-neighbor similarity,
  feature-count/placement distribution coverage, and ordinary projection-hash
  collisions. Lock profile-specific collision, near-duplicate, and distribution
  bands after baseline review; constrained arenas may have different bands but
  may not silently opt out.
- Generate a fixed seed gallery for every recipe at 32x32 plus selected compact
  and non-square sizes. Keep a separate unseen-seed holdout gallery that is not
  used to choose thresholds or tune recipe parameters.
- Require a human review rubric for silhouette, feature causality, spawn seams,
  readability, repetition, and isometric transition artifacts.
- Lock recipe-specific thresholds only after comparing the gallery and metric
  distributions. Do not use one global “organic” threshold for arena and swamp.
- Review transition-composition screenshots at four directions and representative
  elevation/prop overlaps, not only isolated floor tiles.

**Acceptance**

- PR corpus: all 16 node types, seeds `0..99`, 32x32.
- Size corpus: 10x10 where supported, arena 11x16, 16x24, 24x32, 32x32, and
  48x40 across a fixed reduced seed set; unsupported recipe/size combinations
  pass deterministic preflight-rejection fixtures instead of generation.
- Nightly corpus: at least seeds `0..999` for all 16 types at 32x32.
- No hard-validity, deterministic-hash, stream-isolation, schema, or asset
  failures.
- Natural-recipe isolated semantic tiles are at most 1% after documented
  exclusions; at least 95% of adjacent non-cliff elevation changes are at most
  one level; all drainage and route invariants pass.
- Ecology metrics demonstrate recipe-bounded positive/negative associations
  with moisture, slope, water, routes, disturbance, and parent features rather
  than merely hitting a global density.
- Every recipe/size corpus stays within its reviewed exact-signature collision,
  near-duplicate-rate/similarity, and feature-distribution bands. Projection
  hashes have no collisions, and changing only variants/decorations cannot make
  a repeated macro layout count as novel.
- CI publishes the resolved matrix, aggregate metrics, bounded failures,
  diversity/similarity reports, screenshot manifest, performance percentiles,
  and payload percentiles within documented timeout/artifact limits.
- Reviewed fixed and previously unseen-seed galleries are attached to the
  version-2 enablement change.

#### BMG-31: Versioned shadow rollout

**Files**

- generation service/configuration
- `api/src/services/battle/encounterService.js`
- `api/src/services/battleRewardService.js`
- `api/src/services/guildmasterBattleService.js`
- `api/src/services/coliseum/matchLifecycle.js`
- `api/src/services/battle/BattleStateRepository.js`
- REST create/current/rejoin and WebSocket handshake/update protocol
- telemetry/diagnostic storage
- admin/developer preview surface if available
- rollout and rollback tests/docs

**Implementation**

- Generate version 2 in preview/shadow mode for a sampled set of new requests
  without changing active battles.
- Compare hard/tactical/quality metrics and timings with version 1.
- After BMG-22 and BMG-30 pass, connect each authoritative PvE, guild, and
  coliseum creation path to its normalized request, the V2 dispatcher, the one
  authoritative final-output gate, and `BattleStateRepository`. Atomically
  expose only the verified final map, mirror columns, revision zero, and initial
  mutable state; generation or persistence failure exposes no partial battle.
- Enforce the BMG-05 per-mode request/match idempotency keys so an ambiguous
  commit retry neither creates a second battle nor consumes a new random seed.
- Expose seed, version, recipe, attempt, and hashes in developer diagnostics.
- Emit metrics/alerts for generation failure/retry, schema or hash rejection,
  capability incompatibility, cached-map miss, oversized initial/rejoin map,
  oversized delta, state-revision gap/conflict, and dropped/failed WebSocket
  delivery, ACK exhaustion, heartbeat mismatch, and fresh-snapshot recovery.
- Enable version 2 for newly created battles by mode/biome behind a server
  flag. Existing battles remain on their stored version.
- Enforce the BMG-05 capability contract across create/current/rejoin and the
  WebSocket join/update flow. Cached/older clients that do not understand the
  required schema/hash/delta versions remain on version 1 when creating a new
  battle. If already assigned to a persisted V2 battle, they receive an
  explicit upgrade-required response; the server never regenerates/downgrades
  that battle or lets the client flatten V2 semantics.
- Roll out the immutable-map snapshot/reference-delta protocol behind a
  separately reversible flag and enforce deployment-specific compressed and
  uncompressed payload limits. Its first negotiated version sends the complete
  closed mutable projection rather than arbitrary sparse patches.
- Keep the version-1 generator until the retention window for persisted battles
  and rollback has passed.

**Acceptance**

- Shadow generation never mutates battle state.
- Rollback changes the default for new battles only and does not invalidate
  persisted version-2 battles.
- Service p95 is benchmarked in the deployment environment. Initial guardrail:
  no more than 2x the version-1 local p95 without an explicit performance review;
  replace this relative limit with an environment-specific SLO before default
  enablement.
- Each enabled mode passes rejoin, replay/recovery, and client/server parity
  tests.
- Each enabled mode also passes revisioned terminal-state tests: a completion
  atomically publishes status/winner/rewards/end time with its current database
  side effects, blocks later gameplay commands, and is safe to retry without
  duplicate awards or match results.
- PvE, guild, and coliseum creation is atomic and idempotent with the real V2
  finalizer: injected generation/transaction/ambiguous-commit failures leave no
  partial or duplicate battle and retry with the original seed and request
  identity.
- Mixed supported/unsupported client-version fixtures prove V2 is never served
  to a client that would ignore authoritative connections or blockers.
- Create/current/rejoin and WebSocket reconnect fixtures cover capability
  absence, supported V2, upgrade required, cached-map hit/miss, hash mismatch,
  unknown delta, ordered/duplicate/gapped/conflicting revisions, lost broadcast,
  heartbeat resync, map replacement, and rollback.
- Deployment dashboards and alerts prove initial/rejoin snapshots and mutable
  deltas remain within the approved byte/error-rate budgets before default
  enablement.

## Dependency Order

| Order | Work | Depends on | Can proceed in parallel with |
|---:|---|---|---|
| 1 | BMG-00 audit harness | none | BMG-04 fixture-corpus selection; BMG-21 inventory-only discovery |
| 2 | BMG-04 frozen V1 + dispatcher | BMG-00 baseline | none |
| 3 | BMG-01 traversal contract | BMG-04 | BMG-05 |
| 4 | BMG-05 V2 envelope/hashes/persistence protocol | BMG-04 | BMG-01 |
| 5 | BMG-06 spawn-layout contract | BMG-01, BMG-05 | BMG-02 metric helpers |
| 6 | BMG-02 validation/repair framework | BMG-00, BMG-01, BMG-05, BMG-06 | BMG-03 |
| 7 | BMG-03 V2 stage/recipe pipeline | BMG-04, BMG-05, BMG-06, early asset-capability inventory | BMG-02 |
| 8 | BMG-10 fields/elevation | BMG-03, BMG-06 | BMG-21 asset implementation |
| 9 | BMG-11 regions | BMG-10 | renderer fixture design |
| 10 | BMG-12 hydrology | BMG-10, BMG-11, BMG-06 | BMG-20 foundations |
| 11 | BMG-13 routes | BMG-01, BMG-10, BMG-12, BMG-06 | BMG-21 |
| 12 | BMG-14 actual spawn integration | BMG-06, BMG-10, BMG-13 | BMG-21 |
| 13 | BMG-15 blockers/decoration | BMG-11, BMG-13, BMG-14 | BMG-21 |
| 14 | BMG-16 variants/transitions | BMG-15 | BMG-21 asset work |
| 15 | BMG-20 renderer | BMG-05, BMG-16 | BMG-21 |
| 16 | BMG-21 assets | BMG-16 emitted transition kinds/masks | BMG-20 |
| 17 | BMG-22 authoritative final gate | BMG-02, BMG-14, BMG-15, BMG-16, BMG-21 | BMG-20 |
| 18 | BMG-30 corpus/gallery | BMG-20, BMG-21, BMG-22 | documentation |
| 19 | BMG-31 rollout and real mode integration | BMG-05, BMG-22, BMG-30 | none |

The two validation tasks are deliberately separated: BMG-02 creates the typed,
extensible framework early; BMG-22 becomes authoritative only after actual
spawns, blockers, connections, transitions, and asset keys exist. Likewise,
BMG-06 publishes spawn constraints before hydrology and routes; BMG-14 selects
and integrates actual positions after the landscape is known. Do not tune
hydrology, routes, or props against the legacy validator metrics.

BMG-05 deliberately proves schemas, repository semantics, transport, and
client hydration with injected final-map fixtures while real battle creation
continues to use V1. BMG-22 supplies the only V2 finalizer; BMG-31 is the first
task allowed to connect that finalizer to real PvE, guild, or coliseum creation.

BMG-21 has an intentionally early, read-only inventory checkpoint and a later
asset-implementation phase. The checkpoint publishes the machine-readable
current capability matrix consumed by BMG-03; it neither adds assets nor enables
V2. The ordered BMG-21 implementation row remains dependent on BMG-16's final
emitted transition-kind/mask set, all of which must already fit BMG-05's frozen
record schema. A recipe is enabled only after BMG-21 supplies every declared
capability and BMG-22 verifies exact no-fallback resolution, avoiding a circular
dependency between recipe declaration and asset production.

## Test Strategy

### Unit and contract tests

- Stable coordinate hash and named-stream isolation.
- Field scan-order invariance and finite ranges.
- Region component cleanup and feature identity.
- Priority-Flood sink handling, intentional basins, flow direction, and
  accumulation on small known grids.
- A* route cost, deterministic tie-breaking, curvature state, width/shoulders,
  and crossing selection.
- Reciprocal elevation connections and traversal costs.
- Suitability and minimum-distance sampling.
- Feasibility compilation, optional-feature degradation order, unsupported
  requests, and formation-capacity boundaries for each recipe/size profile.
- Quantization and lexicographic candidate-ranking vectors at every
  threshold-adjacent boundary.
- Transition masks and composition/precedence for every neighbor/overlap pattern
  used by the renderer.
- Exact recipe tile-palette plus obstacle/decoration catalog capability
  resolution with all V2 runtime fallbacks disabled.
- Decoration schema rejection of collision fields.
- Static rejection of direct production `battles` mutation SQL outside
  `BattleStateRepository` and migrations, plus exact enforcement of the named
  read-only analytics allowlist.

### Cross-layer fixtures

Use the same serialized fixtures in:

- shared traversal;
- validator;
- server movement/action processing;
- AI/landing/spawn selection;
- frontend reachability/path preview; and
- BattleGrid rendering.

Required fixtures include a blocking rock on grass, a `passable:true` gameplay
obstacle, a separate decoration record ignored by traversal, one-level ramp,
multi-level stair, ledge, cliff, bridge over water, narrow corridor, two-route
map, and an occupied destination. Initial hydration, current/rejoin,
WebSocket reconnect, cached-map hit/miss, and mutable-delta fixtures must carry
or verify every V2 layer and fail closed on capability, schema, map-hash, or
replacement errors. Revision fixtures cover ordered updates, duplicates, gaps,
reordering, same-revision conflicts, ACK retry exhaustion, a lost post-commit
broadcast, heartbeat mismatch, and fresh-snapshot recovery. Race the action, AI,
timer, disconnect/reconnect, debug, route, completion, and reward commands
against the same expected revision; exactly one conflicting successor may
commit, no path may change the immutable map, and terminal lifecycle
preconditions reject later gameplay. Inject failure and ambiguous retry at
every reward/coliseum completion step to prove battle terminal fields and
related database side effects commit once or roll back together.

### Determinism and compatibility

- Retain version-1 encounter seed and representative full-layer digests across
  every configured node/archetype plus supported-size edge fixtures.
- Add a version-2 canonical full-output digest per representative recipe.
- Add independent hashes for authoritative traversal state and visual-only
  state.
- Assert that visual stream/config changes preserve the traversal hash.
- Assert canonical key-order, numeric normalization, excluded-field, domain
  separation, and self-reference rules.
- Run the complete candidate/projection/canonical-byte/digest vectors in Node
  and every supported browser, including rejection of noncanonical digest
  encodings.
- Assert serialize/load/JSONB/current/rejoin/WebSocket round trips preserve
  hashes and reject conflicting database mirror columns.
- Test clean-schema migration, rollback, mixed V1/V2 rows, corrupt V2 state,
  idempotent retry after ambiguous creation, and injected failure before/after
  commit.

### Property and corpus checks

- All configured node types and every referenced archetype.
- Compact, standard, non-square, and larger supported dimensions.
- Edge seeds including `0`, signed/unsigned normalization boundaries, and
  repeated seeds.
- Every declared recipe × supported size/mode/capacity profile, plus stable
  preflight rejection for unsupported combinations.
- Every recipe × render palette × material × transition
  kind/direction/level capability and every declared obstacle/decoration key
  with fallback disabled.
- Every hard invariant above.
- Recipe-specific tactical, topology, hydrology, ecology, route-shape, and
  multiscale quality distributions, not only single examples.
- Cross-seed macro-signature collisions, identity-excluding near-neighbor
  similarity, and feature-distribution coverage for every recipe/size profile.
- Timings and bounded-attempt counts to detect retry explosions.

### Visual validation

For each fixed gallery map, review:

1. recognizable macro silhouette at fit-to-screen zoom;
2. landform/water/path/vegetation causal agreement;
3. no rectangular spawn-clearing seam;
4. no salt-and-pepper terrain or variants;
5. clear shore, cliff, ramp, stair, and bridge transitions;
6. readable traversable routes and blockers;
7. correct isometric anchors, seams, alpha, and painter ordering; and
8. declared overlap composition for shore + route, route + slope, cliff +
   wetness, and decoration + prop at every direction;
9. plausible channel scale/outlets and routes without grid-parallel gutters or
   repetitive right-angle turns;
10. feature-owned ecological clustering/voids rather than uniform prop scatter;
    and
11. distinct recipe identity without sacrificing tactical requirements.

Quantitative checks catch known artifacts; the gallery remains the acceptance
mechanism for composition and naturalness.

## Performance and Payload Guardrails

- Allocate scalar grids in typed arrays internally where it simplifies repeated
  field/flow work; convert only at the public boundary if JSON arrays remain
  required.
- Reuse priority queues for A*, drainage, and validation rather than repeatedly
  sorting arrays.
- Bound candidate attempts and record the selected attempt plus rejection
  reasons.
- Cache derived masks such as distance-to-blocker and distance-to-water within a
  candidate.
- Avoid serializing full continuous working fields into ordinary battle state.
  Persist semantic outputs and compact feature diagnostics; retain full fields
  only in explicit debug/audit output.
- Establish separate per-profile hard limits for canonical persisted-map bytes,
  initial/rejoin compressed and uncompressed bytes, mutable-delta compressed and
  uncompressed bytes, and retained audit-sidecar bytes. Record p50/p95/p99 and
  rejection counts in CI/shadow telemetry.
- Send the immutable final map once on initial hydration/rejoin or cache miss;
  subsequent WebSocket updates carry mutable battle state plus the verified map
  reference and exact base/successor state revisions. Instrument accidental
  full-map retransmission as a protocol error.
- Transition/decor layers should use compact records or masks rather than large
  redundant objects per empty tile. Cap diagnostic collections and rejection
  samples deterministically.
- Any density/optional-feature reduction needed to meet a size budget must be a
  declared feasibility-profile degradation applied before the candidate gate.
  Never truncate or omit hashed fields to fit a wire budget; transport
  compression may not change the decoded schema. Reject an oversized final map
  explicitly.
- Benchmark generation time, peak working memory, selected-attempt count,
  canonicalization/hash time, render hydration, and reconnect latency by
  supported size/recipe profile. Replace rollout's relative p95 guardrail with
  deployment-specific SLOs before default enablement.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Version-2 work accidentally changes version-1 maps | Land the isolated dispatcher first; keep immutable V1 multi-node/seed/size digest fixtures and put all behavior-changing code under the V2 boundary. |
| Correct obstacle traversal changes a historic V1 battle with inconsistent terrain/obstacle state | Run the BMG-01 persisted/generated-state parity audit; decide migration or compatibility treatment explicitly before release. |
| Validator constraints overfit current recipes or make retries unbounded | Separate hard/tactical/soft classes, use bounded attempts, record rejection distributions, and tune per recipe. |
| Compact maps cannot fit a recipe's formations and required features | Compile dimension/mode/capacity feasibility before seed consumption; apply only declared optional degradation and reject unsupported requests immediately. |
| New collision contract changes abilities or AI unexpectedly | Cross-layer traversal fixtures and explicit movement policies before generator changes. |
| Hydrology makes attractive but unplayable maps | Reserve anchors, plan crossings, route after drainage, and enforce authoritative final traversal. |
| Hydrology or routes are valid but look grid-aligned/mechanical | Scale features by map profile and gate axis runs, width jumps, sinuosity, turn density, and deterministic gallery examples. |
| Organic cleanup homogenizes all biomes | Keep recipe-specific field spectra, processes, and quality bands; gallery review compares identity. |
| Different seeds collapse to a few cosmetically varied layouts | Gate identity-excluding macro signatures, near-neighbor similarity, and feature-distribution coverage per recipe/size; review an unseen-seed holdout gallery. |
| Floating-point boundaries choose different candidates/topology | Quantize every discrete decision and rank candidates with fixed integer/lexicographic keys; run threshold vectors across supported generator/canonicalizer runtimes. |
| Transition assets grow combinatorially or overlap incorrectly | Use directional masks, composable overlays, one precedence table, exact capability inventory, and overlap screenshot fixtures. |
| Asset-loader fallback conceals a missing recipe capability | Compile an explicit recipe-palette matrix and disable fallback during V2 final validation; do not enable an incomplete recipe. |
| Decoration increases payload/draw cost | Separate budgets, compact records, viewport culling, and a density quality setting with no gameplay effect. |
| Improved output costs more CPU | Benchmark every wave, use bounded attempts/priority queues/typed grids, and shadow-test deployment p95. |
| Old persisted state lacks new layers | Allow defaults only in the V1 adapter; treat absent required V2 layers as corruption and cover both with load tests. |
| JSON/JSONB serialization changes hash bytes | Hash the specified canonical projections, not storage bytes, and verify JSONB round trips plus mirror-column equality. |
| Cached clients ignore V2 connections or layers | Gate assignment on an explicit client schema capability; keep unsupported clients on V1 or require a compatible update. |
| A later generator or renderer task silently changes a nested V2 record after the envelope is frozen | Freeze the complete recursive schema and representative all-record fixture in BMG-05; require a new map-schema version, negotiation, hash vectors, and migration/coexistence tests for every structural change. |
| Full-state WebSocket updates repeatedly resend the enlarged map | Use the initial/rejoin snapshot plus verified map-reference/closed-mutable-state protocol, cache-miss recovery, byte limits, and retransmission telemetry. |
| Lost, duplicated, or reordered deltas corrupt mutable client state | Persist monotonic state revisions, apply only to an exact base revision, ignore proven duplicates, and fetch a snapshot on gaps or conflicts. |
| A commit succeeds but its live update is lost or built from stale memory | Broadcast only after commit through ACK/retry, read a fresh repository snapshot on exhaustion, and detect silent gaps through join/rejoin plus revision heartbeats. |
| A legacy direct SQL writer bypasses revision checks, overwrites immutable map layers, or changes lifecycle/rewards without a revision | Route every production `battles` mutation and live-state read through one repository, strictly allowlist analytics reads, and race every action/timer/completion/reward writer under lifecycle-aware compare-and-swap fixtures. |
| Creation retry exposes partial or duplicate battle state | Generate before exposure, then atomically persist final map and initial state under a mode-specific idempotency key; test ambiguous commits and rollback. |

## Research Basis and Limits

The proposed techniques use established building blocks:

- Ken Perlin's improved noise reference demonstrates coordinate-based gradient
  noise with fade/interpolation; version 2 uses that general principle to sample
  one coherent field rather than reseeding every tile:
  <https://mrl.cs.nyu.edu/~perlin/noise/>.
- Robert Bridson's fast Poisson-disk method generates samples with a configured
  minimum separation and expected linear work for fixed candidate count. It is
  suitable for deterministic prop spacing after seeded tie-breaking:
  <https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf>.
- Barnes, Lehman, and Mulla's Priority-Flood work provides depression filling
  and flow/watershed variants for gridded elevation models. The paper supports
  the drainage-conditioning recommendation, not a claim that game maps must
  reproduce real geomorphology:
  <https://richard.science/sci/2014_depressions.pdf>.
- Hart, Nilsson, and Raphael establish A* for minimum-cost paths. Slope,
  crossing, roughness, and heading terms in this plan are game-specific cost
  design layered on that search, not claims from the original paper:
  <https://ai.stanford.edu/~nilsson/OnlinePubs-Nils/PublishedPapers/astar.pdf>.

These methods improve spatial coherence and causal relationships. They do not
by themselves guarantee attractive maps. Recipe design, asset transitions,
tactical constraints, deterministic galleries, and human visual review remain
required.

## Validation Record

### Historical-baseline validation

The findings that motivated the architecture were checked using direct tracing
from every authoritative generation entry point through persistence, reload,
traversal, and rendering; focused and supplemental tests; independent 2D and
3D blocking-obstacle reproductions; a 1,600-map V1 final-validator corpus;
inspection of every configured archetype, style profile, algorithm dispatcher,
PRNG stream, obstacle pass, elevation implementation, validator repair path,
and renderer/asset fallback; and primary references for the recommended
landscape algorithms. The historical 1,598/1,600 invalid result belongs only to
the frozen V1 audit baseline and is retained as evidence for the fail-closed V2
acceptance architecture.

### Post-implementation verification

The current worktree was then validated independently of that historical
baseline:

1. The complete shared suite passes 786/786 and the frontend suite passes
   343/343, including traversal, V1 compatibility, closed V2 schema/hashing,
   generation, renderer hydration, exact assets, movement animation, capability
   negotiation, cache/revision recovery, and Merchant Caravan regressions.
2. The audit-harness suite passes 13/13. A fresh public-dispatcher V2 corpus at
   `artifacts/battle-map-audit-final-verified/` generated all 1,600 maps
   (16 recipes × 100 seeds, 32x32 PvE) with zero generation, hard, tactical,
   quality, guardrail, diversity, corpus-gate, required-stage, or exact-full-hash
   failures.
3. Every recipe produced 100 distinct macro signatures. Cross-recipe exact and
   near-duplicate counts were both zero. The swamp route distribution retained
   occasional direct routes without collapsing into mechanical layouts:
   5/100 eligible maps were straight, below the 10% ceiling.
4. Corpus generation measured 623.42 ms p50, 992.12 ms p95, and 1,407.51 ms
   maximum on this development host. Serialized map payloads measured 379,431
   bytes p50, 483,965 bytes p95, and 562,681 bytes maximum, all below the
   declared local guardrails. These are local observations, not production
   capacity SLOs.
5. The browser gallery rendered 32 maps through the production
   `BattleMapAdapter`, `AssetLoader`, and `BattleGrid`: all 16 recipes at fixed
   seed 0 and unseen holdout seed 997. Manual review of both contact sheets found
   no blank tiles, missing exact assets, fallback substitutions, layer-order
   failures, or repeated fixed/holdout layouts. Natural recipes show coherent
   multiscale regions, terrain-linked water and elevation, non-uniform ecology,
   and readable non-gridlike routes; constructed recipes retain deliberate
   geometry. Some constructed palettes remain intentionally sparse or reuse
   props, which is a future content-expansion opportunity rather than an
   architecture failure.
6. The API unit suite passes 3,654/3,654, including migration and operational
   contract coverage, and the local database reports all 56 migrations applied.
   A focused integration selection for runtime health/readiness, battle
   start/current/reconnect/WebSocket flows, participant access, movement,
   terminal-effect idempotency, and the reported runtime failures passes
   199/199 with live local smoke evidence.
   The broader API integration command is not currently repository-green:
   797 tests pass, 24 fail, 30 are cancelled, and 4 are skipped. Those failures
   are confined to unrelated admin-asset, manual-character, feedback,
   inventory/marketplace, registration, and skills fixture drift; this plan
   therefore does not present the broad integration suite as V2 acceptance
   evidence.
7. Independent architecture, organic-design, operational-security, runtime, and
   renderer reviews found no remaining material implementation contradiction
   after their findings were corrected.

### Claim classification

| Claim type | Status |
|---|---|
| Historical call paths and defects recorded against the two immutable baselines | Confirmed directly in the corresponding source; not descriptions of the implemented V2 worktree |
| Historical V1 final-validator corpus has 1,598/1,600 invalid results | Reproduced and interpreted as a validator/generator contract failure, not as 1,598 proven-unplayable maps |
| Current V2 corpus passes 1,600/1,600 with zero required or distribution-gate failures | Reproduced from the public dispatcher; artifacts retained |
| Shared coherent fields, drainage, landscape-aware routes, ecology, and correlated visual layers produce more causal naturalness | Implemented, quantitatively gated, and manually reviewed across fixed plus unseen-seed production-renderer galleries |
| Proposed numerical quality thresholds | Operational engineering guardrails validated by the current corpus; retain telemetry and recalibrate only from reviewed production distributions |
| Work-plan dependencies, V1 isolation, V2 candidate/final hashing, recipe feasibility, exact asset coverage, repository ownership, and wire/persistence boundaries | Implemented, structurally checked, tested, and independently reviewed |

## Definition of Done

### Local architecture completion

The implementation is locally complete because:

- all Wave 0 correctness contracts are implemented and cross-layer tests pass;
- BMG-05 freezes the complete recursive candidate/final schema and
  all-record fixture, later stages populate it without structural drift, and
  every structural extension uses an explicit new map-schema version;
- version 2 produces coherent landscape fields, height-driven features,
  landscape-aware routes, ecology-aware blockers, correlated variants, and
  separate decoration;
- every enabled recipe/size/mode/capacity combination passes feasibility
  preflight and exact no-fallback asset-capability validation;
- required-region, usable-area, detour, choke/dead-end, route-shape, hydrology,
  ecology, and competitive-parity gates pass their recipe-specific bands;
- the renderer visibly supports the resulting slopes, banks, shores, paths, and
  decorations—including declared overlap compositions—under the existing
  isometric contract;
- every version-2 PR/nightly corpus map satisfies hard invariants, with bounded
  attempts and no required-stage failures;
- cross-seed macro-signature, near-duplicate, and feature-distribution gates
  pass for each recipe/size, and fixed plus unseen-seed galleries are reviewed;
- all authoritative battle modes atomically persist/reload the same versioned
  map and pass idempotent failure/retry coverage;
- one repository owns every production `battles` mutation and authoritative
  live-state read, preserves immutable map hashes, revision-controls lifecycle
  and reward fields, and passes static-boundary plus concurrent
  action/timer/completion/reward tests;
- terminal PvE and coliseum commands atomically commit their battle envelope
  and related database effects, are idempotent across ambiguous retries, and
  prevent any later gameplay mutation;
- initial/current/rejoin/WebSocket paths negotiate V2 capability, hydrate every
  layer, verify immutable-map hashes, enforce state revisions, recover cache
  misses/gaps/lost broadcasts through ACK and heartbeat resync, and never
  regenerate maps locally. Full snapshots are the bounded default and recovery
  fallback; negotiated compatible clients use immutable-map references and
  closed mutable-state updates without full-map retransmission only when
  `BATTLE_MAP_REFERENCE_DELTA_ENABLED=true`;
- version-1 compatibility fixtures remain green; and
- shadow generation, active-V2 SLO evaluation, protected reproduction
  diagnostics, memory/wire guardrails, per-mode activation, and independent
  generation/reference kill switches are implemented and tested.

### Production activation gates

Local completion does not assert that V2 has already been enabled in a deployed
environment. Before production activation, operators must:

- apply migrations 052-056 in that environment and confirm database plus
  terminal-outbox readiness;
- collect representative shadow-generation, peak-memory, payload, reconnect,
  and wire-compression distributions under deployed capacity;
- set and pass an explicit active-V2 generation p95 SLO rather than relying on
  the initial relative V2/V1 observation guardrail;
- obtain stakeholder approval of fixed and unseen-seed galleries from the
  deployed asset/build revision;
- smoke-test creation, current-state fetch, reconnect, terminal effects,
  cache-miss recovery, and rollback for each authoritative mode;
- before enabling reference/delta delivery, confirm the target client population
  advertises the revisioned mutable-state protocol and verify that unsupported
  clients continue to receive bounded full snapshots;
- exercise the configuration rollback while retaining the V2-capable reader for
  already-persisted maps; and
- enable only new battles, one authoritative mode at a time, following
  `docs/DEPLOYMENT.md`.
