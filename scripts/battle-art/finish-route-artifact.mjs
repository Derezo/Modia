import { createHash } from 'node:crypto';

import sharp from 'sharp';

import {
  decodeCanonicalRaster,
  normalizeGeneratedRasterBytes
} from './raster-contract.mjs';

const ROUTE_FINISHING_SCHEMA = 'battle-art-route-finishing-v1';
const ROUTE_FINISHING_STRATEGY = 'largest-component-box-v1';
const MAXIMUM_DIMENSION = 4096;
export const ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS = 4 * 1024 * 1024;
const MAXIMUM_DETACHED_COVERED_PERMILLE = 150;
const CLEAR_BORDER_WIDTH = 4;
const STRAIGHT_MAXIMUM_COVERAGE_PERMILLE = 300;
const ARM_SAMPLE_FRACTIONS = Object.freeze([0.5, 0.75, 1]);
// Permit modest subject-box variation without allowing the finisher to reshape
// route art. The exact 5:4 comparison is integer-only at the acceptance edge.
const MAXIMUM_SCALE_ANISOTROPY_NUMERATOR = 5;
const MAXIMUM_SCALE_ANISOTROPY_DENOMINATOR = 4;

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
  if (finishing.strategy !== ROUTE_FINISHING_STRATEGY) {
    throw new Error(
      `descriptor.routeFinishing.strategy must be ${ROUTE_FINISHING_STRATEGY}`
    );
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
  return {
    canvas: { width, height },
    targetBox: {
      x: targetBox.x,
      y: targetBox.y,
      width: targetBox.width,
      height: targetBox.height
    },
    maximumDetachedCoveredPermille,
    armAlphaSpan: {
      alphaThreshold: armAlphaSpan.alphaThreshold,
      minimumPixels: armAlphaSpan.minimumPixels,
      maximumPixels: armAlphaSpan.maximumPixels,
      maximumSpreadPixels: armAlphaSpan.maximumSpreadPixels
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

function assertBoundedScaleAnisotropy(sourceBounds, targetBox, label) {
  const scaleRatioProducts = [
    targetBox.width * sourceBounds.height,
    targetBox.height * sourceBounds.width
  ];
  const numerator = Math.max(...scaleRatioProducts);
  const denominator = Math.min(...scaleRatioProducts);
  if (numerator * MAXIMUM_SCALE_ANISOTROPY_DENOMINATOR
    <= denominator * MAXIMUM_SCALE_ANISOTROPY_NUMERATOR) {
    return;
  }
  throw new Error(
    `${label} subject bounds ${sourceBounds.width}x${sourceBounds.height} `
    + `at (${sourceBounds.x},${sourceBounds.y}) require anisotropy `
    + `${(numerator / denominator).toFixed(6)} to fit targetBox `
    + `${targetBox.width}x${targetBox.height} at `
    + `(${targetBox.x},${targetBox.y}); maximum is 1.250000`
  );
}

function routeDirections(topology) {
  if (topology === 'cross') return ['n', 'e', 's', 'w'];
  if (topology === 'isolated') return [];
  if (typeof topology !== 'string' || !topology.includes('-')) return [];
  return [...topology.slice(topology.indexOf('-') + 1)];
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
  const samples = [];
  for (const direction of directions) {
    const vector = vectors[direction];
    for (const fraction of ARM_SAMPLE_FRACTIONS) {
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
          alphaThreshold: contract.armAlphaSpan.alphaThreshold
        })
      });
    }
  }
  const narrowSamples = samples.filter(
    sample => sample.span < contract.armAlphaSpan.minimumPixels
  );
  const wideSamples = samples.filter(
    sample => sample.span > contract.armAlphaSpan.maximumPixels
  );
  const spans = samples.map(sample => sample.span);
  const minimumSpan = Math.min(...spans);
  const maximumSpan = Math.max(...spans);
  const spread = maximumSpan - minimumSpan;
  const spreadFailed =
    spread > contract.armAlphaSpan.maximumSpreadPixels;
  if (narrowSamples.length > 0 || wideSamples.length > 0 || spreadFailed) {
    const narrow = narrowSamples[0];
    const wide = wideSamples[0];
    const primary = narrow
      ? `${label} route ${topology} ${narrow.direction} arm opaque `
        + `perpendicular span at ${narrow.percent}% is ${narrow.span} pixels; `
        + `expected at least ${contract.armAlphaSpan.minimumPixels}`
      : wide
        ? `${label} route ${topology} ${wide.direction} arm opaque `
          + `perpendicular span at ${wide.percent}% is ${wide.span} pixels; `
          + `expected at most ${contract.armAlphaSpan.maximumPixels}`
        : `${label} route ${topology} arm opaque perpendicular spans vary by `
          + `${spread} pixels (${minimumSpan}..${maximumSpan}); expected at `
          + `most ${contract.armAlphaSpan.maximumSpreadPixels}`;
    const sampleList = samples.map(
      sample => `${sample.direction}${sample.percent}=${sample.span}`
    ).join(',');
    const violatingSamples = samples
      .filter(sample => (
        sample.span < contract.armAlphaSpan.minimumPixels
        || sample.span > contract.armAlphaSpan.maximumPixels
      ))
      .map(sample => (
        sample.span < contract.armAlphaSpan.minimumPixels
          ? `${sample.direction}${sample.percent}=${sample.span} `
            + `(<${contract.armAlphaSpan.minimumPixels})`
          : `${sample.direction}${sample.percent}=${sample.span} `
            + `(>${contract.armAlphaSpan.maximumPixels})`
      ))
      .join(',');
    const violatingRange = spreadFailed
      ? `${minimumSpan}..${maximumSpan} (spread ${spread} > `
        + `${contract.armAlphaSpan.maximumSpreadPixels})`
      : `none (observed ${minimumSpan}..${maximumSpan}, spread ${spread})`;
    throw new Error(
      `${primary}; samples: ${sampleList}; allowed: `
      + `${contract.armAlphaSpan.minimumPixels}..`
      + `${contract.armAlphaSpan.maximumPixels} pixels at alpha >= `
      + `${contract.armAlphaSpan.alphaThreshold}, maximum spread `
      + `${contract.armAlphaSpan.maximumSpreadPixels} pixels; violating `
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
  assertBoundedScaleAnisotropy(largest.bounds, contract.targetBox, label);

  const detachedCoveredPixels = coveredPixels - largest.pixels.length;
  if (detachedCoveredPixels * 1000
    > contract.maximumDetachedCoveredPermille * coveredPixels) {
    throw new Error(
      `${label} detached alpha coverage is `
      + `${detachedPermille(detachedCoveredPixels, coveredPixels)}‰; expected `
      + `at most ${contract.maximumDetachedCoveredPermille}‰`
    );
  }

  const selected = Buffer.alloc(canonical.data.length);
  for (const pixel of largest.pixels) {
    canonical.data.copy(selected, pixel * 4, pixel * 4, (pixel * 4) + 4);
  }
  const resized = await sharp(selected, {
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
    .resize(contract.targetBox.width, contract.targetBox.height, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    })
    .raw()
    .toBuffer();

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
  const finishedBytes = await normalizeGeneratedRasterBytes({
    bytes: preparedBytes,
    descriptor,
    profile,
    format: 'png',
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  const sourceBounds = { ...largest.bounds };

  return {
    bytes: finishedBytes,
    derivation: {
      schemaVersion: ROUTE_FINISHING_SCHEMA,
      strategy: ROUTE_FINISHING_STRATEGY,
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
