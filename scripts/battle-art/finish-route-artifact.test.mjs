import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import sharp from 'sharp';

import {
  ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS,
  assertRouteSourceExtent,
  finishRouteArtifact,
  validateFinishedRouteArtifact
} from './finish-route-artifact.mjs';

const PROFILE = Object.freeze({
  background: Object.freeze({
    chroma: '#ff00ff',
    tolerance: 24
  })
});

function descriptor(overrides = {}) {
  return {
    id: 'test-route-artifact',
    category: 'route-transition',
    canvas: { width: 32, height: 24 },
    rasterContract: {
      schemaVersion: 'battle-art-raster-contract-v1',
      kind: 'transparent-cutout',
      minimumCoveredPermille: 1,
      maximumCoveredPermille: 900
    },
    routeFinishing: {
      schemaVersion: 'battle-art-route-finishing-v1',
      strategy: 'largest-component-box-v1',
      targetBox: { x: 6, y: 5, width: 18, height: 12 },
      maximumDetachedCoveredPermille: 16,
      armAlphaSpan: {
        alphaThreshold: 240,
        minimumPixels: 4,
        maximumPixels: 20,
        maximumSpreadPixels: 16
      }
    },
    ...overrides
  };
}

function anchorScaleDescriptor({
  scalePermille = 1250,
  anchor = { x: 16, y: 12 },
  finishing = {},
  ...overrides
} = {}) {
  const base = descriptor();
  return descriptor({
    placement: { anchor },
    capabilities: { routeTopology: 'straight-ns' },
    ...overrides,
    routeFinishing: {
      schemaVersion: 'battle-art-route-finishing-v1',
      strategy: 'anchor-scale-v1',
      scalePermille,
      maximumDetachedCoveredPermille:
        base.routeFinishing.maximumDetachedCoveredPermille,
      armAlphaSpan: { ...base.routeFinishing.armAlphaSpan },
      ...finishing
    }
  });
}

async function sourcePng({
  width = 20,
  height = 15,
  main = { x: 4, y: 3, width: 12, height: 8 },
  detached = []
} = {}) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((y * width) + x) * 4;
      const inMain = x >= main.x
        && x < main.x + main.width
        && y >= main.y
        && y < main.y + main.height;
      const fragment = detached.some(pixel => pixel.x === x && pixel.y === y);
      data[index] = inMain ? 112 : fragment ? 24 : 255;
      data[index + 1] = inMain ? 78 : fragment ? 88 : 0;
      data[index + 2] = inMain ? 39 : fragment ? 176 : 255;
      data[index + 3] = 255;
    }
  }
  return sharp(data, {
    raw: { width, height, channels: 4 }
  }).png().toBuffer();
}

async function alphaBounds(bytes) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minimumX = info.width;
  let minimumY = info.height;
  let maximumX = -1;
  let maximumY = -1;
  let blueFragmentPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = ((y * info.width) + x) * 4;
      if (data[index + 3] === 0) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      if (data[index + 2] > data[index]) blueFragmentPixels += 1;
    }
  }
  return {
    width: info.width,
    height: info.height,
    bounds: {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1
    },
    blueFragmentPixels
  };
}

async function sampledArmsPng({
  canvas,
  anchor,
  spans
}) {
  const vectors = {
    n: { x: canvas.width / 4, y: -canvas.height / 4 },
    e: { x: canvas.width / 4, y: canvas.height / 4 },
    s: { x: -canvas.width / 4, y: canvas.height / 4 },
    w: { x: -canvas.width / 4, y: -canvas.height / 4 }
  };
  const pixels = Buffer.alloc(canvas.width * canvas.height * 4);
  for (const [sampleKey, span] of Object.entries(spans)) {
    const direction = sampleKey[0];
    const percent = Number(sampleKey.slice(1));
    const vector = vectors[direction];
    const sample = {
      x: anchor.x + (vector.x * percent / 100),
      y: anchor.y + (vector.y * percent / 100)
    };
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
      if (
        point.x >= 0
        && point.x < canvas.width
        && point.y >= 0
        && point.y < canvas.height
      ) {
        line.push(point);
      }
    }
    const center = line.findIndex(
      point => point.x === sample.x && point.y === sample.y
    );
    const start = center - Math.floor((span - 1) / 2);
    for (const point of line.slice(start, start + span)) {
      pixels.set(
        [117, 76, 36, 255],
        ((point.y * canvas.width) + point.x) * 4
      );
    }
  }
  return sharp(pixels, {
    raw: { ...canvas, channels: 4 }
  }).png().toBuffer();
}

describe('bounded route artifact finishing', () => {
  it('bounds source pixels to the reviewed image-generation envelope', () => {
    assert.doesNotThrow(() => assertRouteSourceExtent(2048, 2048));
    assert.equal(
      2048 * 2048,
      ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS
    );
    assert.throws(
      () => assertRouteSourceExtent(2048, 2049),
      /has 4196352 pixels; expected at most 4194304/
    );
    assert.throws(
      () => assertRouteSourceExtent(4097, 1),
      /must be an integer between 1 and 4096/
    );
  });

  it('is byte deterministic and places the selected subject at the exact box',
    async () => {
      const source = await sourcePng({
        detached: [{ x: 15, y: 13 }]
      });
      const first = await finishRouteArtifact({
        bytes: source,
        descriptor: descriptor(),
        profile: PROFILE
      });
      const second = await finishRouteArtifact({
        bytes: source,
        descriptor: descriptor(),
        profile: PROFILE
      });

      assert.deepEqual(first.bytes, second.bytes);
      assert.deepEqual(first.derivation, second.derivation);
      assert.deepEqual(await alphaBounds(first.bytes), {
        width: 32,
        height: 24,
        bounds: { x: 6, y: 5, width: 18, height: 12 },
        blueFragmentPixels: 0
      });
      assert.deepEqual(first.derivation.sourceBounds, {
        x: 4,
        y: 3,
        width: 12,
        height: 8
      });
      assert.equal(first.derivation.componentCount, 2);
      assert.equal(first.derivation.coveredPixels, 97);
      assert.equal(first.derivation.selectedCoveredPixels, 96);
      assert.equal(first.derivation.detachedCoveredPixels, 1);
      assert.equal(first.derivation.detachedCoveredPermille, 11);
      assert.deepEqual(first.derivation.scaleX, {
        numerator: 18,
        denominator: 12
      });
      assert.deepEqual(first.derivation.scaleY, {
        numerator: 12,
        denominator: 8
      });
      assert.equal(
        first.derivation.source.sha256,
        `sha256:${createHash('sha256').update(source).digest('hex')}`
      );
      assert.equal(
        first.derivation.finalSha256,
        `sha256:${createHash('sha256').update(first.bytes).digest('hex')}`
      );
    });

  it('deterministically enlarges the whole normalized canvas about its anchor',
    async () => {
      const source = await sourcePng({
        width: 32,
        height: 24,
        main: { x: 10, y: 8, width: 12, height: 8 },
        detached: [{ x: 24, y: 12 }]
      });
      const routeDescriptor = anchorScaleDescriptor();
      const first = await finishRouteArtifact({
        bytes: source,
        descriptor: routeDescriptor,
        profile: PROFILE
      });
      const second = await finishRouteArtifact({
        bytes: source,
        descriptor: routeDescriptor,
        profile: PROFILE
      });

      assert.deepEqual(first.bytes, second.bytes);
      assert.deepEqual(first.derivation, second.derivation);
      assert.deepEqual(
        Object.keys(first.derivation).sort(),
        [
          'anchor',
          'borderClearPixels',
          'finalSha256',
          'forbiddenBandClearPixels',
          'kernel',
          'scalePermille',
          'schemaVersion',
          'source',
          'strategy'
        ]
      );
      assert.equal(
        first.derivation.schemaVersion,
        'battle-art-route-finishing-v1'
      );
      assert.equal(first.derivation.strategy, 'anchor-scale-v1');
      assert.equal(first.derivation.scalePermille, 1250);
      assert.deepEqual(first.derivation.anchor, { x: 16, y: 12 });
      assert.equal(first.derivation.borderClearPixels, 4);
      assert.equal(first.derivation.forbiddenBandClearPixels, 0);
      assert.equal(first.derivation.kernel, 'lanczos3');
      assert.deepEqual(first.derivation.source, {
        sha256: `sha256:${createHash('sha256').update(source).digest('hex')}`,
        bytes: source.length,
        width: 32,
        height: 24,
        format: 'png'
      });
      assert.equal(Object.hasOwn(first.derivation.source, 'path'), false);
      assert.equal(
        first.derivation.finalSha256,
        `sha256:${createHash('sha256').update(first.bytes).digest('hex')}`
      );

      const geometry = await alphaBounds(first.bytes);
      assert.ok(geometry.bounds.width > 12);
      assert.ok(geometry.bounds.height > 8);
      assert.ok(geometry.blueFragmentPixels > 0);
      const { data, info } = await sharp(first.bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          if (x >= 4 && x < info.width - 4
            && y >= 4 && y < info.height - 4) continue;
          assert.equal(data[(((y * info.width) + x) * 4) + 3], 0);
        }
      }
    });

  it('rejects invalid anchor-scale factors, anchors, and foreign options',
    async () => {
      const source = await sourcePng({ width: 32, height: 24 });
      for (const [invalid, message] of [
        [
          anchorScaleDescriptor({ scalePermille: 1000 }),
          /scalePermille must be an integer between 1001 and 1500/
        ],
        [
          anchorScaleDescriptor({ scalePermille: 1501 }),
          /scalePermille must be an integer between 1001 and 1500/
        ],
        [
          anchorScaleDescriptor({ scalePermille: 1100.5 }),
          /scalePermille must be an integer between 1001 and 1500/
        ],
        [
          anchorScaleDescriptor({ anchor: { x: -1, y: 12 } }),
          /anchor\.x must be a nonnegative integer/
        ],
        [
          anchorScaleDescriptor({ anchor: { x: 32, y: 12 } }),
          /anchor must be contained by the canvas/
        ],
        [
          anchorScaleDescriptor({ anchor: { x: 16, y: 12.5 } }),
          /anchor\.y must be a nonnegative integer/
        ],
        ...[
          ['targetBox', { x: 1, y: 1, width: 10, height: 10 }],
          ['maximumScaleAnisotropyPermille', 1250],
          ['terminalClip', {
            schemaVersion: 'battle-art-route-terminal-clip-v1',
            maximumOverflowPixels: 1
          }],
          ['geometryPrime', { schemaVersion: 'geometry-prime-v1' }]
        ].map(([key, value]) => [
          anchorScaleDescriptor({ finishing: { [key]: value } }),
          new RegExp(
            `routeFinishing\\.${key} is not allowed for anchor-scale-v1`
          )
        ])
      ]) {
        await assert.rejects(
          finishRouteArtifact({
            bytes: source,
            descriptor: invalid,
            profile: PROFILE
          }),
          message
        );
      }
    });

  it('enforces the detached covered-pixel bound before selecting the subject',
    async () => {
      const source = await sourcePng({
        detached: [{ x: 15, y: 13 }]
      });
      const strict = descriptor({
        routeFinishing: {
          ...descriptor().routeFinishing,
          maximumDetachedCoveredPermille: 10
        }
      });
      await assert.rejects(
        finishRouteArtifact({
          bytes: source,
          descriptor: strict,
          profile: PROFILE
        }),
        /detached alpha coverage is 11‰; expected at most 10‰/
      );
    });

  it('accepts the exact 1.25 subject-scale anisotropy boundary', async () => {
    const bounded = descriptor({
      routeFinishing: {
        ...descriptor().routeFinishing,
        targetBox: { x: 6, y: 2, width: 20, height: 20 }
      }
    });
    const result = await finishRouteArtifact({
      bytes: await sourcePng({
        width: 40,
        height: 30,
        main: { x: 10, y: 2, width: 20, height: 25 }
      }),
      descriptor: bounded,
      profile: PROFILE
    });

    assert.deepEqual(result.derivation.sourceBounds, {
      x: 10,
      y: 2,
      width: 20,
      height: 25
    });
  });

  it('rejects subject-scale anisotropy immediately above 1.25', async () => {
    const bounded = descriptor({
      routeFinishing: {
        ...descriptor().routeFinishing,
        targetBox: { x: 6, y: 2, width: 20, height: 20 }
      }
    });
    await assert.rejects(
      finishRouteArtifact({
        bytes: await sourcePng({
          width: 40,
          height: 30,
          main: { x: 10, y: 2, width: 20, height: 26 }
        }),
        descriptor: bounded,
        profile: PROFILE
      }),
      new RegExp(
        'subject bounds 20x26 at \\(10,2\\) require anisotropy 1\\.300000 '
        + 'to fit targetBox 20x20 at \\(6,2\\); maximum is 1\\.250000'
      )
    );
  });

  it('honors a descriptor-pinned measured-prime anisotropy limit', async () => {
    const bounded = descriptor({
      routeFinishing: {
        ...descriptor().routeFinishing,
        targetBox: { x: 6, y: 2, width: 20, height: 20 },
        maximumScaleAnisotropyPermille: 1350
      }
    });
    const result = await finishRouteArtifact({
      bytes: await sourcePng({
        width: 40,
        height: 30,
        main: { x: 10, y: 2, width: 20, height: 27 }
      }),
      descriptor: bounded,
      profile: PROFILE
    });
    assert.equal(result.derivation.targetBox.width, 20);

    await assert.rejects(
      finishRouteArtifact({
        bytes: await sourcePng({
          width: 40,
          height: 30,
          main: { x: 10, y: 1, width: 20, height: 28 }
        }),
        descriptor: bounded,
        profile: PROFILE
      }),
      /require anisotropy 1\.400000 .*maximum is 1\.350000/
    );
  });

  it('clips only straight-route pixels beyond descriptor-pinned terminal planes',
    async () => {
      const clipped = descriptor({
        placement: { anchor: { x: 16, y: 12 } },
        capabilities: { routeTopology: 'straight-ns' },
        routeFinishing: {
          ...descriptor().routeFinishing,
          targetBox: { x: 2, y: 2, width: 28, height: 20 },
          terminalClip: {
            schemaVersion: 'battle-art-route-terminal-clip-v1',
            maximumOverflowPixels: 6
          }
        }
      });
      const result = await finishRouteArtifact({
        bytes: await sourcePng({
          width: 40,
          height: 30,
          main: { x: 2, y: 2, width: 36, height: 26 }
        }),
        descriptor: clipped,
        profile: PROFILE
      });
      assert.equal(
        result.derivation.terminalClip.maximumOverflowPixels,
        6
      );
      assert.ok(result.derivation.terminalClip.clearedPixels > 0);

      const { data, info } = await sharp(result.bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const vectors = [
        { x: info.width / 4, y: -info.height / 4 },
        { x: -info.width / 4, y: info.height / 4 }
      ];
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          if (data[((y * info.width) + x) * 4 + 3] === 0) continue;
          for (const vector of vectors) {
            const lengthSquared =
              (vector.x * vector.x) + (vector.y * vector.y);
            const overflowDot =
              ((x - 16) * vector.x)
              + ((y - 12) * vector.y)
              - lengthSquared;
            assert.ok(
              overflowDot <= 0
              || overflowDot * overflowDot <= 36 * lengthSquared
            );
          }
        }
      }
    });

  it('rejects the 233x826 vertical canary before distortion', async () => {
    const canary = descriptor({
      canvas: { width: 256, height: 128 },
      routeFinishing: {
        ...descriptor().routeFinishing,
        targetBox: { x: 16, y: 4, width: 224, height: 120 }
      }
    });
    await assert.rejects(
      finishRouteArtifact({
        bytes: await sourcePng({
          width: 2048,
          height: 1024,
          main: { x: 900, y: 99, width: 233, height: 826 }
        }),
        descriptor: canary,
        profile: PROFILE
      }),
      new RegExp(
        'subject bounds 233x826 at \\(900,99\\) require anisotropy 6\\.617454 '
        + 'to fit targetBox 224x120 at \\(16,4\\); maximum is 1\\.250000'
      )
    );
  });

  it('records a WebP source while emitting canonical PNG bytes', async () => {
    const webp = await sharp(await sourcePng())
      .webp({ lossless: true })
      .toBuffer();
    const result = await finishRouteArtifact({
      bytes: webp,
      descriptor: descriptor(),
      profile: PROFILE
    });

    assert.equal(result.derivation.source.format, 'webp');
    assert.deepEqual(
      result.bytes.subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });

  it('rejects a source whose aspect ratio differs from the route canvas',
    async () => {
      await assert.rejects(
        finishRouteArtifact({
          bytes: await sourcePng({ width: 20, height: 16 }),
          descriptor: descriptor(),
          profile: PROFILE
        }),
        /aspect ratio 20:16 does not match declared route canvas 32:24/
      );
    });

  it('rejects a largest subject component truncated by the source border',
    async () => {
      const source = await sourcePng({
        main: { x: 0, y: 3, width: 8, height: 8 }
      });
      await assert.rejects(
        finishRouteArtifact({
          bytes: source,
          descriptor: descriptor(),
          profile: PROFILE
        }),
        /largest alpha component touches the source border and is truncated/
      );
    });

  it('rejects invalid finishing contracts and target boxes', async () => {
    const source = await sourcePng();
    const base = descriptor();
    for (const [invalid, message] of [
      [
        descriptor({
          routeFinishing: { ...base.routeFinishing, schemaVersion: 'v2' }
        }),
        /schemaVersion must be battle-art-route-finishing-v1/
      ],
      [
        descriptor({
          routeFinishing: { ...base.routeFinishing, strategy: 'search-v1' }
        }),
        /strategy must be largest-component-box-v1/
      ],
      [
        descriptor({
          routeFinishing: {
            ...base.routeFinishing,
            targetBox: { x: 20, y: 5, width: 18, height: 12 }
          }
        }),
        /targetBox must be contained by the canvas/
      ],
      [
        descriptor({
          routeFinishing: {
            ...base.routeFinishing,
            maximumDetachedCoveredPermille: 151
          }
        }),
        /maximumDetachedCoveredPermille must be an integer between 0 and 150/
      ]
    ]) {
      await assert.rejects(
        finishRouteArtifact({
          bytes: source,
          descriptor: invalid,
          profile: PROFILE
        }),
        message
      );
    }
  });

  it('rejects missing and empty source content', async () => {
    for (const bytes of [undefined, Buffer.alloc(0)]) {
      await assert.rejects(
        finishRouteArtifact({
          bytes,
          descriptor: descriptor(),
          profile: PROFILE
        }),
        /source bytes must be nonempty/
      );
    }
    await assert.rejects(
      finishRouteArtifact({
        bytes: await sourcePng({ main: { x: 0, y: 0, width: 0, height: 0 } }),
        descriptor: descriptor(),
        profile: PROFILE
      }),
      /has no visible subject/
    );
  });

  it('reports every route-arm sample and simultaneous violation', async () => {
    const canvas = { width: 256, height: 128 };
    const anchor = { x: 128, y: 64 };
    const routeDescriptor = descriptor({
      canvas,
      capabilities: { routeTopology: 'straight-ns' },
      placement: { anchor },
      routeFinishing: {
        ...descriptor().routeFinishing,
        targetBox: { x: 16, y: 4, width: 224, height: 120 },
        armAlphaSpan: {
          alphaThreshold: 240,
          minimumPixels: 36,
          maximumPixels: 44,
          maximumSpreadPixels: 8
        }
      }
    });
    const bytes = await sampledArmsPng({
      canvas,
      anchor,
      spans: {
        n50: 35,
        n75: 45,
        n100: 40,
        s50: 46,
        s75: 33,
        s100: 36
      }
    });

    await assert.rejects(
      validateFinishedRouteArtifact({
        bytes,
        descriptor: routeDescriptor
      }),
      new RegExp(
        'route straight-ns n arm opaque perpendicular span at 50% is 35 '
        + 'pixels; expected at least 36; '
        + 'samples: n50=35,n75=45,n100=40,s50=46,s75=33,s100=36; '
        + 'allowed: 36\\.\\.44 pixels at alpha >= 240, maximum spread 8 pixels; '
        + 'violating samples: n50=35 \\(<36\\),n75=45 \\(>44\\),'
        + 's50=46 \\(>44\\),s75=33 \\(<36\\); '
        + 'violating range: 33\\.\\.46 \\(spread 13 > 8\\)'
      )
    );
  });

  it('measures tee arms beyond the junction and caps permissive descriptors',
    async () => {
      const canvas = { width: 256, height: 128 };
      const anchor = { x: 128, y: 64 };
      const routeDescriptor = descriptor({
        canvas,
        capabilities: { routeTopology: 'tee-esw' },
        placement: { anchor },
        routeFinishing: {
          ...descriptor().routeFinishing,
          targetBox: { x: 16, y: 4, width: 224, height: 120 },
          armAlphaSpan: {
            alphaThreshold: 240,
            minimumPixels: 28,
            maximumPixels: 120,
            maximumSpreadPixels: 100
          }
        }
      });
      const valid = await validateFinishedRouteArtifact({
        bytes: await sampledArmsPng({
          canvas,
          anchor,
          spans: {
            e75: 40,
            e100: 40,
            s75: 42,
            s100: 39,
            w75: 44,
            w100: 34
          }
        }),
        descriptor: routeDescriptor
      });
      assert.deepEqual(
        valid.samples.map(sample => `${sample.direction}${sample.percent}`),
        ['e75', 'e100', 's75', 's100', 'w75', 'w100']
      );

      await assert.rejects(
        validateFinishedRouteArtifact({
          bytes: await sampledArmsPng({
            canvas,
            anchor,
            spans: {
              e75: 40,
              e100: 40,
              s75: 42,
              s100: 39,
              w75: 65,
              w100: 34
            }
          }),
          descriptor: routeDescriptor
        }),
        /w arm opaque perpendicular span at 75% is 65 pixels; expected at most 64/
      );
    });

  it('contains one fixed transform and no exhaustive-fit machinery',
    async () => {
      const moduleSource = await readFile(
        new URL('./finish-route-artifact.mjs', import.meta.url),
        'utf8'
      );
      assert.equal(moduleSource.match(/\.extract\(/g)?.length, 1);
      assert.equal(moduleSource.match(/\.resize\(/g)?.length, 1);
      assert.doesNotMatch(moduleSource, /scalePermille\s*[+\-]=/);
      assert.doesNotMatch(
        moduleSource,
        /fit-route-candidate|\benumerat|\bgrid|\bsearch|\bretr|\bscor|\bsynth|\bfinalist/i
      );
    });
});
