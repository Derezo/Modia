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
  readdir,
  rename,
  rm,
  symlink,
  unlink,
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
  COMPILED_SOURCE_ATTESTATION_SCHEMA,
  CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH,
  FRONTEND_BUNDLE_PATH,
  FRONTEND_BUNDLE_REGISTRY_PATH,
  INVENTORY_PATH,
  LEGACY_EVIDENCE_REGISTRY_PATH,
  READINESS_PLAN_PATH,
  RENDER_PROFILE,
  REVALIDATED_CANDIDATE_SCHEMA,
  REVALIDATED_REVIEW_SCHEMA,
  REVIEW_SCHEMA,
  THEMES,
  approveCandidate,
  archiveCurrentRelease,
  assertAllowlistedLegacyCandidate,
  assertDescriptor,
  assertReviewRecord,
  auditBattleArt,
  auditBattleArtReviews,
  buildBundle,
  buildBundleRegistry,
  buildInventory,
  candidatePaths,
  checkBattleArt,
  compileApproved,
  computeBattleArtRendererManifestFullHash,
  draftDescriptor,
  hashFile,
  generatedArtifactPath,
  loadBattleArt,
  inspectImageContents,
  prepareDirectRouteCandidate,
  readJson,
  recordCandidateReview,
  resolveArchivedRuntimeBundle,
  reviseFamily,
  sha256,
  stableJson,
  styleReferenceProvenance,
  toCompilerAssetBundle,
  verifyCandidateRouteDerivation,
  writeDraft,
  writePreview
} from './lifecycle.mjs';
import {
  CANONICAL_ROUTE_SKILL_READ_COMMAND,
  CODEX_WORKER_ENV_KEYS,
  MAX_WORKER_OUTPUT_BYTES,
  assertCornerEsAnchorArchPlacement,
  assertNoProceduralRasterSynthesis,
  assertRouteArmMinimumCoreWidth,
  assertRouteCornerMaximumCoverage,
  assertRouteCornerMinimumCoreWidth,
  assertRouteStraightMaximumCoverage,
  assertRouteStraightMaximumLongitudinalExtent,
  assertRouteTransitionCanvasBorderClear,
  assertSingleGeneratedArtifactCopyEvidence,
  auditCorrectiveStyleReferenceForGeneration,
  auditFailedRouteAttempt,
  backfillFailedRouteAttempt,
  buildCodexArgs,
  buildCodexWorkerEnvironment,
  buildGenerationPrompt,
  countImagegenInvocations,
  generateBattleArt,
  parseGenerateArgs,
  revalidateFailedRouteAttempt,
  runCommand
} from './generate.mjs';
import {
  finishRouteArtifact
} from './finish-route-artifact.mjs';
import {
  normalizeCandidates
} from './normalize.mjs';
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

async function fixture({
  plannedDrafts = [],
  excludedFamilies = [],
  preserveDirectStyleProvenance = false
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'modia-battle-art-'));
  temporaryRoots.push(root);
  const battleArtRoot = path.join(root, 'ai-image-metadata/battle-art');
  await mkdir(battleArtRoot, { recursive: true });
  await copyFile(
    path.join(REPOSITORY_ROOT, 'ai-image-metadata/battle-art/manifest.json'),
    path.join(battleArtRoot, 'manifest.json')
  );
  await copyFile(
    path.join(REPOSITORY_ROOT, CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH),
    path.join(root, CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH)
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
  const manifest = (await readJson(
    root,
    'ai-image-metadata/battle-art/manifest.json'
  )).value;
  const directReferences = manifest.styleReferences.filter(reference => (
    reference.path.startsWith('ai-image-metadata/battle-art/sources/')
  ));
  const directGeometryPrimeReferenceIds = new Set();
  for (const descriptorRelative of manifest.descriptors) {
    const descriptor = (await readJson(root, descriptorRelative)).value;
    if (descriptor.directGeometryPrime?.sourceReferenceId !== undefined) {
      directGeometryPrimeReferenceIds.add(
        descriptor.directGeometryPrime.sourceReferenceId
      );
    }
  }
  const directOwnerIds = new Set(directReferences.map(reference => (
    reference.path.split('/')[4]
  )));
  if (!preserveDirectStyleProvenance) {
    manifest.styleReferences = manifest.styleReferences.filter(reference => (
      !reference.path.startsWith('ai-image-metadata/battle-art/sources/')
      || directGeometryPrimeReferenceIds.has(reference.id)
    ));
  }
  for (const reference of manifest.styleReferences) {
    await mkdir(path.dirname(path.join(root, reference.path)), {
      recursive: true
    });
    await copyFile(
      path.join(REPOSITORY_ROOT, reference.path),
      path.join(root, reference.path)
    );
  }
  const correctiveRegistry = (await readJson(
    root,
    CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH
  )).value;
  for (const entry of correctiveRegistry.entries) {
    await mkdir(path.dirname(path.join(root, entry.failureRecord.path)), {
      recursive: true
    });
    await copyFile(
      path.join(REPOSITORY_ROOT, entry.failureRecord.path),
      path.join(root, entry.failureRecord.path)
    );
  }
  const requiredDirectGeometryPrimeOwnerIds = new Set(
    directReferences
      .filter(reference => (
        directGeometryPrimeReferenceIds.has(reference.id)
      ))
      .map(reference => reference.path.split('/')[4])
  );
  const provenanceOwnerIds = preserveDirectStyleProvenance
    ? directOwnerIds
    : requiredDirectGeometryPrimeOwnerIds;
  const compiledAttestationOwnerIds = new Set();
  if (provenanceOwnerIds.size > 0) {
    for (const family of provenanceOwnerIds) {
      const descriptorRelative = manifest.descriptors.find(relative => (
        path.basename(relative, '.json') === family
      ));
      const ownerDescriptor = (await readJson(
        REPOSITORY_ROOT,
        descriptorRelative
      )).value;
      const currentReviewRelative =
        `ai-image-metadata/battle-art/reviews/${ownerDescriptor.theme}/`
        + `${family}/`
        + `${ownerDescriptor.source.imageSha256.slice('sha256:'.length)}.json`;
      const currentReview = (await readJson(
        REPOSITORY_ROOT,
        currentReviewRelative
      )).value;
      if (
        currentReview.schemaVersion
          === COMPILED_SOURCE_ATTESTATION_SCHEMA
      ) {
        compiledAttestationOwnerIds.add(family);
      }
      await mkdir(
        path.join(root, 'ai-image-metadata/battle-art/reviews/forest'),
        { recursive: true }
      );
      await cp(
        path.join(
          REPOSITORY_ROOT,
          'ai-image-metadata/battle-art/reviews/forest',
          family
        ),
        path.join(
          root,
          'ai-image-metadata/battle-art/reviews/forest',
          family
        ),
        { recursive: true }
      );
      if (compiledAttestationOwnerIds.has(family)) {
        const runtimeRelative =
          `frontend/public${ownerDescriptor.content.immutableUrl}`;
        await mkdir(path.dirname(path.join(root, runtimeRelative)), {
          recursive: true
        });
        await copyFile(
          path.join(REPOSITORY_ROOT, runtimeRelative),
          path.join(root, runtimeRelative)
        );
      }
      await mkdir(
        path.join(root, 'ai-image-metadata/battle-art/candidates/forest'),
        { recursive: true }
      );
      await cp(
        path.join(
          REPOSITORY_ROOT,
          'ai-image-metadata/battle-art/candidates/forest',
          family
        ),
        path.join(
          root,
          'ai-image-metadata/battle-art/candidates/forest',
          family
        ),
        { recursive: true }
      );
    }
  }
  const excludedDescriptorPaths = manifest.descriptors.filter(
    descriptorRelative => excludedFamilies.includes(
      path.basename(descriptorRelative, '.json')
    )
  );
  manifest.descriptors = manifest.descriptors.filter(
    descriptorRelative => !excludedDescriptorPaths.includes(descriptorRelative)
  );
  await Promise.all(excludedDescriptorPaths.map(
    descriptorRelative => rm(path.join(root, descriptorRelative))
  ));
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
    const preserveCurrentDescriptor =
      requiredDirectGeometryPrimeOwnerIds.has(descriptor.id)
      || (
        preserveDirectStyleProvenance
        && directOwnerIds.has(descriptor.id)
      );
    const preserveDescriptorStyleReferences =
      preserveCurrentDescriptor
      || descriptor.directGeometryPrime !== undefined;
    const draft = preserveCurrentDescriptor
      ? compiledAttestationOwnerIds.has(descriptor.id)
        ? descriptor
        : {
            ...descriptor,
            status: 'approved',
            content: {
              ...descriptor.content,
              runtimeSha256: null,
              immutableUrl: null
            }
          }
      : {
          ...descriptor,
          status: 'draft',
          styleReferences: structuredClone(
            preserveDescriptorStyleReferences
              ? descriptor.styleReferences
              : manifest.styleReferences.slice(0, 1)
          ),
          content: {
            ...descriptor.content,
            sourceSha256: null,
            runtimeSha256: null,
            immutableUrl: null
          },
          source: null
        };
    if (draft.source !== null) {
      await mkdir(path.dirname(path.join(root, draft.source.imagePath)), {
        recursive: true
      });
      await copyFile(
        path.join(REPOSITORY_ROOT, draft.source.imagePath),
        path.join(root, draft.source.imagePath)
      );
    }
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

async function addSyntheticStyleReference(root, familyId) {
  const manifestPath = 'ai-image-metadata/battle-art/manifest.json';
  const manifest = (await readJson(root, manifestPath)).value;
  const source = manifest.styleReferences[0];
  const reference = {
    id: 'forest-source-template-02',
    path:
      'ai-image-metadata/battle-maps/sources/forest/'
      + 'forest-template-02/reference.png',
    sha256: source.sha256
  };
  await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
  await copyFile(path.join(root, source.path), path.join(root, reference.path));
  manifest.styleReferences.push(reference);
  await writeFile(path.join(root, manifestPath), stableJson(manifest));
  const descriptorRelative = manifest.descriptors.find(relative => (
    path.basename(relative, '.json') === familyId
  ));
  const descriptor = (await readJson(root, descriptorRelative)).value;
  descriptor.styleReferences.push(reference);
  await writeFile(path.join(root, descriptorRelative), stableJson(descriptor));
  return reference;
}

async function copyTrackedReview(root, reviewRelative) {
  await mkdir(path.dirname(path.join(root, reviewRelative)), { recursive: true });
  await copyFile(
    path.join(REPOSITORY_ROOT, reviewRelative),
    path.join(root, reviewRelative)
  );
  return (await readJson(root, reviewRelative)).value;
}

async function retainTrackedApprovedV1Evidence(root, familyId) {
  const descriptorRelative =
    `ai-image-metadata/battle-art/descriptors/forest/${familyId}.json`;
  const descriptor = (await readJson(REPOSITORY_ROOT, descriptorRelative)).value;
  await writeFile(
    path.join(root, descriptorRelative),
    stableJson(descriptor)
  );
  await mkdir(
    path.dirname(path.join(root, descriptor.source.imagePath)),
    { recursive: true }
  );
  await copyFile(
    path.join(REPOSITORY_ROOT, descriptor.source.imagePath),
    path.join(root, descriptor.source.imagePath)
  );
  if (descriptor.status === 'compiled') {
    const runtimeRelative =
      `frontend/public${descriptor.content.immutableUrl}`;
    await mkdir(path.dirname(path.join(root, runtimeRelative)), {
      recursive: true
    });
    await copyFile(
      path.join(REPOSITORY_ROOT, runtimeRelative),
      path.join(root, runtimeRelative)
    );
  }
  const candidateRelative =
    `ai-image-metadata/battle-art/candidates/forest/${familyId}`;
  await cp(
    path.join(REPOSITORY_ROOT, candidateRelative),
    path.join(root, candidateRelative),
    { recursive: true }
  );
  const reviewRelative =
    `ai-image-metadata/battle-art/reviews/forest/${familyId}/`
    + `${descriptor.source.imageSha256.slice('sha256:'.length)}.json`;
  const review = await copyTrackedReview(root, reviewRelative);
  return { descriptorRelative, descriptor, reviewRelative, review };
}

async function candidateWorker({ workspace, descriptor, styleFiles = [] }) {
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
              distanceToSegment(x, y, anchor, routeSides[direction]) <= 15
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
  let environmentSource;
  const stdout = descriptor.category === 'route-transition'
    ? await (async () => {
        const codexHome = await mkdtemp(path.join(
          tmpdir(),
          'modia-codex-worker-'
        ));
        temporaryRoots.push(codexHome);
        const threadId = 'route-fixture-thread';
        const artifactRoot = path.join(
          codexHome,
          'generated_images',
          threadId
        );
        await mkdir(artifactRoot, { recursive: true });
        const artifactPath = path.join(
          artifactRoot,
          'call_RouteFixture.png'
        );
        await copyFile(
          path.join(workspace, 'candidate.png'),
          artifactPath
        );
        environmentSource = { CODEX_HOME: codexHome };
        return Buffer.from([
          JSON.stringify({
            type: 'thread.started',
            thread_id: threadId
          }),
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'route-skill-read',
              type: 'command_execution',
              command:
                `/bin/bash -lc '${CANONICAL_ROUTE_SKILL_READ_COMMAND}'`,
              status: 'completed',
              exit_code: 0
            }
          }),
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'imagegen-1',
              type: 'mcp_tool_call',
              server: 'image_gen',
              tool: 'imagegen',
              status: 'completed'
            }
          }),
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'route-artifact-copy',
              type: 'command_execution',
              command: `/bin/cp ${artifactPath} candidate.png`,
              status: 'completed',
              exit_code: 0
            }
          })
        ].join('\n') + '\n');
      })()
    : Buffer.from(
        '{"type":"item.completed","item":{"id":"imagegen-1","type":"mcp_tool_call",'
        + '"server":"image_gen","tool":"imagegen"}}\n'
      );
  return {
    stdout,
    stderr: Buffer.alloc(0),
    environmentSource,
    args: buildCodexArgs(
      workspace,
      path.join(workspace, 'last-message.txt'),
      styleFiles.map(file => path.join(workspace, file))
    )
  };
}

async function replaceRouteWorkerCandidate({ workspace, result, bytes }) {
  const { artifactPath } = assertSingleGeneratedArtifactCopyEvidence(
    result.stdout
  );
  await Promise.all([
    writeFile(path.join(workspace, 'candidate.png'), bytes),
    writeFile(artifactPath, bytes)
  ]);
}

const HEARTLANDS_STRAIGHT_EW_REFERENCE =
  'ai-image-metadata/battle-art/sources/forest/'
  + 'forest-heartlands-loam-path-straight-ew/v1/'
  + 'c1e441f91c71349b3e49e1319a51af80bf69433ada4f74d8aa838e0be94abaf3.png';
const HEARTLANDS_STRAIGHT_NS_V11_PINCHED_RAW =
  'ai-image-metadata/battle-art/generated-artifacts/forest/'
  + 'forest-heartlands-loam-path-straight-ns/'
  + 'b4d67eb73e265a7f32c7eb0864f5725bfa7e14c71d05fef4f30d631244c40342.png';
const HEARTLANDS_STRAIGHT_NS_V12_OVERLONG_RAW =
  'ai-image-metadata/battle-art/generated-artifacts/forest/'
  + 'forest-heartlands-loam-path-straight-ns/'
  + 'f78da18c496ff17a1e065a9eff5edd9d9105d8b2e2bdd1946be7501e9fa6ca51.png';
const HEARTLANDS_STRAIGHT_NS_V13_APPROVED_RAW =
  'ai-image-metadata/battle-art/generated-artifacts/forest/'
  + 'forest-heartlands-loam-path-straight-ns/'
  + 'e02c939002b6463dc62bd03f1ca338c90009337e3eccded120bdd750154d14a2.png';
const HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE =
  'ai-image-metadata/battle-art/generated-artifacts/forest/'
  + 'forest-heartlands-loam-path-corner-es/failures/'
  + '04ff0d33d42588c5f231dc1b9a0b9e717bbfa8d8b2b2f847a8f3f2773c30b0cd.json';
async function copyFailedAttemptEvidence(root, failureRelative) {
  const record = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, failureRelative),
    'utf8'
  ));
  for (const relative of [failureRelative, record.raw.path]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await copyFile(
      path.join(REPOSITORY_ROOT, relative),
      path.join(root, relative)
    );
  }
  return record;
}

async function syntheticRevalidatableCornerEsFailure(root, {
  upperCorePixel = null
} = {}) {
  const record = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE),
    'utf8'
  ));
  const descriptor = (await readJson(root, record.descriptor.path)).value;
  const primeReference = descriptor.styleReferences.find(reference => (
    reference.id === descriptor.directGeometryPrime.sourceReferenceId
  ));
  const decoded = await sharp(path.join(root, primeReference.path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const data = Buffer.from(decoded.data);
  const anchor = descriptor.placement.anchor;
  for (const endpoint of [{ x: 192, y: 96 }, { x: 64, y: 96 }]) {
    const dx = endpoint.x - anchor.x;
    const dy = endpoint.y - anchor.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    for (let y = 0; y < decoded.info.height; y += 1) {
      for (let x = 0; x < decoded.info.width; x += 1) {
        const projection = (
          ((x - anchor.x) * dx) + ((y - anchor.y) * dy)
        ) / lengthSquared;
        if (projection < 0.35 || projection > 1.08) continue;
        const centerX = anchor.x + (projection * dx);
        const centerY = anchor.y + (projection * dy);
        if (Math.hypot(x - centerX, y - centerY) > 15) continue;
        data.set(
          [117, 76, 36, 255],
          ((y * decoded.info.width) + x) * 4
        );
      }
    }
  }
  if (upperCorePixel !== null) {
    data.set(
      [117, 76, 36, 255],
      ((upperCorePixel.y * decoded.info.width) + upperCorePixel.x) * 4
    );
  }
  const rawBytes = await sharp(data, {
    raw: {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: 4
    }
  }).png().toBuffer();
  const rawIdentity = await inspectImageContents('synthetic.png', rawBytes);
  record.raw = {
    ...rawIdentity,
    path: generatedArtifactPath(record.descriptor.snapshot, rawIdentity)
  };
  record.rejection = {
    name: 'Error',
    message:
      'synthetic historical contract rejected this otherwise immutable raw'
  };
  const { fullHash: _fullHash, ...projection } = record;
  record.fullHash = sha256(Buffer.from(stableJson(projection)));
  const failureRelative =
    `${path.posix.dirname(record.raw.path)}/failures/`
    + `${record.fullHash.slice('sha256:'.length)}.json`;
  for (const [relative, contents] of [
    [record.raw.path, rawBytes],
    [failureRelative, Buffer.from(stableJson(record))]
  ]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), contents);
  }
  return { path: failureRelative, record, rawBytes };
}

async function reflectedHeartlandsStraightNs({
  maximumCenterlineDistance = null
} = {}) {
  const reflected = sharp(
    await readFile(path.join(
      REPOSITORY_ROOT,
      HEARTLANDS_STRAIGHT_EW_REFERENCE
    ))
  ).flip().ensureAlpha();
  if (maximumCenterlineDistance === null) {
    return reflected.png().toBuffer();
  }
  const { data, info } = await reflected.raw().toBuffer({
    resolveWithObject: true
  });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const distance = Math.abs(x + (2 * y) - 255.5) / Math.sqrt(5);
      if (distance <= maximumCenterlineDistance) continue;
      data[(((y * info.width) + x) * 4) + 3] = 0;
    }
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  }).png().toBuffer();
}

async function directStraightNsCandidate({
  halfWidth = 15,
  terminalExtensionPixels = 6
} = {}) {
  const width = 256;
  const height = 128;
  const anchor = { x: 128, y: 64 };
  const armUnit = {
    x: 2 / Math.sqrt(5),
    y: -1 / Math.sqrt(5)
  };
  const perpendicularUnit = {
    x: 1 / Math.sqrt(5),
    y: 2 / Math.sqrt(5)
  };
  const terminalDistance = Math.hypot(64, 32);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const delta = { x: x - anchor.x, y: y - anchor.y };
      const longitudinal =
        (delta.x * armUnit.x) + (delta.y * armUnit.y);
      const perpendicular = Math.abs(
        (delta.x * perpendicularUnit.x)
          + (delta.y * perpendicularUnit.y)
      );
      if (
        Math.abs(longitudinal)
          > terminalDistance + terminalExtensionPixels
        || perpendicular > halfWidth
      ) {
        continue;
      }
      pixels.set([117, 76, 36, 255], ((y * width) + x) * 4);
    }
  }
  return sharp(pixels, {
    raw: { width, height, channels: 4 }
  }).png().toBuffer();
}

async function addForbiddenEastArm(bytes, radius = 3) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const start = { x: 128, y: 64 };
  const end = { x: 220, y: 110 };
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (distanceToSegment(x, y, start, end) > radius) continue;
      data.set(
        [117, 76, 36, 255],
        ((y * info.width) + x) * 4
      );
    }
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  }).png().toBuffer();
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('battle-art tracked contracts', () => {
  it('keeps the historical corrective reference auditable without activating it on the live descriptor',
    async () => {
      const loaded = await loadBattleArt(REPOSITORY_ROOT);
      const liveDescriptor = loaded.descriptors.find(({ descriptor: value }) => (
        value.id === 'forest-heartlands-loam-path-straight-ns'
      )).descriptor;
      const corrective = loaded.manifest.styleReferences.find(reference => (
        reference.id === 'forest-heartlands-rejected-route-straight-ns-v7'
      ));
      assert.deepEqual(
        liveDescriptor.styleReferences.map(reference => reference.id),
        [
          'forest-source-template-01',
          'forest-heartlands-approved-route-straight-ew-v1'
        ]
      );
      const descriptor = {
        ...structuredClone(liveDescriptor),
        status: 'draft',
        styleReferences: [
          ...structuredClone(liveDescriptor.styleReferences),
          structuredClone(corrective)
        ],
        content: {
          ...structuredClone(liveDescriptor.content),
          sourceSha256: null,
          runtimeSha256: null,
          immutableUrl: null
        },
        source: null
      };
      assert.equal(
        corrective.id,
        'forest-heartlands-rejected-route-straight-ns-v7'
      );
      const result = await auditCorrectiveStyleReferenceForGeneration({
        root: REPOSITORY_ROOT,
        descriptor,
        pin: corrective
      });
      assert.equal(
        result.audit.record.fullHash,
        'sha256:085119648741161655dc241fca9c5cf91881b2021176ec5fbbf0ec35beeac66e'
      );
      assert.equal(result.audit.record.theme, descriptor.theme);
      assert.equal(result.audit.record.familyId, descriptor.id);
      assert.equal(result.audit.record.raw.path, corrective.path);
      assert.equal(result.audit.record.raw.sha256, corrective.sha256);
      assert.equal(result.audit.record.audit.imagegen.invocationCount, 1);

      const root = await fixture({ preserveDirectStyleProvenance: true });
      const descriptorRelative =
        'ai-image-metadata/battle-art/descriptors/forest/'
        + 'forest-heartlands-loam-path-straight-ns.json';
      await writeFile(
        path.join(root, descriptorRelative),
        stableJson(descriptor)
      );
      let workerCalls = 0;
      await assert.rejects(
        generateBattleArt({
          projectRoot: root,
          theme: 'forest',
          family: descriptor.id,
          concurrency: 1,
          timeoutMs: 10_000,
          dryRun: false,
          force: false,
          resume: false
        }, {
          worker: async ({ styleFiles }) => {
            workerCalls += 1;
            assert.equal(styleFiles.length, 3);
            throw new Error('fresh corrective staging reached worker');
          }
        }),
        /fresh corrective staging reached worker/
      );
      assert.equal(workerCalls, 1);
    });

  it('keeps generated artifacts outside ordinary style pins and binds the corrective pin to its exact evidence and consumer',
    async () => {
      const arbitraryRoot = await fixture();
      const arbitraryManifest = (await readJson(
        arbitraryRoot,
        'ai-image-metadata/battle-art/manifest.json'
      )).value;
      const corrective = arbitraryManifest.styleReferences.at(-1);
      arbitraryManifest.styleReferences.push({
        ...corrective,
        id: 'forest-heartlands-unregistered-generated-reference'
      });
      await writeFile(
        path.join(arbitraryRoot, 'ai-image-metadata/battle-art/manifest.json'),
        stableJson(arbitraryManifest)
      );
      await assert.rejects(
        loadBattleArt(arbitraryRoot),
        /outside its allowlisted directory/
      );

      const missingRoot = await fixture();
      const registry = (await readJson(
        missingRoot,
        CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH
      )).value;
      await rm(path.join(missingRoot, registry.entries[0].failureRecord.path));
      await assert.rejects(
        loadBattleArt(missingRoot),
        error => error.code === 'ENOENT'
      );

      const tamperedRoot = await fixture();
      const failurePath = registry.entries[0].failureRecord.path;
      await writeFile(
        path.join(tamperedRoot, failurePath),
        `${await readFile(path.join(tamperedRoot, failurePath), 'utf8')} `
      );
      await assert.rejects(
        loadBattleArt(tamperedRoot),
        /corrective failure record hash pin mismatch/
      );

      const consumerRoot = await fixture();
      const consumerManifest = (await readJson(
        consumerRoot,
        'ai-image-metadata/battle-art/manifest.json'
      )).value;
      const consumerDescriptorPath = consumerManifest.descriptors.find(
        relative => relative.endsWith('/forest-moss-surface.json')
      );
      const consumerDescriptor = (await readJson(
        consumerRoot,
        consumerDescriptorPath
      )).value;
      consumerDescriptor.styleReferences.push(
        structuredClone(consumerManifest.styleReferences.at(-1))
      );
      await writeFile(
        path.join(consumerRoot, consumerDescriptorPath),
        stableJson(consumerDescriptor)
      );
      await assert.rejects(
        loadBattleArt(consumerRoot),
        /is not authorized for this consumer/
      );

      const loaded = await loadBattleArt(REPOSITORY_ROOT);
      const reorderedManifest = structuredClone(loaded.manifest);
      const correctiveIndex = reorderedManifest.styleReferences.findIndex(
        reference => (
          reference.id
          === 'forest-heartlands-rejected-route-straight-ns-v7'
        )
      );
      const [reorderedCorrective] =
        reorderedManifest.styleReferences.splice(correctiveIndex, 1);
      reorderedManifest.styleReferences.unshift(reorderedCorrective);
      const drafted = draftDescriptor({
        manifest: reorderedManifest,
        theme: 'forest',
        category: 'surface',
        id: 'forest-corrective-baseline-regression'
      });
      assert.deepEqual(
        drafted.styleReferences.map(reference => reference.id),
        ['forest-source-template-01']
      );
      assert.throws(
        () => draftDescriptor({
          manifest: {
            ...reorderedManifest,
            styleReferences: [reorderedCorrective]
          },
          theme: 'forest',
          category: 'surface',
          id: 'forest-missing-baseline-regression'
        }),
        /no baseline template style reference/
      );
    });

  it('audits all themes, required categories, frozen pins, and forest coverage', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const result = await auditBattleArt({ root: REPOSITORY_ROOT });
    assert.equal(loaded.manifest.version, 10);
    assert.equal(loaded.descriptors.length, 102);
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
        plans: 6,
        required: 298,
        present: 298
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

  it('keeps global route exemplars off unrelated drafts and preserves intentional draft refs', async () => {
    const root = await fixture({ preserveDirectStyleProvenance: true });
    await addSyntheticStyleReference(root, 'forest-moss-surface');
    await writeDraft({
      root,
      theme: 'cave',
      category: 'surface',
      id: 'cave-unrelated-surface'
    });
    let loaded = await loadBattleArt(root);
    const unrelated = loaded.descriptors.find(entry => (
      entry.descriptor.id === 'cave-unrelated-surface'
    )).descriptor;
    assert.deepEqual(
      unrelated.styleReferences,
      [loaded.manifest.styleReferences[0]]
    );
    await writeDraft({
      root,
      theme: 'forest',
      category: 'surface',
      id: 'forest-moss-surface',
      width: 256,
      height: 128,
      force: true
    });
    loaded = await loadBattleArt(root);
    assert.deepEqual(
      loaded.descriptors.find(entry => (
        entry.descriptor.id === 'forest-moss-surface'
      )).descriptor.styleReferences,
      [loaded.manifest.styleReferences[0], loaded.manifest.styleReferences.at(-1)]
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
      'battle-art:review',
      'battle-art:approve',
      'battle-art:revise',
      'battle-art:compile',
      'battle-art:archive',
      'battle-art:check',
      'battle-assets:inventory'
    ]) assert.equal(typeof packageJson.scripts[command], 'string', command);
    assert.equal(parseCommand(['audit']).command, 'audit');
    assert.equal(parseCommand(['archive']).command, 'archive');
    assert.deepEqual(
      parseCommand([
        'revalidate-failure',
        '--theme', 'forest',
        '--family', 'forest-heartlands-loam-path-corner-es',
        '--failure', HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE,
        '--project-root', '/tmp/modia-revalidation',
        '--json'
      ]),
      {
        command: 'revalidate-failure',
        options: {
          theme: 'forest',
          family: 'forest-heartlands-loam-path-corner-es',
          failure: HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE,
          root: '/tmp/modia-revalidation',
          json: true
        }
      }
    );
    assert.throws(
      () => parseCommand([
        'revalidate-failure',
        '--theme', 'forest',
        '--family', 'forest-heartlands-loam-path-corner-es',
        '--failure', HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE,
        '--force'
      ]),
      /unknown argument --force/
    );
    assert.equal(
      parseCommand([
        'review',
        '--theme', 'forest',
        '--family', 'forest-moss-surface',
        '--reviewer', 'reviewer@example.test',
        '--decision', 'rejected',
        '--reason', 'The silhouette obscures the required anchor.'
      ]).options.reason,
      'The silhouette obscures the required anchor.'
    );
    assert.equal(
      parseCommand(['revise', '--theme', 'forest', '--family', 'forest-moss-surface']).command,
      'revise'
    );
    assert.equal(parseCommand(['inventory', '--check']).options.check, true);
    assert.throws(
      () => parseCommand(['approve', '--theme', 'forest']),
      /--family is required/
    );
    assert.throws(
      () => parseCommand([
        'approve',
        '--theme', 'forest',
        '--family', 'forest-moss-surface',
        '--reviewer', 'reviewer@example.test',
        '--decision', 'approved'
      ]),
      /--reason is required/
    );
    assert.throws(
      () => parseCommand([
        'review',
        '--theme', 'forest',
        '--family', 'forest-moss-surface',
        '--reviewer', 'reviewer@example.test',
        '--decision', 'rejected',
        '--reason', '   '
      ]),
      /--reason must be/
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
    assert.equal(compiledFamilyIds.length, 102);
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

  it('hash-verifies approved battle-art sources used as direct style references', async () => {
    const root = await fixture({ preserveDirectStyleProvenance: true });
    const reference =
      'ai-image-metadata/battle-art/sources/forest/'
      + 'forest-heartlands-loam-path-corner-ne/v1/'
      + '9c085b05ee5900b4e2c4438efdb56a0af40bd4a5b2d47633290360f7d03f0019.png';
    await writeFile(path.join(root, reference), 'not the pinned approved source');
    await assert.rejects(
      auditBattleArt({ root }),
      /forest-heartlands-approved-route-corner-ne-v1 hash pin mismatch/
    );
  });

  it('audits exact tracked legacy worker evidence without weakening v2 candidates', async () => {
    const reviews = await auditBattleArtReviews({ root: REPOSITORY_ROOT });
    assert.equal(reviews.ok, true);
    assert.ok(reviews.approved > 0);
    assert.ok(reviews.rejected > 0);
  });

  it('requires canonical approved ownership for direct source style pins', async () => {
    const root = await fixture();
    const manifestRelative = 'ai-image-metadata/battle-art/manifest.json';
    const manifest = (await readJson(root, manifestRelative)).value;
    const bytes = Buffer.from('synthetic unreviewed direct style source');
    const digest = sha256(bytes);
    const reference = {
      id: 'unreviewed-direct-style-source',
      path:
        'ai-image-metadata/battle-art/sources/forest/'
        + `unreviewed-direct/v1/${digest.slice('sha256:'.length)}.png`,
      sha256: digest
    };
    await mkdir(path.dirname(path.join(root, reference.path)), { recursive: true });
    await writeFile(path.join(root, reference.path), bytes);
    manifest.styleReferences.push(reference);
    await writeFile(path.join(root, manifestRelative), stableJson(manifest));
    await assert.rejects(
      loadBattleArt(root),
      /no approved descriptor or historical release ownership/
    );
  });

  it('rejects rejected, self-referential, and cyclic current direct-source provenance', async () => {
    const rejectedRoot = await fixture({ preserveDirectStyleProvenance: true });
    const rejectedFamily = 'forest-heartlands-loam-path-corner-ne';
    const rejectedDescriptor = (await readJson(
      rejectedRoot,
      `ai-image-metadata/battle-art/descriptors/forest/${rejectedFamily}.json`
    )).value;
    const rejectedReviewRelative =
      `ai-image-metadata/battle-art/reviews/forest/${rejectedFamily}/`
      + `${rejectedDescriptor.source.imageSha256.slice('sha256:'.length)}.json`;
    const rejectedReview = (await readJson(
      rejectedRoot,
      rejectedReviewRelative
    )).value;
    rejectedReview.schemaVersion = REVIEW_SCHEMA;
    rejectedReview.candidate.styleReferenceMode = 'attachments';
    rejectedReview.candidate.styleReferenceProvenance = styleReferenceProvenance(
      rejectedReview.candidate.styleReferences
    );
    rejectedReview.candidate.worker.imageArguments =
      rejectedReview.candidate.styleReferenceProvenance.map(value => (
        value.stagedBasename
      ));
    rejectedReview.decision = 'rejected';
    const { fullHash: _rejectedHash, ...rejectedProjection } = rejectedReview;
    rejectedReview.fullHash = sha256(Buffer.from(stableJson(rejectedProjection)));
    await writeFile(
      path.join(rejectedRoot, rejectedReviewRelative),
      stableJson(rejectedReview)
    );
    await assert.rejects(
      loadBattleArt(rejectedRoot),
      /no matching immutable approved review/
    );

    const selfRoot = await fixture({ preserveDirectStyleProvenance: true });
    const selfManifest = (await readJson(
      selfRoot,
      'ai-image-metadata/battle-art/manifest.json'
    )).value;
    const selfReference = selfManifest.styleReferences.find(reference => (
      reference.path.includes(`/${rejectedFamily}/`)
    ));
    const selfDescriptorRelative =
      `ai-image-metadata/battle-art/descriptors/forest/${rejectedFamily}.json`;
    const selfDescriptor = (await readJson(
      selfRoot,
      selfDescriptorRelative
    )).value;
    selfDescriptor.styleReferences.push(selfReference);
    await writeFile(
      path.join(selfRoot, selfDescriptorRelative),
      stableJson(selfDescriptor)
    );
    await assert.rejects(
      loadBattleArt(selfRoot),
      /unsafe current self-reference/
    );

    const cycleRoot = await fixture({ preserveDirectStyleProvenance: true });
    const cycleManifest = (await readJson(
      cycleRoot,
      'ai-image-metadata/battle-art/manifest.json'
    )).value;
    const families = [
      'forest-heartlands-loam-path-corner-ne',
      'forest-heartlands-loam-path-straight-ew'
    ];
    const references = families.map(family => (
      cycleManifest.styleReferences.find(reference => (
        reference.path.includes(`/${family}/`)
      ))
    ));
    for (let index = 0; index < families.length; index += 1) {
      const family = families[index];
      const descriptorRelative =
        `ai-image-metadata/battle-art/descriptors/forest/${family}.json`;
      const descriptor = (await readJson(cycleRoot, descriptorRelative)).value;
      descriptor.styleReferences.push(references[1 - index]);
      await writeFile(
        path.join(cycleRoot, descriptorRelative),
        stableJson(descriptor)
      );
      const reviewRelative =
        `ai-image-metadata/battle-art/reviews/forest/${family}/`
        + `${descriptor.source.imageSha256.slice('sha256:'.length)}.json`;
      const review = (await readJson(cycleRoot, reviewRelative)).value;
      review.schemaVersion = REVIEW_SCHEMA;
      review.candidate.styleReferences = structuredClone(
        descriptor.styleReferences
      );
      review.candidate.styleReferenceMode = 'attachments';
      review.candidate.styleReferenceProvenance = styleReferenceProvenance(
        descriptor.styleReferences
      );
      review.candidate.worker.imageArguments =
        review.candidate.styleReferenceProvenance.map(value => (
          value.stagedBasename
        ));
      const draftProjection = {
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
      review.descriptor.sha256 = sha256(Buffer.from(stableJson(draftProjection)));
      const { fullHash: _reviewHash, ...reviewProjection } = review;
      review.fullHash = sha256(Buffer.from(stableJson(reviewProjection)));
      await writeFile(path.join(cycleRoot, reviewRelative), stableJson(review));
    }
    await assert.rejects(
      loadBattleArt(cycleRoot),
      /cyclic direct-source style provenance/
    );
  });

  it('rejects unmanifested files beside direct approved-source style references', async () => {
    const root = await fixture({ preserveDirectStyleProvenance: true });
    const orphan =
      'ai-image-metadata/battle-art/sources/forest/'
      + 'unreviewed-style-reference/v1/orphan.png';
    await mkdir(path.dirname(path.join(root, orphan)), { recursive: true });
    await writeFile(path.join(root, orphan), 'not a reviewed source');
    await assert.rejects(
      auditBattleArt({ root }),
      /reviewed source membership is incomplete/
    );
  });

  it('rejects an approved-source style pin that is absent from the manifest', async () => {
    const root = await fixture();
    const descriptorPath =
      'ai-image-metadata/battle-art/descriptors/forest/'
      + 'forest-heartlands-loam-path-corner-es.json';
    const descriptor = (await readJson(root, descriptorPath)).value;
    descriptor.styleReferences.push({
      id: 'forest-heartlands-unmanifested-route-reference',
      path:
        'ai-image-metadata/battle-art/sources/forest/'
        + 'forest-heartlands-loam-path-corner-wn/v1/'
        + '36f799979db1a7ba643edfc42a0d8729f2d8fd1eeaa6586a1a09c42710ca211c.png',
      sha256:
        'sha256:36f799979db1a7ba643edfc42a0d8729f2d8fd1eeaa6586a1a09c42710ca211c'
    });
    await writeFile(
      path.join(root, descriptorPath),
      `${JSON.stringify(descriptor, null, 2)}\n`
    );
    await assert.rejects(
      auditBattleArt({ root }),
      /uses an unmanifested style reference/
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
    const excessiveStyleReferences = structuredClone(
      loaded.descriptors.find(entry => (
        entry.descriptor.category === 'blocking-obstacle'
      )).descriptor
    );
    excessiveStyleReferences.styleReferences = Array.from(
      { length: 6 },
      () => structuredClone(excessiveStyleReferences.styleReferences[0])
    );
    assert.throws(
      () => assertDescriptor(excessiveStyleReferences, loaded.manifest),
      /styleReferences must contain at most 5 pins/
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
  it('rejects direct geometry prime metadata that drifts from pinned pixels',
    async () => {
      const root = await fixture();
      const relative =
        'ai-image-metadata/battle-art/descriptors/forest/'
        + 'forest-heartlands-loam-path-corner-es.json';
      const descriptor = (await readJson(root, relative)).value;
      await assert.doesNotReject(loadBattleArt(root));
      const cases = [
        {
          field: 'subjectBounds',
          pattern: /subjectBounds does not match the pinned source raster/,
          mutate: prime => {
            prime.subjectBounds.width += 1;
          }
        },
        {
          field: 'coveragePermille',
          pattern: /coveragePermille does not match the pinned source raster/,
          mutate: prime => {
            prime.coveragePermille += 1;
          }
        },
        {
          field: 'armSampleCenters',
          pattern: /armSampleCenters are not canonical/,
          mutate: prime => {
            prime.armSampleCenters[0].x += 1;
          }
        },
        {
          field: 'apexTopProfile',
          pattern: /apexTopProfile does not match the pinned source raster/,
          mutate: prime => {
            prime.apexTopProfile.alpha240Y[0] += 1;
          }
        }
      ];
      for (const testCase of cases) {
        const changed = structuredClone(descriptor);
        testCase.mutate(changed.directGeometryPrime);
        await writeFile(path.join(root, relative), stableJson(changed));
        await assert.rejects(
          loadBattleArt(root),
          testCase.pattern,
          `${testCase.field} drift must fail closed`
        );
      }
      await writeFile(path.join(root, relative), stableJson(descriptor));
    });

  it('requires a transparent four-pixel canvas border for new route candidates', async () => {
    const descriptor = {
      id: 'test-route-transition',
      category: 'route-transition',
      canvas: { width: 16, height: 12 }
    };
    const cleanPixels = Buffer.alloc(
      descriptor.canvas.width * descriptor.canvas.height * 4
    );
    cleanPixels.set([117, 76, 36, 255], ((6 * descriptor.canvas.width) + 8) * 4);
    const encode = pixels => sharp(pixels, {
      raw: {
        width: descriptor.canvas.width,
        height: descriptor.canvas.height,
        channels: 4
      }
    }).png().toBuffer();

    await assert.doesNotReject(assertRouteTransitionCanvasBorderClear({
      bytes: await encode(cleanPixels),
      descriptor
    }));

    const boundaries = [
      { name: 'top', outer: [8, 3], inner: [8, 4] },
      { name: 'right', outer: [12, 6], inner: [11, 6] },
      { name: 'bottom', outer: [8, 8], inner: [8, 7] },
      { name: 'left', outer: [3, 6], inner: [4, 6] },
      { name: 'top-left corner', outer: [3, 3], inner: [4, 4] },
      { name: 'top-right corner', outer: [12, 3], inner: [11, 4] },
      { name: 'bottom-right corner', outer: [12, 8], inner: [11, 7] },
      { name: 'bottom-left corner', outer: [3, 8], inner: [4, 7] }
    ];
    for (const boundary of boundaries) {
      const innerPixels = Buffer.from(cleanPixels);
      const [innerX, innerY] = boundary.inner;
      innerPixels.set(
        [117, 76, 36, 255],
        ((innerY * descriptor.canvas.width) + innerX) * 4
      );
      await assert.doesNotReject(
        assertRouteTransitionCanvasBorderClear({
          bytes: await encode(innerPixels),
          descriptor
        }),
        `${boundary.name} adjacent inner pixel must pass`
      );

      const outerPixels = Buffer.from(cleanPixels);
      const [outerX, outerY] = boundary.outer;
      outerPixels.set(
        [117, 76, 36, 255],
        ((outerY * descriptor.canvas.width) + outerX) * 4
      );
      await assert.rejects(
        assertRouteTransitionCanvasBorderClear({
          bytes: await encode(outerPixels),
          descriptor
        }),
        new RegExp(
          `outermost 4-pixel canvas border must be fully transparent; .* at `
          + `${outerX},${outerY}`
        ),
        `${boundary.name} outer pixel must fail`
      );
    }

    await assert.doesNotReject(assertRouteTransitionCanvasBorderClear({
      bytes: Buffer.from('not an image'),
      descriptor: { ...descriptor, category: 'surface' }
    }));
  });

  it('requires a 28-pixel opaque core through each route corner anchor', async () => {
    const canvas = { width: 64, height: 64 };
    const anchor = { x: 32, y: 32 };
    const encodeRun = async (axis, length) => {
      const pixels = Buffer.alloc(canvas.width * canvas.height * 4);
      const start = 19;
      for (let offset = 0; offset < length; offset += 1) {
        const x = axis === 'vertical' ? anchor.x : start + offset;
        const y = axis === 'vertical' ? start + offset : anchor.y;
        pixels.set(
          [117, 76, 36, 255],
          ((y * canvas.width) + x) * 4
        );
      }
      return sharp(pixels, {
        raw: { ...canvas, channels: 4 }
      }).png().toBuffer();
    };
    const cases = [
      { topology: 'corner-es', axis: 'vertical' },
      { topology: 'corner-wn', axis: 'vertical' },
      { topology: 'corner-ne', axis: 'horizontal' },
      { topology: 'corner-sw', axis: 'horizontal' }
    ];
    for (const { topology, axis } of cases) {
      const descriptor = {
        id: `test-${topology}`,
        category: 'route-transition',
        capabilities: { routeTopology: topology },
        canvas,
        placement: { anchor }
      };
      await assert.rejects(
        assertRouteCornerMinimumCoreWidth({
          bytes: await encodeRun(axis, 27),
          descriptor
        }),
        new RegExp(
          `route corner ${topology} maximum anchor-intersecting opaque `
          + `${axis} run is 27 pixels; expected at least 28`
        )
      );
      assert.deepEqual(
        await assertRouteCornerMinimumCoreWidth({
          bytes: await encodeRun(axis, 28),
          descriptor
        }),
        { axis, maximumRun: 28 }
      );
    }

    await assert.doesNotReject(assertRouteCornerMinimumCoreWidth({
      bytes: Buffer.from('not an image'),
      descriptor: {
        id: 'test-straight-route',
        category: 'route-transition',
        capabilities: { routeTopology: 'straight-ns' }
      }
    }));
    await assert.doesNotReject(assertRouteCornerMinimumCoreWidth({
      bytes: Buffer.from('not an image'),
      descriptor: {
        id: 'test-non-route',
        category: 'surface',
        capabilities: { routeTopology: 'corner-ne' }
      }
    }));
  });

  it('requires 28-pixel opaque route arms at 50, 75, and 100 percent', async () => {
    const canvas = { width: 256, height: 128 };
    const anchor = { x: 128, y: 64 };
    const vectors = {
      n: { x: 64, y: -32 },
      e: { x: 64, y: 32 },
      s: { x: -64, y: 32 },
      w: { x: -64, y: -32 }
    };
    const perpendicularLine = (sample, vector) => {
      const length = Math.hypot(vector.x, vector.y);
      const perpendicular = {
        x: -vector.y / length,
        y: vector.x / length
      };
      const maximumDistance = Math.ceil(
        Math.hypot(canvas.width, canvas.height)
      ) + 1;
      const line = [];
      let previous = null;
      for (let distance = -maximumDistance;
        distance <= maximumDistance;
        distance += 1) {
        const point = {
          x: Math.round(sample.x + (perpendicular.x * distance)),
          y: Math.round(sample.y + (perpendicular.y * distance))
        };
        const key = `${point.x},${point.y}`;
        if (key === previous) continue;
        previous = key;
        if (point.x >= 0
          && point.x < canvas.width
          && point.y >= 0
          && point.y < canvas.height) {
          line.push(point);
        }
      }
      return line;
    };
    const encodeArms = async (
      spans,
      { alpha = 255, detachedDirections = [] } = {}
    ) => {
      const pixels = Buffer.alloc(canvas.width * canvas.height * 4);
      for (const [direction, span] of Object.entries(spans)) {
        const vector = vectors[direction];
        for (const fraction of [0.5, 0.75, 1]) {
          const sample = {
            x: anchor.x + (vector.x * fraction),
            y: anchor.y + (vector.y * fraction)
          };
          const line = perpendicularLine(sample, vector);
          const center = line.findIndex(
            point => point.x === sample.x && point.y === sample.y
          );
          const start = center - Math.floor((span - 1) / 2);
          for (const point of line.slice(start, start + span)) {
            pixels.set(
              [117, 76, 36, alpha],
              ((point.y * canvas.width) + point.x) * 4
            );
          }
          if (detachedDirections.includes(direction)) {
            const detached = line[start + span + 1];
            pixels.set(
              [117, 76, 36, alpha],
              ((detached.y * canvas.width) + detached.x) * 4
            );
          }
        }
      }
      return sharp(pixels, {
        raw: { ...canvas, channels: 4 }
      }).png().toBuffer();
    };
    for (const direction of ['n', 'e', 's', 'w']) {
      const descriptor = {
        id: `test-end-${direction}`,
        category: 'route-transition',
        capabilities: { routeTopology: `end-${direction}` },
        canvas,
        placement: { anchor }
      };
      await assert.rejects(
        assertRouteArmMinimumCoreWidth({
          bytes: await encodeArms({ [direction]: 27 }),
          descriptor
        }),
        new RegExp(
          `route end-${direction} ${direction} arm opaque perpendicular `
          + 'span at 50% is 27 pixels; expected at least 28'
        )
      );
      assert.deepEqual(
        await assertRouteArmMinimumCoreWidth({
          bytes: await encodeArms({ [direction]: 28 }),
          descriptor
        }),
        {
          samples: [50, 75, 100].map(percent => ({
            direction,
            percent,
            span: 28
          }))
        }
      );
      await assert.rejects(
        assertRouteArmMinimumCoreWidth({
          bytes: await encodeArms(
            { [direction]: 27 },
            { detachedDirections: [direction] }
          ),
          descriptor
        }),
        /span at 50% is 27 pixels; expected at least 28/
      );
    }

    const topologies = [
      ['end-n', ['n']],
      ['end-e', ['e']],
      ['end-s', ['s']],
      ['end-w', ['w']],
      ['straight-ew', ['e', 'w']],
      ['straight-ns', ['n', 's']],
      ['corner-ne', ['n', 'e']],
      ['corner-es', ['e', 's']],
      ['corner-sw', ['s', 'w']],
      ['corner-wn', ['w', 'n']],
      ['tee-esw', ['e', 's', 'w']],
      ['tee-nes', ['n', 'e', 's']],
      ['tee-nsw', ['n', 's', 'w']],
      ['tee-wne', ['w', 'n', 'e']],
      ['cross', ['n', 'e', 's', 'w']]
    ];
    for (const [topology, directions] of topologies) {
      const thinDirection = directions.at(-1);
      const spans = Object.fromEntries(
        directions.map(direction => [
          direction,
          direction === thinDirection ? 27 : 28
        ])
      );
      await assert.rejects(
        assertRouteArmMinimumCoreWidth({
          bytes: await encodeArms(spans),
          descriptor: {
            id: `test-${topology}`,
            category: 'route-transition',
            capabilities: { routeTopology: topology },
            canvas,
            placement: { anchor }
          }
        }),
        new RegExp(
          `route ${topology} ${thinDirection} arm opaque perpendicular `
          + 'span at 50% is 27 pixels; expected at least 28'
        )
      );
    }

    const thresholdDescriptor = {
      id: 'test-alpha-threshold',
      category: 'route-transition',
      capabilities: { routeTopology: 'end-n' },
      canvas,
      placement: { anchor }
    };
    await assert.rejects(
      assertRouteArmMinimumCoreWidth({
        bytes: await encodeArms({ n: 28 }, { alpha: 239 }),
        descriptor: thresholdDescriptor
      }),
      /span at 50% is 0 pixels; expected at least 28/
    );
    assert.deepEqual(
      await assertRouteArmMinimumCoreWidth({
        bytes: await encodeArms({ n: 28 }, { alpha: 240 }),
        descriptor: thresholdDescriptor
      }),
      {
        samples: [50, 75, 100].map(percent => ({
          direction: 'n',
          percent,
          span: 28
        }))
      }
    );

    const directV2Descriptor = {
      schemaVersion: 'battle-art-family-descriptor-v2',
      id: 'test-v2-direct-arm',
      category: 'route-transition',
      capabilities: { routeTopology: 'end-n' },
      canvas,
      placement: { anchor }
    };
    await assert.doesNotReject(assertRouteArmMinimumCoreWidth({
      bytes: await encodeArms({ n: 44 }),
      descriptor: directV2Descriptor
    }));

    const heartlandsCornerEsDescriptor = {
      schemaVersion: 'battle-art-family-descriptor-v2',
      id: 'forest-heartlands-loam-path-corner-es',
      category: 'route-transition',
      capabilities: { routeTopology: 'corner-es' },
      canvas,
      placement: { anchor }
    };
    await assert.doesNotReject(assertRouteArmMinimumCoreWidth({
      bytes: await encodeArms({ e: 30, s: 41 }),
      descriptor: heartlandsCornerEsDescriptor
    }));
    await assert.rejects(
      assertRouteArmMinimumCoreWidth({
        bytes: await encodeArms({ e: 29, s: 29 }),
        descriptor: heartlandsCornerEsDescriptor
      }),
      /corner-es e arm opaque perpendicular span at 50% is 29 pixels; expected at least 30/
    );
    await assert.rejects(
      assertRouteArmMinimumCoreWidth({
        bytes: await encodeArms({ e: 42, s: 42 }),
        descriptor: heartlandsCornerEsDescriptor
      }),
      /corner-es e arm opaque perpendicular span at 50% is 42 pixels; expected at most 41/
    );
    await assert.rejects(
      assertRouteArmMinimumCoreWidth({
        bytes: await encodeArms({ e: 29, s: 41 }),
        descriptor: heartlandsCornerEsDescriptor
      }),
      /corner-es arm opaque perpendicular spans vary by 12 pixels \(29\.\.41\); expected at most 11/
    );

    await assert.doesNotReject(assertRouteArmMinimumCoreWidth({
      bytes: Buffer.from('not an image'),
      descriptor: {
        id: 'test-isolated',
        category: 'route-transition',
        capabilities: { routeTopology: 'isolated' }
      }
    }));
    await assert.doesNotReject(assertRouteArmMinimumCoreWidth({
      bytes: Buffer.from('not an image'),
      descriptor: {
        id: 'test-non-route',
        category: 'surface',
        capabilities: { routeTopology: 'corner-ne' }
      }
    }));
    await assert.doesNotReject(assertRouteArmMinimumCoreWidth({
      bytes: Buffer.from('not an image'),
      descriptor: {
        id: 'test-legacy-route',
        category: 'route-transition'
      }
    }));
  });

  it('requires the approved anchor arch and a clear upper center for corner-es', async () => {
    const canvas = { width: 256, height: 128 };
    const descriptor = {
      schemaVersion: 'battle-art-family-descriptor-v2',
      id: 'forest-heartlands-loam-path-corner-es',
      category: 'route-transition',
      capabilities: { routeTopology: 'corner-es' },
      canvas
    };
    const encode = async ({
      upperPixel = null,
      narrowRow = null,
      apexNotch = false,
      flatApex = false,
      interiorCoreGap = null,
      opaqueVergePixel = null
    } = {}) => {
      const pixels = Buffer.alloc(canvas.width * canvas.height * 4);
      if (apexNotch) {
        for (let y = 56; y <= 84; y += 1) {
          for (let x = 112; x <= 119; x += 1) {
            pixels.set(
              [117, 76, 36, 255],
              ((y * canvas.width) + x) * 4
            );
          }
        }
      }
      for (let x = 120; x <= 135; x += 1) {
        const topRow = apexNotch && x >= 130
          ? 64
          : flatApex
            ? 56
            : x % 4 === 0
              ? 55
              : 56;
        for (let y = topRow; y <= 84; y += 1) {
          if (y === narrowRow && x >= 134) continue;
          if (interiorCoreGap?.x === x && interiorCoreGap.y === y) {
            pixels.set(
              [117, 76, 36, 239],
              ((y * canvas.width) + x) * 4
            );
            continue;
          }
          pixels.set(
            [117, 76, 36, 255],
            ((y * canvas.width) + x) * 4
          );
        }
      }
      if (opaqueVergePixel !== null) {
        pixels.set(
          [78, 109, 51, 255],
          ((opaqueVergePixel.y * canvas.width) + opaqueVergePixel.x) * 4
        );
      }
      if (interiorCoreGap !== null) {
        for (let x = 112; x <= 119; x += 1) {
          pixels.set(
            [117, 76, 36, 255],
            ((interiorCoreGap.y * canvas.width) + x) * 4
          );
        }
      }
      if (upperPixel !== null) {
        pixels.set(
          [117, 76, 36, 255],
          ((upperPixel.y * canvas.width) + upperPixel.x) * 4
        );
      }
      return sharp(pixels, {
        raw: { ...canvas, channels: 4 }
      }).png().toBuffer();
    };
    assert.deepEqual(
      await assertCornerEsAnchorArchPlacement({
        bytes: await encode(),
        descriptor
      }),
      {
        minimumOpaqueCoreHeight: 29,
        maximumApexTopStep: 1,
        maximumApexFlatRun: 3
      }
    );
    await assert.rejects(
      assertCornerEsAnchorArchPlacement({
        bytes: await encode({ upperPixel: { x: 128, y: 32 } }),
        descriptor
      }),
      /upper-center exclusion contains alpha-at-least-240 at 128,32/
    );
    await assert.rejects(
      assertCornerEsAnchorArchPlacement({
        bytes: await encode({ narrowRow: 80 }),
        descriptor
      }),
      /shared apex core contains a sub-240-alpha gap at 134,80/
    );
    await assert.rejects(
      assertCornerEsAnchorArchPlacement({
        bytes: await encode({ apexNotch: true }),
        descriptor
      }),
      /apex top boundary jumps 8 pixels .* expected at most 4 without a carved notch/
    );
    await assert.rejects(
      assertCornerEsAnchorArchPlacement({
        bytes: await encode({ flatApex: true }),
        descriptor
      }),
      /apex top boundary has a 9-pixel ruler-flat run/
    );
    await assert.rejects(
      assertCornerEsAnchorArchPlacement({
        bytes: await encode({
          interiorCoreGap: { x: 128, y: 70 }
        }),
        descriptor
      }),
      /shared apex core contains a sub-240-alpha gap at 128,70; expected x=120\.\.135 to remain alpha-at-least-240 for 29 consecutive rows/
    );
    await assert.doesNotReject(assertCornerEsAnchorArchPlacement({
      bytes: await encode({
        opaqueVergePixel: { x: 118, y: 54 }
      }),
      descriptor
    }));
    await assert.doesNotReject(assertCornerEsAnchorArchPlacement({
      bytes: await encode({
        interiorCoreGap: { x: 128, y: 70 }
      }),
      descriptor: {
        ...descriptor,
        id: 'forest-borderwood-dirt-path-corner-es'
      }
    }));
    await assert.doesNotReject(assertCornerEsAnchorArchPlacement({
      bytes: Buffer.from('not an image'),
      descriptor: {
        ...descriptor,
        schemaVersion: 'battle-art-family-descriptor-v1'
      }
    }));
  });

  it('caps v2 corner route alpha coverage at 230 permille', async () => {
    const canvas = { width: 40, height: 25 };
    const descriptor = {
      schemaVersion: 'battle-art-family-descriptor-v2',
      id: 'test-corner-coverage',
      category: 'route-transition',
      capabilities: { routeTopology: 'corner-es' },
      canvas
    };
    const encodeCoverage = async coveredPixels => {
      const pixels = Buffer.alloc(canvas.width * canvas.height * 4);
      for (let pixel = 0; pixel < coveredPixels; pixel += 1) {
        pixels.set([117, 76, 36, 255], pixel * 4);
      }
      return sharp(pixels, {
        raw: { ...canvas, channels: 4 }
      }).png().toBuffer();
    };
    assert.deepEqual(
      await assertRouteCornerMaximumCoverage({
        bytes: await encodeCoverage(230),
        descriptor
      }),
      {
        coveredPixels: 230,
        totalPixels: 1000,
        coveragePermille: 230
      }
    );
    await assert.rejects(
      assertRouteCornerMaximumCoverage({
        bytes: await encodeCoverage(231),
        descriptor
      }),
      /alpha coverage is 231‰; expected at most 230‰/
    );
    await assert.doesNotReject(assertRouteCornerMaximumCoverage({
      bytes: Buffer.from('not an image'),
      descriptor: {
        ...descriptor,
        schemaVersion: 'battle-art-family-descriptor-v1'
      }
    }));
  });

  it('caps straight route alpha coverage at 300 permille', async () => {
    const canvas = { width: 40, height: 25 };
    const descriptor = {
      id: 'test-straight-ew',
      category: 'route-transition',
      capabilities: { routeTopology: 'straight-ew' },
      canvas
    };
    const encodeCoverage = async (targetCanvas, coveredPixels) => {
      const pixels = Buffer.alloc(
        targetCanvas.width * targetCanvas.height * 4
      );
      for (let pixel = 0; pixel < coveredPixels; pixel += 1) {
        pixels.set([117, 76, 36, 255], pixel * 4);
      }
      return sharp(pixels, {
        raw: { ...targetCanvas, channels: 4 }
      }).png().toBuffer();
    };
    assert.deepEqual(
      await assertRouteStraightMaximumCoverage({
        bytes: await encodeCoverage(canvas, 300),
        descriptor
      }),
      {
        coveredPixels: 300,
        totalPixels: 1000,
        coveragePermille: 300
      }
    );
    await assert.rejects(
      assertRouteStraightMaximumCoverage({
        bytes: await encodeCoverage(canvas, 301),
        descriptor
      }),
      /straight route straight-ew alpha coverage is 301‰; expected at most 300‰/
    );

    const productionCanvas = { width: 256, height: 128 };
    const productionDescriptor = {
      ...descriptor,
      canvas: productionCanvas
    };
    const greatestAllowed = Math.floor(
      (productionCanvas.width * productionCanvas.height * 300) / 1000
    );
    assert.deepEqual(
      await assertRouteStraightMaximumCoverage({
        bytes: await encodeCoverage(productionCanvas, greatestAllowed),
        descriptor: productionDescriptor
      }),
      {
        coveredPixels: 9830,
        totalPixels: 32768,
        coveragePermille: 299
      }
    );
    await assert.rejects(
      assertRouteStraightMaximumCoverage({
        bytes: await encodeCoverage(productionCanvas, greatestAllowed + 1),
        descriptor: productionDescriptor
      }),
      /alpha coverage is 300‰; expected at most 300‰; covered 9831 of 32768 pixels/
    );
    await assert.doesNotReject(assertRouteStraightMaximumCoverage({
      bytes: Buffer.from('not an image'),
      descriptor: {
        ...descriptor,
        capabilities: { routeTopology: 'corner-ne' }
      }
    }));

    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const straightDescriptor = loaded.descriptors.find(
      entry => entry.descriptor.id
        === 'forest-borderwood-dirt-path-straight-ew'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor: straightDescriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(
      prompt,
      /Keep large transparent regions on both sides of the straight route/
    );
    assert.match(
      prompt,
      /Never expand it into an opaque diamond, platform, or plaza/
    );
    assert.match(prompt, /no nonzero-alpha pixel anywhere on the canvas/);
    assert.match(
      prompt,
      /extend more than 8 pixels beyond its named seam cross-section/
    );
    assert.match(
      prompt,
      /Never continue the ribbon toward a rectangular canvas corner/
    );
    assert.match(
      prompt,
      /targets are terminal seam cross-sections, not final endpoints or cap centers/
    );
    assert.match(
      prompt,
      /exact named target as a terminal seam cross-section, not a final endpoint or cap center/
    );
    assert.doesNotMatch(
      prompt,
      /exact named target as a terminal endpoint|final terminal endpoints/
    );
    assert.match(prompt, /Compose the principal centerline through/);
    assert.match(prompt, /using the central 50% of the 2:1 canvas width and height/);
    assert.match(prompt, /do not render a long full-canvas strip/);
    assert.match(
      prompt,
      /At each terminal seam cross-section, carry the full-width dirt core through the exact target, continue the same band only 4–6 pixels outward, and close it with a short nearly straight transverse dirt edge/
    );
    assert.match(
      prompt,
      /Keep the low irregular verge on the two long sides; do not place grass, leaf, pebble, lobe, or feather decoration beyond either transverse end/
    );
    assert.match(
      prompt,
      /Never taper, round, or point a seam cross-section or its cap/
    );
    assert.match(
      prompt,
      /never form a semicircular capsule lobe or an extended squared slab/
    );
    assert.doesNotMatch(
      prompt,
      /At each terminal, use a short irregular transverse grass-and-leaf feather/
    );
    assert.match(prompt, /within 8 pixels beyond each target/);
    assert.match(prompt, /remaining distance to both rectangular corners solid magenta/);
    assert.doesNotMatch(prompt, /fit-route-candidate\.mjs/);
    assert.doesNotMatch(prompt, /sole allowed post-generation transform/);
    assert.match(
      prompt,
      /call the imagegen tool exactly once/
    );
    assert.match(
      prompt,
      /Execute exactly two successful shell commands in this order/
    );
    assert.match(prompt, /\/bin\/cat .*imagegen\/SKILL\.md/);
    assert.match(prompt, /standalone \/bin\/cp from the current JSONL/);
    assert.match(
      prompt,
      /parent lifecycle performs only exact-aspect whole-image resizing, chroma removal,\s+normalization, generic raster validation, and topology-appropriate\s+deterministic route geometry validation/
    );
    assert.match(prompt, /must preserve the one generated route artifact without editing it/);
    assert.match(prompt, /source has the exact declared 2:1 aspect ratio/);
    assert.match(prompt, /resizes the entire copied raster to the exact\s+declared width and height/);
    assert.match(prompt, /Do not crop or reshape a\s+different-aspect source/);
    assert.doesNotMatch(
      prompt,
      /lifecycle remeasures|generic acceptance envelope|every measured run must contain|coverage cap/
    );
    assert.doesNotMatch(
      prompt,
      /deterministic in-place overwrites|crop\/scale, alpha masking, and canvas placement/
    );
    const textFallbackPrompt = buildGenerationPrompt({
      descriptor: straightDescriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png'],
      textStyleFallback: true
    });
    assert.match(
      textFallbackPrompt,
      /Preserve the copied route artifact without inspecting or editing it/
    );
    assert.doesNotMatch(
      textFallbackPrompt,
      /Verify dimensions, alpha, bounds, and topology with local metadata\/raster code/
    );
  });

  it('keeps the historical fixed route-finishing contract reproducible when explicitly opted in',
    async () => {
      const loaded = await loadBattleArt(REPOSITORY_ROOT);
      const directDescriptor = loaded.descriptors.find(
        entry => entry.descriptor.id
          === 'forest-heartlands-loam-path-straight-ns'
      ).descriptor;
      const descriptor = {
        ...structuredClone(directDescriptor),
        routeFinishing: {
          schemaVersion: 'battle-art-route-finishing-v1',
          strategy: 'largest-component-box-v1',
          targetBox: { x: 17, y: 4, width: 224, height: 120 },
          maximumDetachedCoveredPermille: 20,
          armAlphaSpan: {
            alphaThreshold: 240,
            minimumPixels: 36,
            maximumPixels: 44,
            maximumSpreadPixels: 8
          }
        }
      };
      const raw = await reflectedHeartlandsStraightNs();
      const finished = await finishRouteArtifact({
        bytes: raw,
        descriptor,
        profile: loaded.promptProfile
      });

      assert.deepEqual(finished.derivation.sourceBounds, {
        x: 17,
        y: 4,
        width: 224,
        height: 120
      });
      assert.deepEqual(finished.derivation.targetBox, {
        x: 17,
        y: 4,
        width: 224,
        height: 120
      });
      await assert.doesNotReject(assertRouteTransitionCanvasBorderClear({
        bytes: finished.bytes,
        descriptor
      }));
      const widths = await assertRouteArmMinimumCoreWidth({
        bytes: finished.bytes,
        descriptor
      });
      assert.deepEqual(
        widths.samples.map(sample => sample.span),
        [38, 38, 38, 43, 42, 44]
      );
      assert.deepEqual(
        await assertRouteStraightMaximumCoverage({
          bytes: finished.bytes,
          descriptor
        }),
        {
          coveredPixels: 9030,
          totalPixels: 32768,
          coveragePermille: 275
        }
      );
    });

  it('publishes a deterministically finished route with one-call provenance and preserves its immutable raw input',
    async () => {
      const ignoreRules = await readFile(
        path.join(REPOSITORY_ROOT, '.gitignore'),
        'utf8'
      );
      assert.match(
        ignoreRules,
        /!ai-image-metadata\/battle-art\/generated-artifacts\/\*\*\/\*\.png/
      );
      assert.match(
        ignoreRules,
        /!ai-image-metadata\/battle-art\/generated-artifacts\/\*\*\/\*\.webp/
      );
      const root = await fixture({ preserveDirectStyleProvenance: true });
      const family = 'forest-heartlands-loam-path-straight-ns';
      const descriptorRelative =
        `ai-image-metadata/battle-art/descriptors/forest/${family}.json`;
      const repositoryDescriptor = (await readJson(
        REPOSITORY_ROOT,
        descriptorRelative
      )).value;
      await writeFile(
        path.join(root, descriptorRelative),
        stableJson({
          ...repositoryDescriptor,
          status: 'draft',
          content: {
            ...repositoryDescriptor.content,
            sourceSha256: null,
            runtimeSha256: null,
            immutableUrl: null
          },
          source: null
        })
      );
      const fixtureManifest = (await readJson(
        root,
        'ai-image-metadata/battle-art/manifest.json'
      )).value;
      for (const reference of fixtureManifest.styleReferences.filter(
        value => value.path.startsWith(
          'ai-image-metadata/battle-art/sources/'
        )
      )) {
        const [, , , sourceTheme, sourceFamily] =
          reference.path.split('/');
        const candidateRelative =
          `ai-image-metadata/battle-art/candidates/${sourceTheme}/`
          + sourceFamily;
        await mkdir(path.dirname(path.join(root, candidateRelative)), {
          recursive: true
        });
        await cp(
          path.join(REPOSITORY_ROOT, candidateRelative),
          path.join(root, candidateRelative),
          { recursive: true }
        );
      }
      const raw = await readFile(path.join(
        REPOSITORY_ROOT,
        HEARTLANDS_STRAIGHT_NS_V13_APPROVED_RAW
      ));
      let workerCalls = 0;
      let environmentSource;
      const worker = async input => {
        workerCalls += 1;
        const result = await candidateWorker(input);
        environmentSource = result.environmentSource;
        await replaceRouteWorkerCandidate({
          workspace: input.workspace,
          result,
          bytes: raw
        });
        const message =
          'Copied the generated artifact unchanged to [candidate.png]'
          + `(${path.join(input.workspace, 'candidate.png')}).`;
        await writeFile(
          path.join(input.workspace, 'last-message.txt'),
          message
        );
        const events = result.stdout.toString('utf8')
          .trimEnd()
          .split('\n')
          .map(line => JSON.parse(line));
        for (const event of events) {
          const item = event?.item;
          if (
            item?.type === 'command_execution'
            && item.command.startsWith('/bin/cp ')
          ) {
            const { artifactPath } =
              assertSingleGeneratedArtifactCopyEvidence(result.stdout);
            item.command =
              `/bin/bash -lc '/bin/cp "${artifactPath}" "candidate.png"'`;
          }
        }
        events.push({
          type: 'item.completed',
          item: {
            id: 'route-final-message',
            type: 'agent_message',
            text: message
          }
        });
        return {
          ...result,
          stdout: Buffer.from(
            `${events.map(event => JSON.stringify(event)).join('\n')}\n`
          )
        };
      };
      const generated = await generateBattleArt({
        projectRoot: root,
        theme: 'forest',
        family,
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, { worker });
      assert.equal(workerCalls, 1);
      assert.equal(generated.results[0].status, 'generated');

      const loaded = await loadBattleArt(root);
      const descriptor = loaded.descriptors.find(
        entry => entry.descriptor.id === family
      ).descriptor;
      const candidateDirectory = path.join(
        root,
        'ai-image-metadata/battle-art/candidates/forest',
        family
      );
      const candidate = JSON.parse(await readFile(
        path.join(candidateDirectory, 'result.json'),
        'utf8'
      ));
      const rawPath = generatedArtifactPath(descriptor, {
        sha256: sha256(raw),
        format: 'png'
      });
      assert.deepEqual(candidate.derivation, {
        schemaVersion: 'battle-art-route-finishing-v1',
        strategy: 'largest-component-box-v1',
        source: {
          path: rawPath,
          bytes: raw.length,
          width: 1774,
          height: 887,
          format: 'png',
          sha256: sha256(raw)
        },
        sourceBounds: {
          x: 413,
          y: 157,
          width: 1054,
          height: 566
        },
        componentCount: 1,
        coveredPixels: 206937,
        selectedCoveredPixels: 206937,
        detachedCoveredPixels: 0,
        detachedCoveredPermille: 0,
        maximumDetachedCoveredPermille: 20,
        terminalClip: {
          schemaVersion: 'battle-art-route-terminal-clip-v1',
          maximumOverflowPixels: 8,
          clearedPixels: 257
        },
        targetBox: {
          x: 46,
          y: 8,
          width: 164,
          height: 112
        },
        scaleX: {
          numerator: 164,
          denominator: 1054
        },
        scaleY: {
          numerator: 112,
          denominator: 566
        },
        kernel: 'lanczos3',
        finalSha256: candidate.image.sha256
      });
      assert.deepEqual(
        candidate.styleReferences.map(reference => reference.id),
        [
          'forest-source-template-01',
          'forest-heartlands-approved-route-straight-ew-v1'
        ]
      );
      assert.equal(candidate.worker.invocationCount, 1);
      assert.deepEqual(await readFile(path.join(root, rawPath)), raw);
      assert.equal(candidate.derivation.source.path, rawPath);
      assert.equal(candidate.derivation.source.sha256, sha256(raw));
      assert.equal(candidate.derivation.finalSha256, candidate.image.sha256);
      assert.deepEqual(await readFile(path.join(root, rawPath)), raw);
      await assert.rejects(
        readFile(path.join(candidateDirectory, 'generated-artifact.bin')),
        error => error.code === 'ENOENT'
      );
      const candidateImageBeforeNormalize = await readFile(path.join(
        root,
        candidate.image.path
      ));
      const candidateMetadataBeforeNormalize = await readFile(path.join(
        candidateDirectory,
        'result.json'
      ));
      const normalized = await normalizeCandidates({
        root,
        theme: 'forest',
        family
      });
      assert.equal(normalized.results[0].status, 'current');
      assert.deepEqual(
        await readFile(path.join(root, candidate.image.path)),
        candidateImageBeforeNormalize
      );
      assert.deepEqual(
        await readFile(path.join(candidateDirectory, 'result.json')),
        candidateMetadataBeforeNormalize
      );
      for (const mutate of [
        metadata => {
          metadata.derivation.targetBox.width += 1;
        },
        metadata => {
          metadata.derivation.finalSha256 = `sha256:${'0'.repeat(64)}`;
        }
      ]) {
        const tampered = structuredClone(candidate);
        mutate(tampered);
        await writeFile(
          path.join(candidateDirectory, 'result.json'),
          stableJson(tampered)
        );
        await assert.rejects(
          normalizeCandidates({
            root,
            theme: 'forest',
            family
          }),
          /route derivation|targetBox/
        );
        await writeFile(
          path.join(candidateDirectory, 'result.json'),
          candidateMetadataBeforeNormalize
        );
      }

      const tamperedCandidateBytes = await sharp(candidateImageBeforeNormalize)
        .tint({ r: 151, g: 91, b: 37 })
        .png()
        .toBuffer();
      const tamperedCandidate = structuredClone(candidate);
      tamperedCandidate.image = {
        ...candidate.image,
        bytes: tamperedCandidateBytes.length,
        sha256: sha256(tamperedCandidateBytes)
      };
      await Promise.all([
        writeFile(
          path.join(root, candidate.image.path),
          tamperedCandidateBytes
        ),
        writeFile(
          path.join(candidateDirectory, 'result.json'),
          stableJson(tamperedCandidate)
        )
      ]);
      await assert.rejects(
        normalizeCandidates({ root, theme: 'forest', family }),
        /route derivation does not reproduce the candidate bytes/
      );
      await assert.rejects(
        writePreview({
          root,
          theme: 'forest',
          family,
          output: 'ai-image-metadata/battle-art/preview/direct-route.html'
        }),
        /route derivation does not reproduce the candidate bytes/
      );
      await assert.rejects(
        recordCandidateReview({
          root,
          theme: 'forest',
          family,
          reviewer: 'route-process-test',
          decision: 'rejected',
          reason: 'A re-hashed replacement must not pass direct route review.',
          reviewedAt: '2026-07-31T11:59:58.000Z'
        }),
        /route derivation does not reproduce the candidate bytes/
      );
      await assert.rejects(
        approveCandidate({
          root,
          theme: 'forest',
          family,
          reviewer: 'route-process-test',
          decision: 'approved',
          reason: 'A re-hashed replacement must not pass route approval.',
          approvedAt: '2026-07-31T11:59:59.000Z'
        }),
        /route derivation does not reproduce the candidate bytes/
      );
      await Promise.all([
        writeFile(
          path.join(root, candidate.image.path),
          candidateImageBeforeNormalize
        ),
        writeFile(
          path.join(candidateDirectory, 'result.json'),
          candidateMetadataBeforeNormalize
        )
      ]);

      const tamperedRawBeforeRecovery = Buffer.from(raw);
      tamperedRawBeforeRecovery[tamperedRawBeforeRecovery.length - 1] ^= 1;
      await writeFile(path.join(root, rawPath), tamperedRawBeforeRecovery);
      await assert.rejects(
        normalizeCandidates({ root, theme: 'forest', family }),
        /hash pin mismatch/
      );
      await writeFile(path.join(root, rawPath), raw);

      await Promise.all([
        rm(path.join(root, candidate.image.path)),
        rm(path.join(candidateDirectory, 'result.json'))
      ]);
      let recoveryWorkerCalls = 0;
      const recoveryOptions = {
        projectRoot: root,
        theme: 'forest',
        families: [family],
        concurrency: 1,
        timeoutMs: 10_000,
        timeoutProvided: true,
        dryRun: false,
        force: false,
        resume: false,
        keepGoing: false,
        textStyleFallback: false,
        recover: true
      };
      const recoveryDependencies = {
        worker: async () => {
          recoveryWorkerCalls += 1;
          throw new Error('recovery must not launch a worker');
        },
        environmentSource
      };
      const recovered = await generateBattleArt(
        recoveryOptions,
        recoveryDependencies
      );
      assert.equal(recoveryWorkerCalls, 0);
      assert.equal(recovered.results[0].recovered, true);
      assert.deepEqual(
        await readFile(path.join(root, candidate.image.path)),
        candidateImageBeforeNormalize
      );
      assert.deepEqual(
        await readFile(path.join(candidateDirectory, 'result.json')),
        candidateMetadataBeforeNormalize
      );

      const reviewCountBefore =
        (await auditBattleArtReviews({ root })).records;
      await recordCandidateReview({
        root,
        theme: 'forest',
        family,
        reviewer: 'route-process-test',
        decision: 'rejected',
        reason: 'Test-only rejection after deterministic geometry acceptance.',
        reviewedAt: '2026-07-31T12:00:00.000Z'
      });
      assert.equal(
        (await auditBattleArtReviews({ root })).records,
        reviewCountBefore + 1
      );
      await Promise.all([
        writeFile(
          path.join(root, candidate.image.path),
          tamperedCandidateBytes
        ),
        writeFile(
          path.join(candidateDirectory, 'result.json'),
          stableJson(tamperedCandidate)
        )
      ]);
      assert.equal(
        (await auditBattleArtReviews({ root })).records,
        reviewCountBefore + 1
      );

      const replacementDecoded = await sharp(raw)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let offset = 0;
        offset < replacementDecoded.data.length;
        offset += 4) {
        const magentaBackground =
          replacementDecoded.data[offset] >= 240
          && replacementDecoded.data[offset + 1] <= 24
          && replacementDecoded.data[offset + 2] >= 240;
        if (magentaBackground) continue;
        replacementDecoded.data[offset] = Math.min(
          255,
          replacementDecoded.data[offset] + 8
        );
      }
      const replacementRaw = await sharp(replacementDecoded.data, {
        raw: {
          width: replacementDecoded.info.width,
          height: replacementDecoded.info.height,
          channels: 4
        }
      }).png().toBuffer();
      const replacementRawPath = generatedArtifactPath(descriptor, {
        sha256: sha256(replacementRaw),
        format: 'png'
      });
      const replacement = await finishRouteArtifact({
        bytes: replacementRaw,
        descriptor,
        profile: loaded.promptProfile
      });
      const replacementSource = await inspectImageContents(
        replacementRawPath,
        replacementRaw
      );
      const replacementCandidate = {
        ...structuredClone(candidate),
        derivation: {
          ...replacement.derivation,
          source: replacementSource
        },
        image: {
          path: candidate.image.path,
          bytes: replacement.bytes.length,
          width: 256,
          height: 128,
          format: 'png',
          sha256: sha256(replacement.bytes)
        }
      };
      await mkdir(path.dirname(path.join(root, replacementRawPath)), {
        recursive: true
      });
      await Promise.all([
        writeFile(path.join(root, replacementRawPath), replacementRaw),
        writeFile(
          path.join(root, candidate.image.path),
          replacement.bytes
        ),
        writeFile(
          path.join(candidateDirectory, 'result.json'),
          stableJson(replacementCandidate)
        )
      ]);
      await approveCandidate({
        root,
        theme: 'forest',
        family,
        reviewer: 'route-process-test',
        decision: 'approved',
        reason: 'Replacement B passes deterministic route-finishing review.',
        approvedAt: '2026-07-31T12:01:00.000Z'
      });
      assert.equal(
        (await auditBattleArtReviews({ root })).records,
        reviewCountBefore + 2
      );

      assert.deepEqual(await readFile(path.join(root, rawPath)), raw);
      const tamperedRaw = Buffer.from(raw);
      tamperedRaw[tamperedRaw.length - 1] ^= 1;
      await writeFile(path.join(root, rawPath), tamperedRaw);
      await assert.rejects(
        auditBattleArtReviews({ root }),
        /reviewed raw generated artifact hash pin mismatch/
      );
      await writeFile(path.join(root, rawPath), raw);
    });

  it('allows only the two exact approved pre-fix V2 direct-route attestations',
    async () => {
      const loaded = await loadBattleArt(REPOSITORY_ROOT);
      const families = [
        {
          id: 'forest-heartlands-loam-path-corner-sw',
          metadataSha256:
            'sha256:eacb2abd3b732bc792dd84d960773518f0fae4b3b5ec0d23d11c3cab706cb41e',
          reviewFullHash:
            'sha256:97ed6ab5f760c8541535d7019a4f9905ef9cb7033823f0f5a641453227bb10ce'
        },
        {
          id: 'forest-heartlands-loam-path-tee-nes',
          metadataSha256:
            'sha256:ee9bd5e81d3c25b48ba1176ef47393a3a8affdd0a110f39e0447afab29ac456a',
          reviewFullHash:
            'sha256:2d4fb53c9be6b8baf9bd79e5f9fb53e500e54e16c809e0c17013a2782fdba162'
        }
      ];
      for (const identity of families) {
        const entry = loaded.descriptors.find(
          value => value.descriptor.id === identity.id
        );
        const paths = candidatePaths(entry.descriptor);
        const metadataBytes = await readFile(path.join(
          REPOSITORY_ROOT,
          paths.metadata
        ));
        const candidate = JSON.parse(metadataBytes);
        const candidateBytes = await readFile(path.join(
          REPOSITORY_ROOT,
          candidate.image.path
        ));
        const metadataPin = {
          path: paths.metadata,
          bytes: metadataBytes.length,
          sha256: sha256(metadataBytes)
        };
        assert.equal(metadataPin.sha256, identity.metadataSha256);
        assert.equal(
          await verifyCandidateRouteDerivation({
            root: REPOSITORY_ROOT,
            descriptor: entry.descriptor,
            candidate,
            candidateBytes,
            profile: loaded.promptProfile,
            paths,
            candidateMetadataPin: metadataPin,
            reviewFullHash: identity.reviewFullHash
          }),
          null
        );

        const driftedCandidate = structuredClone(candidate);
        driftedCandidate.image.bytes += 1;
        await assert.rejects(
          verifyCandidateRouteDerivation({
            root: REPOSITORY_ROOT,
            descriptor: entry.descriptor,
            candidate: driftedCandidate,
            candidateBytes,
            profile: loaded.promptProfile,
            paths,
            candidateMetadataPin: metadataPin,
            reviewFullHash: identity.reviewFullHash
          }),
          /not exact allowlisted pre-fix evidence/
        );
        await assert.rejects(
          verifyCandidateRouteDerivation({
            root: REPOSITORY_ROOT,
            descriptor: entry.descriptor,
            candidate,
            candidateBytes,
            profile: loaded.promptProfile,
            paths,
            candidateMetadataPin: metadataPin,
            reviewFullHash: `sha256:${'0'.repeat(64)}`
          }),
          /not exact allowlisted pre-fix evidence/
        );
      }

      const [allowlisted] = families;
      const entry = loaded.descriptors.find(
        value => value.descriptor.id === allowlisted.id
      );
      const paths = candidatePaths(entry.descriptor);
      const candidate = (await readJson(
        REPOSITORY_ROOT,
        paths.metadata
      )).value;
      const nonallowlistedDescriptor = {
        ...structuredClone(entry.descriptor),
        id: 'forest-heartlands-loam-path-nonallowlisted-approved'
      };
      await assert.rejects(
        verifyCandidateRouteDerivation({
          root: REPOSITORY_ROOT,
          descriptor: nonallowlistedDescriptor,
          candidate: {
            ...structuredClone(candidate),
            familyId: nonallowlistedDescriptor.id
          },
          candidateBytes: await readFile(path.join(
            REPOSITORY_ROOT,
            candidate.image.path
          )),
          profile: loaded.promptProfile
        }),
        /not exact allowlisted pre-fix evidence/
      );
    });

  it('archives exact raw and one-call evidence when a direct route fails generic topology validation',
    async () => {
      const root = await fixture();
      const family = 'forest-heartlands-loam-path-straight-ns';
      const correctiveRegistry = (await readJson(
        root,
        CORRECTIVE_STYLE_REFERENCE_REGISTRY_PATH
      )).value;
      const registryFailureName = path.basename(
        correctiveRegistry.entries[0].failureRecord.path
      );
      const ignoreRules = await readFile(
        path.join(REPOSITORY_ROOT, '.gitignore'),
        'utf8'
      );
      assert.match(
        ignoreRules,
        /!ai-image-metadata\/\*\*\/\*\.json/
      );
      assert.match(
        ignoreRules,
        /ai-image-metadata\/battle-art\/candidates\/\*\*/
      );
      const raw = await addForbiddenEastArm(
        await reflectedHeartlandsStraightNs()
      );
      let workerCalls = 0;
      let nextRaw = raw;
      const worker = async input => {
        workerCalls += 1;
        const result = await candidateWorker(input);
        await replaceRouteWorkerCandidate({
          workspace: input.workspace,
          result,
          bytes: nextRaw
        });
        return result;
      };
      await assert.rejects(
        generateBattleArt({
          projectRoot: root,
          theme: 'forest',
          family,
          concurrency: 1,
          timeoutMs: 10_000,
          dryRun: false,
          force: false,
          resume: false
        }, { worker }),
        /diamond edge-band endpoints n,e,s do not match declared route topology straight-ns n,s/
      );
      assert.equal(workerCalls, 1);

      const loaded = await loadBattleArt(root);
      const descriptor = loaded.descriptors.find(
        entry => entry.descriptor.id === family
      ).descriptor;
      const rawPath = generatedArtifactPath(descriptor, {
        sha256: sha256(raw),
        format: 'png'
      });
      assert.deepEqual(await readFile(path.join(root, rawPath)), raw);
      const candidateDirectory = path.join(
        root,
        'ai-image-metadata/battle-art/candidates/forest',
        family
      );
      for (const file of ['candidate.png', 'candidate.webp', 'result.json']) {
        await assert.rejects(
          readFile(path.join(candidateDirectory, file)),
          error => error.code === 'ENOENT'
        );
      }

      const failureDirectory = path.join(
        path.dirname(path.join(root, rawPath)),
        'failures'
      );
      const [firstFailureName] = (await readdir(failureDirectory))
        .filter(name => name !== registryFailureName);
      assert.match(firstFailureName, /^[0-9a-f]{64}\.json$/);
      const firstFailureRelative = path.relative(
        root,
        path.join(failureDirectory, firstFailureName)
      );
      const firstFailureBytes = await readFile(
        path.join(root, firstFailureRelative)
      );
      const firstAudit = await auditFailedRouteAttempt({
        root,
        relativePath: firstFailureRelative
      });
      assert.equal(
        firstAudit.record.schemaVersion,
        'battle-art-route-failed-attempt-v1'
      );
      assert.deepEqual(firstAudit.record.raw, {
        path: rawPath,
        bytes: raw.length,
        width: 256,
        height: 128,
        format: 'png',
        sha256: sha256(raw)
      });
      assert.equal(
        firstAudit.record.descriptor.snapshot.content.version,
        descriptor.content.version
      );
      assert.equal(
        firstAudit.record.descriptor.sha256,
        sha256(Buffer.from(stableJson(descriptor)))
      );
      assert.match(firstAudit.record.prompt.text, /Frozen descriptor:/);
      assert.match(firstAudit.record.worker.stdout.text, /route-artifact-copy/);
      assert.equal(firstAudit.record.worker.stderr.text, '');
      assert.equal(firstAudit.record.worker.lastMessage.text,
        'generated one candidate\n');
      assert.equal(firstAudit.record.audit.imagegen.invocationCount, 1);
      assert.equal(
        firstAudit.record.audit.currentThread.id,
        'route-fixture-thread'
      );
      assert.match(
        firstAudit.record.rejection.message,
        /diamond edge-band endpoints n,e,s do not match declared route topology straight-ns n,s/
      );

      nextRaw = await addForbiddenEastArm(
        await reflectedHeartlandsStraightNs(),
        4
      );
      await assert.rejects(
        generateBattleArt({
          projectRoot: root,
          theme: 'forest',
          family,
          concurrency: 1,
          timeoutMs: 10_000,
          dryRun: false,
          force: true,
          resume: false
        }, { worker }),
        /diamond edge-band endpoints n,e,s do not match declared route topology straight-ns n,s/
      );
      assert.equal(workerCalls, 2);
      assert.deepEqual(
        await readFile(path.join(root, firstFailureRelative)),
        firstFailureBytes
      );
      const failureNames = (await readdir(failureDirectory))
        .filter(name => name !== registryFailureName)
        .toSorted();
      assert.equal(failureNames.length, 2);
      const secondFailureRelative = path.relative(
        root,
        path.join(
          failureDirectory,
          failureNames.find(name => name !== firstFailureName)
        )
      );
      const secondAudit = await auditFailedRouteAttempt({
        root,
        relativePath: secondFailureRelative
      });
      assert.equal(secondAudit.record.raw.sha256, sha256(nextRaw));
      assert.notEqual(
        secondAudit.record.fullHash,
        firstAudit.record.fullHash
      );

      const tamperedRecord = structuredClone(firstAudit.record);
      tamperedRecord.rejection.message = 'tampered rejection';
      await writeFile(
        path.join(root, firstFailureRelative),
        stableJson(tamperedRecord)
      );
      await assert.rejects(
        auditFailedRouteAttempt({
          root,
          relativePath: firstFailureRelative
        }),
        /fullHash does not match its content/
      );
      await writeFile(
        path.join(root, firstFailureRelative),
        firstFailureBytes
      );

      const tamperedLog = structuredClone(firstAudit.record);
      tamperedLog.worker.stdout.text += '{"type":"tampered"}\n';
      await writeFile(
        path.join(root, firstFailureRelative),
        stableJson(tamperedLog)
      );
      await assert.rejects(
        auditFailedRouteAttempt({
          root,
          relativePath: firstFailureRelative
        }),
        /worker\.stdout text identity does not match its pin/
      );
      await writeFile(
        path.join(root, firstFailureRelative),
        firstFailureBytes
      );

      const tamperedRaw = Buffer.from(raw);
      tamperedRaw[tamperedRaw.length - 1] ^= 1;
      await writeFile(path.join(root, rawPath), tamperedRaw);
      await assert.rejects(
        auditFailedRouteAttempt({
          root,
          relativePath: firstFailureRelative
        }),
        /hash pin mismatch/
      );
      await writeFile(path.join(root, rawPath), raw);
    });

  it('revalidates an immutable failed route attempt with zero worker calls and reviews its explicit v3 origin',
    async () => {
      const root = await fixture();
      const family = 'forest-heartlands-loam-path-corner-es';
      const failure = await copyFailedAttemptEvidence(
        root,
        HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
      );
      const failurePath = HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE;
      const failureBefore = await readFile(path.join(root, failurePath));
      const rawBefore = await readFile(path.join(root, failure.raw.path));
      let workerCalls = 0;
      const result = await revalidateFailedRouteAttempt({
        root,
        theme: 'forest',
        family,
        failure: failurePath
      }, {
        worker: async () => {
          workerCalls += 1;
          throw new Error('revalidation must not invoke a worker');
        }
      });
      assert.equal(workerCalls, 0);
      assert.equal(result.results[0].status, 'revalidated');

      const loaded = await loadBattleArt(root);
      const entry = loaded.descriptors.find(
        value => value.descriptor.id === family
      );
      const paths = candidatePaths(entry.descriptor);
      const candidate = (await readJson(root, paths.metadata)).value;
      assert.equal(candidate.schemaVersion, REVALIDATED_CANDIDATE_SCHEMA);
      assert.equal(Object.hasOwn(candidate, 'worker'), false);
      assert.equal(
        candidate.origin.kind,
        'failed-attempt-revalidation-v1'
      );
      assert.deepEqual(candidate.origin.raw, failure.raw);
      assert.deepEqual(candidate.derivation.source, failure.raw);
      assert.deepEqual(candidate.origin.originalDescriptor, {
        path: failure.descriptor.path,
        sha256: failure.descriptor.sha256,
        contentVersion: failure.descriptor.contentVersion
      });
      assert.deepEqual(candidate.origin.failureRecord, {
        path: failurePath,
        sha256: sha256(failureBefore),
        fullHash: failure.fullHash
      });
      assert.equal(
        candidate.origin.validationDescriptorSha256,
        candidate.descriptorSha256
      );
      assert.deepEqual(
        await readFile(path.join(root, failure.raw.path)),
        rawBefore
      );
      assert.deepEqual(
        await readFile(
          path.join(root, failurePath)
        ),
        failureBefore
      );

      const candidateMetadataBefore = await readFile(path.join(
        root,
        paths.metadata
      ));
      const tamperedCandidate = structuredClone(candidate);
      tamperedCandidate.origin.failureRecord.sha256 =
        `sha256:${'0'.repeat(64)}`;
      await writeFile(
        path.join(root, paths.metadata),
        stableJson(tamperedCandidate)
      );
      await assert.rejects(
        recordCandidateReview({
          root,
          theme: 'forest',
          family,
          reviewer: 'revalidation-reviewer@example.test',
          decision: 'approved',
          reason: 'The archived raw now passes every current deterministic route contract.',
          reviewedAt: '2026-08-04T18:00:00.000Z'
        }),
        /origin does not match its audited failed attempt/
      );
      await writeFile(path.join(root, paths.metadata), candidateMetadataBefore);

      const review = await recordCandidateReview({
        root,
        theme: 'forest',
        family,
        reviewer: 'revalidation-reviewer@example.test',
        decision: 'approved',
        reason: 'The archived raw now passes every current deterministic route contract.',
        reviewedAt: '2026-08-04T18:00:00.000Z'
      });
      assert.equal(review.record.schemaVersion, REVALIDATED_REVIEW_SCHEMA);
      assert.deepEqual(review.record.candidate.origin, candidate.origin);
      assert.equal(Object.hasOwn(review.record.candidate, 'worker'), false);
      const approval = await approveCandidate({
        root,
        theme: 'forest',
        family,
        reviewer: 'revalidation-reviewer@example.test',
        decision: 'approved',
        reason: 'The archived raw now passes every current deterministic route contract.',
        approvedAt: '2026-08-04T18:00:00.000Z'
      });
      assert.equal(approval.sourceSha256, candidate.image.sha256);
      assert.deepEqual(await auditBattleArtReviews({ root }), {
        ok: true,
        records: 2,
        approved: 2,
        rejected: 0
      });
    });

  it('rejects tampered, wrong-family, noncanonical, duplicate, and still-failing replay attempts without publication',
    async () => {
      const family = 'forest-heartlands-loam-path-corner-es';
      const options = (root, failure) => ({
        root,
        theme: 'forest',
        family,
        failure
      });

      const tamperedRoot = await fixture({
        preserveDirectStyleProvenance: true
      });
      await copyFailedAttemptEvidence(
        tamperedRoot,
        HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
      );
      const tampered = JSON.parse(await readFile(
        path.join(tamperedRoot, HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE),
        'utf8'
      ));
      tampered.rejection.message = 'tampered';
      await writeFile(
        path.join(tamperedRoot, HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE),
        stableJson(tampered)
      );
      await assert.rejects(
        revalidateFailedRouteAttempt(options(
          tamperedRoot,
          HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
        )),
        /fullHash does not match its content/
      );

      const wrongFamilyRoot = await fixture({
        preserveDirectStyleProvenance: true
      });
      await copyFailedAttemptEvidence(
        wrongFamilyRoot,
        HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
      );
      await assert.rejects(
        revalidateFailedRouteAttempt({
          root: wrongFamilyRoot,
          theme: 'forest',
          family: 'forest-heartlands-loam-path-straight-ns',
          failure: HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
        }),
        /failed-attempt record belongs to/
      );

      const noncanonicalRoot = await fixture({
        preserveDirectStyleProvenance: true
      });
      const copied = await copyFailedAttemptEvidence(
        noncanonicalRoot,
        HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
      );
      const noncanonical =
        'ai-image-metadata/battle-art/generated-artifacts/forest/'
        + 'forest-heartlands-loam-path-corner-es/failures/not-canonical.json';
      await mkdir(path.dirname(path.join(noncanonicalRoot, noncanonical)), {
        recursive: true
      });
      await writeFile(
        path.join(noncanonicalRoot, noncanonical),
        stableJson(copied)
      );
      await assert.rejects(
        revalidateFailedRouteAttempt(options(
          noncanonicalRoot,
          noncanonical
        )),
        /path is not content-addressed/
      );

      const existingRoot = await fixture({
        preserveDirectStyleProvenance: true
      });
      await copyFailedAttemptEvidence(
        existingRoot,
        HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
      );
      const existingPaths = candidatePaths({
        theme: 'forest',
        id: family
      });
      await mkdir(
        path.dirname(path.join(existingRoot, existingPaths.metadata)),
        { recursive: true }
      );
      await writeFile(
        path.join(existingRoot, existingPaths.metadata),
        '{}'
      );
      await assert.rejects(
        revalidateFailedRouteAttempt(options(
          existingRoot,
          HEARTLANDS_CORNER_ES_REVALIDATABLE_FAILURE
        )),
        /requires no existing candidate publication/
      );

      const failingRoot = await fixture();
      await retainTrackedApprovedV1Evidence(
        failingRoot,
        'forest-borderwood-dirt-path-corner-es'
      );
      const stillFailing = await syntheticRevalidatableCornerEsFailure(
        failingRoot,
        { upperCorePixel: { x: 128, y: 32 } }
      );
      const failedRecordBefore = await readFile(path.join(
        failingRoot,
        stillFailing.path
      ));
      const failedRawBefore = await readFile(path.join(
        failingRoot,
        stillFailing.record.raw.path
      ));
      await assert.rejects(
        revalidateFailedRouteAttempt(options(
          failingRoot,
          stillFailing.path
        )),
        /upper-center exclusion contains alpha-at-least-240 at 128,32/
      );
      const failedPaths = candidatePaths({
        theme: 'forest',
        id: family
      });
      for (const relative of [
        failedPaths.imagePng,
        failedPaths.imageWebp,
        failedPaths.metadata
      ]) {
        await assert.rejects(
          readFile(path.join(failingRoot, relative)),
          error => error.code === 'ENOENT'
        );
      }
      assert.deepEqual(
        await readFile(
          path.join(failingRoot, stillFailing.path)
        ),
        failedRecordBefore
      );
      assert.deepEqual(
        await readFile(path.join(failingRoot, stillFailing.record.raw.path)),
        failedRawBefore
      );
    });

  it('keeps ordinary v2 candidate and review evidence unchanged', async () => {
    const root = await fixture({ preserveDirectStyleProvenance: true });
    const family = 'forest-moss-surface';
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    const loaded = await loadBattleArt(root);
    const entry = loaded.descriptors.find(
      value => value.descriptor.id === family
    );
    const candidate = (await readJson(
      root,
      candidatePaths(entry.descriptor).metadata
    )).value;
    assert.equal(candidate.schemaVersion, 'battle-art-candidate-v2');
    assert.equal(Object.hasOwn(candidate, 'origin'), false);
    const review = await recordCandidateReview({
      root,
      theme: 'forest',
      family,
      reviewer: 'v2-compatibility-reviewer@example.test',
      decision: 'rejected',
      reason: 'This preserves the existing v2 review evidence layout.',
      reviewedAt: '2026-08-04T18:30:00.000Z'
    });
    assert.equal(review.record.schemaVersion, REVIEW_SCHEMA);
    assert.equal(Object.hasOwn(review.record.candidate, 'origin'), false);
  });

  it('backfills the frozen v6 8f1a failure after the descriptor advances',
    async () => {
      const root = await fixture();
      const family = 'forest-heartlands-loam-path-straight-ns';
      const candidateRelative =
        `ai-image-metadata/battle-art/candidates/forest/${family}`;
      const generatedRelative =
        `ai-image-metadata/battle-art/generated-artifacts/forest/${family}`;
      const frozenFailureRelative =
        `${generatedRelative}/failures/`
        + '6c6cfe321ebce0b5f5504dd03c8181a466f0158d030605c2072af1ac850e8b88.json';
      const rawHash =
        'sha256:8f1a1f33653dcc691c25e8601301002e762deb59e1db645b13efcce36c7190a5';
      await Promise.all([
        mkdir(path.join(root, candidateRelative), { recursive: true }),
        mkdir(path.join(root, generatedRelative), { recursive: true })
      ]);
      const frozenFailure = JSON.parse(await readFile(
        path.join(REPOSITORY_ROOT, frozenFailureRelative),
        'utf8'
      ));
      for (const [file, evidence] of [
        ['prompt.txt', frozenFailure.prompt],
        ['worker.jsonl', frozenFailure.worker.stdout],
        ['worker.stderr.log', frozenFailure.worker.stderr],
        ['last-message.txt', frozenFailure.worker.lastMessage]
      ]) {
        assert.equal(evidence.path, `${candidateRelative}/${file}`);
        await writeFile(
          path.join(root, candidateRelative, file),
          evidence.text
        );
      }
      await copyFile(
        path.join(
          REPOSITORY_ROOT,
          generatedRelative,
          `${rawHash.slice('sha256:'.length)}.png`
        ),
        path.join(
          root,
          generatedRelative,
          `${rawHash.slice('sha256:'.length)}.png`
        )
      );

      const backfill = await backfillFailedRouteAttempt({
        root,
        theme: 'forest',
        family,
        rawSha256: rawHash,
        timeoutMs: 900_000,
        rejection: {
          name: 'Error',
          message:
            'forest-heartlands-loam-path-straight-ns generated candidate '
            + 'alpha silhouette is an opaque rectangular panel '
            + '(901‰ bounding-box fill)'
        }
      });
      assert.equal(backfill.adopted, false);
      assert.equal(backfill.record.descriptor.contentVersion, 6);
      assert.equal(backfill.record.descriptor.snapshot.content.version, 6);
      assert.equal(backfill.record.raw.sha256, rawHash);
      assert.equal(backfill.record.raw.width, 1774);
      assert.equal(backfill.record.raw.height, 887);
      assert.equal(
        backfill.record.rejection.message,
        'forest-heartlands-loam-path-straight-ns generated candidate '
          + 'alpha silhouette is an opaque rectangular panel '
          + '(901‰ bounding-box fill)'
      );
      assert.equal(
        backfill.record.audit.currentThread.id,
        '019fbaa5-8176-7603-b12e-7e6c24b1da1c'
      );
      assert.equal(
        (
          await auditFailedRouteAttempt({
            root,
            relativePath: backfill.path
          })
        ).record.fullHash,
        backfill.record.fullHash
      );

      const adopted = await backfillFailedRouteAttempt({
        root,
        theme: 'forest',
        family,
        rawSha256: rawHash,
        timeoutMs: 900_000,
        rejection: {
          name: 'Error',
          message:
            'forest-heartlands-loam-path-straight-ns generated candidate '
            + 'alpha silhouette is an opaque rectangular panel '
            + '(901‰ bounding-box fill)'
        }
      });
      assert.equal(adopted.adopted, true);
      assert.equal(adopted.path, backfill.path);
      assert.deepEqual(adopted.record, backfill.record);

      await assert.rejects(
        backfillFailedRouteAttempt({
          root,
          theme: 'forest',
          family,
          rawSha256: rawHash,
          timeoutMs: 900_000
        }),
        /original rejection name and message are required/
      );
      await assert.rejects(
        backfillFailedRouteAttempt({
          root,
          theme: 'forest',
          family,
          rawSha256: `sha256:${'0'.repeat(64)}`,
          timeoutMs: 900_000,
          rejection: backfill.record.rejection
        }),
        /restricted to the exact frozen v6/
      );
      await assert.rejects(
        backfillFailedRouteAttempt({
          root,
          theme: 'forest',
          family,
          rawSha256: rawHash,
          timeoutMs: 900_000,
          rejection: {
            name: 'Error',
            message: 'invented rejection'
          }
        }),
        /restricted to the exact frozen v6/
      );

      const evidenceBytes = await readFile(path.join(root, backfill.path));
      const descriptorTamper = structuredClone(backfill.record);
      descriptorTamper.descriptor.snapshot.unexpected = true;
      await writeFile(
        path.join(root, backfill.path),
        stableJson(descriptorTamper)
      );
      await assert.rejects(
        auditFailedRouteAttempt({
          root,
          relativePath: backfill.path
        }),
        /descriptor\.snapshot\.unexpected is not allowed/
      );
      await writeFile(path.join(root, backfill.path), evidenceBytes);

      const failureDirectory = path.dirname(path.join(root, backfill.path));
      const realFailureDirectory = `${failureDirectory}-real`;
      await rename(failureDirectory, realFailureDirectory);
      await symlink(realFailureDirectory, failureDirectory, 'dir');
      await assert.rejects(
        auditFailedRouteAttempt({
          root,
          relativePath: backfill.path
        }),
        /must not contain symbolic links/
      );
      await unlink(failureDirectory);
      await rename(realFailureDirectory, failureDirectory);
    });

  it('rejects a connected forbidden arm before route review publication',
    async () => {
      const root = await fixture();
      const family = 'forest-heartlands-loam-path-straight-ns';
      const raw = await addForbiddenEastArm(
        await reflectedHeartlandsStraightNs()
      );
      let workerCalls = 0;
      await assert.rejects(
        generateBattleArt({
          projectRoot: root,
          theme: 'forest',
          family,
          concurrency: 1,
          timeoutMs: 10_000,
          dryRun: false,
          force: false,
          resume: false
        }, {
          worker: async input => {
            workerCalls += 1;
            const result = await candidateWorker(input);
            await replaceRouteWorkerCandidate({
              workspace: input.workspace,
              result,
              bytes: raw
            });
            return result;
          }
        }),
        /diamond edge-band endpoints n,e,s do not match declared route topology straight-ns n,s/
      );
      assert.equal(workerCalls, 1);

      const loaded = await loadBattleArt(root);
      const descriptor = loaded.descriptors.find(
        entry => entry.descriptor.id === family
      ).descriptor;
      const rawPath = generatedArtifactPath(descriptor, {
        sha256: sha256(raw),
        format: 'png'
      });
      assert.deepEqual(await readFile(path.join(root, rawPath)), raw);
      const candidateDirectory = path.join(
        root,
        'ai-image-metadata/battle-art/candidates/forest',
        family
      );
      for (const file of ['candidate.png', 'candidate.webp', 'result.json']) {
        await assert.rejects(
          readFile(path.join(candidateDirectory, file)),
          error => error.code === 'ENOENT'
        );
      }
    });

  it('rejects a known overlong direct straight route before review publication',
    async () => {
    const root = await fixture();
    const family = 'forest-heartlands-loam-path-straight-ns';
    const raw = await readFile(path.join(
      REPOSITORY_ROOT,
      HEARTLANDS_STRAIGHT_NS_V12_OVERLONG_RAW
    ));
    let rejection;
    await assert.rejects(
      generateBattleArt({
        projectRoot: root,
        theme: 'forest',
        family,
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, {
        worker: async input => {
          const result = await candidateWorker(input);
          await replaceRouteWorkerCandidate({
            workspace: input.workspace,
            result,
            bytes: raw
          });
          return result;
        }
      }),
      error => {
        rejection = error;
        return /terminal clipping would remove 56‰ of covered pixels; expected at most 50‰/
          .test(error.message);
      }
    );

    const loaded = await loadBattleArt(root);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === family
    ).descriptor;
    const rawPath = generatedArtifactPath(descriptor, {
      sha256: sha256(raw),
      format: 'png'
    });
    assert.deepEqual(await readFile(path.join(root, rawPath)), raw);
    const candidateRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest',
      family
    );
    for (const file of ['candidate.png', 'candidate.webp', 'result.json']) {
      await assert.rejects(
        readFile(path.join(candidateRoot, file)),
        error => error.code === 'ENOENT'
      );
    }
    const failure = await auditFailedRouteAttempt({
      root,
      relativePath: rejection.failedAttemptEvidencePath
    });
    assert.equal(failure.record.raw.sha256, sha256(raw));
    assert.match(
      failure.record.rejection.message,
      /terminal clipping would remove 56‰ of covered pixels/
    );
  });

  it('rejects straight routes that continue toward rectangular canvas corners',
    async () => {
      const canvas = { width: 256, height: 128 };
      const anchor = { x: 128, y: 64 };
      const cases = [
        {
          topology: 'straight-ns',
          vector: { x: 64, y: -32 },
          directions: ['n', 's'],
          lastAllowedPixel: { x: 200, y: 31 },
          firstRejectedPixel: { x: 201, y: 32 }
        },
        {
          topology: 'straight-ew',
          vector: { x: 64, y: 32 },
          directions: ['e', 'w'],
          lastAllowedPixel: { x: 200, y: 97 },
          firstRejectedPixel: { x: 201, y: 96 }
        }
      ];
      const encode = async ({
        vector,
        extension = 1,
        extraPixels = [],
        extraSegments = []
      }) => {
        const pixels = Buffer.alloc(canvas.width * canvas.height * 4);
        const start = {
          x: anchor.x - (vector.x * extension),
          y: anchor.y - (vector.y * extension)
        };
        const end = {
          x: anchor.x + (vector.x * extension),
          y: anchor.y + (vector.y * extension)
        };
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const route = distanceToSegment(x, y, start, end) <= 6
              || extraSegments.some(segment => (
                distanceToSegment(x, y, segment.start, segment.end) <= 1
              ));
            if (!route) continue;
            pixels.set(
              [117, 76, 36, 255],
              ((y * canvas.width) + x) * 4
            );
          }
        }
        for (const extraPixel of extraPixels) {
          pixels.set(
            [117, 76, 36, 255],
            ((extraPixel.y * canvas.width) + extraPixel.x) * 4
          );
        }
        return sharp(pixels, {
          raw: { ...canvas, channels: 4 }
        }).png().toBuffer();
      };

      for (const testCase of cases) {
        const descriptor = {
          schemaVersion: 'battle-art-family-descriptor-v2',
          id: `test-${testCase.topology}-extent`,
          category: 'route-transition',
          capabilities: { routeTopology: testCase.topology },
          canvas,
          placement: { anchor }
        };
        const valid = await assertRouteStraightMaximumLongitudinalExtent({
          bytes: await encode({ vector: testCase.vector }),
          descriptor
        });
        assert.deepEqual(
          valid.samples.map(({ direction }) => direction),
          testCase.directions
        );
        assert.ok(valid.samples.every(({ maximumOverflowPixels }) => (
          maximumOverflowPixels <= 8
        )));
        const boundary = await assertRouteStraightMaximumLongitudinalExtent({
          bytes: await encode({
            vector: testCase.vector,
            extraPixels: [testCase.lastAllowedPixel]
          }),
          descriptor
        });
        assert.ok(boundary.samples.some(({ maximumOverflowPixels }) => (
          maximumOverflowPixels > 7.5 && maximumOverflowPixels <= 8
        )));
        await assert.rejects(
          assertRouteStraightMaximumLongitudinalExtent({
            bytes: await encode({
              vector: testCase.vector,
              extraPixels: [testCase.firstRejectedPixel]
            }),
            descriptor
          }),
          /arm reaches [0-9.]+ pixels beyond .* expected at most 8 pixels/
        );
        await assert.rejects(
          assertRouteStraightMaximumLongitudinalExtent({
            bytes: await encode({
              vector: testCase.vector,
              extension: 1.5
            }),
            descriptor
          }),
          /arm reaches [0-9.]+ pixels beyond .* expected at most 8 pixels/
        );
      }

      const descriptor = {
        schemaVersion: 'battle-art-family-descriptor-v2',
        id: 'test-straight-ns-off-axis-spur',
        category: 'route-transition',
        capabilities: { routeTopology: 'straight-ns' },
        canvas,
        placement: { anchor }
      };
      await assert.rejects(
        assertRouteStraightMaximumLongitudinalExtent({
          bytes: await encode({
            vector: cases[0].vector,
            extraSegments: [
              {
                start: { x: 192, y: 32 },
                end: { x: 221, y: 90 }
              },
              {
                start: { x: 221, y: 90 },
                end: { x: 239, y: 81 }
              }
            ]
          }),
          descriptor
        }),
        /arm reaches [0-9.]+ pixels beyond .* expected at most 8 pixels/
      );
      await assert.doesNotReject(
        assertRouteStraightMaximumLongitudinalExtent({
          bytes: Buffer.from('not an image'),
          descriptor: {
            ...descriptor,
            capabilities: { routeTopology: 'corner-ne' }
          }
        })
      );
    });

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

  it('uses ephemeral workers and fails live generation closed to one family at concurrency one',
    async () => {
    assert.deepEqual(
      {
        concurrency: parseGenerateArgs([]).concurrency,
        textStyleFallback: parseGenerateArgs([]).textStyleFallback
      },
      { concurrency: 1, textStyleFallback: false }
    );
    assert.equal(parseGenerateArgs(['--concurrency', '4']).concurrency, 4);
    assert.equal(
      parseGenerateArgs(['--text-style-fallback']).textStyleFallback,
      true
    );
    assert.equal(parseGenerateArgs(['--keep-going']).keepGoing, true);
    const recovery = parseGenerateArgs([
      '--family',
      'forest-heartlands-loam-path-straight-ns',
      '--recover',
      '--timeout',
      '900'
    ]);
    assert.equal(recovery.recover, true);
    assert.equal(recovery.timeoutProvided, true);
    assert.equal(recovery.timeoutMs, 900_000);
    assert.throws(() => parseGenerateArgs(['--concurrency', '5']), /between 1 and 4/);
    assert.throws(
      () => parseGenerateArgs(['--text-style-fallback=true']),
      /unknown generate argument/
    );
    const root = await fixture();
    let workerCalls = 0;
    const base = {
      projectRoot: root,
      theme: 'forest',
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    };
    const dependencies = {
      worker: async () => {
        workerCalls += 1;
        throw new Error('fail-closed validation reached worker');
      }
    };
    await assert.rejects(
      generateBattleArt(base, dependencies),
      /requires exactly one explicit --family/
    );
    await assert.rejects(
      generateBattleArt({
        ...base,
        families: ['forest-moss-surface', 'forest-moss-surface']
      }, dependencies),
      /requires exactly one explicit --family/
    );
    await assert.rejects(
      generateBattleArt({
        ...base,
        family: 'forest-moss-surface',
        families: ['forest-moss-surface']
      }, dependencies),
      /accepts only one --family selection form/
    );
    await assert.rejects(
      generateBattleArt({
        ...base,
        family: 'forest-moss-surface',
        concurrency: 2
      }, dependencies),
      /requires --concurrency 1/
    );
    await assert.rejects(
      generateBattleArt({
        ...base,
        family: 'forest-moss-surface',
        keepGoing: true
      }, dependencies),
      /cannot use --keep-going/
    );
    assert.equal(workerCalls, 0);
    const args = buildCodexArgs('/tmp/workspace', '/tmp/workspace/last-message.txt');
    assert.equal(args[0], 'exec');
    assert.ok(args.includes('--ephemeral'));
    assert.deepEqual(
      args.slice(args.indexOf('--enable'), args.indexOf('--enable') + 2),
      ['--enable', 'image_generation']
    );
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
    const stagedImages = [
      stagedImage,
      '/tmp/workspace/style-reference-02.png'
    ];
    const argsWithTwoImages = buildCodexArgs(
      '/tmp/workspace',
      '/tmp/workspace/last-message.txt',
      stagedImages
    );
    assert.deepEqual(
      argsWithTwoImages.flatMap((argument, index) =>
        argument === '--image' ? [argsWithTwoImages[index + 1]] : []
      ),
      stagedImages
    );
    assert.equal(countImagegenInvocations(Buffer.from(
      '{"type":"item.completed","item":{"id":"one","type":"mcp_tool_call",'
      + '"server":"image_gen","tool":"imagegen"}}\n'
    )), 1);
    assert.equal(countImagegenInvocations(Buffer.from(
      '{"type":"thread.started","thread_id":"thread-1"}\n'
      + '{"type":"item.completed","item":{"type":"command_execution","command":'
      + '"/bin/cp /home/test/.codex/generated_images/thread-1/'
      + 'call_Abc123.png candidate.png","status":"completed","exit_code":0}}\n'
    )), 1);
  });

  it('rejects procedural raster synthesis in worker finishing evidence', () => {
    const evidence = command => Buffer.from(`${JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command,
        status: 'completed',
        exit_code: 0
      }
    })}\n`);
    assert.deepEqual(
      assertNoProceduralRasterSynthesis(evidence(
        'python3 -c "im=Image.open(p).resize((256,128)); '
        + 'pix[x,y]=(r,g,b,0); im.save(p)"'
      )),
      { commandCount: 1 }
    );
    for (const [command, expected] of [
      ['out=Image.new("RGBA",(256,128))', /new RGBA canvas/],
      ['def donor(x,y): return source[x,y]', /donor-pixel synthesis/],
      ['ImageDraw.Draw(im).polygon(points)', /procedural drawing/],
      ['im.putpixel((x,y), color)', /procedural pixel painting/]
    ]) {
      assert.throws(
        () => assertNoProceduralRasterSynthesis(evidence(command)),
        expected
      );
    }
  });

  it('requires one skill read and one current-thread artifact copy for routes', () => {
    const thread = JSON.stringify({
      type: 'thread.started',
      thread_id: 'route-copy-test'
    });
    const imagegen = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'imagegen',
        type: 'mcp_tool_call',
        server: 'image_gen',
        tool: 'imagegen',
        status: 'completed'
      }
    });
    const command = (id, value) => JSON.stringify({
      type: 'item.completed',
      item: {
        id,
        type: 'command_execution',
        command: value,
        status: 'completed',
        exit_code: 0
      }
    });
    const copy = command(
      'copy',
      '/bin/bash -lc \'/bin/cp '
        + '"/tmp/.codex/generated_images/route-copy-test/'
        + 'call_RouteCopyTest.png" "candidate.png"\''
    );
    const skillRead = command(
      'skill-read',
      `/bin/bash -lc '${CANONICAL_ROUTE_SKILL_READ_COMMAND}'`
    );
    const evidence = values => Buffer.from(
      [thread, ...values].join('\n') + '\n'
    );
    assert.deepEqual(
      assertSingleGeneratedArtifactCopyEvidence(evidence([
        skillRead,
        imagegen,
        copy
      ])),
      {
        artifactPath:
          '/tmp/.codex/generated_images/route-copy-test/'
          + 'call_RouteCopyTest.png',
        threadId: 'route-copy-test',
        skillReadCommand: CANONICAL_ROUTE_SKILL_READ_COMMAND
      }
    );
    assert.throws(
      () => assertSingleGeneratedArtifactCopyEvidence(evidence([imagegen])),
      /exactly two commands: read the imagegen skill once/
    );
    assert.throws(
      () => assertSingleGeneratedArtifactCopyEvidence(evidence([
        imagegen,
        skillRead,
        copy,
        command('inspect', 'identify candidate.png')
      ])),
      /observed 1 skill reads, 1 artifact copies, and 3 commands/
    );
    assert.throws(
      () => assertSingleGeneratedArtifactCopyEvidence(evidence([
        skillRead,
        copy,
        imagegen
      ])),
      /only after imagegen completion/
    );
    const imagegenStarted = JSON.stringify({
      type: 'item.started',
      item: {
        id: 'imagegen',
        type: 'mcp_tool_call',
        server: 'image_gen',
        tool: 'imagegen',
        status: 'in_progress'
      }
    });
    assert.throws(
      () => assertSingleGeneratedArtifactCopyEvidence(evidence([
        imagegenStarted,
        skillRead,
        imagegen,
        copy
      ])),
      /read the skill before observable imagegen execution/
    );
    assert.throws(
      () => assertSingleGeneratedArtifactCopyEvidence(evidence([
        skillRead,
        imagegenStarted,
        copy
      ])),
      /observable imagegen invocation did not complete successfully/
    );
    assert.throws(
      () => assertSingleGeneratedArtifactCopyEvidence(Buffer.from([
        thread,
        skillRead,
        imagegen,
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'write',
            type: 'file_change',
            path: 'candidate.png'
          }
        }),
        copy
      ].join('\n') + '\n')),
      /must not write candidate\.png through a direct file-change operation/
    );
    for (const unsafeCopy of [
      '/bin/bash -lc \'/bin/cp '
        + '"/tmp/.codex/generated_images/route-copy-test/'
        + 'call_RouteCopyTest.png" "$TARGET"\'',
      '/bin/bash -lc \'/bin/cp '
        + '"/tmp/.codex/generated_images/route-copy-test/'
        + 'call_RouteCopyTest.png" "candidate.png; /bin/true"\'',
      '/bin/bash -lc \'/bin/cp '
        + '"/tmp/.codex/generated_images/route-copy-test/'
        + 'call_RouteCopyTest.png" "candidate.png $(printf bad)"\'',
      '/bin/bash -lc \'/bin/cp '
        + '"/tmp/.codex/generated_images/route-copy-test/'
        + 'call_RouteCopyTest.png" "candidate.png" extra\'',
      '/bin/bash -lc \'/bin/cp '
        + '"/tmp/.codex/generated_images/route-copy-test/'
        + 'call_RouteCopyTest.png" "../candidate.png"\''
    ]) {
      assert.throws(
        () => assertSingleGeneratedArtifactCopyEvidence(evidence([
          skillRead,
          imagegen,
          command('unsafe-copy', unsafeCopy)
        ])),
        /observed 1 skill reads, 0 artifact copies, and 2 commands/,
        `must reject unsafe route artifact copy: ${unsafeCopy}`
      );
    }
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
    assert.match(prompt, /Do not approve, pin,\s+compile, publish/);
    assert.match(prompt, /descriptor\.json/);
    assert.match(prompt, /style-reference-01\.png/);
    assert.match(prompt, /already attached to this worker turn/);
    assert.match(prompt, /Do not call a local image-view tool/);
    assert.match(prompt, /do not pass those paths through referenced_image_paths/);
    assert.match(prompt, /set num_last_images_to_include to exactly 1/);
    assert.match(prompt, /standalone command\s+that exits successfully/);
    assert.match(prompt, /artifact-copy command exactly once/);
    assert.match(prompt, /never copy the generated source artifact .* a second time/);
    assert.match(prompt, /first and\s+only copy is explicitly an unprocessed source/);
    assert.match(
      prompt,
      /authorizes deterministic in-place overwrites.*until the final saved raster passes/s
    );
    assert.match(prompt, /Immediately\s+after the one source copy, inspect only its dimensions/);
    assert.match(prompt, /resize the entire copied raster to the exact declared/);
    assert.match(prompt, /Never leave the raw model dimensions/);
    assert.match(prompt, /Never create\s+a new RGBA canvas/);
    assert.match(prompt, /copy or sample donor RGB into another pixel/);
    assert.match(prompt, /procedurally draw geometry/);
    assert.match(prompt, /If the raw generated subject cannot meet the contract/);
    assert.match(prompt, /do not chain file, identify, or any other inspection utility/);
    assert.match(prompt, /report the result and\s+end immediately/);
    const twoReferencePrompt = buildGenerationPrompt({
      descriptor,
      profile,
      styleFiles: [
        'style-reference-01.png',
        'style-reference-02.png'
      ]
    });
    assert.match(twoReferencePrompt, /style-reference-02\.png/);
    assert.match(
      twoReferencePrompt,
      /set num_last_images_to_include to exactly 2/
    );
    const twoReferenceFallback = buildGenerationPrompt({
      descriptor,
      profile,
      styleFiles: [
        'style-reference-01.png',
        'style-reference-02.png'
      ],
      textStyleFallback: true
    });
    assert.match(
      twoReferenceFallback,
      /2 hash-pinned style reference binaries remain staged/
    );
    assert.match(twoReferenceFallback, /Do not open them/);
    assert.doesNotMatch(twoReferenceFallback, /binary remains staged/);
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

  it('keeps stairs transverse and slopes unobstructed during finishing', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const stairs = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-heartlands-fieldstone-stairs-e'
    ).descriptor;
    const slope = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-heartlands-loam-slope-w'
    ).descriptor;
    const stairsPrompt = buildGenerationPrompt({
      descriptor: stairs,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    const slopePrompt = buildGenerationPrompt({
      descriptor: slope,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(stairsPrompt, /36–48 pixel wide loam-and-grass stair bed/);
    assert.match(stairsPrompt, /four to six broad cream-gray fieldstone tread caps/);
    assert.match(stairsPrompt, /running crosswise, perpendicular/);
    assert.match(stairsPrompt, /visible 6–10 pixel deep top plane above a shallow riser/);
    assert.match(stairsPrompt, /Never turn the stair into a thin lengthwise braid/);
    assert.match(stairsPrompt, /row of upright ribs, fence, palisade, retaining wall/);
    assert.match(slopePrompt, /walkable center of the grade unobstructed/);
    assert.match(slopePrompt, /add no shrub or tree clump on the grade/);
    assert.match(slopePrompt, /rock-lined causeway, retaining wall/);
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

  it('places corner-es on the approved lower-seam anchor arch', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-heartlands-loam-path-corner-es'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.equal(descriptor.styleReferences.length, 1);
    assert.equal(
      descriptor.styleReferences[0].id,
      'forest-borderwood-approved-route-corner-es-v1'
    );
    assert.equal(descriptor.content.version, 9);
    const imageFacingWordCount = descriptor.generationPrompt
      .trim()
      .split(/\s+/u)
      .length;
    assert.ok(
      imageFacingWordCount >= 100 && imageFacingWordCount <= 170,
      `corner-es image-facing edit brief has ${imageFacingWordCount} words; `
        + 'expected 100–170'
    );
    assert.doesNotMatch(
      descriptor.generationPrompt,
      /alpha-at-least|fitter|permille/
    );
    assert.match(prompt, /num_last_images_to_include to exactly 1/);
    assert.equal(
      (prompt.match(/call the imagegen tool exactly once/g) ?? []).length,
      1
    );
    assert.match(prompt, /flat rounded anchor arch/);
    assert.match(prompt, /approved Borderwood corner-es topology/);
    assert.match(prompt, /tips at 25% and 75% canvas width and 75% canvas height/);
    assert.match(prompt, /50% width and 50% canvas height/);
    assert.match(
      prompt,
      /shared apex core x=120\.\.135 fully opaque for at least 29\s+consecutive rows/
    );
    assert.match(
      prompt,
      /apex core x=120\.\.135 remains below alpha 240 through y=32/
    );
    assert.match(prompt, /bounded\s+22-pixel upward shift/);
    assert.match(prompt, /Do not invert this into a\s+classic upright U/);
    assert.match(prompt, /raw imagegen subject itself/);
    assert.match(
      prompt,
      /Deterministic finishing may\s+only place the complete generated subject/i
    );
    assert.match(prompt, /nearly constant 30–41 pixels wide through/);
    assert.match(
      prompt,
      /complete visible silhouette is\s+30–41 pixels wide, including the warm-loam core and\s+all grass or leaf verge pixels/
    );
    assert.match(
      prompt,
      /Keep low verge decoration sparse, broken, and attached inside that total band/
    );
    assert.match(
      prompt,
      /Do not rely on partial transparency for shape or softness: express softness through a low irregular silhouette and blended materials/
    );
    assert.match(prompt, /continuous rhythm of upright grass teeth/);
    assert.match(prompt, /redrawing a tall deep\s+semicircle/i);
    assert.match(prompt, /Prefer 34–36 pixels at each of the six samples/);
    assert.match(prompt, /never taper the E arm toward its 75% or 100%/);
    assert.match(prompt, /Do not add an oval central wear basin, flare, bulb, plaza/);
    assert.match(prompt, /widest and narrowest runs within 11 pixels/);
    assert.match(prompt, /upper exclusion visibly empty in the generated composition/);
    assert.doesNotMatch(
      prompt,
      /lifecycle remeasures|generic acceptance envelope|every measured run must contain/
    );
    assert.match(
      prompt,
      /Image 1 .* approved legacy corner-es edit target and sole visual authority/s
    );
    assert.match(prompt, /perform a precise material\/style edit of this image/);
    assert.match(
      prompt,
      /final attached reference; give it\s+precedence over every earlier image for macro geometry/
    );
    assert.match(
      prompt,
      /copy the Frozen family art\s+direction verbatim\./
    );
    assert.match(
      prompt,
      /Then append exactly one newline, the label "Geometry prime JSON: "/
    );
    assert.match(
      prompt,
      /"schemaVersion":"battle-art-direct-geometry-prime-v1".*"armSampleCenters"/
    );
    assert.match(
      prompt,
      /Add no other preface, suffix, sampling algorithm, finishing\s+explanation, or geometry terms/
    );
    assert.match(
      prompt,
      /remaining route-contract prose.*governs deterministic acceptance only/s
    );
    assert.match(
      descriptor.generationPrompt,
      /full 256-by-128 canvas and framing; the route subject occupies its 190-by-65 box at x=33\.\.222 and y=53\.\.117/
    );
    assert.match(
      descriptor.generationPrompt,
      /Redraw only the inner contour and the inner edges of both seam tips/
    );
    assert.match(
      descriptor.generationPrompt,
      /nearly constant 34–36 pixels wide at the E and S 50%, 75%, and 100% samples/
    );
    assert.match(
      descriptor.generationPrompt,
      /Widen each narrow seam tip inward by about 8 pixels/
    );
    assert.match(
      descriptor.generationPrompt,
      /shave the broad crown and mid-arm inner edges inward by about 3–5 pixels/
    );
    assert.match(
      descriptor.generationPrompt,
      /No required sample may be thinner than 32 pixels or thicker than 38 pixels/
    );
    assert.match(
      descriptor.generationPrompt,
      /Repaint only its surface.*warm ochre loam/s
    );
    assert.doesNotMatch(
      prompt,
      /Preserve its 190-by-65[^.]*\bcenterline\b/
    );
    assert.doesNotMatch(
      prompt,
      /Preserve its 190-by-65[^.]*surrounding negative space/
    );
    assert.match(prompt, /Widen each narrow seam tip inward/);
    assert.doesNotMatch(prompt, /Image [23] /);
    assert.doesNotMatch(prompt, /guides visual style, material, species/);
    assert.match(prompt, /overall nonzero-alpha bounding box\s+about 180–200 pixels wide/);
    assert.match(prompt, /never a near-full-\s*canvas semicircle or broad half-ring/);
    assert.match(
      prompt,
      /visible apex core\s+column-convex across one shared 29-row band/
    );
    assert.match(
      prompt,
      /no isolated grass or leaf accent above that central core/
    );
    assert.match(prompt, /no magenta-background pinhole, grass\s+cutout/);
    assert.match(prompt, /adjacent columns' top-contour y values\s+may step by at most 4 pixels/);
    assert.match(prompt, /no equal-height plateau may span\s+more than 8 pixels/);
    assert.match(prompt, /Do not generate a rectangular notch or a long\s+ruler-flat plateau/);
    assert.doesNotMatch(prompt, /fit-route-candidate\.mjs/);
    assert.match(prompt, /Execute exactly two successful shell commands/);
    assert.match(prompt, /nonzero-alpha silhouette must cover at most 230 permille/);
    assert.match(prompt, /side panel, underside, hanging\s+tooth, or terrain slab/);
    assert.match(prompt, /must preserve the one generated route artifact without editing it/);
    assert.doesNotMatch(prompt, /crop\/scale, alpha masking, and canvas placement/);
  });

  it('uses approved route siblings as transform-equivalent geometry authorities', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const cases = [
      {
        family: 'forest-heartlands-loam-path-corner-sw',
        referenceTopology: 'corner-ne',
        targetTopology: 'corner-sw',
        allowed:
          'corner-sw are S lower-left at 64,96 and W upper-left at 64,32',
        forbidden:
          'forbidden N upper-right at 192,32, E lower-right at 192,96'
      },
      {
        family: 'forest-heartlands-loam-path-tee-esw',
        referenceTopology: 'tee-nes',
        targetTopology: 'tee-esw',
        allowed:
          'tee-esw are E lower-right at 192,96 and S lower-left at 64,96 '
          + 'and W upper-left at 64,32',
        forbidden: 'forbidden N upper-right at 192,32'
      },
      {
        family: 'forest-heartlands-loam-path-tee-nes',
        referenceTopology: 'tee-wne',
        targetTopology: 'tee-nes',
        allowed:
          'tee-nes are N upper-right at 192,32 and E lower-right at 192,96 '
          + 'and S lower-left at 64,96',
        forbidden: 'forbidden W upper-left at 64,32'
      },
      {
        family: 'forest-heartlands-loam-path-tee-nsw',
        referenceTopology: 'tee-nes',
        targetTopology: 'tee-nsw',
        allowed:
          'tee-nsw are N upper-right at 192,32 and S lower-left at 64,96 '
          + 'and W upper-left at 64,32',
        forbidden: 'forbidden E lower-right at 192,96'
      }
    ];
    for (const testCase of cases) {
      const descriptor = loaded.descriptors.find(
        entry => entry.descriptor.id === testCase.family
      ).descriptor;
      const prompt = buildGenerationPrompt({
        descriptor,
        profile: loaded.promptProfile,
        styleFiles: descriptor.styleReferences.map(
          (_reference, index) => `style-reference-${index + 1}.png`
        )
      });
      assert.match(
        prompt,
        new RegExp(
          `Image 2 .* transform-equivalent approved `
          + `${testCase.referenceTopology}`
        )
      );
      assert.match(
        prompt,
        new RegExp(`declared ${testCase.targetTopology} endpoints`)
      );
      assert.ok(prompt.includes(testCase.allowed));
      assert.ok(prompt.includes(testCase.forbidden));
      assert.match(
        prompt,
        /never copy the attachment's literal endpoint orientation/i
      );
      if (testCase.targetTopology === 'corner-sw') {
        assert.match(
          prompt,
          /Use the attachment only for material character, bend character, and general negative space/
        );
        assert.match(
          prompt,
          /do not copy its merge footprint, arm flare, taper, or occupied span/
        );
        assert.match(
          prompt,
          /30–34 pixel S\/W samples and basin-before-50% rule override the attachment's geometry/
        );
        assert.doesNotMatch(
          prompt,
          /near-uniform arm thickness, rounded merge scale/
        );
      } else {
        assert.match(prompt, /near-uniform arm thickness, rounded merge scale/);
      }
      if (!testCase.targetTopology.startsWith('tee-')) {
        assert.doesNotMatch(prompt, /Keep the shared [NESW]+(?: and [NESW]+)? arms/);
        continue;
      }
      const directionOrder = ['n', 'e', 's', 'w'];
      const referenceDirections =
        new Set(testCase.referenceTopology.slice('tee-'.length).split(''));
      const targetDirections =
        new Set(testCase.targetTopology.slice('tee-'.length).split(''));
      const sharedDirections = directionOrder.filter(direction => (
        referenceDirections.has(direction) && targetDirections.has(direction)
      ));
      const removedDirection = directionOrder.find(direction => (
        referenceDirections.has(direction) && !targetDirections.has(direction)
      ));
      const addedDirection = directionOrder.find(direction => (
        !referenceDirections.has(direction) && targetDirections.has(direction)
      ));
      assert.match(
        prompt,
        new RegExp(
          `Keep the shared ${sharedDirections.map(
            direction => direction.toUpperCase()
          ).join(' and ')} arms in place; replace only the reference's `
          + `${removedDirection.toUpperCase()} arm with the target's `
          + `${addedDirection.toUpperCase()} arm`
        )
      );
      assert.match(
        prompt,
        new RegExp(
          `leave the now-forbidden ${removedDirection.toUpperCase()} `
          + `side transparent`
        )
      );
      if (testCase.targetTopology === 'tee-nsw') {
        assert.match(prompt, /W arm must not flare at 50% then pinch at 75%/);
        assert.match(
          prompt,
          /S arm must retain its full 32–36 pixel core at the exact seam contact/
        );
        assert.match(prompt, /no arm may pinch anywhere along its run/);
      }
      assert.doesNotMatch(
        prompt,
        /Image 2 .* guides visual style, material, species/s
      );
    }
    const cornerSw = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-heartlands-loam-path-corner-sw'
    ).descriptor;
    const cornerSwPrompt = buildGenerationPrompt({
      descriptor: cornerSw,
      profile: loaded.promptProfile,
      styleFiles: cornerSw.styleReferences.map(
        (_reference, index) => `style-reference-${index + 1}.png`
      )
    });
    assert.match(
      cornerSwPrompt,
      /30–34 pixel opaque core at the exact S and W 50%, 75%, and 100% samples/
    );
    assert.match(cornerSwPrompt, /never above 40 pixels/);
    assert.match(
      cornerSwPrompt,
      /end the oval basin before both 50% samples so neither half-run flares/
    );

    const straight = loaded.descriptors.find(
      entry => (
        entry.descriptor.id === 'forest-heartlands-loam-path-straight-ns'
      )
    ).descriptor;
    const straightPrompt = buildGenerationPrompt({
      descriptor: straight,
      profile: loaded.promptProfile,
      styleFiles: straight.styleReferences.map(
        (_reference, index) => `style-reference-${index + 1}.png`
      )
    });
    assert.match(
      straightPrompt,
      /following 2 hash-verified style reference images are already attached/
    );
    assert.match(
      straightPrompt,
      /num_last_images_to_include to exactly 2/
    );
    assert.deepEqual(
      straight.styleReferences.map(reference => reference.id),
      [
        'forest-source-template-01',
        'forest-heartlands-approved-route-straight-ew-v1'
      ]
    );
    assert.equal(straight.content.version, 13);
    assert.equal(straight.status, 'compiled');
    assert.equal(
      straight.source.imageSha256,
      'sha256:2919918dbb4b9ea40c37409179e8e15ff6294b32fef8b84e98c971966cf7104e'
    );
    assert.equal(
      straight.content.sourceSha256,
      'sha256:2919918dbb4b9ea40c37409179e8e15ff6294b32fef8b84e98c971966cf7104e'
    );
    assert.equal(
      straight.content.runtimeSha256,
      'sha256:8f4a43bb9f7a23572be8ceab24fed931cdef2ad1c09f9ae0ebd4b56683338603'
    );
    assert.equal(
      straight.content.immutableUrl,
      '/assets/battle-map-v3/battle-art-descriptors-2026-07-30/v10/'
        + 'forest/route-transition/'
        + 'forest-heartlands-loam-path-straight-ns/v13/'
        + '8f4a43bb9f7a23572be8ceab24fed931cdef2ad1c09f9ae0ebd4b56683338603.webp'
    );
    assert.deepEqual(straight.routeFinishing.targetBox, {
      x: 46,
      y: 8,
      width: 164,
      height: 112
    });
    assert.equal(
      straight.routeFinishing.maximumScaleAnisotropyPermille,
      1350
    );
    assert.deepEqual(straight.routeFinishing.terminalClip, {
      schemaVersion: 'battle-art-route-terminal-clip-v1',
      maximumOverflowPixels: 8
    });
    assert.equal(
      straight.routeFinishing.geometryPrime.sourceSha256,
      'sha256:35bef1269c425846d16f7460590565d681c50894c63e7924caeebba5e69deceb'
    );
    assert.deepEqual(
      straight.routeFinishing.geometryPrime.subjectBounds,
      { x: 65, y: 20, width: 132, height: 86 }
    );
    assert.match(straight.generationPrompt, /measured straight-ns JSON geometry prime/);
    assert.match(straight.generationPrompt, /attached approved Heartlands straight-ew image/);
    assert.match(straight.generationPrompt, /do not lengthen, round, point, or taper either terminal/);
    assert.match(straight.generationPrompt, /strict 2:1 landscape canvas that is exactly twice as wide as it is tall/);
    assert.match(straight.generationPrompt, /delivered file itself must retain the exact 2:1 landscape canvas/);
    assert.match(
      straightPrompt,
      /descriptor rasterContract and routeFinishing contract are hard acceptance requirements/
    );
    assert.match(
      straightPrompt,
      /performs one closed-form largest-component crop, resize, and placement/
    );
    assert.match(
      straightPrompt,
      /JSON geometry measured from attached reference forest-borderwood-approved-route-straight-ns-v1/
    );
    assert.match(
      straightPrompt,
      /occupied 132x86 at \(65,20\), covered 122‰, and extended only 7 N \/ 1 S pixels/
    );
    assert.match(
      straightPrompt,
      /widening the near-opaque band to the current 28–52-pixel contract/
    );
    assert.match(
      straightPrompt,
      /Image 2 .* exact transform-equivalent straight-ew edit target and geometry authority/s
    );
    assert.match(
      straightPrompt,
      /straight-ns are N upper-right at 192,32 and S lower-left at 64,96/
    );
    assert.doesNotMatch(straightPrompt, /corrective|rejected v7/i);

    const trackedTees = loaded.descriptors.filter(({ descriptor }) => (
      descriptor.capabilities?.routeTopology?.startsWith('tee-')
    ));
    assert.ok(trackedTees.length >= 8);
    for (const { descriptor: tee } of trackedTees) {
      const teePrompt = buildGenerationPrompt({
        descriptor: tee,
        profile: loaded.promptProfile,
        styleFiles: tee.styleReferences.map(
          (_reference, index) => `style-reference-${index + 1}.png`
        )
      });
      const { x, y } = tee.placement.anchor;
      assert.match(
        teePrompt,
        new RegExp(
          `three-arm junction compact and rounded inside `
          + `x=${x - 48}\\.\\.${x + 48} and y=${y - 28}\\.\\.${y + 28}`
        )
      );
      assert.match(
        teePrompt,
        /toward every forbidden target, leave the interior solid magenta/
      );
      assert.match(
        teePrompt,
        /never replace it with an opaque half-diamond, broad polygon, slab, plaza/
      );
      assert.match(
        teePrompt,
        /every declared arm's exact 50%, 75%, and 100% perpendicular sample/
      );
      assert.match(
        teePrompt,
        /uninterrupted 30–34 pixel alpha-240 core run/
      );
      assert.match(
        teePrompt,
        /all nine tee samples, keep the widest and narrowest runs within 4 pixels/
      );
      assert.match(
        teePrompt,
        /raw 2:1 composition at whatever raster resolution imagegen emits/
      );
      assert.match(
        teePrompt,
        /declared loam core a uniform 11.7–13.3% of total canvas width/
      );
      assert.match(
        teePrompt,
        /measured perpendicular to its arm at 50%, 75%, and seam contact/
      );
      assert.match(
        teePrompt,
        /resolution-independent equivalent of 30–34 pixels after whole-image normalization to 256x128/
      );
      assert.match(
        teePrompt,
        /do not interpret 30–34 as raw high-resolution pixels/
      );
      assert.match(
        teePrompt,
        /Keep the rounded junction compact so it never widens any arm/
      );
      assert.match(
        teePrompt,
        /do not taper any terminal/
      );
      assert.match(
        teePrompt,
        /End the shared merge before those 50% samples/
      );
      assert.match(
        teePrompt,
        /do not let a central lobe widen any half-run above 34 pixels/
      );
      assert.match(
        teePrompt,
        /no 75% or 100% arm run is narrower than its 50% run/
      );
      const directions =
        tee.capabilities.routeTopology.slice('tee-'.length).split('');
      const forbidden = ['n', 'e', 's', 'w'].filter(
        direction => !directions.includes(direction)
      );
      assert.equal(forbidden.length, 1);
      const forbiddenTarget = {
        n: `N upper-right at ${x + 64},${y - 32}`,
        e: `E lower-right at ${x + 64},${y + 32}`,
        s: `S lower-left at ${x - 64},${y + 32}`,
        w: `W upper-left at ${x - 64},${y - 32}`
      }[forbidden[0]];
      assert.match(
        teePrompt,
        new RegExp(`forbidden ${forbiddenTarget}`)
      );
    }
  });

  it('keeps route ends broad and rounded instead of polygonal wedges', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-heartlands-loam-path-end-n'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(prompt, /broad irregular 48–64 pixel rounded central wear/);
    assert.match(prompt, /join the single arm tangentially/);
    assert.match(prompt, /basin inside x=96\.\.160 and y=40\.\.88/);
    assert.match(prompt, /no straight alpha-contour\s+run longer than 12 pixels/);
    assert.match(prompt, /Never preserve an isometric tile outline/);
    assert.match(prompt, /form a pointed triangular\s+wedge/);
    assert.match(prompt, /straight-sided polygon, or cut dirt ground slab/);
    assert.match(prompt, /basin centroid within 8 pixels of 128,64/);
    assert.match(prompt, /forbidden opposite S lower-left at 64,96/);
    assert.match(prompt, /24–40 pixel broad rounded arc/);
    assert.match(prompt, /never a single pointed pixel, spur, or teardrop/);
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
    assert.match(prompt, /only across the internal capability-diamond span/);
    assert.match(prompt, /not across the much longer rectangular-canvas diagonal/);
    assert.match(
      prompt,
      /e=\(255,64\)–\(128,127\), s=\(128,127\)–\(0,64\)/
    );
    assert.match(prompt, /do not stop short in a smaller shape that misses a/);
    assert.match(prompt, /exact named target as a terminal endpoint/);
    assert.match(prompt, /within 8 pixels farther along that\s+arm vector/);
    assert.match(prompt, /remaining route toward the rectangular corner\s+entirely magenta/);
    assert.match(prompt, /Center each edge-contact band on its exact named/);
    assert.match(prompt, /at least 16 pixels from both diamond\s+segment vertices/);
    assert.match(prompt, /leave the outermost 4-pixel rectangular border empty/);
    assert.match(prompt, /flat painted surface overlay with zero visible vertical thickness/);
    assert.match(prompt, /no front or side face, cut bank, curb, retaining wall/);
    assert.match(prompt, /palisade, repeated\s+teeth, black underside, or colored vertical strip/);
    assert.match(prompt, /continue at most 8 pixels outward/);
    assert.match(prompt, /Never approach the\s+rectangular border or terminate in a straight squared crop line/);
    assert.match(
      prompt,
      /continuous 28–36 pixel warm-loam core/
    );
    assert.match(
      prompt,
      /low 6–10 pixel irregular visible grass-and-leaf verge along each long side, attached to and blended into that core/
    );
    assert.match(
      prompt,
      /Do not rely on partial transparency for shape or softness: a flat chroma source may normalize to a binary-alpha cutout/
    );
    assert.match(prompt, /Never generate a hairline/);
    assert.doesNotMatch(
      prompt,
      /lifecycle remeasures|generic acceptance envelope|every measured run must contain|coverage cap/
    );
    assert.match(prompt, /with no detached alpha component/);
    assert.match(prompt, /each leaf,\s+grass tuft, pebble, and loam pixel/);
    assert.match(prompt, /leave a 12-pixel interior band empty/);
    assert.match(
      prompt,
      /n=\(128,0\)–\(255,64\), w=\(0,64\)–\(128,0\)/
    );
    assert.match(prompt, /Only declared route arms may touch an edge band/);
    const customDescriptor = structuredClone(descriptor);
    customDescriptor.canvas = { width: 512, height: 256 };
    customDescriptor.placement.drawBounds = {
      ...customDescriptor.placement.drawBounds,
      width: 512,
      height: 256
    };
    customDescriptor.generationPrompt = customDescriptor.generationPrompt
      .replaceAll('256x128', '512x256');
    const customPrompt = buildGenerationPrompt({
      descriptor: customDescriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.doesNotMatch(customPrompt, /lifecycle remeasures|acceptance envelope/);
    assert.match(customPrompt, /parent lifecycle performs only exact-aspect whole-image resizing/);
    assert.doesNotMatch(customPrompt, /final 256x128 alpha raster/);
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
    const generationPrompt = buildGenerationPrompt({
      descriptor: revised,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(generationPrompt, /outer 16-pixel diamond rim quiet and seam-safe/);
    assert.match(generationPrompt, /two or three large uninterrupted/);
    assert.match(generationPrompt, /Reject uniformly distributed micro-flecks/);
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
    assert.match(prompt, /within 6 pixels of the declared segment in every third/);
    assert.match(prompt, /within 10 pixels of both exact endpoints/);
    assert.match(prompt, /A half-length subject, any open seam third/);
    assert.match(prompt, /pivot is placement metadata and need not be covered/);
    assert.match(prompt, /do not bend the grounded strip away/);
    assert.match(prompt, /never mirror or rotate the declared diagonal/);
    assert.match(prompt, /No grounded base may follow any of the other three edges/);
    assert.match(prompt, /narrow boundary strip, never a complete diamond ground tile/);
    assert.match(prompt, /clear alpha from a 12-pixel band/);
    assert.match(prompt, /bottommost connected alpha envelope/);
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

  it('makes regional fieldstone faces read as vertical height discontinuities', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-heartlands-fieldstone-face-e'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(prompt, /continuous one-height dry-stone retaining face/);
    assert.match(prompt, /clearly visible vertical plane/);
    assert.match(prompt, /sustained top lip along the declared edge/);
    assert.match(prompt, /Do not depict a shallow loose-stone berm/);
  });

  it('keeps Heartlands hedgerows narrow and their canopy visibly elevated', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === 'forest-heartlands-hedgerow-edge-e'
    ).descriptor;
    const prompt = buildGenerationPrompt({
      descriptor,
      profile: loaded.promptProfile,
      styleFiles: ['style-reference-01.png']
    });
    assert.match(prompt, /confine roots, low understory, and ground-contact foliage/);
    assert.match(prompt, /18–32 pixel narrow strip/);
    assert.match(prompt, /transparent gaps between them/);
    assert.match(prompt, /never fill the interior terrain triangle/);
    assert.match(prompt, /must not form a second grounded edge band/);
    assert.match(prompt, /add no detached leaf island or floating fragment/);
    assert.match(prompt, /keep every crown and branch at least 8 pixels inside/);
    assert.match(prompt, /Never crop a canopy silhouette against x=0/);
    assert.match(prompt, /measure the\s+outermost non-ground leaf and branch alpha/);
    assert.match(prompt, /translate or uniformly shrink only the elevated crown/);
    assert.match(prompt, /final pixels, not a stated intention/);
    assert.match(prompt, /run an 8-connected alpha-component scan/);
    assert.match(prompt, /complete hedgerow must be exactly one visible component/);
    assert.match(prompt, /join a real crown through its support/);
    assert.match(prompt, /Reserve the first and last 16 pixels of travel/);
    assert.match(prompt, /low soil, roots, and grass no more than 12 pixels/);
    assert.match(prompt, /Place every trunk and crown within the middle portion/);
    assert.match(prompt, /run those exact tests on the final exterior-facing/);
    assert.match(prompt, /fails above 3 residual fringe pixels/);
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
      concurrency: 1,
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
      concurrency: 1,
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
    assert.equal(
      (await readJson(root, BUNDLE_PATH)).value.assets.some(
        asset => asset.key === options.family
      ),
      false
    );

    const resumed = await generateBattleArt(
      { ...options, resume: true },
      { worker }
    );
    assert.equal(calls, 1);
    assert.equal(resumed.results[0].status, 'skipped-complete');

    await generateBattleArt({ ...options, force: true }, { worker });
    assert.equal(calls, 2);
  });

  it('rejects live multi-family keep-going before any worker starts', async () => {
    const root = await fixture();
    const failedFamily = 'forest-moss-surface';
    const successfulFamily = 'forest-ancient-tree';
    let workerCalls = 0;
    const worker = async input => {
      workerCalls += 1;
      if (input.descriptor.id === failedFamily) {
        throw new Error('intentional candidate failure');
      }
      return candidateWorker(input);
    };
    await assert.rejects(
      generateBattleArt({
        projectRoot: root,
        theme: 'forest',
        families: [failedFamily, successfulFamily],
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false,
        keepGoing: true
      }, { worker }),
      /requires exactly one explicit --family/
    );
    assert.equal(workerCalls, 0);
  });

  it('serializes same-family force generation across a failed owner', async () => {
    const root = await fixture();
    const options = {
      projectRoot: root,
      theme: 'forest',
      family: 'forest-moss-surface',
      concurrency: 1,
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
      reason: 'The replacement candidate satisfies the reviewed raster contract.',
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
      reason: 'The candidate preserves the required draft geometry and style.',
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
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, { worker }),
      /undeclared output approval\.json/
    );
  });

  it('preserves bounded diagnostics when a worker creates no candidate image', async () => {
    const root = await fixture();
    const stdout = Buffer.from(
      '{"type":"item.completed","item":{"id":"message","type":"agent_message",'
      + '"text":"generation unavailable"}}\n'
    );
    const stderr = Buffer.from('worker returned without a raster\n');
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
      }, {
        worker: async input => ({
          stdout,
          stderr,
          args: buildCodexArgs(
            input.workspace,
            path.join(input.workspace, 'last-message.txt'),
            input.styleFiles.map(file => path.join(input.workspace, file))
          )
        })
      }),
      /worker must create exactly one candidate image; found 0/
    );
    const rejectedRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest/forest-moss-surface'
    );
    assert.match(
      await readFile(path.join(rejectedRoot, 'prompt.txt'), 'utf8'),
      /call the imagegen tool exactly once/
    );
    assert.equal(
      await readFile(path.join(rejectedRoot, 'worker.jsonl'), 'utf8'),
      stdout.toString()
    );
    assert.equal(
      await readFile(path.join(rejectedRoot, 'worker.stderr.log'), 'utf8'),
      stderr.toString()
    );
    await assert.rejects(
      readFile(path.join(rejectedRoot, 'candidate.png')),
      error => error.code === 'ENOENT'
    );
    await assert.rejects(
      readFile(path.join(rejectedRoot, 'result.json')),
      error => error.code === 'ENOENT'
    );
  });

  it('rejects a known pinched direct route before review publication',
    async () => {
    const root = await fixture();
    const family = 'forest-heartlands-loam-path-straight-ns';
    const raw = await readFile(path.join(
      REPOSITORY_ROOT,
      HEARTLANDS_STRAIGHT_NS_V11_PINCHED_RAW
    ));
    const worker = async input => {
      const result = await candidateWorker(input);
      await replaceRouteWorkerCandidate({
        workspace: input.workspace,
        result,
        bytes: raw
      });
      return result;
    };
    let rejection;
    await assert.rejects(
      generateBattleArt({
        projectRoot: root,
        theme: 'forest',
        family,
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, { worker }),
      error => {
        rejection = error;
        return /terminal clipping would remove 98‰ of covered pixels; expected at most 50‰/
          .test(error.message);
      }
    );

    const loaded = await loadBattleArt(root);
    const descriptor = loaded.descriptors.find(
      entry => entry.descriptor.id === family
    ).descriptor;
    const rawPath = generatedArtifactPath(descriptor, {
      sha256: sha256(raw),
      format: 'png'
    });
    assert.deepEqual(await readFile(path.join(root, rawPath)), raw);
    const candidateRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest',
      family
    );
    for (const file of ['candidate.png', 'candidate.webp', 'result.json']) {
      await assert.rejects(
        readFile(path.join(candidateRoot, file)),
        error => error.code === 'ENOENT'
      );
    }
    const failure = await auditFailedRouteAttempt({
      root,
      relativePath: rejection.failedAttemptEvidencePath
    });
    assert.equal(failure.record.raw.sha256, sha256(raw));
    assert.match(
      failure.record.rejection.message,
      /terminal clipping would remove 98‰ of covered pixels/
    );
  });

  it('recovers preserved route evidence without another worker or imagegen call',
    async () => {
    const root = await fixture();
    const family = 'forest-heartlands-loam-path-straight-ns';
    const raw = await readFile(path.join(
      REPOSITORY_ROOT,
      HEARTLANDS_STRAIGHT_NS_V13_APPROVED_RAW
    ));
    let originalWorkspace;
    let environmentSource;
    const worker = async input => {
      originalWorkspace = input.workspace;
      const result = await candidateWorker(input);
      await replaceRouteWorkerCandidate({
        workspace: input.workspace,
        result,
        bytes: raw
      });
      environmentSource = result.environmentSource;
      const message =
        'Copied the generated artifact unchanged to [candidate.png]'
        + `(${path.join(input.workspace, 'candidate.png')}).`;
      await writeFile(
        path.join(input.workspace, 'last-message.txt'),
        message
      );
      const events = result.stdout.toString('utf8')
        .trimEnd()
        .split('\n')
        .map(line => JSON.parse(line));
      for (const event of events) {
        const item = event?.item;
        if (
          item?.type === 'command_execution'
          && item.command.startsWith('/bin/cp ')
        ) {
          const { artifactPath } =
            assertSingleGeneratedArtifactCopyEvidence(result.stdout);
          item.command =
            `/bin/bash -lc '/bin/cp "${artifactPath}" "candidate.png"'`;
        }
      }
      events.push({
        type: 'item.completed',
        item: {
          id: 'route-final-message',
          type: 'agent_message',
          text: message
        }
      });
      return {
        ...result,
        stdout: Buffer.from(
          `${events.map(event => JSON.stringify(event)).join('\n')}\n`
        )
      };
    };
    const generated = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker });
    assert.equal(generated.results[0].status, 'generated');
    const candidateRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest',
      family
    );
    const imagePath = path.join(candidateRoot, 'candidate.png');
    const metadataPath = path.join(candidateRoot, 'result.json');
    const promptPath = path.join(candidateRoot, 'prompt.txt');
    const stdoutPath = path.join(candidateRoot, 'worker.jsonl');
    const expectedCandidate = await readFile(imagePath);
    const expectedPrompt = await readFile(promptPath);
    const expectedStdout = await readFile(stdoutPath);
    let recoveryWorkerCalls = 0;
    const recoveryOptions = {
      projectRoot: root,
      theme: 'forest',
      families: [family],
      concurrency: 1,
      timeoutMs: 10_000,
      timeoutProvided: true,
      dryRun: false,
      force: false,
      resume: false,
      keepGoing: false,
      textStyleFallback: false,
      recover: true
    };
    await assert.rejects(
      generateBattleArt(recoveryOptions, {
        worker: async () => {
          recoveryWorkerCalls += 1;
          throw new Error('recovery must not launch a worker');
        },
        environmentSource
      }),
      /requires no existing candidate publication/
    );
    assert.deepEqual(await readFile(imagePath), expectedCandidate);
    await readFile(metadataPath);
    await Promise.all([
      rm(imagePath),
      rm(metadataPath)
    ]);
    await assert.rejects(
      generateBattleArt({
        ...recoveryOptions,
        timeoutProvided: false
      }, {
        worker: async () => {
          recoveryWorkerCalls += 1;
          throw new Error('recovery must not launch a worker');
        },
        environmentSource
      }),
      /requires the original worker --timeout/
    );
    await writeFile(
      promptPath,
      Buffer.concat([expectedPrompt, Buffer.from('tampered')])
    );
    await assert.rejects(
      generateBattleArt(recoveryOptions, {
        worker: async () => {
          recoveryWorkerCalls += 1;
          throw new Error('recovery must not launch a worker');
        },
        environmentSource
      }),
      /recovery prompt does not match current frozen inputs/
    );
    await writeFile(promptPath, expectedPrompt);
    const reorderedEvents = expectedStdout.toString('utf8')
      .trimEnd()
      .split('\n');
    const finalMessageIndex = reorderedEvents.findIndex(line => (
      JSON.parse(line)?.item?.id === 'route-final-message'
    ));
    const [finalMessageEvent] = reorderedEvents.splice(finalMessageIndex, 1);
    const copyIndex = reorderedEvents.findIndex(line => (
      JSON.parse(line)?.item?.id === 'route-artifact-copy'
    ));
    reorderedEvents.splice(copyIndex, 0, finalMessageEvent);
    await writeFile(
      stdoutPath,
      `${reorderedEvents.join('\n')}\n`
    );
    await assert.rejects(
      generateBattleArt(recoveryOptions, {
        worker: async () => {
          recoveryWorkerCalls += 1;
          throw new Error('recovery must not launch a worker');
        },
        environmentSource
      }),
      /must end its artifact copy with the one preserved final message/
    );
    await writeFile(stdoutPath, expectedStdout);
    const recovered = await generateBattleArt(recoveryOptions, {
      worker: async () => {
        recoveryWorkerCalls += 1;
        throw new Error('recovery must not launch a worker');
      },
      environmentSource
    });
    assert.equal(recoveryWorkerCalls, 0);
    assert.equal(recovered.results[0].status, 'generated');
    assert.equal(recovered.results[0].recovered, true);
    assert.deepEqual(await readFile(imagePath), expectedCandidate);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    assert.equal(
      metadata.worker.args[metadata.worker.args.indexOf('-C') + 1],
      originalWorkspace
    );
    assert.equal(metadata.worker.timeoutMs, 10_000);
  });

  it('canonicalizes a verified WebP route artifact to PNG publication',
    async () => {
    const root = await fixture();
    const family = 'forest-heartlands-loam-path-straight-ns';
    const approvedBytes = await readFile(path.join(
      REPOSITORY_ROOT,
      HEARTLANDS_STRAIGHT_NS_V13_APPROVED_RAW
    ));
    const webpBytes = await sharp(approvedBytes)
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    const generated = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, {
      worker: async input => {
        const result = await candidateWorker(input);
        const { artifactPath } = assertSingleGeneratedArtifactCopyEvidence(
          result.stdout
        );
        const webpArtifactPath = artifactPath.replace(/\.png$/, '.webp');
        assert.notEqual(webpArtifactPath, artifactPath);
        await Promise.all([
          writeFile(
            path.join(input.workspace, 'candidate.png'),
            webpBytes
          ),
          writeFile(webpArtifactPath, webpBytes)
        ]);
        await rm(artifactPath);
        return {
          ...result,
          stdout: Buffer.from(
            result.stdout.toString().replaceAll(
              artifactPath,
              webpArtifactPath
            )
          )
        };
      }
    });
    assert.equal(generated.results[0].status, 'generated');
    const metadata = JSON.parse(await readFile(path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest',
      family,
      'result.json'
    )));
    assert.equal(metadata.image.format, 'png');
    assert.match(metadata.image.path, /candidate\.png$/);
    assert.equal(
      (await sharp(path.join(root, metadata.image.path)).metadata()).format,
      'png'
    );
  });

  it('limits parent resizing to exact-aspect route sources', async () => {
    const routeRoot = await fixture();
    const routeFamily = 'forest-borderwood-dirt-path-corner-ne';
    await assert.rejects(
      generateBattleArt({
        projectRoot: routeRoot,
        theme: 'forest',
        family: routeFamily,
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, {
        worker: async input => {
          const result = await candidateWorker(input);
          const candidatePath = path.join(input.workspace, 'candidate.png');
          const bytes = await sharp(candidatePath)
              .resize(1774, 886, { fit: 'fill' })
              .png()
              .toBuffer();
          await replaceRouteWorkerCandidate({
            workspace: input.workspace,
            result,
            bytes
          });
          return result;
        }
      }),
      /candidate aspect ratio 1774:886 does not match declared route canvas 256:128/
    );

    const nonRouteRoot = await fixture();
    await assert.rejects(
      generateBattleArt({
        projectRoot: nonRouteRoot,
        theme: 'forest',
        family: 'forest-ancient-tree',
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, {
        worker: async input => {
          const result = await candidateWorker(input);
          const candidatePath = path.join(input.workspace, 'candidate.png');
          await writeFile(
            candidatePath,
            await sharp(candidatePath)
              .resize(96, 128, { fit: 'fill' })
              .png()
              .toBuffer()
          );
          return result;
        }
      }),
      /dimensions 96x128 do not match declared canvas 192x256/
    );
  });

  it('rejects route candidate bytes unrelated to the copied imagegen artifact',
    async () => {
    const root = await fixture();
    await assert.rejects(
      generateBattleArt({
        projectRoot: root,
        theme: 'forest',
        family: 'forest-borderwood-dirt-path-corner-ne',
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, {
        worker: async input => {
          const result = await candidateWorker(input);
          const candidatePath = path.join(input.workspace, 'candidate.png');
          const unrelatedBytes = await sharp(candidatePath)
            .tint({ r: 160, g: 96, b: 40 })
            .png()
            .toBuffer();
          await writeFile(candidatePath, unrelatedBytes);
          return result;
        }
      }),
      /candidate must be byte-identical to the one generated artifact/
    );
  });

  it('validates direct route geometry without opting into route finishing',
    async () => {
    const root = await fixture();
    const family = 'forest-borderwood-dirt-path-corner-ne';
    let workerStdout;
    const worker = async input => {
      const result = await candidateWorker(input);
      workerStdout = result.stdout;
      const { width, height } = input.descriptor.canvas;
      const anchor = input.descriptor.placement.anchor;
      const routeTargets = {
        n: { x: width * 0.75, y: height * 0.25 },
        e: { x: width * 0.75, y: height * 0.75 },
        s: { x: width * 0.25, y: height * 0.75 },
        w: { x: width * 0.25, y: height * 0.25 }
      };
      const directions = topologyDirections(
        input.descriptor.capabilities.routeTopology
      );
      const pixels = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!directions.some(direction => (
            distanceToSegment(x, y, anchor, routeTargets[direction]) <= 15
          )) && Math.hypot(x - anchor.x, y - anchor.y) > 24) {
            continue;
          }
          pixels.set(
            [117, 76, 36, 255],
            ((y * width) + x) * 4
          );
        }
      }
      const bytes = await sharp(pixels, {
          raw: { width, height, channels: 4 }
        }).png().toBuffer();
      await replaceRouteWorkerCandidate({
        workspace: input.workspace,
        result,
        bytes
      });
      return result;
    };

    const generated = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker });
    assert.equal(generated.results[0].status, 'generated');

    const candidateRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest',
      family
    );
    assert.match(
      await readFile(path.join(candidateRoot, 'prompt.txt'), 'utf8'),
      /forest-borderwood-dirt-path-corner-ne/
    );
    assert.equal(
      await readFile(path.join(candidateRoot, 'worker.jsonl'), 'utf8'),
      workerStdout.toString()
    );
    assert.ok((await readFile(path.join(candidateRoot, 'candidate.png'))).length > 0);
    assert.ok((await readFile(path.join(candidateRoot, 'result.json'))).length > 0);
  });

  it('keeps conforming direct route ends on whole-image normalization',
    async () => {
    const root = await fixture();
    const family = 'forest-borderwood-dirt-path-end-n';
    let workerStdout;
    const worker = async input => {
      const result = await candidateWorker(input);
      workerStdout = result.stdout;
      const { width, height } = input.descriptor.canvas;
      const anchor = input.descriptor.placement.anchor;
      const target = { x: width * 0.75, y: height * 0.25 };
      const pixels = Buffer.alloc(width * height * 4);
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        pixels.set([255, 0, 255, 255], pixel * 4);
      }
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (distanceToSegment(x, y, anchor, target) > 15) continue;
          pixels.set(
            [117, 76, 36, 255],
            ((y * width) + x) * 4
          );
        }
      }
      const rawBytes = await sharp(pixels, {
        raw: { width, height, channels: 4 }
      }).png().toBuffer();
      await replaceRouteWorkerCandidate({
        workspace: input.workspace,
        result,
        bytes: rawBytes
      });
      return result;
    };

    const generated = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker });
    assert.equal(generated.results[0].status, 'generated');

    const candidateRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest',
      family
    );
    assert.equal(
      await readFile(path.join(candidateRoot, 'worker.jsonl'), 'utf8'),
      workerStdout.toString()
    );
    assert.ok((await readFile(path.join(candidateRoot, 'candidate.png'))).length > 0);
    assert.ok((await readFile(path.join(candidateRoot, 'result.json'))).length > 0);
  });

  it('does not retrofit authored width maxima onto legacy route descriptors',
    async () => {
    const root = await fixture();
    const family = 'forest-borderwood-dirt-path-straight-ew';
    const raw = await sharp(
      await directStraightNsCandidate({ halfWidth: 20 })
    ).flip().png().toBuffer();
    let workerStdout;
    const worker = async input => {
      const result = await candidateWorker(input);
      workerStdout = result.stdout;
      await replaceRouteWorkerCandidate({
        workspace: input.workspace,
        result,
        bytes: raw
      });
      return result;
    };

    const generated = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker });
    assert.equal(generated.results[0].status, 'generated');

    const candidateRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest',
      family
    );
    assert.match(
      await readFile(path.join(candidateRoot, 'prompt.txt'), 'utf8'),
      /forest-borderwood-dirt-path-straight-ew/
    );
    assert.equal(
      await readFile(path.join(candidateRoot, 'worker.jsonl'), 'utf8'),
      workerStdout.toString()
    );
    assert.ok((await readFile(path.join(candidateRoot, 'candidate.png'))).length > 0);
    assert.ok((await readFile(path.join(candidateRoot, 'result.json'))).length > 0);
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
          concurrency: 1,
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

  it('counts a successful and a failed imagegen lifecycle as two attempts', async () => {
    const root = await fixture();
    const worker = async input => {
      const result = await candidateWorker(input);
      result.stdout = Buffer.from([
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'imagegen-success',
            type: 'mcp_tool_call',
            server: 'image_gen',
            tool: 'imagegen',
            status: 'completed'
          }
        }),
        JSON.stringify({
          type: 'item.failed',
          item: {
            id: 'imagegen-failed',
            type: 'mcp_tool_call',
            server: 'image_gen',
            tool: 'imagegen',
            status: 'failed'
          }
        })
      ].join('\n') + '\n');
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
      /call imagegen exactly once; observed 2/
    );
  });

  it('publishes battle art from the verified candidate snapshot', async () => {
    const root = await fixture();
    let verifiedBytes;
    const generated = await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family: 'forest-moss-surface',
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, {
      worker: candidateWorker,
      afterCandidateVerified: async ({
        workspaceCandidate,
        verifiedCandidateBytes
      }) => {
        verifiedBytes = Buffer.from(verifiedCandidateBytes);
        await writeFile(
          workspaceCandidate,
          Buffer.from('post-verification pathname replacement')
        );
      }
    });
    assert.equal(generated.results[0].status, 'generated');
    assert.ok(verifiedBytes.length > 0);
    const candidateRoot = path.join(
      root,
      'ai-image-metadata/battle-art/candidates/forest/forest-moss-surface'
    );
    const metadata = JSON.parse(
      await readFile(path.join(candidateRoot, 'result.json'), 'utf8')
    );
    const publishedBytes = await readFile(
      path.join(root, metadata.image.path)
    );
    assert.equal(metadata.image.sha256, sha256(publishedBytes));
  });

  it('limits legacy duplicate-artifact tolerance to the two frozen review tuples', async () => {
    const root = await fixture();
    const families = [
      'forest-heartlands-hedgerow-edge-e',
      'forest-heartlands-meadow-grass'
    ];
    const retained = [];
    for (const family of families) {
      retained.push(await retainTrackedApprovedV1Evidence(root, family));
    }
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 3,
      approved: 3,
      rejected: 0
    });
    for (const { descriptor, review } of retained) {
      await assert.rejects(
        recordCandidateReview({
          root,
          theme: descriptor.theme,
          family: descriptor.id,
          reviewer: review.reviewer,
          decision: 'approved',
          reason: review.reason,
          reviewedAt: review.reviewedAt
        }),
        /duplicate artifact evidence/
      );
    }
  });

  it('audits stale legacy rejections without treating them as current evidence', async () => {
    const root = await fixture();
    const family = 'forest-heartlands-loam-path-straight-ew';
    const reviewRelative =
      `ai-image-metadata/battle-art/reviews/forest/${family}/`
      + '3846223f73312db2d938bf1d266327fa43d78dcf1a7efa07deb0bc1aad73d63a.json';
    await copyTrackedReview(root, reviewRelative);
    const descriptorRelative =
      `ai-image-metadata/battle-art/descriptors/forest/${family}.json`;
    const descriptor = (await readJson(root, descriptorRelative)).value;
    descriptor.generationPrompt += ' Intentionally revised after rejection.';
    await writeFile(
      path.join(root, descriptorRelative),
      stableJson(descriptor)
    );
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 2,
      approved: 1,
      rejected: 1
    });
    await assert.rejects(
      readFile(path.join(
        root,
        `ai-image-metadata/battle-art/candidates/forest/${family}/result.json`
      )),
      error => error.code === 'ENOENT'
    );
  });

  it('rejects v2 input drift and requires archives and current inputs for approvals', async () => {
    const v2Root = await fixture();
    const v2Family = 'forest-moss-surface';
    await generateBattleArt({
      projectRoot: v2Root,
      theme: 'forest',
      family: v2Family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    await recordCandidateReview({
      root: v2Root,
      theme: 'forest',
      family: v2Family,
      reviewer: 'drift-reviewer@example.test',
      decision: 'rejected',
      reason: 'This reviewed v2 candidate must remain pinned to its inputs.',
      reviewedAt: '2026-07-30T11:00:00.000Z'
    });
    const v2DescriptorRelative =
      `ai-image-metadata/battle-art/descriptors/forest/${v2Family}.json`;
    const v2Descriptor = (await readJson(v2Root, v2DescriptorRelative)).value;
    v2Descriptor.generationPrompt += ' Drifted after the v2 review.';
    await writeFile(
      path.join(v2Root, v2DescriptorRelative),
      stableJson(v2Descriptor)
    );
    await assert.rejects(
      auditBattleArtReviews({ root: v2Root }),
      /does not match its reviewed descriptor inputs/
    );

    const legacyRoot = await fixture();
    const legacyFamily = 'forest-heartlands-loam-path-corner-ne';
    const reviewRelative =
      `ai-image-metadata/battle-art/reviews/forest/${legacyFamily}/`
      + '9c085b05ee5900b4e2c4438efdb56a0af40bd4a5b2d47633290360f7d03f0019.json';
    const review = await copyTrackedReview(legacyRoot, reviewRelative);
    const descriptorRelative =
      `ai-image-metadata/battle-art/descriptors/forest/${legacyFamily}.json`;
    const descriptor = (await readJson(legacyRoot, descriptorRelative)).value;
    descriptor.generationPrompt += ' Revised after the approved legacy review.';
    await writeFile(
      path.join(legacyRoot, descriptorRelative),
      stableJson(descriptor)
    );
    await assert.rejects(
      auditBattleArtReviews({ root: legacyRoot }),
      /has no matching archived source identity/
    );

    const loaded = await loadBattleArt(legacyRoot);
    const [entry] = loaded.descriptors.filter(candidate => (
      candidate.descriptor.id === legacyFamily
    ));
    const sourcePath =
      `ai-image-metadata/battle-art/sources/forest/${legacyFamily}/v1/`
      + `${review.candidate.image.sha256.slice('sha256:'.length)}.png`;
    entry.descriptor.status = 'approved';
    entry.descriptor.content.sourceSha256 = review.candidate.image.sha256;
    entry.descriptor.source = {
      candidateMetadataPath: review.candidate.metadata.path,
      imagePath: sourcePath,
      imageSha256: review.candidate.image.sha256,
      width: review.candidate.image.width,
      height: review.candidate.image.height,
      format: review.candidate.image.format,
      reviewer: review.reviewer,
      approvedAt: review.reviewedAt
    };
    loaded.historicalReleases = [{
      release: {
        sources: [{
          familyId: legacyFamily,
          contentVersion: 1,
          path: sourcePath,
          sha256: review.candidate.image.sha256,
          width: review.candidate.image.width,
          height: review.candidate.image.height,
          format: review.candidate.image.format
        }]
      }
    }];
    await assert.rejects(
      auditBattleArtReviews({ loaded }),
      /has no matching immutable approved review record/
    );
  });

  it('rejects modified v1 evidence even at an allowlisted canonical path', async () => {
    const root = await fixture();
    const family = 'forest-heartlands-loam-path-straight-ew';
    const reviewRelative =
      `ai-image-metadata/battle-art/reviews/forest/${family}/`
      + '3846223f73312db2d938bf1d266327fa43d78dcf1a7efa07deb0bc1aad73d63a.json';
    const review = await copyTrackedReview(root, reviewRelative);
    review.reason = 'A modified record must not become its own legacy authority.';
    const { fullHash: _fullHash, ...projection } = review;
    review.fullHash = sha256(Buffer.from(stableJson(projection)));
    await writeFile(path.join(root, reviewRelative), stableJson(review));
    await assert.rejects(
      auditBattleArtReviews({ root }),
      /not recognized tracked legacy evidence/
    );
    const candidateRelative =
      'ai-image-metadata/battle-art/candidates/forest/'
      + 'forest-heartlands-hedgerow-edge-e/result.json';
    const candidate = (await readJson(REPOSITORY_ROOT, candidateRelative)).value;
    assert.equal(
      assertAllowlistedLegacyCandidate(candidateRelative, candidate),
      candidate
    );
    assert.throws(
      () => assertAllowlistedLegacyCandidate(
        candidateRelative.replace('hedgerow-edge-e', 'hedgerow-edge-w'),
        candidate
      ),
      /path is not canonical/
    );
    const modifiedCandidate = structuredClone(candidate);
    modifiedCandidate.status = 'candidate-tampered';
    assert.throws(
      () => assertAllowlistedLegacyCandidate(
        candidateRelative,
        modifiedCandidate
      ),
      /not recognized tracked legacy evidence/
    );
  });

  it('pins a readable, canonical legacy evidence registry', async () => {
    const registryContents = await readFile(
      path.join(REPOSITORY_ROOT, LEGACY_EVIDENCE_REGISTRY_PATH),
      'utf8'
    );
    const registry = JSON.parse(registryContents);
    assert.equal(
      sha256(Buffer.from(registryContents)),
      'sha256:24ac46edc22bad5dc9372302bc6f64c0bb8e1990f0912a6f51c4b1cdfa7bda26'
    );
    assert.equal(registryContents, stableJson(registry));
    assert.equal(
      registry.schemaVersion,
      'battle-art-legacy-evidence-registry-v1'
    );
    assert.equal(
      registry.registryVersion,
      'battle-art-legacy-evidence-2026-07-31'
    );
    assert.equal(
      Object.keys(registry.candidateCanonicalJsonSha256).length,
      94
    );
    assert.equal(Object.keys(registry.reviewFullHash).length, 79);
  });

  it('confines the compiled-source attestation schema to its exact legacy identity', async () => {
    const relative =
      'ai-image-metadata/battle-art/reviews/forest/'
      + 'forest-borderwood-dirt-path-corner-es/'
      + 'c0277f2744dff9adb241a9ab5240b709d3d91ca2d0e78e2b83bf863263a358cd.json';
    const record = (await readJson(REPOSITORY_ROOT, relative)).value;
    assert.equal(
      assertReviewRecord(record, relative).schemaVersion,
      COMPILED_SOURCE_ATTESTATION_SCHEMA
    );
    assert.equal(
      record.reviewer,
      'codex-full-game-battle-content-review'
    );
    assert.equal(record.source.reviewer, 'codex');
    const rehash = value => {
      const { fullHash: _fullHash, ...projection } = value;
      value.fullHash = sha256(Buffer.from(stableJson(projection)));
      return value;
    };
    const wrongEvidence = structuredClone(record);
    wrongEvidence.candidate.worker.stdout.sha256 = `sha256:${'0'.repeat(64)}`;
    assert.throws(
      () => assertReviewRecord(rehash(wrongEvidence), relative),
      /not an authorized compiled-source attestation identity/
    );
    const wrongSource = structuredClone(record);
    wrongSource.source.imageSha256 = `sha256:${'0'.repeat(64)}`;
    assert.throws(
      () => assertReviewRecord(rehash(wrongSource), relative),
      /source does not match the attested candidate identity/
    );
    const rewrittenIdentity = structuredClone(record);
    rewrittenIdentity.reviewer = 'rewritten-attester@example.test';
    rewrittenIdentity.reviewedAt = '2026-07-31T16:00:00.000Z';
    rewrittenIdentity.source.reviewer = 'rewritten-source-reviewer@example.test';
    rewrittenIdentity.source.approvedAt = '2026-07-31T15:59:00.000Z';
    assert.throws(
      () => assertReviewRecord(rehash(rewrittenIdentity), relative),
      /not an authorized compiled-source attestation identity/
    );
    const rejected = structuredClone(record);
    rejected.decision = 'rejected';
    assert.throws(
      () => assertReviewRecord(rehash(rejected), relative),
      /decision must be approved/
    );
  });

  it('audits the exact compiled-source attestation after an archived revision', async () => {
    const family = 'forest-borderwood-dirt-path-corner-es';
    const trackedManifest = (await readJson(
      REPOSITORY_ROOT,
      'ai-image-metadata/battle-art/manifest.json'
    )).value;
    const excludedFamilies = trackedManifest.descriptors
      .map(relative => path.basename(relative, '.json'))
      .filter(id => id !== family);
    const root = await fixture({ excludedFamilies });
    const descriptorRelative =
      `ai-image-metadata/battle-art/descriptors/forest/${family}.json`;
    await copyFile(
      path.join(REPOSITORY_ROOT, descriptorRelative),
      path.join(root, descriptorRelative)
    );
    const candidateRelative =
      `ai-image-metadata/battle-art/candidates/forest/${family}`;
    await cp(
      path.join(REPOSITORY_ROOT, candidateRelative),
      path.join(root, candidateRelative),
      { recursive: true }
    );
    const reviewRelative =
      `ai-image-metadata/battle-art/reviews/forest/${family}/`
      + 'c0277f2744dff9adb241a9ab5240b709d3d91ca2d0e78e2b83bf863263a358cd.json';
    const review = await copyTrackedReview(root, reviewRelative);
    const releaseRelative =
      'ai-image-metadata/battle-art/releases/'
      + 'battle-art-descriptors-2026-07-30.v10.json';
    await mkdir(path.dirname(path.join(root, releaseRelative)), {
      recursive: true
    });
    await copyFile(
      path.join(REPOSITORY_ROOT, releaseRelative),
      path.join(root, releaseRelative)
    );
    const release = (await readJson(REPOSITORY_ROOT, releaseRelative)).value;
    for (const source of release.sources) {
      await mkdir(path.dirname(path.join(root, source.path)), {
        recursive: true
      });
      await copyFile(
        path.join(REPOSITORY_ROOT, source.path),
        path.join(root, source.path)
      );
    }
    for (const asset of release.bundle.assets) {
      const runtimeRelative = `frontend/public${asset.immutableUrl}`;
      await mkdir(path.dirname(path.join(root, runtimeRelative)), {
        recursive: true
      });
      await copyFile(
        path.join(REPOSITORY_ROOT, runtimeRelative),
        path.join(root, runtimeRelative)
      );
    }
    const manifestRelative = 'ai-image-metadata/battle-art/manifest.json';
    const manifest = (await readJson(root, manifestRelative)).value;
    manifest.historicalReleases = [releaseRelative];
    await writeFile(
      path.join(root, manifestRelative),
      stableJson(manifest)
    );

    assert.equal(review.fullHash, 'sha256:385d0b3c56f8ba3ef3275d0cfa3520d3a5dd98781b164acdcd7a80bda0a4ffdc');
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 1,
      approved: 1,
      rejected: 0
    });
    const revision = await reviseFamily({
      root,
      theme: 'forest',
      family
    });
    assert.equal(revision.contentVersion, 2);
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 1,
      approved: 1,
      rejected: 0
    });

    const loaded = await loadBattleArt(root);
    const archivedSource = loaded.historicalReleases[0].release.sources.find(
      source => source.familyId === family
    );
    archivedSource.width += 1;
    await assert.rejects(
      auditBattleArtReviews({ loaded }),
      /does not match the current compiled descriptor or its exact archived reviewed source/
    );
  });

  it('rejects missing, reordered, duplicate, and extra two-reference attachment evidence', async () => {
    const root = await fixture();
    const family = 'forest-moss-surface';
    await addSyntheticStyleReference(root, family);
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    const metadataRelative =
      `ai-image-metadata/battle-art/candidates/forest/${family}/result.json`;
    const metadataPath = path.join(root, metadataRelative);
    const originalMetadata = (await readJson(root, metadataRelative)).value;
    assert.equal(originalMetadata.schemaVersion, 'battle-art-candidate-v2');
    assert.deepEqual(
      originalMetadata.styleReferenceProvenance.map(value => value.stagedBasename),
      ['style-reference-01.png', 'style-reference-02.png']
    );
    const imageIndexes = originalMetadata.worker.args.flatMap(
      (argument, index) => argument === '--image' ? [index] : []
    );
    assert.equal(imageIndexes.length, 2);
    const candidateMutations = {
      missing(candidate) {
        candidate.worker.args.splice(imageIndexes[0], 2);
      },
      reordered(candidate) {
        const left = candidate.worker.args[imageIndexes[0] + 1];
        candidate.worker.args[imageIndexes[0] + 1] =
          candidate.worker.args[imageIndexes[1] + 1];
        candidate.worker.args[imageIndexes[1] + 1] = left;
      },
      duplicate(candidate) {
        candidate.worker.args[imageIndexes[1] + 1] =
          candidate.worker.args[imageIndexes[0] + 1];
      },
      extra(candidate) {
        candidate.worker.args.splice(
          imageIndexes[1] + 2,
          0,
          '--image',
          path.join(
            path.dirname(candidate.worker.args[imageIndexes[1] + 1]),
            'style-reference-03.png'
          )
        );
      }
    };
    for (const [name, mutate] of Object.entries(candidateMutations)) {
      const candidate = structuredClone(originalMetadata);
      mutate(candidate);
      await writeFile(metadataPath, stableJson(candidate));
      await assert.rejects(
        recordCandidateReview({
          root,
          theme: 'forest',
          family,
          reviewer: 'attachment-reviewer@example.test',
          decision: 'rejected',
          reason: `Reject ${name} attachment evidence.`
        }),
        /CLI --image count\/order mismatch/
      );
    }
    const downgradedCandidate = structuredClone(originalMetadata);
    downgradedCandidate.schemaVersion = 'battle-art-candidate-v1';
    delete downgradedCandidate.styleReferenceMode;
    delete downgradedCandidate.styleReferenceProvenance;
    await writeFile(metadataPath, stableJson(downgradedCandidate));
    await assert.rejects(
      recordCandidateReview({
        root,
        theme: 'forest',
        family,
        reviewer: 'attachment-reviewer@example.test',
        decision: 'rejected',
        reason: 'A schema downgrade cannot erase attachment evidence.'
      }),
      /not recognized tracked legacy evidence/
    );
    await writeFile(metadataPath, stableJson(originalMetadata));
    const approval = await approveCandidate({
      root,
      theme: 'forest',
      family,
      reviewer: 'attachment-reviewer@example.test',
      decision: 'approved',
      reason: 'The two ordered style attachments are explicitly proven.',
      approvedAt: '2026-07-30T12:00:00.000Z'
    });
    const originalReview = (await readJson(root, approval.reviewPath)).value;
    assert.equal(originalReview.schemaVersion, REVIEW_SCHEMA);
    assert.deepEqual(
      originalReview.candidate.worker.imageArguments,
      ['style-reference-01.png', 'style-reference-02.png']
    );
    const reviewMutations = {
      missing: [],
      reordered: ['style-reference-02.png', 'style-reference-01.png'],
      duplicate: ['style-reference-01.png', 'style-reference-01.png'],
      extra: [
        'style-reference-01.png',
        'style-reference-02.png',
        'style-reference-03.png'
      ]
    };
    for (const [name, imageArgumentsValue] of Object.entries(reviewMutations)) {
      const review = structuredClone(originalReview);
      review.candidate.worker.imageArguments = imageArgumentsValue;
      const { fullHash: _fullHash, ...projection } = review;
      review.fullHash = sha256(Buffer.from(stableJson(projection)));
      await writeFile(path.join(root, approval.reviewPath), stableJson(review));
      await assert.rejects(
        auditBattleArtReviews({ root }),
        /CLI --image count\/order mismatch/,
        name
      );
    }
    const downgradedReview = structuredClone(originalReview);
    downgradedReview.schemaVersion = 'battle-art-candidate-review-v1';
    delete downgradedReview.candidate.styleReferenceMode;
    delete downgradedReview.candidate.styleReferenceProvenance;
    delete downgradedReview.candidate.worker.imageArguments;
    const { fullHash: _downgradedHash, ...downgradedProjection } =
      downgradedReview;
    downgradedReview.fullHash = sha256(Buffer.from(stableJson(
      downgradedProjection
    )));
    await writeFile(
      path.join(root, approval.reviewPath),
      stableJson(downgradedReview)
    );
    await assert.rejects(
      auditBattleArtReviews({ root }),
      /not recognized tracked legacy evidence/
    );
  });

  it('rejects an unarchived approval superseded under unchanged inputs', async () => {
    const root = await fixture();
    const family = 'forest-moss-surface';
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    const first = await recordCandidateReview({
      root,
      theme: 'forest',
      family,
      reviewer: 'first-reviewer@example.test',
      decision: 'approved',
      reason: 'Candidate A passes while it remains the exact staged draft.',
      reviewedAt: '2026-07-30T11:00:00.000Z'
    });
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 2,
      approved: 2,
      rejected: 0
    });

    const variantWorker = async input => {
      const result = await candidateWorker(input);
      const candidatePath = path.join(input.workspace, 'candidate.png');
      const variant = await sharp(candidatePath)
        .modulate({ brightness: 1.05 })
        .png()
        .toBuffer();
      await writeFile(candidatePath, variant);
      return result;
    };
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: true,
      resume: false
    }, { worker: variantWorker });
    const second = await approveCandidate({
      root,
      theme: 'forest',
      family,
      reviewer: 'second-reviewer@example.test',
      decision: 'approved',
      reason: 'Candidate B is the exact source selected for this descriptor.',
      approvedAt: '2026-07-30T12:00:00.000Z'
    });
    assert.notEqual(
      first.record.candidate.image.sha256,
      second.sourceSha256
    );
    await assert.rejects(
      auditBattleArtReviews({ root }),
      /has no matching current source, staged candidate, or archived source identity/
    );

    await rm(path.join(root, first.path));
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 2,
      approved: 2,
      rejected: 0
    });
  });

  it('records immutable approved and rejected candidate reviews and audits them', async () => {
    const family = 'forest-moss-surface';
    const rejectedRoot = await fixture();
    await generateBattleArt({
      projectRoot: rejectedRoot,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    const rejected = await recordCandidateReview({
      root: rejectedRoot,
      theme: 'forest',
      family,
      reviewer: 'reject-reviewer@example.test',
      decision: 'rejected',
      reason: 'The silhouette crosses the required seam-safe diamond edge.',
      reviewedAt: '2026-07-30T11:00:00.000Z'
    });
    assert.equal(rejected.changed, true);
    assert.equal(Object.hasOwn(rejected, 'candidateBytes'), false);
    assert.ok(
      Buffer.byteLength(JSON.stringify(rejected)) < 20_000,
      'public review JSON must remain metadata-only'
    );
    assert.equal(rejected.record.schemaVersion, REVIEW_SCHEMA);
    assert.equal(rejected.record.decision, 'rejected');
    assert.match(
      rejected.path,
      /^ai-image-metadata\/battle-art\/reviews\/forest\/forest-moss-surface\/[0-9a-f]{64}\.json$/
    );
    assert.equal(
      (await loadBattleArt(rejectedRoot)).descriptors.find(
        entry => entry.descriptor.id === family
      ).descriptor.status,
      'draft'
    );
    assert.deepEqual(await auditBattleArtReviews({ root: rejectedRoot }), {
      ok: true,
      records: 2,
      approved: 1,
      rejected: 1
    });
    const rejectedRetry = await recordCandidateReview({
      root: rejectedRoot,
      theme: 'forest',
      family,
      reviewer: 'reject-reviewer@example.test',
      decision: 'rejected',
      reason: 'The silhouette crosses the required seam-safe diamond edge.'
    });
    assert.equal(rejectedRetry.changed, false);
    await assert.rejects(
      recordCandidateReview({
        root: rejectedRoot,
        theme: 'forest',
        family,
        reviewer: 'reject-reviewer@example.test',
        decision: 'rejected',
        reason: 'A different rationale cannot replace immutable review history.'
      }),
      /conflicting decision/
    );
    await assert.rejects(
      approveCandidate({
        root: rejectedRoot,
        theme: 'forest',
        family,
        reviewer: 'approve-reviewer@example.test',
        decision: 'approved',
        reason: 'This attempts to approve the exact rejected candidate.'
      }),
      /conflicting decision/
    );
    const rejectedCandidate = path.join(
      rejectedRoot,
      rejected.record.candidate.image.path
    );
    await writeFile(
      rejectedCandidate,
      Buffer.concat([await readFile(rejectedCandidate), Buffer.from([0])])
    );
    await assert.rejects(
      recordCandidateReview({
        root: rejectedRoot,
        theme: 'forest',
        family,
        reviewer: 'reject-reviewer@example.test',
        decision: 'rejected',
        reason: 'The silhouette crosses the required seam-safe diamond edge.'
      }),
      /hash pin mismatch/
    );

    const approvedRoot = await fixture();
    await generateBattleArt({
      projectRoot: approvedRoot,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    const approvedAt = '2026-07-30T12:00:00.000Z';
    const approval = await approveCandidate({
      root: approvedRoot,
      theme: 'forest',
      family,
      reviewer: 'approve-reviewer@example.test',
      decision: 'approved',
      reason: 'The image preserves alpha, footprint, scale, and seam contracts.',
      approvedAt
    });
    const approvedRecord = (await readJson(
      approvedRoot,
      approval.reviewPath
    )).value;
    assert.equal(approvedRecord.decision, 'approved');
    assert.deepEqual(await auditBattleArtReviews({ root: approvedRoot }), {
      ok: true,
      records: 2,
      approved: 2,
      rejected: 0
    });
    const approvedMetadataPath = path.join(
      approvedRoot,
      approvedRecord.candidate.metadata.path
    );
    const approvedMetadataBytes = await readFile(approvedMetadataPath);
    const driftedMetadata = JSON.parse(approvedMetadataBytes);
    driftedMetadata.image.sha256 = `sha256:${'0'.repeat(64)}`;
    await writeFile(approvedMetadataPath, stableJson(driftedMetadata));
    await assert.rejects(
      auditBattleArtReviews({ root: approvedRoot }),
      /hash pin mismatch/
    );
    await writeFile(approvedMetadataPath, approvedMetadataBytes);
    await rm(path.join(approvedRoot, approval.reviewPath));
    await assert.rejects(
      auditBattleArtReviews({ root: approvedRoot }),
      /no matching immutable approved review record/
    );
    await assert.rejects(
      recordCandidateReview({
        root: approvedRoot,
        theme: 'forest',
        family,
        reviewer: 'wrong-reviewer@example.test',
        decision: 'approved',
        reason: 'This invalid backfill must not occupy the immutable slot.'
      }),
      /reviewer must match/
    );
    await assert.rejects(
      readFile(path.join(approvedRoot, approval.reviewPath)),
      error => error.code === 'ENOENT'
    );
    const backfill = await recordCandidateReview({
      root: approvedRoot,
      theme: 'forest',
      family,
      reviewer: 'approve-reviewer@example.test',
      decision: 'approved',
      reason: 'The image preserves alpha, footprint, scale, and seam contracts.',
      reviewedAt: approvedAt
    });
    assert.equal(backfill.changed, true);
    const tampered = structuredClone(backfill.record);
    tampered.reason = 'Tampered rationale.';
    await writeFile(
      path.join(approvedRoot, backfill.path),
      stableJson(tampered)
    );
    await assert.rejects(
      auditBattleArtReviews({ root: approvedRoot }),
      /fullHash does not match/
    );
    await rm(path.join(approvedRoot, backfill.path));
    const outsideReview = path.join(approvedRoot, 'outside-review.json');
    await writeFile(outsideReview, stableJson(backfill.record));
    await symlink(outsideReview, path.join(approvedRoot, backfill.path));
    await assert.rejects(
      auditBattleArtReviews({ root: approvedRoot }),
      /review tree contains symlink/
    );
    await rm(path.join(approvedRoot, backfill.path));
    await writeFile(
      path.join(approvedRoot, backfill.path),
      stableJson(backfill.record)
    );
    const outsideReviewRoot = path.join(approvedRoot, 'outside-reviews');
    await cp(
      path.join(approvedRoot, 'ai-image-metadata/battle-art/reviews'),
      outsideReviewRoot,
      { recursive: true }
    );
    await rm(path.join(
      approvedRoot,
      'ai-image-metadata/battle-art/reviews'
    ), { recursive: true });
    await symlink(
      outsideReviewRoot,
      path.join(approvedRoot, 'ai-image-metadata/battle-art/reviews'),
      'dir'
    );
    await assert.rejects(
      auditBattleArtReviews({ root: approvedRoot }),
      /review root contains symlink/
    );
  });

  it('backfills only an exact compiled current source from preserved candidate evidence', async () => {
    const root = await fixture();
    const family = 'forest-moss-surface';
    const reviewer = 'compiled-source-reviewer@example.test';
    const reason =
      'The preserved candidate and compiled source retain the reviewed silhouette and raster contract.';
    const approvedAt = '2026-07-30T12:00:00.000Z';
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
      timeoutMs: 10_000,
      dryRun: false,
      force: false,
      resume: false
    }, { worker: candidateWorker });
    const approved = await approveCandidate({
      root,
      theme: 'forest',
      family,
      reviewer,
      decision: 'approved',
      reason,
      approvedAt
    });
    await compileApproved({ root });
    await rm(path.join(root, approved.reviewPath));

    await assert.rejects(
      recordCandidateReview({
        root,
        theme: 'forest',
        family,
        reviewer,
        decision: 'rejected',
        reason: 'A compiled source cannot be retroactively rejected.'
      }),
      /only accepts an approved backfill review/
    );
    await assert.rejects(
      recordCandidateReview({
        root,
        theme: 'forest',
        family,
        reviewer: 'different-reviewer@example.test',
        decision: 'approved',
        reason
      }),
      /reviewer must match/
    );
    await assert.rejects(
      recordCandidateReview({
        root,
        theme: 'forest',
        family,
        reviewer,
        decision: 'approved',
        reason,
        reviewedAt: '2026-07-30T12:00:01.000Z'
      }),
      /review time must match/
    );

    const backfill = await recordCandidateReview({
      root,
      theme: 'forest',
      family,
      reviewer,
      decision: 'approved',
      reason,
      reviewedAt: approvedAt
    });
    assert.equal(backfill.changed, true);
    assert.equal(backfill.record.schemaVersion, REVIEW_SCHEMA);
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 2,
      approved: 2,
      rejected: 0
    });

    await rm(path.join(root, backfill.path));
    const candidateRelative =
      `ai-image-metadata/battle-art/candidates/forest/${family}/candidate.png`;
    const resultRelative =
      `ai-image-metadata/battle-art/candidates/forest/${family}/result.json`;
    const candidatePath = path.join(root, candidateRelative);
    const resultPath = path.join(root, resultRelative);
    const originalCandidate = await readFile(candidatePath);
    const originalResult = await readFile(resultPath);
    const variant = await sharp(originalCandidate)
      .modulate({ brightness: 1.05 })
      .png()
      .toBuffer();
    const variantResult = JSON.parse(originalResult);
    variantResult.image.bytes = variant.length;
    variantResult.image.sha256 = sha256(variant);
    await writeFile(candidatePath, variant);
    await writeFile(resultPath, stableJson(variantResult));
    await assert.rejects(
      recordCandidateReview({
        root,
        theme: 'forest',
        family,
        reviewer,
        decision: 'approved',
        reason,
        reviewedAt: approvedAt
      }),
      /compiled source does not match the preserved review candidate/
    );
    await writeFile(candidatePath, originalCandidate);
    await writeFile(resultPath, originalResult);
  });

  it('pins explicit review before deterministic lossless compilation', async () => {
    const root = await fixture();
    const family = 'forest-moss-surface';
    await generateBattleArt({
      projectRoot: root,
      theme: 'forest',
      family,
      concurrency: 1,
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
      reason: 'The candidate passes the complete visual review checklist.',
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
    assert.equal(
      (await readJson(root, BUNDLE_PATH)).value.assets.some(
        asset => asset.key === family
      ),
      false
    );
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
    const retry = await approveCandidate({
      root,
      theme: 'forest',
      family,
      reviewer: 'reviewer@example.test',
      decision: 'approved',
      reason: 'The candidate passes the complete visual review checklist.'
    });
    assert.equal(retry.changed, false);
    assert.match(retry.reviewPath, /ai-image-metadata\/battle-art\/reviews\//);
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
    assert.equal(compiled.compiled, 2);
    loaded = await loadBattleArt(root);
    descriptor = loaded.descriptors.find(entry => entry.descriptor.id === family).descriptor;
    assert.equal(descriptor.status, 'compiled');
    assert.deepEqual(await auditBattleArtReviews({ root }), {
      ok: true,
      records: 2,
      approved: 2,
      rejected: 0
    });
    assert.equal((await checkBattleArt({ root })).reviews.approved, 2);
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
    assert.equal(bundle.assets.length, 2);
    assert.deepEqual(bundle.assets.find(asset => asset.key === family), {
      key: 'forest-moss-surface',
      contentVersion: descriptor.content.version,
      contentHash: descriptor.content.runtimeSha256,
      immutableUrl: descriptor.content.immutableUrl
    });
    assert.equal(
      bundle.renderers.find(renderer => renderer.id === family).pivot.x,
      descriptor.placement.pivot.x
    );
    const tamperedRenderer = structuredClone(bundle);
    tamperedRenderer.renderers.find(
      renderer => renderer.id === family
    ).pivot.x += 1;
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
    const tracked = await loadBattleArt(REPOSITORY_ROOT);
    const routeFamilies = tracked.descriptors
      .filter(entry => (
        entry.descriptor.category === 'route-transition'
        && entry.descriptor.id
          !== 'forest-borderwood-dirt-path-corner-es'
      ))
      .map(entry => entry.descriptor.id);
    const root = await fixture({
      excludedFamilies: routeFamilies
    });
    await addSyntheticStyleReference(root, 'forest-ancient-tree');
    const loaded = await loadBattleArt(root);
    for (const entry of loaded.descriptors) {
      if (entry.descriptor.status === 'compiled') continue;
      await generateBattleArt({
        projectRoot: root,
        theme: entry.descriptor.theme,
        family: entry.descriptor.id,
        concurrency: 1,
        timeoutMs: 10_000,
        dryRun: false,
        force: false,
        resume: false
      }, { worker: candidateWorker });
      await approveCandidate({
        root,
        theme: entry.descriptor.theme,
        family: entry.descriptor.id,
        reviewer: 'release-reviewer@example.test',
        decision: 'approved',
        reason: 'The family is visually accepted for this immutable release.',
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
    const archivedReviewPath = path.join(
      root,
      'ai-image-metadata/battle-art/reviews',
      loaded.descriptors[0].descriptor.theme,
      loaded.descriptors[0].descriptor.id
    );
    const [archivedReviewName] = await readdir(archivedReviewPath);
    const archivedReviewFile = path.join(
      archivedReviewPath,
      archivedReviewName
    );
    const archivedReviewBytes = await readFile(archivedReviewFile);
    await rm(archivedReviewFile);
    await assert.rejects(
      auditBattleArtReviews({ root }),
      /no matching immutable approved review record/
    );
    await writeFile(archivedReviewFile, archivedReviewBytes);
    const family = (await readJson(
      root,
      loaded.descriptors[0].path
    )).value;
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
    assert.deepEqual(
      (await readJson(root, added.descriptor)).value.styleReferences,
      [manifestAfterAddition.styleReferences[0]]
    );
    assert.equal(revised.releaseVersion, loaded.manifest.version + 1);
    assert.equal(revised.contentVersion, family.content.version + 1);
    manifestAfterAddition.styleReferences.push({
      id: `${family.id}-archived-style-v${family.content.version}`,
      path: family.source.imagePath,
      sha256: family.source.imageSha256
    });
    await writeFile(
      path.join(root, 'ai-image-metadata/battle-art/manifest.json'),
      stableJson(manifestAfterAddition)
    );
    const afterRevision = await loadBattleArt(root);
    assert.equal(
      afterRevision.descriptors.find(
        candidate => candidate.descriptor.id === family.id
      ).descriptor.status,
      'draft'
    );
    assert.deepEqual(
      afterRevision.descriptors.find(
        candidate => candidate.descriptor.id === family.id
      ).descriptor.styleReferences,
      [
        afterRevision.manifest.styleReferences[0],
        afterRevision.manifest.styleReferences.find(
          reference => reference.id === 'forest-source-template-02'
        )
      ]
    );
    await rm(archivedReviewFile);
    await assert.rejects(
      loadBattleArt(root),
      /historical source has no matching immutable approved review/
    );
    await writeFile(archivedReviewFile, archivedReviewBytes);
    assert.equal((await auditBattleArtReviews({ root })).records, loaded.descriptors.length);
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
