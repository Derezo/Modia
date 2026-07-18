const fs = require('node:fs/promises');
const path = require('node:path');
const {
  createExistingFrameManifestEntry,
  createReferenceManifestEntry
} = require('../scripts/ai-images/compile-enemy-animation-stabilizations');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(
  root,
  'ai-image-metadata/characters/enemy-animation-stabilizations.json'
);

const referenceTargets = [
  ['cave', 'skeleton_warrior'],
  ['cave', 'stone_golem'],
  ['mountain', 'troll_shaman'],
  ['mountain', 'harpy'],
  ['bridge', 'bandit_captain'],
  ['bridge', 'bridge_troll'],
  ['palace', 'dark_knight'],
  ['palace', 'palace_guard']
];

const normalizedIdleTargets = [
  ['forest', 'goblin_warrior', 0],
  ['forest', 'gray_wolf', 0],
  ['forest', 'forest_slime', 2],
  ['cave', 'cave_bat', 0],
  ['forest', 'giant_spider', 0],
  ['mountain', 'mountain_troll', 0],
  ['bridge', 'bridge_bandit', 0],
  ['palace', 'shadow_assassin', 0]
];

function animationPath(biome, id, animation) {
  return path.join(
    root,
    'frontend/public/assets/characters/enemies',
    biome,
    id,
    `${id}_${animation}.webp`
  );
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const entries = [];

  for (const [biome, id] of referenceTargets) {
    const relativeReference = path.join(
      'frontend/public/assets/characters/enemies',
      biome,
      id,
      `${id}_reference.png`
    );
    const currentAssets = Object.fromEntries(
      ['idle', 'attack', 'hit', 'death'].map(animation => [
        animation,
        animationPath(biome, id, animation)
      ])
    );
    const entry = await createReferenceManifestEntry({
      referenceInput: path.join(root, relativeReference),
      referencePath: relativeReference,
      currentAssets,
      id,
      biome
    });
    entry.generation = {
      mode: 'openai-built-in-imagegen',
      identityAuthority: `frontend/public/assets/portraits/originals/enemy_${id}.png`,
      backgroundRemoval: {
        mode: 'chroma_key_border_soft_matte',
        requestedKey: '#0AF70C',
        despill: true,
        edgeContract: 1
      },
      promotion: '512x512 transparent PNG, nearest-neighbor contain'
    };
    entries.push(entry);
  }

  for (const [biome, id, sourceFrame] of normalizedIdleTargets) {
    const entry = await createExistingFrameManifestEntry({
      input: animationPath(biome, id, 'idle'),
      id,
      biome,
      sourceFrame,
      normalizedCellSize: 56
    });
    entry.audit = {
      reason: 'Preserve the coherent identity frame while removing silhouette morphing and unsafe edge contact.',
      selectedFrame: sourceFrame,
      reviewStatus: 'approved'
    };
    entries.push(entry);
  }

  manifest.description = 'Audited active enemy animations compiled from one identity-preserving source per NPC. Generated references replace wrong or unstable identities; coherent legacy identities receive normalized translation-only idle loops.';
  manifest.coverage = {
    identities: entries.length,
    strips: entries.reduce((total, entry) => total + Object.keys(entry.animations).length, 0),
    generatedReferenceIdentities: referenceTargets.length,
    normalizedIdleIdentities: normalizedIdleTargets.length
  };
  manifest.stabilizations = entries;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
