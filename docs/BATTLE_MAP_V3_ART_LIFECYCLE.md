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
- `routeFinishing` on a route descriptor that explicitly opts in: the fixed
  `largest-component-box-v1` operation, descriptor-pinned target box,
  detached-coverage ceiling, and alpha threshold/minimum/maximum/spread
  measurements used by both publication and review replay.

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

Before scaffolding a new theme, register its approved source-template image as
that theme's exact hash-pinned baseline style reference. Deterministic drafting
must select the baseline by theme and fail closed when it is absent; it must
never silently reuse the first forest reference for cave or another region.
Every unreleased descriptor should pin that one exact regional baseline unless
an additional, narrowly authorized corrective reference is part of its own
reviewed contract.

Use repeatable `--family` arguments to scaffold a subset. Scaffold is
no-overwrite by default. `--check` proves existing descriptors equal the
deterministic draft. `--force` may replace only unreleased drafts; it cannot
replace approved or compiled identity.

Scaffolding opens a staged manifest version; it does not publish a runtime art
release. During that one-version staging window, `battle-art:check` continues
to verify the exact previous immutable bundle, archive, source pins, registry,
frontend mirrors, inventory, and binaries while separately validating the new
draft or approved descriptors and readiness rows. A same-version runtime
bundle is valid only when every descriptor is compiled. Non-check compilation
refuses to write a partial release while any draft remains, and a revised
archived family must advance by exactly one content version. This keeps the
deployed bundle usable while new regional art moves through review without
mistaking metadata staging for publication.

The active inventory is independently pinned in the tracked append-only
`runtime-asset-inventory-registry.json` by release ID, version, bundle hash,
byte count, and SHA-256. Audit and compile-check require canonical inventory
bytes matching that exact pin. A full future compile appends its inventory pin
idempotently; staged or already pinned inventory cannot be overwritten through
the inventory command. This closes coordinated descriptor/manifest plus
inventory drift without rewriting an immutable historical art release.

For a one-off battle-art descriptor-v2 draft, specify capabilities directly:

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
Descriptor-v2 generation, approval, compilation, and audit all reject
unplanned regional assets or tier claims. This descriptor schema version is
independent of the map blueprint lifecycle; all newly authored maps use V3.

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

### Authorization preflight

Before a live Codex/Imagegen worker is started, run:

```bash
npm run battle-art:preflight
npm run battle-art:matrix -- --metadata-only --json
```

The preflight verifies that the standardized `codex` executable is available
and that its saved CLI session is logged in. It does not read or print auth
files, forward an application API key, call Imagegen, or authorize a content
decision. If it reports a logged-out session, run `codex login` interactively
and repeat the preflight. Use `npm run battle-art:preflight -- --json` for a
machine-readable orchestration gate.

Authorization is deliberately split:

1. The authenticated Codex session authorizes the one bounded worker start.
2. The reviewed readiness plan authorizes the exact theme, ecology, tier, and
   family scope.
3. A reviewer distinct from the generation principal decides whether the exact
   candidate is acceptable and supplies the concrete rationale.
4. A tracked catalog definition and active-release pin authorize runtime
   publication through a normal deployment.

Codex may prepare the preview, mechanically verify pins, draft a review
checklist, and execute the approval command after the independent decision. It
must not turn its own generation result into an approval merely by inventing a
different `--reviewer` label. Until authenticated reviewer attestations are
enforced by tooling, the named reviewer and rationale are repository evidence,
not proof of account identity.

Selection flags are shared by generation, candidate normalization, preview,
audit, inventory, and the matrix where applicable: `--theme`,
`--ecology-profile`, `--tier`, `--category`, `--surface-variant`, and
repeatable `--family`.

Generate candidates:

```bash
npm run battle-art:generate -- \
  --theme forest \
  --family forest-heartlands-loam-path-straight-ns \
  --concurrency 1
```

Live generation requires exactly one explicit family and concurrency `1`.
There is exactly one imagegen invocation for that descriptor. Generation
cannot approve, compile, publish, or fabricate readiness metadata. Dry runs and
the narrowly audited recovery path retain their separate selection semantics.
The default bounded worker timeout is 900 seconds because a valid built-in
Imagegen call can take longer than five minutes. `--timeout <seconds>` may set
an explicit value up to the enforced 1,800-second maximum; it does not enable a
retry or change the one-call rule.

The authorization preflight cannot prove that the live image-generation tool
will return an artifact; doing so would itself be a billed generation call. If
a worker returns no generated artifact or source path, the lifecycle must fail
with no candidate publication. Treat this as a worker/tool-availability
failure, not as an art rejection and not as evidence that login succeeded or
failed. A timeout or nonzero worker exit preserves the exact effective
`prompt.txt` plus the capped partial `worker.jsonl` and `worker.stderr.log`,
while leaving candidate image and metadata absent. Inspect that evidence and
any audited final message, then make any retry an explicit new operator action.
`--recover` is
not applicable unless a route worker successfully copied one exact generated
artifact and the parent rejected later evidence. A repeated zero-artifact
result must stop that family for tooling investigation; do not switch to an API
key, another model, or a fallback generator implicitly.

If Imagegen returns verified bytes but a non-route post-verification or
publication validator rejects them, the lifecycle preserves those exact bytes
and a content-addressed failure record under
`ai-image-metadata/battle-art/generated-artifacts/<theme>/<family>/`. The
record pins the descriptor, effective prompt, bounded worker evidence, ordered
style references, failure stage, rejection, and artifact hash. It is diagnostic
history only: it creates no candidate, cannot be reviewed or approved, cannot
authorize resume, and cannot satisfy readiness or publication. An identical
failure is idempotent; changed or missing evidence fails audit. This boundary
lets operators inspect concrete orientation, alpha-component, placement, and
other raster failures without weakening the candidate approval gate.

The active Heartlands `straight-ns` canary uses direct whole-image generation:
one ordinary forest template reference, exact-aspect whole-image resize when
needed, normalization, and the generic raster contract. The experimental
`routeFinishing` and rejected-artifact corrective-reference path remains in the
tooling for historical audit and explicit opt-in testing, but is not active on
this descriptor.

The v12 draft corrects only the direct-generation prompt: N `(192,32)` and S
`(64,96)` are full-width terminal seam cross-sections, with short transverse
caps 4–6 pixels beyond them at `(196,30)` and `(60,98)`. The rejected v11
candidate and its immutable review evidence remain preserved; do not normalize,
replace, or reuse those bytes when generating v12.

Every new direct route candidate records
`battle-art-route-direct-preparation-v1` provenance. It pins the immutable raw
path, hash, byte count, format, and dimensions, plus whether the one
exact-aspect whole-image Lanczos3 resize was applied, the fixed PNG
normalization operation, and the final candidate hash. Normalize, recovery,
preview, review, approval, and audit replay that preparation from the pinned
raw and require byte-identical output. Re-hashing replacement candidate bytes
does not satisfy this provenance.

Route-transition workers have a deliberately smaller finishing surface. For
new non-forest work, the worker reads the pinned image-generation skill, makes
the one imagegen call, executes no artifact-copy or discovery command, and
stops. The parent parses the sole safe `thread.started` identity, securely
opens the exact `CODEX_HOME/generated_images/<thread-id>/` directory, requires
one regular generated raster, and materializes `candidate.png` itself with an
exclusive write. It rejects zero or multiple rasters, unsafe or cross-thread
identities, symlinks, changed files, worker-created candidates, and any extra
worker command. This avoids depending on the model to transcribe an output
path while retaining byte identity with the generated artifact. Review replays
the same strict parent-handoff JSONL contract and the immutable raw-to-candidate
derivation. A suppressed Imagegen event is accepted only for this non-forest
route path, with one safe thread, one canonical skill read, no other worker
action, and exactly one parent-resolved raw artifact. The older
worker-copy protocol remains only on the forest compatibility path so its
frozen prompt and review evidence stay byte-identical.

For a descriptor with `routeFinishing`, the parent first verifies the copied
bytes and exact source aspect, then persists that raw image under its SHA-256
identity in `ai-image-metadata/battle-art/generated-artifacts/`. That raw path
is tracked, immutable, and survives failed validation, forced regeneration,
and review.
The parent removes chroma, selects the one largest four-connected alpha
component, rejects source-border truncation, excessive detached coverage, or
a source/target subject-aspect mismatch that would require more than 5:4
X/Y scale anisotropy, crops once to that component, resizes once with Lanczos3 into the
descriptor-pinned target box, and places it on the declared canvas. It then
runs the descriptor-pinned border, arm-width/spread, topology, and coverage
checks once before publishing a candidate. The metadata records the complete
raw-to-final derivation and hashes.

An `isolated` route has no arm samples. Its finished-artifact contract instead
requires nonzero alpha, exactly one four-connected visible component, contact
with the declared anchor neighborhood, complete containment in the pinned
target box, a clear outer canvas border, and no route endpoint bands. For
`cave-limestone-curved-passage-isolated`, that target is the centered 64x32 box
at `(96,48)`. Do not reject an otherwise suitable generated subject solely
because its raw component is larger: the pinned one-crop/one-resize transform
is the sizing authority, and review/audit reproduce its exact output bytes.

The arm-width range applies to the connected near-opaque route band at the
descriptor's exact alpha threshold; it is not a measurement of the faintest
visible fringe. Generation prompts must state that threshold explicitly.
For direct-route `end-*` topology only, the final normalized alpha-240
perpendicular minimum is 20 pixels at the 50% and 75% samples and 18 pixels at
the 100% seam sample. Other direct corners, straights, tees, and crosses retain
the 28-pixel minimum at every sample. A descriptor-authored
`routeFinishing.armAlphaSpan` remains authoritative and keeps its authored
minimum, maximum, and spread semantics.
When arm validation fails, the rejection reports every direction/fraction
sample in canonical order, every narrow or wide sample, the observed range,
and any spread violation so one attempt does not reveal defects serially.

Before candidate validation, every route transition durably pins the exact
generated raw artifact. If validation then fails, generation also writes an
immutable, content-addressed
`battle-art-route-failed-attempt-v1` JSON record beside the family’s raw
artifacts. It embeds and hashes the exact descriptor snapshot, prompt, bounded
worker logs, style provenance, and the applicable one-imagegen current-thread
copy or strict parent-handoff audit, plus the raw identity and rejection. A
later forced attempt may replace the ignored
working diagnostics, but it cannot overwrite or orphan the earlier failure
evidence.

If a deliberately reviewed validator change makes one exact archived route raw
eligible, revalidate that immutable evidence without another image-generation
call:

```bash
npm run battle-art:revalidate-failure -- \
  --theme <theme> \
  --family <exact-route-family-id> \
  --failure <canonical-content-addressed-failure-record.json>
```

This command accepts only a draft route family and an audited canonical failure
record for that exact family. It replays current preparation and validation,
writes a review candidate with revalidation origin pins, and does not approve,
compile, publish, or invoke Imagegen.

Generated artifacts are not ordinary style-reference roots. The sole narrow
exception is an immutable rejected route raw explicitly authorized by the
module-pinned
`ai-image-metadata/battle-art/corrective-style-reference-registry.json`.
Each authorization pins one exact consumer theme/family, raw path and hash,
and failed-attempt record path, content hash, and full hash. Manifest loading
verifies that complete tuple and the raw bytes; generation then re-runs the
full failed-attempt audit before staging the reference. A descriptor may use
the authorization only for its exact consumer and must place it last so it is
the final-precedence same-orientation corrective edit target. Earlier approved
art may remain a secondary material or width-profile oracle.

This exception does not approve or promote the rejected raw. It remains
non-publishable and non-reusable outside its registered correction, and the
new result must independently pass every current raster, finishing, topology,
width, spread, and review contract. Arbitrary generated-artifact pins, missing
or altered failure evidence, cross-family use, and a corrective reference in
any non-final position are rejected.

Because the correction is an image edit, a descriptor using this registry
cannot use `--text-style-fallback`; generation and recovery fail closed unless
the ordered attachments are available.

There is no placement enumeration, scoring loop, transform retry, or local
content repair. An invalid source produces one actionable rejection while
retaining the bounded worker diagnostics and immutable raw evidence. A
mismatched aspect, truncated component, detached fragment excess, narrow or
wide arm, excess width spread, border contact, or coverage failure cannot be
promoted for visual review.

If a route worker completed its one imagegen call and unchanged artifact copy
but the parent lifecycle rejected the evidence before publication, recover
that exact artifact through the same npm command instead of generating again:

```bash
npm run battle-art:generate -- \
  --theme forest \
  --family <exact-route-family-id> \
  --recover \
  --timeout <original-worker-timeout-seconds>
```

Recovery is deliberately narrow: it accepts exactly one explicit draft
route family, requires the original bounded prompt, JSONL, stderr, and final
message, requires no existing candidate publication, and requires the exact
current prompt and style pins. It re-audits the one-call/current-thread copy
evidence, securely reads the preserved generated artifact, and passes those
bytes through the same deterministic parent-side path as ordinary generation.
It never starts a worker or calls imagegen. The original timeout must be
supplied so the reconstructed candidate provenance records the invocation
accurately.

Do not batch live families or use `--keep-going`. Run one reviewed family per
live command at concurrency `1`, inspect its result, and only then proceed to a
separate command.

The normal path sends the hash-pinned style reference to the image tool. In a
restricted nested sandbox where local image ingestion is unavailable, use the
tracked textual authority without changing models or bypassing the lifecycle:

```bash
npm run battle-art:generate -- \
  --theme forest \
  --family forest-heartlands-loam-path-straight-ns \
  --concurrency 1 \
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
For non-forest families, code-owned prompt boilerplate is projected into the
descriptor's regional material vocabulary without changing the frozen prompt
profile pin. Non-route workspaces do not stage the contradictory raw profile
text. Before a draft can be reviewed, approved, or resumed, the lifecycle
rebuilds the current effective prompt and requires `prompt.txt` to match it
byte-for-byte. This freshness gate does not rewrite or invalidate immutable
reviews for content that was already human-approved.
Operational accounting must distinguish actual worker starts and Imagegen
invocations from deterministic normalization and validation checks. One failed
validation is not another generation attempt. The lifecycle performs no
automatic retry, candidate search, placement enumeration, or selection loop.

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

A route candidate with an immutable finishing derivation is already canonical.
Normalization replays and verifies its raw-to-final derivation first. If a
normalizer change would alter those final bytes, the command fails instead of
rewriting the image and invalidating provenance; regenerate only after the
tracked finishing contract itself is deliberately revised.

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
alignment, route topology, and regional art direction. Record every decision
against the exact current candidate with a concrete rationale. Rejected records
must be written before regenerating the draft candidate:

```bash
npm run battle-art:review -- \
  --theme forest \
  --family heartlands-earth-slope-n-grade-1 \
  --reviewer <identity> \
  --decision rejected \
  --reason "<specific visual or contract issue>"
```

Review records are immutable, content-addressed tracked JSON under
`ai-image-metadata/battle-art/reviews/`. They pin the candidate metadata, image,
frozen prompt/style inputs, and worker evidence. Route records additionally pin
the content-addressed raw artifact and deterministic finishing derivation;
review audit re-reads that raw pin and replays current-contract derivations.
An identical retry is safe; a different decision, reviewer, or rationale for
the same candidate is rejected. Regenerate a rejected draft to obtain a new
candidate identity.

Then approve each accepted concrete family explicitly:

```bash
npm run battle-art:approve -- \
  --theme forest \
  --family heartlands-earth-slope-n-grade-1 \
  --reviewer <identity> \
  --decision approved \
  --reason "<specific acceptance rationale>"
```

Approval creates or verifies the matching approved review record before
promoting the source. `battle-art:review --decision approved` can backfill a
just-approved, not-yet-compiled family when its exact candidate is still
present. Archived legacy releases remain valid without retroactive review
records. That legacy exemption is pinned to releases 1–6 of
`battle-art-descriptors-2026-07-30`; later archives remain review-gated.

Compile and validate immutable runtime assets:

```bash
npm run battle-art:compile
npm run battle-art:matrix
npm run battle-art:audit
npm run battle-art:check
```

The runtime bundle carries exact descriptor-v2 variant metadata. After every
descriptor in the release is compiled and the strict battle-art matrix, audit,
and check pass, archive it. Then create the map compile recipe against that
immutable archive and run the map/release checks:

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
validate the release, and deploy code, catalog, and immutable assets together.
The tracked active catalog release is the activation mechanism.

### Choosing the next catalog gap

The active catalog is publication state, not a lexicographic work queue. Never
assume that a missing template number is eligible: `forest-template-03` pins a
superseded compiler and `forest-template-06` is rejected lifecycle evidence.
Do not regenerate or republish either identity.

For a new theme wave, walk the tracked
`BATTLE_MAP_V3_SUPPORTED_THEMES` order and select the first theme with no active
catalog entry, then create a new frozen source-template definition and exact
regional art-readiness plan. With the current forest-only r16 release, that
planning rule selects `cave`; the first declared identity is
`cave-template-01`. This rule chooses authoring work only. Runtime selection
remains entirely catalog-driven, and a generated source-image candidate is not
an approved blueprint, compiled map, coverage claim, or activation.

All newly authored maps use the V3 blueprint, mechanical-review, approval, and
release lifecycle regardless of their numeric suffix. V1 and V2 are deprecated
compatibility formats only: `forest-template-01/-02` preserve V1 evidence and
`forest-template-03/-04/-05/-06` preserve V2 evidence. Every other identity is
V3 by default, including `cave-template-01`. Never infer a lifecycle version
from `-01`, `-02`, or another suffix, and never create new V1/V2 approvals.
Existing `forest-template-07` approvals remain readable as a narrow transition:
their approval schema and mechanical evidence are V3, while their immutable
candidate records pin the older V2 prompt bytes. That historical read path must
never select the V2 prompt for newly generated or newly approved content.

Before cave blueprint generation, prove this identity routing through the
candidate, prompt-profile, approval, and release validators and provide the
cave-specific V3 starter. Because those validators are pinned by the active
catalog, ship the change with the coordinated recipe/map/approval/catalog
repin—not as an isolated generation shortcut.

### Source previews are not rendered-map review

The review tree contains two different evidence phases. HTML files named
`source-template-preview*.html` show source-image candidates and their tracked
review history only. They do not prove that a symbolic blueprint compiles or
that the production renderer can resolve its regional assets. A new theme such
as cave is therefore expected to have only HTML review files while its source
is still draft.

Rendered map samples are a later, mandatory phase. Do not consider a cave map
ready for approval or publication until all of these dependencies exist and
are hash-valid: an approved source template, three approved symbolic
blueprints, the cave render profile and tile catalog, the exact compiled cave
battle-art bundle, and a deterministic compile recipe. Only then run
`battle-maps:compile`, `battle-maps:validate`, and `battle-maps:screenshot` for
each map. The screenshot command must create the production-harness PNG and its
bound `.review.json` beneath
`ai-image-metadata/battle-maps/review/cave/<template>/<map>/`. A distinct
reviewer must inspect that exact PNG before `battle-maps:approve` records the
visual decision. Catalog creation and activation re-verify the ignored PNG and
runtime-asset hashes; an HTML source preview can never satisfy this gate.

For `cave-template-01`, the source and three V3 blueprints may therefore be
approved while production PNGs are still correctly absent. The three
blueprints directly resolve 33 authored concrete cave-art variants (the
synthetic preflight currently exercises one additional already-approved face
variant), but the official v11 battle-art release is whole-manifest: all 43
cave descriptors must be approved before non-check compilation will publish
the bundle. Do not create a partial runtime bundle to obtain an early
screenshot. Before compiling the maps, validate the tracked
`battle-maps/render-profiles/cave-limestone-v1.json` profile (including its
explicit `worn-floor` to `layered-face` elevation mapping) and
`battle-maps/tile-catalogs/cave-limestone-v1.json` catalog. Create
`battle-maps/compile-recipes/cave/cave-template-01.json` only after the complete
cave art bundle is compiled and archived, so the recipe can pin that real
immutable bundle hash together with the two regional inputs and all three
blueprints. These are authored release inputs, not values to infer from the
synthetic blueprint preflight.

Source-image review is intentionally composition-level. Review regional
material, cavern scale, lighting hierarchy, readable walkable-vs-solid areas,
the irregular biome-owned silhouette, and gross forbidden patterns such as a
rectangular dungeon room or opaque void over the battlefield. Do not reject a
source reference merely because an exact route graph, spawn count, ramp count,
or formation-to-formation connectivity cannot be proven from the pixels. The
source contract is `semantic-only`, literal tracing is forbidden, and the
sidecar—not the raster—is gameplay authority. Those exact requirements are
proved by blueprint validation and then inspected again in the compiled
production-harness screenshots.

A Codex source review is advisory evidence, not a substitute for the recorded
human decision. If a workspace reviewer accepts exact bytes that Codex
previously rejected, preserve the immutable rejection record, stage those
exact bytes, and record the human source approval normally. Never delete or
rewrite the earlier evidence, and never describe a vague preference such as
"too diffuse" as a mechanical failure.

### V3 symbolic blueprint generation and review

After source approval and the V3 identity-routing checks pass, validate the
three declared jobs without starting Codex:

```bash
npm run battle-maps:candidates:generate -- \
  --theme <theme> --template <template> \
  --maps 3 --concurrency 2 --dry-run --json
```

Then generate the three isolated symbolic candidates. This is a Codex JSON
authoring phase, not Imagegen and not map publication:

```bash
npm run battle-maps:candidates:generate -- \
  --theme <theme> --template <template> \
  --maps 3 --concurrency 2 --json
```

The same authenticated Codex CLI preflight applies. The workers receive the
approved source and closed V3 contract, may write only their bounded ignored
candidate evidence, and cannot approve, compile, catalog, or activate content.
For every new identity, the result must pin `map-blueprint-v3`; a V1/V2 prompt
pin is permitted only when replaying the explicitly documented immutable
historical evidence.

Create the deterministic mechanical report and SVG preview for every candidate:

```bash
npm run battle-maps:candidates:preview -- \
  --theme <theme> --template <template> --all --json
```

A reviewer distinct from the generating principal must inspect each candidate
and exact mechanical preview. The IDs in the template's tracked
`candidateMaps` array are sibling release maps, not competing alternatives.
Record one bounded rationale per accepted sibling, use `--update-pins` on the
final sibling to pin the complete approval-index hash, then replay the full
declared set:

```bash
npm run battle-maps:candidates:approve -- \
  --theme <theme> --template <template> --map <map> \
  --reviewer <reviewer-id> \
  --reason "<routes, formations, elevation portals, closure, and readability>"

# Repeat for every declared sibling; add this flag to the final approval only:
#   --update-pins
npm run battle-maps:candidates:check -- \
  --theme <theme> --template <template> --all
```

The final pin update fails closed while any declared sibling lacks an approved
entry. The `--all` replay likewise reports each missing sibling; it does not
mean "check whichever candidate happened to be selected."

V3 approval binds the exact candidate, V3 prompt, reviewer rationale,
mechanical report, and preview hashes. It is still not visual map approval; the
production-rendered PNG gate below remains mandatory after assets and recipes
exist.

### Executable map publication procedure

For each approved source template and its reviewed blueprint set:

```bash
# 1. Deterministically compile, then replay without writes.
npm run battle-maps:compile -- \
  --theme <theme> --template <template> --all-approved
npm run battle-maps:validate -- \
  --theme <theme> --template <template> --all-approved

# 2. Render one production-harness screenshot per compiled map.
npm run battle-maps:screenshot -- \
  --map battle-maps/compiled/<theme>/<map>.v<version>.json \
  --output-dir ai-image-metadata/battle-maps/review/<theme>/<template>/<map>

# 3. Only after a distinct reviewer inspects that exact PNG, record approval.
npm run battle-maps:approve -- \
  --theme <theme> --template <template> --map <map> \
  --screenshot <local-review-png> \
  --reviewer <reviewer-id> \
  --reason "<composition, topology, seams, elevation, boundaries, and readability>"

# 4. Strictly replay a prepared cumulative definition without changing files.
npm run battle-maps:catalog -- --release <release-id> --check

# 5. Write the immutable release, then update the tracked active pin.
npm run battle-maps:catalog -- --release <release-id>
npm run battle-maps:catalog -- --release <release-id> --activate
```

Repeat screenshot and approval for every map in the template. `--check` is the
routine incremental-release preflight and requires the local binary evidence
unless `--metadata-only` is supplied. Metadata-only mode is appropriate for
clean CI pin/recompile checks, but it explicitly makes no binary-evidence claim
and cannot activate. `battle-maps:coverage -- --release <release-id>` is the
separate final acceptance gate for the complete 16-theme, 144-map corpus; a
bounded pilot release is expected not to satisfy it.

Publishing terminology in this lifecycle is exact:

- **candidate publication** writes ignored local candidate data for review;
- **source promotion** writes immutable tracked approved-source metadata;
- **compilation/archive** creates deterministic runtime art or map content and
  preserves the exact art release;
- **catalog creation** writes an immutable tracked cumulative release;
- **activation** updates the tracked active-release pin; and
- **deployment** ships that verified code/catalog/art set.

Candidate trees, review screenshots, and runtime binary assets may be ignored
local evidence. Their tracked review, approval, archive, recipe, map, catalog,
and active-pin records are immutable or versioned. Restore every ignored binary
named by those records and verify its hash before activation. Never hand-edit
`active-release.json`; roll back by deploying the previous verified
code/catalog/art release and rerunning its strict catalog check.

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
coverage may use the explicitly coded V2 compatibility path during migration,
but no new V2 content may be authored. Present approved coverage automatically
selects V3. After the complete V3 catalog is deployed, remove the V1/V2
new-battle compatibility path in a separate verified cleanup; persisted older
battles remain readable according to their stored schema. Rollback deploys the
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
2. Run `battle-art:preflight`, then `battle-art:matrix --metadata-only --json`.
3. Add reviewed theme/ecology/tier requirements before drafting.
4. Scaffold; do not hand-copy descriptors.
5. Generate exactly one candidate per concrete family through npm scripts.
6. Normalize existing candidates after normalizer changes, then preview and
   approve direction/topology/ecology accurately.
7. Compile, run the strict matrix/audit/check, and archive.
8. Integrate exact assets into map profiles and compile maps.
9. Render and independently review every final screenshot.
10. Check, create, and activate only via a tracked catalog deployment.
