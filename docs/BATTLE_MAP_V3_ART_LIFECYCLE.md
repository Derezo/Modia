# Battle Map V3 Art Lifecycle

This runbook is the source of truth for adding Battle Map V3 art for a new
biome, regional ecology, or tier. Art readiness is tracked before maps exist.
Generation remains review-gated, and deployed catalog content—not environment
configuration—activates V3.

## Identity model

A descriptor is one concrete runtime asset. Its `id` is immutable identity,
not a query or a mutable family name.

Descriptor v1 remains readable and compilable for released assets. New work
uses `battle-art-family-descriptor-v2`, which adds:

- `familyGroup`: the conceptual family shared by concrete variants, such as
  `heartlands-earth-slope`.
- `variantId`: the stable variant within that group, such as `grade-1-n`.
- `capabilities`: a closed object containing `direction`, `routeTopology`,
  `surfaceVariant`, `ecologyProfile`, `tierBands`, and `heightDeltas`.

`direction` is `n`, `e`, `s`, `w`, or `null`. Route topology is one of the
16 final authored roles: `isolated`; `end-n/e/s/w`; `straight-ns/ew`;
`corner-ne/es/sw/wn`; `tee-nes/esw/nsw/wne`; or `cross`. `surfaceVariant` is
`0` through `7` for surfaces and `null` for every other category. Tier bands
and height magnitudes are positive integers; non-connection height is normally
`0`.

Capabilities are category-closed. Surfaces and routes have `direction: null`;
routes use only their final directional topology value. Stairs, slopes, and
exposed faces require one direction and one positive height magnitude.
Obstacles and decorations have no direction, topology, surface variant, or
height magnitude.

The compiled runtime record contains only a scalar `variant` projection, never
authoring-only family metadata. It includes applicable non-null direction,
route topology, surface variant, ecology, and singleton tier/height values.
Map compilation and runtime selection can therefore demand exact capabilities
without parsing IDs or rotating unsuitable art.
Readiness can reference an existing v1 asset by exact `descriptorId` during
migration, but v1 has no ecology/tier capability claim and must not be reused
to assert new regional coverage.

## Readiness plan

The live tracked plan belongs at:

`ai-image-metadata/battle-art/readiness-plan.json`

Its schema is `battle-art-readiness-plan-v1`. See the
[abbreviated schema example](examples/battle-art-readiness-plan.v1.json);
production plans must expand every supported route role and regional family.
Each plan row identifies one `theme`, `ecologyProfile`, and `tierBand`. Every
plan row can also pin a reviewed `artDirection` sentence describing the
region's literal species, geology, ground materials, palette, and lighting.
Use it for production plans so directional assets cannot drift into a
different forest or rock family. Every requirement then declares:

- `descriptorId`, or `null` only for a report that intentionally detects any
  matching capability;
- `familyGroup`, `variantId`, and `category`;
- exact `direction`, `routeTopology`, and `surfaceVariant`, using `null` when
  not applicable;
- one required `heightDelta`.

The same descriptor may cover multiple tiers. Repeat its requirement in those
plan rows; selecting any occurrence for scaffold aggregates every row for that
descriptor identity into one deterministic tier-band declaration. Connections
must declare exactly one positive height magnitude.

Do not duplicate identical plan rows or requirements. The matrix rejects
duplicates and reports more than one capability match as ambiguous.

## Plan a biome and its regional ecologies

Start with the visual vocabulary, not a generic theme-wide asset:

- Forest examples: Heartlands oak, birch, meadow grass, and warm soil;
  Shadowmere black pine, pale fungi, cold moss, and dark mineral soil.
- Cave examples: limestone shelves, basalt columns, crystal caverns, or
  sulphur caves.
- Mountain examples: granite, slate, sandstone, snow line, or volcanic rock.
- Constructed examples: a `castle`-theme Grand Palace ecology with marble and
  formal rectangular edges; ruins with broken regional masonry;
  faction-specific guild or camp props. “Grand Palace” is a regional art and
  scene profile, not a separate authoritative encounter theme.

Give every ecology its own surface, exposed boundary, obstacle species or
geology, and nonblocking detail groups. Higher tiers can share neutral terrain
but should declare tier-specific hazards, monumental obstacles, or richer
decorations explicitly in the plan.

`artDirection` belongs to the ecology/tier plan row, not an environment
setting. For example, a Heartlands row can pin oak, silver birch, warm loam,
and rounded fieldstone while a Shadowmere row pins black pine, pale fungi,
cold moss, and dark mineral soil. Cave and mountain rows use the same field to
pin limestone, basalt, granite, slate, volcanic rock, or snow-line materials.
Descriptors shared across tiers must resolve to the same reviewed art
direction; scaffold rejects conflicting rows.

Add a row for every approved theme/ecology/tier combination. The tooling
supports the 16 encounter themes and the same tier bands 1–5 used by runtime
selection; it rejects higher, unreachable art tiers. The tracked plan is an
honest inventory of approved content work, so it may begin with one regional
row and grow through normal content review rather than claiming unfinished
biomes are ready. Readiness can be reported while every asset is still missing
and before a map blueprint exists:

```bash
npm run battle-art:matrix -- \
  --plan docs/examples/battle-art-readiness-plan.v1.json \
  --metadata-only --json
```

`--metadata-only` reports missing assets and never creates descriptors or
images. Without it, missing or ambiguous requirements fail the command.

## Directional connections

Never treat stairs or slopes as a directionless sprite that the renderer can
guess how to rotate. Plan one concrete `connection-stairs` or
`connection-slope` descriptor for each direction the map compiler may emit.
Declare the exact height delta. If grade 1 and grade 2 use different imagery,
give them different descriptors and variant IDs.

For a four-way grade-1 slope family, the plan contains `n`, `e`, `s`, and `w`
requirements with `heightDelta: 1`. Height is an absolute magnitude; final
authored direction determines placement. North/south connection descriptors
have a `1x2` footprint, east/west descriptors have a `2x1` footprint, and both
cells are part of the connection collision declaration.

Direction is always the authored low-to-high direction, even when a blueprint
connection happens to list its high cell first. In the rendered 2:1 diamond:

- north meets the upper-right edge;
- east meets the lower-right edge;
- south meets the lower-left edge;
- west meets the upper-left edge.

The compiler normalizes blueprint endpoints to this convention. The runtime
renderer does not rotate, mirror, or reinterpret a v2 directional asset.

Slope imagery must include the walkable top transition and the visible face
needed to meet both elevations. It must not bake a black void or generic dark
brown wall behind the connection.

Directional exposed boundaries use the same named diamond edges, but their
direction is determined from the grounded lower contour—not every opaque
pixel. Roots, soil, stone, or masonry must follow only the declared edge and
remain connected to the anchor. Tall trees and architectural crowns may
overhang another edge; the raster contract deliberately ignores overhead
alpha when deciding which edge is grounded. This keeps legitimate canopy from
being mistaken for a backwards wall while still rejecting multi-edge bases.

## Source-raster geometry

Do not assign one pivot ratio to every category. The deterministic scaffold
uses the renderer's established source-space geometry:

| Category | Default canvas | Pivot and anchor |
|---|---:|---:|
| surface | 256×128 | 128,64 |
| route-transition | 256×128 | 128,64 |
| connection-stairs / connection-slope | 256×192 | 128,128 |
| exposed-face-boundary | 256×256 | 128,192 |
| blocking-obstacle | 192×256 | 96,224 |
| nonblocking-decoration | 128×192 | 64,160 |

For a 256×128 route diamond, its center is `128,64`; named edge-band centers
are N=`192,32`, E=`192,96`, S=`64,96`, and W=`64,32`. A route candidate must
touch exactly the bands named by its topology. It must use a broad rounded
central wear area, consistent edge width, and a soft irregular verge; sharp
chevrons, hard elbows, and narrow ruler-straight strips are review failures
even if their alpha topology passes.

Connections anchor on the low cell. With the standard 256×192 canvas and
128,128 low anchor, their high-end targets are N=`255,64`, E=`255,191`,
S=`0,191`, and W=`0,64`. Raster checks require the low anchor, exactly the
declared high endpoint, and the matching 1×2 or 2×1 footprint. This is why
directional images cannot be substituted, mirrored, or inferred from a
directionless stair sprite.

## Route roles and diversity

A route art set is a topology matrix, not one tile repeatedly rotated. Plan
concrete variants for all 16 final roles the compiler can emit:

- `isolated`
- `end-n`, `end-e`, `end-s`, `end-w`
- `straight-ns`, `straight-ew`
- `corner-ne`, `corner-es`, `corner-sw`, `corner-wn`
- `tee-nes`, `tee-esw`, `tee-nsw`, `tee-wne`
- `cross`

Each role is authored in its final orientation; generation and rendering do not
rotate or mirror it. Additional visual diversity is represented by another
`familyGroup` or `variantId` with the same topology capability. Deterministic
map selection may choose among exact compatible variants, but it must never
substitute the wrong topology. Opposite diamond edges must share the raster
seam contract so neighboring tiles line up.

The tracked Borderwood v6 plan is the reference complete route profile: its
single dirt-path family declares all 16 roles even though the first approved
map currently exercises only a subset.

Route overlays contain only the worn path and its soft, irregular verge. Keep
connection width and placement identical at every named edge; do not generate
an opaque ground diamond or a hard polygonal dirt border. The directional edge
mapping is the same upper-right/lower-right/lower-left/upper-left convention
listed above.

## Deterministic scaffold

Once the readiness plan is reviewed, create descriptor drafts without
generating images:

```bash
npm run battle-art:scaffold -- \
  --theme forest \
  --ecology-profile forest-heartlands-woodland \
  --tier 1 \
  --category connection-slope \
  --plan ai-image-metadata/battle-art/readiness-plan.json \
  --json
```

Use repeatable `--family` arguments to scaffold a subset. Scaffold is
no-overwrite by default. `--check` proves existing descriptors equal the
deterministic draft. `--force` may replace only unreleased drafts; it cannot
replace approved or compiled identity.

For a one-off v2 draft, specify capabilities directly:

```bash
npm run battle-art:draft -- \
  --theme forest \
  --category connection-slope \
  --family heartlands-earth-slope-n-grade-1 \
  --family-group heartlands-earth-slope \
  --variant grade-1-n \
  --direction n \
  --ecology-profile forest-heartlands-woodland \
  --tier 1 \
  --height-delta 1
```

A one-off draft is only a drafting convenience. Before generation or approval,
add its exact descriptor ID and capabilities to a reviewed readiness-plan row.
V2 generation, approval, compilation, and audit all reject unplanned regional
assets or tier claims.

Seam-safe open terrain uses an explicit deterministic variant:

```bash
npm run battle-art:draft -- \
  --theme forest \
  --category surface \
  --family heartlands-meadow-surface-2 \
  --family-group heartlands-meadow-surface \
  --variant surface-2 \
  --surface-variant 2 \
  --ecology-profile forest-heartlands-woodland \
  --tier 1
```

## Generate, review, approve, compile, and archive

Selection flags are shared by generation, candidate normalization, preview,
audit, inventory, and the matrix where applicable: `--theme`,
`--ecology-profile`, `--tier`, `--category`, `--surface-variant`, and
repeatable `--family`.

Generate candidates:

```bash
npm run battle-art:generate -- \
  --theme forest \
  --ecology-profile forest-heartlands-woodland \
  --tier 1 \
  --category connection-slope \
  --resume
```

There is exactly one imagegen invocation per concrete descriptor. Generation
cannot approve, compile, publish, or fabricate readiness metadata.

For a large reviewed matrix, add `--keep-going`. Every family still runs in
its isolated one-image worker; invalid families are reported as `failed`, the
remaining families continue, and the command exits nonzero after all work
finishes. This prevents one direction that misses a hard raster contract from
discarding valid sibling work.

The normal path sends the hash-pinned style reference to the image tool. In a
restricted nested sandbox where local image ingestion is unavailable, use the
tracked textual authority without changing models or bypassing the lifecycle:

```bash
npm run battle-art:generate -- \
  --theme forest \
  --ecology-profile forest-heartlands-woodland \
  --tier 1 \
  --resume \
  --text-style-fallback
```

The binary reference remains staged and pinned for audit, but the worker is
forbidden to open or pass it to imagegen. This remains the built-in
one-imagegen-call workflow, not the API/CLI fallback.

The npm generator gives the image worker only a minimal local runtime/auth,
temporary-directory, locale, certificate, and proxy environment. Application,
database, session, payment, parent-thread, and API-key secrets are not
forwarded. Worker output, the final message, the disposable workspace, and the
candidate image are byte-bounded and audited before anything is published.

If deterministic raster normalization changes after candidates were generated,
repin the selected draft candidates before visual review without regenerating
their imagery:

```bash
npm run battle-art:normalize -- \
  --theme forest \
  --ecology-profile forest-heartlands-woodland \
  --tier 1
```

This command takes the same selection flags as preview. It acquires each
family's candidate lock, verifies the current descriptor, prompt, style, image,
and candidate metadata pins, applies the tracked deterministic raster
normalizer in the candidate's existing PNG or WebP format, validates the
result, and atomically updates the candidate image and its hash, dimensions,
format, and byte-count metadata. Candidate status and the original worker audit
record are preserved. It never invokes imagegen and rejects missing or stale
candidates and approved/compiled families.

Image and metadata publication uses a durable per-family recovery journal under
the same candidate lock. The backup, journal, image, metadata, and cleanup
directory entries are synced in transaction order. If a process ends between
the two atomic file swaps, the next non-check normalization restores the pinned
original or completes cleanup of the committed result before continuing. Check
mode never performs that recovery or changes candidate content; it reports
that a non-check recovery run is required.

Use `--check` in validation workflows to report normalization drift and exit
nonzero without writing:

```bash
npm run battle-art:normalize -- \
  --theme forest \
  --ecology-profile forest-heartlands-woodland \
  --tier 1 \
  --check --json
```

Build the visual inspection sheet:

```bash
npm run battle-art:preview -- \
  --theme forest \
  --ecology-profile forest-heartlands-woodland \
  --tier 1
```

Review alpha bounds, anchor, footprint, scale, edge seams, direction, height
alignment, route topology, and regional art direction. Then approve each
concrete family explicitly:

```bash
npm run battle-art:approve -- \
  --theme forest \
  --family heartlands-earth-slope-n-grade-1 \
  --reviewer <identity> \
  --decision approved
```

Compile and validate immutable runtime assets:

```bash
npm run battle-art:compile
npm run battle-art:matrix
npm run battle-art:audit
npm run battle-art:check
```

The runtime bundle carries exact v2 variant metadata. After every descriptor
in the release is compiled and all map/release checks pass, archive it:

```bash
npm run battle-art:archive
```

## Map and catalog integration

Map render profiles bind semantic map roles to concrete asset IDs from the
compiled bundle. For slopes and stairs, bind the exact direction and height
delta. For routes, bind the exact topology. For obstacles and decoration,
select only assets whose ecology profile and tier band match the encounter.

New regional work uses `battle-map-render-profile-v2`. It also declares:

- `ecologyProfile`, which must match the trusted node/region ecology and the
  catalog entry;
- `surfaceVariantCount`, used by deterministic coordinate/content hashing;
- `scene.silhouette`: `organic-island` for irregular natural battlefields or
  `rectangular-platform` for constructed maps such as Grand Palace;
- `scene.exterior`: regional canopy, cave rock, mountain crag, architectural
  skirt, or none;
- a four-stop tracked backdrop palette. Forest and mountain islands normally
  use `sky-gradient`; caves use `cavern-gradient`; constructed scenes use
  `architectural-gradient`.

Scene metadata is visual content and part of the map hash. It must never come
from an environment variable or client capability. Minimap clipping uses the
same silhouette contract as the full battlefield.

Compile and visually review the map, approve it, build its catalog release,
validate coverage, and deploy code, catalog, and immutable assets together.
The tracked active catalog release is the activation mechanism.

Coverage rows may repeat the same authoritative theme/tier case when each row
has a different `ecologyProfile`; keep them ordered by authoritative ID and
then ecology. Release validation collapses those rows only when proving the
unchanged authoritative base matrix. It separately selects and validates each
regional ecology.

Every positive-weight map eligible for a declared coverage/capacity band must
support the maximum party and opponent counts in that band. Checking only one
seed is insufficient because another deterministic seed could otherwise pick
an undersized map and fall back to V2.

Within a pinned catalog release, the selection query and encounter/node seed
produce the same map every time. A node therefore does not reroll visual
content on refresh or local restart. A later tracked content deployment can
intentionally change that result; already persisted V1/V2/V3 battles continue
to read their stored schema and provenance.

Do not add `BATTLE_MAP_V3_*` environment reads, feature flags, rollout gates,
client downgrade negotiation, or operator toggles. Missing approved catalog
coverage may use the explicitly coded V2 compatibility path during migration;
present approved coverage automatically selects V3. Rollback deploys the
previous verified code/catalog/art release.

## Reference Borderwood asset set

The first complete regional reference is Borderwood art bundle version 6. It
contains 51 exact runtime families, including all 16 final route topologies;
four upright surface variants; north/east/south/west stairs, slopes, and
exposed faces; three regional tree species; moss boulders; and nonblocking
forest detail. Its manifest full hash is
`sha256:485641dbc09df96dc3067b2fc6fe490cb6493da8da5dfda8775d4f4ef37a9819`.

The approved map integration is `forest-template-01-b@12` with
`forest-iron-depths-borderwood-v5`, selected only for the exact
`forest-iron-depths-borderwood` ecology. Use its readiness row, descriptor
geometry, render profile, v12 visual approval, and r6 catalog definition as a
worked example. Reuse the process—not Borderwood species or geology—when
adding Heartlands, Shadowmere, Sylvan, cave, mountain, or constructed content.

The renderer composes organic forest surfaces from a map-owned compatible
foundation plus subdued compiler-selected variants. It adds only visual,
ecology-matched trees on rendered nonplayable cells and sparse nonblocking
floor accents; these never alter collision or playability. Directional
connection underlays and elevation-face bridges must completely cover the
height transition before exact authored art is placed, so sky or a raw dark
separator can never show through.

## Future-session checklist

1. Read this runbook and the live readiness plan.
2. Run `battle-art:matrix --metadata-only --json`.
3. Add reviewed theme/ecology/tier requirements before drafting.
4. Scaffold; do not hand-copy descriptors.
5. Generate exactly one candidate per concrete family through npm scripts.
6. Normalize existing candidates after normalizer changes, then preview and
   approve direction/topology/ecology accurately.
7. Compile, run the strict matrix/audit/check, and archive.
8. Integrate exact assets into map profiles and compile maps.
9. Approve maps and activate only via a tracked catalog deployment.
