import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm
} from 'node:fs/promises';
import path from 'node:path';

import {
  CANDIDATE_SCHEMA,
  DESCRIPTOR_SCHEMA_V2,
  FAILED_ATTEMPT_REVALIDATION_ORIGIN,
  REVALIDATED_CANDIDATE_SCHEMA,
  RENDER_PROFILE,
  TIER_BANDS,
  assertAllowlistedLegacyCandidate,
  assertDescriptor,
  assertFailedAttemptRevalidationOrigin,
  assertStyleReferenceProvenance,
  assertV2DescriptorsPlanned,
  atomicWrite,
  candidateValidationDescriptorSha256,
  candidatePaths,
  correctiveStyleReferenceForConsumer,
  exactKeys,
  generatedArtifactPath,
  hashFile,
  inspectImageContents,
  loadBattleArt,
  loadReadinessPlan,
  prepareDirectRouteCandidate,
  readPinnedRegularFile,
  readJson,
  readRegularFileSnapshot,
  resolveTracked,
  selectFamilies,
  sha256,
  stableJson,
  styleReferenceProvenance,
  verifyCandidateRouteDerivation
} from './lifecycle.mjs';
import {
  normalizeGeneratedRasterBytes,
  validateRasterBytes
} from './raster-contract.mjs';
import {
  finishRouteArtifact,
  validateFinishedRouteArtifact
} from './finish-route-artifact.mjs';
import {
  withBattleArtCandidateLock
} from './candidate-lock.mjs';
import {
  auditCodexWorkerJsonl,
  parseGeneratedArtifactCopyCommand,
  verifyCodexImagegenEvidence
} from '../battle-maps/codex-worker-boundary.mjs';

export const DEFAULT_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const MAX_TIMEOUT_MS = 1_800_000;
export const MAX_WORKER_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_CANDIDATE_BYTES = 32 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 48 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8192;
export const FAILED_ROUTE_ATTEMPT_SCHEMA =
  'battle-art-route-failed-attempt-v1';
const FROZEN_V6_FAILED_ROUTE_BACKFILL = Object.freeze({
  theme: 'forest',
  family: 'forest-heartlands-loam-path-straight-ns',
  contentVersion: 6,
  descriptorSha256:
    'sha256:21379c5f0c8eb28521765e9b39866dfad6d72c92641fd602164b6f4bf7ed5362',
  rawSha256:
    'sha256:8f1a1f33653dcc691c25e8601301002e762deb59e1db645b13efcce36c7190a5',
  rawFormat: 'png',
  timeoutMs: 900_000,
  promptSha256:
    'sha256:a0020d322cc71f44e20e71001682328d5fe8ea630dfed4acae1308e1204775dd',
  stdoutSha256:
    'sha256:20892e1d52571976e755d4129a70f7282742d012f02ebe486b1f8dcc685742b2',
  stderrSha256:
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  lastMessageSha256:
    'sha256:8abbe74d86e88e07ab973f665285c1e99286df9a519e55bc26373f96b328843f',
  rejection: Object.freeze({
    name: 'Error',
    message:
      'forest-heartlands-loam-path-straight-ns generated candidate '
      + 'alpha silhouette is an opaque rectangular panel '
      + '(901‰ bounding-box fill)'
  })
});
const SCRIPT_ROOT = path.resolve(import.meta.dirname, '../..');
const CODEX_WORKER_HOME = path.resolve(
  process.env.CODEX_HOME
    ?? path.join(process.env.HOME ?? SCRIPT_ROOT, '.codex')
);
const IMAGEGEN_SKILL_PATH = path.join(
  CODEX_WORKER_HOME,
  'skills/.system/imagegen/SKILL.md'
);
const ROUTE_TRANSITION_CLEAR_BORDER_WIDTH = 4;
const ROUTE_CORNER_MINIMUM_CORE_WIDTH = 28;
const ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD = 240;
const ROUTE_CORNER_SCAN_RADIUS = 8;
const ROUTE_CORNER_ANCHOR_INTERSECTION_RADIUS = 12;
const ROUTE_CORNER_AXIS_BY_TOPOLOGY = Object.freeze({
  'corner-es': 'vertical',
  'corner-wn': 'vertical',
  'corner-ne': 'horizontal',
  'corner-sw': 'horizontal'
});
const ROUTE_CORNER_MAXIMUM_COVERAGE_PERMILLE_V2 = 230;
const ROUTE_ARM_SAMPLE_FRACTIONS = Object.freeze([0.5, 0.75, 1]);
const ROUTE_ARM_MINIMUM_CORE_WIDTH = 28;
const CORNER_ES_ARM_MINIMUM_CORE_WIDTH_V2 = 30;
const CORNER_ES_ARM_MAXIMUM_CORE_WIDTH_V2 = 41;
const CORNER_ES_MAXIMUM_ARM_CORE_SPREAD_V2 = 11;
const ROUTE_ARM_ALPHA_SPAN_CONTRACTS_BY_FAMILY_ID = Object.freeze({
  'forest-heartlands-loam-path-corner-es': Object.freeze({
    minimumPixels: CORNER_ES_ARM_MINIMUM_CORE_WIDTH_V2,
    maximumPixels: CORNER_ES_ARM_MAXIMUM_CORE_WIDTH_V2,
    maximumSpreadPixels: CORNER_ES_MAXIMUM_ARM_CORE_SPREAD_V2
  })
});
const CORNER_ES_UPPER_CLEAR_BOUNDS = Object.freeze({
  minimumX: 120,
  maximumX: 135,
  minimumY: 0,
  maximumY: 32
});
const CORNER_ES_APEX_CORE_BOUNDS = Object.freeze({
  minimumX: 120,
  maximumX: 135
});
const CORNER_ES_APEX_CORE_MINIMUM_HEIGHT = 29;
const CORNER_ES_MAXIMUM_APEX_TOP_STEP = 4;
const CORNER_ES_MAXIMUM_APEX_FLAT_RUN = 8;
const ROUTE_ARM_VECTORS = Object.freeze({
  n: Object.freeze({
    x: RENDER_PROFILE.tileWidth * RENDER_PROFILE.sourcePixelScale / 4,
    y: -RENDER_PROFILE.tileHeight * RENDER_PROFILE.sourcePixelScale / 4
  }),
  e: Object.freeze({
    x: RENDER_PROFILE.tileWidth * RENDER_PROFILE.sourcePixelScale / 4,
    y: RENDER_PROFILE.tileHeight * RENDER_PROFILE.sourcePixelScale / 4
  }),
  s: Object.freeze({
    x: -RENDER_PROFILE.tileWidth * RENDER_PROFILE.sourcePixelScale / 4,
    y: RENDER_PROFILE.tileHeight * RENDER_PROFILE.sourcePixelScale / 4
  }),
  w: Object.freeze({
    x: -RENDER_PROFILE.tileWidth * RENDER_PROFILE.sourcePixelScale / 4,
    y: -RENDER_PROFILE.tileHeight * RENDER_PROFILE.sourcePixelScale / 4
  })
});
const ROUTE_STRAIGHT_TOPOLOGIES = new Set(['straight-ew', 'straight-ns']);
const ROUTE_STRAIGHT_MAXIMUM_COVERAGE_PERMILLE = 300;

export function routeArmAlphaSpanContract(descriptor) {
  const configured = descriptor.routeFinishing?.armAlphaSpan;
  if (
    descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
    && descriptor.category === 'route-transition'
    && configured
  ) {
    return Object.freeze({
      alphaThreshold: configured.alphaThreshold,
      minimumPixels: configured.minimumPixels,
      maximumPixels: configured.maximumPixels,
      maximumSpreadPixels: configured.maximumSpreadPixels
    });
  }
  const authored = ROUTE_ARM_ALPHA_SPAN_CONTRACTS_BY_FAMILY_ID[descriptor.id];
  if (authored
    && descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
    && descriptor.category === 'route-transition'
    && descriptor.capabilities?.routeTopology === 'corner-es') {
    return Object.freeze({
      alphaThreshold: ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD,
      ...authored
    });
  }
  return Object.freeze({
    alphaThreshold: ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD,
    minimumPixels: ROUTE_ARM_MINIMUM_CORE_WIDTH,
    maximumPixels: null,
    maximumSpreadPixels: null
  });
}
const ROUTE_STRAIGHT_MAXIMUM_ARM_OVERFLOW_PIXELS = 8;
const ACTIVE_WORKER_GROUPS = new Set();
let workerSignalHandlersInstalled = false;
let workerShutdownSignal = null;

async function decodeBoundedNormalizedCandidateRgba({
  bytes,
  descriptor,
  label
}) {
  const expectedWidth = descriptor.canvas?.width;
  const expectedHeight = descriptor.canvas?.height;
  if (!Number.isSafeInteger(expectedWidth)
    || expectedWidth <= 0
    || expectedWidth > MAX_IMAGE_DIMENSION
    || !Number.isSafeInteger(expectedHeight)
    || expectedHeight <= 0
    || expectedHeight > MAX_IMAGE_DIMENSION) {
    throw new Error(`${label} has invalid declared canvas dimensions`);
  }
  const maximumPixels = expectedWidth * expectedHeight;
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(bytes, {
    failOn: 'error',
    limitInputPixels: maximumPixels,
    sequentialRead: true
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4
    || info.width !== expectedWidth
    || info.height !== expectedHeight) {
    throw new Error(`${label} did not decode to its declared RGBA canvas`);
  }
  return { data, width: info.width, height: info.height };
}

export async function assertRouteTransitionCanvasBorderClear({
  bytes,
  descriptor,
  label = `${descriptor.id} generated candidate`
}) {
  if (descriptor.category !== 'route-transition') return;
  const { data, width, height } = await decodeBoundedNormalizedCandidateRgba({
    bytes,
    descriptor,
    label
  });
  for (let y = 0; y < height; y += 1) {
    const ranges = y < ROUTE_TRANSITION_CLEAR_BORDER_WIDTH
      || y >= height - ROUTE_TRANSITION_CLEAR_BORDER_WIDTH
      ? [[0, width]]
      : [
          [0, Math.min(ROUTE_TRANSITION_CLEAR_BORDER_WIDTH, width)],
          [Math.max(ROUTE_TRANSITION_CLEAR_BORDER_WIDTH, width
            - ROUTE_TRANSITION_CLEAR_BORDER_WIDTH), width]
        ];
    for (const [start, end] of ranges) {
      for (let x = start; x < end; x += 1) {
        const alpha = data[((y * width) + x) * 4 + 3];
        if (alpha !== 0) {
          throw new Error(
            `${label} route-transition outermost 4-pixel canvas border must be `
            + `fully transparent; found nontransparent pixel at ${x},${y}`
          );
        }
      }
    }
  }
}

export async function assertRouteCornerMinimumCoreWidth({
  bytes,
  descriptor,
  label = `${descriptor.id} generated candidate`
}) {
  const topology = descriptor.capabilities?.routeTopology;
  const axis = descriptor.category === 'route-transition'
    ? ROUTE_CORNER_AXIS_BY_TOPOLOGY[topology]
    : null;
  if (!axis) return null;
  const { data, width, height } = await decodeBoundedNormalizedCandidateRgba({
    bytes,
    descriptor,
    label
  });
  const anchor = descriptor.placement?.anchor;
  if (!Number.isSafeInteger(anchor?.x)
    || anchor.x < 0
    || anchor.x >= width
    || !Number.isSafeInteger(anchor?.y)
    || anchor.y < 0
    || anchor.y >= height) {
    throw new Error(`${label} has an invalid declared route anchor`);
  }
  const fixedAnchor = axis === 'vertical' ? anchor.x : anchor.y;
  const runAnchor = axis === 'vertical' ? anchor.y : anchor.x;
  const fixedLimit = axis === 'vertical' ? width : height;
  const runLimit = axis === 'vertical' ? height : width;
  const fixedStart = Math.max(0, fixedAnchor - ROUTE_CORNER_SCAN_RADIUS);
  const fixedEnd = Math.min(
    fixedLimit - 1,
    fixedAnchor + ROUTE_CORNER_SCAN_RADIUS
  );
  const intersectionStart = Math.max(
    0,
    runAnchor - ROUTE_CORNER_ANCHOR_INTERSECTION_RADIUS
  );
  const intersectionEnd = Math.min(
    runLimit - 1,
    runAnchor + ROUTE_CORNER_ANCHOR_INTERSECTION_RADIUS
  );
  let maximumRun = 0;
  for (let fixed = fixedStart; fixed <= fixedEnd; fixed += 1) {
    let runStart = null;
    for (let run = 0; run <= runLimit; run += 1) {
      const x = axis === 'vertical' ? fixed : run;
      const y = axis === 'vertical' ? run : fixed;
      const opaque = run < runLimit
        && data[((y * width) + x) * 4 + 3]
          >= ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD;
      if (opaque && runStart === null) {
        runStart = run;
      } else if (!opaque && runStart !== null) {
        const runEnd = run - 1;
        if (runStart <= intersectionEnd && runEnd >= intersectionStart) {
          maximumRun = Math.max(maximumRun, runEnd - runStart + 1);
        }
        runStart = null;
      }
    }
  }
  if (maximumRun < ROUTE_CORNER_MINIMUM_CORE_WIDTH) {
    throw new Error(
      `${label} route corner ${topology} maximum anchor-intersecting opaque `
      + `${axis} run is ${maximumRun} pixels; expected at least `
      + `${ROUTE_CORNER_MINIMUM_CORE_WIDTH}`
    );
  }
  return { axis, maximumRun };
}

function perpendicularOpaqueRunAtSample({
  data,
  width,
  height,
  sample,
  vector,
  alphaThreshold = ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD
}) {
  const length = Math.hypot(vector.x, vector.y);
  const perpendicular = {
    x: -vector.y / length,
    y: vector.x / length
  };
  const maximumDistance = Math.ceil(Math.hypot(width, height)) + 1;
  let longestRun = 0;
  let currentRun = 0;
  let previousPixel = null;
  for (let distance = -maximumDistance;
    distance <= maximumDistance;
    distance += 1) {
    const x = Math.round(sample.x + (perpendicular.x * distance));
    const y = Math.round(sample.y + (perpendicular.y * distance));
    const pixel = `${x},${y}`;
    if (pixel === previousPixel) continue;
    previousPixel = pixel;
    const opaque = x >= 0
      && x < width
      && y >= 0
      && y < height
      && data[((y * width) + x) * 4 + 3]
        >= alphaThreshold;
    currentRun = opaque ? currentRun + 1 : 0;
    longestRun = Math.max(longestRun, currentRun);
  }
  return longestRun;
}

export async function assertRouteArmMinimumCoreWidth({
  bytes,
  descriptor,
  label = `${descriptor.id} generated candidate`
}) {
  const topology = descriptor.capabilities?.routeTopology;
  if (descriptor.category !== 'route-transition'
    || typeof topology !== 'string'
    || topology === 'isolated') {
    return null;
  }
  const directions = routeDirectionsForTopology(topology);
  if (directions.length === 0) return null;
  const { data, width, height } = await decodeBoundedNormalizedCandidateRgba({
    bytes,
    descriptor,
    label
  });
  const anchor = descriptor.placement?.anchor;
  if (!Number.isSafeInteger(anchor?.x)
    || anchor.x < 0
    || anchor.x >= width
    || !Number.isSafeInteger(anchor?.y)
    || anchor.y < 0
    || anchor.y >= height) {
    throw new Error(`${label} has an invalid declared route anchor`);
  }
  const samples = [];
  const armContract = routeArmAlphaSpanContract(descriptor);
  const usesAuthoredSpreadContract =
    Number.isSafeInteger(armContract.maximumSpreadPixels);
  for (const direction of directions) {
    const vector = ROUTE_ARM_VECTORS[direction];
    for (const fraction of ROUTE_ARM_SAMPLE_FRACTIONS) {
      const span = perpendicularOpaqueRunAtSample({
        data,
        width,
        height,
        sample: {
          x: anchor.x + (vector.x * fraction),
          y: anchor.y + (vector.y * fraction)
        },
        vector,
        alphaThreshold: armContract.alphaThreshold
      });
      const percent = Math.round(fraction * 100);
      if (!usesAuthoredSpreadContract
        && span < armContract.minimumPixels) {
        throw new Error(
          `${label} route ${topology} ${direction} arm opaque perpendicular `
          + `span at ${percent}% is ${span} pixels; expected at least `
          + `${armContract.minimumPixels}`
        );
      }
      if (
        !usesAuthoredSpreadContract
        && Number.isSafeInteger(armContract.maximumPixels)
        && span > armContract.maximumPixels
      ) {
        throw new Error(
          `${label} route ${topology} ${direction} arm opaque perpendicular `
          + `span at ${percent}% is ${span} pixels; expected at most `
          + `${armContract.maximumPixels}`
        );
      }
      samples.push({ direction, percent, span });
    }
  }
  if (usesAuthoredSpreadContract) {
    const spans = samples.map(sample => sample.span);
    const minimumSpan = Math.min(...spans);
    const maximumSpan = Math.max(...spans);
    const spread = maximumSpan - minimumSpan;
    if (spread > armContract.maximumSpreadPixels) {
      throw new Error(
        `${label} route ${topology} arm opaque perpendicular spans vary by `
        + `${spread} pixels (${minimumSpan}..${maximumSpan}); expected at most `
        + `${armContract.maximumSpreadPixels} across the six required `
        + 'measurements'
      );
    }
    const narrowSample = samples.find(
      sample => sample.span < armContract.minimumPixels
    );
    if (narrowSample) {
      throw new Error(
        `${label} route ${topology} ${narrowSample.direction} arm opaque `
        + `perpendicular span at ${narrowSample.percent}% is `
        + `${narrowSample.span} pixels; expected at least `
        + `${armContract.minimumPixels}`
      );
    }
    const wideSample = samples.find(
      sample => sample.span > armContract.maximumPixels
    );
    if (wideSample) {
      throw new Error(
        `${label} route ${topology} ${wideSample.direction} arm opaque `
        + `perpendicular span at ${wideSample.percent}% is `
        + `${wideSample.span} pixels; expected at most `
        + `${armContract.maximumPixels}`
      );
    }
  }
  return { samples };
}

export async function assertCornerEsAnchorArchPlacement({
  bytes,
  descriptor,
  label = `${descriptor.id} generated candidate`
}) {
  if (
    descriptor.schemaVersion !== DESCRIPTOR_SCHEMA_V2
    || descriptor.category !== 'route-transition'
    || descriptor.capabilities?.routeTopology !== 'corner-es'
  ) {
    return null;
  }
  const { data, width, height } = await decodeBoundedNormalizedCandidateRgba({
    bytes,
    descriptor,
    label
  });
  const alphaAt = (x, y) => data[((y * width) + x) * 4 + 3];
  for (
    let y = CORNER_ES_UPPER_CLEAR_BOUNDS.minimumY;
    y <= CORNER_ES_UPPER_CLEAR_BOUNDS.maximumY;
    y += 1
  ) {
    for (
      let x = CORNER_ES_UPPER_CLEAR_BOUNDS.minimumX;
      x <= CORNER_ES_UPPER_CLEAR_BOUNDS.maximumX;
      x += 1
    ) {
      if (
        x < width
        && y < height
        && alphaAt(x, y) >= ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD
      ) {
        throw new Error(
          `${label} route corner-es upper-center exclusion contains `
          + `alpha-at-least-${ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD} at `
          + `${x},${y}; expected the apex core x=120..135 to remain below `
          + 'alpha 240 through y=32'
        );
      }
    }
  }
  const apexTopRows = [];
  for (
    let x = CORNER_ES_APEX_CORE_BOUNDS.minimumX;
    x <= CORNER_ES_APEX_CORE_BOUNDS.maximumX;
    x += 1
  ) {
    let topRow = null;
    for (let y = 0; y < height; y += 1) {
      if (x < width && alphaAt(x, y) >= ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD) {
        topRow = y;
        break;
      }
    }
    if (topRow === null) {
      throw new Error(
        `${label} route corner-es apex core is absent at x=${x}; expected a `
        + 'continuous centered core across x=120..135'
      );
    }
    apexTopRows.push(topRow);
  }
  let maximumApexTopStep = 0;
  let maximumApexFlatRun = 1;
  let currentApexFlatRun = 1;
  for (let index = 1; index < apexTopRows.length; index += 1) {
    const step = Math.abs(apexTopRows[index] - apexTopRows[index - 1]);
    maximumApexTopStep = Math.max(maximumApexTopStep, step);
    if (step > CORNER_ES_MAXIMUM_APEX_TOP_STEP) {
      throw new Error(
        `${label} route corner-es apex top boundary jumps ${step} pixels `
        + `between x=${CORNER_ES_APEX_CORE_BOUNDS.minimumX + index - 1} and `
        + `x=${CORNER_ES_APEX_CORE_BOUNDS.minimumX + index}; expected at most `
        + `${CORNER_ES_MAXIMUM_APEX_TOP_STEP} without a carved notch`
      );
    }
    currentApexFlatRun = apexTopRows[index] === apexTopRows[index - 1]
      ? currentApexFlatRun + 1
      : 1;
    maximumApexFlatRun = Math.max(
      maximumApexFlatRun,
      currentApexFlatRun
    );
    if (currentApexFlatRun > CORNER_ES_MAXIMUM_APEX_FLAT_RUN) {
      throw new Error(
        `${label} route corner-es apex top boundary has a `
        + `${currentApexFlatRun}-pixel ruler-flat run; expected at most `
        + `${CORNER_ES_MAXIMUM_APEX_FLAT_RUN} without a rectangular mask cut`
      );
    }
  }
  if (Number.isSafeInteger(
    routeArmAlphaSpanContract(descriptor).maximumSpreadPixels
  )) {
    const sharedCoreStartY = Math.max(...apexTopRows);
    const sharedCoreEndY =
      sharedCoreStartY + CORNER_ES_APEX_CORE_MINIMUM_HEIGHT - 1;
    for (
      let x = CORNER_ES_APEX_CORE_BOUNDS.minimumX;
      x <= CORNER_ES_APEX_CORE_BOUNDS.maximumX;
      x += 1
    ) {
      for (
        let y = sharedCoreStartY;
        y <= sharedCoreEndY;
        y += 1
      ) {
        if (y >= height
          || alphaAt(x, y) < ROUTE_CORNER_OPAQUE_ALPHA_THRESHOLD) {
          throw new Error(
            `${label} route corner-es shared apex core contains a `
            + `sub-240-alpha gap at ${x},${y}; expected x=120..135 to `
            + `remain alpha-at-least-240 for `
            + `${CORNER_ES_APEX_CORE_MINIMUM_HEIGHT} consecutive rows from `
            + `the lowest apex-column top at y=${sharedCoreStartY}`
          );
        }
      }
    }
  }
  return {
    minimumOpaqueCoreHeight: CORNER_ES_APEX_CORE_MINIMUM_HEIGHT,
    maximumApexTopStep,
    maximumApexFlatRun
  };
}

export async function assertRouteCornerMaximumCoverage({
  bytes,
  descriptor,
  label = `${descriptor.id} generated candidate`
}) {
  const topology = descriptor.capabilities?.routeTopology;
  if (
    descriptor.schemaVersion !== DESCRIPTOR_SCHEMA_V2
    || descriptor.category !== 'route-transition'
    || !Object.hasOwn(ROUTE_CORNER_AXIS_BY_TOPOLOGY, topology)
  ) {
    return null;
  }
  const { data, width, height } = await decodeBoundedNormalizedCandidateRgba({
    bytes,
    descriptor,
    label
  });
  let coveredPixels = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) coveredPixels += 1;
  }
  const totalPixels = width * height;
  const coveragePermille = Math.floor(
    (coveredPixels * 1000) / totalPixels
  );
  if (
    coveredPixels * 1000
      > totalPixels * ROUTE_CORNER_MAXIMUM_COVERAGE_PERMILLE_V2
  ) {
    throw new Error(
      `${label} route corner ${topology} alpha coverage is `
      + `${coveragePermille}‰; expected at most `
      + `${ROUTE_CORNER_MAXIMUM_COVERAGE_PERMILLE_V2}‰; covered `
      + `${coveredPixels} of ${totalPixels} pixels`
    );
  }
  return { coveredPixels, totalPixels, coveragePermille };
}

export async function assertRouteStraightMaximumCoverage({
  bytes,
  descriptor,
  label = `${descriptor.id} generated candidate`
}) {
  const topology = descriptor.capabilities?.routeTopology;
  if (descriptor.category !== 'route-transition'
    || !ROUTE_STRAIGHT_TOPOLOGIES.has(topology)) {
    return null;
  }
  const { data, width, height } = await decodeBoundedNormalizedCandidateRgba({
    bytes,
    descriptor,
    label
  });
  let coveredPixels = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) coveredPixels += 1;
  }
  const totalPixels = width * height;
  const coveragePermille = Math.floor(
    (coveredPixels * 1000) / totalPixels
  );
  if (coveredPixels * 1000
    > totalPixels * ROUTE_STRAIGHT_MAXIMUM_COVERAGE_PERMILLE) {
    throw new Error(
      `${label} straight route ${topology} alpha coverage is `
      + `${coveragePermille}‰; expected at most `
      + `${ROUTE_STRAIGHT_MAXIMUM_COVERAGE_PERMILLE}‰; covered `
      + `${coveredPixels} of ${totalPixels} pixels`
    );
  }
  return { coveredPixels, totalPixels, coveragePermille };
}

export async function assertRouteStraightMaximumLongitudinalExtent({
  bytes,
  descriptor,
  label = `${descriptor.id} generated candidate`
}) {
  const topology = descriptor.capabilities?.routeTopology;
  if (
    descriptor.schemaVersion !== DESCRIPTOR_SCHEMA_V2
    || descriptor.category !== 'route-transition'
    || !ROUTE_STRAIGHT_TOPOLOGIES.has(topology)
  ) {
    return null;
  }
  const { data, width, height } = await decodeBoundedNormalizedCandidateRgba({
    bytes,
    descriptor,
    label
  });
  const anchor = descriptor.placement?.anchor;
  if (!Number.isSafeInteger(anchor?.x)
    || anchor.x < 0
    || anchor.x >= width
    || !Number.isSafeInteger(anchor?.y)
    || anchor.y < 0
    || anchor.y >= height) {
    throw new Error(`${label} has an invalid declared route anchor`);
  }
  const samples = [];
  for (const direction of routeDirectionsForTopology(topology)) {
    const vector = ROUTE_ARM_VECTORS[direction];
    const lengthSquared =
      (vector.x * vector.x) + (vector.y * vector.y);
    const length = Math.sqrt(lengthSquared);
    let maximumProjection = Number.NEGATIVE_INFINITY;
    let maximumPoint = null;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[((y * width) + x) * 4 + 3] === 0) continue;
        const deltaX = x - anchor.x;
        const deltaY = y - anchor.y;
        const projection = (
          (deltaX * vector.x) + (deltaY * vector.y)
        ) / lengthSquared;
        if (projection > maximumProjection) {
          maximumProjection = projection;
          maximumPoint = { x, y };
        }
      }
    }
    const maximumOverflowPixels = Math.max(
      0,
      (maximumProjection - 1) * length
    );
    if (
      maximumOverflowPixels > ROUTE_STRAIGHT_MAXIMUM_ARM_OVERFLOW_PIXELS
    ) {
      throw new Error(
        `${label} straight route ${topology} ${direction} arm reaches `
        + `${maximumOverflowPixels.toFixed(1)} pixels beyond its declared `
        + `terminal at `
        + `${maximumPoint.x},${maximumPoint.y}; expected at most `
        + `${ROUTE_STRAIGHT_MAXIMUM_ARM_OVERFLOW_PIXELS} pixels `
        + 'without continuing toward a rectangular canvas corner'
      );
    }
    samples.push({
      direction,
      maximumProjection,
      maximumOverflowPixels,
      maximumPoint
    });
  }
  return { samples };
}

function signalWorkerGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function signalActiveWorkerGroups(signal) {
  for (const pid of ACTIVE_WORKER_GROUPS) signalWorkerGroup(pid, signal);
}

function installWorkerSignalHandlers() {
  if (workerSignalHandlersInstalled || process.platform === 'win32') return;
  workerSignalHandlersInstalled = true;
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (workerShutdownSignal !== null) return;
      workerShutdownSignal = signal;
      signalActiveWorkerGroups('SIGTERM');
      const killTimer = setTimeout(() => {
        signalActiveWorkerGroups('SIGKILL');
        process.removeListener(signal, handler);
        process.kill(process.pid, signal);
      }, 1_000);
    };
    process.on(signal, handler);
  }
  process.on('exit', () => signalActiveWorkerGroups('SIGKILL'));
}

export const CODEX_WORKER_ENV_KEYS = Object.freeze([
  'PATH',
  'HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy'
]);
const TEXT_STYLE_SUMMARIES = Object.freeze({
  forest:
    'Crisp high-contrast 16-bit fantasy pixel art with compact orthographic '
    + 'isometric forms, cool deep evergreen and moss tones, warm dirt and bark, '
    + 'restrained leaf litter, clustered edge pixels, and soft upper-left light.',
  cave:
    'Crisp 16-bit orthographic isometric cave art with readable mineral strata, '
    + 'restrained reflected color, clustered rock pixels, deep crevice accents, '
    + 'and consistent soft upper-left illumination.',
  mountain:
    'Crisp 16-bit orthographic isometric alpine art with strongly readable rock '
    + 'planes, sparse hardy vegetation, weathered edges, atmospheric cool shadows, '
    + 'and clean upper-left light.',
  bridge:
    'Crisp 16-bit orthographic isometric bridge art with legible structural '
    + 'masonry or timber, worn travel surfaces, restrained metalwork, and coherent '
    + 'upper-left lighting.',
  castle:
    'Crisp 16-bit orthographic isometric fortress art with dressed masonry, '
    + 'weathered joints, heraldic restraint, clear walkable surfaces, and soft '
    + 'upper-left light.',
  dungeon:
    'Crisp 16-bit orthographic isometric dungeon art with damp masonry, worn '
    + 'flagstones, restrained grime, readable edges, and controlled warm-cool '
    + 'upper-left illumination.',
  swamp:
    'Crisp 16-bit orthographic isometric wetland art with layered peat, reeds, '
    + 'roots, humid moss, muted reflected color, and readable upper-left light.',
  volcano:
    'Crisp 16-bit orthographic isometric volcanic art with basalt planes, ash, '
    + 'restrained ember glow, high heat contrast, and consistent upper-left form light.',
  plains:
    'Crisp 16-bit orthographic isometric grassland art with varied turf clumps, '
    + 'warm soil, sparse field details, soft organic transitions, and upper-left light.',
  arena:
    'Crisp 16-bit orthographic isometric arena art with durable combat surfaces, '
    + 'formal boundaries, restrained ornament, clean readability, and upper-left light.',
  guild:
    'Crisp 16-bit orthographic isometric guild-ground art with practical timber, '
    + 'stone, banners, worn training surfaces, and consistent upper-left light.',
  elven_grove:
    'Crisp 16-bit orthographic isometric elven-grove art with elegant living wood, '
    + 'luminous foliage, carved stone restraint, organic seams, and upper-left light.',
  dwarven_mine:
    'Crisp 16-bit orthographic isometric dwarven-mine art with hewn geology, robust '
    + 'supports, metal accents, clear strata, and warm-cool upper-left illumination.',
  vampiric_crypt:
    'Crisp 16-bit orthographic isometric crypt art with dark dressed stone, aged '
    + 'funerary details, restrained crimson accents, and dramatic upper-left light.',
  orcish_warcamp:
    'Crisp 16-bit orthographic isometric warcamp art with rugged timber, hide, iron, '
    + 'trampled ground, forceful silhouettes, and coherent upper-left light.',
  human_ruins:
    'Crisp 16-bit orthographic isometric ruin art with broken regional masonry, '
    + 'weathering, reclaiming vegetation, readable debris, and soft upper-left light.'
});
const ROUTE_DIRECTION_LABELS = Object.freeze({
  n: 'N upper-right',
  e: 'E lower-right',
  s: 'S lower-left',
  w: 'W upper-left'
});
const ROUTE_OPPOSITE_DIRECTIONS = Object.freeze({
  n: 's',
  e: 'w',
  s: 'n',
  w: 'e'
});
const CORNER_PHYSICAL_SHAPES = Object.freeze({
  'corner-ne':
    'a rounded right-side hairpin between the upper-right and lower-right targets',
  'corner-es':
    'a flat rounded anchor arch between the lower-right and lower-left targets, '
    + 'matching the approved Borderwood corner-es topology. Treat that approved '
    + 'reference silhouette as hard macro-geometry authority: retain its low '
    + 'shallow crown and modest center rise instead of redrawing a tall deep '
    + 'semicircle or broad hollow half-ring. Put both seam-arm '
    + 'tips at 25% and 75% canvas width and 75% canvas height, then rise inward '
    + 'through one continuous rounded band at 50% width and 50% canvas height. '
    + 'Keep the shared apex core x=120..135 fully opaque for at least 29 '
    + 'consecutive rows beginning at the lowest apex-column top, while the '
    + 'apex core x=120..135 remains below alpha 240 through y=32. This '
    + 'preserves the '
    + 'JSON-prime core depth while allowing its whole crown a bounded '
    + '22-pixel upward shift, without admitting a tall half-ring. Do not '
    + 'invert this into a '
    + 'classic upright U with its open tips in the upper half. Compose this '
    + 'geometry in the raw imagegen subject itself. Make the generated loam core '
    + 'deliberately even and obey the arm-width contract stated below after the '
    + 'model output is resized as a whole to 256x128, with no center flare or '
    + 'seam-tip taper. Keep '
    + 'the upper exclusion visibly empty in the generated composition. '
    + 'Deterministic finishing may '
    + 'only place the complete generated subject; it cannot repair an incorrect '
    + 'arch, add missing geometry, or remove internal route content',
  'corner-sw':
    'a rounded left-side hairpin between the lower-left and upper-left targets',
  'corner-wn':
    'a rounded top-side hairpin between the upper-left and upper-right targets'
});

function routeDirectionsForTopology(topology) {
  if (topology === 'isolated') return [];
  if (topology === 'cross') return ['n', 'e', 's', 'w'];
  const directions = topology?.split('-')[1]?.split('') ?? [];
  if (
    directions.length === 0
    || directions.some(direction => !Object.hasOwn(ROUTE_DIRECTION_LABELS, direction))
  ) {
    throw new Error(`unsupported route topology ${topology}`);
  }
  return directions;
}

function positiveInteger(value, flag, maximum) {
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error(`${flag} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw new Error(`${flag} must be between 1 and ${maximum}`);
  }
  return number;
}

export function parseGenerateArgs(argv) {
  const options = {
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    force: false,
    resume: false,
    keepGoing: false,
    textStyleFallback: false,
    recover: false,
    timeoutProvided: false
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? null : argument.slice(equals + 1);
    const value = () => {
      const result = inline ?? argv[++index];
      if (!result || result.startsWith('--')) throw new Error(`${flag} requires a value`);
      return result;
    };
    const once = (key, next) => {
      if (seen.has(flag)) throw new Error(`${flag} may only be provided once`);
      seen.add(flag);
      options[key] = next;
    };
    const repeat = (key, next) => {
      options[key] = [...(options[key] ?? []), next];
    };
    if (flag === '--theme') once('theme', value());
    else if (flag === '--family') repeat('families', value());
    else if (flag === '--ecology-profile') once('ecologyProfile', value());
    else if (flag === '--tier') {
      once('tier', positiveInteger(value(), flag, TIER_BANDS.at(-1)));
    }
    else if (flag === '--category') once('category', value());
    else if (flag === '--surface-variant') {
      const variant = value();
      if (!/^[0-7]$/.test(variant)) {
        throw new Error(`${flag} must be an integer from 0 through 7`);
      }
      once('surfaceVariant', Number(variant));
    }
    else if (flag === '--concurrency') once('concurrency', positiveInteger(value(), flag, MAX_CONCURRENCY));
    else if (flag === '--timeout') {
      once(
        'timeoutMs',
        positiveInteger(value(), flag, MAX_TIMEOUT_MS / 1000) * 1000
      );
      options.timeoutProvided = true;
    }
    else if (flag === '--project-root') once('projectRoot', path.resolve(value()));
    else if (flag === '--dry-run' && inline === null) options.dryRun = true;
    else if (flag === '--force' && inline === null) options.force = true;
    else if (flag === '--resume' && inline === null) options.resume = true;
    else if (flag === '--keep-going' && inline === null) {
      options.keepGoing = true;
    }
    else if (flag === '--text-style-fallback' && inline === null) {
      options.textStyleFallback = true;
    }
    else if (flag === '--recover' && inline === null) {
      options.recover = true;
    }
    else throw new Error(`unknown generate argument ${argument}`);
  }
  if (options.force && options.resume) throw new Error('--force and --resume are mutually exclusive');
  return options;
}

export function buildCodexArgs(workspace, lastMessagePath, imagePaths = []) {
  return [
    'exec',
    '--ephemeral',
    '--enable',
    'image_generation',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'workspace-write',
    '-C',
    workspace,
    ...imagePaths.flatMap(imagePath => ['--image', imagePath]),
    '-c',
    'model_reasoning_effort="low"',
    '-o',
    lastMessagePath,
    '-'
  ];
}

export function buildCodexWorkerEnvironment(source = process.env) {
  const environment = {};
  for (const key of CODEX_WORKER_ENV_KEYS) {
    if (typeof source[key] === 'string' && source[key].length > 0) {
      environment[key] = source[key];
    }
  }
  return environment;
}

export function runCommand({
  command,
  args,
  cwd,
  input,
  timeoutMs,
  maxOutputBytes = MAX_WORKER_OUTPUT_BYTES,
  spawnImpl = spawn,
  environmentSource = process.env
}) {
  return new Promise((resolve, reject) => {
    if (workerShutdownSignal !== null) {
      reject(new Error(
        `Codex worker launch refused during ${workerShutdownSignal} shutdown`
      ));
      return;
    }
    const detached = process.platform !== 'win32';
    const child = spawnImpl(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildCodexWorkerEnvironment(environmentSource),
      detached
    });
    const trackedWorker = detached
      && spawnImpl === spawn
      && Number.isSafeInteger(child.pid)
      && child.pid > 0;
    if (trackedWorker) {
      installWorkerSignalHandlers();
      ACTIVE_WORKER_GROUPS.add(child.pid);
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let forcedError = null;
    let killTimer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (trackedWorker) ACTIVE_WORKER_GROUPS.delete(child.pid);
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      callback(value);
    };
    const signalWorker = signal => {
      if (detached && Number.isSafeInteger(child.pid) && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      child.kill(signal);
    };
    const stopWorker = error => {
      if (forcedError !== null) return;
      forcedError = error;
      signalWorker('SIGTERM');
      killTimer = setTimeout(() => signalWorker('SIGKILL'), 1_000);
      killTimer.unref();
    };
    const overLimit = stream => {
      stopWorker(new Error(`${stream} exceeded ${maxOutputBytes} bytes`));
    };
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) overLimit('worker stdout');
      else if (forcedError === null) stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutputBytes) overLimit('worker stderr');
      else if (forcedError === null) stderr.push(chunk);
    });
    child.once('error', error => {
      if (forcedError === null) finish(reject, error);
    });
    child.once('close', (code, signal) => {
      if (forcedError !== null) {
        finish(reject, forcedError);
      } else if (timedOut) {
        finish(reject, new Error(`Codex worker timed out after ${timeoutMs}ms`));
      } else if (code !== 0) {
        finish(reject, new Error(
          `Codex worker ${signal ? `terminated by ${signal}` : `exited with code ${code}`}`
        ));
      } else {
        finish(resolve, {
          code,
          signal,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr)
        });
      }
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stopWorker(new Error(`Codex worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdin.once('error', error => {
      if (error.code !== 'EPIPE') finish(reject, error);
    });
    child.stdin.end(`${input}\n`);
  });
}

export async function spawnCodexWorker({
  workspace,
  prompt,
  timeoutMs,
  styleFiles = []
}) {
  const lastMessagePath = path.join(workspace, 'last-message.txt');
  const args = buildCodexArgs(
    workspace,
    lastMessagePath,
    styleFiles.map(file => path.join(workspace, file))
  );
  const result = await runCommand({
    command: 'codex',
    args,
    cwd: workspace,
    input: prompt,
    timeoutMs
  });
  return { ...result, command: 'codex', args };
}

export function buildGenerationPrompt({
  descriptor,
  profile,
  styleFiles,
  textStyleFallback = false
}) {
  const routeGeneration = descriptor.category === 'route-transition';
  const routeTopology = descriptor.capabilities?.routeTopology;
  const routeSubjectBoxFinishing = routeGeneration
    && descriptor.routeFinishing?.strategy === 'largest-component-box-v1';
  const routeAnchorScaleFinishing = routeGeneration
    && descriptor.routeFinishing?.strategy === 'anchor-scale-v1';
  const directGeometryPrimePromptAppendInstruction =
    descriptor.directGeometryPrime
      ? ` Then append exactly one newline, the label "Geometry prime JSON: ", `
        + `and this exact compact JSON with no changes: `
        + `${JSON.stringify(descriptor.directGeometryPrime)}`
      : '';
  const routeArmContract = routeArmAlphaSpanContract(descriptor);
  const usesAuthoredArmSpanContract = Number.isSafeInteger(
    routeArmContract.maximumSpreadPixels
  ) && !routeAnchorScaleFinishing;
  const routeArmTargetRange = usesAuthoredArmSpanContract
    ? `${routeArmContract.minimumPixels}–${routeArmContract.maximumPixels}`
    : '28–36';
  const routeArmSpreadInstruction = usesAuthoredArmSpanContract
    ? ` Across the six required arm measurements, keep the widest and `
      + `narrowest runs within ${routeArmContract.maximumSpreadPixels} pixels `
      + 'of each other.'
    : '';
  const routeGeometryPrime = descriptor.routeFinishing?.geometryPrime;
  const routeGeometryPrimeInstruction = routeGeometryPrime
    ? ` The descriptor carries JSON geometry measured from attached reference `
      + `${routeGeometryPrime.sourceReferenceId}: on its `
      + `${routeGeometryPrime.canvas.width}x${routeGeometryPrime.canvas.height} `
      + `canvas the connected subject occupied `
      + `${routeGeometryPrime.subjectBounds.width}x`
      + `${routeGeometryPrime.subjectBounds.height} at `
      + `(${routeGeometryPrime.subjectBounds.x},`
      + `${routeGeometryPrime.subjectBounds.y}), covered `
      + `${routeGeometryPrime.coveragePermille}‰, and extended only `
      + `${routeGeometryPrime.terminalOverflowPixels.n} N / `
      + `${routeGeometryPrime.terminalOverflowPixels.s} S pixels beyond the `
      + 'declared terminal planes. Treat those compact occupied proportions and '
      + 'terminal cuts as the prime construction target while widening the '
      + `near-opaque band to the current ${routeArmTargetRange}-pixel contract.`
    : '';
  const routeArmCompositionInstruction = usesAuthoredArmSpanContract
    ? `Generate every declared arm so its connected near-opaque route band at `
      + `finished alpha >= ${routeArmContract.alphaThreshold} is `
      + `${routeArmTargetRange} pixels wide. Build that measured band from the `
      + 'solid warm-loam core and firmly attached near-opaque verge pixels. '
      + (routeSubjectBoxFinishing
        ? 'Keep any softer visible fringe and low verge decoration sparse, '
          + 'broken, and attached outside that measured band. Never surround '
          + 'the route with a continuous rhythm of upright grass teeth. Do not '
          + 'rely on partial transparency to satisfy the measured width: '
          + 'express softness through a low irregular silhouette and blended '
          + 'materials.'
        : `The complete visible silhouette is ${routeArmTargetRange} pixels `
          + 'wide, including the warm-loam core and all grass or leaf verge '
          + 'pixels. Keep low verge decoration sparse, broken, and attached '
          + 'inside that total band; never surround the route with a continuous '
          + 'rhythm of upright grass teeth. Do not rely on partial transparency '
          + 'for shape or softness: express softness through a low irregular '
          + 'silhouette and blended materials.')
    : 'Generate every declared arm with a continuous 28–36 pixel warm-loam '
      + 'core. Add a low 6–10 pixel irregular visible grass-and-leaf verge '
      + 'along each long side, attached to and blended into that core. Do not '
      + 'rely on partial transparency for shape or softness: a flat chroma '
      + 'source may normalize to a binary-alpha cutout.';
  const cornerEsApexContinuityInstruction = usesAuthoredArmSpanContract
    ? ' Across x=120..135, make the visible apex core column-convex across one '
      + 'shared 29-row band beginning at the lowest first-visible loam pixel '
      + 'among those columns. Keep every pixel in that band filled by the same '
      + 'connected route. Put no isolated grass or leaf accent above that '
      + 'central core or inside its upper exclusion. Paint the central band '
      + 'solid with no magenta-background pinhole, grass cutout, notch, or '
      + 'other transparent gap inside those columns.'
    : '';
  const routeTopologyClass = topology => (
    typeof topology === 'string'
      ? topology.split('-', 1)[0]
      : null
  );
  const approvedReferenceTopology = reference => (
    reference.id.match(
      /approved-route-((?:corner|straight|tee|end)-[a-z]+|cross|isolated)-v[1-9][0-9]*$/
    )?.[1] ?? null
  );
  const routeReferenceTopologies = routeGeneration
    ? descriptor.styleReferences.map(approvedReferenceTopology)
    : [];
  const correctiveReferenceEntries = routeGeneration
    ? descriptor.styleReferences.map(reference => (
        correctiveStyleReferenceForConsumer(reference, {
          theme: descriptor.theme,
          familyId: descriptor.id
        }, `${descriptor.id} style reference ${reference.id}`)
      ))
    : [];
  const correctiveReferenceIndexes = correctiveReferenceEntries.flatMap(
    (entry, index) => entry === null ? [] : [index]
  );
  if (
    correctiveReferenceIndexes.length > 1
    || (
      correctiveReferenceIndexes.length === 1
      && correctiveReferenceIndexes[0] !== descriptor.styleReferences.length - 1
    )
  ) {
    throw new Error(
      `${descriptor.id} corrective style reference must be unique and last`
    );
  }
  if (correctiveReferenceIndexes.length > 0 && textStyleFallback) {
    throw new Error(
      `${descriptor.id} corrective style reference requires attached images; `
      + '--text-style-fallback is not supported'
    );
  }
  const exactTopologyReferenceIndexes = routeReferenceTopologies.flatMap(
    (referenceTopology, index) => (
      referenceTopology === routeTopology ? [index] : []
    )
  );
  const transformEquivalentReferenceIndexes = routeReferenceTopologies.flatMap(
    (referenceTopology, index) => (
      referenceTopology !== null
      && referenceTopology !== routeTopology
      && routeTopologyClass(referenceTopology) === routeTopologyClass(routeTopology)
        ? [index]
        : []
    )
  );
  const teeTransformInstruction = referenceTopology => {
    if (routeTopologyClass(routeTopology) !== 'tee'
      || routeTopologyClass(referenceTopology) !== 'tee') {
      return '';
    }
    const directionOrder = ['n', 'e', 's', 'w'];
    const referenceDirections =
      new Set(routeDirectionsForTopology(referenceTopology));
    const targetDirections = new Set(routeDirectionsForTopology(routeTopology));
    const sharedDirections = directionOrder.filter(direction => (
      referenceDirections.has(direction) && targetDirections.has(direction)
    ));
    const removedDirections = directionOrder.filter(direction => (
      referenceDirections.has(direction) && !targetDirections.has(direction)
    ));
    const addedDirections = directionOrder.filter(direction => (
      !referenceDirections.has(direction) && targetDirections.has(direction)
    ));
    if (sharedDirections.length !== 2
      || removedDirections.length !== 1
      || addedDirections.length !== 1) {
      throw new Error(
        `unsupported transform-equivalent tee mapping `
        + `${referenceTopology} to ${routeTopology}`
      );
    }
    return ` Keep the shared ${sharedDirections.map(
      direction => direction.toUpperCase()
    ).join(' and ')} arms in place; replace only the reference's `
      + `${removedDirections[0].toUpperCase()} arm with the target's `
      + `${addedDirections[0].toUpperCase()} arm, and leave the now-forbidden `
      + `${removedDirections[0].toUpperCase()} side transparent.`;
  };
  const rasterInstruction = routeGeneration
    ? `For the transparent-cutout route contract, generate the complete declared `
      + `topology against one uniform ${profile.background.chroma} exterior. `
      + `Preserve that generated artifact byte-for-byte in candidate.png. After `
      + `secure source verification, the parent npm lifecycle `
      + (routeSubjectBoxFinishing
        ? `removes chroma, selects the one largest connected route component, `
          + `crops it once to its measured alpha bounds, resizes it once into `
          + `the descriptor-pinned target box, clips only overflow beyond any `
          + `descriptor-pinned straight-route terminal planes, despills the exterior alpha `
          + `frontier, and runs the route and generic raster contracts.`
        : routeAnchorScaleFinishing
          ? `performs one exact-aspect whole-image normalization, uniformly `
            + `scales the complete generated subject about the declared anchor `
            + `by the descriptor-pinned factor, crops back to the declared `
            + `canvas, clears the outermost four pixels and only forbidden `
            + `capability-edge bands, normalizes once more, `
            + `and runs the route and generic raster contracts.`
        : `performs any exact-aspect whole-image resize, removes chroma, `
          + `despills the exterior alpha frontier, and runs the generic raster `
          + `contract.`)
    : descriptor.rasterContract.kind === 'opaque-tile-diamond'
    ? `For the opaque-tile-diamond contract, the final ${descriptor.canvas.width}x`
      + `${descriptor.canvas.height} alpha mask must set alpha 255 for every integer pixel `
      + 'satisfying abs(x-(W-1)/2)/(W/2) + abs(y-(H-1)/2)/(H/2) <= 1, '
      + 'and alpha 0 outside that diamond. Apply this deterministic mask locally after '
      + 'the single generation call.'
    : 'For the transparent-cutout contract, remove the uniform chroma completely, keep '
      + 'all subject pixels inside drawBounds, preserve transparent canvas corners, and '
      + 'place the finished subject on the declared canvas without adding background art. '
      + `The npm normalizer first clears every opaque pixel whose maximum RGB-channel `
      + `distance from ${profile.background.chroma} is at most `
      + `${profile.background.tolerance * 3}; never use such a color for route core, `
      + 'subject edge, or seam padding. It then advances an exterior frontier for up to '
      + '16 passes: an opaque pixel on that frontier is strong magenta chroma when its '
      + `distance from ${profile.background.chroma} is greater than `
      + `${profile.background.tolerance * 3}, red minus green is at least 24, and blue `
      + 'minus green is at least 24. Recolor every such pixel from a nonchroma inward '
      + 'donor or clear it, then recompute the frontier; target zero remaining pixels. '
      + 'Before saving, explicitly run those exact tests on the final exterior-facing '
      + 'alpha boundary. The lifecycle still fails above 3 residual fringe pixels.';
  const styleInstruction = textStyleFallback
    ? `The ${styleFiles.length} hash-pinned style reference ${styleFiles.length === 1
      ? 'binary remains'
      : 'binaries remain'} staged for audit only. Do not open ${styleFiles.length === 1
      ? 'it'
      : 'them'} and do not
pass any local image path to imagegen. Use this reviewed textual style authority instead:
${TEXT_STYLE_SUMMARIES[descriptor.theme] ?? `Distinct ${descriptor.theme} 16-bit fantasy isometric battle-map art.`}
Local image-view tools are unavailable in this restricted worker. Do not call them on the
candidate.${routeGeneration
  ? ' Preserve the copied route artifact without inspecting or editing it; the parent lifecycle performs dimension and raster validation.'
  : ' Verify dimensions, alpha, bounds, and topology with local metadata/raster code.'}`
    : `The following ${styleFiles.length} hash-verified style reference image`
      + `${styleFiles.length === 1 ? ' is' : 's are'} already attached to this worker `
      + `turn in the declared order:
${styleFiles.map(file => `- ${file} (staged audit copy only)`).join('\n')}
Inspect the attached conversation images directly. Do not call a local image-view tool on
the staged paths and do not pass those paths through referenced_image_paths. In the one
permitted imagegen call, set num_last_images_to_include to exactly ${styleFiles.length} so
the attached references are included in their declared order.
${styleFiles.map((file, index) => (
    correctiveReferenceIndexes.includes(index)
      ? `- Image ${index + 1} (${file}) is the immutable rejected v7 `
        + 'straight-ns raw corrective edit target. It is not approved, '
        + 'publishable, or independently reusable as source art. Edit this '
        + 'same-orientation image surgically: preserve its existing N/S macro '
        + 'geometry, centerline, occupied bounds, endpoint reach, Heartlands '
        + 'materials, and connected silhouette. Its recorded post-finish '
        + 'alpha-240 spans are N=35,38,37 and S=39,33,36; harden and locally '
        + 'widen the attached band at the failing cross-sections, especially '
        + 'N 50% and S 75%, until every sample is 36–44 pixels with spread no '
        + 'greater than 8. Do not mirror, rotate, redraw, globally inflate, or '
        + 'soften the ribbon to fake width. It is intentionally the final '
        + 'attached reference and has precedence over every earlier image for '
        + 'the same-orientation NS macro geometry. For the imagegen prompt '
        + 'argument, copy the Frozen family art direction verbatim as the '
        + 'complete prompt and add no preface, suffix, sampling algorithm, '
        + 'finishing explanation, or other geometry terms. The remaining '
        + 'route-contract prose in this worker task governs deterministic '
        + 'acceptance only and must not be forwarded into the imagegen prompt.'
      : exactTopologyReferenceIndexes.includes(index)
      ? routeTopology === 'corner-es'
        ? `- Image ${index + 1} (${file}) is the approved legacy corner-es `
          + 'edit target and sole visual authority. In the one imagegen call, '
          + 'perform a precise material/style edit of this image instead of '
          + 'redrawing the route from scratch. '
          + (index === styleFiles.length - 1
            ? 'It is intentionally the final attached reference; give it '
          + 'precedence over every earlier image for macro geometry. '
            : '')
          + 'For the imagegen prompt argument, copy the Frozen family art '
          + `direction verbatim.${directGeometryPrimePromptAppendInstruction} `
          + 'Add no other preface, suffix, sampling algorithm, finishing '
          + 'explanation, or geometry terms. The remaining route-contract prose '
          + 'in this worker task '
          + 'governs deterministic acceptance only and must not be forwarded '
          + 'into the imagegen prompt.'
        : `- Image ${index + 1} (${file}) is the exact approved `
          + `${descriptor.capabilities.routeTopology} silhouette, occupied-span, `
          + 'band-thickness, and negative-space authority. Match those proportions '
          + 'while replacing its regional materials with this descriptor\'s ecology.'
      : transformEquivalentReferenceIndexes.includes(index)
        ? correctiveReferenceIndexes.length > 0
          && routeTopologyClass(routeTopology) === 'straight'
          ? `- Image ${index + 1} (${file}) is the approved `
            + `${routeReferenceTopologies[index]} secondary Heartlands material `
            + 'and band-width-profile geometry oracle. It is not the edit target '
            + `and must not override Image ${correctiveReferenceIndexes[0] + 1}'s `
            + 'same-orientation NS centerline, occupied bounds, endpoints, or '
            + 'outer silhouette. Use its reflected alpha-240 profile '
            + 'N=38,38,38 and S=43,42,44 only to guide the local hardening and '
            + 'widening of the final corrective image.'
        : routeTopologyClass(routeTopology) === 'straight'
          ? routeSubjectBoxFinishing
            ? `- Image ${index + 1} (${file}) is the exact transform-equivalent `
              + `${routeReferenceTopologies[index]} edit target and geometry `
              + `authority. Perform the precise orientation edit stated in the `
              + `Frozen family art direction while preserving its connected `
              + `silhouette proportions, band-width profile, occupied span, and `
              + `negative space. For the imagegen prompt argument, copy the `
              + `Frozen family art direction verbatim as the complete prompt and `
              + `add no preface, suffix, sampling algorithm, finishing `
              + `explanation, or other geometry terms. The remaining contract `
              + `prose in this worker task governs deterministic acceptance only `
              + `and must not be forwarded into the imagegen prompt.`
          : `- Image ${index + 1} (${file}) is a transform-equivalent approved `
            + `${routeReferenceTopologies[index]} straight reference. Use its `
            + 'material scale and near-uniform band thickness only. Mentally rotate '
            + `the centerline to the declared ${routeTopology} orientation, but do `
            + 'not copy its longitudinal extent: the exact named terminal '
            + 'coordinates and maximum 8-pixel arm-overflow rule in this prompt are '
            + 'the occupied-span authority.'
          : routeTopology === 'corner-sw'
            ? `- Image ${index + 1} (${file}) is a transform-equivalent approved `
              + `${routeReferenceTopologies[index]} corner reference. Mentally `
              + `rotate or mirror its bend to the declared ${routeTopology} `
              + 'endpoints. Use the attachment only for material character, bend '
              + 'character, and general negative space; do not copy its merge '
              + 'footprint, arm flare, taper, or occupied span. The descriptor\'s '
              + '30–34 pixel S/W samples and basin-before-50% rule override the '
              + 'attachment\'s geometry. Never copy the attachment\'s literal '
              + 'endpoint orientation.'
              + (exactTopologyReferenceIndexes.length > 0
                ? ' If it differs from the exact same-topology reference, the exact '
                  + 'reference controls.'
                : '')
          : routeTopology === 'corner-es'
            ? `- Image ${index + 1} (${file}) is a transform-equivalent approved `
              + `${routeReferenceTopologies[index]} corner reference. Use it `
              + 'only for Heartlands material palette, texture scale, sparse '
              + 'verge treatment, and pixel finish. Do not copy or mentally '
              + 'transform its topology, centerline, outer silhouette, inner '
              + 'negative space, merge footprint, occupied span, or endpoint '
              + 'orientation; Image '
              + `${exactTopologyReferenceIndexes[0] + 1} is the sole geometry `
              + 'and edit-target authority.'
          : `- Image ${index + 1} (${file}) is a transform-equivalent approved `
            + `${routeReferenceTopologies[index]} ${routeTopologyClass(routeTopology)} `
            + 'reference. Mentally rotate or mirror its compact connected shape to '
            + `the declared ${routeTopology} endpoints. Use its near-uniform arm `
            + 'thickness, rounded merge scale, occupied-span scale, and negative '
            + 'space, but never copy the attachment\'s literal endpoint orientation.'
            + teeTransformInstruction(routeReferenceTopologies[index])
            + (exactTopologyReferenceIndexes.length > 0
              ? routeTopology === 'corner-es'
                ? ' If it differs from the exact same-topology reference on arch '
                  + 'topology or negative space, the exact reference controls; '
                  + 'the current descriptor\'s pixel measurements override both.'
                : ' If it differs from the exact same-topology reference, the exact '
                  + 'reference controls.'
              : '')
      : `- Image ${index + 1} (${file}) guides visual style, material, species, `
        + 'scale, and lighting only; do not copy its topology or composition.'
  )).join('\n')}`;
  const { anchor } = descriptor.placement;
  const sourceHalfTile = {
    x: RENDER_PROFILE.tileWidth * RENDER_PROFILE.sourcePixelScale / 2,
    y: RENDER_PROFILE.tileHeight * RENDER_PROFILE.sourcePixelScale / 2
  };
  const connectionVector = {
    n: { x: sourceHalfTile.x, y: -sourceHalfTile.y, edge: 'upper-right' },
    e: { x: sourceHalfTile.x, y: sourceHalfTile.y, edge: 'lower-right' },
    s: { x: -sourceHalfTile.x, y: sourceHalfTile.y, edge: 'lower-left' },
    w: { x: -sourceHalfTile.x, y: -sourceHalfTile.y, edge: 'upper-left' }
  }[descriptor.capabilities?.direction];
  const connectionTarget = connectionVector
    ? {
        x: Math.max(
          0,
          Math.min(descriptor.canvas.width - 1, anchor.x + connectionVector.x)
        ),
        y: Math.max(
          0,
          Math.min(descriptor.canvas.height - 1, anchor.y + connectionVector.y)
        )
      }
    : null;
  const routeTargets = {
    n: {
      x: anchor.x + (sourceHalfTile.x / 2),
      y: anchor.y - (sourceHalfTile.y / 2)
    },
    e: {
      x: anchor.x + (sourceHalfTile.x / 2),
      y: anchor.y + (sourceHalfTile.y / 2)
    },
    s: {
      x: anchor.x - (sourceHalfTile.x / 2),
      y: anchor.y + (sourceHalfTile.y / 2)
    },
    w: {
      x: anchor.x - (sourceHalfTile.x / 2),
      y: anchor.y - (sourceHalfTile.y / 2)
    }
  };
  const routeDirections = routeTopology
    ? routeDirectionsForTopology(routeTopology)
    : null;
  const routeEndpointInstruction = routeDirections
    ? (
        routeDirections.length === 0
          ? `This is the isolated topology: keep all four endpoint bands clear. `
            + `The path wear may occupy only the central anchor neighborhood around `
            + `${anchor.x},${anchor.y}.`
          : `Treat the topology letters literally. The only allowed route endpoint `
            + `bands for ${routeTopology} are `
            + `${routeDirections.map(direction => (
              `${ROUTE_DIRECTION_LABELS[direction]} at `
              + `${routeTargets[direction].x},${routeTargets[direction].y}`
            )).join(' and ')}. Keep these named bands visibly connected to the `
            + `${anchor.x},${anchor.y} center. Keep the forbidden `
            + `${['n', 'e', 's', 'w']
              .filter(direction => !routeDirections.includes(direction))
              .map(direction => (
                `${ROUTE_DIRECTION_LABELS[direction]} at `
                + `${routeTargets[direction].x},${routeTargets[direction].y}`
              )).join(', ') || 'none'} bands completely clear. Do not substitute a `
            + `different corner or rotate the declared topology during placement.`
      )
    : '';
  const boundaryPoint = (x, y) => ({
    x: Math.max(0, Math.min(descriptor.canvas.width - 1, x)),
    y: Math.max(0, Math.min(descriptor.canvas.height - 1, y))
  });
  const boundaryVertices = {
    top: boundaryPoint(anchor.x, anchor.y - sourceHalfTile.y),
    right: boundaryPoint(anchor.x + sourceHalfTile.x, anchor.y),
    bottom: boundaryPoint(anchor.x, anchor.y + sourceHalfTile.y),
    left: boundaryPoint(anchor.x - sourceHalfTile.x, anchor.y)
  };
  const boundarySegments = {
    n: [boundaryVertices.top, boundaryVertices.right],
    e: [boundaryVertices.right, boundaryVertices.bottom],
    s: [boundaryVertices.bottom, boundaryVertices.left],
    w: [boundaryVertices.left, boundaryVertices.top]
  };
  const boundaryPhysicalLabels = {
    n: 'upper-right diagonal, descending right from the top vertex',
    e: 'lower-right diagonal, descending left from the right vertex',
    s: 'lower-left diagonal, ascending left from the bottom vertex',
    w: 'upper-left diagonal, ascending right from the left vertex'
  };
  const boundarySegment =
    boundarySegments[descriptor.capabilities?.direction] ?? null;
  const routeBandInstruction = routeDirections
    ? (
        routeDirections.length === 0
          ? ''
          : routeSubjectBoxFinishing
            ? `Generate the complete ${
                correctiveReferenceIndexes.length > 0
                  ? 'same-orientation corrected'
                  : 'transformed'
              } route component in the `
              + `descriptor-pinned subject framing. Every named capability `
              + `target must lie inside a full-width cross-section of its `
              + `declared arm: ${routeDirections.map(direction => (
                `${direction}=(${routeTargets[direction].x},`
                + `${routeTargets[direction].y})`
              )).join(', ')}. The component may continue beyond those internal `
              + `diamond-edge contacts only as far as the exact ${
                correctiveReferenceIndexes.length > 0
                  ? 'corrective'
                  : 'transformed'
              } reference contour; those contacts are seam measurements, not `
              + `instructions to invent new tapered end caps. Keep the forbidden `
              + `target bands transparent and leave the outermost 4-pixel `
              + `rectangular border empty. The parent performs only the one `
              + `descriptor-pinned subject-box crop, resize, and placement; it `
              + `does not search placements, reshape individual arms, repaint, `
              + `or synthesize route pixels.`
          : `Generate the route only across the internal capability-diamond span, `
            + `not across the much longer rectangular-canvas diagonal. Every `
            + `named arm must physically reach within 6 pixels of the `
            + `interior 15%–85% of its exact edge segment and contribute at least `
            + `12 opaque alpha pixels there: ${routeDirections.map(direction => {
              const [start, end] = boundarySegments[direction];
              return `${direction}=(${start.x},${start.y})–(${end.x},${end.y})`;
            }).join(', ')}. Do not merely come within a broad radius of an edge `
            + `center, and do not stop short in a smaller shape that misses a `
            + `named target. `
            + (
              ROUTE_STRAIGHT_TOPOLOGIES.has(routeTopology)
                ? `Treat each exact named target as a terminal seam cross-section, `
                  + `not a final endpoint or cap center: carry the full-width route `
                  + `through it and place the cap only just beyond it. After `
                  + `reaching it, finish all dirt, grass, leaf, pebble, and `
                  + `antialias pixels within 8 pixels farther along that arm vector. `
                : `Treat each exact named target as a terminal endpoint, not a `
                  + `waypoint: after reaching it, finish all dirt, grass, leaf, `
                  + `pebble, and antialias pixels within 8 pixels farther along that `
                  + `arm vector. `
            )
            + `Leave the remaining route toward the rectangular corner `
            + `entirely magenta. Center each edge-contact band on its exact named `
            + `target and keep the band at least 16 pixels from both diamond `
            + `segment vertices. The route may touch only the diagonal capability `
            + `diamond, never the rectangular canvas border; the generated subject `
            + `must leave the outermost 4-pixel rectangular border empty. Treat `
            + `the route as a flat `
            + `painted surface overlay with zero visible vertical thickness. `
            + `Transparent pixels must begin immediately outside the low irregular `
            + `verge: render no front or side face, cut bank, curb, retaining wall, `
            + `bevel, extrusion, drop shadow, fence, picket, palisade, repeated `
            + `teeth, black underside, or colored vertical strip. After crossing a `
            + `named diagonal diamond edge, continue at most 8 pixels outward. `
            + (
              routeTopology?.startsWith('straight-')
                ? `For a straight route, keep the dirt core full width through `
                  + `each target and finish it with a short transverse end; only `
                  + `the low verge contour may be irregular. Never taper, round, `
                  + `or point either terminal cross-section.`
                : `Finish with an irregular grass-and-leaf verge. Never approach `
                  + `the rectangular border or terminate in a straight squared `
                  + `crop line.`
            )
      )
    : '';
  const routeForbiddenSegmentInstruction = routeDirections
    ? `Image generation must leave a 12-pixel interior band empty along the `
      + `15%–85% span of every forbidden diamond edge segment, with no dirt, `
      + `grass, leaf, pebble, or antialias fringe `
      + `there: ${Object.keys(ROUTE_DIRECTION_LABELS)
        .filter(direction => !routeDirections.includes(direction))
        .map(direction => {
          const [start, end] = boundarySegments[direction];
          return `${direction}=(${start.x},${start.y})–(${end.x},${end.y})`;
        }).join(', ')}. Only declared route arms may touch an edge band.`
    : '';
  const forbiddenBoundarySegments = boundarySegment
    ? Object.keys(ROUTE_DIRECTION_LABELS)
      .filter(direction => direction !== descriptor.capabilities.direction)
      .map(direction => {
        const [start, end] = boundarySegments[direction];
        return `${direction}=(${start.x},${start.y})–(${end.x},${end.y})`;
      })
      .join(', ')
    : null;
  const boundarySubjectInstruction = descriptor.id.includes('hedgerow-edge')
    ? 'This is the hedgerow-edge subfamily: confine roots, low understory, and '
      + 'ground-contact foliage to an 18–32 pixel narrow strip centered directly '
      + 'on the declared edge. Root every trunk in that one strip. Use several '
      + 'moderate regional crowns with transparent gaps between them; never fill '
      + 'the interior terrain triangle with one oversized low canopy mass. Any '
      + 'crown overhang beyond the strip must read as elevated foliage supported '
      + 'by slender trunks or separated from the ground by transparent gaps. It '
      + 'must not form a second grounded edge band, terrain wedge, or whole-tile '
      + 'foliage platform. Every crown cluster must connect visibly through a '
      + 'branch or trunk to the grounded strip; add no detached leaf island or '
      + 'floating fragment. Except for the narrow grounded strip at its two exact '
      + 'seam endpoints, keep every crown and branch at least 8 pixels inside the '
      + 'rectangular canvas. Never crop a canopy silhouette against x=0, the '
      + 'maximum x edge, y=0, or the maximum y edge. Before saving, measure the '
      + 'outermost non-ground leaf and branch alpha. If any lies inside that '
      + '8-pixel border, translate or uniformly shrink only the elevated crown '
      + 'layer inward while preserving the rooted seam strip, then remeasure. '
      + 'The final pixels, not a stated intention, must satisfy this clearance. '
      + 'After final downsampling, run an 8-connected alpha-component scan over '
      + 'the saved 256x256 raster. The complete hedgerow must be exactly one '
      + 'visible component: interior crown gaps are allowed, but every crown must '
      + 'remain joined to the rooted strip by opaque branch or trunk pixels. If '
      + 'the scan finds another component, join a real crown through its support '
      + 'or clear a stray leaf fragment before saving, then scan again. '
      + 'Reserve the first and last 16 pixels of travel along the declared edge '
      + 'for low soil, roots, and grass no more than 12 pixels above the segment. '
      + 'Place every trunk and crown within the middle portion of the edge, never '
      + 'at either endpoint vertex.'
    : descriptor.id.includes('canopy-edge')
      ? 'This is the canopy-edge subfamily: include a layered line of the regional '
      + 'tree species, roots, and understory above the grounded strip. The '
      + 'connected forest wall must span at least half the canvas width, rise '
      + 'through at least 40% of the canvas height, and carry dense overlapping '
      + 'crowns rather than one tiny tree clump.'
    : descriptor.id.includes('fieldstone-face')
      ? 'This is the fieldstone-face subfamily: depict a continuous one-height '
        + 'dry-stone retaining face with a clearly visible vertical plane, '
        + 'overlapping cream-gray stone courses, and a sustained top lip along '
        + 'the declared edge. The elevation discontinuity must remain legible '
        + 'after 4:1 runtime downscaling. Do not depict a shallow loose-stone '
        + 'berm, flat path border, scattered rock line, or horizontal ground strip.'
    : descriptor.id.includes('earth-face')
      ? 'This is the earth-face subfamily: depict only a low exposed soil-and-root '
        + 'profile with moss and small stones. Add no standing tree, trunk, tall '
        + 'shrub, or canopy; keep the silhouette below the anchor-to-canvas-top '
        + 'midpoint so it layers beneath separate canopy art. The connected face '
        + 'must span at least 45% of the canvas width, occupy at least 25% of its '
        + 'height, and contain a substantial blended soil profile rather than a '
        + 'single hairline fringe. Use only muted russet soil, olive moss, natural '
        + 'brown roots, and slate-gray stone; use no magenta, purple, or pink pixels.'
      : '';
  const directionalConnectionInstruction = connectionTarget
    ? `After chroma removal, keep the low end in contact with anchor `
      + `${anchor.x},${anchor.y} and extend one connected walkable subject toward `
      + `the declared ${descriptor.capabilities.direction} ${connectionVector.edge} `
      + `high endpoint at ${connectionTarget.x},${connectionTarget.y}. Make the alpha `
      + 'silhouette reach that terminal endpoint band and none of the other three '
      + 'directional endpoint bands.'
    : '';
  const routeShapeInstruction = descriptor.capabilities?.routeTopology?.startsWith(
    'corner-'
  )
    ? routeTopology === 'corner-es'
      ? ` Physically draw ${CORNER_PHYSICAL_SHAPES[routeTopology]}. Keep the `
        + `opaque warm-loam core a nearly constant ${routeArmTargetRange} `
        + 'pixels wide through '
        + `both arms and the entire rounded apex.${routeArmSpreadInstruction} `
        + 'Prefer 34–36 pixels at each of the six samples for fitting margin, '
        + 'and never taper the E arm toward its 75% or 100% terminal samples. '
        + 'Do not add an oval central wear basin, flare, bulb, plaza, '
        + 'or taper at the apex or seam tips. The center must remain smoothly '
        + 'round, never pointed. Never use two straight arms forming a V, '
        + 'chevron, acute cusp, or ruler-clean angle. The full nonzero-alpha '
        + 'silhouette must cover at most 230 permille of the canvas. Generate no '
        + 'side panel, underside, hanging tooth, or terrain slab outside the '
        + 'narrow core and feathered verge. Match the compact shallow arch '
        + 'proportions of the exact same-topology approved reference: after '
        + 'resizing to 256x128, target an overall nonzero-alpha bounding box '
        + 'about 180–200 pixels wide and 56–68 pixels tall, never a near-full-'
        + 'canvas semicircle or broad half-ring. Keep the apex top contour '
        + `organically stepped.${cornerEsApexContinuityInstruction} Across `
        + 'x=120..135, adjacent columns\' top-contour y values may step by at '
        + 'most 4 pixels, and no equal-height plateau may span '
        + 'more than 8 pixels. Do not generate a rectangular notch or a long '
        + 'ruler-flat plateau.'
      : ` Physically draw ${CORNER_PHYSICAL_SHAPES[routeTopology]}. Form one `
        + 'asymmetric 48–64 pixel wide oval central wear basin, then curve both '
        + 'arms tangentially into different sides of that basin. The center must '
        + 'remain broad and round, never a point. Never use two straight arms '
        + 'forming a V, chevron, acute cusp, or ruler-clean angle. The full '
        + 'nonzero-alpha silhouette must cover at most 230 permille of the canvas. '
        + 'Generate no side panel, underside, hanging tooth, or terrain slab '
        + 'outside the narrow core and feathered verge.'
    : ROUTE_STRAIGHT_TOPOLOGIES.has(descriptor.capabilities?.routeTopology)
      && routeSubjectBoxFinishing
      ? ' Keep large transparent regions on both sides of the straight route. '
        + 'Never expand it into an opaque diamond, platform, or plaza. Preserve '
        + `the ${
          correctiveReferenceIndexes.length > 0
            ? 'same-orientation corrective'
            : 'transform-equivalent'
        } reference ribbon as one connected, `
        + 'near-uniform-width component in the descriptor-pinned occupied span. '
        + 'The named N/S targets are internal seam-contact measurements inside '
        + 'that preserved ribbon, not new end-cap locations. '
        + (correctiveReferenceIndexes.length > 0
          ? 'Do not taper, flare, fork, pinch, or globally widen either arm; '
            + 'make only the declared local near-opaque hardening and widening. '
          : 'Do not taper, flare, fork, pinch, or widen either arm. ')
        + 'Do not add pixels outside the '
        + `${
          correctiveReferenceIndexes.length > 0
            ? 'corrective'
            : 'transformed'
        } reference contour.`
    : ROUTE_STRAIGHT_TOPOLOGIES.has(descriptor.capabilities?.routeTopology)
      ? ' Keep large transparent regions on both sides of the straight route. '
        + 'Never expand it into an opaque diamond, platform, or plaza. Keep the '
        + 'generated subject near the two named internal diamond-edge targets; '
        + 'those targets are terminal seam cross-sections, not final endpoints '
        + 'or cap centers, and never waypoints on a full-canvas '
        + `diagonal. Compose the principal centerline through `
        + `${routeDirections.map(direction => (
          `${direction}=(${routeTargets[direction].x},${routeTargets[direction].y})`
        )).join(' and ')}, using the central 50% of the 2:1 canvas width and `
        + 'height; do not render a long full-canvas strip. At each terminal seam '
        + 'cross-section, carry '
        + 'the full-width dirt core through the exact target, continue the same '
        + 'band only 4–6 pixels outward, and close it with a short nearly straight '
        + 'transverse dirt edge. Keep the low irregular verge on the two long '
        + 'sides; do not place grass, leaf, pebble, lobe, or feather decoration '
        + 'beyond either transverse end. Never taper, round, or point a seam '
        + 'cross-section or its cap, '
        + 'and never form a semicircular capsule lobe or an extended squared slab. '
        + 'Finish every dirt, grass, leaf, pebble, and antialias pixel within 8 '
        + 'pixels beyond each target along its arm vector. Leave the '
        + 'remaining distance to both rectangular corners solid magenta. After '
        + 'resizing, '
        + 'no nonzero-alpha pixel anywhere on the canvas may '
        + 'extend more than 8 pixels beyond its named seam cross-section. Never '
        + 'continue the ribbon toward a rectangular canvas corner or generate a '
        + 'squared canvas-edge crop.'
      : descriptor.capabilities?.routeTopology?.startsWith('tee-')
        ? ` Keep the three-arm junction compact and rounded inside `
          + `x=${anchor.x - 48}..${anchor.x + 48} and `
          + `y=${anchor.y - 28}..${anchor.y + 28}. Outside that central merge `
          + `box, keep the three 28–36 pixel core ribbons visibly separate and `
          + `centered on only their declared arm vectors. From the edge of the `
          + `merge box toward every forbidden target, leave the interior solid `
          + `magenta with no dirt, grass, leaf, pebble, or antialias pixel. The `
          + `rounded merge must be smaller than the combined visible runs of the `
          + `three ribbons; never replace it with an opaque half-diamond, broad `
          + `polygon, slab, plaza, or mass extending toward a forbidden side. At `
          + `every declared arm's exact 50%, 75%, and 100% perpendicular sample, `
          + `target one uninterrupted 30–34 pixel alpha-240 core run. Across all `
          + `nine tee samples, keep the widest and narrowest runs within 4 pixels `
          + `of each other. In the raw 2:1 composition at whatever raster `
          + `resolution imagegen emits, make each declared loam core a uniform `
          + `11.7–13.3% of total canvas width measured perpendicular to its arm `
          + `at 50%, 75%, and seam contact. That percentage is the `
          + `resolution-independent equivalent of 30–34 pixels after whole-image `
          + `normalization to 256x128; do not interpret 30–34 as raw `
          + `high-resolution pixels. Keep the rounded junction compact so it `
          + `never widens any arm, and do not taper any terminal. End the shared `
          + `merge before those 50% samples: do not `
          + `let a central lobe widen any half-run above 34 pixels. Carry the full `
          + `opaque core through every named terminal without tapering, so no 75% `
          + `or 100% arm run is narrower than its 50% run.`
      : descriptor.capabilities?.routeTopology?.startsWith('end-')
      ? ` Physically draw one broad irregular 48–64 pixel rounded central wear `
        + 'basin and join the single arm tangentially into it. Keep the terminal '
        + `basin inside x=${anchor.x - 32}..${anchor.x + 32} and `
        + `y=${anchor.y - 24}..${anchor.y + 24}, excluding only the declared arm. `
        + 'Keep it asymmetric and softly feathered, with no straight alpha-contour '
        + 'run longer than 12 pixels. Never preserve an isometric tile outline or '
        + 'form a pointed triangular wedge, trapezoid, straight-sided polygon, or '
        + `cut dirt ground slab. Keep the basin centroid within 8 pixels of `
        + `${anchor.x},${anchor.y}. Do not extend any terminal tail toward the `
        + `forbidden opposite ${ROUTE_DIRECTION_LABELS[
          ROUTE_OPPOSITE_DIRECTIONS[routeDirections[0]]
        ]} at ${routeTargets[ROUTE_OPPOSITE_DIRECTIONS[routeDirections[0]]].x},`
        + `${routeTargets[ROUTE_OPPOSITE_DIRECTIONS[routeDirections[0]]].y}. The `
        + 'opposite outer contour must be a 24–40 pixel broad rounded arc, never '
        + 'a single pointed pixel, spur, or teardrop.'
      : '';
  const finishingInstruction = {
    surface:
      'Preserve broad low-frequency material fields during deterministic '
      + 'finishing. Keep the outer 16-pixel diamond rim quiet and seam-safe. '
      + 'Use two or three large uninterrupted grass, moss, or soil shapes across '
      + 'most of the tile, with sparse unique leaves, flowers, pebbles, or roots '
      + 'only away from the rim. Reject uniformly distributed micro-flecks, '
      + 'all-over leaf noise, repeated confetti, and texture that competes with '
      + 'units or route overlays.',
    'blocking-obstacle':
      `After chroma removal, measure the alpha bounds and translate the subject so `
      + `its lowest visible pixel is within 16 pixels of y=${anchor.y} and visible `
      + `pixels contact the ${anchor.x},${anchor.y} anchor neighborhood. Keep an `
      + 'organic root, soil, or stone footprint with transparency between outward '
      + 'roots and tufts. Add no square or diamond ground tile, rectangular base, '
      + 'plinth, slab, platform, presentation card, or cutout panel.',
    'nonblocking-decoration':
      `After chroma removal, measure the alpha bounds and translate the subject so `
      + `its lowest visible pixel is within 16 pixels of y=${anchor.y} and visible `
      + `pixels contact the ${anchor.x},${anchor.y} anchor neighborhood.`,
    'exposed-face-boundary':
      boundarySegment
        ? `Pixel axes are authoritative: x increases right and y increases `
          + `downward. Ground the root/soil base only on the `
          + `${boundaryPhysicalLabels[descriptor.capabilities.direction]}: the `
          + `declared ${descriptor.capabilities.direction} edge from `
          + `${boundarySegment[0].x},${boundarySegment[0].y} to `
          + `${boundarySegment[1].x},${boundarySegment[1].y}. After chroma removal, `
          + `keep a continuous grounded strip along the first, middle, and last `
          + 'thirds of that segment. The grounded subject must remain within 6 '
          + 'pixels of the declared segment in every third and extend to within '
          + '10 pixels of both exact endpoints. A half-length subject, any open '
          + 'seam third, or a parallel inset diagonal is invalid. '
          + `${boundarySubjectInstruction} The `
          + `${anchor.x},${anchor.y} pivot is placement metadata and need not be `
          + 'covered; do not bend the grounded strip away from its declared edge '
          + 'to reach it. No grounded base may follow any of the other three edges; '
          + 'never mirror or rotate the declared diagonal. This asset must remain '
          + 'a narrow boundary strip, never a complete diamond ground tile, '
          + 'platform, or whole terrain block. During deterministic finishing, '
          + 'clear alpha from a 12-pixel band along the interior of every '
          + `forbidden edge segment: ${forbiddenBoundarySegments}. The bottommost `
          + 'connected alpha envelope in each column may contact only the declared '
          + 'edge. '
          + 'Trunks, branches, and crown foliage may overhang other edge bands; '
          + 'do not crop or flatten tall canopy merely to keep its overhead alpha '
          + 'inside the grounded edge. Keep one unbroken natural silhouette with '
          + 'no vertical slice seam, rectangular panel, crop bar, repeated strip, '
          + 'or abrupt internal cut line.'
        : `After chroma removal, keep the low legacy face horizontally broad, `
          + `below the upper draw band, and connected to the ${anchor.x},`
          + `${anchor.y} anchor neighborhood.`,
    'connection-stairs':
      `${directionalConnectionInstruction} Keep a 36–48 pixel wide loam-and-grass `
      + 'stair bed between the endpoints, with four to six broad cream-gray '
      + 'fieldstone tread caps running crosswise, perpendicular to the direction '
      + 'of travel. Give every tread a visible 6–10 pixel deep top plane above a '
      + 'shallow riser. '
      + 'Use only a short low-end soil feather behind the anchor. Never turn the '
      + 'stair into a thin lengthwise braid, root track, log, eroded stripe, row '
      + 'of upright ribs, fence, palisade, retaining wall, or dark-sided ledge.',
    'connection-slope':
      `${directionalConnectionInstruction} Keep the walkable center of the grade `
      + 'unobstructed from endpoint to endpoint. Vegetation must remain a low, '
      + 'sparse fringe: add no shrub or tree clump on the grade. Use no sustained '
      + 'dark lower side, vertical side plane, rock-lined causeway, retaining '
      + 'wall, or raised platform silhouette.',
    'route-transition':
      `${routeEndpointInstruction}${routeGeometryPrimeInstruction} `
      + `${routeArmCompositionInstruction} Never `
      + 'generate a hairline, narrow '
      + 'ruler-straight streak, or threadlike track. '
      + 'Keep one connected path silhouette with no detached alpha component; each '
      + 'leaf, '
      + 'grass tuft, pebble, and loam pixel must touch the main path silhouette. '
      + `The connected silhouette must reach the `
      + `declared diamond edge bands and contacts the ${anchor.x},${anchor.y} `
      + `anchor neighborhood.${routeShapeInstruction} ${routeBandInstruction} `
      + `${routeForbiddenSegmentInstruction}`
  }[descriptor.category] ?? '';
  const sourcePreparationInstruction = routeGeneration
    ? routeSubjectBoxFinishing
      ? `The worker must not inspect or modify candidate.png after the one source `
        + `copy. The parent lifecycle accepts only an exact declared 2:1 source `
        + `aspect, then isolates the largest connected generated subject and `
        + `performs exactly one descriptor-pinned crop/resize/place operation `
        + `before normalization and contract checks. It does not enumerate, `
        + `score, or retry placements.`
      : routeAnchorScaleFinishing
        ? `The worker must not inspect or modify candidate.png after the one `
          + `source copy. The parent lifecycle accepts only the exact declared `
          + `2:1 source aspect, normalizes the whole image, and performs one `
          + `descriptor-pinned uniform scale about the declared anchor before `
          + `contract checks. It does not enumerate, score, or retry scales.`
      : `The worker must not inspect or modify candidate.png after the one source `
        + `copy. When the source has the exact declared 2:1 aspect ratio, the parent lifecycle `
        + `deterministically resizes the entire copied raster to the exact declared `
        + `width and height with one whole-image resampling operation when needed, `
        + `before normalization and contract checks. Do not crop or reshape a `
        + `different-aspect source to force it into the route canvas.`
    : `Immediately after the one source copy, inspect only its dimensions; if `
      + `they differ from the descriptor, resize the entire copied raster to the `
      + `exact declared width and height with one whole-image resampling operation `
      + `before any contract checks. Never leave the raw model dimensions for the `
      + `parent to repair.`;
  const contractWorkflowInstruction = routeGeneration
    ? routeSubjectBoxFinishing
      ? `The descriptor rasterContract and routeFinishing contract are hard `
        + `acceptance requirements. The worker must preserve the one generated `
        + `route artifact without editing it. The parent lifecycle performs one `
        + `closed-form largest-component crop, resize, and placement into the `
        + `descriptor-pinned box, followed by chroma normalization, the exact `
        + `descriptor-pinned terminal-plane trim, and route `
        + `validation. It never searches alternatives and cannot repair topology, `
        + `reshape an arm, invent, repaint, or synthesize content.`
      : routeAnchorScaleFinishing
        ? `The descriptor rasterContract and routeFinishing contract are hard `
          + `acceptance requirements. The worker must preserve the one generated `
          + `route artifact without editing it. The parent lifecycle performs `
          + `only the descriptor-pinned uniform whole-subject scale about the `
          + `declared anchor, a four-pixel border clear, bounded removal at `
          + `forbidden capability-edge bands, chroma normalization, and route `
          + `validation. It never searches alternatives, changes `
          + `individual arms, invents, repaints, or synthesizes content.`
      : `The descriptor rasterContract is a hard acceptance requirement. The worker `
        + `must preserve the one generated route artifact without editing it. The parent `
        + `lifecycle performs only exact-aspect whole-image resizing, chroma removal, `
        + `normalization, generic raster validation, and topology-appropriate `
        + `deterministic route geometry validation; it does not repair topology or `
        + `invent, repaint, crop, translate, or synthesize content.`
    : `The descriptor rasterContract is a hard acceptance requirement. Use deterministic local
chroma removal, crop/scale, alpha masking, and canvas placement after the single imagegen
call as needed to satisfy it exactly; do not invent or repaint content during finishing.`;
  const outputWorkflowInstruction = routeGeneration
    ? `Use the imagegen skill and call the imagegen tool exactly once for this family. `
      + `Execute exactly two successful shell commands in this order around that `
      + `call. First, before imagegen, read the mandatory skill instructions with `
      + `exactly:\n0. ${CANONICAL_ROUTE_SKILL_READ_COMMAND}\n`
      + `After imagegen completes, run a standalone /bin/cp from the current JSONL `
      + `thread's absolute generated_images artifact path directly to candidate.png. `
      + `Copy exactly one artifact exactly once. Execute no other command before, `
      + `between, or after those two commands. Do not create candidate.webp, `
      + `inspect, edit, crop, translate, mask, resample, normalize, or otherwise `
      + `postprocess candidate.png. ${sourcePreparationInstruction} Do not use a `
      + `direct file-change tool on it. `
      + `Create no directory and no other file. Do not approve, pin, compile, `
      + `publish, or alter descriptor/style inputs. The one candidate must depict `
      + `only family "${descriptor.id}" for theme "${descriptor.theme}" and category `
      + `"${descriptor.category}". Report the copied result and end immediately.`
    : `Use the imagegen skill and call the imagegen tool exactly once for this family. Write exactly
one candidate.png or candidate.webp in the
workspace root. Copy the generated raster into that filename with a standalone command
that exits successfully; do not chain file, identify, or any other inspection utility into
the artifact-copy command. Run that artifact-copy command exactly once. If deterministic
finishing needs correction, keep mutating the existing candidate file or stop with failure;
never copy the generated source artifact into the candidate a second time. That first and
only copy is explicitly an unprocessed source, not an accepted candidate. The lifecycle
authorizes deterministic in-place overwrites of that same
candidate filename for chroma removal, scaling, alpha masking, canvas placement, and numeric
contract enforcement until the final saved raster passes every required check.
${sourcePreparationInstruction}
Finishing may
only resize, crop, or translate the complete generated subject; clear alpha outside an allowed
mask; remove chroma by clearing alpha; or despill an existing subject-edge pixel. Never create
a new RGBA canvas, synthesize a route centerline or replacement silhouette, fill a previously
transparent pixel, copy or sample donor RGB into another pixel, procedurally draw geometry,
or repaint generated content. The parent lifecycle performs canonical normalization after the
worker exits. If the raw generated subject cannot meet the contract with only those permitted
operations, preserve the one source copy and exit with failure. Create no
directory and no other file. Do not approve, pin, compile, publish, or alter descriptor/style
inputs. The one candidate must depict only family
"${descriptor.id}" for theme "${descriptor.theme}" and category "${descriptor.category}".
After the file is saved and deterministic metadata/raster checks pass, report the result and
end immediately. Do not reopen, visually inspect, revise, reprocess, or continue analyzing
the accepted candidate.`;
  return `${profile.prompt}

Frozen descriptor:
${stableJson(descriptor).trim()}

Frozen family art direction:
${descriptor.generationPrompt}

${contractWorkflowInstruction}
${rasterInstruction}
${finishingInstruction}

Negative constraints:
${profile.negativeConstraints.map(value => `- ${value}`).join('\n')}

The descriptor and hash-verified style references are staged read-only by contract in this
disposable workspace:
- descriptor.json
- prompt-profile.json
${styleFiles.map(file => `- ${file}`).join('\n')}

${styleInstruction}

${outputWorkflowInstruction}`.trim();
}

export function countImagegenInvocations(stdout) {
  return auditCodexWorkerJsonl(stdout).imagegenInvocationCount;
}

const GENERATED_ROUTE_ARTIFACT_PATTERN =
  /[/\\]generated_images[/\\]([A-Za-z0-9_-]+)[/\\](?:call_[A-Za-z0-9_-]+\.(?:png|webp|jpe?g)|exec-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.png)$/i;
export const CANONICAL_ROUTE_SKILL_READ_COMMAND =
  `/bin/cat ${JSON.stringify(IMAGEGEN_SKILL_PATH)}`;

function unwrapCanonicalRouteShellCommand(command) {
  const payload = command.trim();
  const shellPrefix = /^(?:\/bin\/)?(?:ba)?sh(?:[\t ]|$)/;
  if (!shellPrefix.test(payload)) return payload;
  const wrapper = payload.match(
    /^(?:\/bin\/)?(?:ba)?sh[\t ]+-(?:l)?c[\t ]+(['"])([\s\S]*)\1$/
  );
  if (!wrapper) return null;
  const quote = wrapper[1];
  const inner = wrapper[2];
  if (
    inner.includes(quote)
    || (quote === '"' && /[$`\\]/.test(inner))
  ) {
    return null;
  }
  return inner.trim();
}

function parseCanonicalRouteArtifactCopy(command) {
  const payload = unwrapCanonicalRouteShellCommand(command);
  if (payload === null) return null;
  const artifact = parseGeneratedArtifactCopyCommand(payload, {
    requireAbsoluteCp: true,
    candidateNames: ['candidate.png']
  });
  if (artifact === null) return null;
  const artifactPath = artifact.path;
  if (
    !path.isAbsolute(artifactPath)
    || path.normalize(artifactPath) !== artifactPath
  ) {
    return null;
  }
  const routeArtifact = artifactPath.match(GENERATED_ROUTE_ARTIFACT_PATTERN);
  if (!routeArtifact) return null;
  return { artifactPath, threadId: routeArtifact[1] };
}

export function assertSingleGeneratedArtifactCopyEvidence(stdout) {
  const commands = new Map();
  const threadIds = [];
  const observableImagegenLines = [];
  const completedImagegenLines = [];
  for (const [index, line] of Buffer.from(stdout ?? '')
    .toString('utf8')
    .split(/\r?\n/)
    .entries()) {
    if (line.length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(
        `route worker JSONL line ${index + 1} is not valid JSON`
      );
    }
    if (event?.type === 'thread.started') {
      threadIds.push(event.thread_id);
    }
    const item = event?.item
      && typeof event.item === 'object'
      && !Array.isArray(event.item)
      ? event.item
      : event;
    const recordType = String(item?.type ?? '').toLowerCase();
    const toolLike =
      recordType.includes('tool') || recordType.includes('function');
    const imagegen = toolLike
      && String(item?.server ?? '').toLowerCase() === 'image_gen'
      && String(
        item?.tool
          ?? item?.tool_name
          ?? item?.function?.name
          ?? item?.name
          ?? ''
      ).toLowerCase() === 'imagegen';
    if (imagegen) observableImagegenLines.push(index);
    if (
      ['file_change', 'file_write', 'apply_patch'].some(
        type => recordType.includes(type)
      )
    ) {
      throw new Error(
        'route worker must not write candidate.png through a direct '
        + 'file-change operation'
      );
    }
    if (toolLike && !imagegen) {
      throw new Error('route worker must not invoke a non-imagegen tool');
    }
    if (
      imagegen
      && event?.type === 'item.completed'
      && ['', 'completed', 'success', 'succeeded'].includes(
        String(item?.status ?? event?.status ?? '').toLowerCase()
      )
    ) {
      completedImagegenLines.push(index);
    }
    if (item?.type !== 'command_execution') continue;
    if (typeof item.command !== 'string') {
      throw new Error('route worker command execution must include a command');
    }
    const id = String(item.call_id ?? item.id ?? `line:${index + 1}`);
    const existing = commands.get(id);
    if (existing && existing.command !== item.command) {
      throw new Error(
        `route worker command invocation ${id} changed command text`
      );
    }
    const invocation = existing ?? {
      command: item.command,
      firstLine: index,
      completed: false
    };
    const eventType = String(event.type ?? '').toLowerCase();
    const status = String(item.status ?? event.status ?? '').toLowerCase();
    if (eventType === 'item.completed') {
      if (
        !['', 'completed', 'success', 'succeeded'].includes(status)
        || item.exit_code !== 0
      ) {
        throw new Error(`route worker command invocation ${id} did not succeed`);
      }
      invocation.completed = true;
    } else if (
      eventType !== 'item.started'
      || !['', 'in_progress', 'started', 'running', 'pending'].includes(status)
    ) {
      throw new Error(`route worker command invocation ${id} did not succeed`);
    }
    commands.set(id, invocation);
  }
  const invocations = [...commands.values()]
    .sort((left, right) => left.firstLine - right.firstLine);
  if (invocations.some(command => !command.completed)) {
    throw new Error('route worker command invocation did not complete');
  }
  const copies = invocations
    .map(command => ({
      invocation: command,
      artifact: parseCanonicalRouteArtifactCopy(command.command)
    }))
    .filter(command => command.artifact !== null);
  const skillReads = invocations.filter(
    command => (
      unwrapCanonicalRouteShellCommand(command.command)
        === CANONICAL_ROUTE_SKILL_READ_COMMAND
    )
  );
  if (
    copies.length !== 1
    || skillReads.length !== 1
    || invocations.length !== 2
  ) {
    throw new Error(
      'route worker must execute exactly two commands: read the imagegen skill '
      + 'once, then copy exactly one current-thread generated artifact to '
      + `candidate.png; observed ${skillReads.length} skill reads, `
      + `${copies.length} artifact copies, and ${invocations.length} commands`
    );
  }
  const [copy] = copies;
  const [skillRead] = skillReads;
  if (
    invocations[0] !== skillRead
    || invocations[1] !== copy.invocation
  ) {
    throw new Error(
      'route worker must read the imagegen skill before copying the generated '
      + 'artifact and must execute no other command'
    );
  }
  if (
    observableImagegenLines.length > 0
    && completedImagegenLines.length === 0
  ) {
    throw new Error(
      'route worker observable imagegen invocation did not complete successfully'
    );
  }
  if (
    observableImagegenLines.length > 0
    && (
      skillRead.firstLine >= Math.min(...observableImagegenLines)
      || copy.invocation.firstLine <= Math.max(...completedImagegenLines)
    )
  ) {
    throw new Error(
      'route worker must read the skill before observable imagegen execution '
      + 'and copy the generated artifact only after imagegen completion'
    );
  }
  if (
    threadIds.length !== 1
    || threadIds[0] !== copy.artifact.threadId
  ) {
    throw new Error(
      'route worker artifact copy must belong to its sole JSONL thread'
    );
  }
  return {
    artifactPath: copy.artifact.artifactPath,
    threadId: copy.artifact.threadId,
    skillReadCommand: CANONICAL_ROUTE_SKILL_READ_COMMAND
  };
}

const PROHIBITED_PROCEDURAL_RASTER_COMMANDS = Object.freeze([
  Object.freeze({
    pattern: /\bImage\.new\s*\([^)]{0,96}\bRGBA\b/i,
    label: 'new RGBA canvas'
  }),
  Object.freeze({
    pattern: /\b(?:def\s+donor\b|donor\s*\()/i,
    label: 'donor-pixel synthesis'
  }),
  Object.freeze({
    pattern:
      /\bImageDraw\b|\bdraw\.(?:polygon|line|ellipse|rectangle)\s*\(/i,
    label: 'procedural drawing'
  }),
  Object.freeze({
    pattern: /\bputpixel\s*\(/i,
    label: 'procedural pixel painting'
  })
]);

export function assertNoProceduralRasterSynthesis(stdout) {
  const commands = new Set();
  for (const [index, line] of Buffer.from(stdout)
    .toString('utf8')
    .split(/\r?\n/)
    .entries()) {
    if (line.trim().length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `worker JSONL line ${index + 1} is invalid while auditing raster finishing: `
        + error.message
      );
    }
    const item = event?.item;
    if (
      item?.type === 'command_execution'
      && typeof item.command === 'string'
    ) {
      commands.add(item.command);
    }
  }
  for (const command of commands) {
    const prohibited = PROHIBITED_PROCEDURAL_RASTER_COMMANDS.find(
      rule => rule.pattern.test(command)
    );
    if (prohibited) {
      throw new Error(
        `worker finishing evidence contains prohibited `
        + `${prohibited.label}; generated pixels may only be globally placed, `
        + 'resized, chroma-cleaned, or cleared'
      );
    }
  }
  return { commandCount: commands.size };
}

async function workspaceSnapshot(directory) {
  const result = new Map();
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`workspace contains symlink ${entry.name}`);
    if (!entry.isFile()) throw new Error(`workspace contains non-file ${entry.name}`);
    result.set(entry.name, {
      bytes: stat.size,
      sha256: ['candidate.png', 'candidate.webp'].includes(entry.name)
        ? null
        : await hashFile(absolute)
    });
  }
  return result;
}

function auditWorkspace(before, after, inputFiles) {
  let totalBytes = 0;
  for (const [name, record] of after) {
    totalBytes += record.bytes;
    const original = before.get(name);
    if (original) {
      if (original.bytes !== record.bytes || original.sha256 !== record.sha256) {
        throw new Error(`worker modified frozen input ${name}`);
      }
    } else if (!['candidate.png', 'candidate.webp', 'last-message.txt'].includes(name)) {
      throw new Error(`worker created undeclared output ${name}`);
    }
  }
  for (const input of inputFiles) {
    if (!after.has(input)) throw new Error(`worker removed frozen input ${input}`);
  }
  if (totalBytes > MAX_WORKSPACE_BYTES) throw new Error('worker workspace exceeded byte limit');
  const candidates = ['candidate.png', 'candidate.webp'].filter(name => after.has(name));
  if (candidates.length !== 1) {
    throw new Error(`worker must create exactly one candidate image; found ${candidates.length}`);
  }
  return candidates[0];
}

async function readAuditedWorkerFile(workspace, after, name) {
  const record = after.get(name);
  if (!record) return null;
  if (record.bytes > MAX_WORKER_OUTPUT_BYTES) {
    throw new Error(`${name} exceeds worker log limit`);
  }
  const contents = await readFile(path.join(workspace, name));
  if (
    contents.length !== record.bytes
    || sha256(contents) !== record.sha256
  ) {
    throw new Error(`${name} changed after workspace audit`);
  }
  return contents;
}

async function loadCandidate(root, descriptor, descriptorPath, paths, profile) {
  let candidate;
  try {
    ({ value: candidate } = await readJson(root, paths.metadata, 'candidate metadata'));
  } catch (error) {
    if (error.message.includes('ENOENT')) return null;
    throw error;
  }
  const legacy = candidate?.schemaVersion === 'battle-art-candidate-v1';
  const revalidated =
    candidate?.schemaVersion === REVALIDATED_CANDIDATE_SCHEMA;
  exactKeys(candidate, [
    'schemaVersion',
    'familyId',
    'theme',
    'descriptorPath',
    'descriptorSha256',
    'promptProfile',
    'styleReferences',
    ...(!legacy && !revalidated
      ? ['styleReferenceMode', 'styleReferenceProvenance']
      : []),
    ...(!legacy && candidate.derivation !== undefined
      ? ['derivation']
      : []),
    ...(revalidated ? ['origin'] : []),
    'image',
    ...(!revalidated ? ['worker'] : []),
    'status'
  ], 'candidate metadata');
  if ((!legacy
      && candidate.schemaVersion !== CANDIDATE_SCHEMA
      && !revalidated)
    || candidate.familyId !== descriptor.id
    || candidate.theme !== descriptor.theme
    || candidate.descriptorPath !== descriptorPath
    || candidate.descriptorSha256 !== sha256(Buffer.from(stableJson(descriptor)))
    || stableJson(candidate.promptProfile) !== stableJson(descriptor.promptProfile)
    || stableJson(candidate.styleReferences) !== stableJson(descriptor.styleReferences)
    || candidate.status !== 'candidate-awaiting-review') {
    throw new Error(`${descriptor.id} candidate frozen pins are stale`);
  }
  if (legacy) {
    assertAllowlistedLegacyCandidate(
      paths.metadata,
      candidate,
      `${descriptor.id} candidate`
    );
  }
  if (!legacy && !revalidated) {
    const expectedProvenance = styleReferenceProvenance(
      descriptor.styleReferences
    );
    const imagePaths = candidate.worker?.args?.flatMap((argument, index, args) => (
      argument === '--image' && typeof args[index + 1] === 'string'
        ? [args[index + 1]]
        : []
    )) ?? [];
    const expectedBasenames = candidate.styleReferenceMode === 'attachments'
      ? expectedProvenance.map(value => value.stagedBasename)
      : candidate.styleReferenceMode === 'text-fallback'
        ? []
        : null;
    if (stableJson(candidate.styleReferenceProvenance)
        !== stableJson(expectedProvenance)
      || expectedBasenames === null
      || stableJson(imagePaths.map(value => path.basename(value)))
        !== stableJson(expectedBasenames)
      || new Set(imagePaths).size !== imagePaths.length) {
      throw new Error(`${descriptor.id} candidate style attachment provenance is stale`);
    }
  }
  if (revalidated) {
    await auditRevalidatedCandidateOrigin({
      root,
      descriptor,
      candidate
    });
  }
  const candidateBytes = await readPinnedRegularFile(
    root,
    candidate.image.path,
    candidate.image.sha256,
    `${descriptor.id} existing candidate`
  );
  const image = await inspectImageContents(candidate.image.path, candidateBytes);
  if (stableJson(image) !== stableJson(candidate.image)) throw new Error(`${descriptor.id} candidate image pin mismatch`);
  if (!legacy) {
    await verifyCandidateRouteDerivation({
      root,
      descriptor,
      candidate,
      candidateBytes,
      profile,
      paths
    });
  }
  return candidate;
}

async function cleanCandidateFiles(root, paths) {
  for (const relative of [
    paths.imagePng,
    paths.imageWebp,
    paths.metadata,
    paths.prompt,
    paths.stdout,
    paths.stderr,
    paths.lastMessage
  ]) {
    await rm(resolveTracked(root, relative), { force: true, recursive: false });
  }
}

async function cleanCandidatePublication(root, paths) {
  for (const relative of [
    paths.imagePng,
    paths.imageWebp,
    paths.metadata
  ]) {
    await rm(resolveTracked(root, relative), { force: true, recursive: false });
  }
}

async function inspectCandidateDisposition({
  loaded,
  entry,
  paths,
  options
}) {
  if (entry.descriptor.status !== 'draft') {
    throw new Error(
      `${entry.descriptor.id} is ${entry.descriptor.status}; `
      + 'archive and publish a new descriptor revision before regeneration'
    );
  }
  let existing;
  try {
    existing = await loadCandidate(
      loaded.root,
      entry.descriptor,
      entry.path,
      paths,
      loaded.promptProfile
    );
  } catch (error) {
    if (!options.force) throw error;
    existing = null;
  }
  if (existing && options.resume) {
    return {
      result: {
        family: entry.descriptor.id,
        status: 'skipped-complete',
        image: existing.image
      },
      shouldGenerate: false
    };
  }
  if (existing && !options.force) {
    throw new Error(
      `${entry.descriptor.id} candidate exists; use --resume or --force`
    );
  }
  return { result: null, shouldGenerate: true };
}

export async function auditCorrectiveStyleReferenceForGeneration({
  root = SCRIPT_ROOT,
  descriptor,
  pin
}) {
  const entry = correctiveStyleReferenceForConsumer(pin, {
    theme: descriptor.theme,
    familyId: descriptor.id
  }, `${descriptor.id} style reference ${pin.id}`);
  if (entry === null) return null;
  const index = descriptor.styleReferences.findIndex(reference => (
    reference.id === pin.id
    && reference.path === pin.path
    && reference.sha256 === pin.sha256
  ));
  if (
    index < 0
    || index !== descriptor.styleReferences.length - 1
    || descriptor.styleReferences.filter(reference => (
      reference.id === pin.id
      && reference.path === pin.path
      && reference.sha256 === pin.sha256
    )).length !== 1
  ) {
    throw new Error(
      `${descriptor.id} corrective style reference must be unique and last`
    );
  }
  const audit = await auditFailedRouteAttempt({
    root,
    relativePath: entry.failureRecord.path
  });
  if (
    audit.record.fullHash !== entry.failureRecord.fullHash
    || audit.record.theme !== entry.consumer.theme
    || audit.record.familyId !== entry.consumer.familyId
    || audit.record.raw.path !== entry.raw.path
    || audit.record.raw.sha256 !== entry.raw.sha256
  ) {
    throw new Error(
      `${descriptor.id} corrective style reference failed-attempt audit `
      + 'does not match its registry tuple'
    );
  }
  return { entry, audit };
}

async function stageInputs(root, workspace, descriptor, profile) {
  const inputs = ['descriptor.json', 'prompt-profile.json'];
  await atomicWrite(workspace, 'descriptor.json', stableJson(descriptor));
  await atomicWrite(workspace, 'prompt-profile.json', stableJson(profile));
  const styleFiles = [];
  for (let index = 0; index < descriptor.styleReferences.length; index += 1) {
    const pin = descriptor.styleReferences[index];
    await auditCorrectiveStyleReferenceForGeneration({
      root,
      descriptor,
      pin
    });
    const extension = path.extname(pin.path).toLowerCase();
    const name = `style-reference-${String(index + 1).padStart(2, '0')}${extension}`;
    const bytes = await readPinnedRegularFile(
      root,
      pin.path,
      pin.sha256,
      `${pin.id} style reference`
    );
    await atomicWrite(workspace, name, bytes);
    inputs.push(name);
    styleFiles.push(name);
  }
  return {
    inputs,
    styleFiles,
    styleReferenceProvenance: styleReferenceProvenance(
      descriptor.styleReferences
    )
  };
}

async function prepareVerifiedGeneratedCandidate({
  generatedBytes,
  descriptor,
  profile,
  generatedArtifact = null
}) {
  if (!Buffer.isBuffer(generatedBytes)) {
    throw new Error(`${descriptor.id} verified candidate bytes are unavailable`);
  }
  if (generatedBytes.length > MAX_CANDIDATE_BYTES) {
    throw new Error(`${descriptor.id} candidate exceeds byte limit`);
  }
  const { default: sharp } = await import('sharp');
  const imageMetadata = await sharp(
    generatedBytes,
    { failOn: 'error' }
  ).metadata();
  if (!['png', 'webp'].includes(imageMetadata.format)
    || !Number.isSafeInteger(imageMetadata.width)
    || !Number.isSafeInteger(imageMetadata.height)
    || imageMetadata.width > MAX_IMAGE_DIMENSION
    || imageMetadata.height > MAX_IMAGE_DIMENSION) {
    throw new Error(`${descriptor.id} candidate image contract is invalid`);
  }
  const routeGeneration = descriptor.category === 'route-transition';
  const routeFinishing = routeGeneration && descriptor.routeFinishing;
  const normalizedFormat = routeGeneration ? 'png' : imageMetadata.format;
  const directSource = routeGeneration && !routeFinishing
    ? generatedArtifact ?? {
        ...await inspectImageContents(
          'generated route artifact',
          generatedBytes
        ),
        path: generatedArtifactPath(descriptor, {
          sha256: sha256(generatedBytes),
          format: imageMetadata.format
        })
      }
    : null;
  const direct = directSource
    ? await prepareDirectRouteCandidate({
        sourceBytes: generatedBytes,
        source: directSource,
        descriptor,
        profile,
        label: `${descriptor.id} generated candidate`
      })
    : null;
  const finished = routeFinishing
    ? await finishRouteArtifact({
        bytes: generatedBytes,
        descriptor,
        profile
      })
    : null;
  const candidateBytes = finished?.bytes
    ?? direct?.bytes
    ?? await normalizeGeneratedRasterBytes({
      bytes: generatedBytes,
      descriptor,
      profile,
      format: normalizedFormat,
      label: `${descriptor.id} generated candidate`
    });
  if (candidateBytes.length > MAX_CANDIDATE_BYTES) {
    throw new Error(`${descriptor.id} normalized candidate exceeds byte limit`);
  }
  await validateRasterBytes({
    bytes: candidateBytes,
    descriptor,
    profile,
    label: `${descriptor.id} generated candidate`
  });
  if (routeGeneration) {
    await validatePreparedRouteGeometry({
      bytes: candidateBytes,
      descriptor,
      finished: routeFinishing !== undefined
    });
  }
  return {
    candidateBytes,
    normalizedFormat,
    derivation: finished?.derivation ?? direct?.derivation ?? null
  };
}

export async function validatePreparedRouteGeometry({
  bytes,
  descriptor,
  finished = descriptor?.routeFinishing !== undefined,
  label = `${descriptor?.id ?? 'route artifact'} generated candidate`
} = {}) {
  if (descriptor?.category !== 'route-transition') {
    throw new Error(`${label} is not a route-transition artifact`);
  }
  if (!finished) {
    await assertRouteTransitionCanvasBorderClear({
      bytes,
      descriptor
    });
  }
  if (finished) {
    await validateFinishedRouteArtifact({
      bytes,
      descriptor,
      label
    });
  }
  await assertRouteArmMinimumCoreWidth({ bytes, descriptor });
  await assertRouteCornerMinimumCoreWidth({ bytes, descriptor });
  await assertCornerEsAnchorArchPlacement({ bytes, descriptor });
  await assertRouteCornerMaximumCoverage({ bytes, descriptor });
  await assertRouteStraightMaximumCoverage({ bytes, descriptor });
  await assertRouteStraightMaximumLongitudinalExtent({ bytes, descriptor });
}

async function publishVerifiedGeneratedCandidateUnchecked({
  loaded,
  entry,
  profile,
  paths,
  generatedBytes,
  styleReferenceMode,
  styleReferenceProvenance: provenance,
  workerArgs,
  invocationCount,
  timeoutMs,
  hasLastMessage,
  recovered = false
}) {
  const descriptor = entry.descriptor;
  let generatedArtifact = null;
  if (descriptor.category === 'route-transition') {
    const generatedArtifactIdentity = await inspectImageContents(
      'generated route artifact',
      generatedBytes
    );
    const generatedArtifactRelative = generatedArtifactPath(
      descriptor,
      generatedArtifactIdentity
    );
    generatedArtifact = {
      ...generatedArtifactIdentity,
      path: generatedArtifactRelative
    };
    try {
      await atomicWrite(
        loaded.root,
        generatedArtifactRelative,
        generatedBytes,
        { immutable: true }
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existingBytes = await readPinnedRegularFile(
        loaded.root,
        generatedArtifactRelative,
        generatedArtifact.sha256,
        `${descriptor.id} immutable generated artifact`
      );
      if (!existingBytes.equals(generatedBytes)) {
        throw new Error(
          `${descriptor.id} immutable generated artifact content mismatch`
        );
      }
    }
  }
  const {
    candidateBytes,
    normalizedFormat,
    derivation
  } = await prepareVerifiedGeneratedCandidate({
    generatedBytes,
    descriptor,
    profile,
    generatedArtifact
  });
  const imageRelative = normalizedFormat === 'png'
    ? paths.imagePng
    : paths.imageWebp;
  await atomicWrite(loaded.root, imageRelative, candidateBytes);
  const image = await inspectImageContents(imageRelative, candidateBytes);
  if (derivation) {
    const {
      path: _generatedArtifactPath,
      ...generatedArtifactIdentity
    } = generatedArtifact;
    if (
      ['bytes', 'width', 'height', 'format', 'sha256'].some(
        key => derivation.source[key] !== generatedArtifactIdentity[key]
      )
      || derivation.finalSha256 !== image.sha256
    ) {
      throw new Error(
        `${descriptor.id} route derivation does not match its raw and final bytes`
      );
    }
  }
  const candidate = {
    schemaVersion: CANDIDATE_SCHEMA,
    familyId: descriptor.id,
    theme: descriptor.theme,
    descriptorPath: entry.path,
    descriptorSha256: sha256(Buffer.from(stableJson(descriptor))),
    promptProfile: structuredClone(descriptor.promptProfile),
    styleReferences: structuredClone(descriptor.styleReferences),
    styleReferenceMode,
    styleReferenceProvenance: structuredClone(provenance),
    ...(derivation
      ? {
          derivation: {
            ...structuredClone(derivation),
            source: generatedArtifact
          }
        }
      : {}),
    image,
    worker: {
      command: 'codex',
      args: workerArgs,
      ephemeral: true,
      invocationCount,
      timeoutMs,
      promptPath: paths.prompt,
      stdoutPath: paths.stdout,
      stderrPath: paths.stderr,
      lastMessagePath: hasLastMessage ? paths.lastMessage : null
    },
    status: 'candidate-awaiting-review'
  };
  await atomicWrite(loaded.root, paths.metadata, stableJson(candidate));
  return {
    family: descriptor.id,
    status: 'generated',
    ...(recovered ? { recovered: true } : {}),
    image
  };
}

async function publishVerifiedGeneratedCandidate(options) {
  try {
    return await publishVerifiedGeneratedCandidateUnchecked(options);
  } catch (error) {
    const { descriptor } = options.entry;
    if (descriptor.category !== 'route-transition') throw error;
    let raw;
    try {
      const rawIdentity = await inspectImageContents(
        'failed generated route artifact',
        options.generatedBytes
      );
      raw = {
        ...rawIdentity,
        path: generatedArtifactPath(descriptor, rawIdentity)
      };
      await readPinnedRegularFile(
        options.loaded.root,
        raw.path,
        raw.sha256,
        `${descriptor.id} failed generated route artifact`
      );
    } catch {
      // Failures before the verified raw becomes durable are outside the
      // failed-attempt evidence boundary.
      throw error;
    }
    const evidence = await archiveFailedRouteAttempt({
      root: options.loaded.root,
      descriptor,
      descriptorPath: options.entry.path,
      raw,
      paths: options.paths,
      workerArgs: options.workerArgs,
      invocationCount: options.invocationCount,
      timeoutMs: options.timeoutMs,
      styleReferenceMode: options.styleReferenceMode,
      styleReferenceProvenance: options.styleReferenceProvenance,
      hasLastMessage: options.hasLastMessage,
      rejection: error
    });
    if (error !== null
      && (typeof error === 'object' || typeof error === 'function')) {
      error.failedAttemptEvidencePath = evidence.path;
    }
    throw error;
  }
}

async function assertRecoveryPublicationAbsent(
  root,
  descriptor,
  paths,
  operation = 'recovery'
) {
  for (const relative of [
    paths.imagePng,
    paths.imageWebp,
    paths.metadata
  ]) {
    try {
      await lstat(resolveTracked(
        root,
        relative,
        `${descriptor.id} ${operation} publication`
      ));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(
      `${descriptor.id} ${operation} requires no existing candidate publication`
    );
  }
}

function exactUtf8(contents, label) {
  const text = contents.toString('utf8');
  if (!Buffer.from(text).equals(contents)) {
    throw new Error(`${label} must be canonical UTF-8`);
  }
  return text;
}

function assertFailedAttemptHash(value, label) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a sha256 pin`);
  }
}

function assertFailedAttemptInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
}

function failedAttemptProjection(record) {
  const { fullHash: _fullHash, ...projection } = record;
  return projection;
}

export function failedRouteAttemptPath(descriptor, fullHash) {
  assertFailedAttemptHash(fullHash, 'failed route attempt fullHash');
  const validatedArtifactPath = generatedArtifactPath(descriptor, {
    sha256: fullHash,
    format: 'png'
  });
  return `${path.posix.dirname(validatedArtifactPath)}/failures/`
    + `${fullHash.slice('sha256:'.length)}.json`;
}

export function parseFrozenDescriptorFromGenerationPrompt(promptText) {
  if (typeof promptText !== 'string') {
    throw new Error('generation prompt must be text');
  }
  const prefix = '\nFrozen descriptor:\n';
  const suffix = '\n\nFrozen family art direction:\n';
  const start = promptText.indexOf(prefix);
  const end = promptText.indexOf(suffix, start + prefix.length);
  if (start === -1 || end === -1) {
    throw new Error('generation prompt has no bounded frozen descriptor snapshot');
  }
  try {
    return JSON.parse(promptText.slice(start + prefix.length, end));
  } catch (error) {
    throw new Error(
      `generation prompt frozen descriptor is invalid JSON: ${error.message}`
    );
  }
}

function failedAttemptText(pin, contents, label) {
  if (contents.length > MAX_WORKER_OUTPUT_BYTES) {
    throw new Error(`${label} exceeds worker evidence byte limit`);
  }
  return {
    ...pin,
    text: exactUtf8(contents, label)
  };
}

function failedAttemptAuditSummary(stdout) {
  const copy = assertSingleGeneratedArtifactCopyEvidence(stdout);
  const worker = auditCodexWorkerJsonl(stdout, {
    allowMixedExplicitArtifactEvidence: true
  });
  if (worker.imagegenInvocationCount !== 1) {
    throw new Error(
      'failed route evidence must prove exactly one imagegen invocation'
    );
  }
  const raster = assertNoProceduralRasterSynthesis(stdout);
  return {
    imagegen: {
      invocationCount: worker.imagegenInvocationCount,
      evidence: worker.imagegenEvidence
    },
    currentThread: {
      id: copy.threadId
    },
    artifactCopy: {
      sourcePath: copy.artifactPath
    },
    skillRead: {
      command: copy.skillReadCommand
    },
    commandCount: raster.commandCount
  };
}

function normalizeRejection(rejection) {
  const name = typeof rejection?.name === 'string' && rejection.name.length > 0
    ? rejection.name
    : 'Error';
  const message = typeof rejection?.message === 'string'
    ? rejection.message
    : String(rejection);
  if (message.length === 0) {
    throw new Error('failed route rejection message must be nonempty');
  }
  return { name, message };
}

function assertFailedAttemptTextEvidence(value, expectedPath, label) {
  exactKeys(value, ['path', 'bytes', 'sha256', 'text'], label);
  if (value.path !== expectedPath) {
    throw new Error(`${label}.path is not canonical`);
  }
  assertFailedAttemptInteger(value.bytes, `${label}.bytes`);
  assertFailedAttemptHash(value.sha256, `${label}.sha256`);
  if (typeof value.text !== 'string') {
    throw new Error(`${label}.text must be text`);
  }
  const bytes = Buffer.from(value.text);
  if (
    bytes.length !== value.bytes
    || sha256(bytes) !== value.sha256
    || bytes.length > MAX_WORKER_OUTPUT_BYTES
  ) {
    throw new Error(`${label} text identity does not match its pin`);
  }
}

export async function auditFailedRouteAttempt({
  root = SCRIPT_ROOT,
  relativePath
} = {}) {
  const evidence = await readRegularFileSnapshot(
    root,
    relativePath,
    'failed route attempt'
  );
  let record;
  try {
    record = JSON.parse(exactUtf8(
      evidence.contents,
      'failed route attempt'
    ));
  } catch (error) {
    throw new Error(`failed route attempt is invalid JSON: ${error.message}`);
  }
  const label = `failed route attempt ${relativePath}`;
  exactKeys(record, [
    'schemaVersion',
    'theme',
    'familyId',
    'raw',
    'descriptor',
    'prompt',
    'worker',
    'audit',
    'rejection',
    'fullHash'
  ], label);
  if (record.schemaVersion !== FAILED_ROUTE_ATTEMPT_SCHEMA) {
    throw new Error(`${label}.schemaVersion is unsupported`);
  }
  exactKeys(record.raw, [
    'path',
    'bytes',
    'width',
    'height',
    'format',
    'sha256'
  ], `${label}.raw`);
  for (const key of ['bytes', 'width', 'height']) {
    assertFailedAttemptInteger(record.raw[key], `${label}.raw.${key}`, 1);
  }
  if (!['png', 'webp'].includes(record.raw.format)) {
    throw new Error(`${label}.raw.format is unsupported`);
  }
  assertFailedAttemptHash(record.raw.sha256, `${label}.raw.sha256`);

  exactKeys(record.descriptor, [
    'path',
    'sha256',
    'contentVersion',
    'snapshot'
  ], `${label}.descriptor`);
  assertFailedAttemptHash(
    record.descriptor.sha256,
    `${label}.descriptor.sha256`
  );
  assertFailedAttemptInteger(
    record.descriptor.contentVersion,
    `${label}.descriptor.contentVersion`,
    1
  );
  const snapshot = record.descriptor.snapshot;
  assertDescriptor(
    snapshot,
    { promptProfile: snapshot?.promptProfile },
    `${label}.descriptor.snapshot`
  );
  if (
    snapshot?.theme !== record.theme
    || snapshot?.id !== record.familyId
    || snapshot?.content?.version !== record.descriptor.contentVersion
  ) {
    throw new Error(`${label}.descriptor snapshot identity is inconsistent`);
  }
  const descriptorPath =
    `ai-image-metadata/battle-art/descriptors/${record.theme}/`
    + `${record.familyId}.json`;
  if (record.descriptor.path !== descriptorPath) {
    throw new Error(`${label}.descriptor.path is not canonical`);
  }
  if (
    sha256(Buffer.from(stableJson(snapshot))) !== record.descriptor.sha256
  ) {
    throw new Error(`${label}.descriptor snapshot hash does not match`);
  }

  const paths = candidatePaths(snapshot);
  assertFailedAttemptTextEvidence(
    record.prompt,
    paths.prompt,
    `${label}.prompt`
  );
  if (
    stableJson(parseFrozenDescriptorFromGenerationPrompt(record.prompt.text))
      !== stableJson(snapshot)
  ) {
    throw new Error(`${label}.prompt frozen descriptor does not match`);
  }

  exactKeys(record.worker, [
    'command',
    'args',
    'ephemeral',
    'invocationCount',
    'timeoutMs',
    'styleReferenceMode',
    'styleReferenceProvenance',
    'stdout',
    'stderr',
    'lastMessage'
  ], `${label}.worker`);
  if (
    record.worker.command !== 'codex'
    || record.worker.ephemeral !== true
    || record.worker.invocationCount !== 1
  ) {
    throw new Error(`${label}.worker identity is invalid`);
  }
  if (
    !Array.isArray(record.worker.args)
    || record.worker.args.some(argument => typeof argument !== 'string')
  ) {
    throw new Error(`${label}.worker.args must be an array of strings`);
  }
  assertFailedAttemptInteger(
    record.worker.timeoutMs,
    `${label}.worker.timeoutMs`,
    1
  );
  assertStyleReferenceProvenance({
    styleReferences: snapshot.styleReferences,
    provenance: record.worker.styleReferenceProvenance,
    mode: record.worker.styleReferenceMode,
    args: record.worker.args,
    label: `${label}.worker`
  });
  assertFailedAttemptTextEvidence(
    record.worker.stdout,
    paths.stdout,
    `${label}.worker.stdout`
  );
  assertFailedAttemptTextEvidence(
    record.worker.stderr,
    paths.stderr,
    `${label}.worker.stderr`
  );
  if (record.worker.lastMessage !== null) {
    assertFailedAttemptTextEvidence(
      record.worker.lastMessage,
      paths.lastMessage,
      `${label}.worker.lastMessage`
    );
  }

  exactKeys(record.audit, [
    'imagegen',
    'currentThread',
    'artifactCopy',
    'skillRead',
    'commandCount'
  ], `${label}.audit`);
  exactKeys(
    record.audit.imagegen,
    ['invocationCount', 'evidence'],
    `${label}.audit.imagegen`
  );
  exactKeys(
    record.audit.currentThread,
    ['id'],
    `${label}.audit.currentThread`
  );
  exactKeys(
    record.audit.artifactCopy,
    ['sourcePath'],
    `${label}.audit.artifactCopy`
  );
  exactKeys(
    record.audit.skillRead,
    ['command'],
    `${label}.audit.skillRead`
  );
  const rerunAudit = failedAttemptAuditSummary(
    Buffer.from(record.worker.stdout.text)
  );
  if (stableJson(rerunAudit) !== stableJson(record.audit)) {
    throw new Error(`${label}.audit does not reproduce from worker stdout`);
  }

  exactKeys(record.rejection, ['name', 'message'], `${label}.rejection`);
  if (
    typeof record.rejection.name !== 'string'
    || record.rejection.name.length === 0
    || typeof record.rejection.message !== 'string'
    || record.rejection.message.length === 0
  ) {
    throw new Error(`${label}.rejection is invalid`);
  }
  assertFailedAttemptHash(record.fullHash, `${label}.fullHash`);
  const expectedFullHash = sha256(Buffer.from(stableJson(
    failedAttemptProjection(record)
  )));
  if (record.fullHash !== expectedFullHash) {
    throw new Error(`${label}.fullHash does not match its content`);
  }
  const expectedPath = failedRouteAttemptPath(snapshot, record.fullHash);
  if (relativePath !== expectedPath) {
    throw new Error(`${label} path is not content-addressed`);
  }
  const expectedRawPath = generatedArtifactPath(snapshot, record.raw);
  if (record.raw.path !== expectedRawPath) {
    throw new Error(`${label}.raw.path is not content-addressed`);
  }
  const rawBytes = await readPinnedRegularFile(
    root,
    record.raw.path,
    record.raw.sha256,
    `${label}.raw`
  );
  const inspectedRaw = await inspectImageContents(record.raw.path, rawBytes);
  if (stableJson(inspectedRaw) !== stableJson(record.raw)) {
    throw new Error(`${label}.raw image identity does not match`);
  }
  return {
    path: relativePath,
    file: structuredClone(evidence.pin),
    record,
    rawBytes
  };
}

export async function auditRevalidatedCandidateOrigin({
  root = SCRIPT_ROOT,
  descriptor,
  candidate,
  label = `${descriptor?.id ?? 'route artifact'} candidate origin`
} = {}) {
  if (candidate?.schemaVersion !== REVALIDATED_CANDIDATE_SCHEMA) {
    throw new Error(`${label} requires ${REVALIDATED_CANDIDATE_SCHEMA}`);
  }
  const descriptorSha256 = candidateValidationDescriptorSha256(descriptor);
  assertFailedAttemptRevalidationOrigin(candidate.origin, {
    theme: descriptor.theme,
    familyId: descriptor.id,
    validationDescriptorSha256: descriptorSha256,
    derivationSource: candidate.derivation?.source
  }, label);
  const audited = await auditFailedRouteAttempt({
    root,
    relativePath: candidate.origin.failureRecord.path
  });
  const originalDescriptor = {
    path: audited.record.descriptor.path,
    sha256: audited.record.descriptor.sha256,
    contentVersion: audited.record.descriptor.contentVersion
  };
  if (
    candidate.origin.failureRecord.sha256 !== audited.file.sha256
    || candidate.origin.failureRecord.fullHash !== audited.record.fullHash
    || stableJson(candidate.origin.raw) !== stableJson(audited.record.raw)
    || stableJson(candidate.origin.originalDescriptor)
      !== stableJson(originalDescriptor)
    || audited.record.theme !== descriptor.theme
    || audited.record.familyId !== descriptor.id
  ) {
    throw new Error(`${label} does not match its audited failed attempt`);
  }
  return audited;
}

async function archiveFailedRouteAttempt({
  root,
  descriptor,
  descriptorPath,
  raw,
  paths = candidatePaths(descriptor),
  workerArgs,
  invocationCount,
  timeoutMs,
  styleReferenceMode,
  styleReferenceProvenance: provenance,
  hasLastMessage,
  rejection
}) {
  const [prompt, stdout, stderr, lastMessage] = await Promise.all([
    readRegularFileSnapshot(root, paths.prompt, `${descriptor.id} prompt`),
    readRegularFileSnapshot(root, paths.stdout, `${descriptor.id} stdout`),
    readRegularFileSnapshot(root, paths.stderr, `${descriptor.id} stderr`),
    hasLastMessage
      ? readRegularFileSnapshot(
          root,
          paths.lastMessage,
          `${descriptor.id} last message`
        )
      : null
  ]);
  const projection = {
    schemaVersion: FAILED_ROUTE_ATTEMPT_SCHEMA,
    theme: descriptor.theme,
    familyId: descriptor.id,
    raw: structuredClone(raw),
    descriptor: {
      path: descriptorPath,
      sha256: sha256(Buffer.from(stableJson(descriptor))),
      contentVersion: descriptor.content.version,
      snapshot: structuredClone(descriptor)
    },
    prompt: failedAttemptText(
      prompt.pin,
      prompt.contents,
      `${descriptor.id} prompt`
    ),
    worker: {
      command: 'codex',
      args: structuredClone(workerArgs),
      ephemeral: true,
      invocationCount,
      timeoutMs,
      styleReferenceMode,
      styleReferenceProvenance: structuredClone(provenance),
      stdout: failedAttemptText(
        stdout.pin,
        stdout.contents,
        `${descriptor.id} stdout`
      ),
      stderr: failedAttemptText(
        stderr.pin,
        stderr.contents,
        `${descriptor.id} stderr`
      ),
      lastMessage: lastMessage === null
        ? null
        : failedAttemptText(
            lastMessage.pin,
            lastMessage.contents,
            `${descriptor.id} last message`
          )
    },
    audit: failedAttemptAuditSummary(stdout.contents),
    rejection: normalizeRejection(rejection)
  };
  const record = {
    ...projection,
    fullHash: sha256(Buffer.from(stableJson(projection)))
  };
  const relativePath = failedRouteAttemptPath(descriptor, record.fullHash);
  try {
    await atomicWrite(root, relativePath, stableJson(record), {
      immutable: true
    });
    return { path: relativePath, record, adopted: false };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await auditFailedRouteAttempt({
      root,
      relativePath
    });
    if (stableJson(existing.record) !== stableJson(record)) {
      throw new Error(
        `${descriptor.id} failed route evidence hash collision`
      );
    }
    return { path: relativePath, record: existing.record, adopted: true };
  }
}

function backfillWorkspaceFromLastMessage(descriptor, text) {
  const match = text.match(
    /\[candidate\.png\]\(([^)\r\n]+)\/candidate\.png\)/
  );
  if (!match) {
    throw new Error(
      `${descriptor.id} backfill last message has no candidate workspace path`
    );
  }
  const workspace = path.normalize(match[1]);
  const candidateDirectorySuffix = path.normalize(
    candidatePaths(descriptor).directory
  );
  const workspaceParent = path.dirname(workspace);
  if (
    !path.isAbsolute(workspace)
    || !workspaceParent.endsWith(
      `${path.sep}${candidateDirectorySuffix}`
    )
    || !/^\.workspace-[A-Za-z0-9]{6}$/.test(path.basename(workspace))
  ) {
    throw new Error(
      `${descriptor.id} backfill workspace path is not canonical`
    );
  }
  return workspace;
}

export async function backfillFailedRouteAttempt({
  root = SCRIPT_ROOT,
  theme,
  family,
  rawSha256,
  rawFormat = 'png',
  timeoutMs,
  rejection
} = {}) {
  if (
    rejection === null
    || typeof rejection !== 'object'
    || typeof rejection.name !== 'string'
    || typeof rejection.message !== 'string'
  ) {
    throw new Error('backfill original rejection name and message are required');
  }
  assertFailedAttemptInteger(timeoutMs, 'backfill timeoutMs', 1);
  assertFailedAttemptHash(rawSha256, 'backfill rawSha256');
  const originalRejection = normalizeRejection(rejection);
  const requestedTuple = {
    theme,
    family,
    rawSha256,
    rawFormat,
    timeoutMs,
    rejection: originalRejection
  };
  const frozenTuple = {
    theme: FROZEN_V6_FAILED_ROUTE_BACKFILL.theme,
    family: FROZEN_V6_FAILED_ROUTE_BACKFILL.family,
    rawSha256: FROZEN_V6_FAILED_ROUTE_BACKFILL.rawSha256,
    rawFormat: FROZEN_V6_FAILED_ROUTE_BACKFILL.rawFormat,
    timeoutMs: FROZEN_V6_FAILED_ROUTE_BACKFILL.timeoutMs,
    rejection: FROZEN_V6_FAILED_ROUTE_BACKFILL.rejection
  };
  if (stableJson(requestedTuple) !== stableJson(frozenTuple)) {
    throw new Error(
      'backfill is restricted to the exact frozen v6 8f1a failed attempt'
    );
  }
  const paths = candidatePaths({ theme, id: family });
  const prompt = await readRegularFileSnapshot(
    root,
    paths.prompt,
    `${family} backfill prompt`
  );
  const promptText = exactUtf8(prompt.contents, `${family} backfill prompt`);
  const descriptor = parseFrozenDescriptorFromGenerationPrompt(promptText);
  if (
    descriptor.theme !== theme
    || descriptor.id !== family
    || descriptor.content.version
      !== FROZEN_V6_FAILED_ROUTE_BACKFILL.contentVersion
    || sha256(Buffer.from(stableJson(descriptor)))
      !== FROZEN_V6_FAILED_ROUTE_BACKFILL.descriptorSha256
  ) {
    throw new Error('backfill frozen descriptor identity does not match v6 pin');
  }
  if (prompt.pin.sha256 !== FROZEN_V6_FAILED_ROUTE_BACKFILL.promptSha256) {
    throw new Error('backfill prompt hash does not match frozen v6 pin');
  }
  const descriptorPath =
    `ai-image-metadata/battle-art/descriptors/${theme}/${family}.json`;
  const rawPath = generatedArtifactPath(descriptor, {
    sha256: rawSha256,
    format: rawFormat
  });
  const rawBytes = await readPinnedRegularFile(
    root,
    rawPath,
    rawSha256,
    `${family} backfill raw`
  );
  const raw = await inspectImageContents(rawPath, rawBytes);
  const [stdout, stderr, lastMessage] = await Promise.all([
    readRegularFileSnapshot(
      root,
      paths.stdout,
      `${family} backfill stdout`
    ),
    readRegularFileSnapshot(
      root,
      paths.stderr,
      `${family} backfill stderr`
    ),
    readRegularFileSnapshot(
      root,
      paths.lastMessage,
      `${family} backfill last message`
    )
  ]);
  if (
    stdout.pin.sha256 !== FROZEN_V6_FAILED_ROUTE_BACKFILL.stdoutSha256
    || stderr.pin.sha256 !== FROZEN_V6_FAILED_ROUTE_BACKFILL.stderrSha256
    || lastMessage.pin.sha256
      !== FROZEN_V6_FAILED_ROUTE_BACKFILL.lastMessageSha256
  ) {
    throw new Error('backfill worker evidence does not match frozen v6 pins');
  }
  const lastMessageText = exactUtf8(
    lastMessage.contents,
    `${family} backfill last message`
  );
  const promptUsesAttachments = new RegExp(
    `The following ${descriptor.styleReferences.length} hash-verified `
      + 'style reference images? (?:is|are) already attached'
  ).test(promptText);
  const styleMode = promptUsesAttachments
    ? 'attachments'
    : 'text-fallback';
  const workspace = backfillWorkspaceFromLastMessage(
    descriptor,
    lastMessageText
  );
  const args = buildCodexArgs(
    workspace,
    path.join(workspace, 'last-message.txt'),
    styleMode === 'attachments'
      ? styleReferenceProvenance(descriptor.styleReferences).map(
          value => path.join(workspace, value.stagedBasename)
        )
      : []
  );
  const profileBytes = await readPinnedRegularFile(
    root,
    descriptor.promptProfile.path,
    descriptor.promptProfile.sha256,
    `${family} backfill prompt profile`
  );
  let profile;
  try {
    profile = JSON.parse(profileBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${family} backfill prompt profile is invalid: ${error.message}`);
  }
  let reproducedFailure;
  try {
    await prepareVerifiedGeneratedCandidate({
      generatedBytes: rawBytes,
      descriptor,
      profile
    });
  } catch (error) {
    reproducedFailure = error;
  }
  if (!reproducedFailure) {
    throw new Error(
      `${family} backfill raw no longer reproduces a publication failure`
    );
  }
  return archiveFailedRouteAttempt({
    root,
    descriptor,
    descriptorPath,
    raw,
    paths,
    workerArgs: args,
    invocationCount: 1,
    timeoutMs,
    styleReferenceMode: styleMode,
    styleReferenceProvenance:
      styleReferenceProvenance(descriptor.styleReferences),
    hasLastMessage: true,
    rejection: originalRejection
  });
}

async function recoverOriginalWorkerWorkspace({
  root,
  paths,
  stdout,
  lastMessage
}) {
  const message = exactUtf8(lastMessage, 'candidate worker last message');
  const match = message.match(
    /^Copied the generated artifact unchanged to \[candidate\.png\]\((.+\/candidate\.png)\)\.$/
  );
  if (!match) {
    throw new Error(
      'candidate worker last message does not identify its original workspace'
    );
  }
  const candidatePath = match[1];
  const workspace = path.dirname(candidatePath);
  const candidateDirectory = resolveTracked(
    root,
    paths.directory,
    'candidate recovery directory'
  );
  if (
    !path.isAbsolute(candidatePath)
    || path.normalize(candidatePath) !== candidatePath
    || path.basename(candidatePath) !== 'candidate.png'
    || path.dirname(workspace) !== candidateDirectory
    || !/^\.workspace-[A-Za-z0-9]{6}$/.test(path.basename(workspace))
  ) {
    throw new Error(
      'candidate worker last message has a non-canonical original workspace'
    );
  }
  let matchingMessages = 0;
  let matchingMessageLine = -1;
  let copyLine = -1;
  let lastAgentMessage = null;
  for (const [index, line] of exactUtf8(
    stdout,
    'candidate worker JSONL'
  ).split(/\r?\n/).entries()) {
    if (line.length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('candidate worker JSONL is invalid during recovery');
    }
    const item = event?.item
      && typeof event.item === 'object'
      && !Array.isArray(event.item)
      ? event.item
      : event;
    if (item?.type === 'agent_message') {
      lastAgentMessage = item.text;
      if (item.text === message) {
        matchingMessages += 1;
        matchingMessageLine = index;
      }
    }
    if (
      event?.type === 'item.completed'
      && item?.type === 'command_execution'
      && item.status === 'completed'
      && item.exit_code === 0
      && typeof item.command === 'string'
      && parseGeneratedArtifactCopyCommand(item.command, {
        requireAbsoluteCp: true,
        candidateNames: ['candidate.png']
      }) !== null
    ) {
      copyLine = index;
    }
  }
  if (
    matchingMessages !== 1
    || copyLine < 0
    || matchingMessageLine <= copyLine
    || lastAgentMessage !== message
  ) {
    throw new Error(
      'candidate worker JSONL must end its artifact copy with the one '
      + 'preserved final message'
    );
  }
  try {
    await lstat(workspace);
  } catch (error) {
    if (error.code === 'ENOENT') return workspace;
    throw error;
  }
  throw new Error('candidate recovery original workspace still exists');
}

async function recoverOne({
  loaded,
  entry,
  profile,
  options,
  environmentSource
}) {
  const descriptor = entry.descriptor;
  const paths = candidatePaths(descriptor);
  if (descriptor.status !== 'draft') {
    throw new Error(
      `${descriptor.id} is ${descriptor.status}; only a draft may be recovered`
    );
  }
  if (descriptor.category !== 'route-transition') {
    throw new Error(
      `${descriptor.id} recovery is limited to route-transition artifacts`
    );
  }
  const [prompt, stdout, stderr, lastMessage] = await Promise.all([
    readRegularFileSnapshot(
      loaded.root,
      paths.prompt,
      `${descriptor.id} recovery prompt`
    ),
    readRegularFileSnapshot(
      loaded.root,
      paths.stdout,
      `${descriptor.id} recovery worker JSONL`
    ),
    readRegularFileSnapshot(
      loaded.root,
      paths.stderr,
      `${descriptor.id} recovery worker stderr`
    ),
    readRegularFileSnapshot(
      loaded.root,
      paths.lastMessage,
      `${descriptor.id} recovery worker last message`
    )
  ]);
  for (const evidence of [prompt, stdout, stderr, lastMessage]) {
    if (evidence.contents.length > MAX_WORKER_OUTPUT_BYTES) {
      throw new Error(`${evidence.pin.path} exceeds worker log limit`);
    }
  }
  const provenance = styleReferenceProvenance(descriptor.styleReferences);
  await Promise.all(descriptor.styleReferences.map(async pin => {
    await auditCorrectiveStyleReferenceForGeneration({
      root: loaded.root,
      descriptor,
      pin
    });
    return readPinnedRegularFile(
      loaded.root,
      pin.path,
      pin.sha256,
      `${pin.id} recovery style reference`
    );
  }));
  const styleFiles = provenance.map(value => value.stagedBasename);
  const expectedPrompt = Buffer.from(
    `${buildGenerationPrompt({
      descriptor,
      profile,
      styleFiles,
      textStyleFallback: options.textStyleFallback
    })}\n`
  );
  if (!prompt.contents.equals(expectedPrompt)) {
    throw new Error(
      `${descriptor.id} recovery prompt does not match current frozen inputs`
    );
  }
  const { artifactPath } = assertSingleGeneratedArtifactCopyEvidence(
    stdout.contents
  );
  const toolAudit = auditCodexWorkerJsonl(stdout.contents, {
    allowMixedExplicitArtifactEvidence: true
  });
  const verificationAudit = {
    ...toolAudit,
    imagegenEvidence: 'generated-artifact',
    imagegenInvocationCount: toolAudit.imagegenArtifacts.length
  };
  if (
    toolAudit.imagegenInvocationCount !== 1
    || verificationAudit.imagegenInvocationCount !== 1
    || verificationAudit.imagegenArtifacts[0]?.path !== artifactPath
  ) {
    throw new Error(
      `${descriptor.id} recovery evidence must prove exactly one imagegen artifact`
    );
  }
  const verification = await verifyCodexImagegenEvidence(
    verificationAudit,
    {
      environmentSource,
      returnGeneratedArtifactBytes: true
    }
  );
  assertNoProceduralRasterSynthesis(stdout.contents);
  const originalWorkspace = await recoverOriginalWorkerWorkspace({
    root: loaded.root,
    paths,
    stdout: stdout.contents,
    lastMessage: lastMessage.contents
  });
  const workerArgs = buildCodexArgs(
    originalWorkspace,
    path.join(originalWorkspace, 'last-message.txt'),
    options.textStyleFallback
      ? []
      : styleFiles.map(file => path.join(originalWorkspace, file))
  );
  return publishVerifiedGeneratedCandidate({
    loaded,
    entry,
    profile,
    paths,
    generatedBytes: verification.generatedArtifactBytes,
    styleReferenceMode: options.textStyleFallback
      ? 'text-fallback'
      : 'attachments',
    styleReferenceProvenance: provenance,
    workerArgs,
    invocationCount: 1,
    timeoutMs: options.timeoutMs,
    hasLastMessage: true,
    recovered: true
  });
}

async function generateOne({
  loaded,
  entry,
  profile,
  options,
  worker,
  afterCandidateVerified
}) {
  const descriptor = entry.descriptor;
  const paths = candidatePaths(descriptor);
  const candidateDirectory = resolveTracked(loaded.root, paths.directory, 'candidate directory');
  await mkdir(candidateDirectory, { recursive: true });
  const workspace = await mkdtemp(path.join(candidateDirectory, '.workspace-'));
  try {
    const staged = await stageInputs(loaded.root, workspace, descriptor, profile);
    const before = await workspaceSnapshot(workspace);
    const prompt = buildGenerationPrompt({
      descriptor,
      profile,
      styleFiles: staged.styleFiles,
      textStyleFallback: options.textStyleFallback
    });
    const result = await worker({
      workspace,
      prompt,
      timeoutMs: options.timeoutMs,
      descriptor,
      styleFiles: options.textStyleFallback ? [] : staged.styleFiles
    });
    const expectedImagePaths = options.textStyleFallback
      ? []
      : staged.styleFiles.map(file => path.join(workspace, file));
    const workerImagePaths = (result.args ?? []).flatMap(
      (argument, index, args) => argument === '--image' ? [args[index + 1]] : []
    );
    if (workerImagePaths.some(value => typeof value !== 'string')
      || stableJson(workerImagePaths) !== stableJson(expectedImagePaths)
      || new Set(workerImagePaths).size !== workerImagePaths.length) {
      throw new Error('worker CLI --image count/order does not match style references');
    }
    if (Buffer.byteLength(result.stdout ?? Buffer.alloc(0)) > MAX_WORKER_OUTPUT_BYTES
      || Buffer.byteLength(result.stderr ?? Buffer.alloc(0)) > MAX_WORKER_OUTPUT_BYTES) {
      throw new Error('worker output exceeded the bounded log limit');
    }
    const diagnosticEntries = [
      [paths.prompt, `${prompt}\n`],
      [paths.stdout, result.stdout ?? Buffer.alloc(0)],
      [paths.stderr, result.stderr ?? Buffer.alloc(0)]
    ];
    for (const [relative, contents] of diagnosticEntries) {
      if (Buffer.byteLength(contents) > MAX_WORKER_OUTPUT_BYTES) {
        throw new Error(`${relative} exceeds worker log limit`);
      }
      await atomicWrite(loaded.root, relative, contents);
    }
    const after = await workspaceSnapshot(workspace);
    const candidateName = auditWorkspace(before, after, staged.inputs);
    const lastMessage = await readAuditedWorkerFile(
      workspace,
      after,
      'last-message.txt'
    );
    // The untrusted last-message file is preserved only after the disposable
    // workspace has passed symlink, mutation, membership, and byte-limit
    // auditing. Fixed-path prompt/stdout/stderr diagnostics are already durable
    // so a worker that creates no candidate remains diagnosable.
    const logEntries = lastMessage === null
      ? []
      : [[paths.lastMessage, lastMessage]];
    for (const [relative, contents] of logEntries) {
      if (Buffer.byteLength(contents) > MAX_WORKER_OUTPUT_BYTES) {
        throw new Error(`${relative} exceeds worker log limit`);
      }
      await atomicWrite(loaded.root, relative, contents);
    }
    const routeGeneration = descriptor.category === 'route-transition';
    if (routeGeneration) {
      assertSingleGeneratedArtifactCopyEvidence(result.stdout);
    }
    const toolAudit = auditCodexWorkerJsonl(result.stdout, {
      allowMixedExplicitArtifactEvidence: routeGeneration
    });
    const invocationCount = toolAudit.imagegenInvocationCount;
    if (invocationCount !== 1) {
      throw new Error(`worker must call imagegen exactly once; observed ${invocationCount}`);
    }
    const workspaceCandidate = path.join(workspace, candidateName);
    const verificationAudit = routeGeneration
      ? {
          ...toolAudit,
          imagegenEvidence: 'generated-artifact',
          imagegenInvocationCount: toolAudit.imagegenArtifacts.length
        }
      : toolAudit;
    const verification = await verifyCodexImagegenEvidence(
      verificationAudit,
      {
        candidatePath: workspaceCandidate,
        environmentSource: result.environmentSource ?? process.env,
        requireCandidateByteIdentity: routeGeneration
      }
    );
    const generatedBytes = verification.candidateBytes;
    await afterCandidateVerified({
      workspaceCandidate,
      verifiedCandidateBytes: generatedBytes,
      descriptor
    });
    assertNoProceduralRasterSynthesis(result.stdout);
    return await publishVerifiedGeneratedCandidate({
      loaded,
      entry,
      profile,
      paths,
      generatedBytes,
      styleReferenceMode: options.textStyleFallback
        ? 'text-fallback'
        : 'attachments',
      styleReferenceProvenance: staged.styleReferenceProvenance,
      workerArgs: result.args ?? [],
      invocationCount,
      timeoutMs: options.timeoutMs,
      hasLastMessage: logEntries.some(
        ([relative]) => relative === paths.lastMessage
      )
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runPool(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  return results;
}

async function recoverBattleArt(
  loaded,
  selected,
  options,
  environmentSource
) {
  if (
    !Array.isArray(options.families)
    || options.families.length !== 1
    || selected.length !== 1
  ) {
    throw new Error(
      'battle-art recovery requires exactly one explicit --family'
    );
  }
  if (options.timeoutProvided !== true) {
    throw new Error(
      'battle-art recovery requires the original worker --timeout'
    );
  }
  if (
    options.dryRun
    || options.force
    || options.resume
    || options.keepGoing
  ) {
    throw new Error(
      'battle-art recovery cannot be combined with dry-run, force, resume, '
      + 'or keep-going'
    );
  }
  const [entry] = selected;
  const paths = candidatePaths(entry.descriptor);
  const result = await withBattleArtCandidateLock({
    root: loaded.root,
    theme: entry.descriptor.theme,
    family: entry.descriptor.id
  }, async () => {
    const lockedLoaded = await loadBattleArt(loaded.root);
    const [lockedEntry] = selectFamilies(lockedLoaded, {
      theme: entry.descriptor.theme,
      family: entry.descriptor.id
    });
    const lockedPaths = candidatePaths(lockedEntry.descriptor);
    await assertRecoveryPublicationAbsent(
      lockedLoaded.root,
      lockedEntry.descriptor,
      lockedPaths
    );
    try {
      return await recoverOne({
        loaded: lockedLoaded,
        entry: lockedEntry,
        profile: lockedLoaded.promptProfile,
        options,
        environmentSource
      });
    } catch (error) {
      await cleanCandidatePublication(lockedLoaded.root, lockedPaths);
      throw error;
    }
  });
  return {
    ok: true,
    dryRun: false,
    recover: true,
    concurrency: 0,
    timeoutMs: options.timeoutMs,
    jobs: [{
      family: entry.descriptor.id,
      theme: entry.descriptor.theme,
      outputDirectory: paths.directory
    }],
    results: [result]
  };
}

export async function revalidateFailedRouteAttempt(options = {}) {
  if (options.force !== undefined) {
    throw new Error('battle-art failed-attempt revalidation does not accept force');
  }
  for (const key of ['theme', 'family', 'failure']) {
    if (typeof options[key] !== 'string' || options[key].length === 0) {
      throw new Error(`--${key} is required`);
    }
  }
  const root = options.projectRoot ?? options.root ?? SCRIPT_ROOT;
  const loaded = await loadBattleArt(root);
  const [entry] = selectFamilies(loaded, {
    theme: options.theme,
    family: options.family
  });
  if (entry.descriptor.status !== 'draft') {
    throw new Error(
      `${entry.descriptor.id} is ${entry.descriptor.status}; `
      + 'failed-attempt revalidation requires a draft family'
    );
  }
  if (entry.descriptor.category !== 'route-transition') {
    throw new Error(
      `${entry.descriptor.id} is not a route-transition family`
    );
  }
  if (entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2) {
    const readiness = await loadReadinessPlan(loaded.root);
    assertV2DescriptorsPlanned([entry], readiness.plan);
  }
  const paths = candidatePaths(entry.descriptor);
  const result = await withBattleArtCandidateLock({
    root: loaded.root,
    theme: entry.descriptor.theme,
    family: entry.descriptor.id
  }, async () => {
    const lockedLoaded = await loadBattleArt(loaded.root);
    const [lockedEntry] = selectFamilies(lockedLoaded, {
      theme: entry.descriptor.theme,
      family: entry.descriptor.id
    });
    const descriptor = lockedEntry.descriptor;
    const lockedPaths = candidatePaths(descriptor);
    if (
      descriptor.status !== 'draft'
      || descriptor.category !== 'route-transition'
    ) {
      throw new Error(
        `${descriptor.id} is no longer an eligible draft route family`
      );
    }
    await assertRecoveryPublicationAbsent(
      lockedLoaded.root,
      descriptor,
      lockedPaths,
      'failed-attempt revalidation'
    );
    try {
      const audited = await auditFailedRouteAttempt({
        root: lockedLoaded.root,
        relativePath: options.failure
      });
      if (
        audited.record.theme !== descriptor.theme
        || audited.record.familyId !== descriptor.id
      ) {
        throw new Error(
          `${descriptor.id} failed-attempt record belongs to `
          + `${audited.record.theme}/${audited.record.familyId}`
        );
      }
      const prepared = await prepareVerifiedGeneratedCandidate({
        generatedBytes: audited.rawBytes,
        descriptor,
        profile: lockedLoaded.promptProfile,
        generatedArtifact: audited.record.raw
      });
      if (prepared.derivation === null) {
        throw new Error(
          `${descriptor.id} revalidated route has no reproducible derivation`
        );
      }
      const imageRelative = prepared.normalizedFormat === 'png'
        ? lockedPaths.imagePng
        : lockedPaths.imageWebp;
      await atomicWrite(
        lockedLoaded.root,
        imageRelative,
        prepared.candidateBytes
      );
      const image = await inspectImageContents(
        imageRelative,
        prepared.candidateBytes
      );
      const descriptorSha256 = candidateValidationDescriptorSha256(
        descriptor
      );
      const candidate = {
        schemaVersion: REVALIDATED_CANDIDATE_SCHEMA,
        familyId: descriptor.id,
        theme: descriptor.theme,
        descriptorPath: lockedEntry.path,
        descriptorSha256,
        promptProfile: structuredClone(descriptor.promptProfile),
        styleReferences: structuredClone(descriptor.styleReferences),
        origin: {
          kind: FAILED_ATTEMPT_REVALIDATION_ORIGIN,
          failureRecord: {
            path: audited.path,
            sha256: audited.file.sha256,
            fullHash: audited.record.fullHash
          },
          raw: structuredClone(audited.record.raw),
          originalDescriptor: {
            path: audited.record.descriptor.path,
            sha256: audited.record.descriptor.sha256,
            contentVersion: audited.record.descriptor.contentVersion
          },
          validationDescriptorSha256: descriptorSha256
        },
        derivation: {
          ...structuredClone(prepared.derivation),
          source: structuredClone(audited.record.raw)
        },
        image,
        status: 'candidate-awaiting-review'
      };
      await auditRevalidatedCandidateOrigin({
        root: lockedLoaded.root,
        descriptor,
        candidate
      });
      await atomicWrite(
        lockedLoaded.root,
        lockedPaths.metadata,
        stableJson(candidate)
      );
      return {
        family: descriptor.id,
        theme: descriptor.theme,
        status: 'revalidated',
        image,
        origin: structuredClone(candidate.origin)
      };
    } catch (error) {
      await cleanCandidatePublication(lockedLoaded.root, lockedPaths);
      throw error;
    }
  });
  return {
    ok: true,
    revalidatedFailure: true,
    concurrency: 0,
    jobs: [{
      family: entry.descriptor.id,
      theme: entry.descriptor.theme,
      outputDirectory: paths.directory
    }],
    results: [result]
  };
}

export async function generateBattleArt(options, {
  worker = spawnCodexWorker,
  afterCandidateVerified = async () => {},
  environmentSource = process.env
} = {}) {
  if (!options.dryRun && !options.recover) {
    const hasScalarFamily = typeof options.family === 'string';
    const hasFamilyList = Array.isArray(options.families);
    const explicitFamilies = hasFamilyList
      ? options.families
      : hasScalarFamily
        ? [options.family]
        : [];
    if (explicitFamilies.length !== 1) {
      throw new Error(
        'live battle-art generation requires exactly one explicit --family'
      );
    }
    if (hasScalarFamily && hasFamilyList) {
      throw new Error(
        'live battle-art generation accepts only one --family selection form'
      );
    }
    if (options.concurrency !== 1) {
      throw new Error('live battle-art generation requires --concurrency 1');
    }
    if (options.keepGoing) {
      throw new Error('live battle-art generation cannot use --keep-going');
    }
  }
  const loaded = await loadBattleArt(options.projectRoot);
  const selected = selectFamilies(loaded, options);
  if (selected.some(entry => (
    entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V2
  ))) {
    const readiness = await loadReadinessPlan(loaded.root);
    assertV2DescriptorsPlanned(selected, readiness.plan);
  }
  if (options.recover) {
    return recoverBattleArt(
      loaded,
      selected,
      options,
      environmentSource
    );
  }
  const jobs = [];
  const results = [];
  if (options.dryRun) {
    for (const entry of selected) {
      const paths = candidatePaths(entry.descriptor);
      const disposition = await inspectCandidateDisposition({
        loaded,
        entry,
        paths,
        options
      });
      if (disposition.shouldGenerate) jobs.push({ entry, paths });
      else results.push(disposition.result);
    }
  }
  const plan = {
    ok: true,
    dryRun: options.dryRun,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    jobs: jobs.map(job => ({
      family: job.entry.descriptor.id,
      theme: job.entry.descriptor.theme,
      outputDirectory: job.paths.directory
    })),
    results
  };
  if (options.dryRun) return plan;
  const requestedJobs = selected.map(entry => ({
    entry,
    paths: candidatePaths(entry.descriptor)
  }));
  const generated = await runPool(
    requestedJobs,
    options.concurrency,
    async job => {
      try {
        return await withBattleArtCandidateLock({
          root: loaded.root,
          theme: job.entry.descriptor.theme,
          family: job.entry.descriptor.id
        }, async () => {
          const lockedLoaded = await loadBattleArt(loaded.root);
          const [lockedEntry] = selectFamilies(lockedLoaded, {
            theme: job.entry.descriptor.theme,
            family: job.entry.descriptor.id
          });
          const lockedPaths = candidatePaths(lockedEntry.descriptor);
          const disposition = await inspectCandidateDisposition({
            loaded: lockedLoaded,
            entry: lockedEntry,
            paths: lockedPaths,
            options
          });
          if (!disposition.shouldGenerate) return disposition.result;
          if (options.force || options.resume) {
            await cleanCandidateFiles(lockedLoaded.root, lockedPaths);
          }
          try {
            return await generateOne({
              loaded: lockedLoaded,
              entry: lockedEntry,
              profile: lockedLoaded.promptProfile,
              options,
              worker,
              afterCandidateVerified
            });
          } catch (error) {
            await cleanCandidatePublication(lockedLoaded.root, lockedPaths);
            throw error;
          }
        });
      } catch (error) {
        if (!options.keepGoing) throw error;
        return {
          family: job.entry.descriptor.id,
          status: 'failed',
          error: error.message
        };
      }
    }
  );
  return {
    ...plan,
    ok: generated.every(entry => entry.status !== 'failed'),
    jobs: generated
      .filter(entry => entry.status === 'generated')
      .map(entry => {
        const requested = requestedJobs.find(
          job => job.entry.descriptor.id === entry.family
        );
        return {
          family: entry.family,
          theme: requested.entry.descriptor.theme,
          outputDirectory: requested.paths.directory
        };
      }),
    results: generated
  };
}
