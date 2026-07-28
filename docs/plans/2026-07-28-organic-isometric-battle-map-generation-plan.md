# Organic Isometric Battle Map Generation Audit and Implementation Plan

**Date:** 2026-07-28

**Source baseline:** `dc8c40b2b3349c6b7da8f815dc33fbf0305ada10`

**Status:** Proposed; implementation has not started

**Validated:** 2026-07-28 against the production generation path, battle persistence and movement call sites, renderer, focused tests, and a 1,600-map diagnostic corpus

**Scope:** Tactical battle-map generation, authoritative traversal, elevation, hydrology, paths, props, visual variation, isometric rendering, persistence, testing, and rollout

**Related:** [Isometric Tile System](../ISOMETRIC_TILE_SYSTEM.md), [Battle Asset Generation Design](./2026-01-30-battle-asset-generation-design.md), [Isometric Tile Projection Design](./2026-01-28-isometric-tile-projection-design.md)

## Executive Outcome

The existing generator has a sound deterministic foundation, a useful archetype
catalog, a versioned PvE seed contract, and an exact isometric asset contract.
It does not yet produce consistently natural landscapes because its major
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
  the production map contract does not carry or draw it.

The recommended change is a versioned `BattleMapV2` pipeline. It should build
continuous, correlated landscape fields first; derive elevation, drainage,
regions, routes, ecology, and semantic terrain from those fields; validate the
same traversal contract used by the server and client; derive transition and
decoration layers; then freeze and persist the complete result. Existing
version-1 battle maps and their deterministic digest must remain unchanged.

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

## Confirmed Current Contracts

These contracts constrain the design and should be preserved deliberately:

| Contract | Current evidence | Required treatment |
|---|---|---|
| Public size | `generateTerrain()` accepts integer dimensions at least 10; arenas require at least 11x16 (`shared/mapGeneration.js:69-97`). | Keep explicit validation and add corpus coverage for compact and non-square maps. Remove algorithm-local 32x32 assumptions. |
| PvE determinism | `generateEncounterTerrain()` derives a seed from `localSeed`, `nodeType`, and `terrainGenerationVersion`; production currently uses version 1 (`api/src/services/battle/encounterService.js:140-158`). | Preserve the version-1 digest. Introduce version 2 explicitly rather than changing version-1 output in place. |
| Battle persistence | PvE state stores dimensions, seed, version, terrain, elevation, elevation format, obstacles, and variants (`api/src/routes/battle.js:322-370`). | Add new version-2 layers to persisted state and use persisted state on rejoin. Never regenerate a live battle implicitly. |
| Terrain projection | The renderer uses a 2:1 diamond and owns projection, elevation offset, visible wall faces, depth ordering, and hit testing. | Do not bake projection, shadows, or incompatible edges into generation data or assets. |
| Tile assets | `iso64-retina-v3` uses 128x128 floor/slope sources drawn into 64x64 logical boxes with a 64x32 visible diamond. Variant edges must agree. | Transition/slope assets must be added through the manifest/compiler and pass `npm run tiles:check`. |
| Elevation format | Public generated elevation is normalized and discretized by shared terrain helpers. | Version 2 must declare its elevation format, range, and conversion once. Do not let integer levels be misread as normalized values. |
| Spawn safety | Player and enemy formations require obstacle-free, traversable tiles; arena formations have additional protected rectangles. | Replace duplicated hard-coded widths with one shared spawn-layout contract. Preserve guaranteed capacity. |

## Current Production Process

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
- `api/src/routes/battle.js:322-370` for authoritative PvE persistence; and
- `frontend/src/battle/BattleGrid.js:722-815,923-990` for painter ordering and
  terrain/elevation rendering.

Other battle modes do not use the same complete versioned contract:

- Coliseum generation calls `generateTerrain()` directly with a random match
  seed in `api/src/services/coliseum/matchLifecycle.js`.
- Guildmaster battles call `generateTerrain()` directly with a time-derived
  seed in `api/src/services/guildmasterBattleService.js`.
- `BattleScene` can create a local fallback map before applying persisted
  server state. That fallback must remain presentation-only.

## What Is Already Worth Keeping

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

## Audit Findings

### Confirmed Correctness Defects

| Priority | Finding | Evidence | Resolution |
|---|---|---|---|
| Critical | Blocking obstacles are absent from the shared pathfinding contract. | `getReachableTiles()` and `calculatePathCost()` accept terrain and units but no obstacle grid (`shared/pathfinding.js:31-92,109-176`). A `passable:false` rock placed on grass is returned as reachable at cost 1. The server delegates to these functions, while `BattleGrid.isWalkable()` checks terrain only. | Introduce one object-based traversal view consumed by generation, validator, server, client, AI, and spawn placement. It must combine terrain, obstacles, elevation, connections, and units without duplicating collision state. |
| Critical | Validation is diagnostic, not an acceptance gate. | `generateWithArchetypes()` uses the returned metrics but never checks `validationResult.valid` (`shared/mapGeneration.js:444-453,514-524`). A fresh final validation of seeds 0-99 across all 16 configured node types found invalid output for 1,598 of 1,600 maps. | Separate hard correctness from soft quality, repair deterministically, retry candidates, and fail closed when no hard-valid map is available. Persist the final result and violations in diagnostics. |
| High | The final map is mutated after validation. | Spawn clearing is run before validation and again afterward (`shared/mapGeneration.js:441,465`). Profile elevation is created before repairs; fallback elevation is created after repairs. | Complete every authoritative mutation, including spawn integration and elevation reconciliation, before a final read-only validation and freeze. |
| High | Rolling elevation does not sample one coherent seeded field. | `_noiseAt()` draws a new `seedOffset` on every tile call (`shared/mapgen/AlgorithmPipeline.js:553-577`), so neighboring cells interpolate different hash fields. The declared elevation stream is not used; the terrain stream is used instead (`AlgorithmPipeline.js:810`). | Construct each field/noise instance once per map from the elevation stream and sample it by coordinate. Refactor the useful parts of `ElevationMapper` into the active pipeline. |
| High | Configured algorithm cooperation is inert. | Archetypes declare `outputSeedRegions` and `seedFromPrevious` (`shared/mapgen/archetypes/archetypeDefinitions.js:188-195`), and algorithms implement enhanced seed-region methods, but `runArchetype()` always invokes `instance.apply()` (`AlgorithmPipeline.js:884,934`). | Define one stage interface and make the dispatcher explicitly publish/consume named context outputs. Add contract tests for every configured stage capability. |
| High | Algorithm results and failures do not control generation. | Return values from room/path algorithms are discarded, required-stage exceptions are caught, recorded, and generation continues (`AlgorithmPipeline.js:858-946`). Context room/path counts can therefore remain zero without rejecting the map. | Required-stage errors and missing declared outputs invalidate the candidate. Optional-stage failure may be recorded only when the recipe explicitly permits omission. |
| High | Validator metrics do not measure their names reliably. | “Approach paths” count vertical runs through the center column; “minimum passage width” scans vertical runs, and the repair switch has no cases for `walkableTooHigh` or `insufficientPaths` (`ConstraintValidator.js:459-545`). Low-severity violations still make `valid` false but are never repaired. | Replace them with traversal-graph metrics: vertex-capacitated route diversity and clearance/distance-to-blocker along required routes. Split hard validity from recipe quality scoring. |
| Medium | Some algorithms embed 32x32 formation assumptions. | `ClusterPlacer` hard-codes left spawn end 5 and right spawn start 27 (`shared/mapgen/algorithms/ClusterPlacer.js:96-99`); validator spawn probes and repair corridors use separate midpoint/margin assumptions. | Pass a shared protected-zone mask and anchors through context. No algorithm may infer spawn geometry from magic columns. |
| Medium | Versioning is inconsistent across battle modes. | PvE has a persisted versioned contract; coliseum and guildmaster entry points generate directly, and frontend fallback generation can run locally. | Route every authoritative mode through a common versioned map service. Persist random match seeds before generation. Keep client generation non-authoritative. |

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
| Medium | Two configuration systems can drift. | Archetypes drive production stage sequences; `nodeTypeAlgorithms.js` still defines algorithm pools and helpers that `runArchetype()` does not consume. Unknown-node defaults also differ between selectors. | Make one recipe registry authoritative. Retain node configuration only for data it actually owns, such as biome obstacle catalogs, until migrated. |
| Medium | Renderer support stops short of the generated elevation model. | `AssetLoader.getSlopeSprite()` exists, but `BattleGrid` draws floor tops and exposed vertical faces without slope/stair selection. Elevation connections are neither persisted nor supplied by the client pathfinder. | Persist connections and transition masks, render slope/bank/cliff overlays in the shared depth queue, and supply the same connections to client/server traversal. |
| Low | Header comments and phase names describe removed or unused systems. | The main module still advertises tactical cover and style integration beyond what production executes. | Update documentation as each stage is replaced; delete dead helpers once version 1 is isolated. |

## Reproduced Baseline

### Focused regression suites

The following command passed **120 tests, 0 failures** on the source baseline:

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

### Blocking-obstacle reproduction

For a 3x3 grass grid with `{ passable: false }` at `(1,1)`, starting from
`(0,1)` with movement range 1:

```json
{
  "reachableTarget": { "x": 1, "y": 1, "cost": 1 },
  "pathCost": 1
}
```

This is a contract defect even though generated blocking props currently
rewrite their terrain tile to an impassable semantic type. Independently loaded,
migrated, edited, or future obstacle state can violate that incidental coupling,
and the validator already treats the obstacle object itself as authoritative.

### Final-validation corpus

The audit generated 32x32 maps with `{ includeMetadata: true }`, then constructed
a fresh `ConstraintValidator` from each emitted recipe constraint and validated
the final public terrain/obstacle arrays. Seeds were `0..99`.

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
  terrainGenerationVersion: 2,
  terrainSeed,
  mapWidth,
  mapHeight,
  nodeType,
  biome,
  archetype,
  elevationFormat: 'normalized-v2',

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

The object shown above is the persisted/wire `BattleMapV2Final` schema. Define
two explicit validation schemas rather than treating hashing as an in-place
exception:

- `BattleMapV2Candidate` contains every field shown above except
  `diagnostics.hashes`; `diagnostics.hashVersion` is already required;
- `BattleMapV2Final` is a candidate plus exactly the three required,
  correctly formatted hashes.

The pre-hash gate accepts only a candidate. Hash attachment is the sole mutation
permitted after that gate. A second gate validates the final schema and
independently recomputes all three projections before the value is frozen and
persisted. No API, adapter, cache, or database path may accept
`BattleMapV2Candidate`.

These names deliberately match the existing battle-state fields. During the
initial rollout, `BattleMapV2` is an internal value object mapped by one
`BattleMapAdapter` to and from the existing flattened `battle_state`/wire
representation; it is not a second independently editable nested copy. The
database columns `map_seed`, `map_width`, and `map_height` remain indexed
envelope mirrors. Writes must update the JSON state and mirror columns
atomically, and reads must validate equality rather than guessing which copy is
newer. The existing top-level response field `mapSeed` may remain as a
compatibility alias derived from `terrainSeed`/`map_seed`; it is never another
stored or hashed map field. A missing `terrainGenerationVersion` means version
1. Only the version-1 load adapter may synthesize absent new layers; an
authoritative version-2 map must contain every required layer, including a flat
elevation grid when its recipe has no relief.

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

### Canonical serialization and hashes

Hashing applies to the `BattleMapV2` value object, not the enclosing mutable
battle state. Record `hashVersion: "sha256-cjson-v1"` and define canonical JSON
as UTF-8 JSON with lexicographically sorted object keys, semantic array order,
finite numbers only, `-0` normalized to `0`, and a single stable shortest
round-trip decimal representation. Reject `undefined`, non-finite numbers, and
unsupported values rather than silently dropping them.

Use domain-separated SHA-256 projections:

- `authoritativeHash` covers version/request identity, terrain, elevation,
  connections, gameplay obstacles, authoritative feature records, and the
  generated spawn layout/initial assignments—not mutable in-battle unit state;
- `visualHash` covers variants, transitions, and decorations; and
- `fullHash` covers the complete persisted map plus diagnostics except timings,
  environment data, and `diagnostics.hashes` itself.

The domain prefixes are respectively
`battle-map-authoritative-v2\0`, `battle-map-visual-v2\0`, and
`battle-map-full-v2\0`. Excluding the hashes record from the full projection
prevents self-reference. JSONB may reorder object keys; re-canonicalizing a
loaded value must reproduce the same hashes.

## Target Generation Flow

```text
normalized versioned request
  -> version dispatcher (frozen legacy branch for version 1)
  -> authoritative biome recipe + resolved style parameters
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
15. Every referenced terrain, obstacle, decoration, slope, and transition asset
    resolves through the runtime catalog and passes the tile contract.
16. Rejoin/reload uses the persisted map and never silently regenerates it with
    a different version.

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
4. select sources and thresholds appropriate to map scale;
5. widen the centerline according to accumulation and recipe;
6. derive bank, wetness, mud/reed, and crossing masks from distance to water;
7. reserve valid crossings before route planning; and
8. revalidate downstream continuity after terrain edits.

Swamps should use low relief, multiple shallow accumulation areas, broad wetness
bands, and sparse channels. Mountains should favor incised runoff and narrow
streams. Volcanoes can reuse the directed-flow abstraction for lava only with a
separate material/behavior recipe; they should not inherit water movement or
asset semantics accidentally.

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
contract or use renderer-owned face geometry.

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

**Implementation**

- Accept versions, node types, seed range/list, dimensions, and output directory.
- Emit machine-readable per-map hard/tactical/quality metrics, stage results,
  hashes, timings, and aggregate percentiles.
- Optionally emit deterministic render fixtures/gallery manifests without
  requiring a browser for the metric-only mode.
- Check for non-finite/ragged grids, unknown assets, stage failures, final
  mutations, and stream-isolation violations.
- Record environment and generator version with results.

**Acceptance**

- Reproduces the 16-type, seeds `0..99`, 32x32 baseline above.
- Two identical runs produce identical data apart from explicitly excluded
  timing/environment fields.
- CI can run a 1,600-map PR corpus; a larger seeded corpus can run nightly.

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
  source commit recorded at the top of this document before refactoring; do not
  regenerate expected values from the refactored branch.
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
- server AI/landing/path call sites found during implementation
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

#### BMG-05: Define the V2 envelope, canonical hashes, and mode persistence

**Files**

- add `BattleMapV2Candidate`/`BattleMapV2Final` schemas, `BattleMapAdapter`,
  canonical serializer, and hash helpers under shared code
- `api/src/services/battle/encounterService.js`
- `api/src/routes/battle.js`
- `api/src/services/coliseum/matchLifecycle.js`
- `api/src/services/guildmasterBattleService.js`
- battle-state serializers/mergers and `frontend/src/battle/BattleScene.js`
- schema, JSONB round-trip, persistence, rejoin, and version tests

**Implementation**

- Implement the exact field names, required layers, and flat-state adapter
  described in the target contract. Do not introduce competing aliases such as
  `generationVersion`, `seed`, `width`, or `height`.
- Define and enforce separate `BattleMapV2Candidate` and `BattleMapV2Final`
  schemas. The candidate omits only `diagnostics.hashes`; only the final schema
  is legal at persistence, cache, and wire boundaries.
- Implement `sha256-cjson-v1`, its three domain-separated projections, numeric
  normalization, excluded fields, and rejection rules exactly once.
- Give every authoritative mode a normalized map request and persist its seed
  and version before the map is used.
- Persist version-2 connections, transitions, decorations, stable feature
  identity, diagnostics, and hashes through the adapter.
- Send the complete `BattleMapV2Final`, including feature records, over the
  initial version-2 wire contract so the receiver can independently recompute
  every hash. No unversioned response projection may silently omit hashed data.
- Validate the `map_seed`/`map_width`/`map_height` mirrors against flattened JSON
  state on write and load. Reject or quarantine conflicts; never choose by
  precedence.
- Let only the version-1 adapter supply absent-layer defaults. A version-2
  missing layer, missing flat elevation grid, or hash mismatch is corruption.
- Never let a client fallback overwrite or substitute for persisted server map
  state.

**Acceptance**

- Canonicalization is invariant to object-key insertion order and JSONB
  key reordering, while semantic array reordering changes the appropriate hash.
- A candidate passes its schema without hashes but is rejected by every
  adapter/persistence/wire boundary; a final value is rejected unless it has
  exactly three correctly formatted hashes whose independent recomputation
  matches.
- Serialize/load/rejoin and database JSONB round trips reproduce all three
  hashes and byte-equivalent authoritative layers.
- A version-2 wire round trip retains the complete feature records and permits
  independent recomputation of every hash.
- The full hash cannot reference itself, and changes to excluded timing or
  environment fields do not change it.
- New PvE, guild, and coliseum battles persist a seed and version before use.
- A version-1 fixture still loads/renders; a version-2 fixture with an absent
  required layer or conflicting database mirror is rejected.

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
- Move maximum walkable ratio and similar style preferences to recipe quality
  unless a specific mode declares them tactical requirements.
- Express repair as typed edits that declare and update dependent layers.
- Add bounded attempt seeds derived from `(terrainSeed,
  terrainGenerationVersion, attempt)` and stable candidate ranking.

**Acceptance**

- Hard, tactical, and soft results cannot be conflated by the API or recipe
  schema.
- Known graph fixtures report the expected disjoint-route count and clearance.
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
  consistently, record them, and establish one unknown-node policy.
- Migrate unique live configuration into one V2 registry; leave legacy
  `algorithmPool` and dispatcher behavior frozen until version 1 retires.

**Acceptance**

- A forest/cave fixture proves a macro stage publishes regions and the next
  stage consumes the same IDs.
- Room/path stage fixtures populate context counts and geometry.
- Every V2 production recipe passes an interface/config schema test.
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
- Produce continuous working height and declared normalized/discrete outputs.
- Smooth/terrace according to recipe without changing protected cores.
- Generate reciprocal connection candidates from height differences and
  protected-layout requirements for BMG-13 to select/reconcile; do not create
  random ramps merely to satisfy a count.

**Acceptance**

- Neighbor sampling is independent of scan order and unrelated stream draws.
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
- Add recipe water/lava parameters, feature schemas, and property tests.
- Integrate with fields, routes, terrain classification, and transitions.

**Implementation**

- Implement deterministic Priority-Flood conditioning and flow
  direction/accumulation.
- Represent intentional closed basins separately from accidental sinks.
- Derive feature width, bank, moisture, and crossing candidate masks.
- Protect formations and required structure footprints.
- Use a separate directed-flow recipe for lava material and rules.

**Acceptance**

- Every non-basin water/lava centerline has a valid downstream chain to its
  declared outlet.
- No feature enters a protected core.
- Banks and wetness masks are derived from the same feature boundary.
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

**Acceptance**

- Every declared route connects its anchors under authoritative traversal.
- A* results match a Dijkstra cost oracle on deterministic small-grid/property
  fixtures for every enabled cost term.
- Centerlines contain no immediate backtracking or avoidable one-tile
  left-right zigzags.
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
- Extend shared map schema, runtime catalog, and serialization for
  `decorations`; renderer work remains in BMG-20.
- Add traversal-isolation and distribution tests.

**Implementation**

- Place feature-owned blocker clusters from suitability masks.
- Use deterministic Poisson-disk or equivalent spatial indexing for minimum
  distances within a feature.
- Align grove/outcrop semantic terrain, blocker kind, and assets.
- Keep substrate and prop collision independent: a blocking prop must not rewrite
  otherwise walkable base terrain solely to duplicate its collision.
- Add a separate decoration schema with no `passable` or collision field.
- Apply independent per-biome budgets and culling rules.

**Acceptance**

- Blockers never overlap protected cores, required centerlines, connections, or
  invalid substrate.
- Minimum spacing and recipe coverage bands hold across the corpus.
- Removing a blocker exposes the unchanged substrate and changes traversal only
  through removal of that obstacle.
- Changing only decoration parameters leaves the authoritative traversal hash
  and all unit positions unchanged.

#### BMG-16: Generate correlated variants and transition masks

**Files**

- Add V2 transition/variant helpers and schemas without changing legacy
  `createInitialVariants()`.
- Update runtime asset catalogs and tests.

**Implementation**

- Use coordinate hashes and continuous/material/feature inputs instead of
  scan-order random draws.
- Calculate canonical directional masks after all semantic edits.
- Keep variants within available counts for the resolved biome/material.
- Produce composable route, shore, cliff, slope, and environment overlays.

**Acceptance**

- Reordering iteration does not change variants.
- Natural recipes keep accidental isolated variant tiles below 10% while no
  single variant occupies more than its configured maximum.
- Every transition mask matches its final neighbors and maps to a registered
  transition kind/catalog key. BMG-21 supplies assets and BMG-22 enforces final
  strict resolution.

### Wave 2 — Render the Landscape Model

#### BMG-20: Draw connections, transitions, and decorations

**Files**

- `frontend/src/battle/BattleGrid.js`
- `frontend/src/battle/BattlePathfinding.js`
- `frontend/src/battle/AssetLoader.js`
- battle-state merge/load code
- renderer tests and deterministic screenshots

**Implementation**

- Select slope/stair sprites from persisted reciprocal connections.
- Draw shore/bank/path/cliff overlays from transition masks.
- Insert decorations into the existing floor/prop/unit painter queue with
  explicit anchors and bounds.
- Preserve renderer-owned exposed-face geometry and hit testing.
- Supply persisted connections to client traversal.

**Acceptance**

- Slope/stair fixtures use `getSlopeSprite()` with the expected biome,
  direction, and variant.
- Client/server reachability is identical on fixtures containing blockers,
  ramps, stairs, ledges, cliffs, and units.
- Foreground props/decorations occlude correctly without changing hit targets.
- Existing projection/elevation tests remain green.

#### BMG-21: Extend the deterministic tile asset contract

**Files**

- `ai-image-metadata/tiles/manifest.json`
- relevant floor/wall/slope metadata
- `scripts/tiles/isometricCompiler.js`
- tile validator/compiler tests
- generated canonical assets

**Implementation**

- Inventory existing slopes before adding keys.
- Prefer small reusable overlay families for shores, route edges, wetness, and
  talus instead of material-pair permutations.
- Define key identity, direction, anchor, logical box, and boundary behavior in
  metadata.
- Generate/rebuild through the deterministic compiler.

**Acceptance**

- `npm run tiles:check` passes.
- Assets retain the exact 2:1 footprint, straight alpha, shared boundary pixels,
  logical dimensions, and supported biome mapping.
- Strict validation rejects missing transition/slope assets referenced by a
  recipe.

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
  connections, required feature invariants, transition-neighbor agreement, and
  strict runtime asset resolution.
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
  `hardValid:false`, a missing required layer, or an unresolved asset key.
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

### Wave 3 — Tune, Prove, and Roll Out Version 2

#### BMG-30: Establish quality gates and a deterministic gallery

**Files**

- Extend the audit harness.
- Add deterministic browser screenshot tooling/fixtures.
- Add reviewed recipe baselines under test data rather than production code.

**Implementation**

- Measure hard validity, tactical route diversity/clearance, isolated-region
  rate, adjacent elevation deltas, water continuity, route zigzags/curvature,
  prop spacing/coverage, variant patch statistics, and generation timing.
- Generate a fixed seed gallery for every recipe at 32x32 plus selected compact
  and non-square sizes.
- Require a human review rubric for silhouette, feature causality, spawn seams,
  readability, repetition, and isometric transition artifacts.
- Lock recipe-specific thresholds only after comparing the gallery and metric
  distributions. Do not use one global “organic” threshold for arena and swamp.

**Acceptance**

- PR corpus: all 16 node types, seeds `0..99`, 32x32.
- Size corpus: 10x10 where supported, arena 11x16, 16x24, 24x32, 32x32, and
  48x40 across a fixed reduced seed set.
- Nightly corpus: at least seeds `0..999` for all 16 types at 32x32.
- No hard-validity, deterministic-hash, stream-isolation, schema, or asset
  failures.
- Natural-recipe isolated semantic tiles are at most 1% after documented
  exclusions; at least 95% of adjacent non-cliff elevation changes are at most
  one level; all drainage and route invariants pass.
- A reviewed gallery is attached to the version-2 enablement change.

#### BMG-31: Versioned shadow rollout

**Files**

- generation service/configuration
- telemetry/diagnostic storage
- admin/developer preview surface if available
- rollout and rollback tests/docs

**Implementation**

- Generate version 2 in preview/shadow mode for a sampled set of new requests
  without changing active battles.
- Compare hard/tactical/quality metrics and timings with version 1.
- Expose seed, version, recipe, attempt, and hashes in developer diagnostics.
- Enable version 2 for newly created battles by mode/biome behind a server
  flag. Existing battles remain on their stored version.
- Negotiate or enforce a client battle-map schema capability before assigning a
  version-2 battle. Cached/older clients that do not understand connections and
  required layers must remain on version 1 or receive a forced compatible
  upgrade response; they must not silently flatten V2 semantics.
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
- Mixed supported/unsupported client-version fixtures prove V2 is never served
  to a client that would ignore authoritative connections or blockers.

## Dependency Order

| Order | Work | Depends on | Can proceed in parallel with |
|---:|---|---|---|
| 1 | BMG-00 audit harness | none | BMG-04 fixture-corpus selection |
| 2 | BMG-04 frozen V1 + dispatcher | BMG-00 baseline | none |
| 3 | BMG-01 traversal contract | BMG-04 | BMG-05 |
| 4 | BMG-05 V2 envelope/hashes/persistence | BMG-04 | BMG-01 |
| 5 | BMG-06 spawn-layout contract | BMG-01, BMG-05 | BMG-02 metric helpers |
| 6 | BMG-02 validation/repair framework | BMG-00, BMG-01, BMG-05, BMG-06 | BMG-03 |
| 7 | BMG-03 V2 stage/recipe pipeline | BMG-04, BMG-05, BMG-06 | BMG-02 |
| 8 | BMG-10 fields/elevation | BMG-03, BMG-06 | BMG-21 asset inventory |
| 9 | BMG-11 regions | BMG-10 | renderer fixture design |
| 10 | BMG-12 hydrology | BMG-10, BMG-11, BMG-06 | BMG-20 foundations |
| 11 | BMG-13 routes | BMG-01, BMG-10, BMG-12, BMG-06 | BMG-21 |
| 12 | BMG-14 actual spawn integration | BMG-06, BMG-10, BMG-13 | BMG-21 |
| 13 | BMG-15 blockers/decoration | BMG-11, BMG-13, BMG-14 | BMG-21 |
| 14 | BMG-16 variants/transitions | BMG-15 | BMG-21 asset work |
| 15 | BMG-20 renderer | BMG-05, BMG-16 | BMG-21 |
| 16 | BMG-21 assets | BMG-16 transition schema | BMG-20 |
| 17 | BMG-22 authoritative final gate | BMG-02, BMG-14, BMG-15, BMG-16, BMG-21 | BMG-20 |
| 18 | BMG-30 corpus/gallery | BMG-20, BMG-21, BMG-22 | documentation |
| 19 | BMG-31 rollout | BMG-05, BMG-30 | none |

The two validation tasks are deliberately separated: BMG-02 creates the typed,
extensible framework early; BMG-22 becomes authoritative only after actual
spawns, blockers, connections, transitions, and asset keys exist. Likewise,
BMG-06 publishes spawn constraints before hydrology and routes; BMG-14 selects
and integrates actual positions after the landscape is known. Do not tune
hydrology, routes, or props against the legacy validator metrics.

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
- Transition masks for every neighbor pattern used by the renderer.
- Decoration schema rejection of collision fields.

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
map, and an occupied destination.

### Determinism and compatibility

- Retain version-1 encounter seed and representative full-layer digests across
  every configured node/archetype plus supported-size edge fixtures.
- Add a version-2 canonical full-output digest per representative recipe.
- Add independent hashes for authoritative traversal state and visual-only
  state.
- Assert that visual stream/config changes preserve the traversal hash.
- Assert canonical key-order, numeric normalization, excluded-field, domain
  separation, and self-reference rules.
- Assert serialize/load/JSONB/rejoin round trips preserve hashes and reject
  conflicting database mirror columns.

### Property and corpus checks

- All configured node types and every referenced archetype.
- Compact, standard, non-square, and larger supported dimensions.
- Edge seeds including `0`, signed/unsigned normalization boundaries, and
  repeated seeds.
- Every hard invariant above.
- Recipe-specific tactical/quality distributions, not only single examples.
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
8. distinct recipe identity without sacrificing tactical requirements.

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
- Measure compressed and uncompressed version-2 payload growth before rollout.
  Transition/decor layers should use compact records or masks rather than large
  redundant objects per empty tile.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Version-2 work accidentally changes version-1 maps | Land the isolated dispatcher first; keep immutable V1 multi-node/seed/size digest fixtures and put all behavior-changing code under the V2 boundary. |
| Correct obstacle traversal changes a historic V1 battle with inconsistent terrain/obstacle state | Run the BMG-01 persisted/generated-state parity audit; decide migration or compatibility treatment explicitly before release. |
| Validator constraints overfit current recipes or make retries unbounded | Separate hard/tactical/soft classes, use bounded attempts, record rejection distributions, and tune per recipe. |
| New collision contract changes abilities or AI unexpectedly | Cross-layer traversal fixtures and explicit movement policies before generator changes. |
| Hydrology makes attractive but unplayable maps | Reserve anchors, plan crossings, route after drainage, and enforce authoritative final traversal. |
| Organic cleanup homogenizes all biomes | Keep recipe-specific field spectra, processes, and quality bands; gallery review compares identity. |
| Transition assets grow combinatorially | Use directional masks and composable overlays; inventory existing slope assets first. |
| Decoration increases payload/draw cost | Separate budgets, compact records, viewport culling, and a density quality setting with no gameplay effect. |
| Improved output costs more CPU | Benchmark every wave, use bounded attempts/priority queues/typed grids, and shadow-test deployment p95. |
| Old persisted state lacks new layers | Allow defaults only in the V1 adapter; treat absent required V2 layers as corruption and cover both with load tests. |
| JSON/JSONB serialization changes hash bytes | Hash the specified canonical projections, not storage bytes, and verify JSONB round trips plus mirror-column equality. |
| Cached clients ignore V2 connections or layers | Gate assignment on an explicit client schema capability; keep unsupported clients on V1 or require a compatible update. |

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

The document's factual findings were checked using:

1. direct source tracing from all authoritative generation entry points through
   persistence, reload, traversal, and rendering;
2. the focused 120-test command recorded above;
3. an independent blocking-obstacle reproduction;
4. a fresh final-validator corpus of 1,600 generated maps;
5. inspection of every configured archetype, style profile, algorithm
   dispatcher, PRNG stream, obstacle pass, elevation implementation, and
   validator repair path;
6. inspection of slope asset loading and the exact isometric tile contract; and
7. primary references for coherent noise, minimum-distance sampling, drainage
   conditioning, and least-cost search;
8. an independent read-only review of version isolation, dependency order,
   schema/hashing semantics, persistence, rollout, test coverage, and acceptance
   criteria, with every high/medium finding resolved and a final verdict of no
   remaining high/medium contradictions; and
9. machine checks confirming 19 declared tasks match 19 dependency rows, the
   dependency graph is acyclic and topologically ordered, all 3 local links
   resolve, code fences are balanced, headings are unique, and no trailing
   whitespace remains.

### Claim classification

| Claim type | Status |
|---|---|
| Current call paths, ignored flags/results, per-tile elevation reseeding, obstacle omission, validation behavior, post-validation mutation, unused slope rendering | Confirmed directly in source |
| 120 focused tests pass | Reproduced |
| Blocking obstacle on grass is reachable at cost 1 | Reproduced |
| Final-validator corpus has 1,598/1,600 invalid results under current emitted constraints | Reproduced; interpreted as a validator/generator contract failure, not as 1,598 proven-unplayable maps |
| Coherent fields, drainage, least-cost routes, and minimum-distance props should improve causal naturalness | Design recommendation supported by primary algorithm references and code audit; must still pass gallery review |
| Proposed numerical quality thresholds | Initial engineering guardrails; recipe distributions and visual review must validate or revise them before rollout |
| Work-plan dependencies, V1 isolation, V2 candidate/final hashing, and wire/persistence boundaries | Structurally checked and independently reviewed; no open high/medium contradiction |

## Definition of Done

This plan is complete when:

- all Wave 0 correctness contracts are implemented and cross-layer tests pass;
- version 2 produces coherent landscape fields, height-driven features,
  landscape-aware routes, ecology-aware blockers, correlated variants, and
  separate decoration;
- the renderer visibly supports the resulting slopes, banks, shores, paths, and
  decorations under the existing isometric contract;
- every version-2 PR/nightly corpus map satisfies hard invariants, with bounded
  attempts and no required-stage failures;
- recipe tactical/quality thresholds and deterministic galleries are reviewed;
- all authoritative battle modes persist/reload the same versioned map;
- version-1 compatibility fixtures remain green; and
- version 2 is shadow-tested, performance/payload-reviewed, and enabled only for
  new battles with a proven rollback path.
