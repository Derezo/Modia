# Authored Enemy Animation Pipeline

Enemy sprites use the same reviewed-source model as authored player animations. Animation direction is scoped by biome in `ai-image-metadata/characters/enemies/<biome>.json`, while recognizable identity comes from the canonical `enemy_<id>` entry in `ai-image-metadata/portraits/enemies.json` and its original portrait. Authored-only identities that reuse existing choreography are declared in `ai-image-metadata/characters/enemy-authored-identity-aliases.json`. Codex CLI creates nondeterministic candidates; the workspace retains the original chroma PNGs and accepted RGBA PNGs; the compiler deterministically writes runtime assets and hash-pins the source evidence in the spec.

## Destinations

- Spec: `ai-image-metadata/characters/enemy-authored-animations/<biome>/<id>.json`
- Authored-only identity aliases: `ai-image-metadata/characters/enemy-authored-identity-aliases.json`
- Canonical identity origin: `frontend/public/assets/portraits/originals/enemy_<id>.png`
- Staged identity input (Image 1): `ai-image-metadata/characters/enemy-animation-sources/<biome>/<id>/inputs/identity.png`
- Staged style input: `ai-image-metadata/characters/enemy-animation-sources/<biome>/<id>/inputs/style.png`
- Retained chroma candidates: `ai-image-metadata/characters/enemy-animation-sources/<biome>/<id>/chroma/*.png`
- Accepted RGBA sources: `ai-image-metadata/characters/enemy-animation-sources/<biome>/<id>/*.png`
- Runtime reference: `frontend/public/assets/characters/enemies/<biome>/<id>/<id>_reference.png`
- Runtime sheets: `frontend/public/assets/characters/enemies/<biome>/<id>/<id>_<animation>.webp`

Runtime sheets remain lossless RGBA WebP vertical strips: eight 64×64 frames in a 64×512 image. The compiler writes `idle`, `attack`, `hit`, `death`, and a deterministic `dead` strip derived from the terminal death pose.

## One-enemy workflow

Use an explicit biome and enemy ID for every mutating command:

```bash
npm run ai:draft:authored-enemy-animation -- --biome forest --id gray_wolf
npm run ai:stage:authored-enemy-inputs -- --biome forest --id gray_wolf
npm run ai:generate:authored-enemy-candidates -- --biome forest --id gray_wolf --phase reference
```

Drafting resolves `enemy_<id>` in the portrait registry. Staging copies its canonical portrait as Image 1 and the shared rendering reference as Image 2. The first controls identity, anatomy cues, coloration, markings, costume, and equipment; the second controls pixel rendering style only.

Visually review `reference.png`. Regenerate it with `--force` if needed. Once the reference identity is accepted, generate the four authored atlases:

```bash
npm run ai:generate:authored-enemy-candidates -- --biome forest --id gray_wolf --phase animations --concurrency 2
```

Limit a retry without replacing other accepted actions:

```bash
npm run ai:generate:authored-enemy-candidates -- --biome forest --id gray_wolf --phase animations --actions hit,death --force
```

Review the RGBA sources for identity, anatomy and appendage count, equipment continuity, action readability, transparent edges, and a genuinely fallen terminal death pose. Then approve, pin, and promote it in one command:

```bash
npm run ai:compile:authored-enemy-animations -- \
  --biome forest \
  --id gray_wolf \
  --update-pins \
  --approve \
  --force

npm run ai:compile:authored-enemy-animations -- --biome forest --id gray_wolf --check
npm run ai:check:runtime-assets
```

`--approve` is an explicit approval transition: it sets `status` to `approved` and records `approvedAt` automatically. It requires `--update-pins`, which records source, chroma, identity portrait, style, prompt, template, profile, pose, and output hashes in the same successful operation. Later compilation refuses unapproved specs, stale enemy or portrait metadata, changed pins, or changed canonical output. `--force` is required only when intentionally replacing an existing runtime file.

## Sequential biome workflow

Prepare every configured enemy in a biome without passing individual IDs:

```bash
npm run ai:draft:authored-enemy-animation -- --biome forest --all --force
npm run ai:stage:authored-enemy-inputs -- --biome forest --all --force
```

Then generate references one enemy at a time, in registry order:

```bash
npm run ai:generate:authored-enemy-candidates -- \
  --biome forest \
  --all \
  --phase reference
```

Review all references before generating their animation atlases sequentially:

```bash
npm run ai:generate:authored-enemy-candidates -- \
  --biome forest \
  --all \
  --phase animations \
  --concurrency 1
```

`--all` includes both canonical biome registry entries and authored-only identity aliases. It deliberately processes enemy identities sequentially and stops on the first failure. `--concurrency 1` also makes the animation atlases within each identity sequential. Approval remains an explicit per-enemy operation so each reviewed identity receives its own timestamp and provenance pins.

## Validation and migration

```bash
npm run ai:test:authored-enemy-animations
npm run ai:check:authored-enemy-animations
```

`ai:generate:characters:enemies` is a convenience alias for
`ai:generate:authored-enemy-candidates`. Repair and stabilization commands
remain migration tools for existing sheets. New or deliberately re-authored
enemies must use this authored workflow so accepted sources and deterministic
provenance are tracked.
