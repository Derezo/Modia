import assert from 'node:assert/strict';
import {
  readFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import {
  approveTemplate,
  draftTemplate,
  inspectImage,
  inventoryTemplates,
  loadTemplateSidecar,
  pinTemplateCompiler,
  stageTemplate,
  validateManifest,
  validateProjectRelativePath,
  validateSourceTemplateSidecar
} from './source-template-lifecycle.mjs';
import {
  COMPILER_SOURCE_FILES,
  computeCurrentCompilerSourceSet
} from './content-release-lifecycle.mjs';
import { parseTemplateArgs } from './template-cli.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST_RELATIVE = 'ai-image-metadata/battle-maps/manifest.json';
const PROMPT_RELATIVE = 'ai-image-metadata/battle-maps/prompts/source-template-image-v1.json';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modia-battle-map-template-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function copyTrackedFixture(root, relativePath) {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(PROJECT_ROOT, relativePath)));
}

async function createFixture(t) {
  const root = await temporaryDirectory(t);
  await Promise.all([
    copyTrackedFixture(root, MANIFEST_RELATIVE),
    copyTrackedFixture(root, PROMPT_RELATIVE)
  ]);
  const manifestPath = path.join(root, MANIFEST_RELATIVE);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.templates = manifest.templates.filter(
    definition => (
      definition.theme === 'forest'
      && definition.id === 'forest-template-01'
    )
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await copyCurrentCompilerSources(root);
  await draftTemplate({ projectRoot: root, theme: 'forest', template: 'forest-template-01' });
  return root;
}

async function copyCurrentCompilerSources(root) {
  await Promise.all(
    COMPILER_SOURCE_FILES.map(relativePath => copyTrackedFixture(root, relativePath))
  );
}

async function pinCurrentCompiler(root) {
  const current = await computeCurrentCompilerSourceSet({ projectRoot: root });
  await pinTemplateCompiler({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    compilerFullHash: current.fullHash
  });
  return current;
}

async function createImage(root, relativePath, {
  width = 24,
  height = 18,
  color = { r: 32, g: 96, b: 48, alpha: 1 },
  format = 'png'
} = {}) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  });
  if (format === 'png') await pipeline.png().toFile(target);
  else await pipeline.webp({ lossless: true }).toFile(target);
  return target;
}

async function readSidecar(root) {
  return (await loadTemplateSidecar({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01'
  })).sidecar;
}

async function writeSidecar(root, value) {
  await writeFile(
    path.join(root, 'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

test('source-template sidecars fail closed at every object boundary', async t => {
  const root = await createFixture(t);
  const sidecar = await readSidecar(root);

  assert.throws(
    () => validateSourceTemplateSidecar({ ...sidecar, unexpected: true }),
    /sidecar: unknown key "unexpected"/
  );
  assert.throws(
    () => validateSourceTemplateSidecar({
      ...sidecar,
      composition: { ...sidecar.composition, coordinates: [[1, 2]] }
    }),
    /sidecar\.composition: unknown key "coordinates"/
  );
  assert.throws(
    () => validateSourceTemplateSidecar({
      ...sidecar,
      topologyIntent: {
        ...sidecar.topologyIntent,
        areas: [
          { ...sidecar.topologyIntent.areas[0], tile: { x: 1, y: 2 } },
          ...sidecar.topologyIntent.areas.slice(1)
        ]
      }
    }),
    /sidecar\.topologyIntent\.areas\[0\]: unknown key "tile"/
  );
});

test('source-template manifests and sidecars accept exactly tier-1 through tier-5', async t => {
  const root = await createFixture(t);
  const sidecar = await readSidecar(root);
  const tiers = ['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5'];
  const allTierSidecar = { ...sidecar, tierEligibility: tiers };
  assert.equal(validateSourceTemplateSidecar(allTierSidecar), allTierSidecar);

  const manifest = JSON.parse(
    await readFile(path.join(root, MANIFEST_RELATIVE), 'utf8')
  );
  manifest.templates[0].tierEligibility = tiers;
  assert.equal(validateManifest(manifest), manifest);
  assert.throws(
    () => validateSourceTemplateSidecar({
      ...sidecar,
      tierEligibility: ['tier-6']
    }),
    /unsupported value "tier-6"/
  );
  manifest.templates[0].tierEligibility = ['tier-6'];
  assert.throws(() => validateManifest(manifest), /unsupported value "tier-6"/);
});

test('project-relative path validation rejects traversal, absolute, and mixed-separator inputs', () => {
  assert.equal(
    validateProjectRelativePath('tmp/generated/forest-candidate.webp'),
    'tmp/generated/forest-candidate.webp'
  );
  for (const unsafe of [
    '../outside.png',
    'tmp/../../outside.png',
    '/absolute.png',
    'C:\\absolute.png',
    'tmp\\candidate.png',
    './candidate.png',
    'tmp//candidate.png'
  ]) {
    assert.throws(() => validateProjectRelativePath(unsafe), /project-relative|must not contain|separators/);
  }
});

test('compiler pin parsing requires one explicit fullHash', () => {
  assert.throws(
    () => parseTemplateArgs(
      ['--theme', 'forest', '--template', 'forest-template-01'],
      { compiler: true }
    ),
    /--compiler-full-hash is required/
  );
  assert.deepEqual(
    parseTemplateArgs([
      '--theme', 'forest',
      '--template', 'forest-template-01',
      '--compiler-full-hash', `sha256:${'a'.repeat(64)}`
    ], { compiler: true }),
    {
      theme: 'forest',
      template: 'forest-template-01',
      compilerFullHash: `sha256:${'a'.repeat(64)}`
    }
  );
  assert.throws(
    () => parseTemplateArgs([
      '--theme', 'forest',
      '--template', 'forest-template-01',
      '--compiler-full-hash', `sha256:${'a'.repeat(64)}`,
      '--compiler-full-hash', `sha256:${'a'.repeat(64)}`
    ], { compiler: true }),
    /may only be provided once/
  );
});

test('compiler pin is an atomic idempotent staged-only transition to the exact current source set', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const current = await computeCurrentCompilerSourceSet({ projectRoot: root });
  assert.equal(current.sourceFiles.length, COMPILER_SOURCE_FILES.length);
  assert.match(current.fullHash, /^sha256:[0-9a-f]{64}$/);

  const options = {
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    compilerFullHash: current.fullHash
  };
  const first = await pinTemplateCompiler(options);
  const repeated = await pinTemplateCompiler(options);
  assert.equal(first.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal((await readSidecar(root)).pins.compilerSha256, current.fullHash);
});

test('compiler pin refuses draft, non-current, changed, and approved identities without rewriting', async t => {
  const root = await createFixture(t);
  const current = await computeCurrentCompilerSourceSet({ projectRoot: root });
  const baseOptions = {
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01'
  };
  await assert.rejects(
    pinTemplateCompiler({
      ...baseOptions,
      compilerFullHash: current.fullHash
    }),
    /must be staged/
  );

  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    ...baseOptions,
    source: 'incoming/reference.png'
  });
  const sidecarPath = path.join(
    root,
    'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'
  );
  const stagedBytes = await readFile(sidecarPath);
  await assert.rejects(
    pinTemplateCompiler({
      ...baseOptions,
      compilerFullHash: `sha256:${'f'.repeat(64)}`
    }),
    /supplied compiler fullHash is not current/
  );
  assert.deepEqual(await readFile(sidecarPath), stagedBytes);

  const staged = await readSidecar(root);
  staged.pins.compilerSha256 = `sha256:${'e'.repeat(64)}`;
  await writeSidecar(root, staged);
  const changedPinBytes = await readFile(sidecarPath);
  await assert.rejects(
    pinTemplateCompiler({
      ...baseOptions,
      compilerFullHash: current.fullHash
    }),
    /already pins a different compiler/
  );
  assert.deepEqual(await readFile(sidecarPath), changedPinBytes);

  staged.pins.compilerSha256 = current.fullHash;
  await writeSidecar(root, staged);
  await approveTemplate({
    ...baseOptions,
    reviewer: 'compiler-pin-reviewer',
    decision: 'approved'
  });
  const approvedSidecar = await readSidecar(root);
  const approvedWithoutCompiler = {
    ...approvedSidecar,
    pins: {
      ...approvedSidecar.pins,
      compilerSha256: null
    }
  };
  assert.throws(
    () => validateSourceTemplateSidecar(approvedWithoutCompiler),
    /approved templates require a compiler pin/
  );
  await writeSidecar(root, approvedWithoutCompiler);
  await assert.rejects(
    readSidecar(root),
    /approved templates require a compiler pin/
  );
  await writeSidecar(root, approvedSidecar);
  const approvedBytes = await readFile(sidecarPath);
  await assert.rejects(
    pinTemplateCompiler({
      ...baseOptions,
      compilerFullHash: current.fullHash
    }),
    /approved template compiler pins are immutable/
  );
  assert.deepEqual(await readFile(sidecarPath), approvedBytes);
});

test('compiler pin rolls back its sidecar when the compiler snapshot mutates during commit', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const current = await computeCurrentCompilerSourceSet({ projectRoot: root });
  const sidecarPath = path.join(
    root,
    'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'
  );
  const before = await readFile(sidecarPath);
  await assert.rejects(
    pinTemplateCompiler({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      compilerFullHash: current.fullHash,
      afterMetadataCommit: async () => {
        const compilerDependency = path.join(root, 'shared/terrain.js');
        await writeFile(
          compilerDependency,
          Buffer.concat([
            await readFile(compilerDependency),
            Buffer.from('\n// injected concurrent mutation\n')
          ])
        );
      }
    }),
    /committed compiler fullHash is not current/
  );
  assert.deepEqual(await readFile(sidecarPath), before);
  assert.equal((await readSidecar(root)).pins.compilerSha256, null);
});

test('compiler pin rolls back when the canonical source mutates during commit', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const current = await computeCurrentCompilerSourceSet({ projectRoot: root });
  const sidecar = await readSidecar(root);
  await assert.rejects(
    pinTemplateCompiler({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      compilerFullHash: current.fullHash,
      afterMetadataCommit: () => createImage(root, sidecar.sourceImage.path, {
        width: sidecar.sourceImage.width,
        height: sidecar.sourceImage.height,
        color: { r: 200, g: 10, b: 10, alpha: 1 }
      })
    }),
    /source image pin mismatch/
  );
  assert.equal((await readSidecar(root)).pins.compilerSha256, null);
});

test('conditional rollback preserves a non-lifecycle concurrent sidecar edit', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const current = await computeCurrentCompilerSourceSet({ projectRoot: root });
  const sidecarPath = path.join(
    root,
    'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'
  );
  const concurrentHash = `sha256:${'d'.repeat(64)}`;
  await assert.rejects(
    pinTemplateCompiler({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      compilerFullHash: current.fullHash,
      afterMetadataCommit: async () => {
        const concurrentSidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
        concurrentSidecar.pins.approvedBlueprintSha256 = concurrentHash;
        await writeFile(
          sidecarPath,
          `${JSON.stringify(concurrentSidecar, null, 2)}\n`
        );
        const compilerDependency = path.join(root, 'shared/terrain.js');
        await writeFile(
          compilerDependency,
          Buffer.concat([
            await readFile(compilerDependency),
            Buffer.from('\n// concurrent compiler mutation\n')
          ])
        );
      }
    }),
    error => (
      error instanceof AggregateError
      && /rollback failed/.test(error.message)
    )
  );
  assert.equal(
    JSON.parse(await readFile(sidecarPath, 'utf8'))
      .pins.approvedBlueprintSha256,
    concurrentHash
  );
});

test('current compiler source-set computation rejects symlinked source paths', async t => {
  const root = await createFixture(t);
  const relativePath = COMPILER_SOURCE_FILES[0];
  const sourcePath = path.join(root, relativePath);
  const outsideRoot = await temporaryDirectory(t);
  const outsidePath = path.join(outsideRoot, 'compiler-source.js');
  await writeFile(outsidePath, await readFile(sourcePath));
  await rm(sourcePath);
  await symlink(outsidePath, sourcePath);
  await assert.rejects(
    computeCurrentCompilerSourceSet({ projectRoot: root }),
    /contains forbidden symlink/
  );
});

test('compiler pin and approval reject an internally symlinked canonical source', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const sidecar = await readSidecar(root);
  const canonicalPath = path.join(root, sidecar.sourceImage.path);
  const internalTarget = path.join(root, 'internal-identical.png');
  await writeFile(internalTarget, await readFile(canonicalPath));
  await rm(canonicalPath);
  await symlink(path.relative(path.dirname(canonicalPath), internalTarget), canonicalPath);
  const current = await computeCurrentCompilerSourceSet({ projectRoot: root });
  await assert.rejects(
    pinTemplateCompiler({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      compilerFullHash: current.fullHash
    }),
    /sourceImage\.path: contains symbolic-link component/
  );

  await rm(canonicalPath);
  await writeFile(canonicalPath, await readFile(internalTarget));
  await pinTemplateCompiler({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    compilerFullHash: current.fullHash
  });
  await rm(canonicalPath);
  await symlink(path.relative(path.dirname(canonicalPath), internalTarget), canonicalPath);
  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'symlink-reviewer',
      decision: 'approved'
    }),
    /sourceImage\.path: contains symbolic-link component/
  );
  assert.equal((await readSidecar(root)).status, 'staged');
});

test('staging rejects a project-relative symlink that resolves outside the project', async t => {
  const root = await createFixture(t);
  const outsideRoot = await temporaryDirectory(t);
  await createImage(outsideRoot, 'outside.png');
  await symlink(path.join(outsideRoot, 'outside.png'), path.join(root, 'linked.png'));
  await assert.rejects(
    stageTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      source: 'linked.png'
    }),
    /source: contains symbolic-link component/
  );
});

test('lifecycle writes reject a symlinked canonical destination parent', async t => {
  const root = await createFixture(t);
  const outsideRoot = await temporaryDirectory(t);
  const sourceParent = path.join(root, 'ai-image-metadata/battle-maps/sources/forest');
  await mkdir(sourceParent, { recursive: true });
  const canonicalParent = path.join(sourceParent, 'forest-template-01');
  await rm(canonicalParent, { recursive: true, force: true });
  await symlink(outsideRoot, canonicalParent);
  await createImage(root, 'incoming/reference.png');
  await assert.rejects(
    stageTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      source: 'incoming/reference.png'
    }),
    /lifecycle lock path: contains symbolic-link component/
  );
});

test('drafting is deterministic and check mode accepts lifecycle-preserving staged metadata', async t => {
  const root = await createFixture(t);
  const first = await readFile(
    path.join(root, 'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'),
    'utf8'
  );
  const second = await draftTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    check: true
  });
  assert.equal(second.changed, false);
  assert.equal(
    await readFile(
      path.join(root, 'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'),
      'utf8'
    ),
    first
  );

  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const stagedCheck = await draftTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    check: true
  });
  assert.equal(stagedCheck.status, 'staged');
  assert.equal(stagedCheck.changed, false);
});

test('stage validates PNG/WebP metadata and copies to the canonical ignored source path', async t => {
  const root = await createFixture(t);
  await createImage(root, 'generated/candidate.webp', {
    width: 37,
    height: 29,
    format: 'webp'
  });
  const expected = await inspectImage(path.join(root, 'generated/candidate.webp'));
  const result = await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'generated/candidate.webp'
  });

  assert.equal(result.status, 'staged');
  assert.deepEqual(result.sourceImage, {
    path: 'ai-image-metadata/battle-maps/sources/forest/forest-template-01/reference.webp',
    ...expected
  });
  const canonical = await inspectImage(path.join(root, result.sourceImage.path));
  assert.deepEqual(canonical, expected);
  const sidecar = await readSidecar(root);
  assert.equal(sidecar.review, null);
  assert.equal(sidecar.status, 'staged');
  assert.equal(sidecar.pins.sourceImageSha256, expected.sha256);
});

test('staging is idempotent and changed pinned input requires force', async t => {
  const root = await createFixture(t);
  await Promise.all([
    createImage(root, 'incoming/first.png', {
      width: 20,
      height: 20,
      color: { r: 10, g: 20, b: 30, alpha: 1 }
    }),
    createImage(root, 'incoming/second.png', {
      width: 21,
      height: 19,
      color: { r: 90, g: 80, b: 70, alpha: 1 }
    })
  ]);
  const baseOptions = {
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01'
  };
  const first = await stageTemplate({ ...baseOptions, source: 'incoming/first.png' });
  const repeated = await stageTemplate({ ...baseOptions, source: 'incoming/first.png' });
  assert.equal(first.changed, true);
  assert.equal(repeated.changed, false);

  await assert.rejects(
    stageTemplate({ ...baseOptions, source: 'incoming/second.png' }),
    /differs from the pinned input; use --force/
  );
  const replaced = await stageTemplate({
    ...baseOptions,
    source: 'incoming/second.png',
    force: true
  });
  assert.equal(replaced.changed, true);
  assert.notEqual(replaced.sourceImage.sha256, first.sourceImage.sha256);
  assert.deepEqual(
    await inspectImage(path.join(root, replaced.sourceImage.path)),
    await inspectImage(path.join(root, 'incoming/second.png'))
  );
});

test('approval rechecks source and prompt pins and remains separate from staging', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const staged = await readSidecar(root);
  assert.equal(staged.status, 'staged');
  assert.equal(staged.review, null);
  assert.throws(
    () => parseTemplateArgs(
      ['--theme', 'forest', '--template', 'forest-template-01', '--decision', 'approved'],
      { review: true }
    ),
    /--reviewer is required/
  );
  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'test-reviewer',
      decision: 'rejected'
    }),
    /decision must be explicitly supplied as "approved"/
  );
  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'test-reviewer',
      decision: 'approved'
    }),
    /compiler must be pinned before approval/
  );
  const compiler = await pinCurrentCompiler(root);
  const promptPath = path.join(root, PROMPT_RELATIVE);
  const promptContents = await readFile(promptPath, 'utf8');
  await writeFile(promptPath, `${promptContents}\n`);
  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'test-reviewer',
      decision: 'approved'
    }),
    /prompt profile pin mismatch/
  );
  await writeFile(promptPath, promptContents);

  const compilerDependency = path.join(root, 'shared/terrain.js');
  const compilerDependencyBytes = await readFile(compilerDependency);
  await writeFile(
    compilerDependency,
    Buffer.concat([compilerDependencyBytes, Buffer.from('\n// stale\n')])
  );
  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'test-reviewer',
      decision: 'approved'
    }),
    /template compiler pin is not current/
  );
  await writeFile(compilerDependency, compilerDependencyBytes);
  assert.equal(
    (await computeCurrentCompilerSourceSet({ projectRoot: root })).fullHash,
    compiler.fullHash
  );

  const approval = await approveTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    reviewer: 'test-reviewer',
    decision: 'approved'
  });
  assert.equal(approval.changed, true);
  assert.deepEqual((await readSidecar(root)).review, {
    decision: 'approved',
    reviewer: 'test-reviewer'
  });
});

test('approval rolls back when the frozen prompt mutates during commit', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  await pinCurrentCompiler(root);
  const sidecarPath = path.join(
    root,
    'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'
  );
  const promptPath = path.join(root, PROMPT_RELATIVE);
  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'prompt-race-reviewer',
      decision: 'approved',
      afterMetadataCommit: async () => {
        await writeFile(
          promptPath,
          `${await readFile(promptPath, 'utf8')}\n`
        );
      }
    }),
    /prompt profile pin mismatch/
  );
  assert.equal(
    JSON.parse(await readFile(sidecarPath, 'utf8')).status,
    'staged'
  );
});

test('approval rejects valid-schema semantic drift from the frozen manifest', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  await pinCurrentCompiler(root);
  const sidecar = await readSidecar(root);
  sidecar.supportedModes = ['pve', 'pvp'];
  await writeSidecar(root, sidecar);
  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'test-reviewer',
      decision: 'approved'
    }),
    /semantic content differs from the frozen manifest/
  );
});

test('per-template lock serializes concurrent stages and keeps binary and metadata pins aligned', async t => {
  const root = await createFixture(t);
  await Promise.all([
    createImage(root, 'incoming/first.png', {
      color: { r: 10, g: 20, b: 30, alpha: 1 }
    }),
    createImage(root, 'incoming/second.png', {
      color: { r: 100, g: 110, b: 120, alpha: 1 }
    })
  ]);
  let releaseFirst;
  let signalFirst;
  const firstBlocked = new Promise(resolve => {
    signalFirst = resolve;
  });
  const firstRelease = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const first = stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/first.png',
    beforeMetadataCommit: async () => {
      signalFirst();
      await firstRelease;
    }
  });
  await firstBlocked;
  let secondSettled = false;
  const second = stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/second.png',
    force: true
  }).finally(() => {
    secondSettled = true;
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(secondSettled, false, 'second stage must wait for the lifecycle lock');
  releaseFirst();
  await first;
  const secondResult = await second;
  const finalSidecar = await readSidecar(root);
  assert.equal(finalSidecar.sourceImage.sha256, secondResult.sourceImage.sha256);
  assert.deepEqual(
    await inspectImage(path.join(root, finalSidecar.sourceImage.path)),
    await inspectImage(path.join(root, 'incoming/second.png'))
  );
});

test('template lifecycle locking ignores stale contents and retains one stable lock inode', async t => {
  const root = await createFixture(t);
  const lockPath = path.join(
    root,
    'ai-image-metadata/battle-maps/sources/forest/forest-template-01/.lifecycle.lock'
  );
  await writeFile(lockPath, '{"pid":999999999}\n');
  const before = await stat(lockPath);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const after = await stat(lockPath);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(
    await readFile(lockPath, 'utf8'),
    '{"pid":999999999}\n',
    'kernel ownership must not depend on mutable PID-token contents'
  );
});

test('approval racing a forced stage reviews the fully committed replacement', async t => {
  const root = await createFixture(t);
  await Promise.all([
    createImage(root, 'incoming/first.png', {
      color: { r: 10, g: 20, b: 30, alpha: 1 }
    }),
    createImage(root, 'incoming/second.png', {
      color: { r: 100, g: 110, b: 120, alpha: 1 }
    })
  ]);
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/first.png'
  });
  await pinCurrentCompiler(root);
  let releaseStage;
  let signalStage;
  const stageBlocked = new Promise(resolve => {
    signalStage = resolve;
  });
  const stageRelease = new Promise(resolve => {
    releaseStage = resolve;
  });
  const replacement = stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/second.png',
    force: true,
    beforeMetadataCommit: async () => {
      signalStage();
      await stageRelease;
    }
  });
  await stageBlocked;
  let approvalSettled = false;
  const approval = approveTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    reviewer: 'race-reviewer',
    decision: 'approved'
  }).finally(() => {
    approvalSettled = true;
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(approvalSettled, false, 'approval must wait for an in-flight stage');
  releaseStage();
  const replacementResult = await replacement;
  await approval;
  const finalSidecar = await readSidecar(root);
  assert.equal(finalSidecar.status, 'approved');
  assert.equal(finalSidecar.sourceImage.sha256, replacementResult.sourceImage.sha256);
  assert.equal(finalSidecar.review.reviewer, 'race-reviewer');
});

test('forced replacement rolls the canonical binary back when metadata commit fails', async t => {
  const root = await createFixture(t);
  await Promise.all([
    createImage(root, 'incoming/first.png', {
      color: { r: 10, g: 20, b: 30, alpha: 1 }
    }),
    createImage(root, 'incoming/second.png', {
      color: { r: 200, g: 210, b: 220, alpha: 1 }
    })
  ]);
  const first = await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/first.png'
  });
  await assert.rejects(
    stageTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      source: 'incoming/second.png',
      force: true,
      beforeMetadataCommit: () => {
        throw new Error('injected metadata commit failure');
      }
    }),
    /injected metadata commit failure/
  );
  const finalSidecar = await readSidecar(root);
  assert.equal(finalSidecar.sourceImage.sha256, first.sourceImage.sha256);
  assert.equal(
    (await inspectImage(path.join(root, finalSidecar.sourceImage.path))).sha256,
    first.sourceImage.sha256
  );
});

test('backup cleanup failure never rolls back a metadata-committed source binary', async t => {
  const root = await createFixture(t);
  await Promise.all([
    createImage(root, 'incoming/first.png', {
      color: { r: 10, g: 20, b: 30, alpha: 1 }
    }),
    createImage(root, 'incoming/second.png', {
      color: { r: 200, g: 210, b: 220, alpha: 1 }
    })
  ]);
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/first.png'
  });
  await assert.rejects(
    stageTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      source: 'incoming/second.png',
      force: true,
      cleanupBackup: async () => {
        throw new Error('injected backup cleanup failure');
      }
    }),
    /injected backup cleanup failure/
  );
  const finalSidecar = await readSidecar(root);
  const finalImage = await inspectImage(
    path.join(root, finalSidecar.sourceImage.path)
  );
  assert.equal(finalSidecar.sourceImage.sha256, finalImage.sha256);
  assert.deepEqual(
    finalImage,
    await inspectImage(path.join(root, 'incoming/second.png'))
  );
});

test('approval and inventory reject changed bytes that no longer match the tracked pin', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png', {
    color: { r: 1, g: 2, b: 3, alpha: 1 }
  });
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  await pinCurrentCompiler(root);
  const sidecar = await readSidecar(root);
  await createImage(root, sidecar.sourceImage.path, {
    width: sidecar.sourceImage.width,
    height: sidecar.sourceImage.height,
    color: { r: 200, g: 100, b: 50, alpha: 1 }
  });

  await assert.rejects(
    approveTemplate({
      projectRoot: root,
      theme: 'forest',
      template: 'forest-template-01',
      reviewer: 'test-reviewer',
      decision: 'approved'
    }),
    /source image pin mismatch/
  );
  assert.equal((await readSidecar(root)).status, 'staged');
  const inventory = await inventoryTemplates({ projectRoot: root });
  assert.equal(inventory.ok, false);
  assert.equal(inventory.assets.length, 1);
  assert.equal(inventory.assets[0].matchesPin, false);
  assert.match(inventory.assets[0].error, /source image pin mismatch/);
});

test('inventory emits deterministic machine-readable paths and complete pins', async t => {
  const root = await createFixture(t);
  await createImage(root, 'candidates/forest/forest-template-01/reviewed.png', {
    width: 30,
    height: 31
  });
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'candidates/forest/forest-template-01/reviewed.png'
  });
  const first = await inventoryTemplates({ projectRoot: root });
  const second = await inventoryTemplates({ projectRoot: root });
  assert.deepEqual(second, first);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.templates, [{
    id: 'forest-template-01',
    theme: 'forest',
    status: 'staged',
    sourceImage: 'ai-image-metadata/battle-maps/sources/forest/forest-template-01/reference.png',
    error: null
  }]);
  assert.equal(first.assets.length, 1);
  assert.equal(first.assets[0].present, true);
  assert.equal(first.assets[0].matchesPin, true);
  assert.match(first.assets[0].sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.assets[0].bytes, (await inspectImage(path.join(root, first.assets[0].path))).bytes);
  assert.deepEqual(first.orphans, []);
});

test('inventory reports modified files as present and discovers orphaned alternate formats', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/reference.png');
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/reference.png'
  });
  const sidecar = await readSidecar(root);
  await createImage(root, sidecar.sourceImage.path, {
    width: sidecar.sourceImage.width,
    height: sidecar.sourceImage.height,
    color: { r: 200, g: 20, b: 50, alpha: 1 }
  });
  let inventory = await inventoryTemplates({ projectRoot: root });
  assert.equal(inventory.assets[0].present, true);
  assert.equal(inventory.assets[0].matchesPin, false);

  await createImage(root, 'incoming/replacement.webp', { format: 'webp' });
  await stageTemplate({
    projectRoot: root,
    theme: 'forest',
    template: 'forest-template-01',
    source: 'incoming/replacement.webp',
    force: true
  });
  inventory = await inventoryTemplates({ projectRoot: root });
  assert.equal(inventory.assets[0].matchesPin, true);
  assert.equal(inventory.orphans.length, 1);
  assert.match(inventory.orphans[0].path, /reference\.png$/);
  assert.match(inventory.orphans[0].sha256, /^sha256:/);
});
