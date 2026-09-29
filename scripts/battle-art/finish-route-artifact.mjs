import { createHash } from 'node:crypto';

import sharp from 'sharp';

import {
  decodeCanonicalRaster,
  normalizeGeneratedRasterBytes,
  validateRasterBytes
} from './raster-contract.mjs';

const ROUTE_FINISHING_SCHEMA = 'battle-art-route-finishing-v1';
const LARGEST_COMPONENT_BOX_STRATEGY = 'largest-component-box-v1';
const ANCHOR_SCALE_STRATEGY = 'anchor-scale-v1';
const STRAIGHT_ROUTE_BASIS_STRATEGY = 'straight-route-basis-v1';
const CORNER_ARM_LOCAL_WARP_STRATEGY = 'corner-arm-local-warp-v1';
const MULTI_ARM_LOCAL_WARP_STRATEGY = 'multi-arm-local-warp-v1';
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
const ROUTE_BASIS_MAXIMUM_SCALE_ANISOTROPY_PERMILLE = 3250;
const ROUTE_BASIS_MAXIMUM_TRIMMED_COVERED_PERMILLE = 300;
const CORNER_MAXIMUM_COVERAGE_PERMILLE = 230;
const CORNER_MAXIMUM_SCALE_ANISOTROPY_PERMILLE = 1500;
const CORNER_MAXIMUM_PERPENDICULAR_OFFSET_PIXELS = 32;
const MULTI_ARM_MAXIMUM_COVERAGE_PERMILLE = 500;
const MULTI_ARM_MAXIMUM_SCALE_ANISOTROPY_PERMILLE = 3500;
const CORNER_MINIMUM_CORE_WIDTH = 28;
const CORNER_CORE_ALPHA_THRESHOLD = 240;
const CORNER_CORE_SCAN_RADIUS = 8;
const CORNER_CORE_ANCHOR_INTERSECTION_RADIUS = 12;

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
  if (![
    LARGEST_COMPONENT_BOX_STRATEGY,
    ANCHOR_SCALE_STRATEGY,
    STRAIGHT_ROUTE_BASIS_STRATEGY,
    CORNER_ARM_LOCAL_WARP_STRATEGY,
    MULTI_ARM_LOCAL_WARP_STRATEGY
  ]
    .includes(finishing.strategy)) {
    throw new Error(
      'descriptor.routeFinishing.strategy must be '
      + `${LARGEST_COMPONENT_BOX_STRATEGY}, ${ANCHOR_SCALE_STRATEGY}, `
      + `${STRAIGHT_ROUTE_BASIS_STRATEGY}, or `
      + `${CORNER_ARM_LOCAL_WARP_STRATEGY}, or `
      + MULTI_ARM_LOCAL_WARP_STRATEGY
    );
  }
  const topology = descriptor.capabilities?.routeTopology;
  if (topology === 'isolated'
    && finishing.strategy !== LARGEST_COMPONENT_BOX_STRATEGY) {
    throw new Error(
      'isolated route finishing requires largest-component-box-v1'
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

  if (finishing.strategy === CORNER_ARM_LOCAL_WARP_STRATEGY) {
    const allowedKeys = new Set([
      'schemaVersion',
      'strategy',
      'arms',
      'maximumDetachedCoveredPermille',
      'maximumCoveragePermille',
      'maximumScaleAnisotropyPermille',
      'armAlphaSpan'
    ]);
    const foreignKey = Object.keys(finishing).find(
      key => !allowedKeys.has(key)
    );
    if (foreignKey !== undefined) {
      throw new Error(
        `descriptor.routeFinishing.${foreignKey} is not allowed for `
        + CORNER_ARM_LOCAL_WARP_STRATEGY
      );
    }
    if (!/^corner-[nesw]{2}$/.test(topology)) {
      throw new Error(
        `${CORNER_ARM_LOCAL_WARP_STRATEGY} requires a corner topology`
      );
    }
    if (width % 4 !== 0 || height % 4 !== 0) {
      throw new Error(
        'corner arm-local finishing requires canvas dimensions divisible by 4'
      );
    }
    const anchor = descriptor.placement?.anchor;
    assertCoordinate(anchor?.x, 'route finishing anchor.x');
    assertCoordinate(anchor?.y, 'route finishing anchor.y');
    if (anchor.x >= width || anchor.y >= height) {
      throw new Error('route finishing anchor must be contained by the canvas');
    }
    if (!finishing.arms
      || typeof finishing.arms !== 'object'
      || Array.isArray(finishing.arms)) {
      throw new Error('descriptor.routeFinishing.arms must be an object');
    }
    const directions = routeDirections(topology);
    if (Object.keys(finishing.arms).length !== directions.length
      || directions.some(direction => !Object.hasOwn(
        finishing.arms,
        direction
      ))) {
      throw new Error(
        'descriptor.routeFinishing.arms must exactly match the corner arms'
      );
    }
    if (!Number.isSafeInteger(finishing.maximumCoveragePermille)
      || finishing.maximumCoveragePermille < 1
      || finishing.maximumCoveragePermille
        > CORNER_MAXIMUM_COVERAGE_PERMILLE) {
      throw new Error(
        'descriptor.routeFinishing.maximumCoveragePermille must be an '
        + `integer between 1 and ${CORNER_MAXIMUM_COVERAGE_PERMILLE}`
      );
    }
    if (!Number.isSafeInteger(finishing.maximumScaleAnisotropyPermille)
      || finishing.maximumScaleAnisotropyPermille < 1000
      || finishing.maximumScaleAnisotropyPermille
        > CORNER_MAXIMUM_SCALE_ANISOTROPY_PERMILLE) {
      throw new Error(
        'descriptor.routeFinishing.maximumScaleAnisotropyPermille must be '
        + `an integer between 1000 and `
        + `${CORNER_MAXIMUM_SCALE_ANISOTROPY_PERMILLE}`
      );
    }
    const arms = {};
    for (const direction of directions) {
      const arm = finishing.arms[direction];
      if (!arm || typeof arm !== 'object' || Array.isArray(arm)) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction} must be an object`
        );
      }
      const armKeys = [
        'perpendicularScalePermille',
        'perpendicularOffsetPixels',
        'transitionStartPermille',
        'transitionEndPermille'
      ];
      if (Object.keys(arm).length !== armKeys.length
        || armKeys.some(key => !Object.hasOwn(arm, key))) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction} has invalid keys`
        );
      }
      if (!Number.isSafeInteger(arm.perpendicularScalePermille)
        || arm.perpendicularScalePermille < 1000
        || arm.perpendicularScalePermille
          > finishing.maximumScaleAnisotropyPermille) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction}`
          + '.perpendicularScalePermille exceeds its hard anisotropy cap'
        );
      }
      if (!Number.isSafeInteger(arm.perpendicularOffsetPixels)
        || Math.abs(arm.perpendicularOffsetPixels)
          > CORNER_MAXIMUM_PERPENDICULAR_OFFSET_PIXELS) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction}`
          + '.perpendicularOffsetPixels exceeds its hard local offset cap'
        );
      }
      for (const key of [
        'transitionStartPermille',
        'transitionEndPermille'
      ]) {
        if (!Number.isSafeInteger(arm[key])
          || arm[key] < 0
          || arm[key] > 1000) {
          throw new Error(
            `descriptor.routeFinishing.arms.${direction}.${key} must be an `
            + 'integer between 0 and 1000'
          );
        }
      }
      if (arm.transitionStartPermille >= arm.transitionEndPermille) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction} transition must have `
          + 'positive length'
        );
      }
      arms[direction] = { ...arm };
    }
    return {
      ...common,
      strategy: CORNER_ARM_LOCAL_WARP_STRATEGY,
      anchor: { x: anchor.x, y: anchor.y },
      arms,
      maximumCoveragePermille: finishing.maximumCoveragePermille,
      maximumScaleAnisotropyPermille:
        finishing.maximumScaleAnisotropyPermille
    };
  }

  if (finishing.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY) {
    const allowedKeys = new Set([
      'schemaVersion',
      'strategy',
      'arms',
      'maximumDetachedCoveredPermille',
      'maximumFinishedDetachedCoveredPermille',
      'maximumCoveragePermille',
      'maximumScaleAnisotropyPermille',
      'armAlphaSpan',
      'centerlineArmAlphaSpan'
    ]);
    const foreignKey = Object.keys(finishing).find(
      key => !allowedKeys.has(key)
    );
    if (foreignKey !== undefined) {
      throw new Error(
        `descriptor.routeFinishing.${foreignKey} is not allowed for `
        + MULTI_ARM_LOCAL_WARP_STRATEGY
      );
    }
    if (topology !== 'cross' && !/^tee-[nesw]{3}$/.test(topology)) {
      throw new Error(
        `${MULTI_ARM_LOCAL_WARP_STRATEGY} requires a cross or tee topology`
      );
    }
    if (width % 4 !== 0 || height % 4 !== 0) {
      throw new Error(
        'multi-arm local finishing requires canvas dimensions divisible by 4'
      );
    }
    const anchor = descriptor.placement?.anchor;
    assertCoordinate(anchor?.x, 'route finishing anchor.x');
    assertCoordinate(anchor?.y, 'route finishing anchor.y');
    if (anchor.x >= width || anchor.y >= height) {
      throw new Error('route finishing anchor must be contained by the canvas');
    }
    const directions = routeDirections(topology);
    if (!finishing.arms
      || typeof finishing.arms !== 'object'
      || Array.isArray(finishing.arms)
      || Object.keys(finishing.arms).length !== directions.length
      || directions.some(direction => !Object.hasOwn(
        finishing.arms,
        direction
      ))) {
      throw new Error(
        'descriptor.routeFinishing.arms must exactly match the multi-arm topology'
      );
    }
    if (!Number.isSafeInteger(finishing.maximumCoveragePermille)
      || finishing.maximumCoveragePermille < 1
      || finishing.maximumCoveragePermille
        > MULTI_ARM_MAXIMUM_COVERAGE_PERMILLE) {
      throw new Error(
        'descriptor.routeFinishing.maximumCoveragePermille must be an '
        + `integer between 1 and ${MULTI_ARM_MAXIMUM_COVERAGE_PERMILLE}`
      );
    }
    if (!Number.isSafeInteger(finishing.maximumScaleAnisotropyPermille)
      || finishing.maximumScaleAnisotropyPermille < 1000
      || finishing.maximumScaleAnisotropyPermille
        > MULTI_ARM_MAXIMUM_SCALE_ANISOTROPY_PERMILLE) {
      throw new Error(
        'descriptor.routeFinishing.maximumScaleAnisotropyPermille must be '
        + `an integer between 1000 and `
        + `${MULTI_ARM_MAXIMUM_SCALE_ANISOTROPY_PERMILLE}`
      );
    }
    if (!Number.isSafeInteger(
      finishing.maximumFinishedDetachedCoveredPermille
    )
      || finishing.maximumFinishedDetachedCoveredPermille < 0
      || finishing.maximumFinishedDetachedCoveredPermille
        > MAXIMUM_DETACHED_COVERED_PERMILLE) {
      throw new Error(
        'descriptor.routeFinishing.maximumFinishedDetachedCoveredPermille '
        + `must be an integer between 0 and `
        + `${MAXIMUM_DETACHED_COVERED_PERMILLE}`
      );
    }
    const armKeys = [
      'perpendicularStartScalePermille',
      'perpendicularScalePermille',
      'perpendicularOffsetPixels',
      'scaleTransitionStartPermille',
      'scaleTransitionEndPermille',
      'offsetTransitionStartPermille',
      'offsetTransitionEndPermille'
    ];
    const arms = {};
    for (const direction of directions) {
      const arm = finishing.arms[direction];
      if (!arm || typeof arm !== 'object' || Array.isArray(arm)
        || Object.keys(arm).length !== armKeys.length
        || armKeys.some(key => !Object.hasOwn(arm, key))) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction} has invalid keys`
        );
      }
      if (!Number.isSafeInteger(arm.perpendicularScalePermille)
        || arm.perpendicularScalePermille < 1000
        || arm.perpendicularScalePermille
          > finishing.maximumScaleAnisotropyPermille) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction}`
          + '.perpendicularScalePermille exceeds its hard anisotropy cap'
        );
      }
      if (!Number.isSafeInteger(arm.perpendicularStartScalePermille)
        || arm.perpendicularStartScalePermille < 1000
        || arm.perpendicularStartScalePermille
          > finishing.maximumScaleAnisotropyPermille) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction}`
          + '.perpendicularStartScalePermille exceeds its hard anisotropy cap'
        );
      }
      if (!Number.isSafeInteger(arm.perpendicularOffsetPixels)
        || Math.abs(arm.perpendicularOffsetPixels)
          > CORNER_MAXIMUM_PERPENDICULAR_OFFSET_PIXELS) {
        throw new Error(
          `descriptor.routeFinishing.arms.${direction}`
          + '.perpendicularOffsetPixels exceeds its hard local offset cap'
        );
      }
      for (const prefix of ['scale', 'offset']) {
        const start = arm[`${prefix}TransitionStartPermille`];
        const end = arm[`${prefix}TransitionEndPermille`];
        if (!Number.isSafeInteger(start)
          || !Number.isSafeInteger(end)
          || start < 0
          || end > 1000
          || start >= end) {
          throw new Error(
            `descriptor.routeFinishing.arms.${direction} ${prefix} `
            + 'transition must be an increasing integer range in 0..1000'
          );
        }
      }
      arms[direction] = { ...arm };
    }
    const centerlineArmAlphaSpan = finishing.centerlineArmAlphaSpan;
    if (!centerlineArmAlphaSpan
      || typeof centerlineArmAlphaSpan !== 'object'
      || Array.isArray(centerlineArmAlphaSpan)) {
      throw new Error(
        'descriptor.routeFinishing.centerlineArmAlphaSpan must be an object'
      );
    }
    const spanKeys = [
      'alphaThreshold',
      'minimumPixels',
      'maximumPixels',
      'maximumSpreadPixels'
    ];
    if (Object.keys(centerlineArmAlphaSpan).length !== spanKeys.length
      || spanKeys.some(key => !Number.isSafeInteger(
        centerlineArmAlphaSpan[key]
      ))
      || centerlineArmAlphaSpan.alphaThreshold < 1
      || centerlineArmAlphaSpan.alphaThreshold > 255
      || centerlineArmAlphaSpan.minimumPixels < 28
      || centerlineArmAlphaSpan.minimumPixels
        > centerlineArmAlphaSpan.maximumPixels
      || centerlineArmAlphaSpan.maximumSpreadPixels < 0) {
      throw new Error(
        'descriptor.routeFinishing.centerlineArmAlphaSpan is invalid'
      );
    }
    return {
      ...common,
      armAlphaSpan: { ...centerlineArmAlphaSpan },
      strategy: MULTI_ARM_LOCAL_WARP_STRATEGY,
      anchor: { x: anchor.x, y: anchor.y },
      arms,
      maximumFinishedDetachedCoveredPermille:
        finishing.maximumFinishedDetachedCoveredPermille,
      maximumCoveragePermille: finishing.maximumCoveragePermille,
      maximumScaleAnisotropyPermille:
        finishing.maximumScaleAnisotropyPermille
    };
  }

  if (finishing.strategy === STRAIGHT_ROUTE_BASIS_STRATEGY) {
    const allowedKeys = new Set([
      'schemaVersion',
      'strategy',
      'sourceTerminalInsetPixels',
      'outputTerminalOverflowPixels',
      'outputPerpendicularSpanPixels',
      'maximumDetachedCoveredPermille',
      'maximumTrimmedCoveredPermille',
      'maximumScaleAnisotropyPermille',
      'armAlphaSpan'
    ]);
    const foreignKey = Object.keys(finishing).find(
      key => !allowedKeys.has(key)
    );
    if (foreignKey !== undefined) {
      throw new Error(
        `descriptor.routeFinishing.${foreignKey} is not allowed for `
        + STRAIGHT_ROUTE_BASIS_STRATEGY
      );
    }
    if (!['straight-ew', 'straight-ns'].includes(topology)) {
      throw new Error(
        `${STRAIGHT_ROUTE_BASIS_STRATEGY} requires straight-ew or straight-ns`
      );
    }
    const anchor = descriptor.placement?.anchor;
    assertCoordinate(anchor?.x, 'route finishing anchor.x');
    assertCoordinate(anchor?.y, 'route finishing anchor.y');
    if (anchor.x >= width || anchor.y >= height) {
      throw new Error('route finishing anchor must be contained by the canvas');
    }
    for (const [key, minimum, maximum] of [
      ['sourceTerminalInsetPixels', 1, MAXIMUM_DIMENSION],
      ['outputTerminalOverflowPixels', 0, 8],
      ['outputPerpendicularSpanPixels', 1, Math.max(width, height)],
      [
        'maximumTrimmedCoveredPermille',
        0,
        ROUTE_BASIS_MAXIMUM_TRIMMED_COVERED_PERMILLE
      ],
      ['maximumScaleAnisotropyPermille', 1000,
        ROUTE_BASIS_MAXIMUM_SCALE_ANISOTROPY_PERMILLE]
    ]) {
      if (!Number.isSafeInteger(finishing[key])
        || finishing[key] < minimum
        || finishing[key] > maximum) {
        throw new Error(
          `descriptor.routeFinishing.${key} must be an integer between `
          + `${minimum} and ${maximum}`
        );
      }
    }
    return {
      ...common,
      strategy: STRAIGHT_ROUTE_BASIS_STRATEGY,
      anchor: { x: anchor.x, y: anchor.y },
      sourceTerminalInsetPixels: finishing.sourceTerminalInsetPixels,
      outputTerminalOverflowPixels: finishing.outputTerminalOverflowPixels,
      outputPerpendicularSpanPixels:
        finishing.outputPerpendicularSpanPixels,
      maximumTrimmedCoveredPermille:
        finishing.maximumTrimmedCoveredPermille,
      maximumScaleAnisotropyPermille:
        finishing.maximumScaleAnisotropyPermille
    };
  }

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
  if (topology === 'isolated') {
    const anchor = descriptor.placement?.anchor;
    assertCoordinate(anchor?.x, 'route finishing anchor.x');
    assertCoordinate(anchor?.y, 'route finishing anchor.y');
    if (anchor.x >= width || anchor.y >= height) {
      throw new Error('route finishing anchor must be contained by the canvas');
    }
    if (anchor.x < targetBox.x
      || anchor.x >= targetBox.x + targetBox.width
      || anchor.y < targetBox.y
      || anchor.y >= targetBox.y + targetBox.height) {
      throw new Error(
        'isolated route finishing targetBox must contain the declared anchor'
      );
    }
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

function visibleReachability(data, width, height, start) {
  const visited = new Uint8Array(width * height);
  const startPixel = (start.y * width) + start.x;
  if (data[(startPixel * 4) + 3] === 0) return visited;
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 1;
  queue[0] = startPixel;
  visited[startPixel] = 1;
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
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
  return visited;
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

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function straightRouteBasis(topology, canvas) {
  const quarterWidth = canvas.width / 4;
  const quarterHeight = canvas.height / 4;
  if (!Number.isSafeInteger(quarterWidth)
    || !Number.isSafeInteger(quarterHeight)) {
    throw new Error(
      'straight route-basis finishing requires canvas dimensions divisible by 4'
    );
  }
  const verticalSign = topology === 'straight-ns' ? -1 : 1;
  const divisor = greatestCommonDivisor(quarterWidth, quarterHeight);
  const longitudinal = {
    x: quarterWidth / divisor,
    y: (verticalSign * quarterHeight) / divisor
  };
  const perpendicular = {
    x: -longitudinal.y,
    y: longitudinal.x
  };
  const lengthSquared =
    (longitudinal.x * longitudinal.x)
    + (longitudinal.y * longitudinal.y);
  return {
    longitudinal,
    perpendicular,
    lengthSquared,
    terminalProjectionNumerator: divisor * lengthSquared
  };
}

function componentBasisProjectionBounds(pixels, width, basis) {
  let minimumLongitudinal = Infinity;
  let maximumLongitudinal = -Infinity;
  let minimumPerpendicular = Infinity;
  let maximumPerpendicular = -Infinity;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const longitudinal =
      (x * basis.longitudinal.x) + (y * basis.longitudinal.y);
    const perpendicular =
      (x * basis.perpendicular.x) + (y * basis.perpendicular.y);
    minimumLongitudinal = Math.min(minimumLongitudinal, longitudinal);
    maximumLongitudinal = Math.max(maximumLongitudinal, longitudinal);
    minimumPerpendicular = Math.min(minimumPerpendicular, perpendicular);
    maximumPerpendicular = Math.max(maximumPerpendicular, perpendicular);
  }
  return {
    longitudinal: {
      minimumNumerator: minimumLongitudinal,
      maximumNumerator: maximumLongitudinal
    },
    perpendicular: {
      minimumNumerator: minimumPerpendicular,
      maximumNumerator: maximumPerpendicular
    }
  };
}

function rationalScaleAnisotropyPermille(first, second) {
  const products = [
    first.numerator * second.denominator,
    second.numerator * first.denominator
  ];
  return Math.ceil(
    (Math.max(...products) * 1000) / Math.min(...products)
  );
}

function bilinearPremultipliedPixel({
  data,
  width,
  height,
  x,
  y
}) {
  const minimumX = Math.floor(x);
  const minimumY = Math.floor(y);
  const fractionX = x - minimumX;
  const fractionY = y - minimumY;
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let offsetY = 0; offsetY <= 1; offsetY += 1) {
    for (let offsetX = 0; offsetX <= 1; offsetX += 1) {
      const sourceX = minimumX + offsetX;
      const sourceY = minimumY + offsetY;
      if (sourceX < 0 || sourceX >= width
        || sourceY < 0 || sourceY >= height) {
        continue;
      }
      const weight = (offsetX === 0 ? 1 - fractionX : fractionX)
        * (offsetY === 0 ? 1 - fractionY : fractionY);
      const index = ((sourceY * width) + sourceX) * 4;
      const weightedAlpha = weight * data[index + 3];
      alpha += weightedAlpha;
      red += weightedAlpha * data[index];
      green += weightedAlpha * data[index + 1];
      blue += weightedAlpha * data[index + 2];
    }
  }
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    Math.round(red / alpha),
    Math.round(green / alpha),
    Math.round(blue / alpha),
    Math.round(alpha)
  ];
}

async function assertSourceRouteTopology({
  canonical,
  descriptor,
  profile,
  label
}) {
  const normalized = await normalizeGeneratedRasterBytes({
    bytes: await rgbaPng(
      await resizeRgba(
        canonical.data,
        { width: canonical.width, height: canonical.height },
        descriptor.canvas
      ),
      descriptor.canvas
    ),
    descriptor,
    profile,
    format: 'png',
    label: `${label} pre-fit topology raster`
  });
  await validateRasterBytes({
    bytes: normalized,
    descriptor,
    profile,
    label: `${label} pre-fit topology raster`
  });
  return sha256(normalized);
}

async function finishStraightRouteBasisArtifact({
  sourceBytes,
  format,
  canonical,
  descriptor,
  profile,
  contract,
  label
}) {
  const sourceTopologySha256 = await assertSourceRouteTopology({
    canonical,
    descriptor,
    profile,
    label
  });
  const components = visibleComponents(
    canonical.data,
    canonical.width,
    canonical.height
  );
  if (!components.largest) {
    throw new Error(`${label} has no visible subject`);
  }
  assertUntruncated(
    components.largest.bounds,
    canonical.width,
    canonical.height,
    label
  );
  const detachedCoveredPixels = assertDetachedCoverage({
    coveredPixels: components.coveredPixels,
    selectedCoveredPixels: components.largest.pixels.length,
    maximumPermille: contract.maximumDetachedCoveredPermille,
    label
  });
  const basis = straightRouteBasis(
    descriptor.capabilities.routeTopology,
    contract.canvas
  );
  const sourceProjectionBounds = componentBasisProjectionBounds(
    components.largest.pixels,
    canonical.width,
    basis
  );
  const sourceTerminalInsetProjectionNumerator = Math.ceil(
    contract.sourceTerminalInsetPixels * Math.sqrt(basis.lengthSquared)
  );
  const trimmedLongitudinalBounds = {
    minimumNumerator:
      sourceProjectionBounds.longitudinal.minimumNumerator
      + sourceTerminalInsetProjectionNumerator,
    maximumNumerator:
      sourceProjectionBounds.longitudinal.maximumNumerator
      - sourceTerminalInsetProjectionNumerator
  };
  if (trimmedLongitudinalBounds.minimumNumerator
    >= trimmedLongitudinalBounds.maximumNumerator) {
    throw new Error(
      `${label} sourceTerminalInsetPixels removes the complete longitudinal span`
    );
  }
  let trimmedCoveredPixels = 0;
  const selected = Buffer.alloc(canonical.data.length);
  for (const pixel of components.largest.pixels) {
    const x = pixel % canonical.width;
    const y = Math.floor(pixel / canonical.width);
    const projection =
      (x * basis.longitudinal.x) + (y * basis.longitudinal.y);
    if (projection < trimmedLongitudinalBounds.minimumNumerator
      || projection > trimmedLongitudinalBounds.maximumNumerator) {
      trimmedCoveredPixels += 1;
      continue;
    }
    canonical.data.copy(selected, pixel * 4, pixel * 4, (pixel * 4) + 4);
  }
  const trimmedCoveredPermille = trimmedCoveredPixels === 0
    ? 0
    : Math.ceil(
      (trimmedCoveredPixels * 1000) / components.largest.pixels.length
    );
  if (trimmedCoveredPermille > contract.maximumTrimmedCoveredPermille) {
    throw new Error(
      `${label} source terminal inset removes ${trimmedCoveredPermille}‰ of `
      + `the dominant component; expected at most `
      + `${contract.maximumTrimmedCoveredPermille}‰`
    );
  }
  const outputTerminalOverflowProjectionNumerator = Math.floor(
    contract.outputTerminalOverflowPixels * Math.sqrt(basis.lengthSquared)
  );
  const outputPerpendicularProjectionNumerator = Math.floor(
    contract.outputPerpendicularSpanPixels * Math.sqrt(basis.lengthSquared)
  );
  const scaleLongitudinal = {
    numerator: 2 * (
      basis.terminalProjectionNumerator
      + outputTerminalOverflowProjectionNumerator
    ),
    denominator:
      trimmedLongitudinalBounds.maximumNumerator
      - trimmedLongitudinalBounds.minimumNumerator
  };
  const scalePerpendicular = {
    numerator: outputPerpendicularProjectionNumerator,
    denominator:
      sourceProjectionBounds.perpendicular.maximumNumerator
      - sourceProjectionBounds.perpendicular.minimumNumerator
  };
  if (scalePerpendicular.numerator <= 0
    || scalePerpendicular.denominator <= 0) {
    throw new Error(`${label} has no measurable perpendicular span`);
  }
  const scaleAnisotropyPermille = rationalScaleAnisotropyPermille(
    scaleLongitudinal,
    scalePerpendicular
  );
  if (scaleAnisotropyPermille
    > contract.maximumScaleAnisotropyPermille) {
    throw new Error(
      `${label} route-basis scale anisotropy is `
      + `${scaleAnisotropyPermille}‰; expected at most `
      + `${contract.maximumScaleAnisotropyPermille}‰`
    );
  }
  const sourceLongitudinalCenterNumerator = (
    trimmedLongitudinalBounds.minimumNumerator
    + trimmedLongitudinalBounds.maximumNumerator
  ) / 2;
  const sourcePerpendicularCenterNumerator = (
    sourceProjectionBounds.perpendicular.minimumNumerator
    + sourceProjectionBounds.perpendicular.maximumNumerator
  ) / 2;
  const output = Buffer.alloc(
    contract.canvas.width * contract.canvas.height * 4
  );
  for (let y = 0; y < contract.canvas.height; y += 1) {
    for (let x = 0; x < contract.canvas.width; x += 1) {
      const deltaX = x - contract.anchor.x;
      const deltaY = y - contract.anchor.y;
      const outputLongitudinalNumerator =
        (deltaX * basis.longitudinal.x)
        + (deltaY * basis.longitudinal.y);
      const outputPerpendicularNumerator =
        (deltaX * basis.perpendicular.x)
        + (deltaY * basis.perpendicular.y);
      const sourceLongitudinalNumerator =
        sourceLongitudinalCenterNumerator
        + (
          outputLongitudinalNumerator
          * scaleLongitudinal.denominator
          / scaleLongitudinal.numerator
        );
      if (sourceLongitudinalNumerator
          < trimmedLongitudinalBounds.minimumNumerator
        || sourceLongitudinalNumerator
          > trimmedLongitudinalBounds.maximumNumerator) {
        continue;
      }
      const sourcePerpendicularNumerator =
        sourcePerpendicularCenterNumerator
        + (
          outputPerpendicularNumerator
          * scalePerpendicular.denominator
          / scalePerpendicular.numerator
        );
      const sourceX = (
        (basis.longitudinal.x * sourceLongitudinalNumerator)
        + (basis.perpendicular.x * sourcePerpendicularNumerator)
      ) / basis.lengthSquared;
      const sourceY = (
        (basis.longitudinal.y * sourceLongitudinalNumerator)
        + (basis.perpendicular.y * sourcePerpendicularNumerator)
      ) / basis.lengthSquared;
      output.set(
        bilinearPremultipliedPixel({
          data: selected,
          width: canonical.width,
          height: canonical.height,
          x: sourceX,
          y: sourceY
        }),
        ((y * contract.canvas.width) + x) * 4
      );
    }
  }
  const finishedBytes = await normalizeGeneratedRasterBytes({
    bytes: await rgbaPng(output, contract.canvas),
    descriptor,
    profile,
    format: 'png',
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  return {
    bytes: finishedBytes,
    derivation: {
      schemaVersion: ROUTE_FINISHING_SCHEMA,
      strategy: STRAIGHT_ROUTE_BASIS_STRATEGY,
      source: {
        sha256: sha256(sourceBytes),
        bytes: sourceBytes.length,
        width: canonical.width,
        height: canonical.height,
        format
      },
      sourceTopologySha256,
      sourceBounds: { ...components.largest.bounds },
      componentCount: components.componentCount,
      coveredPixels: components.coveredPixels,
      selectedCoveredPixels: components.largest.pixels.length,
      detachedCoveredPixels,
      detachedCoveredPermille: detachedPermille(
        detachedCoveredPixels,
        components.coveredPixels
      ),
      maximumDetachedCoveredPermille:
        contract.maximumDetachedCoveredPermille,
      basis: {
        longitudinal: { ...basis.longitudinal },
        perpendicular: { ...basis.perpendicular },
        lengthSquared: basis.lengthSquared,
        terminalProjectionNumerator: basis.terminalProjectionNumerator
      },
      sourceProjectionBounds,
      sourceTerminalInsetPixels: contract.sourceTerminalInsetPixels,
      sourceTerminalInsetProjectionNumerator,
      trimmedLongitudinalBounds,
      trimmedCoveredPixels,
      trimmedCoveredPermille,
      maximumTrimmedCoveredPermille:
        contract.maximumTrimmedCoveredPermille,
      anchor: { ...contract.anchor },
      outputTerminalOverflowPixels:
        contract.outputTerminalOverflowPixels,
      outputTerminalOverflowProjectionNumerator,
      outputPerpendicularSpanPixels:
        contract.outputPerpendicularSpanPixels,
      outputPerpendicularProjectionNumerator,
      scaleLongitudinal,
      scalePerpendicular,
      scaleAnisotropyPermille,
      maximumScaleAnisotropyPermille:
        contract.maximumScaleAnisotropyPermille,
      kernel: 'bilinear-premultiplied-alpha-v1',
      finalSha256: sha256(finishedBytes)
    }
  };
}

function routeArmVectors(canvas) {
  return {
    n: { x: canvas.width / 4, y: -canvas.height / 4 },
    e: { x: canvas.width / 4, y: canvas.height / 4 },
    s: { x: -canvas.width / 4, y: canvas.height / 4 },
    w: { x: -canvas.width / 4, y: -canvas.height / 4 }
  };
}

function smoothstep(unit) {
  return unit * unit * (3 - (2 * unit));
}

function transitionWeight(projection, startPermille, endPermille) {
  const unit = Math.max(0, Math.min(
    1,
    ((projection * 1000) - startPermille)
      / (endPermille - startPermille)
  ));
  return smoothstep(unit);
}

async function finishCornerArmLocalWarpArtifact({
  sourceBytes,
  format,
  canonical,
  descriptor,
  profile,
  contract,
  label
}) {
  const sourceTopologySha256 = await assertSourceRouteTopology({
    canonical,
    descriptor,
    profile,
    label
  });
  const components = visibleComponents(
    canonical.data,
    canonical.width,
    canonical.height
  );
  if (!components.largest) {
    throw new Error(`${label} has no visible subject`);
  }
  assertUntruncated(
    components.largest.bounds,
    canonical.width,
    canonical.height,
    label
  );
  const detachedCoveredPixels = assertDetachedCoverage({
    coveredPixels: components.coveredPixels,
    selectedCoveredPixels: components.largest.pixels.length,
    maximumPermille: contract.maximumDetachedCoveredPermille,
    label
  });
  const selected = Buffer.alloc(canonical.data.length);
  for (const pixel of components.largest.pixels) {
    canonical.data.copy(selected, pixel * 4, pixel * 4, (pixel * 4) + 4);
  }

  const vectors = routeArmVectors(contract.canvas);
  const directions = routeDirections(descriptor.capabilities.routeTopology);
  const output = Buffer.alloc(
    contract.canvas.width * contract.canvas.height * 4
  );
  for (let y = CLEAR_BORDER_WIDTH;
    y < contract.canvas.height - CLEAR_BORDER_WIDTH;
    y += 1) {
    for (let x = CLEAR_BORDER_WIDTH;
      x < contract.canvas.width - CLEAR_BORDER_WIDTH;
      x += 1) {
      const deltaX = x - contract.anchor.x;
      const deltaY = y - contract.anchor.y;
      let selectedArm = null;
      for (const direction of directions) {
        const vector = vectors[direction];
        const lengthSquared =
          (vector.x * vector.x) + (vector.y * vector.y);
        const projection = (
          (deltaX * vector.x) + (deltaY * vector.y)
        ) / lengthSquared;
        if (selectedArm === null || projection > selectedArm.projection) {
          selectedArm = { direction, vector, lengthSquared, projection };
        }
      }
      const arm = contract.arms[selectedArm.direction];
      const transitionUnit = Math.max(0, Math.min(
        1,
        (
          (selectedArm.projection * 1000) - arm.transitionStartPermille
        ) / (arm.transitionEndPermille - arm.transitionStartPermille)
      ));
      const transition = smoothstep(transitionUnit);
      const perpendicularScale = 1 + (
        ((arm.perpendicularScalePermille - 1000) / 1000) * transition
      );
      const length = Math.sqrt(selectedArm.lengthSquared);
      const perpendicular = {
        x: -selectedArm.vector.y / length,
        y: selectedArm.vector.x / length
      };
      const centerX = selectedArm.vector.x * selectedArm.projection;
      const centerY = selectedArm.vector.y * selectedArm.projection;
      const sourcePerpendicularOffset =
        arm.perpendicularOffsetPixels * transition;
      const mappedX = contract.anchor.x + centerX
        + (perpendicular.x * sourcePerpendicularOffset)
        + ((deltaX - centerX) / perpendicularScale);
      const mappedY = contract.anchor.y + centerY
        + (perpendicular.y * sourcePerpendicularOffset)
        + ((deltaY - centerY) / perpendicularScale);
      const sourceX = (
        (mappedX + 0.5) * canonical.width / contract.canvas.width
      ) - 0.5;
      const sourceY = (
        (mappedY + 0.5) * canonical.height / contract.canvas.height
      ) - 0.5;
      output.set(
        bilinearPremultipliedPixel({
          data: selected,
          width: canonical.width,
          height: canonical.height,
          x: sourceX,
          y: sourceY
        }),
        ((y * contract.canvas.width) + x) * 4
      );
    }
  }
  const finishedBytes = await normalizeGeneratedRasterBytes({
    bytes: await rgbaPng(output, contract.canvas),
    descriptor,
    profile,
    format: 'png',
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  await validateRasterBytes({
    bytes: finishedBytes,
    descriptor,
    profile,
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  await validateFinishedRouteArtifact({
    bytes: finishedBytes,
    descriptor,
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });

  const terminals = Object.fromEntries(directions.map(direction => ([
    direction,
    {
      x: contract.anchor.x + vectors[direction].x,
      y: contract.anchor.y + vectors[direction].y
    }
  ])));
  return {
    bytes: finishedBytes,
    derivation: {
      schemaVersion: ROUTE_FINISHING_SCHEMA,
      strategy: CORNER_ARM_LOCAL_WARP_STRATEGY,
      source: {
        sha256: sha256(sourceBytes),
        bytes: sourceBytes.length,
        width: canonical.width,
        height: canonical.height,
        format
      },
      sourceTopologySha256,
      sourceBounds: { ...components.largest.bounds },
      componentCount: components.componentCount,
      coveredPixels: components.coveredPixels,
      selectedCoveredPixels: components.largest.pixels.length,
      detachedCoveredPixels,
      detachedCoveredPermille: detachedPermille(
        detachedCoveredPixels,
        components.coveredPixels
      ),
      maximumDetachedCoveredPermille:
        contract.maximumDetachedCoveredPermille,
      anchor: { ...contract.anchor },
      terminals,
      arms: structuredClone(contract.arms),
      maximumCoveragePermille: contract.maximumCoveragePermille,
      maximumScaleAnisotropyPermille:
        contract.maximumScaleAnisotropyPermille,
      maximumAppliedScalePermille: Math.max(
        ...Object.values(contract.arms).map(
          arm => arm.perpendicularScalePermille
        )
      ),
      borderClearPixels: CLEAR_BORDER_WIDTH,
      armSelector: 'greatest-longitudinal-projection-v1',
      transition: 'smoothstep-v1',
      kernel: 'bilinear-premultiplied-alpha-v1',
      finalSha256: sha256(finishedBytes)
    }
  };
}

async function finishMultiArmLocalWarpArtifact({
  sourceBytes,
  format,
  canonical,
  descriptor,
  profile,
  contract,
  label
}) {
  const sourceTopologySha256 = await assertSourceRouteTopology({
    canonical,
    descriptor,
    profile,
    label
  });
  const components = visibleComponents(
    canonical.data,
    canonical.width,
    canonical.height
  );
  if (!components.largest) {
    throw new Error(`${label} has no visible subject`);
  }
  assertUntruncated(
    components.largest.bounds,
    canonical.width,
    canonical.height,
    label
  );
  const detachedCoveredPixels = assertDetachedCoverage({
    coveredPixels: components.coveredPixels,
    selectedCoveredPixels: components.largest.pixels.length,
    maximumPermille: contract.maximumDetachedCoveredPermille,
    label
  });
  const selected = Buffer.from(canonical.data);

  const vectors = routeArmVectors(contract.canvas);
  const directions = routeDirections(descriptor.capabilities.routeTopology);
  const output = Buffer.alloc(
    contract.canvas.width * contract.canvas.height * 4
  );
  for (let y = CLEAR_BORDER_WIDTH;
    y < contract.canvas.height - CLEAR_BORDER_WIDTH;
    y += 1) {
    for (let x = CLEAR_BORDER_WIDTH;
      x < contract.canvas.width - CLEAR_BORDER_WIDTH;
      x += 1) {
      const deltaX = x - contract.anchor.x;
      const deltaY = y - contract.anchor.y;
      let selectedArm = null;
      for (const direction of directions) {
        const vector = vectors[direction];
        const lengthSquared =
          (vector.x * vector.x) + (vector.y * vector.y);
        const projection = (
          (deltaX * vector.x) + (deltaY * vector.y)
        ) / lengthSquared;
        if (selectedArm === null || projection > selectedArm.projection) {
          selectedArm = { direction, vector, lengthSquared, projection };
        }
      }
      const arm = contract.arms[selectedArm.direction];
      const scaleTransition = transitionWeight(
        selectedArm.projection,
        arm.scaleTransitionStartPermille,
        arm.scaleTransitionEndPermille
      );
      const offsetTransition = transitionWeight(
        selectedArm.projection,
        arm.offsetTransitionStartPermille,
        arm.offsetTransitionEndPermille
      );
      const perpendicularScale = (
        arm.perpendicularStartScalePermille
        + (
          (arm.perpendicularScalePermille
            - arm.perpendicularStartScalePermille)
          * scaleTransition
        )
      ) / 1000;
      const length = Math.sqrt(selectedArm.lengthSquared);
      const perpendicular = {
        x: -selectedArm.vector.y / length,
        y: selectedArm.vector.x / length
      };
      const centerX = selectedArm.vector.x * selectedArm.projection;
      const centerY = selectedArm.vector.y * selectedArm.projection;
      const sourcePerpendicularOffset =
        arm.perpendicularOffsetPixels * offsetTransition;
      const mappedX = contract.anchor.x + centerX
        + (perpendicular.x * sourcePerpendicularOffset)
        + ((deltaX - centerX) / perpendicularScale);
      const mappedY = contract.anchor.y + centerY
        + (perpendicular.y * sourcePerpendicularOffset)
        + ((deltaY - centerY) / perpendicularScale);
      const sourceX = (
        (mappedX + 0.5) * canonical.width / contract.canvas.width
      ) - 0.5;
      const sourceY = (
        (mappedY + 0.5) * canonical.height / contract.canvas.height
      ) - 0.5;
      output.set(
        bilinearPremultipliedPixel({
          data: selected,
          width: canonical.width,
          height: canonical.height,
          x: sourceX,
          y: sourceY
        }),
        ((y * contract.canvas.width) + x) * 4
      );
    }
  }
  const finishedBytes = await normalizeGeneratedRasterBytes({
    bytes: await rgbaPng(output, contract.canvas),
    descriptor,
    profile,
    format: 'png',
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  await validateRasterBytes({
    bytes: finishedBytes,
    descriptor,
    profile,
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  const finished = await validateFinishedRouteArtifact({
    bytes: finishedBytes,
    descriptor,
    label: `${descriptor.id ?? 'route artifact'} finished raster`
  });
  const terminals = Object.fromEntries(directions.map(direction => ([
    direction,
    {
      x: contract.anchor.x + vectors[direction].x,
      y: contract.anchor.y + vectors[direction].y
    }
  ])));
  return {
    bytes: finishedBytes,
    derivation: {
      schemaVersion: ROUTE_FINISHING_SCHEMA,
      strategy: MULTI_ARM_LOCAL_WARP_STRATEGY,
      source: {
        sha256: sha256(sourceBytes),
        bytes: sourceBytes.length,
        width: canonical.width,
        height: canonical.height,
        format
      },
      sourceTopologySha256,
      sourceBounds: { ...components.largest.bounds },
      componentCount: components.componentCount,
      coveredPixels: components.coveredPixels,
      selectedCoveredPixels: components.largest.pixels.length,
      sourceSampling: 'all-visible-components-v1',
      detachedCoveredPixels,
      detachedCoveredPermille: detachedPermille(
        detachedCoveredPixels,
        components.coveredPixels
      ),
      maximumDetachedCoveredPermille:
        contract.maximumDetachedCoveredPermille,
      anchor: { ...contract.anchor },
      terminals,
      arms: structuredClone(contract.arms),
      maximumCoveragePermille: contract.maximumCoveragePermille,
      maximumScaleAnisotropyPermille:
        contract.maximumScaleAnisotropyPermille,
      maximumAppliedScalePermille: Math.max(
        ...Object.values(contract.arms).flatMap(arm => [
          arm.perpendicularStartScalePermille,
          arm.perpendicularScalePermille
        ])
      ),
      maximumFinishedDetachedCoveredPermille:
        contract.maximumFinishedDetachedCoveredPermille,
      finishedDetachedCoveredPixels: finished.detachedCoveredPixels,
      finishedDetachedCoveredPermille: finished.detachedCoveredPermille,
      borderClearPixels: CLEAR_BORDER_WIDTH,
      armSelector: 'greatest-longitudinal-projection-v1',
      transition: 'independent-smoothstep-v1',
      armMeasurement: 'centerline-intersecting-run-v1',
      kernel: 'bilinear-premultiplied-alpha-v1',
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

function centerlineIntersectingPerpendicularOpaqueSpan({
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
  let currentRun = [];
  const runs = [];
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
    if (opaque) {
      currentRun.push(distance);
    } else if (currentRun.length > 0) {
      runs.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) runs.push(currentRun);
  const centered = runs.find(
    run => run[0] <= 0 && run[run.length - 1] >= 0
  );
  return centered?.length ?? 0;
}

function assertCornerCoreWidth({ data, width, height, topology, anchor, label }) {
  const axis = ['corner-es', 'corner-wn'].includes(topology)
    ? 'vertical'
    : ['corner-ne', 'corner-sw'].includes(topology)
      ? 'horizontal'
      : null;
  if (axis === null) return;
  const fixedAnchor = axis === 'vertical' ? anchor.x : anchor.y;
  const runAnchor = axis === 'vertical' ? anchor.y : anchor.x;
  const fixedLimit = axis === 'vertical' ? width : height;
  const runLimit = axis === 'vertical' ? height : width;
  const fixedStart = Math.max(0, fixedAnchor - CORNER_CORE_SCAN_RADIUS);
  const fixedEnd = Math.min(
    fixedLimit - 1,
    fixedAnchor + CORNER_CORE_SCAN_RADIUS
  );
  const intersectionStart = Math.max(
    0,
    runAnchor - CORNER_CORE_ANCHOR_INTERSECTION_RADIUS
  );
  const intersectionEnd = Math.min(
    runLimit - 1,
    runAnchor + CORNER_CORE_ANCHOR_INTERSECTION_RADIUS
  );
  let maximumRun = 0;
  for (let fixed = fixedStart; fixed <= fixedEnd; fixed += 1) {
    let runStart = null;
    for (let run = 0; run <= runLimit; run += 1) {
      const x = axis === 'vertical' ? fixed : run;
      const y = axis === 'vertical' ? run : fixed;
      const opaque = run < runLimit
        && data[(((y * width) + x) * 4) + 3]
          >= CORNER_CORE_ALPHA_THRESHOLD;
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
  if (maximumRun < CORNER_MINIMUM_CORE_WIDTH) {
    throw new Error(
      `${label} route corner ${topology} maximum anchor-intersecting opaque `
      + `${axis} run is ${maximumRun} pixels; expected at least `
      + CORNER_MINIMUM_CORE_WIDTH
    );
  }
}

export async function validateFinishedRouteArtifact({
  bytes,
  descriptor,
  label = `${descriptor?.id ?? 'route artifact'} finished raster`
} = {}) {
  const contract = routeFinishingContract(descriptor);
  const topology = descriptor.capabilities?.routeTopology;
  const directions = routeDirections(topology);
  const isolated = topology === 'isolated';
  if (directions.length === 0 && !isolated) {
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
  if (isolated) {
    let coveredPixels = 0;
    let anchorContact = false;
    for (let y = 0; y < contract.canvas.height; y += 1) {
      for (let x = 0; x < contract.canvas.width; x += 1) {
        const alpha = data[(((y * contract.canvas.width) + x) * 4) + 3];
        if (alpha === 0) continue;
        coveredPixels += 1;
        if (Math.abs(x - anchor.x) <= 12
          && Math.abs(y - anchor.y) <= 12) {
          anchorContact = true;
        }
        if (x < contract.targetBox.x
          || x >= contract.targetBox.x + contract.targetBox.width
          || y < contract.targetBox.y
          || y >= contract.targetBox.y + contract.targetBox.height) {
          throw new Error(
            `${label} isolated route has a visible pixel outside its `
            + `descriptor-pinned targetBox at ${x},${y}`
          );
        }
      }
    }
    if (coveredPixels === 0) {
      throw new Error(`${label} has no visible subject`);
    }
    if (!anchorContact) {
      throw new Error(
        `${label} alpha silhouette does not contact its declared anchor`
      );
    }
    const components = visibleComponents(
      data,
      contract.canvas.width,
      contract.canvas.height
    );
    if (components.componentCount !== 1) {
      throw new Error(
        `${label} isolated route must contain exactly one 4-connected visible `
        + `component; found ${components.componentCount}`
      );
    }
    const totalPixels = contract.canvas.width * contract.canvas.height;
    return {
      samples: [],
      coveredPixels,
      totalPixels,
      coveragePermille: Math.floor((coveredPixels * 1000) / totalPixels)
    };
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
  const multiArmLocal = contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY;
  const armSpanPolicy = multiArmLocal
    ? {
        sampleFractions: ARM_SAMPLE_FRACTIONS,
        ...contract.armAlphaSpan
      }
    : armSpanValidationPolicy(topology, contract.armAlphaSpan);
  assertCornerCoreWidth({
    data,
    width: contract.canvas.width,
    height: contract.canvas.height,
    topology,
    anchor,
    label
  });
  const samples = [];
  const sampleFractions = multiArmLocal
    ? ARM_SAMPLE_FRACTIONS
    : armSpanPolicy.sampleFractions;
  for (const direction of directions) {
    const vector = vectors[direction];
    for (const fraction of sampleFractions) {
      samples.push({
        direction,
        percent: Math.round(fraction * 100),
        span: (multiArmLocal
          ? centerlineIntersectingPerpendicularOpaqueSpan
          : perpendicularOpaqueSpan)({
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
  const anchorAlpha = data[
    (((anchor.y * contract.canvas.width) + anchor.x) * 4) + 3
  ];
  if (contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY
    && anchorAlpha < armSpanPolicy.alphaThreshold) {
    throw new Error(
      `${label} multi-arm route anchor alpha is ${anchorAlpha}; expected at `
      + `least ${armSpanPolicy.alphaThreshold}`
    );
  }
  if (contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY) {
    const reachable = visibleReachability(
      data,
      contract.canvas.width,
      contract.canvas.height,
      anchor
    );
    for (const direction of directions) {
      const terminal = {
        x: anchor.x + vectors[direction].x,
        y: anchor.y + vectors[direction].y
      };
      const alpha = data[
        (((terminal.y * contract.canvas.width) + terminal.x) * 4) + 3
      ];
      if (alpha < armSpanPolicy.alphaThreshold) {
        throw new Error(
          `${label} multi-arm route ${direction} exact terminal alpha is `
          + `${alpha}; expected at least ${armSpanPolicy.alphaThreshold}`
        );
      }
      if (!reachable[(terminal.y * contract.canvas.width) + terminal.x]) {
        throw new Error(
          `${label} multi-arm route ${direction} exact terminal is not `
          + '4-connected to its declared anchor'
        );
      }
    }
  }
  let coveredPixels = 0;
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    if (data[pixel + 3] !== 0) coveredPixels += 1;
  }
  let detachedCoveredPixels = 0;
  let detachedCoveredPermille = 0;
  if (contract.strategy === CORNER_ARM_LOCAL_WARP_STRATEGY
    || contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY) {
    const finishedComponents = visibleComponents(
      data,
      contract.canvas.width,
      contract.canvas.height
    );
    detachedCoveredPixels = assertDetachedCoverage({
      coveredPixels: finishedComponents.coveredPixels,
      selectedCoveredPixels: finishedComponents.largest?.pixels.length ?? 0,
      maximumPermille: contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY
        ? contract.maximumFinishedDetachedCoveredPermille
        : contract.maximumDetachedCoveredPermille,
      label
    });
    detachedCoveredPermille = detachedPermille(
      detachedCoveredPixels,
      finishedComponents.coveredPixels
    );
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
  if (topology.startsWith('corner-')
    && contract.maximumCoveragePermille !== undefined
    && coveredPixels * 1000
      > contract.maximumCoveragePermille * totalPixels) {
    throw new Error(
      `${label} corner route ${topology} alpha coverage is `
      + `${coveragePermille}‰; expected at most `
      + `${contract.maximumCoveragePermille}‰`
    );
  }
  if (contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY
    && coveredPixels * 1000
      > contract.maximumCoveragePermille * totalPixels) {
    throw new Error(
      `${label} multi-arm route ${topology} alpha coverage is `
      + `${coveragePermille}‰; expected at most `
      + `${contract.maximumCoveragePermille}‰`
    );
  }
  return {
    samples,
    coveredPixels,
    totalPixels,
    coveragePermille,
    ...(contract.strategy === CORNER_ARM_LOCAL_WARP_STRATEGY
      || contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY
      ? { detachedCoveredPixels, detachedCoveredPermille }
      : {})
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
  if (contract.strategy === STRAIGHT_ROUTE_BASIS_STRATEGY) {
    return finishStraightRouteBasisArtifact({
      sourceBytes,
      format,
      canonical,
      descriptor,
      profile,
      contract,
      label
    });
  }
  if (contract.strategy === CORNER_ARM_LOCAL_WARP_STRATEGY) {
    return finishCornerArmLocalWarpArtifact({
      sourceBytes,
      format,
      canonical,
      descriptor,
      profile,
      contract,
      label
    });
  }
  if (contract.strategy === MULTI_ARM_LOCAL_WARP_STRATEGY) {
    return finishMultiArmLocalWarpArtifact({
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
