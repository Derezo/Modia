import sharp from 'sharp';

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const EXTERIOR_DESPILL_PASSES = 16;
const EXTERIOR_DESPILL_MIN_RADIUS = 2;
const EXTERIOR_DESPILL_MAX_RADIUS = 3;
const STRONG_CHROMA_CHANNEL_DELTA = 24;
// Alpha 1–8 pixels are generation residue rather than useful antialiasing at
// runtime scale. Cutout normalization clears their entire RGBA payload.
const TRANSPARENT_CUTOUT_NOISE_ALPHA_MAX = 8;
// Generated contract rasters are normalized before publication. Permit only a
// source-scale three-pixel residue after the bounded frontier pass; this is
// subpixel at runtime scale while still rejecting a visible matte fringe.
const MAX_RESIDUAL_EXTERIOR_CHROMA_PIXELS = 3;

function chromaRgb(profile) {
  const value = profile?.background?.chroma;
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new Error('battle-art chroma color must be lowercase #rrggbb');
  }
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16)
  };
}

function chromaDistance(data, index, chroma) {
  return Math.max(
    Math.abs(data[index] - chroma.r),
    Math.abs(data[index + 1] - chroma.g),
    Math.abs(data[index + 2] - chroma.b)
  );
}

function isStrongMagentaChroma(data, index, chroma, tolerance) {
  return data[index + 3] > 0
    && chromaDistance(data, index, chroma) > tolerance * 3
    && data[index] - data[index + 1] >= STRONG_CHROMA_CHANNEL_DELTA
    && data[index + 2] - data[index + 1] >= STRONG_CHROMA_CHANNEL_DELTA;
}

function adjacentExteriorOffsets(exterior, width, height, x, y) {
  const offsets = [];
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (nextX < 0
        || nextX >= width
        || nextY < 0
        || nextY >= height
        || exterior[(nextY * width) + nextX]) {
        offsets.push({ x: offsetX, y: offsetY });
      }
    }
  }
  return offsets;
}

function exteriorMask(data, width, height) {
  const exterior = new Uint8Array(width * height);
  for (let pixel = 0; pixel < exterior.length; pixel += 1) {
    exterior[pixel] = data[(pixel * 4) + 3] === 0 ? 1 : 0;
  }
  return exterior;
}

function countResidualExteriorChroma(
  data,
  width,
  height,
  chroma,
  tolerance
) {
  const exterior = exteriorMask(data, width, height);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      if (isStrongMagentaChroma(data, index, chroma, tolerance)
        && adjacentExteriorOffsets(exterior, width, height, x, y).length > 0) {
        count += 1;
      }
    }
  }
  return count;
}

export async function decodeCanonicalRaster(
  bytes,
  profile,
  label = 'battle-art raster',
  {
    chromaRemovalMultiplier = 1,
    limitInputPixels
  } = {}
) {
  if (
    limitInputPixels !== undefined
    && (!Number.isSafeInteger(limitInputPixels) || limitInputPixels < 1)
  ) {
    throw new Error(`${label} input-pixel limit is invalid`);
  }
  const { data, info } = await sharp(bytes, {
    failOn: 'error',
    ...(limitInputPixels === undefined ? {} : { limitInputPixels })
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4
    || !Number.isSafeInteger(info.width)
    || !Number.isSafeInteger(info.height)) {
    throw new Error(`${label} did not normalize to a bounded RGBA raster`);
  }
  const chroma = chromaRgb(profile);
  const tolerance = profile.background.tolerance;
  let nearChromaSpillPixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    const distance = chromaDistance(data, index, chroma);
    if (data[index + 3] > 0
      && distance > tolerance
      && distance <= tolerance * 3) {
      nearChromaSpillPixels += 1;
    }
    if (
      data[index + 3] === 0
      || distance <= tolerance * chromaRemovalMultiplier
    ) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
    }
  }
  return {
    data,
    width: info.width,
    height: info.height,
    nearChromaSpillPixels,
    residualExteriorChromaPixels: countResidualExteriorChroma(
      data,
      info.width,
      info.height,
      chroma,
      tolerance
    )
  };
}

function median(values) {
  values.sort((first, second) => first - second);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]
    : Math.round((values[middle - 1] + values[middle]) / 2);
}

function inwardDonorColor({
  data,
  exterior,
  width,
  height,
  x,
  y,
  outward,
  chroma,
  tolerance
}) {
  if (outward.x === 0 && outward.y === 0) return null;
  const donors = [];
  for (let offsetY = -EXTERIOR_DESPILL_MAX_RADIUS;
    offsetY <= EXTERIOR_DESPILL_MAX_RADIUS;
    offsetY += 1) {
    for (let offsetX = -EXTERIOR_DESPILL_MAX_RADIUS;
      offsetX <= EXTERIOR_DESPILL_MAX_RADIUS;
      offsetX += 1) {
      const radius = Math.max(Math.abs(offsetX), Math.abs(offsetY));
      if (radius < EXTERIOR_DESPILL_MIN_RADIUS
        || radius > EXTERIOR_DESPILL_MAX_RADIUS
        || (offsetX * outward.x) + (offsetY * outward.y) >= 0) {
        continue;
      }
      const donorX = x + offsetX;
      const donorY = y + offsetY;
      if (donorX < 0
        || donorX >= width
        || donorY < 0
        || donorY >= height) {
        continue;
      }
      const donorPixel = (donorY * width) + donorX;
      const donorIndex = donorPixel * 4;
      if (exterior[donorPixel]
        || data[donorIndex + 3] === 0
        || isStrongMagentaChroma(data, donorIndex, chroma, tolerance)) {
        continue;
      }
      donors.push([
        data[donorIndex],
        data[donorIndex + 1],
        data[donorIndex + 2]
      ]);
    }
  }
  if (donors.length === 0) return null;
  return [0, 1, 2].map(channel => median(
    donors.map(color => color[channel])
  ));
}

function despillExteriorChroma(canonical, profile) {
  const { data, width, height } = canonical;
  const chroma = chromaRgb(profile);
  const tolerance = profile.background.tolerance;
  // This logical exterior frontier advances through recolored pixels as well
  // as cleared pixels, allowing up to sixteen bounded snapshot layers to be treated
  // while the authored alpha silhouette remains stable whenever donors exist.
  const exterior = exteriorMask(data, width, height);
  for (let pass = 0; pass < EXTERIOR_DESPILL_PASSES; pass += 1) {
    const snapshot = Buffer.from(data);
    const candidates = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width) + x;
        const index = pixel * 4;
        if (!isStrongMagentaChroma(snapshot, index, chroma, tolerance)) {
          continue;
        }
        const exteriorOffsets = adjacentExteriorOffsets(
          exterior,
          width,
          height,
          x,
          y
        );
        if (exteriorOffsets.length === 0) continue;
        const outward = exteriorOffsets.reduce(
          (total, offset) => ({
            x: total.x + offset.x,
            y: total.y + offset.y
          }),
          { x: 0, y: 0 }
        );
        candidates.push({ pixel, index, x, y, outward });
      }
    }
    if (candidates.length === 0) break;
    const next = Buffer.from(snapshot);
    for (const candidate of candidates) {
      const color = inwardDonorColor({
        data: snapshot,
        exterior,
        width,
        height,
        x: candidate.x,
        y: candidate.y,
        outward: candidate.outward,
        chroma,
        tolerance
      });
      if (color) {
        next[candidate.index] = color[0];
        next[candidate.index + 1] = color[1];
        next[candidate.index + 2] = color[2];
      } else {
        next.fill(0, candidate.index, candidate.index + 4);
      }
      exterior[candidate.pixel] = 1;
    }
    next.copy(data);
  }
  canonical.residualExteriorChromaPixels = countResidualExteriorChroma(
    data,
    width,
    height,
    chroma,
    tolerance
  );
}

function clearLowAlphaCutoutNoise(canonical) {
  const { data } = canonical;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > TRANSPARENT_CUTOUT_NOISE_ALPHA_MAX) continue;
    data.fill(0, index, index + 4);
  }
}

function fillTransparentDiamondPixels(canonical, label) {
  const { data, width, height } = canonical;
  const owners = new Int32Array(width * height);
  owners.fill(-1);
  const queue = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!insideDiamond(x, y, width, height)) continue;
      const pixel = (y * width) + x;
      if (data[(pixel * 4) + 3] > 0) {
        owners[pixel] = pixel;
        queue.push(pixel);
      }
    }
  }
  if (queue.length === 0) {
    throw new Error(`${label} has no visible diamond pixels to extend`);
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const x = current % width;
    const y = Math.floor(current / width);
    for (const neighbor of [
      ...(y > 0 ? [current - width] : []),
      ...(x + 1 < width ? [current + 1] : []),
      ...(y + 1 < height ? [current + width] : []),
      ...(x > 0 ? [current - 1] : [])
    ]) {
      if (owners[neighbor] !== -1) continue;
      const neighborX = neighbor % width;
      const neighborY = Math.floor(neighbor / width);
      if (!insideDiamond(neighborX, neighborY, width, height)) continue;
      owners[neighbor] = owners[current];
      queue.push(neighbor);
    }
  }
  for (let pixel = 0; pixel < owners.length; pixel += 1) {
    if (owners[pixel] === -1 || data[(pixel * 4) + 3] > 0) continue;
    const source = owners[pixel] * 4;
    const destination = pixel * 4;
    data[destination] = data[source];
    data[destination + 1] = data[source + 1];
    data[destination + 2] = data[source + 2];
    data[destination + 3] = 255;
  }
}

/**
 * Deterministic post-generation finishing is part of the npm lifecycle, not a
 * second image-generation step. It removes bounded chroma-key antialias spill
 * and applies the exact full-diamond/seam preparation required of surfaces.
 * Transparent semantic cutouts keep their authored silhouette unchanged.
 */
export async function normalizeGeneratedRasterBytes({
  bytes,
  descriptor,
  profile,
  format,
  label = `${descriptor.id} generated raster`
}) {
  if (!['png', 'webp'].includes(format)) {
    throw new Error(`${label} must use PNG or WebP`);
  }
  const canonical = await decodeCanonicalRaster(bytes, profile, label, {
    chromaRemovalMultiplier: 3
  });
  if (
    canonical.width !== descriptor.canvas.width
    || canonical.height !== descriptor.canvas.height
  ) {
    throw new Error(
      `${label} dimensions ${canonical.width}x${canonical.height} do not match `
      + `declared canvas ${descriptor.canvas.width}x${descriptor.canvas.height}`
    );
  }
  const rasterKind = descriptor.rasterContract?.kind;
  if (['transparent-cutout', 'opaque-tile-diamond'].includes(rasterKind)) {
    despillExteriorChroma(canonical, profile);
  }
  if (rasterKind === 'transparent-cutout') {
    clearLowAlphaCutoutNoise(canonical);
    canonical.residualExteriorChromaPixels = countResidualExteriorChroma(
      canonical.data,
      canonical.width,
      canonical.height,
      chromaRgb(profile),
      profile.background.tolerance
    );
  }
  if (rasterKind === 'opaque-tile-diamond') {
    fillTransparentDiamondPixels(canonical, label);
  }
  const prepared = prepareRuntimeRaster(canonical, descriptor);
  const pipeline = sharp(prepared.data, {
    raw: {
      width: prepared.width,
      height: prepared.height,
      channels: 4
    }
  });
  return format === 'webp'
    ? pipeline.webp({ lossless: true, effort: 6 }).toBuffer()
    : pipeline.png({ compressionLevel: 9, palette: false }).toBuffer();
}

function insideDiamond(x, y, width, height) {
  return (
    Math.abs(x - ((width - 1) / 2)) / (width / 2)
    + Math.abs(y - ((height - 1) / 2)) / (height / 2)
  ) <= 1;
}

function diamondRowBounds(y, width, height) {
  let minimum = null;
  let maximum = null;
  for (let x = 0; x < width; x += 1) {
    if (!insideDiamond(x, y, width, height)) continue;
    if (minimum === null) minimum = x;
    maximum = x;
  }
  return minimum === null ? null : { minimum, maximum };
}

const ISOMETRIC_DIRECTIONS = Object.freeze(['n', 'e', 's', 'w']);
function capabilityDiamond(descriptor, width, height) {
  if (descriptor.category === 'route-transition') {
    return {
      top: { x: (width - 1) / 2, y: 0 },
      right: { x: width - 1, y: (height - 1) / 2 },
      bottom: { x: (width - 1) / 2, y: height - 1 },
      left: { x: 0, y: (height - 1) / 2 },
      verticalRadius: (height - 1) / 2
    };
  }
  const anchor = descriptor.placement.anchor;
  const verticalRadius = Math.min(
    width / 4,
    anchor.x / 2,
    (width - 1 - anchor.x) / 2,
    anchor.y,
    height - 1 - anchor.y
  );
  const horizontalRadius = verticalRadius * 2;
  return {
    top: { x: anchor.x, y: anchor.y - verticalRadius },
    right: { x: anchor.x + horizontalRadius, y: anchor.y },
    bottom: { x: anchor.x, y: anchor.y + verticalRadius },
    left: { x: anchor.x - horizontalRadius, y: anchor.y },
    verticalRadius
  };
}

function pointSegmentDistance(x, y, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  const projection = lengthSquared === 0
    ? 0
    : (((x - start.x) * dx) + ((y - start.y) * dy)) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return {
    distance: Math.hypot(
      x - (start.x + (t * dx)),
      y - (start.y + (t * dy))
    ),
    projection
  };
}

function visibleDiamondEndpointBands(data, width, height, descriptor) {
  const diamond = capabilityDiamond(descriptor, width, height);
  const segments = {
    n: [diamond.top, diamond.right],
    e: [diamond.right, diamond.bottom],
    s: [diamond.bottom, diamond.left],
    w: [diamond.left, diamond.top]
  };
  const bandWidth = Math.max(4, Math.ceil(diamond.verticalRadius * 0.1));
  const minimumBandPixels = Math.max(6, Math.ceil(bandWidth * 1.5));
  const counts = Object.fromEntries(
    ISOMETRIC_DIRECTIONS.map(direction => [direction, 0])
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[((y * width) + x) * 4 + 3] === 0) continue;
      for (const direction of ISOMETRIC_DIRECTIONS) {
        const [start, end] = segments[direction];
        const { distance, projection } = pointSegmentDistance(
          x,
          y,
          start,
          end
        );
        if (projection >= 0.15
          && projection <= 0.85
          && distance <= bandWidth) {
          counts[direction] += 1;
        }
      }
    }
  }
  return new Set(
    ISOMETRIC_DIRECTIONS.filter(
      direction => counts[direction] >= minimumBandPixels
    )
  );
}

function largestMeaningfulAlphaComponent(
  data,
  width,
  height,
  alphaThreshold = 64
) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let largest = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || data[(start * 4) + 3] < alphaThreshold) continue;
    visited[start] = 1;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    const component = [];
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            continue;
          }
          const next = (nextY * width) + nextX;
          if (visited[next] || data[(next * 4) + 3] < alphaThreshold) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const mask = new Uint8Array(pixelCount);
  for (const index of largest) mask[index] = 1;
  return mask;
}

function visibleBoundaryGroundBands(data, width, height, descriptor) {
  const diamond = capabilityDiamond(descriptor, width, height);
  const segments = {
    n: [diamond.top, diamond.right],
    e: [diamond.right, diamond.bottom],
    s: [diamond.bottom, diamond.left],
    w: [diamond.left, diamond.top]
  };
  const component = largestMeaningfulAlphaComponent(data, width, height);
  const groundEnvelope = new Uint8Array(width * height);
  const envelopeDepth = Math.max(6, Math.ceil(diamond.verticalRadius * 0.125));
  for (let x = 0; x < width; x += 1) {
    let bottom = -1;
    for (let y = height - 1; y >= 0; y -= 1) {
      if (component[(y * width) + x]) {
        bottom = y;
        break;
      }
    }
    if (bottom === -1) continue;
    for (let y = Math.max(0, bottom - envelopeDepth); y <= bottom; y += 1) {
      const index = (y * width) + x;
      if (component[index]) groundEnvelope[index] = 1;
    }
  }
  const bandWidth = Math.max(8, Math.ceil(diamond.verticalRadius * 0.15));
  const minimumBandPixels = Math.max(
    16,
    Math.ceil(diamond.verticalRadius * 0.35)
  );
  const counts = Object.fromEntries(
    ISOMETRIC_DIRECTIONS.map(direction => [direction, 0])
  );
  const projectionBins = Object.fromEntries(
    ISOMETRIC_DIRECTIONS.map(direction => [direction, new Set()])
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!groundEnvelope[(y * width) + x]) continue;
      for (const direction of ISOMETRIC_DIRECTIONS) {
        const [start, end] = segments[direction];
        const { distance, projection } = pointSegmentDistance(
          x,
          y,
          start,
          end
        );
        if (projection >= 0.15
          && projection <= 0.85
          && distance <= bandWidth) {
          counts[direction] += 1;
          projectionBins[direction].add(Math.min(
            3,
            Math.floor(((projection - 0.15) / 0.7) * 4)
          ));
        }
      }
    }
  }
  return new Set(
    ISOMETRIC_DIRECTIONS.filter(direction => (
      counts[direction] >= minimumBandPixels
      && projectionBins[direction].size >= 3
    ))
  );
}

function visibleConnectionHighEndpoints(data, width, height, descriptor) {
  const { anchor } = descriptor.placement;
  const vectors = {
    n: { x: 128, y: -64 },
    e: { x: 128, y: 64 },
    s: { x: -128, y: 64 },
    w: { x: -128, y: -64 }
  };
  const bandWidth = Math.max(8, Math.ceil(Math.min(width, height) * 0.05));
  const minimumBandPixels = Math.max(8, bandWidth);
  const counts = Object.fromEntries(
    ISOMETRIC_DIRECTIONS.map(direction => [direction, 0])
  );
  for (const direction of ISOMETRIC_DIRECTIONS) {
    const vector = vectors[direction];
    const target = {
      x: Math.max(0, Math.min(width - 1, anchor.x + vector.x)),
      y: Math.max(0, Math.min(height - 1, anchor.y + vector.y))
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[((y * width) + x) * 4 + 3] === 0) continue;
        const { distance, projection } = pointSegmentDistance(
          x,
          y,
          anchor,
          target
        );
        if (projection >= 0.72
          && projection <= 1.05
          && distance <= bandWidth) {
          counts[direction] += 1;
        }
      }
    }
  }
  return new Set(
    ISOMETRIC_DIRECTIONS.filter(
      direction => counts[direction] >= minimumBandPixels
    )
  );
}

function expectedRouteEndpoints(routeTopology) {
  if (routeTopology === 'isolated') return new Set();
  if (routeTopology === 'cross') return new Set(ISOMETRIC_DIRECTIONS);
  const separator = routeTopology.indexOf('-');
  return new Set(routeTopology.slice(separator + 1));
}

function formatDirections(directions) {
  return ISOMETRIC_DIRECTIONS.filter(direction => directions.has(direction))
    .join(',') || 'none';
}

function assertExactEndpointBands({
  actual,
  expected,
  label,
  capability
}) {
  if (actual.size === expected.size
    && [...actual].every(direction => expected.has(direction))) {
    return;
  }
  throw new Error(
    `${label} diamond edge-band endpoints ${formatDirections(actual)} do not `
    + `match ${capability} ${formatDirections(expected)}`
  );
}

function assertConnectionPlacement(descriptor, direction, label) {
  const expected = ['n', 's'].includes(direction)
    ? { width: 1, height: 2 }
    : { width: 2, height: 1 };
  const footprint = descriptor.placement.footprint;
  if (footprint.width !== expected.width || footprint.height !== expected.height) {
    throw new Error(
      `${label} ${direction} connection footprint must be `
      + `${expected.width}x${expected.height} for its isometric axis`
    );
  }
}

export function prepareRuntimeRaster(canonical, descriptor) {
  const prepared = {
    data: Buffer.from(canonical.data),
    width: canonical.width,
    height: canonical.height
  };
  if (descriptor.rasterContract?.kind !== 'opaque-tile-diamond') {
    return prepared;
  }
  const { data, width, height } = prepared;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      if (insideDiamond(x, y, width, height)) {
        data[index + 3] = 255;
      } else {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
      }
    }
  }
  const seamBand = 4;
  for (let topY = 0; topY < Math.ceil(height / 2); topY += 1) {
    const bottomY = height - 1 - topY;
    const top = diamondRowBounds(topY, width, height);
    const bottom = diamondRowBounds(bottomY, width, height);
    if (!top || !bottom) continue;
    const depthLimit = Math.min(
      seamBand,
      Math.ceil((top.maximum - top.minimum + 1) / 2),
      Math.ceil((bottom.maximum - bottom.minimum + 1) / 2)
    );
    for (let depth = 0; depth < depthLimit; depth += 1) {
      const pairs = [
        [
          ((topY * width) + top.minimum + depth) * 4,
          ((bottomY * width) + bottom.maximum - depth) * 4
        ],
        [
          ((topY * width) + top.maximum - depth) * 4,
          ((bottomY * width) + bottom.minimum + depth) * 4
        ]
      ];
      for (const [first, second] of pairs) {
        for (let channel = 0; channel < 3; channel += 1) {
          const average = Math.round(
            (data[first + channel] + data[second + channel]) / 2
          );
          data[first + channel] = average;
          data[second + channel] = average;
        }
      }
    }
  }
  return prepared;
}

export function validateCanonicalRaster(
  canonical,
  descriptor,
  label = `${descriptor.id} raster`
) {
  const { data, width, height } = canonical;
  if (width !== descriptor.canvas.width || height !== descriptor.canvas.height) {
    throw new Error(
      `${label} dimensions ${width}x${height} do not match declared canvas `
      + `${descriptor.canvas.width}x${descriptor.canvas.height}`
    );
  }
  const bounds = descriptor.placement.drawBounds;
  let covered = 0;
  let requiredDiamondPixels = 0;
  let coveredDiamondPixels = 0;
  let exteriorPixels = 0;
  let coveredExteriorPixels = 0;
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  const contract = descriptor.rasterContract ?? null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[((y * width) + x) * 4 + 3];
      if (alpha > 0) {
        covered += 1;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
        if (x < bounds.x
          || y < bounds.y
          || x >= bounds.x + bounds.width
          || y >= bounds.y + bounds.height) {
          throw new Error(`${label} has nontransparent pixels outside drawBounds`);
        }
      }
      if (contract?.kind === 'opaque-tile-diamond') {
        if (insideDiamond(x, y, width, height)) {
          requiredDiamondPixels += 1;
          if (alpha >= contract.alphaThreshold) coveredDiamondPixels += 1;
        } else {
          exteriorPixels += 1;
          if (alpha > 0) coveredExteriorPixels += 1;
        }
      }
    }
  }
  if (covered === 0) throw new Error(`${label} has no visible pixels`);
  const corners = [
    3,
    ((width - 1) * 4) + 3,
    ((((height - 1) * width)) * 4) + 3,
    ((((height - 1) * width) + width - 1) * 4) + 3
  ];
  if (corners.some(index => data[index] !== 0)) {
    throw new Error(`${label} must have transparent canvas corners`);
  }
  if (contract?.kind === 'opaque-tile-diamond') {
    const coveredPermille = Math.floor(
      (coveredDiamondPixels * 1000) / requiredDiamondPixels
    );
    if (coveredPermille < contract.minimumCoveredPermille) {
      throw new Error(
        `${label} required diamond alpha coverage is ${coveredPermille}‰; `
        + `expected at least ${contract.minimumCoveredPermille}‰`
      );
    }
    const exteriorPermille = exteriorPixels === 0
      ? 0
      : Math.ceil((coveredExteriorPixels * 1000) / exteriorPixels);
    if (exteriorPermille > contract.maximumExteriorCoveredPermille) {
      throw new Error(
        `${label} exterior alpha coverage is ${exteriorPermille}‰; `
        + `expected at most ${contract.maximumExteriorCoveredPermille}‰`
      );
    }
  } else if (contract?.kind === 'transparent-cutout') {
    const coveredPermille = Math.floor((covered * 1000) / (width * height));
    if (coveredPermille < contract.minimumCoveredPermille
      || coveredPermille > contract.maximumCoveredPermille) {
      throw new Error(
        `${label} alpha coverage is ${coveredPermille}‰; expected `
        + `${contract.minimumCoveredPermille}–${contract.maximumCoveredPermille}‰`
      );
    }
    const boundsWidth = maximumX - minimumX + 1;
    const boundsHeight = maximumY - minimumY + 1;
    const boundsFillPermille = Math.floor(
      (covered * 1000) / (boundsWidth * boundsHeight)
    );
    if (boundsFillPermille > 900) {
      throw new Error(
        `${label} alpha silhouette is an opaque rectangular panel `
        + `(${boundsFillPermille}‰ bounding-box fill)`
      );
    }
    if (descriptor.id.includes('canopy-edge')
      && (
        coveredPermille < 100
        || boundsWidth < width * 0.5
        || boundsHeight < height * 0.4
      )) {
      throw new Error(
        `${label} canopy edge is undersized `
        + `(${coveredPermille}‰ coverage, ${boundsWidth}x${boundsHeight} bounds)`
      );
    }
    if (descriptor.id.includes('earth-face')
      && (
        coveredPermille < 40
        || boundsWidth < width * 0.45
        || boundsHeight < height * 0.25
      )) {
      throw new Error(
        `${label} earth face is undersized `
        + `(${coveredPermille}‰ coverage, ${boundsWidth}x${boundsHeight} bounds)`
      );
    }
    const visible = new Uint8Array(width * height);
    for (let pixel = 0; pixel < visible.length; pixel += 1) {
      visible[pixel] = data[(pixel * 4) + 3] > 0 ? 1 : 0;
    }
    let largestComponent = 0;
    for (let pixel = 0; pixel < visible.length; pixel += 1) {
      if (visible[pixel] !== 1) continue;
      visible[pixel] = 2;
      const queue = [pixel];
      let cursor = 0;
      let component = 0;
      while (cursor < queue.length) {
        const current = queue[cursor++];
        component += 1;
        const x = current % width;
        const neighbors = [
          current - width,
          current + width,
          ...(x > 0 ? [current - 1] : []),
          ...(x + 1 < width ? [current + 1] : [])
        ];
        for (const neighbor of neighbors) {
          if (neighbor < 0
            || neighbor >= visible.length
            || visible[neighbor] !== 1) continue;
          visible[neighbor] = 2;
          queue.push(neighbor);
        }
      }
      largestComponent = Math.max(largestComponent, component);
    }
    if (largestComponent * 1000 < covered * 850) {
      throw new Error(
        `${label} alpha silhouette has detached components outside its main subject`
      );
    }
    const anchor = descriptor.placement.anchor;
    let anchorContact = false;
    for (let y = Math.max(0, anchor.y - 12);
      y <= Math.min(height - 1, anchor.y + 12) && !anchorContact;
      y += 1) {
      for (let x = Math.max(0, anchor.x - 12);
        x <= Math.min(width - 1, anchor.x + 12);
        x += 1) {
        if (data[((y * width) + x) * 4 + 3] > 0) {
          anchorContact = true;
          break;
        }
      }
    }
    const directionalBoundary = descriptor.category === 'exposed-face-boundary'
      && descriptor.capabilities?.direction;
    if (!anchorContact && !directionalBoundary) {
      throw new Error(`${label} alpha silhouette does not contact its declared anchor`);
    }
    if (descriptor.category === 'route-transition'
      && !descriptor.capabilities
      && boundsWidth < width * 0.75
      && boundsHeight < height * 0.75) {
      throw new Error(`${label} route cutout does not reach an opposing edge band`);
    }
    const capabilities = descriptor.capabilities ?? null;
    const endpointBands = capabilities
      && descriptor.category === 'route-transition'
      ? visibleDiamondEndpointBands(data, width, height, descriptor)
      : null;
    if (descriptor.category === 'route-transition'
      && capabilities?.routeTopology) {
      assertExactEndpointBands({
        actual: endpointBands,
        expected: expectedRouteEndpoints(capabilities.routeTopology),
        label,
        capability: `declared route topology ${capabilities.routeTopology}`
      });
    }
    if (['connection-stairs', 'connection-slope'].includes(descriptor.category)
      && !capabilities?.direction
      && (minimumY > anchor.y - 24 || maximumY < anchor.y + 24)) {
      throw new Error(`${label} connection does not span both sides of its anchor`);
    }
    if (['connection-stairs', 'connection-slope'].includes(descriptor.category)
      && capabilities?.direction) {
      assertConnectionPlacement(descriptor, capabilities.direction, label);
      assertExactEndpointBands({
        actual: visibleConnectionHighEndpoints(data, width, height, descriptor),
        expected: new Set([capabilities.direction]),
        label,
        capability: `declared connection ${capabilities.direction} high endpoint`
      });
    }
    if (descriptor.category === 'exposed-face-boundary'
      && !capabilities?.direction
      && (
        minimumX > width * 0.125
        || maximumX < width * 0.875
        || minimumY < height * 0.18
      )) {
      throw new Error(
        `${label} boundary does not occupy only the horizontal face seam bands`
      );
    }
    if (descriptor.category === 'exposed-face-boundary'
      && capabilities?.direction) {
      const direction = capabilities.direction;
      const groundBands = visibleBoundaryGroundBands(
        data,
        width,
        height,
        descriptor
      );
      if (groundBands.size !== 1 || !groundBands.has(direction)) {
        throw new Error(
          `${label} grounded diamond edge bands ${formatDirections(groundBands)} `
          + `do not match declared boundary direction ${direction}`
        );
      }
    }
    if (['blocking-obstacle', 'nonblocking-decoration'].includes(descriptor.category)
      && Math.abs(maximumY - anchor.y) > 16) {
      throw new Error(`${label} base does not align with its bottom-center anchor`);
    }
    if ((canonical.nearChromaSpillPixels ?? 0) * 1000 > covered * 2) {
      throw new Error(`${label} contains excessive chroma spill around its subject`);
    }
  }
  if (descriptor.schemaVersion === 'battle-art-family-descriptor-v2'
    && ['opaque-tile-diamond', 'transparent-cutout'].includes(contract?.kind)
    && (canonical.residualExteriorChromaPixels ?? 0)
      > MAX_RESIDUAL_EXTERIOR_CHROMA_PIXELS) {
    throw new Error(
      `${label} contains residual exterior-facing chroma fringe `
      + `(${canonical.residualExteriorChromaPixels} pixels; expected at most `
      + `${MAX_RESIDUAL_EXTERIOR_CHROMA_PIXELS})`
    );
  }
  return {
    width,
    height,
    coveredPixels: covered,
    totalPixels: width * height,
    coveredPermille: Math.floor((covered * 1000) / (width * height)),
    alphaBounds: {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1
    },
    requiredDiamondPixels,
    coveredDiamondPixels,
    residualExteriorChromaPixels:
      canonical.residualExteriorChromaPixels ?? 0
  };
}

export async function validateRasterBytes({
  bytes,
  descriptor,
  profile,
  label = `${descriptor.id} raster`
}) {
  const canonical = await decodeCanonicalRaster(bytes, profile, label);
  const metrics = validateCanonicalRaster(canonical, descriptor, label);
  return { ...canonical, metrics };
}

export async function validateRuntimeAlphaParity({
  sourceBytes,
  runtimeBytes,
  descriptor,
  profile,
  label = descriptor.id
}) {
  const source = await validateRasterBytes({
    bytes: sourceBytes,
    descriptor,
    profile,
    label: `${label} canonical source`
  });
  const expected = prepareRuntimeRaster(source, descriptor);
  const runtime = await validateRasterBytes({
    bytes: runtimeBytes,
    descriptor,
    profile,
    label: `${label} runtime raster`
  });
  if (expected.width !== runtime.width || expected.height !== runtime.height) {
    throw new Error(`${label} runtime alpha dimensions differ from canonical source`);
  }
  for (let index = 0; index < expected.data.length; index += 1) {
    if (expected.data[index] !== runtime.data[index]) {
      const pixel = Math.floor(index / 4);
      const x = pixel % expected.width;
      const y = Math.floor(pixel / expected.width);
      const channel = index % 4;
      throw new Error(
        `${label} runtime ${channel === 3 ? 'alpha' : 'color'} differs from `
        + `canonical compiled source at ${x},${y}`
      );
    }
  }
  return {
    width: source.width,
    height: source.height,
    alphaParity: true,
    sourceMetrics: source.metrics,
    runtimeMetrics: runtime.metrics
  };
}
