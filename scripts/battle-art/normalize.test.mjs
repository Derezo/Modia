import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import sharp from 'sharp';

import {
  CANDIDATE_SCHEMA,
  CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH,
  approveCandidate,
  candidatePaths,
  inspectImageContents,
  readJson,
  sha256,
  stableJson,
  styleReferenceProvenance
} from './lifecycle.mjs';
import { main, parseCommand } from './cli.mjs';
import {
  buildGenerationPrompt,
  revalidateFailedRouteAttempt
} from './generate.mjs';
import { normalizeCandidates } from './normalize.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');
const DESCRIPTOR_RELATIVE =
  'ai-image-metadata/battle-art/descriptors/forest/'
  + 'forest-borderwood-moss-ground-0.json';
const REVALIDATED_DESCRIPTOR_RELATIVE =
  'ai-image-metadata/battle-art/descriptors/cave/'
  + 'cave-limestone-curved-passage-end-s.json';
const REVALIDATED_FAILURE_RELATIVE =
  'ai-image-metadata/battle-art/generated-artifacts/cave/'
  + 'cave-limestone-curved-passage-end-s/failures/'
  + '1b0567ef30fe0ec594c2616442a05993dd8a066c844217e2ed3e367711406dc8.json';
const temporaryRoots = [];

async function copyTracked(root, relative) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await copyFile(path.join(REPOSITORY_ROOT, relative), path.join(root, relative));
}

async function snapshotTree(root) {
  const snapshot = {};
  async function visit(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        snapshot[`${relative}${path.sep}`] = 'directory';
        await visit(absolute, relative);
      } else {
        snapshot[relative] = sha256(await readFile(absolute));
      }
    }
  }
  await visit(root);
  return snapshot;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'modia-battle-art-normalize-'));
  temporaryRoots.push(root);
  const manifestRelative = 'ai-image-metadata/battle-art/manifest.json';
  const manifest = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, manifestRelative),
    'utf8'
  ));
  manifest.descriptors = [DESCRIPTOR_RELATIVE];
  manifest.historicalReleases = [];
  const releasedDescriptor = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, DESCRIPTOR_RELATIVE),
    'utf8'
  ));
  const descriptorStyleReferencePaths = new Set(
    releasedDescriptor.styleReferences.map(reference => reference.path)
  );
  manifest.styleReferences = manifest.styleReferences.filter(
    reference => descriptorStyleReferencePaths.has(reference.path)
  );
  const descriptor = {
    ...releasedDescriptor,
    status: 'draft',
    content: {
      ...releasedDescriptor.content,
      sourceSha256: null,
      runtimeSha256: null,
      immutableUrl: null
    },
    source: null
  };
  for (const relative of [
    CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH,
    manifest.promptProfile.path,
    ...manifest.styleReferences.map(reference => reference.path)
  ]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await copyFile(path.join(REPOSITORY_ROOT, relative), path.join(root, relative));
  }
  await mkdir(path.dirname(path.join(root, manifestRelative)), { recursive: true });
  await mkdir(path.dirname(path.join(root, DESCRIPTOR_RELATIVE)), { recursive: true });
  await writeFile(path.join(root, manifestRelative), stableJson(manifest));
  await writeFile(path.join(root, DESCRIPTOR_RELATIVE), stableJson(descriptor));
  const promptProfile = JSON.parse(await readFile(
    path.join(root, manifest.promptProfile.path),
    'utf8'
  ));
  const readinessRelative =
    'ai-image-metadata/battle-art/readiness-plan.json';
  const releasedReadiness = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, readinessRelative),
    'utf8'
  ));
  const releasedPlans = releasedReadiness.plans.filter(plan => (
    plan.requirements.some(requirement => (
      requirement.descriptorId === descriptor.id
    ))
  ));
  const readiness = {
    schemaVersion: releasedReadiness.schemaVersion,
    plans: releasedPlans.map(plan => ({
      ...plan,
      requirements: plan.requirements.filter(requirement => (
        requirement.descriptorId === descriptor.id
      ))
    }))
  };
  await writeFile(path.join(root, readinessRelative), stableJson(readiness));

  const paths = candidatePaths(descriptor);
  const originalBytes = await sharp({
    create: {
      width: descriptor.canvas.width,
      height: descriptor.canvas.height,
      channels: 4,
      background: { r: 70, g: 90, b: 50, alpha: 1 }
    }
  }).png().toBuffer();
  await mkdir(path.dirname(path.join(root, paths.imagePng)), { recursive: true });
  await writeFile(path.join(root, paths.imagePng), originalBytes);
  const image = await inspectImageContents(paths.imagePng, originalBytes);
  const worker = {
    command: 'codex',
    args: ['exec', '--ephemeral'],
    ephemeral: true,
    invocationCount: 1,
    timeoutMs: 900000,
    promptPath: paths.prompt,
    stdoutPath: paths.stdout,
    stderrPath: paths.stderr,
    lastMessagePath: null
  };
  const candidate = {
    schemaVersion: CANDIDATE_SCHEMA,
    familyId: descriptor.id,
    theme: descriptor.theme,
    descriptorPath: DESCRIPTOR_RELATIVE,
    descriptorSha256: sha256(Buffer.from(stableJson(descriptor))),
    promptProfile: structuredClone(descriptor.promptProfile),
    styleReferences: structuredClone(descriptor.styleReferences),
    styleReferenceMode: 'text-fallback',
    styleReferenceProvenance: styleReferenceProvenance(
      descriptor.styleReferences
    ),
    image,
    worker,
    status: 'candidate-awaiting-review'
  };
  await Promise.all([
    writeFile(path.join(root, paths.metadata), stableJson(candidate)),
    writeFile(
      path.join(root, paths.prompt),
      `${buildGenerationPrompt({
        descriptor,
        profile: promptProfile,
        styleFiles: styleReferenceProvenance(
          descriptor.styleReferences
        ).map(value => value.stagedBasename),
        textStyleFallback: true
      })}\n`
    ),
    writeFile(
      path.join(root, paths.stdout),
      '{"type":"item.completed","item":{"id":"imagegen-1",'
      + '"type":"mcp_tool_call","server":"image_gen",'
      + '"tool":"imagegen","status":"completed"}}\n'
    ),
    writeFile(path.join(root, paths.stderr), '')
  ]);
  return {
    root,
    descriptor,
    paths,
    originalBytes,
    candidate
  };
}

async function revalidatedFixture() {
  const root = await mkdtemp(path.join(
    tmpdir(),
    'modia-battle-art-normalize-revalidated-'
  ));
  temporaryRoots.push(root);
  const manifestRelative = 'ai-image-metadata/battle-art/manifest.json';
  const manifest = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, manifestRelative),
    'utf8'
  ));
  manifest.descriptors = [REVALIDATED_DESCRIPTOR_RELATIVE];
  manifest.historicalReleases = [];
  const descriptor = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, REVALIDATED_DESCRIPTOR_RELATIVE),
    'utf8'
  ));
  const descriptorStyleReferencePaths = new Set(
    descriptor.styleReferences.map(reference => reference.path)
  );
  manifest.styleReferences = manifest.styleReferences.filter(
    reference => descriptorStyleReferencePaths.has(reference.path)
  );
  for (const relative of [
    CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH,
    manifest.promptProfile.path,
    ...manifest.styleReferences.map(reference => reference.path)
  ]) {
    await copyTracked(root, relative);
  }
  await mkdir(path.dirname(path.join(root, manifestRelative)), {
    recursive: true
  });
  await mkdir(path.dirname(path.join(root, REVALIDATED_DESCRIPTOR_RELATIVE)), {
    recursive: true
  });
  await writeFile(path.join(root, manifestRelative), stableJson(manifest));
  await writeFile(
    path.join(root, REVALIDATED_DESCRIPTOR_RELATIVE),
    stableJson(descriptor)
  );

  const readinessRelative = 'ai-image-metadata/battle-art/readiness-plan.json';
  const releasedReadiness = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, readinessRelative),
    'utf8'
  ));
  const releasedPlans = releasedReadiness.plans.filter(plan => (
    plan.requirements.some(requirement => (
      requirement.descriptorId === descriptor.id
    ))
  ));
  const readiness = {
    schemaVersion: releasedReadiness.schemaVersion,
    plans: releasedPlans.map(plan => ({
      ...plan,
      requirements: plan.requirements.filter(requirement => (
        requirement.descriptorId === descriptor.id
      ))
    }))
  };
  await mkdir(path.dirname(path.join(root, readinessRelative)), {
    recursive: true
  });
  await writeFile(path.join(root, readinessRelative), stableJson(readiness));

  const paths = candidatePaths(descriptor);
  const failure = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, REVALIDATED_FAILURE_RELATIVE),
    'utf8'
  ));
  for (const relative of [REVALIDATED_FAILURE_RELATIVE, failure.raw.path]) {
    await copyTracked(root, relative);
  }
  await revalidateFailedRouteAttempt({
    root,
    theme: descriptor.theme,
    family: descriptor.id,
    failure: REVALIDATED_FAILURE_RELATIVE
  });
  const candidate = (await readJson(root, paths.metadata)).value;
  return { root, descriptor, paths, candidate };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true
  })));
});

describe('battle-art candidate normalization', () => {
  it('rewrites and repins a draft candidate while preserving its audit record', async () => {
    const state = await fixture();
    const result = await normalizeCandidates({
      root: state.root,
      theme: 'forest',
      family: state.descriptor.id
    });
    assert.equal(result.ok, true);
    assert.equal(result.results[0].status, 'normalized');

    const normalizedBytes = await readFile(path.join(state.root, state.paths.imagePng));
    assert.equal(normalizedBytes.equals(state.originalBytes), false);
    const metadata = (await readJson(state.root, state.paths.metadata)).value;
    assert.deepEqual(metadata.worker, state.candidate.worker);
    assert.equal(metadata.status, state.candidate.status);
    assert.equal(metadata.image.sha256, sha256(normalizedBytes));
    assert.equal(metadata.image.bytes, normalizedBytes.length);
    assert.equal(metadata.image.width, state.descriptor.canvas.width);
    assert.equal(metadata.image.height, state.descriptor.canvas.height);
    assert.equal(metadata.image.format, 'png');
  });

  it('reports drift without writing and becomes idempotently current after rewrite', async () => {
    const state = await fixture();
    const beforeMetadata = await readFile(path.join(state.root, state.paths.metadata));
    const check = await normalizeCandidates({
      root: state.root,
      theme: 'forest',
      family: state.descriptor.id,
      check: true
    });
    assert.equal(check.ok, false);
    assert.equal(check.results[0].status, 'drift');
    assert.deepEqual(
      await readFile(path.join(state.root, state.paths.imagePng)),
      state.originalBytes
    );
    assert.deepEqual(
      await readFile(path.join(state.root, state.paths.metadata)),
      beforeMetadata
    );
    const previousExitCode = process.exitCode;
    const previousConsoleLog = console.log;
    const output = [];
    try {
      process.exitCode = 0;
      console.log = value => output.push(value);
      const cliCheck = await main([
        'normalize',
        '--project-root', state.root,
        '--theme', 'forest',
        '--family', state.descriptor.id,
        '--check',
        '--json'
      ]);
      assert.equal(cliCheck.ok, false);
      assert.equal(process.exitCode, 1);
      assert.match(output.join('\n'), /"status": "drift"/);
    } finally {
      console.log = previousConsoleLog;
      process.exitCode = previousExitCode;
    }

    await normalizeCandidates({
      root: state.root,
      theme: 'forest',
      family: state.descriptor.id
    });
    const currentBytes = await readFile(path.join(state.root, state.paths.imagePng));
    const currentMetadata = await readFile(path.join(state.root, state.paths.metadata));
    const current = await normalizeCandidates({
      root: state.root,
      theme: 'forest',
      family: state.descriptor.id,
      check: true
    });
    assert.equal(current.ok, true);
    assert.equal(current.results[0].status, 'current');
    assert.deepEqual(
      await readFile(path.join(state.root, state.paths.imagePng)),
      currentBytes
    );
    assert.deepEqual(
      await readFile(path.join(state.root, state.paths.metadata)),
      currentMetadata
    );
  });

  it('accepts a provenance-preserving revalidated candidate without writes', async () => {
    const state = await revalidatedFixture();
    const beforeTree = await snapshotTree(state.root);
    const beforeMetadata = await readFile(
      path.join(state.root, state.paths.metadata)
    );
    const beforeImage = await readFile(
      path.join(state.root, state.candidate.image.path)
    );
    const result = await normalizeCandidates({
      root: state.root,
      theme: state.descriptor.theme,
      family: state.descriptor.id,
      check: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.results[0].status, 'current');
    assert.deepEqual(
      await readFile(path.join(state.root, state.paths.metadata)),
      beforeMetadata
    );
    assert.deepEqual(
      await readFile(path.join(state.root, state.candidate.image.path)),
      beforeImage
    );
    assert.deepEqual(await snapshotTree(state.root), beforeTree);
  });

  it('rejects mixed and malformed revalidated candidate records', async () => {
    const state = await revalidatedFixture();
    const mixed = structuredClone(state.candidate);
    mixed.worker = {};
    await writeFile(
      path.join(state.root, state.paths.metadata),
      stableJson(mixed)
    );
    await assert.rejects(
      normalizeCandidates({
        root: state.root,
        theme: state.descriptor.theme,
        family: state.descriptor.id,
        check: true
      }),
      /candidate metadata.worker is not allowed/
    );

    const missingDerivation = structuredClone(state.candidate);
    delete missingDerivation.derivation;
    await writeFile(
      path.join(state.root, state.paths.metadata),
      stableJson(missingDerivation)
    );
    await assert.rejects(
      normalizeCandidates({
        root: state.root,
        theme: state.descriptor.theme,
        family: state.descriptor.id,
        check: true
      }),
      /candidate metadata.derivation is required/
    );

    const mismatchedDerivation = structuredClone(state.candidate);
    mismatchedDerivation.derivation.source.sha256 =
      `sha256:${'0'.repeat(64)}`;
    await writeFile(
      path.join(state.root, state.paths.metadata),
      stableJson(mismatchedDerivation)
    );
    await assert.rejects(
      normalizeCandidates({
        root: state.root,
        theme: state.descriptor.theme,
        family: state.descriptor.id,
        check: true
      }),
      /origin.raw does not match the route derivation source/
    );

    const staleOrigin = structuredClone(state.candidate);
    staleOrigin.origin.failureRecord.sha256 = `sha256:${'0'.repeat(64)}`;
    await writeFile(
      path.join(state.root, state.paths.metadata),
      stableJson(staleOrigin)
    );
    await assert.rejects(
      normalizeCandidates({
        root: state.root,
        theme: state.descriptor.theme,
        family: state.descriptor.id,
        check: true
      }),
      /origin does not match its audited failed attempt/
    );

    const regular = await fixture();
    const regularWithOrigin = structuredClone(regular.candidate);
    regularWithOrigin.origin = structuredClone(state.candidate.origin);
    await writeFile(
      path.join(regular.root, regular.paths.metadata),
      stableJson(regularWithOrigin)
    );
    await assert.rejects(
      normalizeCandidates({
        root: regular.root,
        theme: regular.descriptor.theme,
        family: regular.descriptor.id,
        check: true
      }),
      /candidate metadata.origin is not allowed/
    );
  });

  it('rejects stale candidate pins without changing the image', async () => {
    const state = await fixture();
    const metadata = (await readJson(state.root, state.paths.metadata)).value;
    metadata.descriptorSha256 = `sha256:${'0'.repeat(64)}`;
    await writeFile(
      path.join(state.root, state.paths.metadata),
      stableJson(metadata)
    );
    await assert.rejects(
      normalizeCandidates({
        root: state.root,
        theme: 'forest',
        family: state.descriptor.id
      }),
      /candidate descriptor pin is stale/
    );
    assert.deepEqual(
      await readFile(path.join(state.root, state.paths.imagePng)),
      state.originalBytes
    );
  });

  it('recovers a process interruption between image and metadata publication', async () => {
    const state = await fixture();
    await assert.rejects(
      normalizeCandidates({
        root: state.root,
        theme: 'forest',
        family: state.descriptor.id
      }, {
        afterImageWrite() {
          throw new Error('simulated process interruption');
        }
      }),
      /simulated process interruption/
    );
    const interruptedImage = await readFile(
      path.join(state.root, state.paths.imagePng)
    );
    assert.equal(interruptedImage.equals(state.originalBytes), false);
    const interruptedMetadata =
      (await readJson(state.root, state.paths.metadata)).value;
    assert.deepEqual(interruptedMetadata.image, state.candidate.image);
    const transactionRelative =
      `${state.paths.directory}/.normalize-transaction.json`;
    const backupRelative = `${state.paths.directory}/.normalize-backup`;
    const interruptedTransaction = await readFile(
      path.join(state.root, transactionRelative)
    );
    const interruptedBackup = await readFile(
      path.join(state.root, backupRelative)
    );
    await assert.rejects(
      normalizeCandidates({
        root: state.root,
        theme: 'forest',
        family: state.descriptor.id,
        check: true
      }),
      /unfinished normalization transaction/
    );
    assert.deepEqual(
      await readFile(path.join(state.root, state.paths.imagePng)),
      interruptedImage
    );
    assert.deepEqual(
      await readFile(path.join(state.root, transactionRelative)),
      interruptedTransaction
    );
    assert.deepEqual(
      await readFile(path.join(state.root, backupRelative)),
      interruptedBackup
    );

    const recovered = await normalizeCandidates({
      root: state.root,
      theme: 'forest',
      family: state.descriptor.id
    });
    assert.equal(recovered.results[0].status, 'normalized');
    const current = await normalizeCandidates({
      root: state.root,
      theme: 'forest',
      family: state.descriptor.id,
      check: true
    });
    assert.equal(current.ok, true);
    assert.equal(current.results[0].status, 'current');
    for (const relative of [
      backupRelative,
      transactionRelative
    ]) {
      await assert.rejects(
        readFile(path.join(state.root, relative)),
        error => error.code === 'ENOENT'
      );
    }
  });

  it('rejects missing candidates and approved family identities', async () => {
    const missing = await fixture();
    await rm(path.join(missing.root, missing.paths.metadata));
    await assert.rejects(
      normalizeCandidates({
        root: missing.root,
        theme: 'forest',
        family: missing.descriptor.id
      }),
      /has no generated review candidate/
    );

    const approved = await fixture();
    await normalizeCandidates({
      root: approved.root,
      theme: 'forest',
      family: approved.descriptor.id
    });
    await approveCandidate({
      root: approved.root,
      theme: 'forest',
      family: approved.descriptor.id,
      reviewer: 'normalization-test',
      decision: 'approved',
      reason:
        'The normalized moss surface preserves full-diamond coverage, quiet '
        + 'seam edges, the intended forest palette, and has no framing or route '
        + 'artifacts.',
      approvedAt: '2026-07-30T12:00:00.000Z'
    });
    await assert.rejects(
      normalizeCandidates({
        root: approved.root,
        theme: 'forest',
        family: approved.descriptor.id
      }),
      /only draft review candidates may be normalized/
    );
  });

  it('uses preview selection flags and has no image-generation execution path', async () => {
    assert.deepEqual(
      parseCommand([
        'normalize',
        '--theme', 'forest',
        '--ecology-profile', 'forest-iron-depths-borderwood',
        '--tier', '1',
        '--category', 'surface',
        '--surface-variant', '0',
        '--family', 'family-a',
        '--family', 'family-b',
        '--check',
        '--json'
      ]),
      {
        command: 'normalize',
        options: {
          theme: 'forest',
          ecologyProfile: 'forest-iron-depths-borderwood',
          tier: 1,
          category: 'surface',
          surfaceVariant: 0,
          families: ['family-a', 'family-b'],
          check: true,
          json: true
        }
      }
    );
    const source = await readFile(
      path.join(REPOSITORY_ROOT, 'scripts/battle-art/normalize.mjs'),
      'utf8'
    );
    assert.doesNotMatch(source, /\bimagegen\b/);
    assert.doesNotMatch(source, /\bgenerateBattleArt\b/);
    assert.doesNotMatch(source, /node:child_process/);
  });
});
