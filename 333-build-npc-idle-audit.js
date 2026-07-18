const sharp = require('sharp');
const path = require('path');

const root = path.resolve(__dirname, '..');
const animation = process.argv[2] || 'idle';
const identities = [
  ['forest', 'goblin_warrior'],
  ['forest', 'gray_wolf'],
  ['forest', 'forest_slime'],
  ['cave', 'cave_bat'],
  ['forest', 'giant_spider'],
  ['cave', 'skeleton_warrior'],
  ['cave', 'stone_golem'],
  ['mountain', 'mountain_troll'],
  ['mountain', 'troll_shaman'],
  ['mountain', 'harpy'],
  ['bridge', 'bridge_bandit'],
  ['bridge', 'bandit_captain'],
  ['bridge', 'bridge_troll'],
  ['palace', 'dark_knight'],
  ['palace', 'shadow_assassin'],
  ['palace', 'palace_guard']
];

const frame = 96;
const labelWidth = 172;
const cellWidth = labelWidth + (frame * 8);
const cellHeight = frame + 18;
const columns = 2;
const rows = Math.ceil(identities.length / columns);
const width = cellWidth * columns;
const height = cellHeight * rows;

async function main() {
  const composites = [];
  for (let index = 0; index < identities.length; index += 1) {
    const [biome, id] = identities[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    const inputPath = path.join(
      root,
      'frontend/public/assets/characters/enemies',
      biome,
      id,
      id + '_' + animation + '.webp'
    );
    composites.push({
      input: Buffer.from(
        '<svg width="' + labelWidth + '" height="' + cellHeight + '">' +
        '<text x="8" y="36" fill="#f5e9c8" font-size="18" font-family="sans-serif">' + id + '</text>' +
        '<text x="8" y="61" fill="#aeb9c7" font-size="14" font-family="sans-serif">' + biome + ' / ' + animation + '</text>' +
        '</svg>'
      ),
      left,
      top
    });
    for (let frameIndex = 0; frameIndex < 8; frameIndex += 1) {
      const input = await sharp(inputPath)
        .extract({ left: 0, top: frameIndex * 64, width: 64, height: 64 })
        .resize(frame, frame, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      composites.push({
        input,
        left: left + labelWidth + (frameIndex * frame),
        top
      });
    }
  }
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 25, g: 29, b: 35, alpha: 1 }
    }
  })
    .composite(composites)
    .png()
    .toFile(path.join(__dirname, 'npc-' + animation + '-audit.png'));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
