import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  cp,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it } from 'node:test';

import sharp from 'sharp';

import {
  computeTemplateMapAssetBundleManifestFullHash
} from '../../shared/battleMap/v3/compiler.js';

import {
  BUNDLE_PATH,
  BUNDLE_REGISTRY_PATH,
  CATEGORIES,
  FRONTEND_BUNDLE_PATH,
  FRONTEND_BUNDLE_REGISTRY_PATH,
  INVENTORY_PATH,
  READINESS_PLAN_PATH,
  RENDER_PROFILE,
  THEMES,
  approveCandidate,
  archiveCurrentRelease,
  assertDescriptor,
  auditBattleArt,
  buildBundle,
  buildBundleRegistry,
  buildInventory,
  compileApproved,
  computeBattleArtRendererManifestFullHash,
  draftDescriptor,
  hashFile,
  loadBattleArt,
  readJson,
  resolveArchivedRuntimeBundle,
  reviseFamily,
  stableJson,
  toCompilerAssetBundle,
  writeDraft,
  writePreview
} from './lifecycle.mjs';
import {
  CODEX_WORKER_ENV_KEYS,
  MAX_WORKER_OUTPUT_BYTES,
  buildCodexArgs,
  buildCodexWorkerEnvironment,
  buildGenerationPrompt,
  countImagegenInvocations,
  generateBattleArt,
  parseGenerateArgs,
  runCommand
} from './generate.mjs';
import {
  withBattleArtManifestAndCandidateLock
} from './candidate-lock.mjs';
import { parseCommand } from './cli.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');
const temporaryRoots = [];

function distanceToSegment(x, y, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  const projection = Math.max(0, Math.min(
    1,
    (((x - start.x) * dx) + ((y - start.y) * dy)) / lengthSquared
  ));
  return Math.hypot(
    x - (start.x + (projection * dx)),
    y - (start.y + (projection * dy))
  );
}

function topologyDirections(topology) {
  if (topology === 'cross') return ['n', 'e', 's', 'w'];
  if (topology === 'isolated') return [];
  return [...topology.slice(topology.indexOf('-') + 1)];
}

async function fixture({ plannedDrafts = [] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'modia-battle-art-'));
  temporaryRoots.push(root);
  const battleArtRoot = path.join(root, 'ai-image-metadata/battle-art');
  await mkdir(battleArtRoot, { recursive: true });
  await copyFile(
    path.join(REPOSITORY_ROOT, 'ai-image-metadata/battle-art/manifest.json'),
    path.join(battleArtRoot, 'manifest.json')
  );
  await cp(
    path.join(REPOSITORY_ROOT, 'ai-image-metadata/battle-art/prompts'),
    path.join(battleArtRoot, 'prompts'),
    { recursive: true }
  );
  await cp(
    path.join(REPOSITORY_ROOT, 'ai-image-metadata/battle-art/descriptors'),
    path.join(battleArtRoot, 'descriptors'),
    { recursive: true }
  );
  await copyFile(
    path.join(REPOSITORY_ROOT, READINESS_PLAN_PATH),
    path.join(root, READINESS_PLAN_PATH)
  );
  const referenceRelative =
    'ai-image-metadata/battle-maps/sources/forest/forest-template-01/reference.png';
  await mkdir(path.dirname(path.join(root, referenceRelative)), { recursive: true });
  await copyFile(path.join(REPOSITORY_ROOT, referenceRelative), path.join(root, referenceRelative));

  const manifest = (await readJson(
    root,
    'ai-image-metadata/battle-art/manifest.json'
  )).value;
  if (plannedDrafts.length > 0) {
    const readiness = (await readJson(root, READINESS_PLAN_PATH)).value;
    for (const options of plannedDrafts) {
      const descriptor = draftDescriptor({ manifest, ...options });
      for (const tierBand of descriptor.capabilities.tierBands) {
        readiness.plans.push({
          theme: descriptor.theme,
          ecologyProfile: descriptor.capabilities.ecologyProfile,
          tierBand,
          requirements: descriptor.capabilities.heightDeltas.map(
            heightDelta => ({
              descriptorId: descriptor.id,
              familyGroup: descriptor.familyGroup,
              variantId: descriptor.variantId,
              category: descriptor.category,
              direction: descriptor.capabilities.direction,
              routeTopology: descriptor.capabilities.routeTopology,
              surfaceVariant: descriptor.capabilities.surfaceVariant,
              heightDelta
            })
          )
        });
      }
    }
    await writeFile(
      path.join(root, READINESS_PLAN_PATH),
      stableJson(readiness)
    );
  }
  manifest.historicalReleases = [];
  await writeFile(
    path.join(root, 'ai-image-metadata/battle-art/manifest.json'),
    stableJson(manifest)
  );
  const descriptors = [];
  for (const descriptorRelative of manifest.descriptors) {
    const descriptor = (await readJson(root, descriptorRelative)).value;
    const draft = {
      ...descriptor,
      status: 'draft',
      content: {
        ...descriptor.content,
        sourceSha256: null,
        runtimeSha256: null,
        immutableUrl: null
      },
      source: null
    };
    await writeFile(path.join(root, descriptorRelative), stableJson(draft));
    descriptors.push({ path: descriptorRelative, descriptor: draft });
  }

  const bundle = await buildBundle(manifest, descriptors);
  const registry = buildBundleRegistry([], bundle);
  await writeFile(path.join(root, BUNDLE_PATH), stableJson(bundle));
  await writeFile(path.join(root, BUNDLE_REGISTRY_PATH), stableJson(registry));
  await writeFile(
    path.join(root, INVENTORY_PATH),
    stableJson(buildInventory(manifest, descriptors))
  );
  await mkdir(path.join(root, 'frontend/src/generated'), { recursive: true });
  await writeFile(path.join(root, FRONTEND_BUNDLE_PATH), stableJson(bundle));
  await writeFile(
    path.join(root, FRONTEND_BUNDLE_REGISTRY_PATH),
    stableJson(registry)
  );
  return root;
}

async function candidateWorker({ workspace, descriptor }) {
  const { width, height } = descriptor.canvas;
  const anchor = descriptor.placement.anchor;
  const verticalRadius = Math.min(
    width / 4,
    anchor.x / 2,
    (width - 1 - anchor.x) / 2,
    anchor.y,
    height - 1 - anchor.y
  );
  const horizontalRadius = verticalRadius * 2;
  const boundaryVertices = {
    top: { x: anchor.x, y: anchor.y - verticalRadius },
    right: { x: anchor.x + horizontalRadius, y: anchor.y },
    bottom: { x: anchor.x, y: anchor.y + verticalRadius },
    left: { x: anchor.x - horizontalRadius, y: anchor.y }
  };
  const centeredEdges = {
    n: [boundaryVertices.top, boundaryVertices.right],
    e: [boundaryVertices.right, boundaryVertices.bottom],
    s: [boundaryVertices.bottom, boundaryVertices.left],
    w: [boundaryVertices.left, boundaryVertices.top]
  };
  const centeredSides = {
    n: {
      x: anchor.x + (horizontalRadius / 2),
      y: anchor.y - (verticalRadius / 2)
    },
    e: {
      x: anchor.x + (horizontalRadius / 2),
      y: anchor.y + (verticalRadius / 2)
    },
    s: {
      x: anchor.x - (horizontalRadius / 2),
      y: anchor.y + (verticalRadius / 2)
    },
    w: {
      x: anchor.x - (horizontalRadius / 2),
      y: anchor.y - (verticalRadius / 2)
    }
  };
  const connectionVectors = {
    n: { x: 128, y: -64 },
    e: { x: 128, y: 64 },
    s: { x: -128, y: 64 },
    w: { x: -128, y: -64 }
  };
  const connectionTargets = Object.fromEntries(
    Object.entries(connectionVectors).map(([direction, vector]) => [
      direction,
      {
        x: Math.max(0, Math.min(width - 1, anchor.x + vector.x)),
        y: Math.max(0, Math.min(height - 1, anchor.y + vector.y))
      }
    ])
  );
  const routeSides = {
    n: { x: width * 0.75, y: height * 0.25 },
    e: { x: width * 0.75, y: height * 0.75 },
    s: { x: width * 0.25, y: height * 0.75 },
    w: { x: width * 0.25, y: height * 0.25 }
  };
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let inside;
      if (descriptor.rasterContract.kind === 'opaque-tile-diamond') {
        inside = (
            Math.abs(x - ((width - 1) / 2)) / (width / 2)
            + Math.abs(y - ((height - 1) / 2)) / (height / 2)
          ) <= 1;
      } else if (descriptor.category === 'route-transition'
        && descriptor.capabilities?.routeTopology) {
        const directions = topologyDirections(
          descriptor.capabilities.routeTopology
        );
        inside = directions.length === 0
          ? Math.hypot(x - anchor.x, y - anchor.y) <= 18
          : directions.some(direction => (
              distanceToSegment(x, y, anchor, routeSides[direction]) <= 9
            ));
      } else if (descriptor.category === 'route-transition') {
        inside = x > 2 && x < width - 3 && y > 2 && y < height - 3
          && Math.abs((y / height) - (x / width)) < 0.14;
      } else if (['connection-stairs', 'connection-slope'].includes(
        descriptor.category
      ) && descriptor.capabilities?.direction) {
        inside = distanceToSegment(
          x,
          y,
          anchor,
          connectionTargets[descriptor.capabilities.direction]
        ) <= 10;
      } else if (['connection-stairs', 'connection-slope'].includes(
        descriptor.category
      )) {
        inside = Math.abs(x - descriptor.placement.anchor.x) / 72
          + Math.abs(y - descriptor.placement.anchor.y) / 72 <= 1;
      } else if (descriptor.category === 'exposed-face-boundary'
        && descriptor.capabilities?.direction) {
        const direction = descriptor.capabilities.direction;
        const groundedEdge = distanceToSegment(
          x,
          y,
          centeredEdges[direction][0],
          centeredEdges[direction][1]
        ) <= 8
          || distanceToSegment(
            x,
            y,
            anchor,
            centeredSides[direction]
          ) <= 7;
        const canopyCrown = descriptor.id.includes('canopy-edge')
          && (
            ((x - (width / 2)) ** 2) / ((width * 0.35) ** 2)
            + ((y - (height * 0.21)) ** 2) / ((height * 0.19) ** 2)
          ) <= 1;
        const canopyTrunk = descriptor.id.includes('canopy-edge')
          && Math.abs(x - (width / 2)) <= 5
          && y >= height * 0.2
          && y <= anchor.y;
        inside = groundedEdge || canopyCrown || canopyTrunk;
      } else if (descriptor.category === 'exposed-face-boundary') {
        inside = Math.abs(x - descriptor.placement.anchor.x) / 112
          + Math.abs(y - (descriptor.placement.anchor.y - 64)) / 64 <= 1;
      } else {
        const anchor = descriptor.placement.anchor;
        const verticalRadius = Math.min(
          60,
          anchor.y - descriptor.placement.drawBounds.y - 1
        );
        inside = Math.abs(x - anchor.x) / Math.max(24, width * 0.35)
          + Math.abs(y - (anchor.y - verticalRadius)) / verticalRadius <= 1
          || (x >= anchor.x - 4
            && x <= anchor.x + 4
            && y >= anchor.y - verticalRadius
            && y <= anchor.y);
      }
      const drawBounds = descriptor.placement.drawBounds;
      inside = inside
        && x >= drawBounds.x
        && x < drawBounds.x + drawBounds.width
        && y >= drawBounds.y
        && y < drawBounds.y + drawBounds.height;
      if ((x === 0 || x === width - 1)
        && (y === 0 || y === height - 1)) {
        inside = false;
      }
      if (!inside) continue;
      const index = ((y * width) + x) * 4;
      data[index] = 117;
      data[index + 1] = 76;
      data[index + 2] = 36;
      data[index + 3] = 255;
    }
  }
  await sharp(data, {
    raw: { width, height, channels: 4 }
  })
    .png()
    .toFile(path.join(workspace, 'candidate.png'));
  await writeFile(path.join(workspace, 'last-message.txt'), 'generated one candidate\n');
  return {
    stdout: Buffer.from(
      '{"type":"item.completed","item":{"id":"imagegen-1","type":"mcp_tool_call",'
      + '"server":"image_gen","tool":"imagegen"}}\n'
    ),
    stderr: Buffer.alloc(0),
    args: buildCodexArgs(workspace, path.join(workspace, 'last-message.txt'))
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('battle-art tracked contracts', () => {
  it('audits all themes, required categories, frozen pins, and forest coverage', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const result = await auditBattleArt({ root: REPOSITORY_ROOT });
    assert.equal(loaded.manifest.version, 6);
    assert.equal(loaded.descriptors.length, 51);
    assert.equal(new Set(
      loaded.descriptors.map(entry => entry.descriptor.category)
    ).size, 7);
    assert.deepEqual(result, {
      ok: true,
      themes: loaded.manifest.themes.length,
      categories: loaded.manifest.categories.length,
      families: loaded.descriptors.length,
      approved: loaded.descriptors.filter(
        entry => entry.descriptor.status !== 'draft'
      ).length,
      compiled: loaded.descriptors.filter(
        entry => entry.descriptor.status === 'compiled'
      ).length,
      readiness: {
        plan: READINESS_PLAN_PATH,
        plans: 1,
        required: 43,
        present: 43
      }
    });
  });

  it('drafts every required category for every supported theme', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    for (const theme of THEMES) {
      for (const category of CATEGORIES) {
        const descriptor = draftDescriptor({
          manifest: loaded.manifest,
          theme,
          category,
          id: `${theme.replaceAll('_', '-')}-${category}`
        });
        assert.equal(descriptor.theme, theme);
        assert.equal(descriptor.category, category);
        assert.ok(descriptor.canvas.width > 0);
        assert.ok(descriptor.canvas.height > 0);
        assert.equal(descriptor.content.version, 1);
      }
    }
  });

  it('writes generalized drafts and review previews without generation or approval', async () => {
    const root = await fixture();
    const result = await writeDraft({
      root,
      theme: 'cave',
      category: 'surface',
      id: 'cave-crystal-surface'
    });
    assert.equal(result.descriptor,
      'ai-image-metadata/battle-art/descriptors/cave/cave-crystal-surface.json');
    const loaded = await loadBattleArt(root);
    const drafted = loaded.descriptors.find(
      entry => entry.descriptor.id === 'cave-crystal-surface'
    ).descriptor;
    assert.equal(drafted.status, 'draft');
    assert.equal(drafted.source, null);
    const preview = await writePreview({
      root,
      theme: 'cave',
      family: 'cave-crystal-surface'
    });
    const html = await readFile(path.join(root, preview.output), 'utf8');
    assert.match(html, /cave-crystal-surface/);
    assert.match(html, /No candidate generated/);
    await assert.rejects(
      writePreview({
        root,
        theme: 'cave',
        family: 'cave-crystal-surface',
        output: 'package.json'
      }),
      /preview output is outside its allowlisted directory/
    );
  });

  it('serializes new-family manifest updates without losing either descriptor', async () => {
    const root = await fixture();
    let releaseFirst;
    let signalFirst;
    const firstBlocked = new Promise(resolve => {
      signalFirst = resolve;
    });
    const firstRelease = new Promise(resolve => {
      releaseFirst = resolve;
    });
    const first = writeDraft({
      root,
      theme: 'cave',
      category: 'surface',
      id: 'cave-serialized-surface'
    }, {
      beforeDescriptorWrite: async () => {
        signalFirst();
        await firstRelease;
      }
    });
    await firstBlocked;

    let secondEntered = false;
    const second = writeDraft({
      root,
      theme: 'swamp',
      category: 'surface',
      id: 'swamp-serialized-surface'
    }, {
      beforeDescriptorWrite: async () => {
        secondEntered = true;
      }
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const secondEnteredWhileFirstHeld = secondEntered;
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(
      secondEnteredWhileFirstHeld,
      false,
      'new-family writes must share the manifest transaction lock'
    );
    const manifest = (await readJson(
      root,
      'ai-image-metadata/battle-art/manifest.json'
    )).value;
    assert.ok(manifest.descriptors.includes(firstResult.descriptor));
    assert.ok(manifest.descriptors.includes(secondResult.descriptor));
  });

  it('keeps concurrent publication behind the manifest lock after descriptor staging', async () => {
    const root = await fixture();
    const options = {
      root,
      theme: 'cave',
      category: 'surface',
      id: 'cave-publication-race-surface'
    };
    let releaseManifest;
    let signalManifest;
    const manifestBlocked = new Promise(resolve => {
      signalManifest = resolve;
    });
    const manifestRelease = new Promise(resolve => {
      releaseManifest = resolve;
    });
    const first = writeDraft(options, {
      beforeManifestWrite: async () => {
        signalManifest();
        await manifestRelease;
      }
    });
    await manifestBlocked;

    let secondSettled = false;
    const second = writeDraft({
      ...options,
      force: true
    }).finally(() => {
      secondSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const secondSettledBeforeManifest = secondSettled;
    releaseManifest();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(
      secondSettledBeforeManifest,
      false,
      'a concurrent caller must wait instead of observing a staged orphan'
    );
    assert.equal(firstResult.descriptor, secondResult.descriptor);
    const loaded = await loadBattleArt(root);
    assert.equal(
      loaded.manifest.descriptors.filter(pathValue => (
        pathValue === firstResult.descriptor
      )).length,
      1
    );
  });

  it('rolls back failed manifest publication and safely adopts an exact crash orphan', async () => {
    const root = await fixture();
    const options = {
      root,
      theme: 'cave',
      category: 'surface',
      id: 'cave-publication-failure-surface'
    };
    const relative = 'ai-image-metadata/battle-art/descriptors/cave/'
      + 'cave-publication-failure-surface.json';
    await assert.rejects(
      writeDraft(options, {
        writeManifest: async () => {
          throw new Error('injected manifest publication failure');
        }
      }),
      /injected manifest publication failure/
    );
    await assert.rejects(
      readFile(path.join(root, relative)),
      error => error.code === 'ENOENT'
    );
    await loadBattleArt(root);

    await assert.rejects(
      writeDraft(options, {
        writeManifest: async () => {
          throw new Error('simulated process crash before manifest commit');
        },
        rollbackDescriptor: async () => {}
      }),
      /simulated process crash/
    );
    assert.equal(typeof await readFile(path.join(root, relative), 'utf8'), 'string');
    const recovered = await writeDraft(options);
    assert.equal(recovered.descriptor, relative);
    const loaded = await loadBattleArt(root);
    assert.ok(loaded.manifest.descriptors.includes(relative));
  });

  it('publishes every required npm lifecycle command', async () => {
    const packageJson = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
    for (const command of [
      'battle-art:audit',
      'battle-art:draft',
      'battle-art:generate',
      'battle-art:preview',
      'battle-art:approve',
      'battle-art:revise',
      'battle-art:compile',
      'battle-art:archive',
      'battle-art:check',
      'battle-assets:inventory'
    ]) assert.equal(typeof packageJson.scripts[command], 'string', command);
    assert.equal(parseCommand(['audit']).command, 'audit');
    assert.equal(parseCommand(['archive']).command, 'archive');
    assert.equal(
      parseCommand(['revise', '--theme', 'forest', '--family', 'forest-moss-surface']).command,
      'revise'
    );
    assert.equal(parseCommand(['inventory', '--check']).options.check, true);
    assert.throws(
      () => parseCommand(['approve', '--theme', 'forest']),
      /--family is required/
    );
  });

  it('exposes the compiler projection and renderer descriptors at the tracked bundle path', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const bundle = await buildBundle(loaded.manifest, loaded.descriptors);
    assert.equal(BUNDLE_PATH, 'ai-image-metadata/battle-art/runtime-asset-bundle.json');
    assert.deepEqual(Object.keys(bundle), [
      'schemaVersion',
      'renderProfile',
      'id',
      'version',
      'manifestFullHash',
      'rendererManifestFullHash',
      'assets',
      'renderers'
    ]);
    assert.deepEqual(bundle.renderProfile, RENDER_PROFILE);
    assert.equal(bundle.version, loaded.manifest.version);
    const compiledFamilyIds = loaded.descriptors
      .filter(entry => entry.descriptor.status === 'compiled')
      .map(entry => entry.descriptor.id)
      .sort();
    assert.equal(compiledFamilyIds.length, 51);
    assert.deepEqual(
      bundle.assets.map(asset => asset.key),
      compiledFamilyIds
    );
    assert.deepEqual(
      bundle.renderers.map(renderer => renderer.id),
      bundle.assets.map(asset => asset.key)
    );
    assert.ok(bundle.assets.every(asset => (
      Number.isSafeInteger(asset.contentVersion)
      && asset.contentVersion >= 1
      && /^sha256:[0-9a-f]{64}$/.test(asset.contentHash)
      && asset.immutableUrl.endsWith(
        `/${asset.contentHash.slice('sha256:'.length)}.webp`
      )
    )));
    const compilerProjection = toCompilerAssetBundle(bundle);
    assert.equal(
      bundle.manifestFullHash,
      await computeTemplateMapAssetBundleManifestFullHash(compilerProjection)
    );
    assert.equal(
      bundle.rendererManifestFullHash,
      await computeBattleArtRendererManifestFullHash(bundle)
    );
    const tamperedProfile = structuredClone(bundle);
    tamperedProfile.renderProfile.tileWidth = 65;
    assert.notEqual(
      await computeBattleArtRendererManifestFullHash(tamperedProfile),
      bundle.rendererManifestFullHash
    );
    assert.deepEqual(
      (await readJson(REPOSITORY_ROOT, FRONTEND_BUNDLE_PATH)).value,
      bundle
    );
  });

  it('fails closed when a hash-pinned style reference changes', async () => {
    const root = await fixture();
    const reference =
      'ai-image-metadata/battle-maps/sources/forest/forest-template-01/reference.png';
    await writeFile(path.join(root, reference), 'not the pinned image');
    await assert.rejects(
      auditBattleArt({ root }),
      /forest-source-template-01 hash pin mismatch/
    );
  });

  it('rejects symbolic-link style inputs before staging an image worker', async () => {
    const root = await fixture();
    const reference =
      'ai-image-metadata/battle-maps/sources/forest/forest-template-01/reference.png';
    await rm(path.join(root, reference));
    await symlink('/etc/passwd', path.join(root, reference));
    await assert.rejects(
      loadBattleArt(root),
      /must not contain symbolic links/
    );
  });

  it('rejects category semantic drift and unmanifested descriptors', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const obstacle = structuredClone(
      loaded.descriptors.find(entry => entry.descriptor.category === 'blocking-obstacle').descriptor
    );
    obstacle.placement.collision = { kind: 'none', cells: [] };
    obstacle.placement.stratum = 'surface';
    assert.throws(
      () => assertDescriptor(obstacle, loaded.manifest),
      /category contract/
    );
    const oddCanvas = structuredClone(obstacle);
    oddCanvas.placement.collision = {
      kind: 'solid',
      cells: [{ x: 0, y: 0 }]
    };
    oddCanvas.placement.stratum = 'obstacle';
    oddCanvas.canvas.width = 257;
    oddCanvas.placement.drawBounds.width = 257;
    assert.throws(
      () => assertDescriptor(oddCanvas, loaded.manifest),
      /divisible by sourcePixelScale/
    );

    const root = await fixture();
    await copyFile(
      path.join(root, 'ai-image-metadata/battle-art/descriptors/forest/forest-moss-surface.json'),
      path.join(root, 'ai-image-metadata/battle-art/descriptors/forest/unmanifested.json')
    );
    await assert.rejects(auditBattleArt({ root }), /descriptor manifest is incomplete/);

    const runtimeRoot = await fixture();
    const orphanRuntime =
      'frontend/public/assets/battle-map-v3/forest/surface/orphan/v1/orphan.webp';
    await mkdir(path.dirname(path.join(runtimeRoot, orphanRuntime)), { recursive: true });
    await writeFile(path.join(runtimeRoot, orphanRuntime), 'orphan');
    await assert.rejects(
      auditBattleArt({ root: runtimeRoot }),
      /runtime asset membership is incomplete/
    );
  });

  it('allows only canonical empty occlusion for non-colliding categories', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptorFor = category => structuredClone(
      loaded.descriptors.find(entry => entry.descriptor.category === category).descriptor
    );

    const surface = descriptorFor('surface');
    surface.placement.occlusionBounds = { x: 0, y: 0, width: 0, height: 0 };
    assert.doesNotThrow(() => assertDescriptor(surface, loaded.manifest));

    const positiveSurface = descriptorFor('surface');
    positiveSurface.placement.occlusionBounds = {
      x: 1,
      y: 1,
      width: positiveSurface.canvas.width - 2,
      height: positiveSurface.canvas.height - 2
    };
    assert.doesNotThrow(() => assertDescriptor(positiveSurface, loaded.manifest));

    for (const partialEmpty of [
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: 0 }
    ]) {
      const partial = descriptorFor('nonblocking-decoration');
      partial.placement.occlusionBounds = partialEmpty;
      assert.throws(
        () => assertDescriptor(partial, loaded.manifest),
        /must have positive width and height or be the canonical empty rectangle/
      );
    }

    const offsetEmpty = descriptorFor('route-transition');
    offsetEmpty.placement.occlusionBounds = {
      x: 1,
      y: 1,
      width: 0,
      height: 0
    };
    assert.throws(
      () => assertDescriptor(offsetEmpty, loaded.manifest),
      /empty rectangle must be \{x:0,y:0,width:0,height:0\}/
    );

    for (const category of [
      'connection-stairs',
      'connection-slope',
      'exposed-face-boundary',
      'blocking-obstacle'
    ]) {
      const blocking = descriptorFor(category);
      assert.doesNotThrow(() => assertDescriptor(blocking, loaded.manifest));
      blocking.placement.occlusionBounds = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      assert.throws(
        () => assertDescriptor(blocking, loaded.manifest),
        new RegExp(
          `occlusionBounds must be positive for the ${category} category contract`
        )
      );
    }
  });
});

describe('battle-art isolated generation and review boundary', () => {
  it('passes only local Codex runtime/auth locations to generated-image workers', () => {
    const environment = buildCodexWorkerEnvironment({
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/reviewer',
      CODEX_HOME: '/home/reviewer/.codex-isolated',
      TMPDIR: '/tmp/reviewer',
      LANG: 'en_CA.UTF-8',
      HTTPS_PROXY: 'http://localhost:3128',
      OPENAI_API_KEY: 'must-not-be-used-as-an-imagegen-fallback',
      DATABASE_URL: 'postgres://unrelated-app-secret',
      SESSION_SECRET: 'unrelated-session-secret',
      STRIPE_API_SECRET_KEY: 'unrelated-app-secret',
      CODEX_THREAD_ID: 'unrelated-parent-session'
    });
    assert.deepEqual(environment, {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/reviewer',
      CODEX_HOME: '/home/reviewer/.codex-isolated',
      TMPDIR: '/tmp/reviewer',
      LANG: 'en_CA.UTF-8',
      HTTPS_PROXY: 'http://localhost:3128'
    });
    assert.equal(CODEX_WORKER_ENV_KEYS.includes('OPENAI_API_KEY'), false);
    assert.equal(Object.hasOwn(environment, 'DATABASE_URL'), false);
    assert.equal(Object.hasOwn(environment, 'SESSION_SECRET'), false);
    assert.equal(Object.hasOwn(environment, 'CODEX_THREAD_ID'), false);
  });

  it('applies the environment allowlist at the spawned worker boundary', async () => {
    let spawnOptions;
    const spawnImpl = (_command, _args, options) => {
      spawnOptions = options;
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    };
    await runCommand({
      command: 'codex',
      args: ['exec'],
      cwd: '/tmp/generated-image-worker',
      input: 'generate',
      timeoutMs: 1_000,
      spawnImpl,
      environmentSource: {
        PATH: '/usr/bin',
        HOME: '/home/reviewer',
        CODEX_HOME: '/home/reviewer/.codex',
        OPENAI_API_KEY: 'must-not-reach-worker',
        DATABASE_URL: 'must-not-reach-worker',
        SESSION_SECRET: 'must-not-reach-worker'
      }
    });
    assert.deepEqual(spawnOptions.env, {
      PATH: '/usr/bin',
      HOME: '/home/reviewer',
      CODEX_HOME: '/home/reviewer/.codex'
    });
  });

  it('waits for worker closure after bounded-output termination', async () => {
    let child;
    const kills = [];
    const spawnImpl = () => {
      child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = signal => {
        kills.push(signal);
      };
      return child;
    };
    let rejection = null;
    const pending = runCommand({
      command: 'codex',
      args: ['exec'],
      cwd: '/tmp/generated-image-worker',
      input: 'generate',
      timeoutMs: 10_000,
      maxOutputBytes: 4,
      spawnImpl,
      environmentSource: { PATH: '/usr/bin', HOME: '/home/reviewer' }
    });
    pending.catch(error => {
      rejection = error;
    });
    child.stdout.write(Buffer.alloc(5));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rejection, null);
    assert.deepEqual(kills, ['SIGTERM']);
    child.emit('close', null, 'SIGTERM');
    await assert.rejects(pending, /worker stdout exceeded 4 bytes/);
  });

  it('terminates detached worker groups when the generator parent receives SIGTERM', {
    skip: process.platform === 'win32'
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'modia-worker-signal-'));
    temporaryRoots.push(root);
    const pidPath = path.join(root, 'worker.pid');
    const childSource = [
      "const fs = require('node:fs');",
      'fs.writeFileSync(process.argv[1], String(process.pid));',
      "process.on('SIGTERM', () => {});",
      'setInterval(() => {}, 1000);'
    ].join('');
    const generateUrl = new URL('./generate.mjs', import.meta.url).href;
    const wrapperSource = [
      `const { runCommand } = await import(${JSON.stringify(generateUrl)});`,
      'await runCommand({',
      'command: process.execPath,',
      `args: ['-e', ${JSON.stringify(childSource)}, ${JSON.stringify(pidPath)}],`,
      `cwd: ${JSON.stringify(root)},`,
      "input: '',",
      'timeoutMs: 10000',
      '});'
    ].join('');
    const wrapper = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      wrapperSource
    ], {
      stdio: ['ignore', 'ignore', 'ignore']
    });
    let workerPid = null;
    for (let attempt = 0; attempt < 100 && workerPid === null; attempt += 1) {
      try {
        workerPid = Number(await readFile(pidPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
    const closed = new Promise(resolve => wrapper.once(
      'close',
      (code, signal) => resolve({ code, signal })
    ));
    wrapper.kill('SIGTERM');
    const outcome = await closed;
    assert.equal(outcome.signal, 'SIGTERM');
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
      try {
        process.kill(workerPid, 0);
        await new Promise(resolve => setTimeout(resolve, 20));
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        alive = false;
      }
    }
    assert.equal(alive, false);
  });

  it('uses ephemeral workers, defaults to concurrency two, and caps concurrency at four', () => {
    assert.deepEqual(
      {
        concurrency: parseGenerateArgs([]).concurrency,
        textStyleFallback: parseGenerateArgs([]).textStyleFallback
      },
      { concurrency: 2, textStyleFallback: false }
    );
    assert.equal(parseGenerateArgs(['--concurrency', '4']).concurrency, 4);
    assert.equal(
      parseGenerateArgs(['--text-style-fallback']).textStyleFallback,
      true
    );
    assert.equal(parseGenerateArgs(['--keep-going']).keepGoing, true);
    assert.throws(() => parseGenerateArgs(['--concurrency', '5']), /between 1 and 4/);
    assert.throws(
      () => parseGenerateArgs(['--text-style-fallback=true']),
      /unknown generate argument/
    );
    const args = buildCodexArgs('/tmp/workspace', '/tmp/workspace/last-message.txt');
    assert.equal(args[0], 'exec');
    assert.ok(args.includes('--ephemeral'));
    assert.ok(args.includes('workspace-write'));
    assert.equal(args.includes('--image'), false);
    const stagedImage = '/tmp/workspace/style-reference-01.png';
    const argsWithImage = buildCodexArgs(
      '/tmp/workspace',
      '/tmp/workspace/last-message.txt',
      [stagedImage]
    );
    assert.equal(argsWithImage.filter(argument => argument === '--image').length, 1);
    assert.equal(argsWithImage[argsWithImage.indexOf('--image') + 1], stagedImage);
    assert.equal(countImagegenInvocations(Buffer.from(
      '{"type":"item.completed","item":{"id":"one","type":"mcp_tool_call",'
      + '"server":"image_gen","tool":"imagegen"}}\n'
    )), 1);
    assert.equal(countImagegenInvocations(Buffer.from(
      '{"type":"item.started","item":{"type":"command_execution","command":'
      + '"/bin/cp /home/test/.codex/generated_images/thread-1/'
      + 'call_Abc123.png candidate.png"}}\n'
    )), 1);
  });

  it('freezes descriptor/style inputs and requires exactly one imagegen call per family prompt', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors[0].descriptor;
    const { value: profile } = await readJson(
      loaded.root,
      loaded.manifest.promptProfile.path
    );
    const prompt = buildGenerationPrompt({
      descriptor,
      profile,
      styleFiles: ['style-reference-01.png']
    });
    assert.equal((prompt.match(/call the imagegen tool exactly once/g) ?? []).length, 1);
    assert.match(prompt, /Do not approve, pin, compile, publish/);
    assert.match(prompt, /descriptor\.json/);
    assert.match(prompt, /style-reference-01\.png/);
    assert.match(prompt, /report the result and\s+end immediately/);
  });

  it('prompts directional connections from the low anchor to exact high endpoints', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const base = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-borderwood-earth-ramp-n'
    ).descriptor;
    const expected = {
      n: 'upper-right high endpoint at 255,64',
      e: 'lower-right high endpoint at 255,191',
      s: 'lower-left high endpoint at 0,191',
      w: 'upper-left high endpoint at 0,64'
    };
    for (const [direction, endpoint] of Object.entries(expected)) {
      const descriptor = structuredClone(base);
      descriptor.capabilities.direction = direction;
      const prompt = buildGenerationPrompt({
        descriptor,
        profile: loaded.promptProfile,
        styleFiles: ['style-reference-01.png']
      });
      assert.match(prompt, /low end in contact with anchor 128,128/);
      assert.ok(prompt.includes(`declared ${direction} ${endpoint}`));
      assert.match(prompt, /none of the other three directional endpoint bands/);
    }
  });

  it('rejects ruler-clean V shapes in generated corner route instructions', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-borderwood-dirt-path-corner-wn'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(prompt, /rounded top-side hairpin/);
    assert.match(prompt, /48–64 pixel wide oval central wear basin/);
    assert.match(prompt, /center must remain broad and round, never a point/);
    assert.match(prompt, /Never use two straight arms forming a V/);
  });

  it('spells out exact allowed and forbidden endpoint coordinates for routes', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-borderwood-dirt-path-corner-es'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(
      prompt,
      /only allowed route endpoint bands for corner-es are E lower-right at 192,96 and S lower-left at 64,96/
    );
    assert.match(
      prompt,
      /forbidden N upper-right at 192,32, W upper-left at 64,32 bands completely clear/
    );
    assert.match(prompt, /Do not substitute a different corner or rotate/);
  });

  it('gives each nonbaseline surface variant one organic macro composition', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-borderwood-moss-ground-3'
    ).descriptor;
    const revised = draftDescriptor({
      manifest: loaded.manifest,
      theme: descriptor.theme,
      category: descriptor.category,
      id: descriptor.id,
      familyGroup: descriptor.familyGroup,
      variantId: descriptor.variantId,
      surfaceVariant: descriptor.capabilities.surfaceVariant,
      ecologyProfile: descriptor.capabilities.ecologyProfile,
      regionalArtDirection:
        'Iron Depths Borderwood uses rugged ironpine, pale birch, ancient broadleaf, '
        + 'cool olive moss, slate-gray stone, muted russet soil, and exposed roots.',
      tierBands: descriptor.capabilities.tierBands,
      heightDeltas: descriptor.capabilities.heightDeltas
    });
    assert.match(revised.generationPrompt, /calm mostly-moss field/);
    assert.match(revised.generationPrompt, /one winding exposed-root seam/);
    assert.match(revised.generationPrompt, /one off-center irregular russet island/);
  });

  it('grounds directional boundaries on one edge while allowing canopy overhang', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-borderwood-canopy-edge-e'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(prompt, /declared e edge from 255,192 to 128,255/);
    assert.match(prompt, /x increases right and y increases downward/);
    assert.match(prompt, /lower-right diagonal, descending left from the right vertex/);
    assert.match(prompt, /first, middle, and last thirds/);
    assert.match(prompt, /pivot is placement metadata and need not be covered/);
    assert.match(prompt, /do not bend the grounded strip away/);
    assert.match(prompt, /never mirror or rotate the declared diagonal/);
    assert.match(prompt, /No grounded base may follow any of the other three edges/);
    assert.match(prompt, /crown foliage may overhang other edge bands/);
    assert.match(prompt, /no vertical slice seam, rectangular panel, crop bar/);
    assert.match(prompt, /span at least half the canvas width/);
    assert.match(prompt, /rise through at least 40% of the canvas height/);
  });

  it('keeps low earth faces separate from regional canopy walls', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-borderwood-earth-face-e'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(prompt, /earth-face subfamily/);
    assert.match(prompt, /only a low exposed soil-and-root profile/);
    assert.match(prompt, /Add no standing tree, trunk, tall shrub, or canopy/);
    assert.match(prompt, /layers beneath separate canopy art/);
    assert.match(prompt, /span at least 45% of the canvas width/);
    assert.match(prompt, /occupy at least 25% of its height/);
    assert.match(prompt, /use no magenta, purple, or pink pixels/);
  });

  it('forbids baked tile platforms under blocking obstacles', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-borderwood-pale-birch'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(prompt, /organic root, soil, or stone footprint/);
    assert.match(prompt, /transparency between outward roots and tufts/);
    assert.match(prompt, /no square or diamond ground tile, rectangular base/);
  });

  it('keeps text-style fallback explicit, stages the pin, and passes no local image', async () => {
    const root = await fixture();
    let observed;
    const worker = async input => {
      observed = {
        prompt: input.prompt,
        styleFiles: input.styleFiles,
        stagedStyleSha256: await hashFile(
          path.join(input.workspace, 'style-reference-01.png')
        )
      };
      return candidateWorker(input);
    };
    const result = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family: 'forest-moss-surface',
      concurrency: 2,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false,
      textStyleFallback: true
    }, { worker });
    const loaded = await loadBattleArt(root);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-moss-surface'
    ).descriptor;
    assert.equal(result.results[0].status, 'generated');
    assert.deepEqual(observed.styleFiles, []);
    assert.equal(
      observed.stagedStyleSha256,
      descriptor.styleReferences[0].sha256
    );
    assert.match(observed.prompt, /staged for audit only\. Do not open it/);
    assert.match(observed.prompt, /do not\s+pass any local image path to imagegen/i);
    assert.match(observed.prompt, /reviewed textual style authority/);
    assert.equal(
      (observed.prompt.match(/call the imagegen tool exactly once/g) ?? []).length,
      1
    );
  });

  it('generates one bounded candidate, supports resume/force, and never approves or compiles', async () => {
    const root = await fixture();
    let calls = 0;
    const worker = async input => {
      calls += 1;
      return candidateWorker(input);
    };
    const options = {
      projectRoot: root,
      theme: 'forest',
      family: 'forest-moss-surface',
      concurrency: 2,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    };
    const generated = await generateBattleArt(options, { worker });
    assert.equal(calls, 1);
    assert.equal(generated.results[0].status, 'generated');

    const loadedAfter = await loadBattleArt(root);
    const descriptor = loadedAfter.descriptors.find(
      entry => entry.descriptor.id === options.family
    ).descriptor;
    assert.equal(descriptor.status, 'draft');
    assert.equal(descriptor.source, null);
    assert.equal(descriptor.content.immutableUrl, null);
    assert.equal((await readJson(root, BUNDLE_PATH)).value.assets.length, 0);

    const resumed = await generateBattleArt(
      { ...options, resume: true },
      { worker }
    );
    assert.equal(calls, 1);
    assert.equal(resumed.results[0].status, 'skipped-complete');

    await generateBattleArt({ ...options, force: true }, { worker });
    assert.equal(calls, 2);
  });

  it('can keep generating independent families after one candidate fails', async () => {
    const root = await fixture();
    const failedFamily = 'forest-moss-surface';
    const successfulFamily = 'forest-dirt-route';
    const worker = async input => {
      if (input.descriptor.id === failedFamily) {
        throw new Error('intentional candidate failure');
      }
      return candidateWorker(input);
    };
    const generated = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      families: [failedFamily, successfulFamily],
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false,
      keepGoing: true
    }, { worker });
    assert.equal(generated.ok, false);
    assert.deepEqual(
      generated.results
        .map(({ family, status }) => ({ family, status }))
        .sort((left, right) => left.family.localeCompare(right.family)),
      [
        { family: successfulFamily, status: 'generated' },
        { family: failedFamily, status: 'failed' }
      ]
    );
    assert.match(
      generated.results.find(result => result.family === failedFamily).error,
      /intentional candidate failure/
    );
  });

  it('serializes same-family force generation across a failed owner', async () => {
    const root = await fixture();
    const options = {
      projectRoot: root,
      theme: 'forest',
      family: 'forest-moss-surface',
      concurrency: 2,
      timeoutMs: 10_000,
      dryRun: false,
      force: true,
      resume: false
    };
    let releaseFirst;
    let signalFirst;
    const firstBlocked = new Promise(resolve => {
      signalFirst = resolve;
    });
    const firstRelease = new Promise(resolve => {
      releaseFirst = resolve;
    });
    const first = generateBattleArt(options, {
      worker: async input => {
        signalFirst();
        await firstRelease;
        await candidateWorker(input);
        throw new Error('intentional first art worker failure');
      }
    });
    await firstBlocked;

    let secondEntered = false;
    const second = generateBattleArt(options, {
      worker: async input => {
        secondEntered = true;
        return candidateWorker(input);
      }
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(secondEntered, false, 'second worker must wait for family ownership');

    releaseFirst();
    await assert.rejects(first, /intentional first art worker failure/);
    const completed = await second;
    assert.equal(completed.results[0].status, 'generated');
    const metadataRelative =
      'ai-image-metadata/battle-art/candidates/forest/forest-moss-surface/result.json';
    const metadata = (await readJson(root, metadataRelative)).value;
    assert.equal(
      await hashFile(path.join(root, metadata.image.path)),
      metadata.image.sha256
    );
  });

  it('approval waits for forced family generation and pins the committed candidate', async () => {
    const root = await fixture();
    const family = 'forest-moss-surface';
    const options = {
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    };
    await generateBattleArt(options, { worker: candidateWorker });
    const candidateRelative =
      `ai-image-metadata/battle-art/candidates/forest/${family}/result.json`;
    const initial = (await readJson(root, candidateRelative)).value;

    let releaseGeneration;
    let signalGeneration;
    const generationBlocked = new Promise(resolve => {
      signalGeneration = resolve;
    });
    const generationRelease = new Promise(resolve => {
      releaseGeneration = resolve;
    });
    const replacement = generateBattleArt({ ...options, force: true }, {
      worker: async input => {
        signalGeneration();
        await generationRelease;
        const result = await candidateWorker(input);
        const candidatePath = path.join(input.workspace, 'candidate.png');
        const recolored = await sharp(await readFile(candidatePath))
          .tint({ r: 145, g: 96, b: 48 })
          .png()
          .toBuffer();
        await writeFile(candidatePath, recolored);
        return result;
      }
    });
    await generationBlocked;

    let approvalSettled = false;
    const approval = approveCandidate({
      root,
      theme: 'forest',
      family,
      reviewer: 'race-reviewer@example.test',
      decision: 'approved',
      approvedAt: '2026-07-30T12:00:00.000Z'
    }).finally(() => {
      approvalSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(
      approvalSettled,
      false,
      'approval must wait for forced candidate publication'
    );

    releaseGeneration();
    await replacement;
    await approval;
    const committedCandidate = (await readJson(root, candidateRelative)).value;
    const loaded = await loadBattleArt(root);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === family
    ).descriptor;
    assert.notEqual(committedCandidate.image.sha256, initial.image.sha256);
    assert.equal(
      descriptor.source.imageSha256,
      committedCandidate.image.sha256
    );
    assert.equal(
      descriptor.source.candidateMetadataPath,
      candidateRelative
    );
  });

  it('forced re-drafting cannot overwrite a concurrent family approval', async () => {
    const theme = 'cave';
    const family = 'cave-draft-race-surface';
    const root = await fixture({
      plannedDrafts: [{
        theme,
        category: 'surface',
        id: family
      }]
    });
    await writeDraft({
      root,
      theme,
      category: 'surface',
      id: family
    });
    await generateBattleArt({
      projectRoot: root,
      theme,
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });

    let releaseDraft;
    let signalDraft;
    const draftBlocked = new Promise(resolve => {
      signalDraft = resolve;
    });
    const draftRelease = new Promise(resolve => {
      releaseDraft = resolve;
    });
    const draft = writeDraft({
      root,
      theme,
      category: 'surface',
      id: family,
      force: true
    }, {
      beforeDescriptorWrite: async () => {
        signalDraft();
        await draftRelease;
      }
    });
    await draftBlocked;

    let approvalSettled = false;
    const approval = approveCandidate({
      root,
      theme,
      family,
      reviewer: 'draft-race-reviewer@example.test',
      decision: 'approved',
      approvedAt: '2026-07-30T12:00:00.000Z'
    }).finally(() => {
      approvalSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const approvalSettledWhileDraftHeld = approvalSettled;
    releaseDraft();
    await draft;
    await approval;

    assert.equal(
      approvalSettledWhileDraftHeld,
      false,
      'approval must wait until the forced draft transaction releases the family'
    );
    const loaded = await loadBattleArt(root);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === family
    ).descriptor;
    assert.equal(descriptor.status, 'approved');
    assert.equal(
      descriptor.source.reviewer,
      'draft-race-reviewer@example.test'
    );
  });

  it('ignores stale family lock contents and rejects a symlinked lock', async () => {
    const root = await fixture();
    const lockDirectory = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest/.locks'
    );
    const lockPath = path.join(lockDirectory, 'forest-moss-surface.lock');
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, '{"pid":999999999}\n');
    const options = {
      projectRoot: root,
      theme: 'forest',
      family: 'forest-moss-surface',
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    };
    await generateBattleArt(options, { worker: candidateWorker });
    assert.equal(await readFile(lockPath, 'utf8'), '{"pid":999999999}\n');

    await rm(lockPath);
    const outside = path.join(root, 'outside.lock');
    await writeFile(outside, '');
    await symlink(outside, lockPath);
    await assert.rejects(
      generateBattleArt({ ...options, force: true }, {
        worker: candidateWorker
      }),
      /battle-art candidate lock path contains a symbolic-link component|must be a regular non-symlink file/
    );
  });

  it('rejects manifest and family lock paths that alias the same inode', async () => {
    const root = await fixture();
    const candidateLock = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest/.locks/'
        + 'forest-moss-surface.lock'
    );
    const manifestLock = path.join(
      root,
      'ai-image-metadata/battle-art/.locks/manifest.lock'
    );
    await mkdir(path.dirname(candidateLock), { recursive: true });
    await mkdir(path.dirname(manifestLock), { recursive: true });
    await writeFile(candidateLock, '');
    await link(candidateLock, manifestLock);
    await assert.rejects(
      withBattleArtManifestAndCandidateLock({
        root,
        theme: 'forest',
        family: 'forest-moss-surface'
      }, async () => {}),
      /must resolve to unique files/
    );
  });

  it('rejects undeclared worker outputs from the disposable workspace', async () => {
    const root = await fixture();
    const worker = async input => {
      const result = await candidateWorker(input);
      await writeFile(path.join(input.workspace, 'approval.json'), '{}');
      return result;
    };
    await assert.rejects(
      generateBattleArt({
        projectRoot: root,
        theme: 'forest',
        family: 'forest-moss-surface',
        concurrency: 2,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, { worker }),
      /undeclared output approval\.json/
    );
  });

  it('rejects an oversized last message before publishing diagnostics', async () => {
    const root = await fixture();
    const worker = async input => {
      const result = await candidateWorker(input);
      await writeFile(
        path.join(input.workspace, 'last-message.txt'),
        Buffer.alloc(MAX_WORKER_OUTPUT_BYTES + 1, 65)
      );
      return result;
    };
    await assert.rejects(
      generateBattleArt({
        projectRoot: root,
        theme: 'forest',
        family: 'forest-moss-surface',
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, { worker }),
      /last-message\.txt exceeds worker log limit/
    );
    const rejectedRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest/forest-moss-surface'
    );
    await assert.rejects(
      readFile(path.join(rejectedRoot, 'last-message.txt')),
      error => error.code === 'ENOENT'
    );
    await assert.rejects(
      readFile(path.join(rejectedRoot, 'result.json')),
      error => error.code === 'ENOENT'
    );
  });

  it('rejects workers that report zero or multiple imagegen calls', async () => {
    for (const calls of [0, 2]) {
      const root = await fixture();
      const worker = async input => {
        const result = await candidateWorker(input);
        result.stdout = Buffer.from(Array.from({ length: calls }, (_, index) => (
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: `imagegen-${index}`,
              type: 'mcp_tool_call',
              server: 'image_gen',
              tool: 'imagegen'
            }
          })
        )).join('\n') + (calls ? '\n' : ''));
        return result;
      };
      await assert.rejects(
        generateBattleArt({
          projectRoot: root,
          theme: 'forest',
          family: 'forest-moss-surface',
          concurrency: 2,
          timeoutMs: 10_000,
          dryRun: false,
          force: false,
          resume: false
        }, { worker }),
        new RegExp(`call imagegen exactly once; observed ${calls}`)
      );
      const rejectedRoot =
        path.join(root, 'ai-image-metadata/battle-art/candidates/forest/forest-moss-surface');
      assert.match(await readFile(path.join(rejectedRoot, 'prompt.txt'), 'utf8'), /imagegen/);
      assert.equal(
        (await readFile(path.join(rejectedRoot, 'worker.jsonl'), 'utf8'))
          .split(/\r?\n/).filter(Boolean).length,
        calls
      );
      await assert.rejects(
        readFile(path.join(rejectedRoot, 'candidate.png')),
        error => error.code === 'ENOENT'
      );
      await assert.rejects(
        readFile(path.join(rejectedRoot, 'result.json')),
        error => error.code === 'ENOENT'
      );
    }
  });

  it('pins explicit review before deterministic lossless compilation', async () => {
    const root = await fixture();
    const family = 'forest-moss-surface';
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 2,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });

    await approveCandidate({
      root,
      theme: 'forest',
      family,
      reviewer: 'reviewer@example.test',
      decision: 'approved',
      approvedAt: '2026-07-30T12:00:00.000Z'
    });
    let loaded = await loadBattleArt(root);
    let descriptor = loaded.descriptors.find(entry => entry.descriptor.id === family).descriptor;
    assert.equal(descriptor.status, 'approved');
    assert.equal(descriptor.source.reviewer, 'reviewer@example.test');
    assert.equal(descriptor.content.sourceSha256, descriptor.source.imageSha256);
    assert.equal(descriptor.content.runtimeSha256, null);
    assert.match(
      descriptor.source.imagePath,
      new RegExp(
        '^ai-image-metadata/battle-art/sources/forest/forest-moss-surface/'
          + `v${descriptor.content.version}/[0-9a-f]{64}\\.png$`
      )
    );
    assert.equal((await readJson(root, BUNDLE_PATH)).value.assets.length, 0);
    await assert.rejects(
      generateBattleArt({
        ...{
          projectRoot: root,
          theme: 'forest',
          family,
          concurrency: 1,
          timeoutMs: 10_000,
          dryRun: false,
          force: true,
          resume: false
        }
      }, { worker: candidateWorker }),
      /is approved/
    );
    await assert.rejects(
      approveCandidate({
        root,
        theme: 'forest',
        family,
        reviewer: 'reviewer@example.test',
        decision: 'approved'
      }),
      /only draft families/
    );
    await assert.rejects(
      writeDraft({
        root,
        theme: 'forest',
        category: 'surface',
        id: family,
        width: 256,
        height: 128,
        force: true
      }),
      /released and cannot be overwritten/
    );
    await rm(path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest/forest-moss-surface'
    ), { recursive: true, force: true });

    const compiled = await compileApproved({ root });
    assert.equal(compiled.compiled, 1);
    loaded = await loadBattleArt(root);
    descriptor = loaded.descriptors.find(entry => entry.descriptor.id === family).descriptor;
    assert.equal(descriptor.status, 'compiled');
    assert.match(
      descriptor.content.immutableUrl,
      /^\/assets\/battle-map-v3\/[^/]+\/v[1-9][0-9]*\/forest\/surface\//
    );

    const outputRelative = `frontend/public${descriptor.content.immutableUrl}`;
    assert.equal(await hashFile(path.join(root, outputRelative)), descriptor.content.runtimeSha256);
    const metadata = await sharp(path.join(root, outputRelative)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, descriptor.canvas.width);
    assert.equal(metadata.height, descriptor.canvas.height);
    assert.equal(metadata.hasAlpha, true);

    const bundle = (await readJson(root, BUNDLE_PATH)).value;
    assert.deepEqual(bundle.assets[0], {
      key: 'forest-moss-surface',
      contentVersion: descriptor.content.version,
      contentHash: descriptor.content.runtimeSha256,
      immutableUrl: descriptor.content.immutableUrl
    });
    assert.equal(bundle.renderers[0].pivot.x, descriptor.placement.pivot.x);
    const tamperedRenderer = structuredClone(bundle);
    tamperedRenderer.renderers[0].pivot.x += 1;
    assert.notEqual(
      await computeBattleArtRendererManifestFullHash(tamperedRenderer),
      bundle.rendererManifestFullHash
    );
    assert.deepEqual((await readJson(root, FRONTEND_BUNDLE_PATH)).value, bundle);
    assert.equal(
      (await readJson(root, INVENTORY_PATH)).value.families.length,
      loaded.descriptors.length
    );
    await compileApproved({ root, check: true });
  });

  it('archives a complete immutable bundle and rejects identity replacement', async () => {
    const root = await fixture();
    const loaded = await loadBattleArt(root);
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      concurrency: 2,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    for (const entry of loaded.descriptors) {
      await approveCandidate({
        root,
        theme: entry.descriptor.theme,
        family: entry.descriptor.id,
        reviewer: 'release-reviewer@example.test',
        decision: 'approved',
        approvedAt: '2026-07-30T12:00:00.000Z'
      });
    }
    await compileApproved({ root });
    const currentBundle = (await readJson(root, BUNDLE_PATH)).value;
    const releasePath =
      `ai-image-metadata/battle-art/releases/${currentBundle.id}`
      + `.v${currentBundle.version}.json`;
    const orphanBytes = Buffer.from('divergent orphan archive bytes\n');
    await mkdir(path.dirname(path.join(root, releasePath)), { recursive: true });
    await writeFile(path.join(root, releasePath), orphanBytes);
    await assert.rejects(
      archiveCurrentRelease({ root }),
      /EEXIST|already exists/
    );
    assert.deepEqual(await readFile(path.join(root, releasePath)), orphanBytes);
    assert.deepEqual(
      (await readJson(root, 'ai-image-metadata/battle-art/manifest.json'))
        .value.historicalReleases,
      []
    );
    await rm(path.join(root, releasePath));
    await assert.rejects(
      writeDraft({
        root,
        theme: 'forest',
        category: 'connection-stairs',
        id: 'forest-slope-transition'
      }),
      /has no immutable release archive/
    );
    const archived = await archiveCurrentRelease({ root });
    assert.equal(archived.assets, loaded.descriptors.length);
    const manifest = (await readJson(
      root,
      'ai-image-metadata/battle-art/manifest.json'
    )).value;
    assert.deepEqual(manifest.historicalReleases, [archived.release]);
    const inventory = (await readJson(root, INVENTORY_PATH)).value;
    assert.deepEqual(inventory.historicalReleases, [archived.release]);
    const registry = (await readJson(root, BUNDLE_REGISTRY_PATH)).value;
    assert.equal(registry.bundles.length, 1);
    await assert.rejects(
      archiveCurrentRelease({ root }),
      /already archived/
    );
    const family = loaded.descriptors[0].descriptor;
    let releaseRevision;
    let signalRevision;
    const revisionBlocked = new Promise(resolve => {
      signalRevision = resolve;
    });
    const revisionRelease = new Promise(resolve => {
      releaseRevision = resolve;
    });
    const revision = reviseFamily({
      root,
      theme: family.theme,
      family: family.id
    }, {
      beforeCommit: async () => {
        signalRevision();
        await revisionRelease;
      }
    });
    await revisionBlocked;

    let additionEntered = false;
    const addition = writeDraft({
      root,
      theme: 'forest',
      category: 'connection-stairs',
      id: 'forest-slope-transition'
    }, {
      beforeDescriptorWrite: async () => {
        additionEntered = true;
      }
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const additionEnteredWhileRevisionHeld = additionEntered;
    releaseRevision();
    const [revised, added] = await Promise.all([revision, addition]);
    assert.equal(
      additionEnteredWhileRevisionHeld,
      false,
      'new-family addition must wait for the revision manifest transaction'
    );
    assert.equal(added.releaseVersion, loaded.manifest.version + 1);
    const manifestAfterAddition = (await readJson(
      root,
      'ai-image-metadata/battle-art/manifest.json'
    )).value;
    assert.equal(manifestAfterAddition.version, loaded.manifest.version + 1);
    assert.ok(manifestAfterAddition.descriptors.includes(added.descriptor));
    assert.equal(revised.releaseVersion, loaded.manifest.version + 1);
    assert.equal(revised.contentVersion, family.content.version + 1);
    const afterRevision = await loadBattleArt(root);
    assert.equal(
      afterRevision.descriptors.find(
        candidate => candidate.descriptor.id === family.id
      ).descriptor.status,
      'draft'
    );
  });

  it('resolves only exact immutable runtime bundle releases across revisions', () => {
    const bundle = (version, manifestFullHash) => ({
      schemaVersion: 'battle-art-runtime-bundle-v1',
      id: 'bundle-history',
      version,
      manifestFullHash,
      assets: [{ key: `asset-v${version}` }],
      renderers: [{ id: `asset-v${version}` }]
    });
    const v1 = bundle(1, `sha256:${'1'.repeat(64)}`);
    const v2 = bundle(2, `sha256:${'2'.repeat(64)}`);
    const v3 = bundle(3, `sha256:${'3'.repeat(64)}`);
    const release = value => ({
      path: `ai-image-metadata/battle-art/releases/${value.id}.v${value.version}.json`,
      release: { bundle: value }
    });
    const history = [release(v1), release(v2)];
    const registry = buildBundleRegistry(history, v2);

    assert.deepEqual(
      resolveArchivedRuntimeBundle(history, registry, {
        id: v1.id,
        version: v1.version,
        manifestFullHash: v1.manifestFullHash
      }),
      { path: release(v1).path, bundle: v1 }
    );
    assert.deepEqual(
      resolveArchivedRuntimeBundle(history, registry, {
        id: v2.id,
        version: v2.version,
        manifestFullHash: v2.manifestFullHash
      }),
      { path: release(v2).path, bundle: v2 }
    );

    const unarchivedRegistry = buildBundleRegistry([release(v1)], v2);
    assert.throws(
      () => resolveArchivedRuntimeBundle([release(v1)], unarchivedRegistry, {
        id: v2.id,
        version: v2.version,
        manifestFullHash: v2.manifestFullHash
      }),
      /has no immutable release archive/
    );

    const replacedCurrentRegistry = buildBundleRegistry(history, v3);
    assert.deepEqual(
      resolveArchivedRuntimeBundle(history, replacedCurrentRegistry, {
        id: v1.id,
        version: v1.version,
        manifestFullHash: v1.manifestFullHash
      }).bundle,
      v1
    );
    assert.throws(
      () => resolveArchivedRuntimeBundle(history, replacedCurrentRegistry, {
        id: v3.id,
        version: v3.version,
        manifestFullHash: v3.manifestFullHash
      }),
      /has no immutable release archive/
    );
  });
});
