# Authored Player Animation Pipeline

This is the operator runbook for creating and rebuilding Modia's higher-quality player animation sets. It covers one identity such as `elf_other_wizard`, from registry metadata through tracked source art to the runtime sprite strips.

The pipeline does not add a separate approval service or workflow. A per-identity JSON spec, its tracked PNG sources, and the existing compiler are the complete system.

## What “reproducible” means

There are two boundaries:

| Stage | Reproducibility contract |
|---|---|
| Candidate image generation | Nondeterministic. The same prompt may produce different pixels. Keep the exact prompt, input images, raw chroma result, and accepted transparent result so the choice is auditable. |
| Canonical compilation | Deterministic within the repository's locked Node/Sharp/libvips toolchain. The accepted PNGs and pinned metadata recreate the same reference and animation strips byte-for-byte. |

The accepted transparent PNGs are the canonical creative inputs. Rebuilding runtime assets does not require access to the original image model or chroma-removal helper.

Two candidate-stage details are not currently pinned: the image model/tool version and the implementation hash of the Codex-installed chroma helper. This does not affect canonical rebuilds because both the raw chroma candidates and accepted RGBA sources are tracked.

Use the locked toolchain before compiling:

```bash
nvm use
npm ci
```

`.nvmrc` currently selects Node 22.13.0, and `package-lock.json` locks Sharp and its dependencies. Treat `--check` as the final compatibility test if using another platform or toolchain.

## Pipeline overview

```text
player-variants.json + class profile + template
                         |
                         v
                deterministic draft spec
                         |
                         v
 identity/style inputs + generated chroma candidates
                         |
                         v
             accepted transparent RGBA PNGs
                         |
                         v
                  pin + compile
                         |
                         v
  512x512 reference + 8-frame 64x512 WebP strips
```

The source artifacts are tracked. Runtime files under `frontend/public/assets/` are generated and ignored by Git.

## Artifact roles

| Artifact | Role |
|---|---|
| `ai-image-metadata/characters/player-variants.json` | Authority for identity, race, gender, class, portrait, seed, and declared animation list. |
| `player-authored-animation-template.json` | Global source-atlas and runtime contract used when drafting; also pinned as provenance. |
| `player-animation-profiles/<class>_v1.json` | Reusable class choreography and prompt templates used to create a draft. |
| `player-authored-animations/<id>.json` | Frozen per-identity prompts, extraction settings, frame mapping, source paths, and pins consumed by the compiler. |
| `player-animation-sources/<id>/inputs/` | Exact identity and style inputs used to stage the reference. |
| `player-animation-sources/<id>/chroma/` | Unmodified generated candidates on the chroma background. |
| `player-animation-sources/<id>/*.png` | Accepted transparent reference and pose atlases used by deterministic compilation. |
| `player-identity-fallbacks.json` | Canonical reference provenance updated by successful compilation. |
| `frontend/public/assets/characters/player/...` | Recreated runtime outputs; intentionally ignored by Git. |

The template and class profile create new drafts, but they do not dynamically drive an already-authored animation at runtime. The approved identity spec freezes the actual prompt and extraction configuration. During compilation, the template and profile are checked for compatibility and hash drift. Changing a profile does not silently rewrite an existing spec.

## End-to-end workflow

The examples use `human_female_wizard`. Substitute the exact registry ID being authored.

### 1. Confirm the registry identity

Find the identity in `player-variants.json`. It must provide:

- `id`, `race`, `gender`, and `class`;
- `visualTraits` and `portraitReference`;
- a nonempty, duplicate-free `animations` array.

The registry animation list controls which atlases the compiler expects. For the current wizard profile this is `idle`, `walk`, `attack`, `hurt`, `death`, `cast`, `dead`, and `victory`.

### 2. Ensure the class profile exists

Drafting resolves `<class>_v1` by default. A wizard therefore uses:

```text
ai-image-metadata/characters/player-animation-profiles/wizard_v1.json
```

See [Adding a class profile](#adding-a-class-profile) when authoring the first identity for another class.

### 3. Create the metadata draft

```bash
npm run ai:draft:authored-player-animation -- --id human_female_wizard
npm run ai:draft:authored-player-animation -- --id human_female_wizard --check
```

The command writes only:

```text
ai-image-metadata/characters/player-authored-animations/human_female_wizard.json
```

It does not copy inputs, generate images, remove chroma, or compile runtime assets. A new draft starts with:

```json
{
  "status": "draft-awaiting-generation",
  "approvedAt": null,
  "pins": {
    "reference": null,
    "animations": {}
  }
}
```

`draft --check` byte-compares the file to a freshly rendered untouched draft. It is useful before manual edits. An accepted and pinned spec is expected to fail this draft check; use the authored compiler's `--check` for accepted work.

Do not use draft `--force` on an accepted spec unless intentionally rebuilding that spec from scratch. It replaces the metadata file and resets its status and pins, although it never deletes source images.

### 4. Stage the identity and style inputs

Create the directories declared in the draft:

```text
ai-image-metadata/characters/player-animation-sources/human_female_wizard/inputs/
ai-image-metadata/characters/player-animation-sources/human_female_wizard/chroma/
```

Copy each `inputs.*.origin` file to its corresponding `inputs.*.staged` path exactly as declared by the draft. For a wizard, this normally means:

```text
inputs/identity.png <- frontend/public/assets/portraits/originals/human_female_wizard.png
inputs/style.png    <- the style source declared by wizard_v1.json
```

On a clean checkout, the portrait origin may be absent because `frontend/public/assets/` is ignored. Restore or generate that canonical portrait with the existing portrait pipeline before staging a new identity. This is only a new-identity input: an already accepted identity rebuilds from its tracked `inputs/identity.png` and does not depend on the ignored portrait origin.

The identity image controls face, ancestry, gender presentation, costume, palette, proportions, and equipment. The style image controls only pixel density, outlines, lighting, and compact tactical rendering.

Do not resize or recompress staged inputs after generation. Their exact bytes are pinned later.

### 5. Generate the candidates

Use the exact prompts already rendered into the draft spec.

The recommended operator path uses isolated, ephemeral Codex CLI workers. Generate and
review the reference first:

```bash
npm run ai:generate:authored-player-candidates -- \
  --id human_female_wizard \
  --phase reference
```

After accepting `reference.png` as the identity authority, fan out the independent
animation candidates with bounded concurrency:

```bash
npm run ai:generate:authored-player-candidates -- \
  --id human_female_wizard \
  --phase animations \
  --concurrency 2
```

Use `--dry-run` to inspect the resumable plan. Existing chroma/RGBA pairs are skipped.
If a chroma candidate exists without its RGBA counterpart, the worker only repeats
matte removal. `--actions idle,walk` limits a run. `--force` intentionally replaces
existing candidate pairs.

Each asset runs in a separate `codex exec --ephemeral` context. The runner attaches
only the required identity/style or accepted-reference inputs, directs the worker to
the exact frozen spec prompt, retains JSONL logs under `tmp/codex-imagegen/`, removes
the chroma matte, and checks the resulting file contract. It never changes approval
status, pins, or runtime assets.

The underlying execution shape is:

```bash
codex exec \
  --ephemeral \
  --json \
  --sandbox danger-full-access \
  -C "$PWD" \
  --image <required-input.png>
```

The complete worker instruction is passed on standard input, so long frozen prompts
are not exposed to shell quoting. The explicit sandbox mode avoids nested Bubblewrap
failures on hosts that cannot create a second network namespace. Do not use
`--dangerously-bypass-approvals-and-sandbox`; the bounded worker instruction still
limits writes to its exact candidate pair, and built-in image generation does not
require an API key.

Start with concurrency 2. Increase to 3 only after observing stable image-generation
latency and account limits; the runner caps concurrency at 4. Separate workers reduce
thread context growth, but each still consumes its own Codex/image-generation usage.

For the reference:

1. Supply `inputs/identity.png` as the identity authority.
2. Supply `inputs/style.png` as the rendering-style reference.
3. Use `reference.prompt` unchanged.
4. Save the unmodified result to `chroma/reference.png`.

For every declared animation except `dead`:

1. Use the accepted character reference as the primary character input.
2. Use `animations.<name>.prompt` unchanged.
3. Generate exactly eight poses in a 4-column × 2-row atlas.
4. Save the unmodified result to `chroma/<name>.png`.

Frame order is row-major:

```text
+---------+---------+---------+---------+
| frame 0 | frame 1 | frame 2 | frame 3 |
+---------+---------+---------+---------+
| frame 4 | frame 5 | frame 6 | frame 7 |
+---------+---------+---------+---------+
```

Do not generate a separate `dead` image. The compiler derives it from the final runtime death frame.

The candidate-generation interface may change without changing the compiler. What must be retained is the exact prompt, identity/style inputs, raw chroma output, and accepted RGBA output.

### 6. Remove the chroma matte

Retain the original candidate under `chroma/`, and write the transparent accepted source beside it. This candidate-stage step requires the Codex imagegen skill's helper and Python Pillow. Resolve the normal or customized Codex home once and verify both prerequisites:

```bash
CHROMA_HELPER="${CODEX_HOME:-${HOME}/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py"
test -f "$CHROMA_HELPER"
python3 -c "import PIL; print(PIL.__version__)"
```

If the import fails, install `pillow` in the Python environment used for this candidate stage. Neither Pillow nor the external helper is needed to rebuild runtime strips from already accepted RGBA sources.

The template's current matte recipe is:

```bash
python3 "$CHROMA_HELPER" \
  --input ai-image-metadata/characters/player-animation-sources/human_female_wizard/chroma/idle.png \
  --out ai-image-metadata/characters/player-animation-sources/human_female_wizard/idle.png \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill \
  --force
```

Repeat this for `reference` and every non-`dead` action. Review the result visually; matte removal is preparation, not acceptance by itself.

### 7. Review the accepted PNGs

The compiler enforces technical gates, while visual review covers semantics the compiler cannot judge.

| Area | Required result |
|---|---|
| Reference format | Square RGBA PNG, visible subject, transparent corners, at least 2% padding on every side, and no more than 75% visible-pixel coverage. |
| Atlas format | RGBA PNG with transparent corners and exactly eight readable 4×2 cells. |
| Cell isolation | One dominant full character in every cell, with detached equipment/effects remaining inside the correct cell. Components are assigned by centroid. |
| Articulation | Meaningful anatomy, limb, cloth, hair, and equipment changes—not a rigid drawing translated, scaled, recolored, rotated, or skewed. |
| Continuity | Same face, ancestry, gender presentation, costume, palette, proportions, and equipment count in every pose. |
| Runtime fit | Complete pose remains inside the 64×64 frame's four-pixel transparent safety margin after one uniform per-action scale. |
| Death | Clear collapse to a fully fallen pose; current wizard mapping holds source frame 7 in the final two runtime frames. |
| Dead | Derived from terminal death; never a separately generated corpse. |
| Victory | Ends on a held triumphant pose instead of returning to neutral. |

The translation-normalized pose gate catches rigid copies moved or uniformly resized around the canvas. It cannot prove anatomy or action quality, so inspect every frame.

### 8. Enable compilation, pin, and compile

The existing `status` field is the only enable switch. There is no external approval system. After visual review, set it to `approved` or another value beginning with `approved-` or `approved_`. Set `approvedAt` to an ISO timestamp for audit history; the compiler does not populate it.

Do not commit the brief intermediate state with an approved status and empty pins. Immediately run the targeted acceptance command:

```bash
npm run ai:compile:authored-player-animations -- \
  --id human_female_wizard \
  --update-pins \
  --force
```

`--update-pins` records the complete accepted state:

- compiler version and player-metadata fingerprint;
- raw template and profile hashes;
- identity/style, chroma, and transparent-source hashes and dimensions;
- prompt hashes;
- normalized pose and compiled frame hashes;
- frame mapping and dominant-component ratios;
- encoded-file and decoded-pixel output hashes.

It also writes the runtime reference/strips and updates `player-identity-fallbacks.json`. `--force` permits intentionally different runtime files to be replaced; it does not bypass format, pose, margin, or animation validation.

Review the source, profile, template, and spec diffs before committing. Never edit generated pins by hand.

### 9. Verify the result

Run the targeted check first:

```bash
npm run ai:compile:authored-player-animations -- --id human_female_wizard --check
```

Then run the shared checks:

```bash
npm run ai:check:authored-player-animations
npm run ai:test:authored-player-animation-drafts
npm run ai:test:authored-player-animations
npm run ai:check:character-variants
npm run ai:check:player-identities
npm run ai:check:player-animations
```

`ai:check:authored-player-animations` is read-only and checks every spec whose status is exactly `approved` or begins with `approved-` or `approved_`. It does not generate missing runtime files.

## Rebuild on a clean checkout

Runtime assets are ignored by Git, so a clean checkout must compile before it can check them:

```bash
nvm use
npm ci
npm run ai:compile:authored-player-animations -- --id elf_other_wizard
npm run ai:compile:authored-player-animations -- --id elf_other_wizard --check
```

Repeat the targeted compile for each approved authored identity, then run the all-approved check. The full registry identity and animation compilers also delegate protected authored IDs to this pipeline during a complete asset build.

Canonical outputs are:

```text
frontend/public/assets/characters/player/{race}/{gender}/{class}/{id}_reference.png
frontend/public/assets/characters/player/{race}/{gender}/{class}/{id}_{animation}.webp
```

The reference is a 512×512 lossless RGBA PNG. Each animation is a lossless RGBA WebP vertical strip containing eight 64×64 frames, for an overall size of 64×512.

## Frame mapping and anchoring

`outputFrameMap` contains exactly eight zero-based source indexes. The wizard death profile uses:

```json
[0, 1, 2, 3, 4, 5, 7, 7]
```

This omits source pose 6 and holds source pose 7 for the final two runtime frames.

| Anchor | Behavior |
|---|---|
| `source-cell` | Preserves root motion relative to each atlas cell, including hops, lunges, recoil, and horizontal collapse. |
| `source-cell` + `verticalAnchor: bottom` | Preserves horizontal authored travel while grounding every frame vertically; used by death. |
| `bottom-center` | Grounds and horizontally centers each pose, removing authored root travel. |
| `center` | Centers each pose on both axes, removing authored root travel. |

`verticalAnchor` is valid only with `source-cell`. One uniform scale is selected across the complete output sequence so frames do not resize while playing.

The current `dead.deriveFrom` metadata documents the intended relationship, but the compiler currently derives all eight `dead` frames specifically from runtime death frame 7. Keep the metadata consistent with that implementation.

## Adding a class profile

By convention, create `player-animation-profiles/<class>_v1.json`, usually by adapting `wizard_v1.json`. The profile ID only has to be nonempty and match the selected class and template; `<class>_v1` is the default lookup convention, not a compiler requirement. Pass another profile ID or project-relative JSON path with `--profile` when needed. A profile must:

- use a nonempty ID and the selected registry class;
- target `authored-pose-atlas-v1`;
- declare a style source and its limited authority;
- define `baseFacing`, `motionStyle`, `equipmentRule`, and `magicRule`;
- provide reference and animation prompt templates;
- define every animation declared by that class's registry identities;
- provide exactly eight frame descriptions for each action;
- provide `actionLabel`, `motionDirection`, `effectRule`, and `minimumUniquePoses` for every non-`dead` action;
- use only valid anchor combinations.

Supported prompt tokens are:

```text
displayName, visualTraits, background, baseFacing, motionStyle,
equipmentRule, magicRule, invariants, poseRequirement, frameCount,
columns, rows, actionLabel, frameSequence, motionDirection, effectRule
```

Draft one identity with the new profile and run the draft tests before generating images:

```bash
npm run ai:draft:authored-player-animation -- --id <id> --profile <class>_v1
npm run ai:test:authored-player-animation-drafts
```

Profile/template changes do not automatically rewrite approved identity specs. To adopt a changed profile, render a temporary draft with `--output`, compare it to the accepted spec, manually merge the intended prompt/config changes, regenerate affected sources, and then run the normal targeted pin/compile operation. Merely updating the profile hash does not update the frozen animation settings.

## Runtime constants that must stay synchronized

The frontend does not read animation timing, transparent inset, or facing policy directly from the JSON template at runtime.

| Contract | Metadata | Compiler implementation | Runtime implementation |
|---|---|---|---|
| Idle frame duration | `runtimeContract.animation.idleFrameDurationMs` | — | `frontend/src/core/CharacterAnimationTiming.js` |
| Transparent ground inset | `runtimeContract.animation.minimumTransparentMargin` | `SAFE_MARGIN` in `scripts/ai-images/lib/playerAnimationCompiler.js` (also consumed by the authored compiler) | `VERTICAL_STRIP_GROUND_INSET` in `frontend/src/battle/BattleUnit.js` |
| Base facing and directional mirroring | `runtimeContract.animation.baseFacing` and `directionPolicy` | — | `baseFacing`/`mirrorByDirection` in `frontend/src/battle/BattleUnit.js` and `shouldMirror()` in `frontend/src/core/AnimatedSprite.js` |

If one of these contracts changes, update every listed location and its tests in the same change. Keep class-profile `baseFacing` and generated prompt assumptions aligned with the runtime facing policy as well.

## Pin glossary

| Pin | Meaning |
|---|---|
| `templateSha256`, `profileSha256` | Raw bytes of the template/profile used for accepted compilation. Draft provenance hashes canonicalized JSON instead, so draft and accepted hashes serve different checks. |
| `metadataFingerprint` | Stable identity/action subset from `player-variants.json`. |
| `sourceSha256` | Exact accepted transparent PNG bytes. |
| `chromaSourceSha256` | Exact unmodified generated chroma candidate bytes. |
| `identitySourceSha256`, `styleSourceSha256` | Exact staged reference-input bytes. |
| `promptSha256` | Exact rendered prompt text stored in the identity spec. |
| `poseSha256` | Translation-normalized silhouette signature for each extracted pose. |
| `frameSha256` | Decoded pixel hash for each compiled 64×64 runtime frame. |
| `encodedSha256` | Final PNG/WebP file-byte hash. |
| `decodedSha256` | Final decoded RGBA pixel hash, independent of container encoding. |
| `sourceFrameIndexes` | Source atlas cell selected for each runtime frame. |
| `sourceDominantRatios` | Dominant subject/component ratio observed in each source cell. |

## Common failures

| Failure | Correct response |
|---|---|
| Draft already exists | Use draft `--check` while it is untouched. Inspect differences before any draft `--force`. |
| Spec status is not approved | Finish visual review, then use the existing status switch; do not change compiler code to bypass it. |
| Accepted source is missing or not RGBA | Restore/create the declared transparent PNG and retain its chroma original. |
| Corners or margins fail | Correct chroma removal or atlas layout. Do not weaken the thresholds to admit a bad source. |
| Missing subject/poor dominant ratio | Regenerate with clearer gutters and one dominant character per cell. |
| Too few unique poses | Redraw meaningful anatomy and limb motion; moving one rigid pose is intentionally rejected. |
| Pins differ unexpectedly | Restore the tracked accepted source/spec/profile/template. |
| Pins differ intentionally | Review the complete change, then run targeted `--update-pins --force`. |
| Canonical output is missing | Run the ordinary targeted compile; no pin update is needed. |
| Canonical output differs while pins are correct | Rebuild it with targeted `--force`. |
| “changed while compilation was running” | Stop concurrent edits and rerun; the compiler detected input drift. |
| All-approved check reports missing output | Compile that approved ID first; checks are read-only. |

## Current reference implementation

`elf_other_wizard` is the first complete authored identity and the best example to copy:

```text
ai-image-metadata/characters/player-animation-profiles/wizard_v1.json
ai-image-metadata/characters/player-authored-animations/elf_other_wizard.json
ai-image-metadata/characters/player-animation-sources/elf_other_wizard/
```

Verify it at any time with:

```bash
npm run ai:compile:authored-player-animations -- --id elf_other_wizard --check
```

Before storing the full race/gender/class matrix this way, configure Git LFS or another versioned artifact store. The source atlases are intentionally retained for reproducibility, but ordinary Git is not an efficient long-term store for hundreds of large PNG sets.
