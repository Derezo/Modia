# Battle Map V3 deterministic content release

Release assembly commands consume reviewed, tracked metadata only. The source
candidate rejection command below reads exact ignored generation evidence only
to emit tracked provenance. These commands never generate images or blueprints
and never read a runtime activation flag.

## Rejecting a generated source-image candidate

Review and reject one exact generated source-image candidate with:

```bash
npm run battle-maps:templates:reject-candidate -- \
  --theme forest \
  --template forest-template-03 \
  --candidate candidate-01 \
  --reviewer <reviewer-id> \
  --decision rejected \
  --reason "<specific visual rejection rationale>" \
  --json
```

The command requires the complete ignored candidate result, decoded image,
prompt, and worker logs. It verifies their fixed paths and source-template
prompt-profile pin, rejects symlinks and unsafe identities, and requires the
worker JSONL to prove exactly one image-generation invocation. It records the
exact byte counts and SHA-256 hashes, image dimensions and format, reviewer,
decision, and rationale at:

`battle-maps/source-image-rejections/<theme>/<template>/<candidate>.json`

That tracked record is immutable and cumulative. Repeating an identical review
is idempotent; changed candidate evidence, reviewer, or rationale is rejected
instead of overwriting history. A regenerated image must use a new candidate
identity. This rejection lifecycle never invokes image generation and never
stages, approves, promotes, compiles, catalogs, or activates content.

## Approving a symbolic blueprint candidate

Generate template-03-or-newer candidates from the staged standalone starter.
The isolated worker copies that valid starter and makes bounded edits; accepted
output must change at least two authoritative geometry groups, including a
mask/surface, required-route, or spawn composition group. Reordering records or
cells does not count, and connection-kind plus decoration-only edits are
rejected. Map-specific retry safeguards may freeze geometry already proven by
the semantic validator and direct the worker to a safer bounded edit.

Approve a reviewed template-03-or-newer blueprint with a bounded rationale:

```bash
npm run battle-maps:candidates:approve -- \
  --theme forest \
  --template forest-template-03 \
  --map forest-template-03-a \
  --reviewer <reviewer-id> \
  --reason "<specific acceptance rationale>"
```

`--reason` must be non-empty, trimmed, free of control characters, and at most
1000 UTF-8 bytes. The command validates this structure; reviewers remain
responsible for the rationale's substance.
For template-03 and newer identities, the rationale is stored in the v2
approval record and approval-index entry. The record `fullHash` covers the
complete record including its rationale, and the index `fullHash` covers every
entry including the rationale and record hash. Compile recipes and content
releases pin that index hash, so a new release transitively hashes the reviewed
rationale.

Existing template-01 and template-02 approvals remain in their frozen v1
record and index formats. Their command omits `--reason`, and release
validation continues to accept their existing byte-valid records and hashes.
Do not rewrite those legacy approvals to v2.

Blueprint prompt profiles follow the same explicit compatibility boundary.
Template-01 and template-02 candidates and approvals continue to pin the frozen
`map-blueprint-v1.json` bytes. Template-03 and newer candidates use the tracked
`map-blueprint-v2.json` profile, whose fixed-family contract must not be copied
back into v1. Verify legacy approval compatibility without rewriting evidence:

```bash
npm run battle-maps:candidates:check -- \
  --theme forest --template forest-template-01 --all
```

## Initial compiler pin for a new source template

Source-template eligibility uses the complete `tier-1` through `tier-5`
vocabulary. After staging a new template source, and before approving that
template, explicitly pin the exact current compiler source set:

```bash
npm run battle-maps:templates:pin-compiler -- \
  --theme forest \
  --template forest-template-02 \
  --compiler-full-hash sha256:<64 lowercase hex> \
  --json
```

Obtain the value from the `fullHash` returned by the exported
`computeCurrentCompilerSourceSet({ projectRoot })` helper. The helper hashes
and then revalidates every path in the closed `COMPILER_SOURCE_FILES` set; it
rejects missing, changed, non-regular, or symlinked inputs.

This command is an initial, one-way lifecycle transition. It requires an
already staged, unapproved template and an explicitly supplied hash equal to
the exact current compiler source set. Repeating the same pin is idempotent.
A non-current supplied hash, a different existing compiler pin, a draft
template, or any approved template is rejected without rewriting the sidecar.
If either a staged pin or an approved template must change, create a new
template identity. The command does not generate images or blueprints, approve
content, update compile recipes, or activate a catalog release.

All supported sidecar writers—including draft, stage, compiler pin, source
approval, and blueprint `--update-pins`—serialize on the same per-template
lifecycle lock. Conditional rollback also requires the sidecar to still equal
the exact bytes written by the operation. Direct/manual writes that bypass
these lifecycle commands and their lock are unsupported; tracked sidecars must
be changed only through the documented commands.

## Compile recipe

Each approved template has one closed recipe at:

`battle-maps/compile-recipes/<theme>/<template>.json`

```json
{
  "schemaVersion": "battle-map-v3-compile-recipe-v1",
  "theme": "forest",
  "templateId": "forest-template-01",
  "sourceSidecar": {
    "path": "ai-image-metadata/battle-maps/templates/forest/forest-template-01.json",
    "fullHash": "sha256:<64 lowercase hex>"
  },
  "blueprintApprovalIndex": {
    "path": "ai-image-metadata/battle-maps/blueprints/forest/forest-template-01/approvals.json",
    "fullHash": "sha256:<64 lowercase hex>"
  },
  "renderProfile": {
    "path": "battle-maps/render-profiles/forest.json",
    "fullHash": "sha256:<64 lowercase hex>"
  },
  "tileCatalog": {
    "path": "battle-maps/tile-catalogs/forest.json",
    "fullHash": "sha256:<64 lowercase hex>"
  },
  "assetBundle": {
    "path": "ai-image-metadata/battle-art/runtime-asset-bundle.json",
    "manifestFullHash": "sha256:<64 lowercase hex>"
  },
  "compiler": {
    "id": "template-map-compiler",
    "version": 5,
    "fullHash": "sha256:<64 lowercase hex>",
    "sourceFiles": [
      {
        "path": "<exact path from COMPILER_SOURCE_FILES>",
        "sha256": "sha256:<64 lowercase hex>"
      }
    ]
  },
  "validator": {
    "id": "battle-map-v3-validator",
    "version": 1,
    "fullHash": "sha256:<64 lowercase hex>",
    "sourceFiles": [
      {
        "path": "<exact path from VALIDATOR_SOURCE_FILES>",
        "sha256": "sha256:<64 lowercase hex>"
      }
    ]
  },
  "maps": [
    {
      "blueprintId": "forest-template-01-a",
      "contentId": "forest-template-01-a",
      "contentVersion": 1,
      "templateRevision": 1
    },
    {
      "blueprintId": "forest-template-01-b",
      "contentId": "forest-template-01-b",
      "contentVersion": 1,
      "templateRevision": 1
    },
    {
      "blueprintId": "forest-template-01-c",
      "contentId": "forest-template-01-c",
      "contentVersion": 1,
      "templateRevision": 1
    }
  ]
}
```

`computeSourceSetFullHash`, `COMPILER_SOURCE_FILES`, and
`VALIDATOR_SOURCE_FILES` are exported by `content-release-lifecycle.mjs` for
deterministic recipe creation. Render-profile hashes use the exported
`RENDER_PROFILE_HASH_DOMAIN`. Tile-catalog, sidecar, blueprint, art-bundle,
map, and catalog hashes use the shared V3 hashing functions.

Compilation invokes `compileTemplateMapBlueprint`, finalizes with
`finalizeBattleMapV3`, repeats the complete compile, and requires identical
canonical bytes. It also runs the production spawn matcher across every
supported player/opponent roster size.

## Visual approval

`approve-map.mjs` requires:

- a byte-identical approved-input recompile;
- all exact runtime assets restored and hash verified;
- a decoded PNG screenshot of at least 512×512 beneath
  `ai-image-metadata/battle-maps/review/<theme>/<template>/<contentId>/`; and
- an explicit safe reviewer ID and concrete `--reason` describing the inspected
  composition, topology, route seams, elevation, boundaries, and gameplay
  readability.

It writes immutable tracked metadata to
`battle-maps/approvals/<theme>/<contentId>.v<version>.json`. The local
screenshot remains ignored evidence, but its exact path, bytes, dimensions,
format, and SHA-256 are pinned by that record. The same approval includes a
deterministic map-hash-bound boss/competitive capability report; catalog
eligibility cannot claim a capability that report does not prove.

Capability reports are upper bounds, not automatic catalog claims. The forest
pilot deliberately publishes every current entry with `bossCapable: false`
until boss-specific coverage and release acceptance are added; a structurally
boss-capable approval alone must not make the map eligible for boss-required
selection.

## Catalog definition and activation

Each immutable release has a closed definition at:

`battle-maps/catalog/definitions/<release-id>.json`

```json
{
  "schemaVersion": "battle-map-v3-catalog-definition-v2",
  "catalogReleaseId": "battle-map-v3-2026-08-01",
  "entries": [
    {
      "id": "entry:forest-template-01-a",
      "mapPath": "battle-maps/compiled/forest/forest-template-01-a.v1.json",
      "approvalPath": "battle-maps/approvals/forest/forest-template-01-a.v1.json",
      "approvalFileSha256": "sha256:<64 lowercase hex>",
      "orientation": "isometric-diamond",
      "teamLayout": "players-vs-opponents",
      "weight": 1,
      "bossCapable": false,
      "competitiveParity": false
    }
  ],
  "coverageQueries": [
    {
      "id": "coverage:forest:pve:tier-1",
      "theme": "forest",
      "sourceTier": 1,
      "selectionBand": "tier-1",
      "mode": "pve",
      "dimensions": { "width": 32, "height": 32 },
      "teamLayout": "players-vs-opponents",
      "playerCounts": [1, 2, 3, 4, 5],
      "opponentCounts": [1, 2, 3, 4, 5, 6, 7],
      "requireBossCapable": false,
      "requireCompetitiveParity": false
    }
  ]
}
```

New tracked definitions use `battle-map-v3-catalog-definition-v2`. A cumulative
definition may retain an exact previously published map by adding a
`historicalPublication` witness to that entry with the earlier
`catalogReleaseId` and `catalogFullHash`. The builder accepts that path only
when the witness resolves directly to a legacy v1 definition rooted in normal
current-map compilation and the self-hashed release, approval-bound definition
entry, map hash, approval-file hash, selection metadata, archived asset bundle,
and binary evidence all match exactly. Witnessed v2 definitions are rejected,
which prevents future or cyclic witness chains from bypassing compilation. New
content without that evidence still requires a current-recipe byte-identical
recompile and a reasoned visual approval v2. Legacy v1 definitions and their
historical approval records remain readable.

The generated release uses catalog schema 3 with selector 2. Schema 3 pins each
asset bundle by `(assetBundleId, assetBundleVersion, manifestFullHash)`, so a
cumulative release can retain an older map and its exact bundle while adding a
newer bundle version under the same release-family ID. Catalog schemas 1 and 2
retain their original shapes and hash domains. `selectorVersion` belongs to the
generated release; do not add it to the definition document.

The authoritative coverage ID may repeat for different regional ecologies;
order those rows by `(id, ecologyProfile)`. Complete-matrix acceptance
deduplicates the repeated ecology rows only while proving authoritative theme
coverage, never while selecting an encounter.

Entries are ordered by `mapPath`; coverage queries are ordered by `id`. Pilot
definitions may include an ordered subset of the project-owned authoritative
coverage matrix, allowing catalog-absence V2 compatibility during migration.
Each declared query must exactly equal its authoritative
theme/tier/mode/capacity profile. The separate coverage acceptance command
requires the complete matrix for all 16 themes. Every Cartesian
player/opponent count case in every declared query must select an eligible map.
Publication also checks every positive-weight eligible map—not merely the map
chosen by one sample seed—against the maximum player and opponent counts in
each capability band.
Complete acceptance additionally requires exactly 144 unique maps: nine maps
from three three-map templates in every theme, with unique authoritative,
visual, and full hashes plus route, elevation/region, formation, and
obstacle/boundary diversity within each trio.

The finalized release is written immutably to
`battle-maps/catalog/releases/<release-id>.json`. `--activate` writes the
API loader's tracked `battle-maps/catalog/active-release.json` only after
strictly verifying every ignored screenshot and runtime asset. It is rejected
with `--metadata-only`.

Metadata-only checks explicitly return `binaryEvidenceVerified: false` and a
`skippedBinaryChecks` list. They validate tracked metadata, hashes, compilation,
maps, approvals, and catalog coverage without claiming ignored binaries exist.

Within a pinned release, identical encounter identity, node-derived terrain
seed, roster counts, and ecology select the same immutable map. Adding another
map or ecology therefore requires a new tracked release; it never mutates an
existing battle. Catalog content activates automatically, with V2 compatibility
only when eligible V3 content is absent. Do not add an environment flag,
client downgrade, enabled-profile list, or runtime rollout gate.

## Current cumulative forest reference release

The active production-data reference for this lifecycle is the tracked
`battle-map-v3-forest-pilot-2026-07-30-r16` release. It retains the exact r6
Borderwood entry and publishes the complete approved Heartlands template-04
and template-07 trios plus the Borderwood template-05 trio:

- Borderwood reference: `forest-template-01-b@12`,
  `forest-iron-depths-borderwood`, asset bundle version 6, map hash
  `sha256:cad472a23e3ff4cc3549076b0a4715df4611ee91f87cb095d7c699ffe1d372f8`;
- Heartlands A: `forest-template-04-a@9`,
  `forest-heartlands-woodland`, asset bundle version 7, map hash
  `sha256:4e60edd8fce88103da04d651eb4590ee474c222cfe45379690b5f27553e7b006`;
- Heartlands B: `forest-template-04-b@9`, the same exact ecology and bundle,
  map hash
  `sha256:23a55dfe499edc8f463d1e264edc3a0c70c6d661df7cdd831920cbe498c8fa25`;
- Heartlands C: `forest-template-04-c@9`, the same exact ecology and bundle,
  map hash
  `sha256:709a6454dbd30bd9dec7f6cada5c8767dab19fb8b72dedc0ba56b52bfd967edd`;
- Borderwood A: `forest-template-05-a@6`,
  `forest-iron-depths-borderwood`, asset bundle version 7, map hash
  `sha256:0eca0d516b11bb9d997dbc1a08ccaff5121247c13cfa7361fb7386324b3ac3f2`;
- Borderwood B: `forest-template-05-b@6`, the same exact ecology and bundle,
  map hash
  `sha256:03a18a91fefff361f6787b9317389569fa7cbc1b253d1828316015a51ae44661`;
- Borderwood C: `forest-template-05-c@6`, the same exact ecology and bundle,
  map hash
  `sha256:7f1afbace02d1d19ae0e028da7600f05978667dfad152ed920aeb02a76e62fad`;
- Heartlands storm-fallen-oak A: `forest-template-07-a@8`,
  `forest-heartlands-woodland`, asset bundle version 10, map hash
  `sha256:aa091727e1db41cedbb964b8e96a28f33fac5ba8f92f82fb0ff248b30bfbf02c`;
- Heartlands storm-fallen-oak B: `forest-template-07-b@8`, the same exact
  ecology and bundle, map hash
  `sha256:550e2b3b4089e9e63c818fa7c26c0715c32c998885590cff91bbb062c9c559ac`;
- Heartlands storm-fallen-oak C: `forest-template-07-c@8`, the same exact
  ecology and bundle, map hash
  `sha256:700fee842a625237aa815a224e3377045d088078e0513d183a5a73bcd4838a79`;
- r16 catalog hash:
  `sha256:c0978f801d4d496d8873d12d140aae6c012ceca9cf5134d62fdccd8901a8cd5f`.

The r6 release and definition remain immutable publication evidence for the
historical Borderwood entry. The approved r5/v11 release and historical r3/r4
releases with their v9 map remain immutable compatibility fixtures.
The earlier template-03 source and blueprints also remain immutable evidence:
their approved sidecar pins a superseded compiler and therefore cannot acquire
a current compile recipe. The rejected template-06 maps remain uncataloged
lifecycle evidence. The reviewed storm-fallen-oak composition was authored as
the new template-07 identity through the current source, compiler-pin,
blueprint-generation, and approval lifecycle.

For Whispering Woods, node seed `1665986859` plus the exact Borderwood ecology
selects template-05 C@6 for every supported 1–5 player / 1–7 opponent roster.
Other forest ecologies continue through the explicit V2 compatibility path
unless they have their own approved catalog entry. Heartlands tiers 1–5 select
deterministically among template-04 A@9, B@9, C@9 and template-07 A@8, B@8,
and C@8 automatically;
Borderwood tier 1 selects among the retained reference and template-05 A@6,
B@6, and C@6. Never broaden either ecology-qualified entry to generic forest
coverage.
