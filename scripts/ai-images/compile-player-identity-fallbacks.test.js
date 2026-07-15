'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const sharp = require('sharp');

const { parseArgs } = require('./compile-player-identity-fallbacks');
const {
  ANCHOR_PATHS,
  ANCHOR_REASONS,
  CLASS_SIGNATURES,
  COMPILER_VERSION,
  GENDER_PROFILES,
  OUTPUT_SIZE,
  RACE_PROFILES,
  SOURCE_SIZE,
  bodyProfile,
  canonicalOutputPath,
  compileIdentities,
  findAlphaBounds,
  inspectOutput,
  prepareImageMatte,
  renderIdentity64,
  selectVariants,
  sha256
} = require('./lib/playerIdentityFallbackCompiler');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REGISTRY = require('../../ai-image-metadata/characters/player-variants.json');

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function makePortrait(pathname, costume = [46, 104, 166, 255], accent = [219, 133, 52, 255]) {
  const size = 128;
  const data = Buffer.alloc(size * size * 4);
  const pixel = (x, y, rgba) => {
    const offset = ((y * size) + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) data[offset + channel] = rgba[channel];
  };
  for (let y = 7; y < 126; y += 1) {
    for (let x = 18; x < 110; x += 1) {
      const head = (((x - 64) / 30) ** 2) + (((y - 42) / 35) ** 2) <= 1;
      const shoulders = y > 64 && Math.abs(x - 64) < 39 + ((y - 64) / 3);
      if (head) pixel(x, y, y < 25 ? accent : [220, 158, 120, 255]);
      else if (shoulders) pixel(x, y, x < 59 ? costume : accent);
    }
  }
  await fs.promises.mkdir(path.dirname(pathname), { recursive: true });
  await sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(pathname);
}

function makeOpaqueMatteImage(matte, costume = [255, 255, 255, 255]) {
  const width = 96;
  const height = 96;
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  const pixel = (x, y, rgba) => {
    const offset = ((y * width) + x) * channels;
    for (let channel = 0; channel < channels; channel += 1) data[offset + channel] = rgba[channel];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixel(x, y, [...matte, 255]);
  }

  // A closed dark outline deliberately encloses costume pixels that can be the
  // exact same white as the matte. Edge connectivity, rather than a global
  // color key, must preserve those foreground whites.
  for (let y = 50; y <= 89; y += 1) {
    const halfWidth = 17 + Math.floor((y - 50) / 4);
    for (let x = 48 - halfWidth; x <= 48 + halfWidth; x += 1) {
      const outline = y === 50 || y === 89 || x === 48 - halfWidth || x === 48 + halfWidth;
      pixel(x, y, outline ? [22, 18, 28, 255] : costume);
    }
  }
  for (let y = 5; y <= 53; y += 1) {
    for (let x = 22; x <= 74; x += 1) {
      const hair = (((x - 48) / 26) ** 2) + (((y - 29) / 25) ** 2) <= 1;
      const face = (((x - 48) / 15) ** 2) + (((y - 33) / 18) ** 2) <= 1;
      if (hair) pixel(x, y, [31, 27, 38, 255]);
      if (face) pixel(x, y, [114, 166, 76, 255]);
    }
  }
  for (const x of [42, 54]) pixel(x, 31, [248, 193, 52, 255]);

  return {
    source: Buffer.from(data),
    data,
    info: { width, height, channels },
    bounds: findAlphaBounds(data, width, height, channels),
    hash: sha256(data)
  };
}

async function loadPortraitImage(pathname) {
  const source = await fs.promises.readFile(pathname);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    source,
    data,
    info,
    bounds: findAlphaBounds(data, info.width, info.height, info.channels),
    hash: sha256(source)
  };
}

function variant(overrides = {}) {
  const value = {
    id: 'human_male_chemist',
    race: 'human',
    gender: 'male',
    class: 'chemist',
    portraitReference: '/assets/portraits/originals/human_male_chemist.png',
    ...overrides
  };
  value.id = overrides.id || `${value.race}_${value.gender}_${value.class}`;
  return value;
}

async function makeFixture() {
  const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-player-identity-'));
  const portraitPath = path.join(projectRoot, 'frontend/public/assets/portraits/originals/human_male_chemist.png');
  await makePortrait(portraitPath);
  const registryPath = path.join(projectRoot, 'ai-image-metadata/characters/player-variants.json');
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.promises.writeFile(registryPath, `${JSON.stringify({ version: 'test', totalVariants: 1, variants: [variant()] }, null, 2)}\n`);
  return { projectRoot, portraitPath, registryPath };
}

function countPixels(raw, expected) {
  let count = 0;
  for (let offset = 0; offset < raw.length; offset += 4) {
    if (raw[offset] === expected[0] && raw[offset + 1] === expected[1] && raw[offset + 2] === expected[2] && raw[offset + 3] === expected[3]) count += 1;
  }
  return count;
}

test('CLI requires exactly one explicit scope and keeps --all as a safety gate', () => {
  assert.throws(() => parseArgs([]), /exactly one scope/i);
  assert.throws(() => parseArgs(['--sample', '--all']), /exactly one scope/i);
  assert.throws(() => parseArgs(['--id', 'human_male_warrior', '--sample']), /exactly one scope/i);
  assert.throws(() => parseArgs(['--all', '--check', '--force']), /cannot be combined/i);
  assert.deepEqual(parseArgs(['--id=human_male_warrior,dwarf_female_chemist']).ids, [
    'human_male_warrior',
    'dwarf_female_chemist'
  ]);
  assert.equal(parseArgs(['--all']).all, true);
  assert.equal(parseArgs(['--sample']).sample, true);
});

test('registry contract covers all 300 identities and every one of the 20 class signatures', () => {
  assert.equal(REGISTRY.variants.length, 300);
  assert.deepEqual([...new Set(REGISTRY.variants.map(entry => entry.race))].sort(), ['dwarf', 'elf', 'human', 'orc', 'vampire']);
  assert.deepEqual([...new Set(REGISTRY.variants.map(entry => entry.gender))].sort(), ['female', 'male', 'other']);
  const classes = [...new Set(REGISTRY.variants.map(entry => entry.class))].sort();
  assert.equal(classes.length, 20);
  assert.deepEqual(Object.keys(CLASS_SIGNATURES).sort(), classes);
  assert.ok(Object.values(CLASS_SIGNATURES).every(signature => signature.split('-').length >= 3));
});

test('race and gender body profiles encode visibly different full-body proportions', () => {
  const humanMale = bodyProfile(variant({ race: 'human', gender: 'male', class: 'warrior' }));
  const humanFemale = bodyProfile(variant({ race: 'human', gender: 'female', class: 'warrior' }));
  const humanOther = bodyProfile(variant({ race: 'human', gender: 'other', class: 'warrior' }));
  const dwarfFemale = bodyProfile(variant({ race: 'dwarf', gender: 'female', class: 'warrior' }));
  const elfFemale = bodyProfile(variant({ race: 'elf', gender: 'female', class: 'warrior' }));
  const orcMale = bodyProfile(variant({ race: 'orc', gender: 'male', class: 'warrior' }));

  assert.ok(humanMale.shoulderWidth > humanFemale.shoulderWidth);
  assert.ok(humanFemale.hipWidth > humanMale.hipWidth);
  assert.ok(humanOther.hipWidth > humanMale.hipWidth && humanOther.hipWidth < humanFemale.hipWidth);
  assert.ok(dwarfFemale.shoulderWidth > elfFemale.shoulderWidth);
  assert.ok(dwarfFemale.hipY > humanFemale.hipY, 'dwarves must have shorter legs');
  assert.ok(orcMale.shoulderWidth > humanMale.shoulderWidth);
  assert.ok(elfFemale.top < dwarfFemale.top, 'elves must read taller than dwarves');
  assert.equal(Object.keys(RACE_PROFILES).length, 5);
  assert.equal(Object.keys(GENDER_PROFILES).length, 3);
});

test('every class and every race/gender combination renders a unique semantic 64px source', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-player-render-'));
  try {
    const portraitPath = path.join(directory, 'portrait.png');
    await makePortrait(portraitPath);
    const portraitImage = await loadPortraitImage(portraitPath);
    const hashes = new Set();
    const raceGenderHashes = new Set();

    for (const className of Object.keys(CLASS_SIGNATURES)) {
      const current = variant({ race: 'human', gender: 'female', class: className });
      const rendered = await renderIdentity64(PROJECT_ROOT, current, { portraitPath, portraitImage, anchor: null });
      assert.equal(rendered.raw.length, SOURCE_SIZE * SOURCE_SIZE * 4);
      assert.equal(rendered.semanticSignature, CLASS_SIGNATURES[className]);
      assert.ok(rendered.bounds.minX >= 3 && rendered.bounds.minY >= 3);
      assert.ok(rendered.bounds.maxX <= 60 && rendered.bounds.maxY <= 60);
      hashes.add(hash(rendered.raw));
    }
    assert.equal(hashes.size, 20, 'all class silhouettes/gear must remain visually distinct');

    for (const race of Object.keys(RACE_PROFILES)) {
      for (const gender of Object.keys(GENDER_PROFILES)) {
        const current = variant({ race, gender, class: 'warrior' });
        const rendered = await renderIdentity64(PROJECT_ROOT, current, { portraitPath, portraitImage, anchor: null });
        raceGenderHashes.add(hash(rendered.raw));
      }
    }
    assert.equal(raceGenderHashes.size, 15, 'all race/gender silhouettes must remain visually distinct');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('all 300 registry identities have cross-identity unique deterministic pixels with one full-body subject', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-player-uniqueness-'));
  try {
    const portraitPath = path.join(directory, 'portrait.png');
    await makePortrait(portraitPath, [55, 106, 168, 255], [210, 112, 42, 255]);
    const portraitImage = await loadPortraitImage(portraitPath);
    const hashes = new Map();
    for (const current of REGISTRY.variants) {
      const rendered = await renderIdentity64(PROJECT_ROOT, current, { portraitPath, portraitImage, anchor: null });
      const digest = hash(rendered.raw);
      assert.equal(hashes.has(digest), false, `${current.id} duplicated ${hashes.get(digest)}`);
      hashes.set(digest, current.id);
      assert.ok(rendered.bounds.height >= 40, `${current.id} must be head-to-toe, not a bust`);
      assert.ok(rendered.bounds.alphaPixels / (SOURCE_SIZE * SOURCE_SIZE) < 0.58, `${current.id} must remain one padded subject`);
    }
    assert.equal(hashes.size, 300);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('class gear contains readable semantic color landmarks', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-player-gear-'));
  try {
    const portraitPath = path.join(directory, 'portrait.png');
    await makePortrait(portraitPath);
    const portraitImage = await loadPortraitImage(portraitPath);
    const render = className => renderIdentity64(PROJECT_ROOT, variant({ race: 'human', gender: 'female', class: className }), {
      portraitPath,
      portraitImage,
      anchor: null
    });
    assert.ok(countPixels((await render('chemist')).raw, [98, 225, 176, 255]) >= 3, 'chemist needs a readable green potion');
    assert.ok(countPixels((await render('medic')).raw, [230, 64, 71, 255]) >= 12, 'medic needs a readable red medical cross');
    assert.ok(countPixels((await render('paladin')).raw, [255, 224, 111, 255]) >= 12, 'paladin needs a readable holy cross/blade');
    assert.ok(countPixels((await render('artificer')).raw, [218, 157, 61, 255]) >= 12, 'artificer needs readable brass machinery');
    assert.ok(countPixels((await render('plague_doctor')).raw, [133, 215, 74, 255]) >= 1, 'plague doctor needs poison at the censer');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('portrait pixels materially control identity palette while output stays deterministic', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'modia-player-palette-'));
  try {
    const bluePath = path.join(directory, 'blue.png');
    const greenPath = path.join(directory, 'green.png');
    await makePortrait(bluePath, [42, 89, 190, 255], [224, 148, 49, 255]);
    await makePortrait(greenPath, [39, 151, 83, 255], [165, 62, 155, 255]);
    const blueImage = await loadPortraitImage(bluePath);
    const greenImage = await loadPortraitImage(greenPath);
    const current = variant({ race: 'elf', gender: 'other', class: 'summoner' });
    const first = await renderIdentity64(PROJECT_ROOT, current, { portraitPath: bluePath, portraitImage: blueImage, anchor: null });
    const repeated = await renderIdentity64(PROJECT_ROOT, current, { portraitPath: bluePath, portraitImage: blueImage, anchor: null });
    const second = await renderIdentity64(PROJECT_ROOT, current, { portraitPath: greenPath, portraitImage: greenImage, anchor: null });
    assert.deepEqual(first.raw, repeated.raw);
    assert.notDeepEqual(first.palette.primary, second.palette.primary);
    assert.notEqual(hash(first.raw), hash(second.raw));
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('opaque white and colored border mattes are removed without erasing enclosed white foreground', async () => {
  for (const matte of [[255, 255, 255], [24, 42, 73]]) {
    const original = makeOpaqueMatteImage(matte);
    const prepared = prepareImageMatte(original);
    assert.equal(prepared.matte.applied, true);
    assert.ok(prepared.matte.removedPixels > 5000);
    assert.ok(prepared.bounds.minX >= 20 && prepared.bounds.maxX <= 76);
    assert.ok(prepared.bounds.minY >= 4 && prepared.bounds.maxY <= 90);
    assert.equal(prepared.data[3], 0, 'top-left matte must become transparent');
    assert.equal(prepared.data[(((95 * 96) + 95) * 4) + 3], 0, 'bottom-right matte must become transparent');
    assert.ok(countPixels(prepared.data, [255, 255, 255, 255]) > 500, 'enclosed white costume must remain foreground');

    const current = variant({ race: 'orc', gender: 'female', class: 'ascetic' });
    const first = await renderIdentity64(PROJECT_ROOT, current, {
      portraitPath: `/fixture/${matte.join('-')}.png`,
      portraitImage: original,
      anchor: null
    });
    const repeated = await renderIdentity64(PROJECT_ROOT, current, {
      portraitPath: `/fixture/${matte.join('-')}.png`,
      portraitImage: original,
      anchor: null
    });
    assert.deepEqual(first.raw, repeated.raw, 'matte cleanup and rendering must be deterministic');

    const profile = bodyProfile(current);
    const headLeft = profile.centerX - Math.floor(profile.headWidth / 2);
    let headAlphaPixels = 0;
    for (let y = profile.top; y < profile.top + profile.headHeight; y += 1) {
      for (let x = headLeft; x < headLeft + profile.headWidth; x += 1) {
        if (first.raw[((y * SOURCE_SIZE) + x) * 4 + 3] > 0) headAlphaPixels += 1;
      }
    }
    assert.ok(headAlphaPixels > 40, 'portrait subject must survive head extraction');
    assert.ok(headAlphaPixels < profile.headWidth * profile.headHeight * 0.85, 'head patch must not contain an opaque matte rectangle');
    assert.equal(first.raw[((profile.top * SOURCE_SIZE) + headLeft) * 4 + 3], 0, 'head-patch corner must be transparent');
  }
});

test('already-transparent portrait pixels are left byte-for-byte unchanged', () => {
  const width = 12;
  const height = 12;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 3; y < 9; y += 1) {
    for (let x = 4; x < 8; x += 1) {
      const offset = ((y * width) + x) * 4;
      data[offset] = 240;
      data[offset + 1] = 240;
      data[offset + 2] = 240;
      data[offset + 3] = 255;
    }
  }
  const image = {
    source: Buffer.from(data),
    data,
    info: { width, height, channels: 4 },
    bounds: findAlphaBounds(data, width, height, 4),
    hash: sha256(data)
  };
  const prepared = prepareImageMatte(image);
  assert.strictEqual(prepared.data, data);
  assert.equal(prepared.matte.applied, false);
  assert.equal(prepared.matte.reason, 'source-already-transparent');
});

test('dwarf female variants are anchored to the neutral female full-body source while retaining portrait provenance', async () => {
  const current = REGISTRY.variants.find(entry => entry.id === 'dwarf_female_chemist');
  const rendered = await renderIdentity64(PROJECT_ROOT, current);
  assert.equal(rendered.method, 'dwarf_female-fullbody-anchor');
  assert.ok(rendered.anchor);
  assert.equal(path.relative(PROJECT_ROOT, rendered.anchor.path).split(path.sep).join('/'), ANCHOR_PATHS.dwarf_female);
  assert.equal(rendered.anchor.reason, ANCHOR_REASONS.dwarf_female);
  assert.match(rendered.anchor.reason, /strongly male-coded.*palette and costume-cue source/i);
  assert.ok(rendered.portrait.path.endsWith('/dwarf_female_chemist.png'));
  assert.ok(rendered.bounds.height >= 48);
});

test('dwarf other variants use the approved androgynous anchor instead of the male-coded portrait cohort', async () => {
  const current = REGISTRY.variants.find(entry => entry.id === 'dwarf_other_artificer');
  const rendered = await renderIdentity64(PROJECT_ROOT, current);
  assert.equal(rendered.method, 'dwarf_other-fullbody-anchor');
  assert.ok(rendered.anchor);
  assert.equal(path.relative(PROJECT_ROOT, rendered.anchor.path).split(path.sep).join('/'), ANCHOR_PATHS.dwarf_other);
  assert.equal(rendered.anchor.reason, ANCHOR_REASONS.dwarf_other);
  assert.match(rendered.anchor.reason, /strongly male-coded.*androgynous/i);
  assert.ok(rendered.bounds.height >= 48);
});

test('high-resolution approved golden references pass proportional canonical validation', async () => {
  const golden = path.join(
    PROJECT_ROOT,
    'frontend/public/assets/characters/player/human/male/warrior/human_male_warrior_reference.png'
  );
  const inspected = await inspectOutput(golden);
  assert.equal(inspected.info.width, 1254);
  assert.equal(inspected.info.height, 1254);
  assert.deepEqual(inspected.issues, []);
});

test('compiler preserves existing references, writes atomically, records hashes, checks, and reproduces exact bytes', async () => {
  const fixture = await makeFixture();
  try {
    const outputPath = canonicalOutputPath(fixture.projectRoot, variant());
    const first = await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'] });
    assert.equal(first.ok, true, first.issues.join('\n'));
    assert.equal(first.generated.length, 1);
    const firstBytes = await fs.promises.readFile(outputPath);
    const inspected = await inspectOutput(outputPath);
    assert.equal(inspected.info.width, OUTPUT_SIZE);
    assert.equal(inspected.info.height, OUTPUT_SIZE);
    assert.equal(inspected.info.channels, 4);
    assert.deepEqual(inspected.issues, []);

    const provenancePath = path.join(fixture.projectRoot, 'ai-image-metadata/characters/player-identity-fallbacks.json');
    const provenance = JSON.parse(await fs.promises.readFile(provenancePath, 'utf8'));
    const entry = provenance.variants.human_male_chemist;
    assert.equal(entry.compilerVersion, COMPILER_VERSION);
    assert.equal(entry.sourcePortraitSha256, sha256(await fs.promises.readFile(fixture.portraitPath)));
    assert.equal(entry.outputSha256, sha256(firstBytes));
    assert.equal(entry.dimensions, '512x512');
    assert.equal(entry.genderAnchor, null);
    assert.equal(entry.genderAnchorReason, null);

    const preserved = await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'] });
    assert.equal(preserved.generated.length, 0);
    assert.equal(preserved.skipped.length, 1);
    assert.deepEqual(await fs.promises.readFile(outputPath), firstBytes);

    const forced = await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'], force: true });
    assert.equal(forced.ok, true, forced.issues.join('\n'));
    assert.deepEqual(await fs.promises.readFile(outputPath), firstBytes, 'forced render must be byte deterministic');
    const provenanceAfterForce = await fs.promises.readFile(provenancePath);
    await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'], force: true });
    assert.deepEqual(await fs.promises.readFile(provenancePath), provenanceAfterForce, 'provenance must also be byte deterministic');

    const checked = await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'], check: true });
    assert.equal(checked.ok, true, checked.issues.join('\n'));
    assert.equal(checked.verified.length, 1);

    provenance.variants.human_male_chemist.compilerVersion = '0.9.0';
    await fs.promises.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
    const stale = await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'], check: true });
    assert.equal(stale.ok, false);
    assert.match(stale.issues.join('\n'), /compiler version 0\.9\.0 differs/i);

    const directories = [
      path.dirname(outputPath),
      path.dirname(provenancePath)
    ];
    for (const directory of directories) {
      const temporaryFiles = (await fs.promises.readdir(directory)).filter(filename => filename.endsWith('.tmp'));
      assert.deepEqual(temporaryFiles, []);
    }
  } finally {
    await fs.promises.rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('check mode reports missing or hash-diverged references without writing', async () => {
  const fixture = await makeFixture();
  try {
    const missing = await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'], check: true });
    assert.equal(missing.ok, false);
    assert.match(missing.issues.join('\n'), /canonical reference is missing/i);

    await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'] });
    const outputPath = canonicalOutputPath(fixture.projectRoot, variant());
    await fs.promises.writeFile(outputPath, await sharp({
      create: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
    }).png().toBuffer());
    const divergent = await compileIdentities({ projectRoot: fixture.projectRoot, ids: ['human_male_chemist'], check: true });
    assert.equal(divergent.ok, false);
    assert.match(divergent.issues.join('\n'), /hash differs|corners are not transparent|more than 58%/i);
  } finally {
    await fs.promises.rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('selection preserves exact IDs, chooses one preferred sample, and never implies all', () => {
  const exact = selectVariants(REGISTRY, { ids: ['orc_other_monk'] }, PROJECT_ROOT);
  assert.deepEqual(exact.map(entry => entry.id), ['orc_other_monk']);
  assert.throws(() => selectVariants(REGISTRY, { ids: ['not_a_real_identity'] }, PROJECT_ROOT), /unknown player identity/i);
  const sample = selectVariants(REGISTRY, { sample: true }, PROJECT_ROOT);
  assert.equal(sample.length, 1);
  assert.equal(selectVariants(REGISTRY, { all: true }, PROJECT_ROOT).length, 300);
  assert.throws(() => selectVariants(REGISTRY, {}, PROJECT_ROOT), /exactly one scope/i);
});
