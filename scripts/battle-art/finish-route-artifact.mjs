import { createHash } from 'node:crypto';

import sharp from 'sharp';

import {
  decodeCanonicalRaster,
  normalizeGeneratedRasterBytes
} from './raster-contract.mjs';

const ROUTE_FINISHING_SCHEMA = 'battle-art-route-finishing-v1';
const LARGEST_COMPONENT_BOX_STRATEGY = 'largest-component-box-v1';
const ANCHOR_SCALE_STRATEGY = 'anchor-scale-v1';
const MAXIMUM_DIMENSION = 4096;
export const ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS = 4 * 1024 * 1024;
const MAXIMUM_DETACHED_COVERED_PERMILLE = 150;
const CLEAR_BORDER_WIDTH = 4;
const STRAIGHT_MAXIMUM_COVERAGE_PERMILLE = 300;
const TERMINAL_CLIP_MAXIMUM_REMOVED_COVERED_PERMILLE = 50;
const FORBIDDEN_BAND_MAXIMUM_REMOVED_COVERED_PERMILLE = 50;
const ARM_SAMPLE_FRACTIONS = Object.freeze([0.5, 0.75, 1]);
const TEE_OUTER_ARM_SAMPLE_FRACTIONS = Object.freeze([0.75, 1]);
const TEE_OUTER_ARM_MAXIMUM_PIXELS = 64;
const TEE_OUTER_ARM_MAXIMUM_SPREAD_PIXELS = 24;
// Permit modest subject-box variation without allowing the finisher to reshape
// route art. A descriptor may pin a slightly higher bounded value when it also
// carries measured prime geometry; comparisons remain integer-only.
const DEFAULT_MAXIMUM_SCALE_ANISOTROPY_PERMILLE = 1250;
const MAXIMUM_SCALE_ANISOTROPY_PERMILLE = 1500;

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertDimension(value, label) {
  if (!Number.isSafeInteger(value)
    || value <= 0
    || value > MAXIMUM_DIMENSION) {
    throw new Error(
      `${label} must be an integer between 1 and ${MAXIMUM_DIMENSION}`
    );
  }
}

function assertCoordinate(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
}

export function assertRouteSourceExtent(width, height) {
  assertDimension(width, 'route artifact source width');
  assertDimension(height, 'route artifact source height');
  if (width * height > ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS) {
    throw new Error(
      `route artifact source has ${width * height} pixels; expected at most `
      + `${ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS}`
    );
  }
}

function routeFinishingContract(descriptor) {
  if (!descriptor
    || typeof descriptor !== 'object'
    || Array.isArray(descriptor)) {
    throw new Error('route artifact descriptor must be an object');
  }
  const width = descriptor.canvas?.width;
  const height = descriptor.canvas?.height;
  assertDimension(width, 'route artifact canvas width');
  assertDimension(height, 'route artifact canvas height');

  const finishing = descriptor.routeFinishing;
  if (!finishing || typeof finishing !== 'object' || Array.isArray(finishing)) {
    throw new Error('descriptor.routeFinishing must be an object');
  }
  if (finishing.schemaVersion !== ROUTE_FINISHING_SCHEMA) {
    throw new Error(
      `descriptor.routeFinishing.schemaVersion must be ${ROUTE_FINISHING_SCHEMA}`
    );
  }
  if (![LARGEST_COMPONENT_BOX_STRATEGY, ANCHOR_SCALE_STRATEGY]
    .includes(finishing.strategy)) {
    throw new Error(
      'descriptor.routeFinishing.strategy must be '
      + `${LARGEST_COMPONENT_BOX_STRATEGY} or ${ANCHOR_SCALE_STRATEGY}`
    );
  }

  const maximumDetachedCoveredPermille =
    finishing.maximumDetachedCoveredPermille;
  if (!Number.isSafeInteger(maximumDetachedCoveredPermille)
    || maximumDetachedCoveredPermille < 0
    || maximumDetachedCoveredPermille > MAXIMUM_DETACHED_COVERED_PERMILLE) {
    throw new Error(
      'descriptor.routeFinishing.maximumDetachedCoveredPermille '
      + `must be an integer between 0 and `
      + `${MAXIMUM_DETACHED_COVERED_PERMILLE}`
    );
  }
  const armAlphaSpan = finishing.armAlphaSpan;
  if (!armAlphaSpan
    || typeof armAlphaSpan !== 'object'
    || Array.isArray(armAlphaSpan)) {
    throw new Error('descriptor.routeFinishing.armAlphaSpan must be an object');
  }
  for (const key of [
    'alphaThreshold',
    'minimumPixels',
    'maximumPixels',
    'maximumSpreadPixels'
  ]) {
    if (!Number.isSafeInteger(armAlphaSpan[key])
      || armAlphaSpan[key] < (key === 'maximumSpreadPixels' ? 0 : 1)) {
      throw new Error(
        `descriptor.routeFinishing.armAlphaSpan.${key} is invalid`
      );
    }
  }
  if (armAlphaSpan.alphaThreshold > 255
    || armAlphaSpan.minimumPixels > armAlphaSpan.maximumPixels) {
    throw new Error('descriptor.routeFinishing.armAlphaSpan is invalid');
  }
  const common = {
    canvas: { width, height },
    maximumDetachedCoveredPermille,
    armAlphaSpan: {
      alphaThreshold: armAlphaSpan.alphaThreshold,
      minimumPixels: armAlphaSpan.minimumPixels,
      maximumPixels: armAlphaSpan.maximumPixels,
      maximumSpreadPixels: armAlphaSpan.maximumSpreadPixels
    }
  };

  if (finishing.strategy === ANCHOR_SCALE_STRATEGY) {
    for (const forbidden of [
      'targetBox',
      'maximumScaleAnisotropyPermille',
      'terminalClip',
      'geometryPrime'
    ]) {
      if (Object.hasOwn(finishing, forbidden)) {
        throw new Error(
          `descriptor.routeFinishing.${forbidden} is not allowed for `
          + ANCHOR_SCALE_STRATEGY
        );
      }
    }
    if (!Number.isSafeInteger(finishing.scalePermille)
      || finishing.scalePermille < 1001
      || finishing.scalePermille > 1500) {
      throw new Error(
        'descriptor.routeFinishing.scalePermille must be an integer between '
        + '1001 and 1500'
      );
    }
    const anchor = descriptor.placement?.anchor;
    assertCoordinate(anchor?.x, 'route finishing anchor.x');
    assertCoordinate(anchor?.y, 'route finishing anchor.y');
    if (anchor.x >= width || anchor.y >= height) {
      throw new Error('route finishing anchor must be contained by the canvas');
    }
    return {
      ...common,
      strategy: ANCHOR_SCALE_STRATEGY,
      scalePermille: finishing.scalePermille,
      anchor: { x: anchor.x, y: anchor.y }
    };
  }

  const targetBox = finishing.targetBox;
  if (!targetBox || typeof targetBox !== 'object' || Array.isArray(targetBox)) {
    throw new Error('descriptor.routeFinishing.targetBox must be an object');
  }
  assertCoordinate(targetBox.x, 'route finishing targetBox.x');
  assertCoordinate(targetBox.y, 'route finishing targetBox.y');
  assertDimension(targetBox.width, 'route finishing targetBox.width');
  assertDimension(targetBox.height, 'route finishing targetBox.height');
  if (targetBox.x + targetBox.width > width
    || targetBox.y + targetBox.height > height) {
    throw new Error('route finishing targetBox must be contained by the canvas');
  }

  let terminalClip = null;
  if (finishing.terminalClip !== undefined) {
    if (!finishing.terminalClip
      || typeof finishing.terminalClip !== 'object'
      || Array.isArray(finishing.terminalClip)
      || finishing.terminalClip.schemaVersion
        !== 'battle-art-route-terminal-clip-v1'
      || !Number.isSafeInteger(
        finishing.terminalClip.maximumOverflowPixels
      )
      || finishing.terminalClip.maximumOverflowPixels < 0
      || finishing.terminalClip.maximumOverflowPixels > 32
      || !descriptor.capabilities?.routeTopology?.startsWith('straight-')) {
      throw new Error('descriptor.routeFinishing.terminalClip is invalid');
    }
    terminalClip = {
      schemaVersion: finishing.terminalClip.schemaVersion,
      maximumOverflowPixels:
        finishing.terminalClip.maximumOverflowPixels
    };
  }
  const maximumScaleAnisotropyPermille =
    finishing.maximumScaleAnisotropyPermille
      ?? DEFAULT_MAXIMUM_SCALE_ANISOTROPY_PERMILLE;
  if (!Number.isSafeInteger(maximumScaleAnisotropyPermille)
    || maximumScaleAnisotropyPermille
      < DEFAULT_MAXIMUM_SCALE_ANISOTROPY_PERMILLE
    || maximumScaleAnisotropyPermille
      > MAXIMUM_SCALE_ANISOTROPY_PERMILLE) {
    throw new Error(
      'descriptor.routeFinishing.maximumScaleAnisotropyPermille '
      + `must be an integer between `
      + `${DEFAULT_MAXIMUM_SCALE_ANISOTROPY_PERMILLE} and `
      + `${MAXIMUM_SCALE_ANISOTROPY_PERMILLE}`
    );
  }
  return {
    ...common,
    strategy: LARGEST_COMPONENT_BOX_STRATEGY,
    targetBox: {
      x: targetBox.x,
      y: targetBox.y,
      width: targetBox.width,
      height: targetBox.height
    },
    maximumScaleAnisotropyPermille,
    terminalClip
  };
}

function straightRouteVectors(topology, canvas) {
  const vectors = {
    n: { x: canvas.width / 4, y: -canvas.height / 4 },
    e: { x: canvas.width / 4, y: canvas.height / 4 },
    s: { x: -canvas.width / 4, y: canvas.height / 4 },
    w: { x: -canvas.width / 4, y: -canvas.height / 4 }
  };
  return [...topology.slice('straight-'.length)].map(
    direction => ({ direction, ...vectors[direction] })
  );
}

async function clipStraightRouteTerminalOverflow({
  bytes,
  descriptor,
  contract
}) {
  if (contract.terminalClip === null) {
    return { bytes, derivation: null };
  }
  const { data, info } = await sharp(bytes, { failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const anchor = descriptor.placement.anchor;
  const maximum = contract.terminalClip.maximumOverflowPixels;
  const vectors = straightRouteVectors(
    descriptor.capabilities.routeTopology,
    contract.canvas
  );
  let clearedPixels = 0;
  let coveredPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = ((y * info.width) + x) * 4;
      if (data[index + 3] === 0) continue;
      coveredPixels += 1;
      const outside = vectors.some(vector => {
        const lengthSquared =
          (vector.x * vector.x) + (vector.y * vector.y);
        const overflowDot =
          ((x - anchor.x) * vector.x)
          + ((y - anchor.y) * vector.y)
          - lengthSquared;
        return overflowDot > 0
          && (overflowDot * overflowDot)
            > (maximum * maximum * lengthSquared);
      });
      if (!outside) continue;
      data.fill(0, index, index + 4);
      clearedPixels += 1;
    }
  }
  if (
    clearedPixels * 1000
      > coveredPixels * TERMINAL_CLIP_MAXIMUM_REMOVED_COVERED_PERMILLE
  ) {
    const removedPermille = Math.ceil(
      (clearedPixels * 1000) / coveredPixels
    );
    throw new Error(
      `${descriptor.id ?? 'route artifact'} finished raster terminal clipping `
      + `would remove ${removedPermille}‰ of covered pixels; expected at most `
      + `${TERMINAL_CLIP_MAXIMUM_REMOVED_COVERED_PERMILLE}‰`
    );
  }
  const clippedBytes = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  }).png({ compressionLevel: 9, palette: false }).toBuffer();
  return {
    bytes: clippedBytes,
    derivation: {
      schemaVersion: contract.terminalClip.schemaVersion,
      maximumOverflowPixels: maximum,
      clearedPixels
    }
  };
}

function sourceFormat(bytes) {
  if (bytes.length >= 8
    && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )) {
    return 'png';
  }
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  throw new Error('route artifact source must be PNG or WebP');
}

function visibleComponents(data, width, height) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let componentCount = 0;
  let coveredPixels = 0;
  let largest = null;

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || data[(start * 4) + 3] === 0) continue;
    componentCount += 1;
    let head = 0;
    let tail = 1;
    let minimumX = width;
    let minimumY = height;
    let maximumX = -1;
    let maximumY = -1;
    queue[0] = start;
    visited[start] = 1;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      for (const neighbor of [
        ...(y > 0 ? [pixel - width] : []),
        ...(x + 1 < width ? [pixel + 1] : []),
        ...(y + 1 < height ? [pixel + width] : []),
        ...(x > 0 ? [pixel - 1] : [])
      ]) {
        if (visited[neighbor] || data[(neighbor * 4) + 3] === 0) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }

    coveredPixels += tail;
    if (!largest || tail > largest.pixels.length) {
      largest = {
        pixels: Int32Array.from(queue.subarray(0, tail)),
        bounds: {
          x: minimumX,
          y: minimumY,
          width: maximumX - minimumX + 1,
          height: maximumY - minimumY + 1
        }
      };
    }
  }
  return { componentCount, coveredPixels, largest };
}

function assertUntruncated(bounds, width, height, label) {
  if (bounds.x === 0
    || bounds.y === 0
    || bounds.x + bounds.width === width
    || bounds.y + bounds.height === height) {
    throw new Error(
      `${label} largest alpha component touches the source border and is truncated`
    );
  }
}

function detachedPermille(detachedCoveredPixels, coveredPixels) {
  return detachedCoveredPixels === 0
    ? 0
    : Math.ceil((detachedCoveredPixels * 1000) / coveredPixels);
}

function assertBoundedScaleAnisotropy(
  sourceBounds,
  targetBox,
  maximumPermille,
  label
) {
  const scaleRatioProducts = [
    targetBox.width * sourceBounds.height,
    targetBox.height * sourceBounds.width
  ];
  const numerator = Math.max(...scaleRatioProducts);
  const denominator = Math.min(...scaleRatioProducts);
  if (numerator * 1000 <= denominator * maximumPermille) {
    return;
  }
  throw new Error(
    `${label} subject bounds ${sourceBounds.width}x${sourceBounds.height} `
    + `at (${sourceBounds.x},${sourceBounds.y}) require anisotropy `
    + `${(numerator / denominator).toFixed(6)} to fit targetBox `
    + `${targetBox.width}x${targetBox.height} at `
    + `(${targetBox.x},${targetBox.y}); maximum is `
    + `${(maximumPermille / 1000).toFixed(6)}`
  );
}

async function resizeRgba(data, source, target) {
  return sharp(data, {
    raw: {
      width: source.width,
      height: source.height,
      channels: 4
    }
  })
    .resize(target.width, target.height, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    })
    .raw()
    .toBuffer();
}

async function rgbaPng(data, canvas) {
  return sharp(data, {
    raw: {
      width: canvas.width,
      height: canvas.height,
      channels: 4
    }
  }).png({ compressionLevel: 9, palette: false }).toBuffer();
}

function assertDetachedCoverage({
  coveredPixels,
  selectedCoveredPixels,
  maximumPermille,
  label
}) {
  const detachedCoveredPixels = coveredPixels - selectedCoveredPixels;
  if (detachedCoveredPixels * 1000 > maximumPermille * coveredPixels) {
    throw new Error(
      `${label} detached alpha coverage is `
      + `${detachedPermille(detachedCoveredPixels, coveredPixels)}‰; expected `
      + `at most ${maximumPermille}‰`
    );
  }
  return detachedCoveredPixels;
}

function pointSegmentDistance(x, y, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  const projection = lengthSquared === 0
    ? 0
    : (((x - start.x) * dx) + ((y - start.y) * dy)) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));
  return {
    projection,
    distance: Math.hypot(
      x - (start.x + (clamped * dx)),
      y - (start.y + (clamped * dy))
    )
  };
}

function clearForbiddenCapabilityBands({
  data,
  canvas,
  topology,
  label
}) {
  if (!topology?.startsWith('tee-')) return 0;
  const allowed = new Set(routeDirections(topology));
  const top = { x: (canvas.width - 1) / 2, y: 0 };
  const right = {
    x: canvas.width - 1,
    y: (canvas.height - 1) / 2
  };
  const bottom = {
    x: (canvas.width - 1) / 2,
    y: canvas.height - 1
  };
  const left = { x: 0, y: (canvas.height - 1) / 2 };
  const segments = {
    n: [top, right],
    e: [right, bottom],
    s: [bottom, left],
    w: [left, top]
  };
  const bandWidth = Math.max(
    8,
    Math.ceil((((canvas.height - 1) / 2) * 0.15))
  );
  let coveredPixels = 0;
  let clearedPixels = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = ((y * canvas.width) + x) * 4;
      if (data[index + 3] === 0) continue;
      coveredPixels += 1;
      const forbidden = Object.entries(segments).some(
        ([direction, [start, end]]) => {
          if (allowed.has(direction)) return false;
          const { distance, projection } = pointSegmentDistance(
            x,
            y,
            start,
            end
          );
          return projection >= 0.15
            && projection <= 0.85
            && distance <= bandWidth;
        }
      );
      if (!forbidden) continue;
      data.fill(0, index, index + 4);
      clearedPixels += 1;
    }
  }
  if (
    clearedPixels * 1000
      > coveredPixels * FORBIDDEN_BAND_MAXIMUM_REMOVED_COVERED_PERMILLE
  ) {
    const removedPermille = Math.ceil(
      (clearedPixels * 1000) / coveredPixels
    );
    throw new Error(
      `${label} forbidden capability-band clipping would remove `
      + `${removedPermille}‰ of covered pixels; expected at most `
      + `${FORBIDDEN_BAND_MAXIMUM_REMOVED_COVERED_PERMILLE}‰`
    );
  }
  return clearedPixels;
}

async function finishAnchorScaleArtifact({
  sourceBytes,
  format,
  canonical,
  descriptor,
  profile,
  contract,
  label
}) {
  const canvasData = await resizeRgba(
    canonical.data,
    { width: canonical.width, height: canonical.height },
    contract.canvas
  );
  const normalizedCanvasBytes = await normalizeGeneratedRasterBytes({
    bytes: await rgbaPng(canvasData, contract.canvas),
    descriptor,
    profile,
    format: 'png',
    label: `${descriptor.id ?? 'route artifact'} normalized source raster`
  });
  const normalized = await sharp(normalizedCanvasBytes, {
    failOn: 'error',
    limitInputPixels: contract.canvas.width * contract.canvas.height
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const components = visibleComponents(
    normalized.data,
    normalized.info.width,
    normalized.info.height
  );
  if (!components.largest) {
    throw new Error(`${label} has no visible subject`);
  }
  assertDetachedCoverage({
    coveredPixels: components.coveredPixels,
    selectedCoveredPixels: components.largest.pixels.length,
    maximumPermille: contract.maximumDetachedCoveredPermille,
    label
  });

  const scaledCanvas = {
    width: Math.round(
      contract.canvas.width * contract.scalePermille / 1000
    ),
    height: Math.round(
      contract.canvas.height * contract.scalePermille / 1000
    )
  };
  const scaled = await resizeRgba(
    normalized.data,
    contract.canvas,
    scaledCanvas
  );
  const crop = {
    x: Math.round(
      contract.anchor.x * (contract.scalePermille - 1000) / 1000
    ),
    y: Math.round(
      contract.anchor.y * (contract.scalePermille - 1000) / 1000
    )
  };
  const cropped = Buffer.alloc(
    contract.canvas.width * contract.canvas.height * 4
  );
  const targetRowBytes = contract.canvas.width * 4;
  for (let y = 0; y < contract.canvas.height; y += 1) {
    const sourceStart = (
      ((crop.y + y) * scaledCanvas.width) + crop.x
    ) * 4;
    scaled.copy(
      cropped,
      y * targetRowBytes,
      sourceStart,
      sourceStart + targetRowBytes
    );
  }
  for (let y = 0; y < contract.canvas.height; y += 1) {
    for (let x = 0; x < contract.canvas.width; x += 1) {
      if (x >= CLEAR_BORDER_WIDTH
        && x < contract.canvas.width - CLEAR_BORDER_WIDTH
        && y >= CLEAR_BORDER_WIDTH
        && y < contract.canvas.height - CLEAR_BORDER_WIDTH) {
        continue;
      }
      cropped.fill(
        0,
        ((y * contract.canvas.width) + x) * 4,
        (((y * contract.canvas.width) + x) * 4) + 4
      );
    }
  }
  const forbiddenBandClearPixels = clearForbiddenCapabilityBands({
    data: cropped,
    canvas: contract.canvas,
    topology: descriptor.capabilities?.routeTopology,
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  const finishedBytes = await normalizeGeneratedRasterBytes({
    bytes: await rgbaPng(cropped, contract.canvas),
    descriptor,
    profile,
    format: 'png',
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });

  return {
    bytes: finishedBytes,
    derivation: {
      schemaVersion: ROUTE_FINISHING_SCHEMA,
      strategy: ANCHOR_SCALE_STRATEGY,
      source: {
        sha256: sha256(sourceBytes),
        bytes: sourceBytes.length,
        width: canonical.width,
        height: canonical.height,
        format
      },
      scalePermille: contract.scalePermille,
      anchor: { ...contract.anchor },
      borderClearPixels: CLEAR_BORDER_WIDTH,
      forbiddenBandClearPixels,
      kernel: 'lanczos3',
      finalSha256: sha256(finishedBytes)
    }
  };
}

function routeDirections(topology) {
  if (topology === 'cross') return ['n', 'e', 's', 'w'];
  if (topology === 'isolated') return [];
  if (typeof topology !== 'string' || !topology.includes('-')) return [];
  return [...topology.slice(topology.indexOf('-') + 1)];
}

function armSpanValidationPolicy(topology, configured) {
  if (!topology.startsWith('tee-')) {
    return {
      sampleFractions: ARM_SAMPLE_FRACTIONS,
      ...configured
    };
  }
  // A tee's half-run cross-section can still cut through its compact rounded
  // junction and another declared arm. Treating that composite run as arm
  // width produced false failures and eventually forced descriptors to carry
  // ineffective 100-pixel spread allowances. The 75% and seam-contact
  // sections are outside the junction and are the actual tiling contract.
  return {
    sampleFractions: TEE_OUTER_ARM_SAMPLE_FRACTIONS,
    alphaThreshold: configured.alphaThreshold,
    minimumPixels: configured.minimumPixels,
    maximumPixels: Math.min(
      configured.maximumPixels,
      TEE_OUTER_ARM_MAXIMUM_PIXELS
    ),
    maximumSpreadPixels: Math.min(
      configured.maximumSpreadPixels,
      TEE_OUTER_ARM_MAXIMUM_SPREAD_PIXELS
    )
  };
}

function perpendicularOpaqueSpan({
  data,
  width,
  height,
  sample,
  vector,
  alphaThreshold
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
      && data[(((y * width) + x) * 4) + 3] >= alphaThreshold;
    currentRun = opaque ? currentRun + 1 : 0;
    longestRun = Math.max(longestRun, currentRun);
  }
  return longestRun;
}

export async function validateFinishedRouteArtifact({
  bytes,
  descriptor,
  label = `${descriptor?.id ?? 'route artifact'} finished raster`
} = {}) {
  const contract = routeFinishingContract(descriptor);
  const topology = descriptor.capabilities?.routeTopology;
  const directions = routeDirections(topology);
  if (directions.length === 0) {
    throw new Error(`${label} has no measurable declared route arms`);
  }
  const decoded = await sharp(bytes, {
    failOn: 'error',
    limitInputPixels: contract.canvas.width * contract.canvas.height,
    sequentialRead: true
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== contract.canvas.width
    || decoded.info.height !== contract.canvas.height
    || decoded.info.channels !== 4
  ) {
    throw new Error(`${label} does not match its declared RGBA canvas`);
  }
  const { data } = decoded;
  for (let y = 0; y < contract.canvas.height; y += 1) {
    for (let x = 0; x < contract.canvas.width; x += 1) {
      if (
        x >= CLEAR_BORDER_WIDTH
        && x < contract.canvas.width - CLEAR_BORDER_WIDTH
        && y >= CLEAR_BORDER_WIDTH
        && y < contract.canvas.height - CLEAR_BORDER_WIDTH
      ) {
        continue;
      }
      if (data[(((y * contract.canvas.width) + x) * 4) + 3] !== 0) {
        throw new Error(
          `${label} outermost ${CLEAR_BORDER_WIDTH}-pixel canvas border must `
          + `be fully transparent; found nontransparent pixel at ${x},${y}`
        );
      }
    }
  }
  const anchor = descriptor.placement?.anchor;
  if (!Number.isSafeInteger(anchor?.x)
    || !Number.isSafeInteger(anchor?.y)
    || anchor.x < 0
    || anchor.x >= contract.canvas.width
    || anchor.y < 0
    || anchor.y >= contract.canvas.height) {
    throw new Error(`${label} has an invalid declared route anchor`);
  }
  const vectors = {
    n: {
      x: contract.canvas.width / 4,
      y: -contract.canvas.height / 4
    },
    e: {
      x: contract.canvas.width / 4,
      y: contract.canvas.height / 4
    },
    s: {
      x: -contract.canvas.width / 4,
      y: contract.canvas.height / 4
    },
    w: {
      x: -contract.canvas.width / 4,
      y: -contract.canvas.height / 4
    }
  };
  const armSpanPolicy = armSpanValidationPolicy(
    topology,
    contract.armAlphaSpan
  );
  const samples = [];
  for (const direction of directions) {
    const vector = vectors[direction];
    for (const fraction of armSpanPolicy.sampleFractions) {
      samples.push({
        direction,
        percent: Math.round(fraction * 100),
        span: perpendicularOpaqueSpan({
          data,
          width: contract.canvas.width,
          height: contract.canvas.height,
          sample: {
            x: anchor.x + (vector.x * fraction),
            y: anchor.y + (vector.y * fraction)
          },
          vector,
          alphaThreshold: armSpanPolicy.alphaThreshold
        })
      });
    }
  }
  const narrowSamples = samples.filter(
    sample => sample.span < armSpanPolicy.minimumPixels
  );
  const wideSamples = samples.filter(
    sample => sample.span > armSpanPolicy.maximumPixels
  );
  const spans = samples.map(sample => sample.span);
  const minimumSpan = Math.min(...spans);
  const maximumSpan = Math.max(...spans);
  const spread = maximumSpan - minimumSpan;
  const spreadFailed =
    spread > armSpanPolicy.maximumSpreadPixels;
  if (narrowSamples.length > 0 || wideSamples.length > 0 || spreadFailed) {
    const narrow = narrowSamples[0];
    const wide = wideSamples[0];
    const primary = narrow
        ? `${label} route ${topology} ${narrow.direction} arm opaque `
        + `perpendicular span at ${narrow.percent}% is ${narrow.span} pixels; `
        + `expected at least ${armSpanPolicy.minimumPixels}`
      : wide
        ? `${label} route ${topology} ${wide.direction} arm opaque `
          + `perpendicular span at ${wide.percent}% is ${wide.span} pixels; `
          + `expected at most ${armSpanPolicy.maximumPixels}`
        : `${label} route ${topology} arm opaque perpendicular spans vary by `
          + `${spread} pixels (${minimumSpan}..${maximumSpan}); expected at `
          + `most ${armSpanPolicy.maximumSpreadPixels}`;
    const sampleList = samples.map(
      sample => `${sample.direction}${sample.percent}=${sample.span}`
    ).join(',');
    const violatingSamples = samples
      .filter(sample => (
        sample.span < armSpanPolicy.minimumPixels
        || sample.span > armSpanPolicy.maximumPixels
      ))
      .map(sample => (
        sample.span < armSpanPolicy.minimumPixels
          ? `${sample.direction}${sample.percent}=${sample.span} `
            + `(<${armSpanPolicy.minimumPixels})`
          : `${sample.direction}${sample.percent}=${sample.span} `
            + `(>${armSpanPolicy.maximumPixels})`
      ))
      .join(',');
    const violatingRange = spreadFailed
      ? `${minimumSpan}..${maximumSpan} (spread ${spread} > `
        + `${armSpanPolicy.maximumSpreadPixels})`
      : `none (observed ${minimumSpan}..${maximumSpan}, spread ${spread})`;
    throw new Error(
      `${primary}; samples: ${sampleList}; allowed: `
      + `${armSpanPolicy.minimumPixels}..`
      + `${armSpanPolicy.maximumPixels} pixels at alpha >= `
      + `${armSpanPolicy.alphaThreshold}, maximum spread `
      + `${armSpanPolicy.maximumSpreadPixels} pixels; violating `
      + `samples: ${violatingSamples || 'none'}; violating range: `
      + violatingRange
    );
  }
  let coveredPixels = 0;
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    if (data[pixel + 3] !== 0) coveredPixels += 1;
  }
  const totalPixels = contract.canvas.width * contract.canvas.height;
  const coveragePermille = Math.floor((coveredPixels * 1000) / totalPixels);
  if (
    topology.startsWith('straight-')
    && coveredPixels * 1000
      > STRAIGHT_MAXIMUM_COVERAGE_PERMILLE * totalPixels
  ) {
    throw new Error(
      `${label} straight route ${topology} alpha coverage is `
      + `${coveragePermille}‰; expected at most `
      + `${STRAIGHT_MAXIMUM_COVERAGE_PERMILLE}‰`
    );
  }
  return {
    samples,
    coveredPixels,
    totalPixels,
    coveragePermille
  };
}

/**
 * Deterministically finishes a generated route subject with the single
 * descriptor-prescribed component-box transform.
 */
export async function finishRouteArtifact({ bytes, descriptor, profile } = {}) {
  const contract = routeFinishingContract(descriptor);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error('route artifact source bytes must be nonempty');
  }
  const sourceBytes = Buffer.from(bytes);
  const format = sourceFormat(sourceBytes);
  const label = `${descriptor.id ?? 'route artifact'} source`;
  const sourceMetadata = await sharp(sourceBytes, {
    failOn: 'error',
    limitInputPixels: ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS
  }).metadata();
  assertRouteSourceExtent(sourceMetadata.width, sourceMetadata.height);
  if (
    sourceMetadata.width * contract.canvas.height
      !== sourceMetadata.height * contract.canvas.width
  ) {
    throw new Error(
      `${label} aspect ratio ${sourceMetadata.width}:`
      + `${sourceMetadata.height} does not match declared route canvas `
      + `${contract.canvas.width}:${contract.canvas.height}`
    );
  }
  const canonical = await decodeCanonicalRaster(
    sourceBytes,
    profile,
    label,
    {
      chromaRemovalMultiplier: 3,
      limitInputPixels: ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS
    }
  );
  assertRouteSourceExtent(canonical.width, canonical.height);
  if (
    canonical.width * contract.canvas.height
      !== canonical.height * contract.canvas.width
  ) {
    throw new Error(
      `${label} aspect ratio ${canonical.width}:${canonical.height} does not `
      + `match declared route canvas ${contract.canvas.width}:`
      + `${contract.canvas.height}`
    );
  }

  if (contract.strategy === ANCHOR_SCALE_STRATEGY) {
    return finishAnchorScaleArtifact({
      sourceBytes,
      format,
      canonical,
      descriptor,
      profile,
      contract,
      label
    });
  }

  const {
    componentCount,
    coveredPixels,
    largest
  } = visibleComponents(canonical.data, canonical.width, canonical.height);
  if (!largest) {
    throw new Error(`${label} has no visible subject`);
  }
  assertUntruncated(
    largest.bounds,
    canonical.width,
    canonical.height,
    label
  );
  assertBoundedScaleAnisotropy(
    largest.bounds,
    contract.targetBox,
    contract.maximumScaleAnisotropyPermille,
    label
  );

  const detachedCoveredPixels = assertDetachedCoverage({
    coveredPixels,
    selectedCoveredPixels: largest.pixels.length,
    maximumPermille: contract.maximumDetachedCoveredPermille,
    label
  });

  const selected = Buffer.alloc(canonical.data.length);
  for (const pixel of largest.pixels) {
    canonical.data.copy(selected, pixel * 4, pixel * 4, (pixel * 4) + 4);
  }
  const resized = await resizeRgba(
    await sharp(selected, {
      raw: {
        width: canonical.width,
        height: canonical.height,
        channels: 4
      }
    })
    .extract({
      left: largest.bounds.x,
      top: largest.bounds.y,
      width: largest.bounds.width,
      height: largest.bounds.height
    })
    .raw()
    .toBuffer(),
    { width: largest.bounds.width, height: largest.bounds.height },
    { width: contract.targetBox.width, height: contract.targetBox.height }
  );

  const canvas = Buffer.alloc(
    contract.canvas.width * contract.canvas.height * 4
  );
  const targetRowBytes = contract.targetBox.width * 4;
  for (let y = 0; y < contract.targetBox.height; y += 1) {
    const sourceStart = y * targetRowBytes;
    const targetStart = (
      ((contract.targetBox.y + y) * contract.canvas.width)
      + contract.targetBox.x
    ) * 4;
    resized.copy(
      canvas,
      targetStart,
      sourceStart,
      sourceStart + targetRowBytes
    );
  }

  const preparedBytes = await sharp(canvas, {
    raw: {
      width: contract.canvas.width,
      height: contract.canvas.height,
      channels: 4
    }
  }).png({ compressionLevel: 9, palette: false }).toBuffer();
  const normalizedBytes = await normalizeGeneratedRasterBytes({
    bytes: preparedBytes,
    descriptor,
    profile,
    format: 'png',
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  const clipped = await clipStraightRouteTerminalOverflow({
    bytes: normalizedBytes,
    descriptor,
    contract
  });
  const finishedBytes = clipped.bytes;
  const sourceBounds = { ...largest.bounds };

  return {
    bytes: finishedBytes,
    derivation: {
      schemaVersion: ROUTE_FINISHING_SCHEMA,
      strategy: LARGEST_COMPONENT_BOX_STRATEGY,
      source: {
        sha256: sha256(sourceBytes),
        bytes: sourceBytes.length,
        width: canonical.width,
        height: canonical.height,
        format
      },
      sourceBounds,
      componentCount,
      coveredPixels,
      selectedCoveredPixels: largest.pixels.length,
      detachedCoveredPixels,
      detachedCoveredPermille: detachedPermille(
        detachedCoveredPixels,
        coveredPixels
      ),
      maximumDetachedCoveredPermille:
        contract.maximumDetachedCoveredPermille,
      ...(clipped.derivation === null
        ? {}
        : { terminalClip: clipped.derivation }),
      targetBox: { ...contract.targetBox },
      scaleX: {
        numerator: contract.targetBox.width,
        denominator: sourceBounds.width
      },
      scaleY: {
        numerator: contract.targetBox.height,
        denominator: sourceBounds.height
      },
      kernel: 'lanczos3',
      finalSha256: sha256(finishedBytes)
    }
  };
}
