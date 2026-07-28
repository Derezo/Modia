# World Generation Pipeline Audit Remediation Plan

**Date:** 2026-07-27  
**Reviewed:** 2026-07-27 against the current implementation and focused test suites  
**Status:** Implemented and verified under the explicit review assumptions below  
**Scope:** World-generation correctness, deterministic finalization, validation, persistence, progression rules, encounter consistency, route presentation, and focused scalability improvements  
**Related:** [World Generation Technical Deep Dive](../WORLDGEN_TECHNICAL_DEEP_DIVE.md), [Technical Architecture](../TECHNICAL_ARCHITECTURE.md), [Gameplay Roadmap](../ROADMAP_GAMEPLAY.md), [Phase 4 Spacing Enforcement](./2026-01-19-phase4-spacing-enforcement-design.md)

## Review Outcome

The plan's central diagnosis is accurate: the current pipeline can generate a locally plausible world while losing node, region, route, difficulty, or seed identity between phases and persistence. The proposed identity-based graph, pre-mutation assembly, fail-closed validation, and transactional persistence are the correct remediation strategy.

This review makes the following material corrections:

- Phases 3-5 must converge on one stable-key graph before finalization; Tasks 3 and 4 are one coordinated change, not independent fixes.
- Task 2 must exclusively finalize and freeze castle coordinates before Voronoi construction. Later collision resolution must reserve those positions and may move only eligible non-castle nodes.
- Phase 6 currently mutates the graph as well as checking it. Deterministic finalization must be separate from read-only validation.
- Coordinate rounding/collision adjustment, difficulty assignment, reward-site selection, local-seed derivation, names, and features must all happen before validation. No structural or persisted field may change after validation.
- The database transaction is only atomic if every seed helper uses the same transaction client and propagates errors.
- Atomic rollback protects an existing world from a failed reset; it does not make a successful destructive reseed safe for live player data.
- Gameplay checks must use the same blocking semantics as server and frontend navigation. Direct-neighbor counts alone do not prove opening safety, trade progression, or reward-site gate preservation.
- Ruins reward scaling must follow access-control, solution-validation, and deterministic reward fixes or it will amplify an existing economy exploit.
- Connection route identity, competing-pair identity, segment order, and presentation semantics should survive persistence so lower-risk and wilderness choices are understandable after a restart, not merely valid in generator diagnostics.

The implementation order below incorporates these corrections.

## Goal

Repair the audited world-generation data-flow defects, enforce a valid database-ready graph for every supported seed, and implement the confirmed gameplay rules without removing intentional regional variation.

The implementation should produce a deterministic world in which:

- every connection resolves to the intended persisted node;
- every inter-region route connects the regions named by that route;
- valid seeds cannot create missing Voronoi cells;
- validation rejects structurally invalid output before persistence;
- generated guild, ring, route-difficulty, and ruins-reward metadata survives serialization;
- every castle has a direct approved safe destination and every exit from its opening-safe component first crosses Tier-1 combat;
- every blocking segment of a trade route is lower tier than the competing wilderness route;
- world-map obstacles are decorative and do not affect placement, navigation, or pathfinding;
- tactical terrain is stable for each world node; and
- regional activity scarcity remains intentional and follows stable race/region profiles.

## Non-goals

- Making decorative world-map obstacles block movement or alter world topology. Tactical-map obstacles remain intentionally movement-blocking.
- Guaranteeing every activity type in every region.
- Replacing the six-phase generation architecture.
- Redesigning battle entry UI or bypassing its existing controls.
- Prematurely optimizing generation algorithms that are not material at the current world size.
- Preserving the exact layout produced by existing seeds. Correctness takes precedence over seed-output compatibility.
- Preserving player locations, discoveries, clearances, battles, or other node-linked state across a successful world reset. This plan treats reseeding as an empty-environment bootstrap or explicitly authorized disposable development reset.
- Turning the current three-tier ruins puzzle/reward system into five tiers. World difficulty is mapped into the supported three-tier system.

## Confirmed Gameplay Decisions

| Area | Decision |
|---|---|
| Trade routes | Lower-tier combat routes. Their nodes still require combat clearance, but explicit reduced difficulty must survive Phase 6. |
| Castle opening | Every castle has at least one directly connected noncombat destination. The first mandatory combat is Tier 1 rather than Tier 2. |
| Regional scarcity | Intentional. Activity probabilities should be weighted by stable race/region profile, without universal per-region quotas. |
| Terminators | Primarily reward locations on low-degree routes. True dead ends are allowed but should be uncommon. A degree-2 reward may not weaken required combat progression. |
| Obstacles | World-map obstacles are purely visual. They must not affect world placement, connectivity, movement, or pathfinding. |
| Tactical encounters | Tactical terrain is stable per world node and remains entered through the existing battle UI flow. |
| Ruins | Puzzle and reward tier scales with the world node's difficulty. |

## Review Assumptions Requiring Product Confirmation

The review requested clarification on the choices below. To keep the document actionable, it uses the recommended defaults unless product direction changes them.

| Area | Assumed default | Why |
|---|---|---|
| Castle safe destination | Only an existing settlement or guild can be designated as the direct safe destination. If none is available, generation retries or fails rather than substituting a caravan, ruins, or reward site. | Prevents the opening rule from accidentally granting early economy, puzzle, or reward access. |
| Degree-2 reward sites | They remain nonblocking only when blocking-aware graph analysis proves their conversion does not reduce the minimum required combat gates to any progression anchor. | Preserves route flow without creating progression bypasses. |
| Trade difficulty | Every blocking trade-route encounter is at least one tier below the corresponding competing wilderness route; inserted gap nodes inherit their route's tier. | Produces a legible and consistent lower-risk choice instead of a route with hidden Tier-3 spikes. |
| Ruins mapping | World Tier 1 maps to ruins Tier 1, Tier 2 to ruins Tier 2, and World Tiers 3-5 to ruins Tier 3. | Uses the existing supported puzzle/reward range without silently flattening all high-level ruins. |
| Default world seed | Use `123456`, matching `.env.example` and `scripts/dev-setup.sh`; keep `12345` as a targeted regression seed rather than calling it the default. | Aligns the published/bootstrap contract and avoids the API/seeder silently describing a different world. |
| Reseed environment | A successful reseed is supported only for empty bootstrap or a disposable/explicitly authorized reset. Live-world preservation is a separate migration design. | World-node foreign keys make a successful reset destructive even when the transaction is perfectly atomic. |
| Ruins visibility | Puzzle state and reward preview require an authorized active character/party at the ruins node; remote preview is not supported. | Prevents undiscovered or inaccessible world content from being enumerated and pre-solved remotely. |

## Gameplay Impact and Guardrails

| Change | Intended player effect | Principal risk | Required guardrail |
|---|---|---|---|
| Castle opening | Gives each new character a useful destination and readable Tier-1 first challenge. | An activity/reward neighbor could front-load economy or bypass combat. | Approved settlement/guild role plus full nonblocking-component boundary validation. |
| Lower-risk trade route | Creates a meaningful combat route choice rather than a free fast-travel lane. | A single generic-tier infill node can turn the advertised safer route into a difficulty spike. | Compare every blocking segment and persist/render route identity. |
| Regional profiles | Makes regions feel culturally and ecologically distinct while preserving discovery scarcity. | Hard quotas homogenize worlds; class-only profiles conflate distinct regions; low total density can masquerade as correct weights. | Conditional activity weights by stable profile plus a separate total-density metric. |
| Degree-2 reward sites | Reduces repetitive dead ends and lets rewards sit on natural exploration loops. | A nonblocking reward conversion can remove a required combat gate. | Source-to-anchor gate-vector comparison before conversion. |
| Ruins scaling | Makes distant exploration and harder puzzles economically meaningful. | The current solve contract can be forged or completed remotely, and preview/award RNG can disagree. | Server-replayed legal solutions, location/access checks, deterministic reward stream, and idempotent award. |
| Stable tactical terrain | Makes encounter layout learnable, reproducible, and fair to reconnecting players. | A deployment or rejoin path can silently regenerate a different map; shared RNG can make unrelated battle state predictable. | Persist terrain version/map state and isolate terrain RNG from encounter/combat RNG. |
| Route/landmark presentation | Makes risk, travel mode, and regional theme readable on the world map. | Decorative landmarks or color-only route styles can obscure actionable information. | Layer/contrast/click-target checks and line-pattern/width distinctions. |

## Audit Findings

| Priority | Finding | Evidence / reproduction | Planned resolution |
|---|---|---|---|
| Critical | Phase 5 treats shuffled castle-array indices as region IDs. | Regression seed `12345` produces shuffled region order `[1, 5, 3, 2, 4]`; named bridges and routes can connect nodes in different regions. | Carry explicit region IDs from castle/Voronoi data and remove all `index + 1` region lookup assumptions. |
| Critical | Phase 4 appends gap-infill nodes to `nodesByRegion` but leaves `allNodes` stale. | Production-order seeds `164`, `212`, and `320` create intermediate nodes missing from the flattened list, shifting or dropping later edges. | Establish one canonical post-Phase-4 node collection and delay numeric indexing until final serialization. |
| High | Exactly coincident castle points receive no repulsion and produce a missing Voronoi cell. | Production-order seeds `86` and `445` crash when Phase 3 reads `cell.polygon`. | Deterministically separate/resample coincident points, enforce castle-distance and cell-count postconditions, and preserve cell index alignment. |
| High | Secondary `guildType` assignments are overwritten during persistence. | On seed `12345`, 10 of 15 guilds serialize to a different class; the serializer-local race mapping also disagrees with `GUILD_CONFIG.RACE_PRIMARY_GUILD` for several races. | Remove the duplicate mapping and persist `node.guildType`, using the centralized primary class only as a guarded fallback. |
| High | Phase 6 overwrites explicit inter-region difficulty. | Trade-route nodes are assigned Tier 1 in Phase 5 and recalculated as Tier 4 from ring distance. | Preserve explicit difficulty overrides or make route flags part of the canonical difficulty calculation. |
| High | Phase 6 mixes mutation with validation, reports structural failures, and allows generation to continue. | It assigns difficulty/terminators and consumes RNG while also logging orphan, spacing, shrine, and guild failures. | Split deterministic finalization from a pure, read-only validator; throw before database conversion on hard errors. |
| High | The exact persisted representation is not the representation being validated. | Coordinate rounding/collision offsets, local seeds, names, and features are assigned during serialization after Phase 6. | Freeze quantized castle coordinates before Voronoi, finalize every other persisted field before validation, preserve regional cell membership during collision repair, and prohibit post-validation mutation. |
| High | Seeding truncates world/content tables before generating or validating the replacement world and does not wrap the operation in a transaction. | A generation, validation, or insertion failure can leave shared database state empty or partially rebuilt. | Assemble and hard-validate before the first mutating query, then wrap all truncation and insertion in one transaction with rollback. |
| High | Seed helpers do not all share one query client. | Item, enemy, shop, developer-fixture, marketplace, and dropped-item paths use the global pool or service-owned database access. | Inject one transaction-scoped query runner into every in-transaction helper, propagate errors, and keep optional fixtures outside the atomic core if they cannot participate. |
| High | Successful reseeding deletes or invalidates player-linked state. | Characters, discoveries, clearances, parties, battles, activity history, and other records reference world nodes with cascading or restrictive foreign keys. | Scope this plan to bootstrap/disposable resets and require an explicit production guard, maintenance procedure, and backup; design live-world migration separately. |
| High | Ruins rewards are not yet safe to scale. | Persistence omits reward tier; GET and POST advance the seeded RNG differently so preview and award can differ; GET exposes puzzle/reward data remotely; POST trusts a reported move count rather than a legal solution and does not establish that the player is at the ruins. | Persist a mapped tier, use separate stable puzzle/reward streams, apply location/access policy to preview and solve, and validate a submitted legal solution before increasing rewards. |
| High | Frontend reachability can expand through an uncleared blocking node even though server pathfinding cannot. | In a castle -> uncleared Tier-1 -> Tier-2 chain, the current frontend marks Tier 2 reachable while the server allows Tier 1 only as a destination and rejects traversal through it. | Align frontend expansion with the server contract and run shared progression fixtures through worldgen validation, server pathfinding, and frontend reachability. |
| Medium | `validatePhase6()` validates region-local edge indices as if they were global. | Its results do not match production's offset conversion and malformed endpoints may be silently ignored. | Reuse the same assembly/normalization path as production and fail validation on every unresolved endpoint. |
| Medium | Castle ring distance `0` serializes as `NULL`. | The serializer's truthy fallback treats zero as missing. | Use nullish fallback and assert castle ring persistence. |
| Medium | Terminator behavior and documentation conflict. | Candidates can have degree 1 or 2; the sorted priority list is shuffled wholesale; constants describe all terminators as exact dead ends. | Model reward-site and rare-dead-end selection explicitly and update constants/comments. |
| Medium | Trade routes are described as safe but use blocking combat node types. | Forest, cave, and mountain nodes block traversal until cleared. | Retain combat gating per the confirmed decision, preserve reduced tier, and rename documentation from “safe” to “lower-risk.” |
| Medium | The generator does not guarantee an approved direct safe destination from a castle. | Settlement-to-settlement adjacency rejects castle-to-settlement/guild edges; generic activity edges may still be possible, but they are neither guaranteed nor necessarily appropriate for opening progression. | Add an explicit designated-opening-edge rule, approved node types, fallback/retry behavior, and a blocking-aware safe-component invariant. |
| Medium | Activity distribution is generic RNG rather than region-profile RNG. | Fishing, caravan, and ruins use a shared random picker with no race/class weighting. | Add regional activity weights while retaining overall activity ratios and scarcity. |
| Medium | `local_seed` is selected for battle entry but ignored by terrain generation. | Battle setup calls encounter generation without the node seed. | Pass `local_seed` through battle service terrain generation and add repeat-entry determinism tests. |
| Medium | Route semantics disappear during persistence. | Generated trade/wilderness/bridge meaning is retained only in transient data while connection rows are written as generic roads; `path_type` alone cannot reconstruct a competing route pair or segment order after restart. | Carry route, competing-pair, segment-order, and segment-kind identity through assembly; persist explicit connection metadata plus supported `path_type`; and expose a colorblind-safe visual distinction/legend without changing blocking rules. |
| Medium | The world-seed/version contract is inconsistent. | Environment/bootstrap defaults use `123456`, while the seeder and seed endpoint use `12345`; the endpoint can report the environment rather than the persisted world, and smart setup cannot detect generator/stream changes unless its version contract is updated. | Centralize parsing/defaults, validate the seed domain, persist generator/stream versions and hashes, and make setup/API consume that persisted contract. |
| Low | Obstacle, name, feature, and local-seed draws share structural RNG state. | Cosmetic draw-count changes can alter every later phase; `local_seed` depends on serialization order. | Introduce versioned named RNG streams and derive node-local seeds from the world seed plus stable node identity. |
| Low / scale-dependent | Several algorithms allocate or scan more than necessary. | BFS uses `shift()` and copies full paths; validators repeatedly call `indexOf`; regional MST and nearest-candidate passes scale poorly. | Optimize after correctness, guarded by a measurable size/runtime threshold. |

## Target Data-Flow Invariants

The corrected pipeline should use stable generated keys internally, perform all deterministic mutation before validation, and introduce database IDs only in the persistence adapter:

```text
validated WorldSeedConfig + versioned named RNG streams
  -> Phase 1 castles with stable castleKey + explicit regionId
       + finalized/frozen persisted coordinates
  -> Phase 2 cells keyed by castleKey/regionId
  -> Phase 3 region nodes with stable nodeKey
  -> Phase 4 regional nodes + inserted nodes + stable-key edges
  -> canonical stable-key graph
  -> Phase 5 inter-region nodes, route manifest, and stable-key edges
  -> deterministic finalization
       (non-castle coordinates, tiers, reward roles, names/features, local seeds,
        route metadata/path types)
  -> read-only validation of the exact database-ready representation
  -> transaction-scoped persistence adapter resolves generated keys to DB IDs
```

Required invariants:

1. Every generated `regionId`, `castleKey`, `nodeKey`, `edgeKey`, and `routeId` is unique within its domain.
2. `sum(nodesByRegion lengths) + interRegionNodes.length === finalNodes.length`.
3. Every edge has two distinct, resolvable generated endpoints in `finalNodes`.
4. No edge is silently discarded or redirected during database conversion.
5. Every route manifest entry names the actual regions, endpoints, competing-pair key, route kind, segment order/kinds, and tier policy represented by its edges; that identity survives database round-trip.
6. All five castles have valid, distinct Voronoi cells and persisted region records. Each persisted castle coordinate exactly equals the frozen point that generated its cell.
7. The final graph is connected and obeys hard maximum-spacing rules using the exact persisted coordinates; coordinate repair never moves a regional node outside its assigned Voronoi cell.
8. Finalization runs once and validation is observationally pure: validation cannot change output or consume a generation RNG stream.
9. Validation, hashing, and persistence use the same normalized node, edge, region, and route representation.
10. Repeating a seed and generator version produces byte-equivalent canonical output and SHA-256 hashes.
11. Cosmetic/name-pool changes do not alter the normalized structural graph.
12. Node-local seeds are derived from world seed, generator version, and stable node identity rather than traversal or insertion order.
13. The opening-safe component and all progression checks use one traversal contract shared by generation validation, server pathfinding, and frontend reachability: a blocking node may be a destination but never an intermediate expansion node until cleared.
14. Every blocking trade-route segment satisfies its declared lower-tier relationship to the competing wilderness route.
15. World assembly and hard validation complete before the first database mutation.
16. A failed bootstrap/reset leaves all preexisting database state intact.

---

## Task 1: Create Import-Safe Assembly and Seed Infrastructure

**Files:**

- Modify: `api/src/db/seed.js`
- Add: `api/src/db/worldgen/worldAssembly.js`
- Add: `api/src/db/worldgen/randomStreams.js`
- Modify: `.env.example`
- Modify: `scripts/dev-setup.sh`
- Add: `api/src/tests/unit/worldgen/worldAssembly.unit.test.js`
- Add or modify: `api/src/tests/integration/worldGeneration.integration.test.js`

### Implementation

1. Add a side-effect-free `assembleWorld(config)` orchestration entry point that returns the current phase outputs and structured diagnostics without importing or opening a database. Treat this as scaffolding that Tasks 2-6 extend into the final normalized database-ready model; Task 1 does not claim that the audited phase output is already persistence-safe.
2. Keep destructive database seeding as a separate caller and guard `main()` so importing `seed.js` never starts a reseed.
3. Centralize world-seed parsing:
   - use one documented default across `.env.example`, setup scripts, the seeder, tests, and API metadata;
   - apply that default only when the value is unset;
   - accept only signed 32-bit integers (`-2147483648..2147483647`), matching PostgreSQL `INTEGER` and the current 32-bit PRNG behavior;
   - reject empty, nonnumeric, fractional, out-of-range, or ambiguously parsed values rather than relying on `parseInt()` truncation/wrapping; and
   - include `generatorVersion` and `randomStreamVersion` in assembly input/output.
4. Build versioned named RNG streams with fixed salts for at least castle placement, regional nodes, internal connections, inter-region routes, deterministic finalization, names/features, and decorative world obstacles.
5. Define and unit-test canonical key ordering and finite-number representation utilities for later hashing, without treating a hash of the pre-remediation phase output as the final world contract.
6. Lock in targeted red regression fixtures:
   - castle collision: `86`, `445`;
   - Phase 4 gap infill: `164`, `212`, `320`;
   - shuffled region mapping and persistence: `12345`.
7. Add focused tests for valid/invalid seed parsing, named-stream repeatability and isolation, import safety, and pure orchestration.

### Acceptance criteria

- Tests fail against the audited implementation for the reproduced defects.
- Pure assembly tests make no database connection and mutate no database state.
- Importing `seed.js` has no side effect.
- Seed parsing is strict and consistent across the seeder, setup script, environment example, and tests.
- Named streams are deterministic for the same seed/version, and consuming a cosmetic stream does not advance a structural stream.

Task 1 is intentionally a narrow foundation, not an independently releasable world-reset change. Tasks 1-6 form one release/merge gate: the reset path must not ship until finalization, authoritative validation, persistence metadata, database round-trip, and transaction rollback criteria are complete.

## Task 2: Fix Castle and Voronoi Identity Safety

**Files:**

- Modify: `api/src/db/worldgen/castlePlacement.js`
- Modify: `api/src/db/worldgen/voronoiPartitioning.js`
- Modify: `api/src/db/worldgen/nodeGeneration.js`
- Modify: castle/Voronoi unit tests

### Implementation

1. Handle zero-distance castle pairs with a deterministic seed-derived direction or bounded resampling before force calculations.
2. Make this task the exclusive owner of castle-coordinate finalization. Quantize castle coordinates, resolve castle-to-castle collisions, validate minimum separation, then freeze and use those exact values as both Voronoi generator points and persisted castle coordinates.
3. Replace the current warning-only separation outcome with bounded deterministic retry/resampling, then proceed to the fallback in the next step if ordinary placement still violates separation.
4. After ordinary retries are exhausted, use a deterministic, well-spaced fallback layout within configured bounds (for example, a seed-rotated five-point ring) and revalidate it. Raise a descriptive generation error only when the configured bounds/separation requirements are themselves unsatisfiable.
5. Store Voronoi cells by `castleKey`/`regionId` rather than relying on compacted `push()` order or array position.
6. Preserve an explicit missing entry during diagnostics; never compact away a missing/degenerate cell and shift later cell identities.
7. Make missing, empty, nonfinite, or degenerate cells an explicit Phase-2 failure rather than allowing Phase 3 to dereference `undefined`.
8. Expose the frozen castle-coordinate set to finalization so later collision repair reserves it and moves only an eligible non-castle node.

### Acceptance criteria

- Seeds `86` and `445` generate five distinct castles and cells without error.
- Every castle retains the polygon belonging to its assigned region after shuffling.
- The coordinates checked for separation and used by Voronoi are the exact finalized castle coordinates.
- Each database-round-tripped castle coordinate exactly equals the generator point for its assigned Voronoi cell.
- The corpus produces no missing or degenerate cell.

## Task 3: Establish a Canonical Post-Phase-4 Graph

**Files:**

- Modify: `api/src/db/worldgen/nodeGeneration.js`
- Modify: `api/src/db/worldgen/internalConnections.js`
- Modify: `api/src/db/worldgen/interRegionConnections.js`
- Modify: `api/src/db/seed.js`
- Modify: internal/inter-region connection tests

### Implementation

1. Return inserted gap nodes as first-class Phase-4 output.
2. Assign every generated node a stable `nodeKey` independent of array position and future database ID.
3. Rebuild the canonical flattened node list after the last Phase-4 regional mutation.
4. Represent Phase-4 and Phase-5 endpoints with stable generated keys.
5. Have Phase 5 add nodes/edges to that canonical graph rather than retaining a second endpoint model.
6. Create one generated-key-to-canonical-index map only after every structural node is present. Use it for deterministic ordering and database-ready normalization, not as phase-local identity.
7. Remove the separate, divergent offset calculations in production and `validatePhase6()`.
8. Replace silent out-of-range endpoint filtering with a hard assembly error that identifies the edge, endpoint, phase, and route.

### Acceptance criteria

- Seeds `164`, `212`, and `320` retain every inserted intermediate node.
- Later-region connections still resolve to nodes in their original regions.
- No connection is dropped during database conversion.
- Production and validation use the same canonical assembly helper.
- Array shuffling before canonical ordering cannot redirect an edge.

## Task 4: Correct Inter-Region Region Resolution

**Files:**

- Modify: `api/src/db/worldgen/voronoiPartitioning.js`
- Modify: `api/src/db/worldgen/interRegionConnections.js`
- Modify: `api/src/db/seed.js`
- Add: connection route-metadata migration
- Modify: world-map/navigation API connection serialization
- Modify: inter-region connection tests

### Implementation

1. Carry `regionId`, region name, and castle identity on shared-border records.
2. Replace `nodesByRegion.get(index + 1)` with explicit region-ID lookup.
3. Migrate every Voronoi-derived index reference together: shared edges/borders, palace adjacent regions, bridges, wilderness routes, trade routes, and their names/metadata.
4. Use `regionId` for logic and treat region names as display data only.
5. Add assertions that route metadata and both endpoint regions agree.
6. Retain a pre-insert route manifest containing route ID, a competing-pair key shared by the trade/wilderness alternatives, route kind, declared region IDs, resolved endpoint identities, ordered segments, segment kinds, and tier policy.
7. Carry `routeId`, `routePairKey`, `routeKind`, `segmentIndex`, and `segmentKind` on assembled edges.
8. Add nullable connection columns for route ID, pair key, route kind, and nonnegative segment index, with constraints/indexes appropriate to the supported route kinds. Ordinary regional edges may leave route identity null.
9. Persist those fields and map segment kind to the schema's supported `path_type` values rather than writing every edge as `road`. Expose the fields only on authorized/discovered connections in the world-map/navigation payload; do not leak the full route manifest through fog of war.
10. Persist the normalized route manifest in seed metadata in Task 6 and store its hash beside it. Per-connection columns support runtime presentation; the persisted manifest retains pair-level endpoints and tier policy for exact reconstruction/audit after restart.

### Acceptance criteria

- Regression seed `12345` connects every named region pair to nodes in those regions.
- The seed corpus contains no mislabeled or cross-wired regional route.
- Every assembled world produces a route manifest that passes endpoint-region validation before database mutation.
- Database-round-tripped connection rows, joined final node tiers, and the persisted route manifest reconstruct the same route IDs, competing pairs, segment order/kinds, endpoints, and tier policies as the generated manifest.

## Task 5: Make Structural Validation Authoritative

**Files:**

- Modify: `api/src/db/worldgen/validation.js`
- Modify: `api/src/db/seed.js`
- Modify: `api/src/tests/unit/worldgen/validation.unit.test.js`
- Modify: `api/src/tests/unit/worldgenValidation.unit.test.js`

### Implementation

First split the current Phase-6 responsibilities:

**Deterministic finalization**

- non-castle coordinate quantization and collision resolution, reserving Task 2's frozen castle positions;
- bounded deterministic candidate selection that keeps every adjusted regional node inside its assigned Voronoi cell and generation bounds, or fails/retries instead of leaking the node across a region border;
- canonical difficulty/ring assignment;
- reward-site/terminator selection;
- ruins-tier mapping;
- route/segment/path-type finalization;
- name and feature assignment;
- stable node-local seed derivation; and
- canonical ordering.

Finalization may use only its designated named streams. It returns a new finalized model or makes one clearly bounded pass; it is never called implicitly by validation or persistence.

**Read-only validation**

Classify checks as follows:

**Hard failures**

- missing or invalid endpoints;
- duplicate stable identities, self-edges, or duplicate undirected edges;
- missing castle, region, or Voronoi cell;
- any castle coordinate differing from its frozen Voronoi generator point;
- any regional node outside its assigned Voronoi cell after coordinate repair;
- disconnected graph or orphaned nodes;
- maximum-spacing violations;
- invalid tier/ring values;
- missing required zodiac shrines;
- missing castle opening-route invariants;
- route manifest/endpoint/path-type disagreement;
- post-normalization coordinate collision;
- mismatch between canonical nodes and serialized nodes; and
- any mutation of the finalized input detected in validator purity tests.

**Soft warnings**

- terrain clustering preference;
- guild-spacing preference when the global distribution remains valid;
- probabilistic regional activity-profile variance;
- graph-quality metrics that have not yet earned hard thresholds; and
- noncritical aesthetic density/route-stretch outliers.

Return structured errors and warnings. Abort world persistence when any hard error exists.

Define the validated domains in centralized configuration and test them explicitly:

- difficulty tiers are integers in `[1, 5]`;
- castle ring is exactly `0`;
- regional and inter-region ring values match their configured phase/type domains;
- every guild class is in the supported class set; and
- guild counts obey `GUILD_CONFIG` global and per-region limits.

### Acceptance criteria

- The old mutating `validatePhase6()` is removed or reduced to a compatibility wrapper around finalization plus the same read-only validator used by production.
- Running validation twice returns identical diagnostics, consumes no RNG, and leaves a deep-frozen/fingerprinted input unchanged.
- An invalid endpoint cannot be skipped and reported as a pass.
- Persistence is not attempted after a hard validation failure.
- Repeated finalization produces deterministic, complete database-ready output for the same seed and generator/stream version.
- Collision resolution never moves a castle and never moves a regional node outside its assigned cell.
- With generator logging disabled, seeds `1..500` pass in CI and seeds `1..5000` pass in the scheduled/manual sweep.

## Task 6: Preserve Generated Metadata During Serialization

**Files:**

- Modify: `api/src/db/seed.js`
- Modify: `api/src/routes/world/navigation.js`
- Modify: `scripts/dev-setup.sh`
- Modify: centralized guild/worldgen configuration
- Add: seed-metadata migration for generator/stream versions, canonical hashes, and normalized route manifest
- Add or modify: seed transaction integration tests
- Modify: database-ready output tests

### Implementation

1. Remove the duplicate serializer-local race-to-guild mapping.
2. Persist `node.guildType` as `guild_class`; use `GUILD_CONFIG.RACE_PRIMARY_GUILD` only when `guildType` is absent, and fail if neither yields a supported class.
3. Derive guild naming from the same finalized guild class so label and gameplay metadata cannot disagree.
4. Replace truthy fallbacks with nullish fallbacks for valid zero values, including `ringDistance`.
5. Preserve an explicitly assigned `difficultyTier`; calculate a tier only when it is absent.
6. Use one canonical difficulty function that applies explicit route policy before generic node-type/ring rules. This precedence must be implemented before accepting this task.
7. Derive signed 32-bit `local_seed` values from `WORLD_SEED`, generator/stream version, and `nodeKey` using a stable documented hash/PRNG reduction. Resolve the rare within-world collision deterministically in canonical `nodeKey` order with a versioned salt/counter; do not consume a traversal-order RNG draw.
8. Canonically encode the finalized model using Task 1's ordering/number rules. Produce SHA-256 hashes for the structural graph, complete normalized output, and route manifest, including generator/stream version while excluding database IDs and timestamps.
9. Persist the resolved world seed, generator version, stream version, structural graph hash, complete output hash, normalized route manifest, route-manifest hash, and generation timestamp in seed metadata. Add a migration for fields not present in the current singleton table.
10. Make `/api/world/seed` return persisted seed/version/hash metadata for the active world rather than a potentially different environment value. If no active metadata exists, return an explicit uninitialized state instead of fabricating a seed. Keep the full persisted route manifest server-side.
11. Update smart bootstrap detection to compare persisted seed, seed/content version, generator version, and random-stream version. A mismatch must take the guarded reset path; do not silently serve metadata for an older generator.
12. Move pure finalized assembly and hard validation before every `TRUNCATE`, `DELETE`, `INSERT`, or other mutating query.
13. Wrap all destructive reset queries and inserts in one explicit transaction.
14. Pass the same transaction client/query runner into item, enemy, shop, marketplace, developer-fixture, dropped-item, and every other participating seed helper. Make helpers throw rather than swallowing errors.
15. If an optional fixture cannot share the transaction, move it after the committed atomic core and identify it as non-atomic; do not claim it is part of the protected reset.
16. Add failure-injection tests for a hard validation failure before mutation and for failures after truncation, after world insertion, and in a late helper table before commit. Run them only against a disposable PostgreSQL database populated with sentinel rows.
17. Add assertions for:
   - castle `ring_distance === 0`;
   - expected primary and secondary guild classes and class-consistent names;
   - retained trade/wilderness difficulty and path types;
   - mapped ruins tiers; and
   - valid, stable, unique-within-world local seeds.

### Acceptance criteria

- Seed `12345` persists the Phase-3 guild distribution without class replacement.
- Castle ring zero and explicit Tier-1 route values survive database conversion.
- Reordering canonical insertion does not change a node's `local_seed`.
- API seed metadata matches the world that was actually persisted.
- Complete database-ready output and all three hashes are deterministic for the same seed and generator/stream version.
- Normalizing queried database rows without database IDs/timestamps exactly matches the validated pre-insert model and hashes.
- The persisted route manifest hashes to the stored route hash and agrees with every connection's route/pair/order metadata.
- Transaction tests mutate only a disposable database; every injected failure leaves sentinel rows unchanged across world and helper-owned tables.

## Task 7: Implement Castle Opening Progression Rules

**Files:**

- Modify: `api/src/db/worldgen/internalConnections.js`
- Modify: `api/src/db/worldgen/nodeGeneration.js`
- Modify: `api/src/db/worldgen/validation.js`
- Modify: `api/src/db/worldgen/constants.js`
- Add or modify: shared traversal-blocking classification used by worldgen validation and runtime navigation
- Modify: `frontend/src/worldmap/WorldMapPathSystem.js`
- Add or modify: frontend reachability tests and shared traversal-contract fixtures
- Modify: worldgen progression tests

### Implementation

1. Add a contextual adjacency exception for a designated castle-opening edge. Do not globally permit settlement-to-settlement adjacency.
2. Select an existing settlement or guild in the castle's region as the designated destination and connect it directly to the castle.
3. Make selection deterministic, region-profile appropriate, and bounded. If no candidate survives final connectivity cleanup, retry the affected generation stage or fail with a descriptive error; do not silently substitute a caravan, ruins, or reward site.
4. Mark the edge/node role explicitly in assembly diagnostics so later minimum-degree or cleanup passes cannot delete or repurpose it.
5. Use a shared runtime-equivalent blocking predicate to discover the full connected nonblocking component containing each castle. Do not assume the safe component contains only the designated neighbor.
6. Encode the traversal rule explicitly: an uncleared blocking neighbor is a valid destination, but its neighbors must not be expanded. Fix frontend reachability so processing a blocked node contributes no further reachable nodes, matching server pathfinding.
7. Run shared contract fixtures through worldgen analysis, server pathfinding, and frontend reachability, including castle -> uncleared Tier-1 -> Tier-2 and cleared-node variants.
8. Reject an opening-safe component containing an unapproved activity/reward node such as a caravan, ruins, chest, shrine, or discovery unless product direction explicitly approves that early access.
9. Require every edge leaving that component to enter a Tier-1 blocking combat node, including every direct castle edge.
10. Require at least one such boundary combat encounter and preserve the normal Tier-2+ progression beyond the opening boundary.
11. Put a configured upper bound on opening-safe-component size to catch accidental chains of unrestricted economy/reward nodes.
12. Test the invariant on the final uncleared graph after all rewiring, degree repair, route insertion, and reward-site conversion.

### Acceptance criteria

- Every castle in the seed corpus has its designated direct settlement/guild edge and a nonempty Tier-1 combat boundary.
- A new player can use the designated noncombat destination before clearing combat, without receiving unintended caravan, ruins, or reward access.
- Every edge from the complete opening-safe component into the wider graph first crosses Tier-1 combat.
- No castle can be forced directly into Tier 2 or bypass the opening fight through its noncombat neighbor.
- In the castle -> uncleared Tier-1 -> Tier-2 fixture, worldgen and both runtimes expose Tier 1 as reachable but never Tier 2 until Tier 1 is cleared.
- Opening guarantees survive final graph cleanup and database round-trip.

## Task 8: Preserve Lower-Tier Combat Trade Routes

**Files:**

- Modify: `api/src/db/worldgen/interRegionConnections.js`
- Modify: `api/src/db/worldgen/internalConnections.js` if it owns inserted route segments
- Modify: `api/src/db/worldgen/validation.js`
- Modify: `api/src/db/seed.js`
- Modify: `api/src/routes/world/navigation.js`
- Modify: `frontend/src/worldmap/WorldMapConnectionRenderer.js`
- Modify: `frontend/src/worldmap/WorldMapEffects.js`
- Modify: `frontend/src/worldmap/NodeHoverTooltip.js` or the selected route legend/tooltip owner
- Modify: `api/src/services/world/pathfindingService.js` only if a shared blocking predicate requires refactoring
- Modify: trade-route tests, effects/fallback renderer tests, and documentation

### Implementation

1. Keep trade-route node types in the combat-blocking set.
2. Assign one explicit tier policy per competing route pair. Every blocking trade encounter must be at least one tier below the lowest blocking tier on the corresponding wilderness route, within the supported `[1, 5]` domain.
3. Ensure every inserted gap/infill node inherits `routeId`, `routePairKey`, `routeKind`, `segmentIndex`, `segmentKind`, and its route's difficulty policy instead of falling back to generic Tier 3.
4. Preserve those tiers through finalization and serialization; validation must compare final blocking segments rather than only route endpoints.
5. Keep wilderness routes at a higher risk/reward level and record the comparison in the route manifest.
6. Persist route/pair/order identity and meaningful supported path types: for example, trade surfaces as road, wilderness as trail, and actual bridge/tunnel segments retain their specific type.
7. Update both the normal organic/effects renderer and its fallback path. Render route choices with colorblind-safe differences in line pattern/width as well as color, and add concise legend/tooltip language such as “Lower-risk combat road” and “Higher-risk wilderness trail.”
8. Replace all “safe route” language with “lower-risk combat route.”
9. Assert that uncleared trade-route combat nodes cannot be used as intermediate pathfinding nodes.
10. Confirm that the game's tier-based encounter rewards make the higher-tier wilderness option higher expected value. If they do not, define a separate wilderness reward/shortcut benefit before presenting the pair as a risk/reward choice.

### Acceptance criteria

- Trade-route nodes remain combat encounters.
- Every final blocking trade segment is at least one tier below the competing wilderness route and every infill segment follows its route policy.
- They cannot be traversed through before clearance.
- Database round-trip and world-map rendering retain the intended route/segment distinction.
- Both the organic/effects and fallback render paths visibly distinguish road, trail, bridge, and tunnel semantics.
- Players can distinguish the choices without relying on color alone.
- Route copy does not promise higher wilderness reward unless the encounter/reward integration proves it.

## Task 9: Add Regional Activity Profiles Without Removing Scarcity

**Files:**

- Modify: `api/src/db/worldgen/constants.js`
- Modify: `api/src/db/worldgen/nodeGeneration.js`
- Modify: node distribution tests
- Update: `docs/WORLDGEN_TECHNICAL_DEEP_DIVE.md`

### Implementation

1. Add configurable regional activity weights keyed by race or stable region profile.
2. Do not key profiles by guild class alone: regions that share a class, such as elf/vampire wizard regions, still need distinct thematic distributions.
3. Base weights on dominant terrain, culture/race, economy, and regional tone. Keep guild preference as one influence rather than the profile identity.
4. Preserve the existing overall activity-node percentage range.
5. Apply normalized weights only after the generator has decided to create an activity node. The denominator is the set of activity draws for that profile, not all generated nodes.
6. Use weights, not hard per-type quotas; a region may legitimately lack an activity type.
7. Keep configuration and optional profile-specific naming/flavor pools centralized so balance/theme changes do not require graph logic changes.
8. Validate distribution statistically across the deterministic `1..5000` corpus. Require each profile's observed share among its activity draws to be within 5 percentage points of configured weight, or replace that threshold with a documented confidence-based bound if sample counts make a fixed bound misleading.
9. Report total activity density separately from conditional activity-type share so one metric cannot mask a regression in the other.
10. Reconcile the existing Phase-3 “at least three activity nodes per region” assertion with the configured total-density policy. Keep it only as an explicit total-activity floor; it must not become a per-type quota or contradict a deliberately sparser profile.

### Acceptance criteria

- The same seed remains deterministic.
- Aggregate distributions reflect configured regional preferences.
- The fixed-corpus conditional distribution meets the configured tolerance and total activity density remains within its configured range.
- Regional scarcity remains possible.
- No region is forced to contain fishing, caravans, and ruins simultaneously.
- Profile distinctions reinforce regional theme without changing progression topology.

## Task 10: Align Terminators With Reward-Site Design

**Files:**

- Modify: `api/src/db/worldgen/validation.js`
- Modify: `api/src/db/worldgen/constants.js`
- Modify: terminator tests
- Update: `docs/WORLDGEN_TECHNICAL_DEEP_DIVE.md`

### Implementation

1. Separate low-degree reward-site candidates from true dead-end candidates.
2. Define progression anchors for gate analysis: all opening-safe components as sources and the palace, regional exits, zodiac shrines, and other required milestone nodes as targets.
3. Compute the minimum number of uncleared combat gates from each source to each reachable anchor with deterministic 0-1 BFS using runtime-equivalent blocking semantics.
4. Before converting or marking a degree-2 node as a nonblocking reward site, simulate the final classification. Accept it only if no source-to-anchor minimum gate count decreases and no new opening-safe-component bypass appears.
5. Prefer eligible degree-2 peripheral nodes for most reward locations.
6. Allow a configurable minority of degree-1 dead-end rewards; use an initial tuning default of 15%.
7. Shuffle candidates within degree groups rather than destroying the priority ordering.
8. Update connection constants, navigation classification, persistence compatibility fields such as `is_terminator`, and comments so they describe reward-site selection rather than requiring every reward node to have degree 1.
9. If no safe degree-2 candidate exists, reduce the reward-site count or use an eligible degree-1 node; never weaken progression merely to hit a quota.

### Acceptance criteria

- Reward nodes remain concentrated in outer/peripheral routes.
- Across deterministic seeds `1..5000`, degree-1 terminators comprise 10-20% of assigned terminators around the initial 15% target; the remainder are degree-2 reward sites.
- Every accepted degree-2 reward site preserves the full source-to-anchor minimum-combat-gate vector.
- Selection is deterministic for a fixed seed.
- Worlds with insufficient eligible candidates remain structurally valid and emit a balance warning rather than creating a bypass.

## Task 11: Scale Ruins Rewards With Difficulty

**Files:**

- Modify: `api/src/db/seed.js`
- Modify: `api/src/routes/ruins.js`
- Modify: ruins persistence/schema constraints
- Modify: `frontend/src/api/client.js`
- Modify: `frontend/src/modals/RuinsPuzzleModal.js`
- Modify: ruins route and persistence tests

### Implementation

Complete solution integrity before raising rewards:

1. Set `ruins_reward_tier` during finalization using the explicit supported mapping:
   - World Tier 1 -> ruins Tier 1;
   - World Tier 2 -> ruins Tier 2; and
   - World Tiers 3-5 -> ruins Tier 3.
2. Persist the mapped value and add a database check/domain constraint for `[1, 3]`.
3. Derive separate puzzle and reward streams from the node's stable `local_seed` with fixed, versioned salts.
4. Generate the reward preview and actual award from the same reward stream so GET/POST call order and completion state cannot change the promised reward.
5. Apply the same active-character/party authorization, location, discovery, and normal progression-access policy to GET/preview and POST/solve. Return no puzzle state, tier, theme, or reward preview for an inaccessible remote node.
6. Replace the client-reported `moveCount` proof with a submitted move sequence or equivalent replayable solution. Reconstruct the deterministic initial puzzle server-side, validate every legal move, verify the solved board, and calculate the move count on the server.
7. Award and mark completion atomically and idempotently so retries cannot duplicate rewards.
8. Remove silent Tier-1 fallback for newly generated valid ruins. Keep a guarded legacy fallback with an observable warning/metric only for pre-remediation rows.
9. Version the puzzle/reward algorithm if changing it would otherwise alter already-issued puzzles.

### Acceptance criteria

- Higher-world-tier ruins receive higher puzzle and reward tiers according to the supported mapping.
- The route returns the persisted tier and a reward preview identical to the eventual award.
- Repeated visits retain the same deterministic puzzle behavior across incomplete/completed states.
- An unauthorized remote preview reveals no protected puzzle/reward data.
- A forged move count, illegal move sequence, remote solve attempt, replay, or concurrent double-submit grants no reward.
- Valid solving remains compatible with the intended frontend flow.

## Task 12: Use Node Seeds for Stable Tactical Terrain

**Files:**

- Modify: `api/src/routes/battle.js`
- Modify: `api/src/services/battle/encounterService.js`
- Modify: battle state/map persistence only if required to store terrain-generation version
- Modify: battle-entry, rejoin, and map-generation integration tests

### Implementation

1. Pass `world_nodes.local_seed` from the existing battle-entry route into encounter terrain generation.
2. Ensure the seeded generator controls terrain, elevation, obstacles, and tile variants that define the tactical map.
3. Define an explicit encounter terrain input contract such as `{ nodeType, localSeed, terrainGenerationVersion }`; avoid editing the `battleService.js` re-export unless its public signature actually changes.
4. Persist or include the terrain-generation version with battle/map state so a deployment does not silently regenerate a different layout for an active battle.
5. Keep battle entry, authorization, party validation, and UI controls unchanged.
6. Do not use world-node determinism to bypass normal encounter-state or completion rules.
7. Keep enemy selection, placement, combat rolls, and other battle-state randomness on separate streams and outside this scope unless separately designed.
8. Preserve the distinction between decorative world-map obstacles and intentionally blocking tactical-map obstacle cells.

### Acceptance criteria

- Starting the same encounter terrain contract repeatedly produces the same map seed, terrain, elevation, blocking obstacles, and tile variants.
- Rejoining an active battle returns the stored/versioned map rather than accidentally regenerating it through a different code path.
- Different node seeds can produce different valid maps.
- Existing terrain connectivity and spawn safety tests remain green.

## Task 13: Clarify Cosmetic Obstacle Semantics

**Files:**

- Modify comments in `api/src/db/worldgen/terrain.js`
- Modify: `api/src/db/seed.js`
- Modify: `frontend/src/worldmap/WorldMapConnectionRenderer.js` and relevant world-map layer owner
- Update: `docs/WORLDGEN_TECHNICAL_DEEP_DIVE.md`
- Update frontend documentation if obstacles are described as blockers

### Implementation

1. Consistently call these records “decorative world-map landmarks/obstacles” so they cannot be confused with tactical blockers.
2. Do not feed obstacle geometry into node placement, connection generation, or pathfinding.
3. Use the versioned world-obstacle RNG stream established in Task 1; changing landmark counts or draw order must not advance any structural/finalization stream.
4. Keep names/features on their own stream as well, so content-pool edits do not perturb graph topology.
5. Verify rendering order, contrast, and click targets keep roads and interactive nodes legible when they overlap decorative geometry.
6. Add an optional low-cost visual-density warning for landmark overlap around castles, nodes, labels, and major route junctions. Do not make it a topology rule.

### Acceptance criteria

- Documentation and comments match runtime behavior.
- Navigation results are unchanged when obstacle records are added, removed, or repositioned.
- For the same world seed, disabling obstacles or changing obstacle-count configuration leaves the normalized node, region, and connection graph identical.
- Changing name/feature pools does not change the normalized structural graph.
- Major routes and interactive nodes remain readable at supported map scales.

## Task 14: Add Blocking-Aware Graph Quality and Pacing Diagnostics

This task adds measurable player-experience diagnostics before imposing new hard generation constraints. Start as warnings/telemetry and promote a threshold to a hard invariant only after corpus data and playtesting justify it.

**Files:**

- Modify: `api/src/db/worldgen/validation.js`
- Add or modify: graph-analysis helpers and corpus report tooling
- Modify: worldgen quality tests

### Implementation

1. Reuse runtime-equivalent blocking semantics to report:
   - opening-safe-component size and Tier-1 boundary size;
   - minimum combat-gate counts from each castle to regional exits, zodiac shrines, the palace, and other progression anchors;
   - the delta introduced by every reward-site conversion;
   - route alternatives, shared-segment ratio, and trade/wilderness risk separation;
   - lower-risk-route dominance cases where trade is simultaneously safer, shorter, and at least as rewarding as wilderness;
   - degree distribution, true dead-end ratio, and unrewarded dead-end ratio;
   - articulation points/bridges whose removal isolates a progression anchor;
   - graph hop/Euclidean stretch and unusually long single-choice corridors; and
   - regional activity density and conditional profile share.
2. Produce aggregate percentile summaries for seeds `1..500` in CI artifacts and `1..5000` in the scheduled report rather than logging every warning per seed.
3. Establish playtest-oriented review bands for excessive opening-safe access, combat spikes, repetitive corridors, chokepoint concentration, and route-choice collapse.
4. Keep initial graph-quality bands soft. Document the evidence and player-facing failure mode before promoting any one to a generation-retry or hard-failure rule.
5. Include seed, generator version, output hash, route hash, and the smallest useful reproduction payload in every diagnostic.

### Acceptance criteria

- A corpus report makes pacing and topology outliers discoverable without changing valid output.
- Diagnostics are deterministic and do not mutate or consume generation RNG.
- The report can identify a seed/region/route/node by stable identity for reproduction.
- Any promoted hard threshold has corpus evidence, a documented gameplay rationale, and a bounded deterministic retry/failure strategy.

## Task 15: Apply Low-Risk Performance Improvements

This task follows correctness work and should be split or deferred if profiling shows no material benefit.

**Candidate files:**

- `api/src/db/worldgen/validation.js`
- `api/src/db/worldgen/internalConnections.js`
- `api/src/db/worldgen/terrain.js`
- `api/src/services/world/pathfindingService.js`

### Implementation

1. Build node-reference-to-index maps once instead of repeatedly calling `allNodes.indexOf()`.
2. Replace queue `shift()` calls with a head cursor.
3. Store BFS predecessors and reconstruct one path instead of copying full paths on every expansion.
4. If configurable world size exceeds the current target, replace repeated global nearest-node sorts and cubic MST scans with a priority queue and spatial index.
5. Avoid rebuilding normalized graph/hash structures for each validator; assemble shared maps once and pass an immutable validation context.
6. Add a generation benchmark before and after any algorithmic replacement.
7. Keep the corpus runner serial by default until generator isolation is proven; parallelize by seed only if it improves wall time without introducing shared-state nondeterminism or noisy memory pressure.

### Acceptance criteria

- Output remains deterministic and structurally identical for fixed seeds.
- Focused unit/integration suites remain green.
- Any larger algorithm change demonstrates a measurable benchmark improvement.
- Performance changes do not weaken diagnostics, stable ordering, or validator purity.

## Verification Matrix

| Verification | Command / method | Required result |
|---|---|---|
| Focused worldgen unit tests | `npm run test:unit:worldgen -w api` | Pass |
| Legacy validation tests | `NODE_ENV=test node --test api/src/tests/unit/worldgenValidation.unit.test.js` | Pass |
| Tactical map integration | `NODE_ENV=test node --test api/src/tests/integration/mapGeneration.integration.test.js` | Pass |
| Seeder import safety | Import assembly/seeder modules with database calls instrumented | No reseed, query, or process exit |
| New assembly regression suite | New pure assembly tests with seeds `86`, `164`, `212`, `320`, `445`, `12345` | Pass |
| CI seed corpus | Generate and validate seeds `1..500` | Zero structural failures |
| Extended seed sweep | Generate and validate seeds `1..5000` outside the fast CI lane | Zero structural failures |
| Determinism and hashes | Compare canonical outputs and SHA-256 hashes from two runs of each sampled seed/version | Identical |
| RNG isolation | Change obstacle counts and name/feature draw counts, then compare structural output | Structural graph identical |
| Finalizer/validator purity | Deep-freeze or fingerprint finalized input and validate twice | No mutation/RNG consumption; identical diagnostics |
| Castle/Voronoi coordinate ownership | Compare frozen generator points, finalized castles, and queried castle rows | Exact coordinate equality; all adjusted regional nodes remain inside their assigned cells |
| Region-route identity | Reconstruct routes from persisted manifest plus connection route/pair/order fields | Declared regions, endpoints, ordered segments, tier policy, and path types match |
| Database round-trip | Insert into disposable PostgreSQL and normalize queried rows without DB IDs/timestamps | Matches pre-insert validated model/hash |
| Opening progression | Discover each castle's full runtime-equivalent nonblocking component and inspect every boundary edge | Designated safe edge retained; nonempty Tier-1 combat boundary only |
| Traversal-contract parity | Run shared blocked-target/cleared-target fixtures through validator, server pathfinding, and frontend reachability | Identical destination/expansion results; no reachability through uncleared blockers |
| Trade-route behavior | Inspect every blocking route segment and uncleared pathfinding | Trade at least one tier lower than competing wilderness; traversal blocked |
| Reward-site gate safety | Compare source-to-anchor 0-1 BFS vectors before/after each conversion | No minimum combat-gate decrease |
| Route presentation | Render representative road/trail/bridge/tunnel routes through effects and fallback paths under color-vision simulation | Both render paths remain legible without color alone |
| Stable battle map | Enter/generate the same node seed twice | Identical terrain, elevation, obstacles, and variants |
| Battle rejoin | Create then rejoin an active battle across the normal route/service path | Stored map seed/version and layers retained |
| Ruins scaling/integrity | Sample mapped tiers; request unauthorized previews; replay valid/invalid/remote/concurrent solve submissions | Tier/reward match; remote preview is denied; only one authorized legal solve awards |
| Seed metadata contract | Compare configured, assembled, persisted, and API-reported metadata | Seed, versions, structural/output/route hashes match |
| Seed atomicity | Inject pre-mutation, post-truncate, post-world-insert, and late-helper failures | Existing database state remains unchanged |
| Graph-quality report | Produce aggregate corpus diagnostics | Deterministic report with stable reproduction identities |

Baseline at audit time:

- focused worldgen suite: 208 tests passed across 35 suites;
- legacy validation suite: 54 tests passed across 11 suites;
- tactical map integration suite: 27 tests passed across 5 suites; and
- `node --check api/src/db/seed.js`: passed.

At audit time, the focused map integration directly exercised terrain generation but did not prove that battle entry passed `local_seed` or that rejoin preserved the stored map. The assembly/transaction suites named above did not yet exist.

An exploratory seeds `1..100` assembly sweep took approximately 5.1 seconds on the audit environment (about 51 ms/seed with logs suppressed), supporting `1..500` in CI and `1..5000` in a scheduled/manual lane. The audit-time validator did not throw for the sampled regression seeds even while reporting hundreds of orphan and spacing findings, which confirmed that passing phase-local tests and a completed seed command were not evidence of a valid final world.

## Implementation Verification (2026-07-27)

The recommended product defaults in this plan were used as the implementation decisions. The settled implementation was verified with the following evidence:

| Area | Verification evidence | Result |
|---|---|---|
| Canonical assembly, regression seeds, deterministic streams, finalization, validation, metadata, ruins, traversal, battle terrain, and persistence helpers | `npm run test:worldgen:unit -w api` | 365 tests passed across 63 suites; zero failures |
| Live map, battle/rejoin, node-blocking, ruins, and route contracts | `npm run test:worldgen:integration -w api` against a disposable PostgreSQL 16 database and running API | 114 tests passed across 30 suites; zero failures |
| Reset transaction, rollback, catalog locking, and inherited-table protection | Opt-in `seedPersistenceRollback.integration.test.js` against disposable PostgreSQL | 3 tests passed; injected rollback paths, concurrent dependency attachment, and populated same-name inherited-table refusal preserved prior rows |
| Traversal regression exposed during final verification | Focused `nodeBlocking.integration.test.js` after selecting the true opposite edge endpoint deterministically | 13 tests passed; zero failures |
| Extended deterministic corpus | Schema-v3 report for seeds `1..5000` | 5,000 worlds validated with zero structural failures; aggregate reward dead-end share `0.149993`, activity density `0.254625`, and maximum conditional activity-profile deviation `0.002812` |
| Database round-trip and published seed contract | Fresh migrations `001..049`, seed `86420`, normalized pre-commit query comparison, and `/api/world/seed` comparison | Exact normalized round-trip; 5 regions, 591 nodes, and 807 connections; persisted and API seed/version/output/structural/route hashes matched |
| Operational reset safety | Backup, authorized reset, failure injection, and restore rehearsal with checksum verification | Backup and restore completed successfully; failed resets rolled back without changing the prior world |
| Broader regression coverage | API unit, shared, and frontend suites | API 3,467/3,467; shared 626/626; frontend 294/294 |
| Static and build gates | API/frontend lint, JavaScript syntax checks, workflow YAML parse, frontend production build, and `git diff --check` | Passed; only the pre-existing frontend unused-variable warning and normal bundle-size warnings remained |
| CI automation | `.github/workflows/worldgen-ci.yml` | Push/pull-request lane runs PostgreSQL-backed worldgen tests plus seeds `1..500`; scheduled/manual lane runs seeds `1..5000`; reports are uploaded as artifacts |
| Independent review | Final correctness, security, regression, and coverage review of the settled diff | No P0-P3 findings remained |

One deliberately recorded validation gap remains: the fixed-point case where a concurrent grandchild foreign key is attached to a newly discovered child is modeled with staged catalog snapshots in the unit suite rather than a live PostgreSQL race. Direct root dependency attachment and inherited-table behavior are covered by the live PostgreSQL tests.

## Delivery Order

1. **Foundation:** Task 1 establishes import-safe pure orchestration, the seed/version contract, named RNG streams, canonical encoding primitives, and red regression fixtures.
2. **Graph identity:** Task 2 establishes castle/cell identity. Tasks 3 and 4 then land as one coordinated canonical-graph/route-model change.
3. **Finalization and validation:** Task 5 separates deterministic mutation from read-only fail-closed validation.
4. **Persistence contract:** Task 6 owns canonical metadata, difficulty precedence, local seeds, hashes, the persisted route manifest, transaction ownership, and API reporting. Complete disposable-database round-trip and failure-injection coverage here.
5. **Progression:** Complete Tasks 7, 8, and 10 together against shared blocking semantics; a reward-site conversion or route repair must not invalidate opening/trade guarantees.
6. **Theme and activities:** Complete Task 9 after stable region identity, preserving aggregate density while tuning conditional profile weights.
7. **Ruins integrity and scaling:** Complete Task 11 access/solution/idempotency work before enabling higher rewards.
8. **Encounter and presentation consistency:** Complete Tasks 12 and 13, including battle rejoin and map-legibility checks.
9. **Quality telemetry:** Task 14 establishes corpus-based pacing/topology evidence.
10. **Performance:** Task 15 follows correctness and profiling.
11. **Documentation:** Update the technical deep dive, architecture summary, gameplay roadmap, and route legend after behavior is implemented and verified.

Tasks 1-6 are one release/merge gate even if their commits are reviewed incrementally; no partial reset pipeline is releasable. Tasks 2 and 4 must not proceed in parallel: both alter Voronoi identity, and Task 4 depends on Task 2's representation. Tasks 3 and 4 must be integrated and reviewed together because both change endpoint identity in `interRegionConnections.js`. Tasks 7-13 must not be accepted against the old graph assembly because corrupted indices can invalidate gameplay assertions.

## Rollout and Operational Safety

1. Assemble and hard-validate the complete replacement world before touching shared database state.
2. Treat the supported command as bootstrap/reset, not live-world migration. Refuse a nonempty persistent/player environment by default; require an explicit destructive-reset authorization, maintenance window, and verified backup to proceed.
3. Preflight player-linked and world-linked tables and print the destructive scope. Atomicity prevents a failed replacement; it does not preserve player state after a successful replacement.
4. Test reseeding only against a disposable development/test database until all transaction and round-trip checks pass. The current workflow truncates world, item, enemy, shop, and market data and can affect many node-linked records.
5. Execute every participating truncation/helper insertion through one transaction-scoped client. Treat a helper that uses the global pool, swallows errors, or commits independently as a release blocker for the atomicity claim.
6. Persist the resolved `WORLD_SEED`, generator/stream versions, structural graph hash, normalized world-output hash, and route-manifest hash in the same transaction.
7. Query and validate the inserted representation before commit:
   - node and edge counts;
   - orphan count;
   - region/castle/guild records, including exact frozen castle/Voronoi coordinates and regional cell membership;
   - castle opening neighbors;
   - route-region/pair/order identity and path types against the validated and persisted route manifest;
   - tier distribution;
   - ruins tiers; and
   - runtime-equivalent navigation/gate metrics between every castle and required progression anchors.
8. Commit only after the database round-trip representation passes. If any pre-commit validation or insertion fails, roll back and do not publish the new world.
9. Run rendering and external smoke checks after commit. Because an ordinary transaction cannot roll back after commit, restore the verified snapshot if a material post-commit failure is found.
10. A future live-world migration must explicitly map or version world nodes and dependent player state; it is not satisfied by this reset transaction.

## Documentation Follow-up

After implementation:

- update `docs/WORLDGEN_TECHNICAL_DEEP_DIVE.md` with the canonical graph model, finalization/validation boundary, hard rules, lower-risk trade routes, opening-safe components, reward-site behavior, regional profiles, and decorative world-obstacle semantics;
- correct its castle-adjacency, “castle only leads to battle,” exact-dead-end terminator, and `WORLD_SEED` descriptions to match the implementation;
- update `docs/TECHNICAL_ARCHITECTURE.md` if world assembly moves out of `seed.js`;
- update `docs/ROADMAP_GAMEPLAY.md` to replace “safe trade corridor” with lower-risk combat-route language and repair the stale regional-worldgen design link;
- document persisted route/path visual semantics and the ruins tier mapping in the relevant gameplay/UI references;
- document that the seed command is a destructive bootstrap/reset and that live-world migration is separate; and
- archive this plan only after all acceptance criteria are complete.

## Definition of Done

- All critical, high, and medium audit findings are implemented or explicitly deferred with an owner and reason.
- The review assumptions are confirmed by product direction or replaced with approved alternatives and corresponding tests.
- Targeted reproduction seeds and the CI seed corpus pass final-assembly validation.
- No generated or persisted connection has an invalid or unintended endpoint.
- Finalization is deterministic, validation is read-only, and persistence serializes the exact validated representation.
- Validation blocks persistence of a structurally invalid world and never silently discards a node/edge.
- Resetting is atomic across every participating helper: injected early, mid-insert, and late-helper failures preserve prior database state.
- Successful reset remains explicitly scoped to bootstrap/disposable or authorized destructive environments.
- Confirmed gameplay decisions are represented by automated tests.
- Opening, trade, and reward-site progression pass runtime-equivalent blocking analysis.
- Frontend reachability, server pathfinding, and generation validation agree on blocked-node destination and expansion semantics.
- Ruins reveal no protected remote preview and cannot award for a forged, remote, replayed, or concurrently duplicated solve.
- Persisted/API seed metadata, normalized route manifest, per-connection route identity, and route/path presentation match the generated world.
- Existing focused tests remain green.
- Reset, rollback, backup/restore, and non-goals for live-world migration are documented and tested in a disposable environment.
- Canonical world-generation documentation reflects the implemented behavior.
