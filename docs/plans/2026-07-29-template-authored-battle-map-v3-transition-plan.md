# Template-Authored Battle Map V3 Transition Plan

**Date:** 2026-07-29

**Status:** Approved direction; implementation not started

**Initial rollout:** Forest PvE, 32×32

**Activation policy:** Automatic from deployed tracked catalog coverage; no
environment variables, feature flags, activation gates, shadow switches, or
kill switches

**Full content target:** 16 battle themes × 3 source templates × 3 approved
maps = 48 source templates and 144 approved maps

**Supersedes for new map creation:** The runtime-procedural direction documented
in `2026-07-28-organic-isometric-battle-map-generation-plan.md`

**Retains during migration:** Existing BattleMap V1/V2 loading, persistence,
traversal, and rollback compatibility

## 1. Decision Summary

Modia will stop trying to obtain complete organic battle scenes by generating
their topology at battle runtime. Battle maps will instead be authored and
approved offline from biome/theme reference images, compiled into immutable
BattleMap V3 artifacts, and selected from a versioned catalog when a battle is
created.

The approved direction is:

- A template image is a **compositional reference**, not a literal image-to-grid
  trace.
- Every source image has a reviewed semantic sidecar describing the intended
  topology, height language, paths, boundaries, formations, and key features.
- Codex may analyze a source and propose map blueprints or art candidates, but
  its output is untrusted and never becomes runtime content directly.
- A deterministic compiler owns gameplay semantics, stable identity, exact
  asset selection, validation, canonical serialization, and hashes.
- The runtime performs no Codex calls and no topology generation. It only
  selects an approved map and assigns the actual encounter units to authored
  candidate positions.
- Battle-map schema/content versions are independent of the battle runtime
  protocol. V3 may change initial map hydration and rendering data, but it must
  not fork action submission, turn events, camera control, intent
  visualization, battle logging, polling, or state reconciliation.
- V3 has no environment-controlled activation. Deploying an approved tracked
  catalog entry makes V3 automatic for every compatible encounter that resolves
  to that entry. No feature flag, enabled-profile list, shadow-mode switch,
  kill switch, catalog-release environment variable, or configurable fallback
  switch may be added.
- Immutable-map reference/delta transport is a separate optimization project,
  not a prerequisite or rollout vehicle for V3 content. V3 does not activate or
  configure that transport; any existing V2 experiment remains outside the V3
  path and must not be copied into it.
- NPC placement remains encounter-aware at runtime because the offline map
  cannot know the final enemy roster. Placement uses role-aware, deterministic
  scoring over authored spawn candidates.
- BattleMapSchemaVersion 3 is a new contract. V1/V2 are not modified in place.
- During migration, V2 remains a deterministic compatibility fallback only
  when the deployed catalog has no eligible V3 content. Client capability does
  not negotiate a lower version for a new battle; an incompatible client gets
  an upgrade-required response. New V2 creation is removed in code after V3
  catalog coverage and stability criteria are met. V2 read compatibility
  remains until persisted V2 battles and required replays have aged out.
- Historical V1/V2 battles remain readable by stored schema. Client capability
  does not select V1/V2 for a new battle; clients unable to render the
  automatically selected map receive an upgrade-required response.
- Large template, candidate, and generated art binaries remain git-ignored and
  locally backed up. Small JSON metadata, prompts, descriptors, schemas,
  approved map artifacts, hashes, and catalogs remain tracked.
- Every template, map, tile family, and obstacle family requires human visual
  approval in addition to automated bulk validation.

## 2. Content Vocabulary

The implementation must use these terms consistently:

| Term | Meaning |
|---|---|
| **Battle theme** | One of the 16 player-facing battle environments, such as `forest`, `swamp`, or `vampiric_crypt`. A theme is more specific than the current five render palettes. |
| **Render profile** | The exact art catalog, palette, lighting, materials, and renderer capabilities used by a theme. Several themes may inherit a base profile, but each theme has an explicit profile and may override it. |
| **Source template** | A local reference image plus a tracked, reviewed semantic sidecar. It communicates composition and art direction. |
| **Candidate blueprint** | Untrusted Codex-authored symbolic map data created from a source template. It is never loaded by the game. |
| **Approved blueprint** | A reviewed candidate whose source, prompt, and output hashes have been pinned. |
| **Compiled map** | A deterministic, closed, hash-verified BattleMap V3 JSON artifact derived from an approved blueprint. |
| **Catalog release** | An immutable ordered manifest of approved compiled maps and their eligibility, tier, weight, and hashes. |
| **Map instance** | The complete immutable compiled map persisted with one battle plus mutable, encounter-specific unit positions. |

The 16 initial themes are:

1. `forest`
2. `cave`
3. `mountain`
4. `bridge`
5. `castle`
6. `dungeon`
7. `swamp`
8. `volcano`
9. `plains`
10. `arena`
11. `guild`
12. `elven_grove`
13. `dwarven_mine`
14. `vampiric_crypt`
15. `orcish_warcamp`
16. `human_ruins`

The initial content model assigns one source template to each default tier band:

| Template slot | Default battle tiers | Approved maps | Intended progression |
|---|---:|---:|---|
| Low-tier template | 1–2 | 3 | Readable routes, limited elevation complexity, generous formation exits |
| Mid-tier template | 3–4 | 3 | More branching, cover, elevation choices, and biome hazards |
| High-tier template | 5 | 3 | Strong theme landmarks, advanced tactical choices, boss-capable staging |

Tier eligibility is catalog data, not a filename convention. A reviewed template
may support a different band when its composition warrants it.

## 3. Current-State Audit

### 3.1 Runtime map production

The authoritative map boundary is
`api/src/services/battle/battleMapGenerationService.js`. It selects V1 or V2
through capability negotiation and dispatches to `shared/mapGeneration.js`.
Production callers are:

- `api/src/routes/battle.js` for PvE;
- `api/src/services/guildmasterBattleService.js` for advancement battles; and
- `api/src/services/coliseum/matchLifecycle.js` for Coliseum battles.

V1 and V2 exhibit different versions of the reported visual problem:

- V1's `clearSpawnAreas()` in
  `shared/mapgen/v1/mapGenerationV1.js` clears broad east/west bands, removes
  obstacles, replaces terrain, and flattens elevation. This directly creates
  the detached, flat formation edges.
- V2's `resolveSpawnLayout()` in
  `shared/mapgen/v2/SpawnLayoutContract.js` improves the protected shape but
  still begins from fixed edge-oriented formations: west/east for PvE and
  north/south for competitive modes.
- V2's `BattleMapGenerator.js` builds coherent fields, regions, hydrology,
  routes, ecology, and visual records, but the complete scene is still selected
  from the same procedural grammar at runtime. High validation scores therefore
  do not guarantee strong composition or meaningful visual variety.
- V2 finalization serializes only the enemy slots selected for the current
  `enemyCount`. A reusable offline map instead needs a stable pool of candidates
  and must keep actual unit positions out of the immutable map.

### 3.2 Existing foundations to retain

The refactor should replace topology production, not the reliable systems
around it:

- `shared/battleMap/schema.js`, `hashes.js`, and `BattleMapAdapter.js` provide a
  strong closed-schema, canonical-hash, immutable-map pattern.
- `api/src/services/battle/BattleStateRepository.js` already persists the full
  immutable map and its version/hash with the battle.
- `shared/traversal.js` combines terrain, movement costs, obstacles, elevation
  connections, and occupancy.
- `frontend/src/battle/BattleMapSession.js` verifies and caches immutable maps
  from snapshots.
- `frontend/src/battle/BattleGrid.js` already renders material floors, exposed
  faces, elevation, connections, transitions, decorations, props, and units in
  a shared depth queue.
- Existing visual/audit tooling provides a useful base:
  `frontend/battle-map-visual.html`,
  `frontend/src/dev/BattleMapVisualHarness.js`,
  `e2e/battle-map-render.spec.js`, `scripts/audit-battle-maps.js`, and the
  `battle-maps:*` package scripts.

### 3.3 Current visual-asset constraints

The existing isometric compiler is deterministic rather than AI-authored:

- `scripts/tiles/generate-isometric-tiles.js` reads
  `ai-image-metadata/tiles/manifest.json`;
- `scripts/tiles/isometricCompiler.js` creates the canonical assets; and
- `scripts/tiles/validate-isometric-tiles.js` enforces projection, alpha,
  dimensions, and shared edges.

The current `iso64-retina-v3` geometry is worth retaining:

| Asset kind | Source dimensions | Visible/logical contract |
|---|---:|---|
| Floor | 128×128 | 64×32 visible 2:1 diamond in a 64×64 logical box |
| Slope/stairs | 128×128 | Same 2:1 footprint and logical box |
| Exposed face | 128×32 | Renderer-mapped 64×16 logical strip |

However:

- there are only five base render palettes for 16 battle themes;
- V2 renders one generic `${palette}:face:stone` exposed-face asset regardless
  of the actual material;
- many transitions and decorations are code-native overlays rather than
  cohesive authored tile families;
- obstacle assets do not share a complete theme-specific manifest with terrain;
  and
- independent floor variants cannot express complete route junctions, organic
  banks, cliff caps, roots, dense biome boundaries, or movement semantics.

V3 therefore extends the geometry compiler into a deterministic **art
compiler** that consumes approved AI candidates. AI provides interior material
and prop artwork; code still owns projection masks, edge compatibility,
directional transforms, alpha, anchors, output encoding, and exact identity.

### 3.4 Available battle-tier and unit data

PvE creation already reads `world_nodes.difficulty_tier`, which is constrained
to 1–5, but does not currently pass it into map generation. Current PvE enemy
counts are:

| Tier | Enemy count |
|---:|---:|
| 1 | 3–4 |
| 2 | 3–5 |
| 3 | 4–6 |
| 4 | 5–7 |
| 5 | 5–7 |

`MAX_BATTLE_PARTY_SIZE` is five. V2 accepts an opposing spawn-candidate pool up
to 24, while current PvE encounters assign at most seven enemies. Battle units
are one tile and already expose most tactical placement signals:

- `aiType`;
- `archetype` and class;
- `movement`;
- `attackRange`;
- skills and abilities;
- hidden/ambush state; and
- boss state.

There is no canonical `spawnRole` and no multi-tile unit footprint. V3 should
add a versioned role classifier but must not make multi-tile units a dependency
of this transition.

## 4. Forest Starter Template Assessment

The starter image currently exists locally at:

`frontend/public/assets/battle-maps/forest-template.png`

It is 1254×1254 and is correctly ignored under the current asset policy. It
should be staged into the new local template-source layout and hash-pinned by a
tracked sidecar; it should not be referenced only by an unversioned public path.

Useful compositional characteristics include:

- several differently sized clearings rather than one rectangular arena;
- paths that bend around rock, vegetation, and elevated landforms;
- terrain terraces with stairs placed where routes logically change height;
- dense forest and rock formations that own the scene boundary;
- a broad lower clearing that can become a formation area without flattening
  an entire edge;
- multiple upper and lateral staging opportunities for opponents; and
- visual obstruction and cover that follow biome features instead of random
  wall placement.

The image must not be treated as a direct coordinate trace. Its sidecar should
identify which motifs are mandatory, optional, or forbidden. Codex may propose
several 32×32 interpretations, but reviewers decide the actual playable
silhouette, height levels, formation regions, routes, and asset requirements.

### 4.1 Source-template creation workflow

The tooling must support both supplied source images, such as the forest
starter, and locally generated source-template images for future themes.

For a generated source:

1. Draft a tracked template-concept record containing theme, tier intent,
   compositional goals, required biome features, negative constraints, and a
   frozen image prompt.
2. Run isolated Codex/image-generation workers that write only ignored local
   source-image candidates and logs.
3. Present candidates in a contact sheet/browser review without attempting to
   extract gameplay tiles.
4. Explicitly approve one source image and pin its path, dimensions, prompt,
   input references, and SHA-256.
5. Complete and review the semantic sidecar against that approved composition.
6. Only then generate the three symbolic map blueprints.

For a supplied source, the stage command begins at step 4 after validating and
copying or registering the exact local file.

A source-template image prompt is theme- and tier-specific. It describes a
complete battle-scene composition while avoiding literal grid or unit
placement. For example:

```text
Create a square compositional reference for a low-tier forest tactical battle
scene. Show an organic network of two main clearings and one smaller elevated
lookout connected by curved dirt paths. Integrate gradual terraces, a small
number of readable stairs, rock and root formations, and dense forest that
naturally owns the outer boundary. Leave two opposing formation opportunities
inside the environment, each connected by more than one approach, without
drawing units, spawn markers, a tactical grid, or a flat cleared edge strip.
The image is visual inspiration for later 32×32 isometric map authoring, not a
literal tile map. Avoid symmetric arena geometry, random freestanding walls,
checkerboard materials, isolated height spikes, text, labels, UI, and
perspective that hides walkable surfaces.
```

The prompt profile must vary ecological/architectural vocabulary and tactical
complexity by theme and tier. Approval judges composition, not whether the
image could be cut directly into game tiles.

## 5. Goals and Non-Goals

### 5.1 Goals

- Organic, theme-specific scenes with intentional composition.
- No broad flat spawn strips. Formation areas are local clearings, rooms,
  platforms, bridges, or approaches within the scene.
- Gradual, readable height changes. Traversable level changes have matching
  slope/stair art; larger changes are visibly blocked cliffs.
- Visual movement semantics: blockers look blocking, costly terrain looks
  costly, routes look easy to traverse, and height connections are unambiguous.
- Natural boundaries owned by a biome feature such as canopy, rock wall,
  water, structure, lava, or ruins.
- Meaningful diversity between approved maps, not only seed noise, palette
  swaps, mirroring, or rotations.
- Deterministic tier-grouped map selection from an immutable catalog release.
- Encounter-aware player and NPC positioning over author-approved candidate
  locations.
- A repeatable local workflow for source analysis, map generation, tile/prop
  generation, validation, preview, approval, compilation, and catalog release.
- Reuse of current authoritative traversal, full-map persistence, snapshot
  verification, and battle rendering wherever their contracts remain valid.
- Exact V1 gameplay-presentation parity for player and enemy actions: the same
  event order, camera movement, intent highlights, movement animation, battle
  log entries, turn ownership, and drift behavior regardless of map version.

### 5.2 Non-goals

- No map or image generation at runtime.
- No Codex or external model dependency in production or CI.
- No literal pixel tracing of a template image.
- No automatic visual approval.
- No arbitrary map dimensions in the initial catalog. The pilot is 32×32.
- No multi-tile unit occupancy in the initial migration.
- No change to the core movement-cost or combat rules merely to accommodate
  artwork.
- No V3-specific battle action, WebSocket event, mutable-state update, camera,
  intent, log, or polling path.
- No immediate deletion of V1/V2 readers required by persisted battles.

## 6. Target Architecture

```text
tracked template concept/prompt
  + supplied image or isolated Codex source-image candidates
                                      |
                         human source-image approval
                                      |
local ignored approved template image
  + tracked reviewed semantic sidecar and prompt profile
                    |
                    v
       isolated Codex blueprint candidates
                    |
             human blueprint review
                    |
                    v
       deterministic semantic compiler
         |          |             |
         |          |             +--> asset requirement report
         |          +--> tactical/topology validation
         +--> draft BattleMap V3 artifact
                                      |
                    per-theme tile/obstacle descriptor drafting
                                      |
                    isolated Codex image candidates
                                      |
                         human family approval
                                      |
                    deterministic isometric art compiler
                                      |
                    exact asset validation and browser preview
                                      |
                         explicit map approval
                                      |
                  tracked compiled map + catalog release
                                      |
                                      v
                    runtime compatibility filtering
                                      |
                      deterministic tiered selection
                                      |
                 role-aware encounter spawn assignment
                                      |
                       persist complete immutable map
                                      |
                 verify/hydrate map once at battle entry
                                      |
                   existing shared battle runtime path
             (actions, turn events, camera, intent, log, polling)
```

The trust boundary is deliberate:

- Codex can write only candidates.
- Review can approve only exact hashes.
- The compiler accepts only approved, pinned inputs.
- The publisher recomputes every gameplay and asset fact.
- Runtime accepts only compiled maps found in a verified catalog release.

“Candidate-only” is an enforced process boundary, not a prompt convention.
Every model job runs in a disposable workspace with a writable allowlist limited
to its declared candidate/log directory. The parent process snapshots the
allowed output tree before and after the job, rejects undeclared files or
changes, enforces byte/count/time limits, and copies validated candidates into
the local candidate store only after the worker exits. The new runners must not
inherit the broader filesystem access used by any older experimental runner.

## 7. Repository and Asset Layout

The exact names can change during implementation, but separation of tracked
metadata, ignored binaries, candidate work, and runtime content is mandatory.

```text
ai-image-metadata/
  battle-maps/
    manifest.json                         # tracked
    prompts/
      source-template-image-v1.json        # tracked
      source-analysis-v1.json             # tracked
      map-blueprint-v1.json               # tracked, frozen template-01/-02 profile
      map-blueprint-v2.json               # tracked, template-03+ fixed-family profile
    templates/
      forest/
        forest-template-01.json           # tracked sidecar
    sources/
      forest/
        forest-template-01/
          reference.png                   # ignored, local, hash-pinned
          style.png                       # ignored, optional, hash-pinned
    candidates/
      forest/
        forest-template-01/
          ...                             # ignored local candidates/logs
    blueprints/
      forest/
        forest-template-01/
          forest-template-01-a.json       # tracked approved blueprint
    review/
      forest/
        forest-template-01/
          ...                             # ignored local screenshots/sheets

  battle-art/
    manifest.json                         # tracked
    prompts/
      floor-family-v1.json                # tracked
      transition-family-v1.json           # tracked
      exposed-face-v1.json                # tracked
      connection-v1.json                  # tracked
      obstacle-v1.json                    # tracked
      decoration-v1.json                  # tracked
    themes/
      forest/
        surfaces.json                     # tracked descriptors
        transitions.json
        faces.json
        connections.json
        obstacles.json
        decorations.json
    sources/                              # ignored approved source images
    candidates/                           # ignored raw candidates

shared/
  battleMap/
    v3/
      schema.js
      hashes.js
      compiler.js
      validator.js
      catalog.js
      selector.js
      spawnAssignment.js
    content/
      v3/
        catalog.json                      # tracked catalog release
        asset-bundles/
          <asset-bundle-id>.json          # tracked exact binary manifest
        maps/
          forest/
            forest-template-01-a.json     # tracked compiled map

scripts/
  battle-maps/
    stage-template.js
    draft-template.js
    generate-template-images.js
    generate-map-candidates.js
    compile-maps.js
    validate-maps.js
    approve-map.js
    build-catalog.js
    preview-server.js
    generate-gallery.js
  battle-art/
    audit-requirements.js
    draft-art.js
    generate-art-candidates.js
    compile-art.js
    validate-art.js
    approve-art.js

frontend/public/assets/battle-map-v3/
  <asset-bundle-id>/
    <theme>/
      <asset-key>.<content-hash>.webp      # ignored immutable runtime art
```

### 7.1 Local-only binary policy

The repository will not store the large template, raw candidate, approved
source, screenshot, or compiled runtime art binaries. The implementation must
still make local state auditable:

- every local binary has a path, byte length, dimensions, format, and SHA-256
  pin in tracked JSON;
- scripts refuse missing or hash-mismatched inputs;
- `--force` is required to replace a pinned candidate;
- approval never silently changes when a file changes;
- an inventory command emits a complete machine-readable list for manual
  backup;
- a strict release check verifies the restored local asset bundle before a
  production build; and
- clean CI runs metadata/schema/compiler tests that do not pretend ignored
  binaries are present.

Compiled runtime art is immutable and content-addressed. A map references an
exact asset-bundle manifest and exact versioned/hash-bearing paths such as
`/assets/battle-map-v3/<assetBundleId>/<theme>/<key>.<hash>.webp`; scripts never
replace bytes at an existing identity. A catalog release binds the map hashes
and asset-bundle manifest hash as one release unit. Publication must stage and
verify the complete bundle before switching the catalog/code release, and
rollback must retain and select the matching older bundle. Old bundles remain
available for persisted battles and browser caches until their retention
requirements expire.

The current `ai-image-metadata/**/*.json` exception would otherwise expose local
candidate JSON. Implementation must add later, more-specific ignore rules for
the new `battle-maps/candidates`, `battle-maps/review`, and
`battle-art/candidates` trees while re-including only explicitly promoted
blueprints/descriptors.

Approved blueprint JSON, compiled BattleMap V3 JSON, and catalog JSON are
runtime/reproducibility data, not large image assets, and should remain tracked
so the authoritative server is deployable and testable from the repository.

## 8. Source Template Sidecar

Each source template sidecar is a closed JSON document. At minimum it contains:

```text
schemaVersion
id
theme
status
tierEligibility
supportedModes
mapProfile
sourceImage
styleAuthority
composition
topologyIntent
heightIntent
routeIntent
boundaryIntent
spawnIntent
requiredLandmarks
forbiddenPatterns
assetHints
promptProfile
candidateMaps
pins
review
```

Important records:

- `sourceImage`: local project-relative path, SHA-256, width, height, format.
- `mapProfile`: initially 32×32, orientation, intended camera framing,
  `playerCapacity`, `candidatePoolSize`, and `maxAssignableOpponents`.
- `composition`: prose describing the visual hierarchy, focal areas, negative
  space, density, and how the scene should read.
- `topologyIntent`: named areas and relationships, not final tile coordinates.
- `heightIntent`: desired level count, terraces/ridges/basins, maximum gradual
  slope, and where stairs or cliffs make sense.
- `routeIntent`: required primary and secondary approach relationships.
- `boundaryIntent`: owning biome features and whether the rendered/playable
  silhouette may be irregular.
- `spawnIntent`: two current opposing sides, formation character, minimum
  approaches, local clearance, candidate roles, and forbidden spawn behavior.
- `forbiddenPatterns`: full-height cleared strips, arbitrary walls, unexplained
  single-tile peaks, detached spawn pads, checkerboard materials, repeated
  straight boundaries, or large visually ambiguous movement regions.
- `candidateMaps`: exactly three desired map IDs for an approved template.
- `pins`: exact source, prompt-profile, approved-blueprint, and compiler hashes.

The sidecar is reviewed before Codex map generation. A generated map may
interpret the image, but it may not redefine the sidecar's gameplay contract.

## 9. Candidate Blueprint Contract

Codex outputs a symbolic `TemplateMapBlueprint`, not a trusted BattleMap V3.
The candidate schema is closed, bounded, and deliberately simpler than runtime
data:

- stable candidate and template IDs;
- width and height;
- `renderMask` and `playableMask`;
- symbolic surface/material grid;
- discrete integer height-level grid;
- named regions and biome-owned feature records;
- route centerlines and widths;
- explicit slope, stair, and cliff intent;
- blocking obstacle intents;
- nonblocking decoration intents;
- boundary feature intents;
- ordered player formation candidates;
- tagged opposing formation candidates;
- spawn exits and approach requirements;
- tactical annotations such as high ground, cover, flank, ambush, support,
  frontline, boss, reserve, and no-spawn;
- expected asset families; and
- generation notes for reviewers.

Codex may not supply movement costs, pass/fail validation results, canonical
hashes, runtime asset paths, database values, or executable code. The compiler
derives those values from versioned catalogs and shared gameplay rules.

Candidate parsing must enforce:

- closed keys;
- safe lowercase IDs;
- JSON-only values;
- strict byte, depth, string, and collection limits;
- fixed project-owned output paths;
- no path traversal or model-selected paths;
- no duplicate coordinates or identities; and
- no acceptance of a candidate's own claims that it is safe or valid.

### 9.1 Blueprint prompt profile

The tracked blueprint prompt is assembled from immutable sections:

```text
closed TemplateMapBlueprint schema and output limits
+ approved source-template image/hash
+ reviewed semantic sidecar/hash
+ theme and tier-band vocabulary
+ one explicit variant brief
+ topology, elevation, boundary, and spawn constraints
+ diversity requirements relative to sibling variants
+ forbidden fields/patterns
+ JSON-only output contract
```

The prompt-profile identity is versioned at the legacy-content boundary:
template-01/-02 retain the frozen `map-blueprint-v1` bytes and pins, while
template-03 and newer use `map-blueprint-v2` with the corrected fixed-family
contract. A correction for new templates must never rewrite the legacy prompt
or its approval evidence.

Each of the three jobs receives a distinct reviewed variant brief—for example,
route-network emphasis, terraced-clearing emphasis, or landmark/flank
emphasis—so diversity does not depend on a temperature setting. A forest
blueprint prompt should communicate requirements along these lines:

```text
Author one 32×32 symbolic forest battle-map blueprint for
forest-template-01, variant A. Treat the approved image only as a
compositional reference and obey the reviewed sidecar as the gameplay intent.
Build an irregular rendered silhouette with two connected interior formation
areas, curved primary and secondary approaches, gradual terraces, and
biome-owned canopy/root/rock boundaries. Provide five ordered player slots, at
least 24 valid opposing candidate cells tagged for useful placement roles, and
support at most seven simultaneously assigned opponents. Keep every spawn on a
playable, nonblocking surface with multiple legal approaches. A traversable
height step may change only one level and must declare a matching stair or
slope; larger changes must be explicit blocked cliffs. Do not create a cleared
edge strip, detached spawn pad, arbitrary wall, single-cell height spike,
checkerboard material field, literal trace, runtime asset path, movement cost,
hash, validation claim, prose outside the output, or executable content.
Return exactly one JSON object matching the supplied closed
TemplateMapBlueprint schema.
```

The prompt may request symbolic materials, features, and annotations only.
Schema validation and deterministic compilation—not prompt wording—enforce the
actual contract.

## 10. BattleMap V3 Contract

BattleMap V3 should preserve useful V2 concepts while removing procedural-only
assumptions.

### 10.1 Identity and provenance

The immutable map includes:

- `battleMapSchemaVersion: 3`;
- `terrainGenerationVersion: 3` for the existing persistence/protocol version
  column, with documentation that V3 is template-compiled content;
- stable `contentId` and `contentVersion`;
- `templateId` and template revision;
- `theme` and explicit `renderProfileId`;
- `tierEligibility`;
- `supportedModes`;
- dimensions and capacities;
- source-sidecar, approved-blueprint, asset-bundle/tile-catalog, compiler, and
  validator hashes/versions; and
- authoritative, visual, and full map hashes.

Approved content is immutable. A correction publishes a new content version and
catalog release; it never changes the meaning of an existing ID/hash.
`catalogReleaseId` is deliberately not part of the compiled map or any map
hash: the same immutable map may appear in multiple catalog releases. The
catalog entry and persisted battle-selection provenance carry the release ID.

### 10.2 Gameplay layers

V3 retains or refines:

- semantic terrain material;
- passability;
- movement cost;
- discrete elevation levels;
- cardinal elevation connections;
- blocking obstacles;
- feature ownership;
- route records;
- spawn contract; and
- dimensions.

`playableMask` explicitly separates playable cells from visible,
scene-composition cells. `renderMask` separates visible scene cells from void.
The invariant is:

```text
playableMask ⊆ renderMask
```

Traversal treats cells outside `playableMask` as unavailable even when they are
visible forest, water, wall, cliff, or scenery. This allows dense organic
borders without inventing random collision props.

Blueprint elevation uses integer levels. A traversable cardinal neighbor may
differ by at most one level and must have a matching slope/stair connection
where the shared traversal rules require it. Larger deltas are cliffs and are
not traversable across that edge.

### 10.3 Visual layers

Every rendered cell or edge resolves exact, profile-scoped assets:

- surface family and variant;
- material-to-material transition masks;
- route edges, corners, junctions, shoulders, and centers;
- banks, shores, wetness, mud, lava, snow, ash, roots, or other movement
  semantics;
- per-material exposed faces;
- cliff caps and face compositions;
- directional slope/stair assets;
- blocking obstacle family, anchor, and occlusion bounds;
- nonblocking decoration family;
- organic boundary treatment; and
- optional scene-only canopy/apron dressing.

No V3 asset lookup may fall back to another theme or a generic material unless
the map's render profile explicitly declares that exact reuse.

The renderer must stop applying a universal off-map edge skirt to V3. It draws
only compiler-authored boundary faces/treatments and skips void cells.
Every resolved asset includes its asset-bundle ID, stable key, content version,
content hash, and immutable URL. A V3 map cannot be published unless all of
those references resolve in its pinned asset-bundle manifest.

### 10.4 Spawn contract

The immutable map stores **candidate** positions rather than the final enemy
selection:

- ordered player formation slots;
- opposing-team candidate cells and/or zones;
- candidate tags;
- formation facing;
- protected local clearances;
- exits and approach regions;
- capacity;
- minimum route/connectivity constraints; and
- tactical annotations used by placement scoring.

Actual unit coordinates remain in mutable combat state. This keeps one compiled
map reusable across encounter rosters and enemy counts.

V3 initially supports the current two-sided model:

- PvE/guild: player side versus opposing NPC side;
- Coliseum: team one versus team two; and
- player battle formation capacity of five.

Capacity fields are distinct:

- `playerCapacity`: maximum assignable player/team-one units, initially five;
- `candidatePoolSize`: number of authored opposing cells available to the
  matcher; and
- `maxAssignableOpponents`: maximum simultaneous opposing units supported by
  the map/profile.

The forest PvE profile requires `candidatePoolSize >= 24` to preserve a broad
choice of placements but `maxAssignableOpponents: 7`, matching current
encounters. Eligibility uses assignable roster capacity, never candidate-pool
size. Other mode profiles declare their own actual maximums; 24 candidate cells
does not imply support for a 24-unit encounter.

## 11. Tiered Catalog and Deterministic Selection

### 11.1 Catalog records

Every catalog entry declares:

- immutable map ID, version, and full hash;
- catalog release ID;
- battle theme;
- exact render profile;
- tier eligibility;
- supported modes;
- orientation/team layout;
- dimensions;
- `playerCapacity`, `candidatePoolSize`, and `maxAssignableOpponents`;
- required asset-bundle ID and manifest full hash;
- weight;
- optional boss-capable and competitive-parity tags; and
- source template ID.

The release ID is an operator-assigned immutable version identifier, not a
digest derived from itself. The catalog full hash is computed over the closed
manifest, including that ID, ordered entries, and asset-bundle manifest hash.
Every record in a deployed runtime catalog is approved and selectable.
`holdout`, review, and retirement state belongs to offline approval metadata,
not the runtime selector. Omitting or retiring content requires publishing a
new tracked catalog release.

### 11.2 Tier resolution

Add versioned `BattleThemeResolver` and `BattleTierResolver` boundaries.

The theme resolver consumes explicit encounter context rather than making the
renderer infer a theme from a palette. Existing node types that are already one
of the 16 themes map directly. Guild and Coliseum use explicit `guild` and
`arena` mappings. Special themes require their authoritative encounter/node
metadata to supply or resolve that exact theme. Invalid or unknown authoritative
theme values fail battle creation and never silently become `forest` or select
V2. The migration's deterministic V2 compatibility path applies only after a
valid supported theme resolves successfully but the deployed V3 catalog has no
eligible record. A theme becomes available automatically when its authoritative
entry path and approved catalog records are deployed; there is no separate
activation setting.

The tier resolver behaves as follows:

- PvE uses `world_nodes.difficulty_tier` directly.
- Guild battles map the existing guild advancement tier to a normalized battle
  tier through explicit data.
- Coliseum uses an explicit competitive content band derived from rating/tier,
  while all maps in a competitive band must pass parity validation.
- Modes without a meaningful tier use a named default band rather than
  inventing a random tier.

The original tier and resolved selection band are persisted in creation
provenance.

### 11.3 Eligibility and choice

At battle creation:

1. Resolve the current catalog release.
2. Filter exact eligibility by theme, mode, tier, dimensions, team layout,
   player count, and enemy count. Client capabilities do not filter or
   downgrade V3 selection.
3. Sort eligible records by immutable map ID.
4. Select by the versioned stable weighted selector over:

   ```text
   catalogReleaseId
   encounter seed
   theme
   resolved tier
   mode
   party capacity band
   actual opposing-roster capacity band
   ```

5. Load and verify the compiled map/hash.
6. Assign actual units.
7. Persist the full immutable map and selection provenance.

There is no per-player recent-history mutation in the initial design. Catalog
release pinning makes selection reproducible, and existing battles never depend
on a future catalog.

Adding maps creates a new catalog release and may intentionally change future
selection. It cannot change an already-created battle because that battle
persists its selected full map.

The selector algorithm is normative, shared, and covered by golden vectors:

- `selectorVersion: 1` uses the domain
  `modia:battle-map-v3-selector:v1`;
- the selector hashes one closed record containing that domain,
  `selectorVersion`, and the seven ordered logical inputs shown above; field
  values have schema-defined string/integer encodings, the closed record is
  serialized with the repository's canonical JSON serializer as UTF-8, and the
  resulting bytes are hashed with SHA-256;
- candidate records are ordered by immutable map ID;
- each weight is an integer in `[0, 1_000_000]`; non-integers, out-of-range
  values, and an all-zero eligible set fail closed;
- the digest is interpreted as one unsigned big-endian integer and reduced
  modulo the integer total weight; and
- cumulative integer ranges select the first record whose upper bound is
  greater than the reduced value.

No floating-point probability or implementation-defined object ordering is
allowed. Shared JavaScript and any future non-JavaScript implementation must
pass the same committed input/digest/selection fixtures.

### 11.4 Automatic migration and compatibility fallback

During rollout:

- The tracked catalog release is application data deployed with the compatible
  code and asset bundle. Runtime code does not read an environment variable,
  feature-flag service, mutable operator setting, or enabled-profile list to
  choose that release or activate V3.
- Every new battle automatically uses V3 whenever the deployed catalog has an
  eligible entry for the resolved theme, mode, tier, dimensions, layout, and
  capacity. Client capability does not participate in map-version selection.
- During the migration window, no eligible V3 entry produces a structured
  coverage metric and invokes the deterministic V2 compatibility path. Catalog
  coverage—not configuration or client capability—decides this.
- If an eligible V3 entry is selected but the client cannot render V3, return
  an explicit upgrade-required response. V3 data is never reinterpreted as V1
  or V2.
- Asset or hash corruption does not invoke a different V3 map silently; it
  fails battle creation. Compatibility fallback is only for absent catalog
  coverage, not for client capability or corrupt V3 content.

After full coverage:

- a normal code/content release removes the V1/V2 new-creation compatibility
  branches;
- clients that cannot advertise V3 receive an explicit upgrade-required error;
- a request with no eligible map fails battle creation rather than generating
  a surprise procedural map; and
- the catalog coverage check prevents deployment of an incomplete release.

Readers/adapters for persisted V1 and V2 battles remain available independently
of new-battle selection. The dispatch chain is therefore explicit: approved
eligible V3 catalog entry → V2 only when V3 catalog coverage is absent during
migration. After the code-level cutoff, new creation is V3-only. Historical
V1/V2 hydration remains schema-driven.

Static architecture checks must reject `BATTLE_MAP_V3_*` environment reads,
feature-flag-provider dependencies, runtime shadow selection, and configurable
fallback switches. Offline preview, comparison, validation, and approval
commands are allowed; they do not influence production selection.

## 12. Role-Aware Runtime Spawn Assignment

### 12.1 Role classification

Add a versioned, pure classifier that returns one primary placement role and
secondary traits from current unit data.

Suggested primary roles:

- `frontline`;
- `ranged`;
- `support`;
- `ambush`;
- `mobile`;
- `defender`; and
- `boss`.

Suggested initial rules:

- boss state or boss archetype → `boss`;
- `aiType: ambush` or hidden opening → `ambush`;
- healing/support abilities or `aiType: support` → `support`;
- `attackRange > 1` → `ranged`;
- `hit-and-run` or high movement → `mobile`;
- `defensive` → `defender`;
- otherwise → `frontline`.

The classifier result may later become explicit enemy-template metadata, but
inference must remain deterministic and tested for existing templates.

### 12.2 Assignment algorithm

Use deterministic constrained matching rather than a single global spawn
strategy:

1. Order units by constrained placement priority, then stable identity.
2. Build an occupancy-free static traversal view from the immutable map,
   explicitly ignoring every preliminary unit coordinate.
3. Map the player/team-one formation onto authored slots and reserve those
   cells.
4. Build opposing candidate sets from static traversal plus those reservations,
   hard-filtering blocked, impassable, disconnected, no-spawn, invalid
   elevation, already-reserved, and incompatible role/footprint cells.
5. Score every unit/candidate pair using:

   - authored role tags;
   - approach distance;
   - first-turn reachable area;
   - attack range and useful line-of-approach;
   - elevation opportunity;
   - cover/concealment annotations;
   - ally spacing and role cohesion;
   - distance from opposing formation;
   - route/flank relationship; and
   - boss clearance.

6. Solve the small deterministic minimum-cost matching problem.
7. Apply all selected coordinates to mutable units.
8. Rebuild traversal with final occupancy and revalidate the complete
   assignment for overlap, reachability, formation exits, and legal opposing
   approaches.

Stable tie-breaking uses:

```text
map fullHash
encounter seed
spawn classifier/scorer version
ordered unit identities
candidate ID
```

Player formation mapping preserves the current selected formation order but
maps it onto the template's ordered authored slots. Competitive teams use the
same rules symmetrically and must pass parity validation.

The current random preliminary enemy coordinates in `enemyService` become
irrelevant immediately to placement and should eventually be removed. Enemy
count/template randomness should move to a separate seeded encounter stream so
retries and idempotent creation use the same roster as well as the same map.

`cover`, `concealment`, and `line-of-approach` are placement/composition
annotations only. Initially they are derived from blocker adjacency, route
geometry, range, and reachable-space opportunities; they do not add line of
sight, defense bonuses, concealment rules, or any other combat mechanic.

## 13. AI Battle-Art Pipeline

### 13.1 Asset discovery from templates

Asset scope must not be guessed before the theme templates exist. For every new
source template:

1. Generate and review its three map blueprints.
2. Compile their symbolic asset requirements.
3. Union requirements with the theme manifest.
4. Compare the union with the exact existing asset catalog.
5. Emit missing tile, transition, connection, face, obstacle, decoration, and
   boundary descriptors.
6. Review and deduplicate the descriptors before image generation.

This is a required content phase for every theme. New templates may reveal
families that no current asset supports.

### 13.2 Manifests and art descriptors

Three closed manifest levels prevent a loose folder of images from becoming an
implicit API:

- the root battle-art manifest pins schema versions, the
  `iso64-retina-v3` geometry contract, compiler/prompt-profile versions, known
  themes, and category descriptor files;
- each theme manifest pins its render profile, approved style authorities,
  descriptor IDs, explicitly allowed cross-theme reuse, compiled requirement
  report, and review state; and
- each immutable asset-bundle manifest lists every runtime path, content hash,
  dimensions, encoding, descriptor/content version, and owning theme, plus its
  own canonical full hash.

Every tile or prop family has a closed `ArtFamilyDescriptor`:

- `(category, theme, key, contentVersion)` identity;
- render profile;
- semantic material/effect;
- gameplay meaning and movement visibility requirement;
- blocking/nonblocking classification;
- adjacency or direction contract;
- source and logical dimensions;
- projection and alpha mask;
- anchors, footprint, collision footprint, and occlusion bounds;
- approved style/reference inputs;
- frozen positive and negative prompts;
- candidate paths;
- review status;
- source/prompt/output pins; and
- compiler/output paths and hashes, including the immutable
  asset-bundle-scoped URL.

Blocking obstacles and nonblocking decorations are different descriptor types.
A decoration can never acquire collision through metadata inference.

Category schemas add stricter fields:

- surface/transition descriptors declare the material or ordered material pair,
  edge/corner/junction masks, safe interior band, movement-readability cue, and
  permitted rotations;
- slope/stair/cliff descriptors declare direction, lower/upper level
  relationship, traversability, cap/face ownership, and repeat/stack behavior;
- exposed-face descriptors declare owning material, horizontal seam authority,
  stack segment height, and top/bottom attachment rules;
- blocking-obstacle descriptors declare exact cell footprint, bottom-center
  anchor, collision cells, visual/occlusion bounds, base-contact zone, and
  forbidden pass-through silhouette; and
- decoration descriptors declare a zero-collision contract, anchor, draw
  bounds, density/placement constraints, and any forbidden spawn overlap.

### 13.3 Generation strategy

Mirror the established authored-character lifecycle:

1. Deterministically draft metadata only.
2. Stage exact local reference/style inputs.
3. Launch one isolated `codex exec --ephemeral` worker per bounded family job.
4. Attach only the required theme/style/template references.
5. Read the frozen prompt from the descriptor without rewriting it.
6. Write only the declared raw candidate files and logs.
7. Run deterministic postprocessing.
8. Validate dimensions, alpha, geometry, and content bounds.
9. Review visually.
10. Approve and pin exact hashes explicitly.
11. Compile approved sources to runtime assets.

The runner:

- defaults to concurrency two and caps at four;
- supports `--dry-run`, `--force`, category, theme, family, and model filters;
- uses argument arrays and prompt input over stdin;
- creates a fresh temporary workspace per job and exposes only the required
  hash-verified references;
- permits writes only to a declared candidate/log allowlist;
- snapshots and audits filesystem changes before accepting output;
- enforces process timeout/termination, file-count, and byte limits;
- rejects symlinks, path escapes, undeclared changes, and unexpected output
  types;
- never approves, pins, compiles, or edits canonical runtime content; and
- is never invoked by CI or production.

### 13.4 Seam-safe compilation

AI-generated tiles must not be used as independent final diamonds. The
deterministic compiler:

- applies the exact 2:1 footprint;
- normalizes a shared family boundary band;
- clips AI detail to safe interior zones;
- derives directional/masked transition variants from approved source
  authority where possible;
- enforces compatible shared edges;
- applies straight antialiased alpha;
- performs anchor and logical-bound normalization;
- encodes lossless WebP;
- emits exact metadata and hashes; and
- runs the existing `tiles:check` geometry gates plus V3-specific checks.

This keeps the current projection formula while allowing richer authored
material interiors, routes, banks, cliff caps, faces, vegetation, and props.

### 13.5 Prompt system

Prompts are composable, frozen descriptor data:

```text
global Modia battle-art style
+ theme style profile
+ asset category geometry contract
+ material/feature description
+ gameplay readability requirement
+ adjacency/direction requirement
+ exact source and output framing
+ negative constraints
```

Each theme receives a descriptive style profile after its three source
templates are reviewed. The profile identifies palette, texture, lighting,
vegetation/architecture language, wear, density, and forbidden cross-theme
motifs.

Example forest floor-family prompt structure:

```text
Create one source authority for a Modia forest battle-map grass/dirt transition
family. Use the approved forest style image only for palette, texture density,
and material character; do not reproduce its complete map. The runtime
compiler will apply an exact 2:1 isometric diamond mask. Paint a cohesive
top-down material interior with mossy grass blending naturally into compacted
earth, small roots, restrained leaf litter, and an unmistakably easier dirt
route. Keep the declared boundary safety band free of unique objects. Lighting
is soft from the upper left. No freestanding trees, walls, characters, text,
grid lines, cast shadow, perspective frame, opaque corners, raised border, or
detail crossing the safe bounds.
```

Example forest exposed-face prompt structure:

```text
Create a seamless vertical forest-earth cliff face authority for Modia's
isometric terrain compiler. Show layered soil, embedded roots, moss, and sparse
stone with a readable top-to-bottom vertical structure. It must tile
horizontally and support repeated stacked height segments without a visible
frame. No floor diamond, horizon, standalone rock, tree canopy, staircase,
character, text, border, or directional cast shadow.
```

Example blocking obstacle prompt structure:

```text
Create one isolated blocking forest tree-cluster obstacle for a 16-bit fantasy
tactical battle map. Preserve the approved forest palette and foliage language.
The trunk/root base must clearly occupy the declared one-tile collision
footprint while the canopy may extend into the declared occlusion bounds.
Maintain a readable transparent/chroma-safe perimeter and a stable bottom-center
anchor. No ground tile, scenery, second disconnected object, character, text,
frame, cropped canopy, ambiguous pass-through gap, or cast floor shadow outside
the declared bounds.
```

Prompts for costly terrain must state how the movement effect reads visually.
Prompts for blockers must state why the silhouette cannot be mistaken for
walkable decoration.

## 14. Proposed npm Script Surface

Scripts should follow the repository's existing draft → candidate → approval →
compile → check conventions.

### 14.1 Template and map scripts

| Script | Responsibility |
|---|---|
| `battle-maps:templates:draft` | Deterministically scaffold/check a template concept, semantic sidecar, and frozen source-image/analysis prompts. |
| `battle-maps:templates:generate` | Optionally run isolated Codex/image-generation workers to create local compositional source-image candidates. |
| `battle-maps:templates:stage` | Register/hash a supplied local source image or one selected generated candidate. No Codex call. |
| `battle-maps:templates:preview` | Display source-image candidates and the semantic sidecar for visual review. |
| `battle-maps:templates:approve` | Explicitly pin and approve the exact source image, prompt, and reviewed sidecar. |
| `battle-maps:candidates:generate` | Run isolated Codex workers to create the three symbolic map blueprints for one approved source template. |
| `battle-maps:candidates:preview` | Strictly parse a candidate, deterministically compile and validate it into a disposable V3 artifact, then load that artifact in the production harness with semantic overlays. Exact missing assets block the production render and feed the art audit; raw Codex JSON never enters the renderer. |
| `battle-maps:candidates:approve` | Explicitly pin and approve one reviewed blueprint hash. Template-03+ records require a bounded rationale that is included in the v2 record/index hashes; frozen template-01/-02 approvals remain v1. Never generates or compiles art. |
| `battle-maps:compile` | Deterministically compile approved blueprints into canonical V3 JSON. |
| `battle-maps:validate` | Run schema, traversal, topology, spawn, tactical, diversity, provenance, and exact-asset validation. |
| `battle-maps:catalog` | Build/check an immutable catalog release from approved compiled maps. |
| `battle-maps:preview` | Serve an approved compiled map in the real renderer; print a URL and optionally open it. |
| `battle-maps:gallery` | Render screenshots/contact sheets for selected themes or all 144 approved maps. |
| `battle-maps:approve` | Record visual approval of the exact compiled map/full hash and reviewed screenshot hash. |
| `battle-maps:check` | Recompile/check all approved maps and catalog data with no Codex or network. |

Representative operator flow:

```bash
npm run battle-maps:templates:draft -- \
  --theme forest --template forest-template-01

npm run battle-maps:templates:stage -- \
  --theme forest --template forest-template-01 \
  --source frontend/public/assets/battle-maps/forest-template.png

npm run battle-maps:templates:preview -- \
  --theme forest --template forest-template-01

npm run battle-maps:templates:approve -- \
  --theme forest --template forest-template-01 --update-pins

npm run battle-maps:candidates:generate -- \
  --theme forest --template forest-template-01 --maps 3 --concurrency 2

npm run battle-maps:candidates:preview -- \
  --theme forest --template forest-template-01

npm run battle-maps:candidates:approve -- \
  --theme forest --template forest-template-01 \
  --map forest-template-01-a --reviewer <reviewer-id> --update-pins

# Template-03 and newer approvals additionally require a hash-pinned rationale:
npm run battle-maps:candidates:approve -- \
  --theme forest --template forest-template-03 \
  --map forest-template-03-a --reviewer <reviewer-id> \
  --reason "<specific acceptance rationale>"

npm run battle-maps:compile -- \
  --theme forest --template forest-template-01 --all-approved
```

For a theme without supplied source images, insert:

```bash
npm run battle-maps:templates:generate -- \
  --theme swamp --template swamp-template-01 --concurrency 2
```

before `templates:stage`, then stage the reviewed generated candidate by exact
candidate ID/hash.

### 14.2 Tile, obstacle, and decoration scripts

| Script | Responsibility |
|---|---|
| `battle-art:audit` | Compare approved map requirements with the exact theme asset catalog and emit missing families. |
| `battle-art:draft` | Create/check descriptors and frozen prompts for selected missing families. |
| `battle-art:generate` | Run isolated per-family Codex image workers. |
| `battle-art:preview` | Render source candidates, compiled assets, adjacency tests, anchors, footprints, and obstruction overlays. |
| `battle-art:approve` | Pin and approve an exact reviewed family source. |
| `battle-art:compile` | Compile all approved selected families through deterministic geometry/anchor processing. |
| `battle-art:check` | Validate descriptors, pins, exact outputs, seams, dimensions, alpha, anchors, and runtime lookup. |
| `battle-assets:inventory` | Emit the full local ignored-binary inventory and hashes for manual backup/restore verification. |

All art commands accept `--theme`, `--category`, and repeatable `--family`.
Generation additionally supports `--concurrency`, `--dry-run`, and `--force`.

The existing `tiles:generate`, `tiles:rebuild`, and `tiles:check` remain
lower-level compiler/validation commands until the V3 art compiler fully owns
their responsibilities.

## 15. Preview and Approval Experience

The V3 preview must use the production `BattleGrid` path, not a separate mock
renderer.

Candidate preview is a controlled ephemeral compilation path: strict candidate
parse → deterministic compile into a temporary directory → full mechanical and
asset validation → production V3 adapter/renderer. Before exact art exists, the
command may emit the mechanical overlay/data report and missing-asset manifest,
but it must not substitute fake/fallback art or record visual approval. Once
the required bundle exists, it performs the production render. It never asks
`BattleGrid` or any runtime loader to accept a raw candidate blueprint, and it
never promotes the disposable artifact.

### 15.1 Browser modes

The harness loads a candidate or compiled map by ID and supports:

- normal scene;
- grid coordinates;
- playable versus render mask;
- passable/blocked;
- movement cost heatmap;
- discrete height labels/contours;
- slopes, stairs, and blocked cliff edges;
- player formation slots;
- opposing candidate slots by role;
- exits and route connectivity;
- obstacle collision footprint and visual bounds;
- feature/region ownership; and
- exact asset-key inspection.

It can populate the scene with a representative five-character party and tier
appropriate NPC role mix without mutating the map.

### 15.2 Screenshot mode

Playwright renders:

- the normal scene;
- walkability/elevation overlay;
- formation/role overlay; and
- optional contact sheet.

The run fails on:

- missing exact assets;
- theme/profile fallback;
- image decode failure;
- unhandled candidate data;
- draw outside declared render/occlusion bounds;
- map/hash mismatch;
- browser console error; or
- screenshot approval record referring to a different map full hash.

Screenshots remain local/ignored review evidence. Their hashes and reviewer
decision are stored in tracked approval metadata.

### 15.3 Human review checklist

Reviewers confirm:

- the scene reflects the source composition without being a literal trace;
- both formations look like part of the environment;
- no broad edge was cleared or flattened for spawning;
- height changes read before selecting a tile;
- slopes/stairs/cliffs agree visually and mechanically;
- blockers and costly terrain are unmistakable;
- routes, blocker-adjacent shelter opportunities, and chokepoints feel designed
  rather than random;
- boundaries have a theme-specific ecological or architectural reason;
- foreground/background scene treatment does not look like a flat cut sheet;
- role-aware NPC samples look strategically plausible;
- the three maps from one template differ materially; and
- the theme does not read as a recolor of another theme.

## 16. Automated Validation

### 16.1 Structural and provenance gates

- Closed schemas and safe IDs.
- Exact source, prompt, candidate, compiler, asset, output, and approval pins.
- Unique `(theme, template, map, contentVersion)` identities.
- Exactly three approved maps for every published template.
- Exactly three templates and nine maps for every completed theme.
- Catalog records reference exact existing full hashes.
- Canonical compilation is byte-identical on two runs.
- No unapproved candidate or art family can enter compiled output.

### 16.2 Traversal and spawn gates

- Every playable cell resolves known terrain semantics.
- Every player slot and opponent candidate is in bounds, playable, passable,
  unblocked, and locally occupiable.
- `playerCapacity`, `candidatePoolSize`, and `maxAssignableOpponents` meet the
  declared compatibility profile without being conflated.
- Current player sizes 1–5 and enemy sizes 1–7 all produce valid assignments.
- The forest PvE candidate pool contains at least 24 individually valid cells,
  while corpus assignments never claim support beyond seven simultaneous
  opponents.
- Every actual assignment is connected to a legal opposing approach.
- Each formation has the required independent exits and minimum clearance.
- No candidate is on a hazardous/costly cell unless explicitly allowed for a
  compatible role.
- Competitive maps pass side parity for route cost, usable area, current
  targeting/range opportunity, height opportunity, and candidate quality.
- Failure to place the complete roster fails closed.

### 16.3 Elevation and organic-topology gates

- Adjacent traversable levels never jump unexplained.
- Every slope/stair connection agrees with its direction and height delta.
- Every larger height delta is visibly and mechanically blocked across that
  edge.
- No isolated one-cell peak, pit, material island, or inaccessible shelf unless
  explicitly feature-owned and approved.
- Spawn conditioning does not create a full row, column, or broad uniform edge
  band.
- Formation areas occupy local scene features and connect naturally to routes.
- Boundary cells are owned by named biome/structure features.
- Natural themes reject long unexplained rectilinear wall/border runs.
- Constructed themes require wall/room ownership rather than random segments.
- Playable and rendered masks form coherent connected silhouettes.

### 16.4 Visual-semantic and asset gates

- Every gameplay material has an exact surface family.
- Every movement-cost distinction has an approved visible treatment.
- Every blocker has blocking art and collision/visual bounds.
- Every elevation face and connection uses the correct material/direction.
- Adjacency compositions have no opaque corners, projection mismatch, gaps,
  hard seams, or conflicting boundaries.
- No V3 runtime fallback lookup is exercised.
- Encoded dimensions, alpha, anchors, lossless format, and size budgets pass.

### 16.5 Diversity gates

Across three maps derived from one template:

- all authoritative and full hashes differ;
- route graphs differ in more than orientation;
- spawn-to-spawn path metrics differ within safe tactical limits;
- height histograms/region layouts are not identical;
- obstacle and boundary feature layouts are not simple translations;
- maps are not only rotations, reflections, or palette changes; and
- a semantic similarity score stays below the configured duplicate threshold.

Across three templates in one theme:

- focal composition and boundary silhouette differ;
- tier complexity is visible;
- no one route graph dominates all nine maps; and
- tile/obstacle reuse remains stylistically coherent without making scenes
  interchangeable.

## 17. Implementation Phases

### Phase 0 — Freeze baselines and stage the forest source

**Work**

- Preserve fixed V1/V2 schema, persistence, renderer, and screenshot fixtures.
- Capture a deterministic V1 gameplay-presentation trace covering player
  move/attack/skill and a complete enemy move/intent/action turn.
- Add baseline assertions for camera focus, intent ordering, movement log
  entries, and absence of false state-drift recovery.
- Record current forest seed screenshots as visual failure baselines.
- Stage/hash the forest starter under the local ignored source layout.
- Create its tracked draft sidecar without interpreting it as a literal grid.
- Add a local asset inventory and manual-backup verification format.
- Record the current tile catalog and exact renderer capability matrix.

**Exit gate**

- Existing focused tests and galleries remain reproducible.
- The forest source file has a tracked descriptor and exact local hash.
- No V1/V2 output changes.

### Phase 1 — Define V3 schemas, hashes, and version boundaries

**Work**

- Add closed schemas for source sidecars, candidate blueprints, approved
  blueprints, art descriptors, BattleMap V3, and catalog releases.
- Add V3 canonical serialization and domain-separated hashes.
- Separate `battleMapSchemaVersion`, content/compiler version, catalog release,
  and mutable-state protocol concepts. A map-version change must not select a
  different mutable gameplay or presentation protocol.
- Replace single-current-version assumptions at shared boundaries with an
  explicit version registry and discriminated V1/V2/V3 loaders.
- Add V3 adapters while leaving V2 adapters frozen, and teach the repository to
  validate either final V2 or final V3 maps explicitly.
- Register explicit V1/V2/V3 hydration decoders. New-battle map selection does
  not negotiate a lower version from client capabilities: after automatic V3
  selection, an incompatible client receives upgrade-required. Persisted
  V1/V2 battles continue through their stored-schema decoders.
- Add the next available database migration for schema 3 constraints and
  selection provenance fields such as content ID, catalog release, and battle
  tier.
- Audit every exact/implicit version branch across HTTP routes, WebSocket
  messages, repository hydration, reference/cache protocols, asset selection,
  battle sessions, and renderers. Replace patterns such as `version === 2`
  followed by a legacy `else` with the central version registry/dispatcher.
- Add a repository-wide static boundary test/allowlist so a future V3 path
  cannot accidentally enter V1 handling through an unreviewed version check.
- Specify corruption, unsupported-client, and legacy-read behavior.

**Primary areas**

- `shared/battleMap/`
- `shared/battleStateProtocol.js`
- `api/src/services/battle/BattleStateRepository.js`
- `frontend/src/battle/BattleMapSession.js`
- next available `api/src/migrations/`

**Exit gate**

- Candidate/final V3 schema and hash fixtures pass.
- Unknown versions and unknown fields fail closed.
- V3 map content reaches only V3 map adapters, while all versions enter the
  same audited battle action and presentation path after hydration.
- Persisted V1/V2 fixtures still load unchanged.

### Phase 2 — Build template metadata and safe Codex blueprint tooling

**Work**

- Implement template concept/manifest/sidecar loaders and strict image/blueprint
  candidate handling.
- Add source-template draft, image generation, stage, preview, and approval
  scripts.
- Add separate map-blueprint candidate generation, preview, and approval
  scripts.
- Add precise git-ignore rules for local candidate/review trees and promotion
  rules for approved blueprint JSON.
- Reuse the authored-image lifecycle, but replace its broad runner permissions
  with disposable workspaces, writable allowlists, filesystem-delta auditing,
  bounded outputs, and enforced timeout/termination.
- Store frozen prompts and complete worker logs.
- Add concurrency, timeout, dry-run, resume, and force behavior.
- Ensure Codex cannot select paths or promote its own outputs.
- Add unit tests around CLI parsing, output isolation, malformed JSON, limits,
  partial runs, and hash pinning.

**Exit gate**

- A supplied local image and a generated source-image candidate can each become
  an approved, hash-pinned source template.
- A synthetic approved source template can produce three isolated blueprint
  candidates.
- No candidate command changes approval or runtime content.
- Candidate parsing rejects adversarial/invalid output.
- CI tests require no Codex installation or network.

### Phase 3 — Implement the deterministic map compiler and pure spawn engine

**Work**

- Convert symbolic materials/features into authoritative terrain semantics.
- Compile discrete height, connections, cliffs, playable/render masks, routes,
  obstacles, decorations, boundaries, and candidate spawns.
- Derive stable IDs and canonical ordering.
- Extract exact art requirements.
- Adapt V2 hard/tactical/quality validators into generator-independent V3
  artifact validators.
- Add tier/profile capacity validation.
- Add the minimal shared V3 `TraversalView` contract at this phase: it consumes
  `playableMask`, terrain semantics, elevation connections, and immutable
  blockers, and rejects visible-but-nonplayable cells. The compiler validators
  and spawn engine must use this implementation rather than a private copy.
- Implement the versioned pure unit-role classifier, placement scorer, and
  deterministic constrained matcher against compiled-map inputs, without API
  or catalog dependencies.
- Make spawn evaluation start from occupancy-free static traversal, reserve
  authored player slots first, and rebuild occupied traversal only after the
  complete assignment is applied.
- Add representative 1–5 player and 1–7 opponent roster fixtures, including
  frontline, ranged, support, mobile, ambush, and boss mixes.
- Finalize V3 hashes only after all authoritative mutation ends.

**Exit gate**

- The same approved blueprint compiles byte-identically.
- Compiler output cannot contain unresolved symbolic data.
- All hard gameplay checks are recomputed rather than copied from candidates.
- Compiler emits a complete missing-asset report.
- Static traversal and spawn legality already enforce `playableMask`.
- Representative rosters receive stable, legal placements through the actual
  classifier/matcher used by later preview and runtime integration.

### Phase 4 — Add V3 render profiles and organic scene boundaries

**Work**

- Make `renderProfileId` map-owned rather than inferred only from `nodeType`.
- Teach `BattleGrid` and hydration to consume `playableMask`, `renderMask`, and
  explicit boundary treatments.
- Skip void cells and remove V3's universal map-edge skirt.
- Use per-material exposed faces.
- Add adjacency-aware surface/route/shore/bank/cliff compositions.
- Preserve exact depth sorting and hit testing for scene-only cells/props.
- Integrate Phase 3's authoritative V3 `TraversalView`/`playableMask` semantics
  through every server gameplay consumer, including movement, strategic AI,
  landing/forced movement, teleport or target-ground validation, and
  area-of-effect cell selection.
- Ensure client pathfinding, hit testing, highlights, and previews use the same
  playable-mask semantics as the server.

**Exit gate**

- A hand-authored fixture renders an irregular organic silhouette.
- Front/back formation regions can sit inside visible terrain without flat map
  strips.
- Hit testing, camera framing, minimap, pathfinding, and highlights respect
  playable versus visible cells.
- Exact asset misses fail visibly and in tests.

### Phase 5 — Build the AI tile/obstacle/decorative art pipeline

**Work**

- Add tracked per-theme manifests, descriptor schemas, and prompt profiles.
- Implement asset-requirement audit/deduplication.
- Implement Codex family candidate generation.
- Extend the deterministic tile compiler to consume approved source candidates.
- Add transition masks, per-material faces, cliff caps, boundaries, and
  movement-readable overlays.
- Add obstacle/decorative compilers with anchors and occlusion bounds.
- Add approve, compile, preview, check, and inventory scripts.
- Build immutable, content-addressed asset bundles and exact bundle manifests;
  never overwrite an existing asset identity.
- Preserve existing strict geometry tests and expand them to contextual family
  compositions.

**Exit gate**

- One forest family in every required category completes
  draft → generate → review → approve → compile.
- Compiled assets pass dimensions, alpha, seam, direction, anchor, collision,
  runtime lookup, and lossless encoding checks.
- The forest bundle can be rebuilt/restored from its inventory and every
  compiled map resolves only exact bundle-scoped asset URLs.
- Replacing a pinned source without explicit force/approval fails.

### Phase 6 — Build production renderer preview and approval tooling

**Work**

- Add a V3 static-artifact input path to the existing visual harness.
- Make blueprint preview parse and compile into a disposable validated V3
  artifact before invoking the same adapter/renderer.
- Add all semantic overlays and representative formation population.
- Add browser serve, screenshot, contact-sheet, and explicit map-approval
  scripts.
- Record review metadata and screenshot/map hashes.
- Generate side-by-side template reference, semantic blueprint, normal render,
  and validation summary views where practical.

**Exit gate**

- One command renders a selected map in the browser.
- One command emits approval screenshots/contact sheets.
- Approval is tied to exact map and asset hashes.
- The displayed NPC samples come from the Phase 3 production classifier/matcher,
  not preview-only placement logic.
- Missing assets or browser errors fail the command.

### Phase 7 — Produce the forest pilot content

**Work**

- Complete three reviewed forest source templates.
- Assign their tier eligibility.
- Generate three map candidates from each template.
- Strictly parse and draft-compile all nine candidates into disposable artifacts
  for mechanical validation and exact asset-requirement extraction.
- Audit the union of all required forest art.
- Generate, review, approve, and compile missing tile/obstacle/decorative
  families.
- Production-preview every candidate with exact art and iterate blueprints or
  assets when mechanical or visual readability fails.
- Approve the reviewed blueprints, then compile and validate all nine canonical
  forest maps.
- Preview every tier-appropriate representative roster through the real
  role-aware matcher before approval.
- Approve all nine compiled maps individually.

**Exit gate**

- Forest has three approved maps in each default tier band.
- All nine maps pass automated and human review.
- No map contains a flat cleared edge formation strip.
- Every movement/elevation/blocking semantic is visually legible.
- Role-mixed NPC samples are valid and strategically plausible across all nine
  maps.
- Browser gallery demonstrates meaningful 3×3 diversity.

### Phase 8 — Integrate tiered catalog selection and encounter-aware spawning

**Work**

- Add catalog loader/startup verification and immutable release handling.
- Forward PvE difficulty tier into map selection.
- Add mode-specific battle-tier resolution.
- Add exact eligibility filtering and deterministic weighted selection.
- Integrate the Phase 3 shared classifier/matcher with real encounter units.
- Replace selected immutable V2 enemy slots with V3 candidate pools.
- Pass the real encounter units into placement.
- Preserve player formation ordering.
- Seed enemy count/template selection for retry stability or isolate it behind a
  separately versioned encounter stream.

**Primary areas**

- `api/src/services/battle/battleMapGenerationService.js` or its V3 replacement
- `api/src/routes/battle.js`
- `api/src/services/guildmasterBattleService.js`
- `api/src/services/coliseum/matchLifecycle.js`
- `api/src/services/enemyService.js`
- new shared catalog/selection/spawn modules

**Exit gate**

- Selection fixtures are stable for catalog release, tier, seed, and capacity.
- Role-mixed rosters produce stable, valid, plausible placements.
- Pure creation-input/retry fixtures resolve the same selected map and
  assignment; repository persistence is deliberately deferred to Phase 9.
- Encounters covered by approved V3 catalog entries resolve V3 automatically;
  uncovered encounters retain the deterministic migration compatibility path.

### Phase 9 — Integrate V3 persistence and initial map hydration

**Work**

- Persist full V3 maps and selection provenance through the existing repository
  transaction.
- Extend battle-entry snapshot/client verification for V3 map content without
  changing the mutable battle-state or presentation protocol.
- Hydrate all new layers without local map generation.
- Exercise the central V1/V2/V3 map dispatcher across start, current, rejoin,
  and reconnect hydration; reject any V3-as-legacy map fallthrough.
- Route post-hydration player/enemy actions, turn events, camera, intent,
  movement, battle logs, polling, terminal presentation, and reconciliation
  through the existing shared runtime path with no version branch.
- Use full initial-map hydration for V3. Reference/delta transport is not a V3
  option. Measure battle-entry map size separately from ordinary action
  updates.
- Update operational metrics for V3 catalog load, selection, spawn assignment,
  validation failures, asset misses, fallback, and render time.
- Make deployed catalog coverage the sole V3 activation mechanism. Do not add
  mode/theme/tier flags, kill switches, enabled-profile lists, shadow-mode
  switches, catalog-release environment variables, or configurable fallback
  controls.
- Pin the active catalog release in tracked versioned application data and add
  a static architecture test rejecting `BATTLE_MAP_V3_*` environment reads and
  feature-flag-provider dependencies.

**Exit gate**

- Start, current, rejoin, and reconnect hydrate V3 maps.
- Player and enemy move/attack/skill/terminal flows produce the exact baseline
  runtime event ordering and presentation behavior captured in Phase 0.
- No map-version branch exists in action submission, turn presentation,
  camera, intent, battle-log, or drift reconciliation code.
- The client never regenerates a V3 map.
- Full hashes survive persistence and transport.
- V1/V2 active battles still reconnect.
- Creation/retry/idempotency tests persist the same catalog release, selected
  map, full hash, and unit assignment.
- V3 map/spawn latency and wire size meet explicit budgets.
- A clean process with no V3-specific environment variables automatically
  selects V3 for every encounter covered by the deployed catalog.

### Phase 10 — Roll out forest PvE

**Work**

- Stage the versioned forest asset bundle, compatible code, and tracked V3
  catalog as one verified release unit.
- Run strict local/release asset verification.
- Run offline, non-serving selection rehearsals and compare tier coverage,
  assignment failures, load time, and screenshot/runtime behavior.
- Deploy the approved forest catalog release. Forest PvE encounters covered by
  that catalog use V3 immediately and automatically, without a post-deploy
  environment change.
- Keep the deterministic V2 compatibility path only for encounters whose
  approved V3 catalog coverage is absent during migration, and monitor those
  coverage misses.
- Exercise catalog rollback to the prior release.
- Verify that rollback restores the catalog and its exact older asset bundle
  without changing already-created battles.

**Exit gate**

- Forest V3 creation and reconnect are stable across all tiers.
- No unexplained asset fallback or spawn failure occurs.
- V2 compatibility use is zero for forest catalog coverage except deliberate
  absent-coverage tests.
- Visual review and player-facing acceptance approve the pilot.

### Phase 11 — Scale content to all 16 themes

**Work**

- Process each theme through the same source → blueprint → asset audit → art →
  compile → preview → approval workflow.
- Complete three source templates and nine maps per theme.
- Prefer content waves that maximize reusable tooling while preserving distinct
  profiles:

  1. natural: forest, plains, swamp, elven grove;
  2. rugged/hazard: mountain, volcano, bridge;
  3. subterranean: cave, dungeon, dwarven mine, vampiric crypt;
  4. constructed: castle, guild, human ruins, orcish warcamp;
  5. competitive: arena and any competitive variants of eligible themes.

- Re-run cross-theme style and duplicate audits.
- Add mode-specific competitive/guild validation where required.
- Publish immutable catalog releases in bounded batches.

**Exit gate**

- 48 source templates and 144 approved compiled maps exist.
- Every theme has exact art coverage and nine approved previews.
- Every supported tier/mode/capacity query has an eligible V3 map.
- Deployment coverage checks prove the selector never requires V2 for a
  supported new battle.

### Phase 12 — Replace procedural-map CI and complete operational rollout

**Work**

- Replace V2 corpus generation jobs with:

  - metadata/pin checks;
  - byte-identical V3 recompilation;
  - complete map/catalog validation;
  - deterministic selector fixtures;
  - role/spawn corpus tests;
  - exact asset checks on asset-equipped release runners;
  - gallery shards;
  - cross-map/theme diversity reports;
  - frontend build/hydration tests; and
  - asset/wire/performance budgets.

- Keep frozen V1/V2 compatibility fixtures.
- Add release checklist requirements for local binary inventory and backup.
- Package each catalog release with the exact asset-bundle manifest, refuse
  partial publication, and retain prior immutable bundles for rollback and
  persisted-battle/cache compatibility.

**Exit gate**

- CI tests production V3 behavior rather than unused procedural variety.
- Release cannot publish an incomplete or hash-mismatched catalog/asset bundle.
- Rollback deploys a previous immutable code/catalog/asset release.

### Phase 13 — Retire legacy V1/V2 creation and procedural generation

**Work**

- After complete catalog coverage and a stable observation window, remove the
  V2 new-battle compatibility dispatch from code.
- Unsupported clients receive the documented upgrade-required response for new
  V3 battles.
- Remove runtime V2 shadow generation and procedural-generation SLOs rather
  than retaining them as dormant switches.
- Remove `scheduleBattleMapV2Shadow()` and new-creation dispatch to
  `generateBattleMapV2()`.
- Archive or delete V1/V2 generator-only modules/tests once no developer
  workflow depends on them.
- Keep V1/V2 schemas, adapters, and loaders as long as active persisted battles,
  replays, support tooling, or backups can contain either version.
- Remove legacy read negotiation only after both versions' data-retention
  requirements expire.

**Exit gate**

- No production path creates or regenerates V1 or V2 maps.
- All supported new battles require an approved V3 catalog map.
- Historical V1/V2 data either remains intentionally readable or has completed
  a separately approved migration/retention process.

## 18. Test Plan

### 18.1 Unit tests

- Every new schema and closed-key rule.
- Prompt/descriptor rendering and stable hashes.
- Candidate parser limits and unsafe path rejection.
- Compiler determinism and canonical ordering.
- Terrain/elevation/connection derivation.
- Render/playable mask invariants.
- Exact asset requirement extraction.
- Tier resolution and catalog filtering.
- Deterministic weighted selection, integer-weight validation, and committed
  domain-separated golden vectors.
- Role classification.
- Per-unit candidate scoring and matching tie-breaks.
- Preliminary-coordinate exclusion and final-occupancy revalidation.
- Approval/pin state transitions.
- Local asset inventory and hash checking.

### 18.2 Shared integration tests

- V3 compile → hash → adapt → flatten → split → verify round trip.
- Shared traversal across masks, obstacles, costs, and connections.
- Player sizes 1–5.
- Enemy sizes 1–7 using a forest candidate pool of at least 24.
- Mixed frontline/ranged/support/mobile/ambush/boss rosters.
- No-valid-assignment failure.
- Tier/profile mismatch and coverage-only V2 compatibility behavior.
- Golden vectors proving automatic V3 selection whenever an eligible catalog
  record exists.
- V2 new-battle selection only when eligible V3 catalog coverage is absent.
- V1/V2 persisted-battle hydration by stored schema.
- Upgrade-required behavior when a client cannot render an automatically
  selected V3 map.
- Static rejection of `BATTLE_MAP_V3_*` environment reads, feature-flag
  providers, activation profiles, shadow switches, kill switches, and
  configurable fallback controls.

### 18.3 API and persistence tests

- PvE tier is forwarded and persisted.
- Guild/Coliseum tier resolution.
- Creation idempotency includes catalog/content identity.
- Start/current/rejoin/reconnect for V3.
- Map immutable fields cannot be patched by mutable updates.
- Corrupt catalog/map/hash rejection.
- V2 compatibility telemetry uses only the
  `v3_catalog_coverage_absent` reason during migration.
- Existing V1/V2 battle fixtures still load.
- Repository-wide version-branch audit proves V3 cannot enter a legacy
  HTTP/WebSocket/repository/cache path.

### 18.4 Frontend tests

- V3 hydration applies every layer.
- One cross-version gameplay trace proves V1/V2/V3 parity for camera pan,
  intent highlights, movement/action animations, death timing, battle-log
  entries, turn handoff, and polling without false drift.
- Authoritative state checkpoints cannot snap units or supersede semantic
  presentation events that are already queued for the same action/turn.
- Render/playable masks affect draw, hit test, highlight, minimap, and
  pathfinding consistently.
- Movement, AI, forced landing, teleport/ground targeting, and area selection
  reject visible-but-nonplayable cells consistently with client pathfinding.
- Per-material faces and contextual transitions select exact assets.
- Scene-only obstacles/decorations sort correctly with units.
- Missing V3 assets never use undeclared fallback.
- Browser visual harness overlay modes.

### 18.5 Visual and content tests

- Forest nine-map pilot gallery.
- One stable gallery shard per theme on routine checks.
- Full 144-map gallery for catalog release.
- Adjacency/seam sheets for every art family.
- Spawn-role sample sheets at every tier.
- Semantic duplicate/diversity report.
- Manual approval checklist and exact hash record.
- Asset-bundle manifest/URL/hash verification plus prior-bundle rollback.

## 19. Rollout and Rollback

V3 publication and rollback are deployment operations, not runtime
configuration:

- A release contains compatible code, one tracked immutable catalog release,
  and the catalog's exact verified asset bundle.
- After deployment, every eligible new battle selects V3 automatically from
  that catalog. There is no subsequent environment change or activation step.
- During migration, V2 new-battle compatibility occurs only when the deployed
  catalog has no eligible V3 record.
- Offline validation, previews, galleries, and selection rehearsals happen
  before publication and cannot influence production selection.

Rollback order:

1. Deploy the previous verified code/catalog release.
2. Restore that release's exact immutable, manually backed-up asset bundle.
3. Verify the deployed catalog and asset hashes before accepting new battles.
4. Preserve already-created V3 battles; they have their complete immutable map
   and should not be regenerated.

After V2 retirement, rollback is to a previous V3 catalog/code/asset release,
not to procedural generation.

## 20. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Ignored assets make a clean clone visually incomplete | Pin every binary, use immutable versioned asset bundles, provide inventory/strict restore checks, require the matching manually restored bundle for release, and keep canonical map/catalog JSON tracked. |
| Codex output varies between runs | Treat it as candidate authorship only; approve exact hashes and compile deterministically. |
| AI tiles still seam poorly | Generate family authorities, synthesize shared edge bands/masks, and reject adjacency sheets with strict geometry tests. |
| 144 maps create a large review burden | Work theme-by-theme, three maps per template, use bulk mechanical validation and contact sheets, but retain explicit visual promotion. |
| Five old palettes make themes look alike | Give all 16 themes explicit render profiles and generate template-discovered overrides rather than relying on silent fallback. |
| Tier grouping reduces selection variety | Provide three approved maps per tier band initially and allow later templates/catalog releases without changing runtime algorithms. |
| Runtime role inference disagrees with encounter design | Version the classifier, expose preview overlays, add explicit template metadata later, and test every existing `aiType`. |
| Organic masks break renderer assumptions | Introduce render/playable masks behind V3 only, with focused hit-test, minimap, camera, traversal, and depth tests. |
| Legacy removal breaks live/replay data | Separate removal of V1/V2 creation/generation from removal of their readers and adapters. |
| Map additions remap future seeds | Pin a catalog release in every battle and publish additions only through a new immutable release. |

## 21. Completion Criteria

The transition is complete when:

- all 16 themes have three reviewed templates and nine approved maps;
- every supported tier/mode/capacity resolves an exact V3 artifact;
- every map and art family is schema-valid, hash-pinned, mechanically valid,
  visually approved, and exact-asset complete;
- runtime performs catalog selection and role-aware placement but no map
  topology generation;
- battle creation persists the complete V3 map and selection provenance;
- browser preview/gallery and local art generation workflows are documented and
  operable through npm scripts;
- every published content release has passed pre-publication stability,
  performance, and visual acceptance criteria;
- complete catalog coverage has allowed V2 new-battle dispatch to be removed
  from code;
- no production path creates V1/V2 maps; and
- required historical V1/V2 data remains intentionally readable until its
  retention period ends.

The architectural measure of success is not merely that V3 maps validate. They
must look authored: formation areas belong to the scene, elevation and movement
read immediately, boundaries have a biome-specific reason, and maps within the
same theme have recognizably different compositions.
