import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const specDirectory = path.join(root, 'ai-image-metadata/characters/player-authored-animations');
const entries = (await fs.readdir(specDirectory)).filter(name => name.endsWith('.json')).sort();
const failures = [];

for (const entry of entries) {
  const spec = JSON.parse(await fs.readFile(path.join(specDirectory, entry), 'utf8'));
  const sourcePath = path.join(root, spec.reference.source);
  try {
    const metadata = await sharp(sourcePath).metadata();
    const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (metadata.format !== 'png') throw new Error(`must be PNG, got ${metadata.format || 'unknown'}`);
    if (info.width !== info.height) throw new Error(`must be square, got ${info.width}x${info.height}`);
    if (!metadata.hasAlpha || metadata.channels !== 4) throw new Error('must be RGBA with transparency');

    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    let alphaPixels = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[((y * info.width + x) * info.channels) + 3];
        if (alpha === 0) continue;
        alphaPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) throw new Error('has no visible subject');

    const corners = [
      data[3],
      data[((info.width - 1) * info.channels) + 3],
      data[(((info.height - 1) * info.width) * info.channels) + 3],
      data[((((info.height - 1) * info.width) + info.width - 1) * info.channels) + 3]
    ];
    if (corners.some(alpha => alpha > 24)) throw new Error('corners must be transparent');
    const margin = Math.max(1, Math.floor(info.width * 0.02));
    if (minX < margin || minY < margin || maxX >= info.width - margin || maxY >= info.height - margin) {
      throw new Error(`violates the ${margin}px proportional margin`);
    }
    if (alphaPixels / (info.width * info.height) > 0.75) {
      throw new Error('subject covers more than 75% of the canvas');
    }
  } catch (error) {
    failures.push({ id: spec.id, error: error.message });
  }
}

console.log(JSON.stringify({ checked: entries.length, failures }, null, 2));
