import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import sharp from 'sharp';

import {
  decodeCanonicalRaster,
  measureDirectGeometryPrimeRaster,
  normalizeGeneratedRasterBytes,
  prepareRuntimeRaster,
  validateRasterBytes,
  validateRuntimeAlphaParity
} from './raster-contract.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

async function json(relative) {
  return JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
}

async function inputs(family = 'forest-moss-surface') {
  const manifest = await json('ai-image-metadata/battle-art/manifest.json');
  const descriptor = await json(
    `ai-image-metadata/battle-art/descriptors/forest/${family}.json`
  );
  const profile = await json(manifest.promptProfile.path);
  return { descriptor, profile };
}

function rawRaster(width, height, pixel) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, alpha] = pixel(x, y);
      const index = ((y * width) + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = alpha;
    }
  }
  return data;
}

function diamondPixel(width, height, x, y) {
  return (
    Math.abs(x - ((width - 1) / 2)) / (width / 2)
    + Math.abs(y - ((height - 1) / 2)) / (height / 2)
  ) <= 1;
}

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

function centeredCapabilityEdges(descriptor) {
  const { width, height } = descriptor.canvas;
  const { anchor } = descriptor.placement;
  const verticalRadius = Math.min(
    width / 4,
    anchor.x / 2,
    (width - 1 - anchor.x) / 2,
    anchor.y,
    height - 1 - anchor.y
  );
  const horizontalRadius = verticalRadius * 2;
  const vertices = {
    top: { x: anchor.x, y: anchor.y - verticalRadius },
    right: { x: anchor.x + horizontalRadius, y: anchor.y },
    bottom: { x: anchor.x, y: anchor.y + verticalRadius },
    left: { x: anchor.x - horizontalRadius, y: anchor.y }
  };
  return {
    n: [vertices.top, vertices.right],
    e: [vertices.right, vertices.bottom],
    s: [vertices.bottom, vertices.left],
    w: [vertices.left, vertices.top]
  };
}

function centeredCapabilitySides(descriptor) {
  return Object.fromEntries(Object.entries(centeredCapabilityEdges(descriptor))
    .map(([direction, [start, end]]) => [
      direction,
      {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2
      }
    ]));
}

function routeSides(width, height) {
  return {
    n: { x: width * 0.75, y: height * 0.25 },
    e: { x: width * 0.75, y: height * 0.75 },
    s: { x: width * 0.25, y: height * 0.75 },
    w: { x: width * 0.25, y: height * 0.25 }
  };
}

function connectionTargets(descriptor) {
  const { width, height } = descriptor.canvas;
  const { anchor } = descriptor.placement;
  const vectors = {
    n: { x: 128, y: -64 },
    e: { x: 128, y: 64 },
    s: { x: -128, y: 64 },
    w: { x: -128, y: -64 }
  };
  return Object.fromEntries(Object.entries(vectors).map(([direction, vector]) => [
    direction,
    {
      x: Math.max(0, Math.min(width - 1, anchor.x + vector.x)),
      y: Math.max(0, Math.min(height - 1, anchor.y + vector.y))
    }
  ]));
}

function topologyDirections(topology) {
  if (topology === 'cross') return ['n', 'e', 's', 'w'];
  if (topology === 'isolated') return [];
  return [...topology.slice(topology.indexOf('-') + 1)];
}

async function encode(data, width, height, format = 'png') {
  const pipeline = sharp(data, { raw: { width, height, channels: 4 } });
  return format === 'webp'
    ? pipeline.webp({ lossless: true }).toBuffer()
    : pipeline.png().toBuffer();
}

describe('battle-art deterministic raster contract', () => {
  it('measures direct geometry prime fields from exact source alpha', async () => {
    const width = 64;
    const height = 32;
    const apexTop = [4, 5, 6, 4, 5, 6, 4, 5, 6];
    const bytes = await encode(
      rawRaster(width, height, (x, y) => {
        const apexIndex = x - 28;
        if (apexIndex >= 0
          && apexIndex < apexTop.length
          && y === apexTop[apexIndex]) {
          return [90, 60, 30, 240];
        }
        if ((x === 5 && y === 2) || (x === 50 && y === 30)) {
          return [90, 60, 30, 1];
        }
        return [0, 0, 0, 0];
      }),
      width,
      height
    );
    const measured = await measureDirectGeometryPrimeRaster({
      bytes,
      prime: {
        canvas: { width, height },
        anchor: { x: 32, y: 16 },
        alphaThreshold: 240
      },
      label: 'synthetic direct geometry prime'
    });
    assert.deepEqual(measured, {
      subjectBounds: { x: 5, y: 2, width: 46, height: 29 },
      coveragePermille: 5,
      armSampleCenters: [
        { direction: 'e', percent: 50, x: 40, y: 20 },
        { direction: 'e', percent: 75, x: 44, y: 22 },
        { direction: 'e', percent: 100, x: 48, y: 24 },
        { direction: 's', percent: 50, x: 24, y: 20 },
        { direction: 's', percent: 75, x: 20, y: 22 },
        { direction: 's', percent: 100, x: 16, y: 24 }
      ],
      apexTopProfile: {
        xStart: 28,
        xStep: 1,
        alpha240Y: apexTop
      }
    });
  });

  it('rejects the archived inset moss art and accepts an exact full diamond', async () => {
    const { descriptor, profile } = await inputs();
    const archived = await json(
      'ai-image-metadata/battle-art/releases/'
      + 'battle-art-descriptors-2026-07-30.v1.json'
    );
    const source = archived.sources.find(
      candidate => candidate.familyId === descriptor.id
    );
    await assert.rejects(
      validateRasterBytes({
        bytes: await readFile(path.join(ROOT, source.path)),
        descriptor,
        profile,
        label: 'archived moss'
      }),
      /required diamond alpha coverage/
    );

    const { width, height } = descriptor.canvas;
    const bytes = await encode(
      rawRaster(width, height, (x, y) => (
        diamondPixel(width, height, x, y)
          ? [58, 91, 42, 255]
          : [0, 0, 0, 0]
      )),
      width,
      height
    );
    const result = await validateRasterBytes({
      bytes,
      descriptor,
      profile
    });
    assert.equal(result.metrics.coveredDiamondPixels,
      result.metrics.requiredDiamondPixels);
  });

  it('rejects a single under-threshold hole inside the required diamond', async () => {
    const { descriptor, profile } = await inputs();
    const { width, height } = descriptor.canvas;
    const bytes = await encode(
      rawRaster(width, height, (x, y) => {
        if (!diamondPixel(width, height, x, y)) return [0, 0, 0, 0];
        return x === Math.floor(width / 2) && y === Math.floor(height / 2)
          ? [58, 91, 42, 239]
          : [58, 91, 42, 255];
      }),
      width,
      height
    );
    await assert.rejects(
      validateRasterBytes({ bytes, descriptor, profile }),
      /required diamond alpha coverage/
    );
  });

  it('rejects dimension repair and pixels outside declared draw bounds', async () => {
    const { descriptor, profile } = await inputs();
    const wrongSize = await encode(
      rawRaster(64, 64, () => [58, 91, 42, 255]),
      64,
      64
    );
    await assert.rejects(
      validateRasterBytes({ bytes: wrongSize, descriptor, profile }),
      /do not match declared canvas/
    );

    const cutoutInputs = await inputs('forest-fern-cluster');
    const { width, height } = cutoutInputs.descriptor.canvas;
    const outsideBounds = await encode(
      rawRaster(width, height, (x, y) => (
        (x === 1 && y === 1)
          || (x >= 32 && x < 96 && y >= 64 && y < 144)
          ? [20, 20, 20, 255]
          : [0, 0, 0, 0]
      )),
      width,
      height
    );
    await assert.rejects(
      validateRasterBytes({
        bytes: outsideBounds,
        descriptor: cutoutInputs.descriptor,
        profile: cutoutInputs.profile
      }),
      /outside drawBounds/
    );
  });

  it('rejects panels/cuboids while admitting a low irregular boundary face', async () => {
    const fern = await inputs('forest-fern-cluster');
    const { width, height } = fern.descriptor.canvas;
    const panel = await encode(
      rawRaster(width, height, (x, y) => (
        x >= 32 && x <= 96 && y >= 64 && y <= 160
          ? [20, 20, 20, 255]
          : [0, 0, 0, 0]
      )),
      width,
      height
    );
    await assert.rejects(
      validateRasterBytes({
        bytes: panel,
        descriptor: fern.descriptor,
        profile: fern.profile
      }),
      /opaque rectangular panel/
    );

    const boundary = await inputs('forest-rock-boundary');
    const archived = await json(
      'ai-image-metadata/battle-art/releases/'
      + 'battle-art-descriptors-2026-07-30.v1.json'
    );
    const source = archived.sources.find(
      candidate => candidate.familyId === boundary.descriptor.id
    );
    await assert.rejects(
      validateRasterBytes({
        bytes: await readFile(path.join(ROOT, source.path)),
        descriptor: boundary.descriptor,
        profile: boundary.profile,
        label: 'archived cuboid boundary'
      }),
      /boundary does not occupy only the horizontal face seam bands/
    );

    const { width: boundaryWidth, height: boundaryHeight }
      = boundary.descriptor.canvas;
    const irregularFace = await encode(
      rawRaster(boundaryWidth, boundaryHeight, (x, y) => {
        if (x < 24 || x > 232) return [0, 0, 0, 0];
        const top = 48 + ((x * 5) % 31);
        const bottom = Math.abs(x - 128) <= 2
          ? 200
          : 200 - ((x * 7) % 21);
        return y >= top && y <= bottom
          ? [45, 35, 24, 255]
          : [0, 0, 0, 0];
      }),
      boundaryWidth,
      boundaryHeight
    );
    const accepted = await validateRasterBytes({
      bytes: irregularFace,
      descriptor: boundary.descriptor,
      profile: boundary.profile,
      label: 'irregular boundary face'
    });
    assert.equal(accepted.metrics.alphaBounds.y, 48);
  });

  it('requires directional slopes as well as stairs to span both elevations', async () => {
    const { descriptor, profile } = await inputs(
      'forest-borderwood-earth-ramp-n'
    );
    const placementOnlyDescriptor = structuredClone(descriptor);
    delete placementOnlyDescriptor.capabilities;
    const { width, height } = descriptor.canvas;
    const { anchor } = descriptor.placement;
    const raster = verticalRadius => encode(
      rawRaster(width, height, (x, y) => (
        Math.abs(x - anchor.x) / 72
          + Math.abs(y - anchor.y) / verticalRadius <= 1
          ? [74, 61, 39, 255]
          : [0, 0, 0, 0]
      )),
      width,
      height
    );

    await assert.rejects(
      validateRasterBytes({
        bytes: await raster(12),
        descriptor: placementOnlyDescriptor,
        profile,
        label: 'short slope'
      }),
      /connection does not span both sides of its anchor/
    );
    await assert.doesNotReject(
      validateRasterBytes({
        bytes: await raster(40),
        descriptor: placementOnlyDescriptor,
        profile,
        label: 'full slope'
      })
    );
  });

  it('requires route alpha endpoints to match the declared diamond topology', async () => {
    const { descriptor, profile } = await inputs(
      'forest-borderwood-dirt-path-corner-ne'
    );
    const { width, height } = descriptor.canvas;
    const sides = routeSides(width, height);
    const center = descriptor.placement.anchor;
    const topologies = [
      'isolated',
      'end-n', 'end-e', 'end-s', 'end-w',
      'straight-ns', 'straight-ew',
      'corner-ne', 'corner-es', 'corner-sw', 'corner-wn',
      'tee-nes', 'tee-esw', 'tee-nsw', 'tee-wne',
      'cross'
    ];
    let bytes;
    for (const topology of topologies) {
      const directions = topologyDirections(topology);
      const topologyBytes = await encode(
        rawRaster(width, height, (x, y) => (
          (
            directions.length === 0
              ? Math.hypot(x - center.x, y - center.y) <= 18
              : directions.some(direction => (
                  distanceToSegment(x, y, center, sides[direction]) <= 9
                ))
          )
            ? [94, 70, 42, 255]
            : [0, 0, 0, 0]
        )),
        width,
        height
      );
      const concrete = structuredClone(descriptor);
      concrete.capabilities.routeTopology = topology;
      await assert.doesNotReject(
        validateRasterBytes({
          bytes: topologyBytes,
          descriptor: concrete,
          profile,
          label: `${topology} route`
        })
      );
      if (topology === 'corner-ne') bytes = topologyBytes;
    }

    const wrongTopology = structuredClone(descriptor);
    wrongTopology.capabilities.routeTopology = 'corner-es';
    await assert.rejects(
      validateRasterBytes({
        bytes,
        descriptor: wrongTopology,
        profile,
        label: 'wrong route'
      }),
      /diamond edge-band endpoints n,e do not match declared route topology corner-es e,s/
    );
  });

  it('enforces directional connection axes and their metadata placement', async () => {
    const { descriptor, profile } = await inputs(
      'forest-borderwood-earth-ramp-n'
    );
    const { width, height } = descriptor.canvas;
    const targets = connectionTargets(descriptor);
    const { anchor } = descriptor.placement;
    const bytesByDirection = {};
    for (const direction of ['n', 'e', 's', 'w']) {
      const concrete = structuredClone(descriptor);
      concrete.capabilities.direction = direction;
      concrete.placement.footprint = {
        ...concrete.placement.footprint,
        width: ['n', 's'].includes(direction) ? 1 : 2,
        height: ['n', 's'].includes(direction) ? 2 : 1
      };
      bytesByDirection[direction] = await encode(
        rawRaster(width, height, (x, y) => (
          !((x === 0 || x === width - 1)
            && (y === 0 || y === height - 1))
          && distanceToSegment(x, y, anchor, targets[direction]) <= 10
            ? [74, 61, 39, 255]
            : [0, 0, 0, 0]
        )),
        width,
        height
      );
      await assert.doesNotReject(
        validateRasterBytes({
          bytes: bytesByDirection[direction],
          descriptor: concrete,
          profile,
          label: `${direction} connection`
        })
      );
    }
    const bytes = bytesByDirection.n;

    const wrongHighEnd = structuredClone(descriptor);
    wrongHighEnd.capabilities.direction = 's';
    await assert.rejects(
      validateRasterBytes({
        bytes,
        descriptor: wrongHighEnd,
        profile,
        label: 'opposite low-to-high metadata on the same footprint axis'
      }),
      /endpoints n do not match declared connection s high endpoint s/
    );

    const wrongDirection = structuredClone(descriptor);
    wrongDirection.capabilities.direction = 'e';
    wrongDirection.placement.footprint = {
      ...wrongDirection.placement.footprint,
      width: 2,
      height: 1
    };
    await assert.rejects(
      validateRasterBytes({
        bytes,
        descriptor: wrongDirection,
        profile,
        label: 'wrong connection'
      }),
      /endpoints n do not match declared connection e high endpoint e/
    );

    const wrongPlacement = structuredClone(descriptor);
    wrongPlacement.placement.footprint = {
      ...wrongPlacement.placement.footprint,
      width: 2,
      height: 1
    };
    await assert.rejects(
      validateRasterBytes({
        bytes,
        descriptor: wrongPlacement,
        profile,
        label: 'misplaced connection'
      }),
      /n connection footprint must be 1x2/
    );
  });

  it('validates directional boundary ground contours without treating canopy as another side', async () => {
    const { descriptor, profile } = await inputs(
      'forest-borderwood-earth-face-n'
    );
    const { width, height } = descriptor.canvas;
    const { anchor } = descriptor.placement;
    const edges = centeredCapabilityEdges(descriptor);
    const sides = centeredCapabilitySides(descriptor);
    const bytesByDirection = {};
    for (const direction of ['n', 'e', 's', 'w']) {
      const concrete = structuredClone(descriptor);
      concrete.capabilities.direction = direction;
      const [edgeStart, edgeEnd] = edges[direction];
      bytesByDirection[direction] = await encode(
        rawRaster(width, height, (x, y) => (
          distanceToSegment(x, y, edgeStart, edgeEnd) <= 8
            || distanceToSegment(x, y, anchor, sides[direction]) <= 7
            ? [52, 39, 25, 255]
            : [0, 0, 0, 0]
        )),
        width,
        height
      );
      await assert.doesNotReject(
        validateRasterBytes({
          bytes: bytesByDirection[direction],
          descriptor: concrete,
          profile,
          label: `${direction} boundary`
        })
      );
    }
    const bytes = bytesByDirection.n;
    const [westStart, westEnd] = edges.w;
    const edgeOnlyBoundary = await encode(
      rawRaster(width, height, (x, y) => (
        distanceToSegment(x, y, westStart, westEnd) <= 8
          ? [52, 39, 25, 255]
          : [0, 0, 0, 0]
      )),
      width,
      height
    );
    const westDescriptor = structuredClone(descriptor);
    westDescriptor.capabilities.direction = 'w';
    westDescriptor.id = 'forest-borderwood-root-boundary-w';
    await assert.doesNotReject(
      validateRasterBytes({
        bytes: edgeOnlyBoundary,
        descriptor: westDescriptor,
        profile,
        label: 'edge-only west boundary'
      })
    );
    const undersizedCanopy = structuredClone(westDescriptor);
    undersizedCanopy.id = 'forest-borderwood-canopy-edge-w';
    await assert.rejects(
      validateRasterBytes({
        bytes: edgeOnlyBoundary,
        descriptor: undersizedCanopy,
        profile,
        label: 'undersized west canopy'
      }),
      /canopy edge is undersized/
    );
    const undersizedEarthFace = structuredClone(westDescriptor);
    undersizedEarthFace.id = 'forest-borderwood-earth-face-w';
    await assert.rejects(
      validateRasterBytes({
        bytes: edgeOnlyBoundary,
        descriptor: undersizedEarthFace,
        profile,
        label: 'undersized west earth face'
      }),
      /earth face is undersized/
    );

    const wrongDirection = structuredClone(descriptor);
    wrongDirection.capabilities.direction = 's';
    await assert.rejects(
      validateRasterBytes({
        bytes,
        descriptor: wrongDirection,
        profile,
        label: 'wrong boundary'
      }),
      /grounded diamond edge bands n do not match declared boundary direction s/
    );

    const [northStart, northEnd] = edges.n;
    const [southStart, southEnd] = edges.s;
    const bothDirections = await encode(
      rawRaster(width, height, (x, y) => (
        distanceToSegment(x, y, northStart, northEnd) <= 8
          || distanceToSegment(x, y, southStart, southEnd) <= 8
          || distanceToSegment(x, y, anchor, sides.n) <= 7
          || distanceToSegment(x, y, anchor, sides.s) <= 7
          ? [52, 39, 25, 255]
          : [0, 0, 0, 0]
      )),
      width,
      height
    );
    await assert.rejects(
      validateRasterBytes({
        bytes: bothDirections,
        descriptor,
        profile,
        label: 'ambiguous boundary'
      }),
      /grounded diamond edge bands n,s do not match declared boundary direction n/
    );

    const [eastStart, eastEnd] = edges.e;
    const tallCanopy = await encode(
      rawRaster(width, height, (x, y) => {
        const grounded = distanceToSegment(x, y, eastStart, eastEnd) <= 8
          || distanceToSegment(x, y, anchor, sides.e) <= 7;
        const trunk = [80, 128, 176].some(trunkX => (
          Math.abs(x - trunkX) <= 5 && y >= 105 && y <= 214
        ));
        const crown = x >= 20 && x <= 236 && y >= 48 && y <= 150;
        const lowAlphaSpeckle =
          distanceToSegment(x, y, edges.w[0], edges.w[1]) <= 3;
        if (grounded || trunk || crown) return [42, 72, 35, 255];
        return lowAlphaSpeckle ? [42, 72, 35, 32] : [0, 0, 0, 0];
      }),
      width,
      height
    );
    const eastDescriptor = structuredClone(descriptor);
    eastDescriptor.capabilities.direction = 'e';
    eastDescriptor.id = 'forest-borderwood-canopy-edge-e';
    await assert.doesNotReject(
      validateRasterBytes({
        bytes: tallCanopy,
        descriptor: eastDescriptor,
        profile,
        label: 'tall east canopy'
      })
    );
    const mislabeledCanopy = structuredClone(descriptor);
    mislabeledCanopy.capabilities.direction = 'w';
    await assert.rejects(
      validateRasterBytes({
        bytes: tallCanopy,
        descriptor: mislabeledCanopy,
        profile,
        label: 'mislabeled tall canopy'
      }),
      /grounded diamond edge bands e do not match declared boundary direction w/
    );
  });

  it('normalizes the frozen magenta chroma and permits dark authored shading', async () => {
    const { descriptor, profile } = await inputs('forest-fern-cluster');
    const { width, height } = descriptor.canvas;
    const bytes = await encode(
      rawRaster(width, height, (x, y) => (
        (
          (x >= 60 && x <= 67 && y >= 64 && y <= 160)
          || (y >= 82 && y <= 132
            && Math.abs(x - 64) <= Math.floor((y - 70) / 3))
        )
          ? [12, 12, 12, 255]
          : [255, 0, 255, 255]
      )),
      width,
      height
    );
    const result = await validateRasterBytes({
      bytes,
      descriptor,
      profile
    });
    assert.ok(result.metrics.coveredPixels > 0);
    assert.equal(result.data[3], 0);
  });

  it('normalizes an opaque chroma route to binary alpha without inventing a partial-alpha verge', async () => {
    const { descriptor, profile } = await inputs(
      'forest-heartlands-loam-path-straight-ns'
    );
    const { width, height } = descriptor.canvas;
    const sides = routeSides(width, height);
    const generated = await encode(
      rawRaster(width, height, (x, y) => (
        distanceToSegment(x, y, sides.s, sides.n) <= 20
          ? [148, 102, 48, 255]
          : [255, 0, 255, 255]
      )),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const { data } = await sharp(normalized)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaValues = new Set();
    let partialAlphaPixels = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index];
      alphaValues.add(alpha);
      if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;
    }
    assert.deepEqual([...alphaValues].sort((a, b) => a - b), [0, 255]);
    assert.equal(
      partialAlphaPixels,
      0,
      'opaque #ff00ff route input cannot satisfy a prompt requiring partial alpha'
    );
  });

  it('deterministically removes chroma fringe and completes generated surface diamonds', async () => {
    const { descriptor, profile } = await inputs();
    const { width, height } = descriptor.canvas;
    const generated = await encode(
      rawRaster(width, height, (x, y) => {
        if (!diamondPixel(width, height, x, y)) return [255, 0, 255, 255];
        if (x === Math.floor(width / 2) && y === Math.floor(height / 2)) {
          return [210, 40, 220, 255];
        }
        if (x < 3 || x >= width - 3) return [0, 0, 0, 0];
        return [58, 91, 42, 245];
      }),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const result = await validateRasterBytes({
      bytes: normalized,
      descriptor,
      profile
    });
    assert.equal(
      result.metrics.coveredDiamondPixels,
      result.metrics.requiredDiamondPixels
    );
    assert.equal(result.nearChromaSpillPixels, 0);
    const center = (
      (Math.floor(height / 2) * width) + Math.floor(width / 2)
    ) * 4;
    assert.notDeepEqual(
      [...result.data.subarray(center, center + 3)],
      [0, 0, 0]
    );
  });

  it('despills an opaque diamond rim while preserving enclosed magenta detail', async () => {
    const { descriptor, profile } = await inputs();
    const { width, height } = descriptor.canvas;
    const center = {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2)
    };
    const nearDiamondExterior = (x, y) => {
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          if (!diamondPixel(width, height, x + offsetX, y + offsetY)) {
            return true;
          }
        }
      }
      return false;
    };
    const generated = await encode(
      rawRaster(width, height, (x, y) => {
        if (!diamondPixel(width, height, x, y)) return [255, 0, 255, 255];
        if (Math.hypot(x - center.x, y - center.y) <= 5) {
          return [160, 60, 160, 255];
        }
        return nearDiamondExterior(x, y)
          ? [160, 60, 160, 211]
          : [58, 91, 42, 255];
      }),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const result = await validateRasterBytes({
      bytes: normalized,
      descriptor,
      profile,
      label: 'despilled opaque moss diamond'
    });
    const rim = (center.x * 4);
    assert.equal(result.data[rim + 3], 255);
    assert.notDeepEqual(
      [...result.data.subarray(rim, rim + 3)],
      [160, 60, 160]
    );
    const interior = ((center.y * width) + center.x) * 4;
    assert.deepEqual(
      [...result.data.subarray(interior, interior + 4)],
      [160, 60, 160, 255]
    );
    assert.equal(
      result.metrics.coveredDiamondPixels,
      result.metrics.requiredDiamondPixels
    );
    assert.equal(result.metrics.residualExteriorChromaPixels, 0);
  });

  it('despills one- and two-pixel exterior chroma while retaining cutout alpha', async () => {
    const { descriptor, profile } = await inputs('forest-borderwood-fern-cluster');
    const { width, height } = descriptor.canvas;
    const generated = await encode(
      rawRaster(width, height, (x, y) => {
        const distance = Math.abs(x - 64) + (Math.abs(y - 112) / 2);
        if (distance > 24 && distance <= 26) return [120, 85, 115, 173];
        if (distance <= 24) {
          return distance > 21
            ? [44, 78, 36, 255]
            : [58, 96, 42, 255];
        }
        return [255, 0, 255, 255];
      }),
      width,
      height
    );
    await assert.rejects(
      validateRasterBytes({
        bytes: generated,
        descriptor,
        profile,
        label: 'unprocessed two-pixel fringe'
      }),
      /residual exterior-facing chroma fringe/
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const result = await validateRasterBytes({
      bytes: normalized,
      descriptor,
      profile,
      label: 'two-pixel despilled fern'
    });
    for (const x of [38, 39]) {
      const index = ((112 * width) + x) * 4;
      assert.equal(result.data[index + 3], 173);
      assert.ok(result.data[index + 1] > 60);
    }
    assert.equal(result.residualExteriorChromaPixels, 0);
    assert.equal(result.metrics.residualExteriorChromaPixels, 0);
  });

  it('preserves legitimate magenta enclosed inside a cutout', async () => {
    const { descriptor, profile } = await inputs('forest-borderwood-fern-cluster');
    const { width, height } = descriptor.canvas;
    const center = { x: 64, y: 108 };
    const generated = await encode(
      rawRaster(width, height, (x, y) => {
        const distance = (
          Math.abs(x - center.x) / 42
          + Math.abs(y - center.y) / 52
        );
        if (distance > 1) return [255, 0, 255, 255];
        if (Math.hypot(x - center.x, y - center.y) < 8) {
          return [160, 60, 160, 255];
        }
        return [48, 82, 38, 255];
      }),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const result = await validateRasterBytes({
      bytes: normalized,
      descriptor,
      profile,
      label: 'interior magenta fern'
    });
    const index = ((center.y * width) + center.x) * 4;
    assert.deepEqual(
      [...result.data.subarray(index, index + 4)],
      [160, 60, 160, 255]
    );
  });

  it('clears exterior chroma pixels when no inward donor exists', async () => {
    const { descriptor, profile } = await inputs('forest-borderwood-fern-cluster');
    const { width, height } = descriptor.canvas;
    const generated = await encode(
      rawRaster(width, height, (x, y) => (
        (x === 64 && y >= 64 && y <= 160)
          ? [160, 60, 160, 211]
          : [255, 0, 255, 255]
      )),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const { data } = await sharp(normalized)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const middle = ((112 * width) + 64) * 4;
    assert.deepEqual([...data.subarray(middle, middle + 4)], [0, 0, 0, 0]);
  });

  it('clears low-alpha cutout artifacts while retaining alpha-nine subject pixels', async () => {
    const { descriptor, profile } = await inputs('forest-borderwood-fern-cluster');
    const { width, height } = descriptor.canvas;
    const generated = await encode(
      rawRaster(width, height, (x, y) => {
        const subject = (
          Math.abs(x - 64) / 30
          + Math.abs(y - 112) / 48
        ) <= 1;
        if (subject) return [48, 82, 38, 9];
        if (y === 30 && x >= 8 && x <= 115) return [0, 255, 0, 1];
        if ((x === 10 && y === 50) || (x === 116 && y === 72)) {
          return [10, 240, 5, 8];
        }
        return [255, 0, 255, 255];
      }),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const result = await validateRasterBytes({
      bytes: normalized,
      descriptor,
      profile,
      label: 'low-alpha-noise normalized fern'
    });
    for (const { x, y } of [
      { x: 8, y: 30 },
      { x: 64, y: 30 },
      { x: 115, y: 30 },
      { x: 10, y: 50 },
      { x: 116, y: 72 }
    ]) {
      const index = ((y * width) + x) * 4;
      assert.deepEqual(
        [...result.data.subarray(index, index + 4)],
        [0, 0, 0, 0]
      );
    }
    const subject = ((112 * width) + 64) * 4;
    assert.deepEqual(
      [...result.data.subarray(subject, subject + 4)],
      [48, 82, 38, 9]
    );
  });

  it('keeps normalized cutout topology valid after exterior despill', async () => {
    const { descriptor, profile } = await inputs(
      'forest-borderwood-dirt-path-corner-ne'
    );
    const { width, height } = descriptor.canvas;
    const center = descriptor.placement.anchor;
    const sides = routeSides(width, height);
    const generated = await encode(
      rawRaster(width, height, (x, y) => {
        const routeDistance = Math.min(
          distanceToSegment(x, y, center, sides.n),
          distanceToSegment(x, y, center, sides.e)
        );
        if (routeDistance <= 9) return [94, 70, 42, 255];
        if (routeDistance <= 11) return [160, 60, 160, 190];
        return [255, 0, 255, 255];
      }),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const result = await validateRasterBytes({
      bytes: normalized,
      descriptor,
      profile,
      label: 'despilled corner-ne route'
    });
    assert.equal(result.metrics.residualExteriorChromaPixels, 0);
  });

  it('proves canonical source/runtime alpha parity byte-for-byte', async () => {
    const { descriptor, profile } = await inputs();
    const { width, height } = descriptor.canvas;
    const sourceData = rawRaster(width, height, (x, y) => (
      diamondPixel(width, height, x, y)
        ? [58, 91, 42, 255]
        : [0, 0, 0, 0]
    ));
    const canonical = await validateRasterBytes({
      bytes: await encode(sourceData, width, height),
      descriptor,
      profile
    });
    const runtimeData = prepareRuntimeRaster(canonical, descriptor).data;
    const center = (
      (Math.floor(height / 2) * width) + Math.floor(width / 2)
    ) * 4;
    runtimeData[center + 3] = 254;
    await assert.rejects(
      validateRuntimeAlphaParity({
        sourceBytes: await encode(sourceData, width, height),
        runtimeBytes: await encode(runtimeData, width, height, 'webp'),
        descriptor,
        profile
      }),
      /runtime alpha differs/
    );
  });

  it('normalizes opposite diamond edge bands to exact matching colors', async () => {
    const { descriptor, profile } = await inputs();
    const { width, height } = descriptor.canvas;
    const source = await validateRasterBytes({
      bytes: await encode(
        rawRaster(width, height, (x, y) => (
          diamondPixel(width, height, x, y)
            ? [
                40 + (x % 80),
                80 + (y % 80),
                30 + ((x + y) % 80),
                255
              ]
            : [0, 0, 0, 0]
        )),
        width,
        height
      ),
      descriptor,
      profile
    });
    const prepared = prepareRuntimeRaster(source, descriptor);
    for (let topY = 0; topY < Math.ceil(height / 2); topY += 1) {
      const bottomY = height - 1 - topY;
      const topXs = [];
      const bottomXs = [];
      for (let x = 0; x < width; x += 1) {
        if (diamondPixel(width, height, x, topY)) topXs.push(x);
        if (diamondPixel(width, height, x, bottomY)) bottomXs.push(x);
      }
      const depthLimit = Math.min(4, Math.ceil(topXs.length / 2));
      for (let depth = 0; depth < depthLimit; depth += 1) {
        for (const [topX, bottomX] of [
          [topXs[depth], bottomXs.at(-1 - depth)],
          [topXs.at(-1 - depth), bottomXs[depth]]
        ]) {
          const top = ((topY * width) + topX) * 4;
          const bottom = ((bottomY * width) + bottomX) * 4;
          assert.deepEqual(
            [...prepared.data.subarray(top, top + 3)],
            [...prepared.data.subarray(bottom, bottom + 3)]
          );
        }
      }
    }
  });

  it('despills chroma exposed only after low-alpha cutout noise is cleared', async () => {
    const { descriptor, profile } = await inputs(
      'forest-borderwood-fern-cluster'
    );
    const { width, height } = descriptor.canvas;
    const generated = await encode(
      rawRaster(width, height, (x, y) => {
        const inSubject = x >= 50 && x <= 78 && y >= 100 && y <= 120;
        const inFringe = x >= 49 && x <= 79 && y >= 99 && y <= 121;
        const inNoise = x >= 48 && x <= 80 && y >= 98 && y <= 122;
        if (inSubject) return [44, 86, 35, 255];
        if (inFringe) return [170, 50, 180, 255];
        if (inNoise) return [44, 86, 35, 8];
        return [255, 0, 255, 255];
      }),
      width,
      height
    );
    const normalized = await normalizeGeneratedRasterBytes({
      bytes: generated,
      descriptor,
      profile,
      format: 'png'
    });
    const result = await decodeCanonicalRaster(
      normalized,
      profile,
      'noise-shielded fringe cutout',
      { chromaRemovalMultiplier: 3 }
    );
    assert.equal(result.residualExteriorChromaPixels, 0);
    const clearedNoise = ((98 * width) + 48) * 4;
    assert.equal(result.data[clearedNoise + 3], 0);
    const despilledFringe = ((99 * width) + 49) * 4;
    assert.equal(result.data[despilledFringe + 3], 255);
    assert.ok(result.data[despilledFringe + 1] > 50);
  });
});
