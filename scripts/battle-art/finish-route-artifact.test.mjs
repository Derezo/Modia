import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import sharp from 'sharp';

import {
  auditFailedRouteAttempt,
  assertRouteStraightMaximumLongitudinalExtent,
  validatePreparedRouteGeometry
} from './generate.mjs';
import {
  ROUTE_FINISHING_MAXIMUM_SOURCE_PIXELS,
  assertRouteSourceExtent,
  finishRouteArtifact,
  validateFinishedRouteArtifact
} from './finish-route-artifact.mjs';
import {
  normalizeGeneratedRasterBytes,
  validateRasterBytes
} from './raster-contract.mjs';

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

function isolatedDescriptor(overrides = {}) {
  const base = descriptor();
  return descriptor({
    capabilities: { routeTopology: 'isolated' },
    placement: { anchor: { x: 15, y: 11 } },
    ...overrides,
    routeFinishing: {
      ...base.routeFinishing,
      maximumDetachedCoveredPermille: 0,
      ...overrides.routeFinishing
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

  it('deterministically recovers the exact tracked cave end-e failed raw',
    async () => {
      const descriptorUrl = new URL(
        '../../ai-image-metadata/battle-art/descriptors/cave/'
          + 'cave-limestone-curved-passage-end-e.json',
        import.meta.url
      );
      const routeDescriptor = JSON.parse(await readFile(descriptorUrl));
      const profile = JSON.parse(await readFile(new URL(
        '../../ai-image-metadata/battle-art/prompts/family-v2.json',
        import.meta.url
      )));
      const failurePath =
        'ai-image-metadata/battle-art/generated-artifacts/cave/'
        + 'cave-limestone-curved-passage-end-e/failures/'
        + '2adf19d488183e613297203f7859642b3095b1ae6059616bf820132f3b366074.json';
      const failure = await auditFailedRouteAttempt({
        relativePath: failurePath
      });

      assert.deepEqual(routeDescriptor.routeFinishing, {
        schemaVersion: 'battle-art-route-finishing-v1',
        strategy: 'anchor-scale-v1',
        scalePermille: 1150,
        maximumDetachedCoveredPermille: 0,
        armAlphaSpan: {
          alphaThreshold: 240,
          minimumPixels: 20,
          maximumPixels: 52,
          maximumSpreadPixels: 12
        }
      });
      const descriptorBeforeRecovery = structuredClone(routeDescriptor);
      delete descriptorBeforeRecovery.routeFinishing;
      assert.deepEqual(
        descriptorBeforeRecovery,
        failure.record.descriptor.snapshot
      );
      assert.equal(
        failure.file.sha256,
        'sha256:aa914f53dcb88c9c04323d139b8c9f019a1de6af7ffde3f2d3d465107a6616cb'
      );
      assert.equal(
        failure.record.fullHash,
        'sha256:2adf19d488183e613297203f7859642b3095b1ae6059616bf820132f3b366074'
      );
      assert.equal(
        failure.record.descriptor.sha256,
        'sha256:d104f1bcb751e605db5e67634bdc3e2377d68e1578762763f86efa1ff398fc5f'
      );
      assert.deepEqual(failure.record.raw, {
        path: 'ai-image-metadata/battle-art/generated-artifacts/cave/'
          + 'cave-limestone-curved-passage-end-e/'
          + '9a461b3b221cecfe01bea7cb96b84b150992225dc6c7bc4e6b1c63b92a8f8bd4.png',
        bytes: 1170290,
        width: 1774,
        height: 887,
        format: 'png',
        sha256:
          'sha256:9a461b3b221cecfe01bea7cb96b84b150992225dc6c7bc4e6b1c63b92a8f8bd4'
      });

      const first = await finishRouteArtifact({
        bytes: failure.rawBytes,
        descriptor: routeDescriptor,
        profile
      });
      const second = await finishRouteArtifact({
        bytes: failure.rawBytes,
        descriptor: routeDescriptor,
        profile
      });
      assert.deepEqual(first.bytes, second.bytes);
      assert.deepEqual(first.derivation, second.derivation);
      assert.equal(first.bytes.length, 16366);
      assert.deepEqual(first.derivation, {
        schemaVersion: 'battle-art-route-finishing-v1',
        strategy: 'anchor-scale-v1',
        source: {
          sha256:
            'sha256:9a461b3b221cecfe01bea7cb96b84b150992225dc6c7bc4e6b1c63b92a8f8bd4',
          bytes: 1170290,
          width: 1774,
          height: 887,
          format: 'png'
        },
        scalePermille: 1150,
        anchor: { x: 128, y: 64 },
        borderClearPixels: 4,
        forbiddenBandClearPixels: 0,
        kernel: 'lanczos3',
        finalSha256:
          'sha256:a68ff0f96fa10adf8293504b03a4dcf4c34e9c387655f5ef31004d73e1de5375'
      });

      const finishedValidation = await validateFinishedRouteArtifact({
        bytes: first.bytes,
        descriptor: routeDescriptor
      });
      assert.deepEqual(finishedValidation, {
        samples: [
          { direction: 'e', percent: 50, span: 28 },
          { direction: 'e', percent: 75, span: 27 },
          { direction: 'e', percent: 100, span: 22 }
        ],
        coveredPixels: 5280,
        totalPixels: 32768,
        coveragePermille: 161
      });
      const rasterValidation = await validateRasterBytes({
        bytes: first.bytes,
        descriptor: routeDescriptor,
        profile
      });
      assert.deepEqual(rasterValidation.metrics.alphaBounds, {
        x: 67,
        y: 27,
        width: 147,
        height: 81
      });
      assert.equal(rasterValidation.metrics.coveredPixels, 5280);
      assert.equal(rasterValidation.metrics.coveredPermille, 161);
      await assert.doesNotReject(validatePreparedRouteGeometry({
        bytes: first.bytes,
        descriptor: routeDescriptor,
        finished: true
      }));
    });

  it('deterministically arm-local finishes the two exact cave corner raws',
    async () => {
      const profile = JSON.parse(await readFile(new URL(
        '../../ai-image-metadata/battle-art/prompts/family-v2.json',
        import.meta.url
      )));
      const cases = [
        {
          family: 'cave-limestone-curved-passage-corner-sw',
          raw: 'd6578f5f0c0d335aa30bdfe434d1e3c286938555f403863c54cecc2809c01ad2',
          final: '7545e6f6a11e47a6d08cbb587181031911ac0e0d2fe42b7558d9e5e6f9ccecd1',
          bounds: { x: 116, y: 30, width: 875, height: 825 },
          components: [20, 266308, 266190, 118, 1],
          terminals: { s: { x: 64, y: 96 }, w: { x: 64, y: 32 } },
          samples: [45, 48, 30, 40, 32, 33],
          coverage: [6566, 200]
        },
        {
          family: 'cave-limestone-curved-passage-corner-ne',
          raw: '396a6795ed15d72952919d48843bfb3064d6d243cced98dbca504954ac55bb42',
          final: '421b10da98b70e715acd82b146b0a7187341f1257d81237eee5d8d62c8cae87d',
          bounds: { x: 768, y: 52, width: 824, height: 809 },
          components: [133, 204154, 202021, 2133, 11],
          terminals: { n: { x: 192, y: 32 }, e: { x: 192, y: 96 } },
          samples: [49, 36, 28, 44, 28, 28],
          coverage: [5509, 168]
        }
      ];
      for (const routeCase of cases) {
        const routeDescriptor = JSON.parse(await readFile(new URL(
          '../../ai-image-metadata/battle-art/descriptors/cave/'
            + `${routeCase.family}.json`,
          import.meta.url
        )));
        const source = await readFile(new URL(
          '../../ai-image-metadata/battle-art/generated-artifacts/cave/'
            + `${routeCase.family}/${routeCase.raw}.png`,
          import.meta.url
        ));
        assert.equal(
          createHash('sha256').update(source).digest('hex'),
          routeCase.raw
        );
        const first = await finishRouteArtifact({
          bytes: source,
          descriptor: routeDescriptor,
          profile
        });
        const second = await finishRouteArtifact({
          bytes: source,
          descriptor: routeDescriptor,
          profile
        });
        assert.deepEqual(first.bytes, second.bytes);
        assert.deepEqual(first.derivation, second.derivation);
        assert.equal(first.derivation.strategy, 'corner-arm-local-warp-v1');
        assert.equal(first.derivation.finalSha256, `sha256:${routeCase.final}`);
        assert.deepEqual(first.derivation.sourceBounds, routeCase.bounds);
        assert.deepEqual([
          first.derivation.componentCount,
          first.derivation.coveredPixels,
          first.derivation.selectedCoveredPixels,
          first.derivation.detachedCoveredPixels,
          first.derivation.detachedCoveredPermille
        ], routeCase.components);
        assert.deepEqual(first.derivation.anchor, { x: 128, y: 64 });
        assert.deepEqual(first.derivation.terminals, routeCase.terminals);
        assert.equal(first.derivation.borderClearPixels, 4);
        assert.equal(
          first.derivation.armSelector,
          'greatest-longitudinal-projection-v1'
        );
        assert.equal(first.derivation.transition, 'smoothstep-v1');
        assert.equal(
          first.derivation.kernel,
          'bilinear-premultiplied-alpha-v1'
        );
        const validation = await validateFinishedRouteArtifact({
          bytes: first.bytes,
          descriptor: routeDescriptor
        });
        assert.deepEqual(
          validation.samples.map(sample => sample.span),
          routeCase.samples
        );
        assert.deepEqual(
          [validation.coveredPixels, validation.coveragePermille],
          routeCase.coverage
        );
        await assert.doesNotReject(validateRasterBytes({
          bytes: first.bytes,
          descriptor: routeDescriptor,
          profile
        }));
        await assert.doesNotReject(validatePreparedRouteGeometry({
          bytes: first.bytes,
          descriptor: routeDescriptor,
          finished: true
        }));
      }
    });

  it('keeps corner arm-local finishing closed to bounded corner contracts',
    async () => {
      const routeDescriptor = JSON.parse(await readFile(new URL(
        '../../ai-image-metadata/battle-art/descriptors/cave/'
          + 'cave-limestone-curved-passage-corner-ne.json',
        import.meta.url
      )));
      const profile = JSON.parse(await readFile(new URL(
        '../../ai-image-metadata/battle-art/prompts/family-v2.json',
        import.meta.url
      )));
      const source = await readFile(new URL(
        '../../ai-image-metadata/battle-art/generated-artifacts/cave/'
          + `${routeDescriptor.id}/`
          + '396a6795ed15d72952919d48843bfb3064d6d243cced98dbca504954ac55bb42.png',
        import.meta.url
      ));
      const invalidContracts = [
        [
          { maximumCoveragePermille: 231 },
          /maximumCoveragePermille must be an integer between 1 and 230/
        ],
        [
          { maximumScaleAnisotropyPermille: 1501 },
          /maximumScaleAnisotropyPermille must be an integer between 1000 and 1500/
        ],
        [
          { foreignSearchOption: true },
          /foreignSearchOption is not allowed/
        ]
      ];
      for (const [finishing, message] of invalidContracts) {
        await assert.rejects(
          finishRouteArtifact({
            bytes: source,
            descriptor: {
              ...routeDescriptor,
              routeFinishing: {
                ...routeDescriptor.routeFinishing,
                ...finishing
              }
            },
            profile
          }),
          message
        );
      }
      await assert.rejects(
        finishRouteArtifact({
          bytes: source,
          descriptor: {
            ...routeDescriptor,
            capabilities: {
              ...routeDescriptor.capabilities,
              routeTopology: 'straight-ns'
            }
          },
          profile
        }),
        /requires a corner topology/
      );
      await assert.rejects(
        finishRouteArtifact({
          bytes: source,
          descriptor: {
            ...routeDescriptor,
            routeFinishing: {
              ...routeDescriptor.routeFinishing,
              arms: {
                ...routeDescriptor.routeFinishing.arms,
                n: {
                  ...routeDescriptor.routeFinishing.arms.n,
                  perpendicularScalePermille: 1501
                }
              }
            }
          },
          profile
        }),
        /perpendicularScalePermille exceeds its hard anisotropy cap/
      );
    });

  it('deterministically multi-arm finishes the exact cave cross and tee raws',
    async () => {
      const profile = JSON.parse(await readFile(new URL(
        '../../ai-image-metadata/battle-art/prompts/family-v2.json',
        import.meta.url
      )));
      const cases = [
        {
          family: 'cave-limestone-curved-passage-cross',
          failure: '7e20a22acb5cde38544cefd2c76d7631bd7fbcbd6532f3f055210637f3373e7f',
          failureFile: '4c95c3c2029f0e1f308d9602bb95820e5b6799b834bf441620f707452ff6ba6c',
          final: '89f634333fc8e602efe9b0c9f89363e2042da78b23a1c587b3660ab23d4379ba',
          bytes: 38988,
          bounds: { x: 29, y: 4, width: 198, height: 120 },
          source: [61, 216534, 214402, 2132, 10],
          samples: [28, 30, 29, 29, 29, 30, 29, 29, 32, 28, 30, 30],
          coverage: [12518, 382],
          detached: [114, 10]
        },
        {
          family: 'cave-limestone-curved-passage-tee-esw',
          failure: 'd45d3f819ee6e66aca7bb2263ac6288d72fb1802150109f1497289bd571ed5d9',
          failureFile: '305db5b01578a2ed96c3c1e4dae1691779759c9d58cf17425da474a1091f0737',
          final: '5f86b76533cc83aa42be7fcfb2789694d9030fac19fa941daad5c98e7263c10e',
          bytes: 23998,
          bounds: { x: 41, y: 10, width: 162, height: 109 },
          source: [4, 214588, 214585, 3, 1],
          samples: [32, 31, 30, 31, 32, 32, 33, 33, 34],
          coverage: [8296, 253],
          detached: [0, 0]
        },
        {
          family: 'cave-limestone-curved-passage-tee-nes',
          failure: '814be1295cfd4785c0ce0cb37e0ebeb7e99aa9d469f364dc1a76b766d0e8c98a',
          failureFile: 'd0f88c9459a6525029360facc5e90987af56c807e4d371f21839c116ceb78c83',
          final: 'ad6d570462a7e1074ab2bf417ba6a12f50b4cdba37c0e15028b927ca93ca7465',
          bytes: 27486,
          bounds: { x: 23, y: 12, width: 207, height: 110 },
          source: [16, 246495, 246461, 34, 1],
          samples: [31, 31, 31, 31, 32, 34, 31, 32, 32],
          coverage: [9349, 285],
          detached: [0, 0]
        },
        {
          family: 'cave-limestone-curved-passage-tee-nsw',
          failure: 'f1acb480ad736728307a384d2d6d724f15907e8c197e6c5576d40615b352ab61',
          failureFile: '9c179d6278dc7876f220c057a42a4d47604e28e504587660e66dc752ab119ca6',
          final: '4a3cd99671a9b01c16687592f3f03915671645d8ead772f559687c8ab35a561d',
          bytes: 31176,
          bounds: { x: 19, y: 4, width: 223, height: 120 },
          source: [222, 251544, 245928, 5616, 23],
          samples: [32, 30, 32, 38, 32, 31, 32, 29, 29],
          coverage: [10336, 315],
          detached: [176, 18]
        },
        {
          family: 'cave-limestone-curved-passage-tee-wne',
          failure: '3edd76fd2a2062df3cc641fd959f13a91c57d930c126a63bf51841370635ae05',
          failureFile: '2255390b51c91c2501a8246d07c622db182985f47f135af497b07ecd24efcfd7',
          final: 'f9718b9dc96e9bb735e0e24a6fad6cb1f049705ffd9c071c8e1fe299e9629998',
          bytes: 29576,
          bounds: { x: 14, y: 4, width: 226, height: 116 },
          source: [1, 335918, 335918, 0, 0],
          samples: [32, 32, 32, 33, 32, 33, 32, 32, 33],
          coverage: [10683, 326],
          detached: [0, 0]
        }
      ];
      for (const routeCase of cases) {
        const routeDescriptor = JSON.parse(await readFile(new URL(
          '../../ai-image-metadata/battle-art/descriptors/cave/'
            + `${routeCase.family}.json`,
          import.meta.url
        )));
        const failurePath =
          'ai-image-metadata/battle-art/generated-artifacts/cave/'
          + `${routeCase.family}/failures/${routeCase.failure}.json`;
        const failure = await auditFailedRouteAttempt({
          relativePath: failurePath
        });
        assert.equal(
          failure.file.sha256,
          `sha256:${routeCase.failureFile}`
        );
        assert.equal(failure.record.fullHash, `sha256:${routeCase.failure}`);
        const descriptorBeforeRecovery = structuredClone(routeDescriptor);
        delete descriptorBeforeRecovery.routeFinishing;
        assert.deepEqual(
          descriptorBeforeRecovery,
          failure.record.descriptor.snapshot
        );
        assert.equal(routeDescriptor.routeFinishing.strategy,
          'multi-arm-local-warp-v1');
        if (routeCase.family.endsWith('-cross')) {
          const resized = await sharp(failure.rawBytes, { failOn: 'error' })
            .resize(256, 128, {
              fit: 'fill',
              kernel: sharp.kernel.lanczos3
            })
            .png({ compressionLevel: 9, palette: false })
            .toBuffer();
          const direct = await normalizeGeneratedRasterBytes({
            bytes: resized,
            descriptor: routeDescriptor,
            profile,
            format: 'png'
          });
          await assert.rejects(validateFinishedRouteArtifact({
            bytes: direct,
            descriptor: routeDescriptor
          }), /samples: n50=10,n75=9,n100=10,e50=9,e75=10,e100=11,s50=9,s75=10,s100=10,w50=10,w75=10,w100=11/);
        }

        const first = await finishRouteArtifact({
          bytes: failure.rawBytes,
          descriptor: routeDescriptor,
          profile
        });
        const second = await finishRouteArtifact({
          bytes: failure.rawBytes,
          descriptor: routeDescriptor,
          profile
        });
        assert.deepEqual(first, second);
        assert.equal(first.bytes.length, routeCase.bytes);
        assert.equal(first.derivation.finalSha256, `sha256:${routeCase.final}`);
        assert.equal(first.derivation.source.sha256,
          failure.record.raw.sha256);
        assert.deepEqual([
          first.derivation.componentCount,
          first.derivation.coveredPixels,
          first.derivation.selectedCoveredPixels,
          first.derivation.detachedCoveredPixels,
          first.derivation.detachedCoveredPermille
        ], routeCase.source);
        assert.deepEqual(first.derivation.arms,
          routeDescriptor.routeFinishing.arms);
        assert.equal(first.derivation.armSelector,
          'greatest-longitudinal-projection-v1');
        assert.equal(first.derivation.sourceSampling,
          'all-visible-components-v1');
        assert.equal(first.derivation.transition,
          'independent-smoothstep-v1');
        assert.equal(first.derivation.armMeasurement,
          'centerline-intersecting-run-v1');
        assert.equal(first.derivation.kernel,
          'bilinear-premultiplied-alpha-v1');
        if (routeCase.family.endsWith('-cross')) {
          const decoded = await sharp(first.bytes)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          const vectors = {
            n: { x: 64, y: -32 },
            e: { x: 64, y: 32 },
            s: { x: -64, y: 32 },
            w: { x: -64, y: -32 }
          };
          for (let y = 0; y < 128; y += 1) {
            for (let x = 0; x < 256; x += 1) {
              const deltaX = x - 128;
              const deltaY = y - 64;
              const selected = Object.entries(vectors)
                .map(([direction, vector]) => ({
                  direction,
                  projection: (
                    (deltaX * vector.x) + (deltaY * vector.y)
                  ) / 5120
                }))
                .sort((left, right) => right.projection - left.projection)[0];
              if (selected.direction === 'n'
                && selected.projection > 0.84
                && selected.projection < 0.9) {
                decoded.data.fill(0, ((y * 256) + x) * 4,
                  (((y * 256) + x) * 4) + 4);
              }
            }
          }
          const disconnected = await sharp(decoded.data, {
            raw: { width: 256, height: 128, channels: 4 }
          }).png().toBuffer();
          await assert.doesNotReject(validateRasterBytes({
            bytes: disconnected,
            descriptor: routeDescriptor,
            profile
          }));
          await assert.rejects(validateFinishedRouteArtifact({
            bytes: disconnected,
            descriptor: routeDescriptor
          }), /n exact terminal is not 4-connected to its declared anchor/);
        }
        if (routeCase.family.endsWith('-tee-nsw')) {
          const decoded = await sharp(first.bytes)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          const sample = { x: 160, y: 48 };
          const perpendicular = {
            x: 32 / Math.hypot(64, 32),
            y: 64 / Math.hypot(64, 32)
          };
          const painted = new Set();
          for (let distance = -60; distance <= 60; distance += 1) {
            const x = Math.round(sample.x
              + (perpendicular.x * distance));
            const y = Math.round(sample.y
              + (perpendicular.y * distance));
            const key = `${x},${y}`;
            if (painted.has(key) || x < 4 || x >= 252 || y < 4 || y >= 124) {
              continue;
            }
            painted.add(key);
            decoded.data.set([117, 76, 36, 255], ((y * 256) + x) * 4);
          }
          assert.ok(painted.size > 100);
          const overwide = await sharp(decoded.data, {
            raw: { width: 256, height: 128, channels: 4 }
          }).png().toBuffer();
          await assert.rejects(validateFinishedRouteArtifact({
            bytes: overwide,
            descriptor: routeDescriptor
          }), /n arm opaque perpendicular span at 50% is .*expected at most 100/);
        }

        const validation = await validateFinishedRouteArtifact({
          bytes: first.bytes,
          descriptor: routeDescriptor
        });
        assert.deepEqual(
          validation.samples.map(sample => sample.span),
          routeCase.samples
        );
        assert.deepEqual([
          validation.coveredPixels,
          validation.coveragePermille
        ], routeCase.coverage);
        assert.deepEqual([
          validation.detachedCoveredPixels,
          validation.detachedCoveredPermille
        ], routeCase.detached);
        const raster = await validateRasterBytes({
          bytes: first.bytes,
          descriptor: routeDescriptor,
          profile
        });
        assert.deepEqual(raster.metrics.alphaBounds, routeCase.bounds);
        await assert.doesNotReject(validatePreparedRouteGeometry({
          bytes: first.bytes,
          descriptor: routeDescriptor,
          finished: true
        }));
      }
    });

  it('keeps multi-arm finishing closed and measures only centerline runs',
    async () => {
      const routeDescriptor = JSON.parse(await readFile(new URL(
        '../../ai-image-metadata/battle-art/descriptors/cave/'
          + 'cave-limestone-curved-passage-cross.json',
        import.meta.url
      )));
      const failure = await auditFailedRouteAttempt({
        relativePath:
          'ai-image-metadata/battle-art/generated-artifacts/cave/'
          + 'cave-limestone-curved-passage-cross/failures/'
          + '7e20a22acb5cde38544cefd2c76d7631bd7fbcbd6532f3f055210637f3373e7f.json'
      });
      const profile = JSON.parse(await readFile(new URL(
        '../../ai-image-metadata/battle-art/prompts/family-v2.json',
        import.meta.url
      )));
      for (const [change, message] of [
        [{ capabilities: { routeTopology: 'corner-ne' } },
          /requires a cross or tee topology/],
        [{ routeFinishing: {
          ...routeDescriptor.routeFinishing,
          searchSteps: 10
        } }, /searchSteps is not allowed/],
        [{ routeFinishing: {
          ...routeDescriptor.routeFinishing,
          maximumScaleAnisotropyPermille: 3501
        } }, /maximumScaleAnisotropyPermille must be an integer between/]
      ]) {
        await assert.rejects(finishRouteArtifact({
          bytes: failure.rawBytes,
          descriptor: { ...routeDescriptor, ...change },
          profile
        }), message);
      }
    });

  it('deterministically route-basis finishes the exact cave straight-ns raw',
    async () => {
    const routeDescriptor = JSON.parse(await readFile(new URL(
      '../../ai-image-metadata/battle-art/descriptors/cave/'
        + 'cave-limestone-curved-passage-straight-ns.json',
      import.meta.url
    )));
    const profile = JSON.parse(await readFile(new URL(
      '../../ai-image-metadata/battle-art/prompts/family-v2.json',
      import.meta.url
    )));
    const source = await readFile(new URL(
      '../../ai-image-metadata/battle-art/generated-artifacts/cave/'
        + 'cave-limestone-curved-passage-straight-ns/'
        + '3c4b780878920ec14e10e912039d8c83f019a9e93f054123afd4dbe71adb153f.png',
      import.meta.url
    ));
    const first = await finishRouteArtifact({
      bytes: source,
      descriptor: routeDescriptor,
      profile
    });
    const second = await finishRouteArtifact({
      bytes: source,
      descriptor: routeDescriptor,
      profile
    });

    assert.deepEqual(first.bytes, second.bytes);
    assert.deepEqual(first.derivation, second.derivation);
    assert.equal(
      first.derivation.finalSha256,
      'sha256:015fbffd4035ae510d7f32456096e593fed364b385dd81fd13b6a390fe208f58'
    );
    assert.deepEqual(first.derivation.sourceBounds, {
      x: 171,
      y: 102,
      width: 1444,
      height: 688
    });
    assert.deepEqual(first.derivation.sourceProjectionBounds, {
      longitudinal: {
        minimumNumerator: -398,
        maximumNumerator: 3080
      },
      perpendicular: {
        minimumNumerator: 1601,
        maximumNumerator: 1956
      }
    });
    assert.equal(first.derivation.componentCount, 4);
    assert.equal(first.derivation.coveredPixels, 193769);
    assert.equal(first.derivation.selectedCoveredPixels, 193726);
    assert.equal(first.derivation.detachedCoveredPixels, 43);
    assert.equal(first.derivation.detachedCoveredPermille, 1);
    assert.equal(first.derivation.sourceTerminalInsetPixels, 240);
    assert.equal(
      first.derivation.sourceTerminalInsetProjectionNumerator,
      537
    );
    assert.deepEqual(first.derivation.trimmedLongitudinalBounds, {
      minimumNumerator: 139,
      maximumNumerator: 2543
    });
    assert.equal(first.derivation.trimmedCoveredPixels, 50333);
    assert.equal(first.derivation.trimmedCoveredPermille, 260);
    assert.deepEqual(first.derivation.scaleLongitudinal, {
      numerator: 350,
      denominator: 2404
    });
    assert.deepEqual(first.derivation.scalePerpendicular, {
      numerator: 98,
      denominator: 355
    });
    assert.equal(first.derivation.scaleAnisotropyPermille, 1897);
    assert.equal(
      first.derivation.sourceTopologySha256,
      'sha256:51833ffb1becd9abfd1fb9ea9ddd84c623eb046fa140c1e77fc335d4ee585c58'
    );

    const raster = await validateRasterBytes({
      bytes: first.bytes,
      descriptor: routeDescriptor,
      profile,
      label: 'exact cave straight-ns route-basis result'
    });
    assert.deepEqual(raster.metrics.alphaBounds, {
      x: 49,
      y: 15,
      width: 159,
      height: 99
    });
    const validation = await validateFinishedRouteArtifact({
      bytes: first.bytes,
      descriptor: routeDescriptor
    });
    assert.deepEqual(validation.samples, [
      { direction: 'n', percent: 50, span: 35 },
      { direction: 'n', percent: 75, span: 34 },
      { direction: 'n', percent: 100, span: 35 },
      { direction: 's', percent: 50, span: 34 },
      { direction: 's', percent: 75, span: 34 },
      { direction: 's', percent: 100, span: 35 }
    ]);
    assert.equal(validation.coveredPixels, 5832);
    assert.equal(validation.coveragePermille, 177);
    await assert.doesNotReject(validatePreparedRouteGeometry({
      bytes: first.bytes,
      descriptor: routeDescriptor,
      finished: true
    }));

    await assert.rejects(
      finishRouteArtifact({
        bytes: source,
        descriptor: {
          ...routeDescriptor,
          capabilities: {
            ...routeDescriptor.capabilities,
            routeTopology: 'straight-ew'
          }
        },
        profile
      }),
      /endpoint|topology|straight-ew/u
    );
    await assert.rejects(
      finishRouteArtifact({
        bytes: source,
        descriptor: {
          ...routeDescriptor,
          routeFinishing: {
            ...routeDescriptor.routeFinishing,
            maximumScaleAnisotropyPermille: 1896
          }
        },
        profile
      }),
      /scale anisotropy is 1897‰; expected at most 1896‰/
    );
    await assert.rejects(
      finishRouteArtifact({
        bytes: source,
        descriptor: {
          ...routeDescriptor,
          routeFinishing: {
            ...routeDescriptor.routeFinishing,
            maximumTrimmedCoveredPermille: 259
          }
        },
        profile
      }),
      /source terminal inset removes 260‰.*expected at most 259‰/
    );
    await assert.rejects(
      finishRouteArtifact({
        bytes: source,
        descriptor: {
          ...routeDescriptor,
          routeFinishing: {
            ...routeDescriptor.routeFinishing,
            maximumScaleAnisotropyPermille: 3251
          }
        },
        profile
      }),
      /maximumScaleAnisotropyPermille must be an integer between 1000 and 3250/
    );
  });

  it('deterministically route-basis finishes the exact cave straight-ew raw',
    async () => {
    const routeDescriptor = JSON.parse(await readFile(new URL(
      '../../ai-image-metadata/battle-art/descriptors/cave/'
        + 'cave-limestone-curved-passage-straight-ew.json',
      import.meta.url
    )));
    const profile = JSON.parse(await readFile(new URL(
      '../../ai-image-metadata/battle-art/prompts/family-v2.json',
      import.meta.url
    )));
    const source = await readFile(new URL(
      '../../ai-image-metadata/battle-art/generated-artifacts/cave/'
        + 'cave-limestone-curved-passage-straight-ew/'
        + '37c832f99d79b852919e494237c71726520623907c52c21a8faa59b19b2f07f8.png',
      import.meta.url
    ));
    const first = await finishRouteArtifact({
      bytes: source,
      descriptor: routeDescriptor,
      profile
    });
    const second = await finishRouteArtifact({
      bytes: source,
      descriptor: routeDescriptor,
      profile
    });

    assert.deepEqual(first.bytes, second.bytes);
    assert.deepEqual(first.derivation, second.derivation);
    assert.equal(
      first.derivation.finalSha256,
      'sha256:b5e01a3f10679e09f058e878c58aaf89fe18b3abc6cf6265251be5490ea1f316'
    );
    assert.deepEqual(first.derivation.sourceBounds, {
      x: 170,
      y: 129,
      width: 1429,
      height: 644
    });
    assert.deepEqual(first.derivation.sourceProjectionBounds, {
      longitudinal: {
        minimumNumerator: 494,
        maximumNumerator: 3928
      },
      perpendicular: {
        minimumNumerator: -187,
        maximumNumerator: 209
      }
    });
    assert.equal(first.derivation.componentCount, 163);
    assert.equal(first.derivation.coveredPixels, 137034);
    assert.equal(first.derivation.selectedCoveredPixels, 134782);
    assert.equal(first.derivation.detachedCoveredPixels, 2252);
    assert.equal(first.derivation.detachedCoveredPermille, 17);
    assert.equal(first.derivation.sourceTerminalInsetPixels, 195);
    assert.equal(
      first.derivation.sourceTerminalInsetProjectionNumerator,
      437
    );
    assert.deepEqual(first.derivation.trimmedLongitudinalBounds, {
      minimumNumerator: 931,
      maximumNumerator: 3491
    });
    assert.equal(first.derivation.trimmedCoveredPixels, 30222);
    assert.equal(first.derivation.trimmedCoveredPermille, 225);
    assert.deepEqual(first.derivation.scaleLongitudinal, {
      numerator: 350,
      denominator: 2560
    });
    assert.deepEqual(first.derivation.scalePerpendicular, {
      numerator: 169,
      denominator: 396
    });
    assert.equal(first.derivation.scaleAnisotropyPermille, 3122);
    assert.equal(
      first.derivation.sourceTopologySha256,
      'sha256:1a6093923b7d5e9fcfe34d55537016d09a05d9519bfd6110d01f236b2b9b2dfb'
    );

    const raster = await validateRasterBytes({
      bytes: first.bytes,
      descriptor: routeDescriptor,
      profile,
      label: 'exact cave straight-ew route-basis result'
    });
    assert.deepEqual(raster.metrics.alphaBounds, {
      x: 48,
      y: 17,
      width: 164,
      height: 88
    });
    const validation = await validateFinishedRouteArtifact({
      bytes: first.bytes,
      descriptor: routeDescriptor
    });
    assert.deepEqual(validation.samples, [
      { direction: 'e', percent: 50, span: 36 },
      { direction: 'e', percent: 75, span: 34 },
      { direction: 'e', percent: 100, span: 35 },
      { direction: 'w', percent: 50, span: 34 },
      { direction: 'w', percent: 75, span: 34 },
      { direction: 'w', percent: 100, span: 36 }
    ]);
    assert.equal(validation.coveredPixels, 6209);
    assert.equal(validation.coveragePermille, 189);
    assert.deepEqual(
      await assertRouteStraightMaximumLongitudinalExtent({
        bytes: first.bytes,
        descriptor: routeDescriptor
      }),
      {
        samples: [
          {
            direction: 'e',
            maximumProjection: 1.09375,
            maximumOverflowPixels: 6.708203932499369,
            maximumPoint: { x: 211, y: 73 }
          },
          {
            direction: 'w',
            maximumProjection: 1.09375,
            maximumOverflowPixels: 6.708203932499369,
            maximumPoint: { x: 62, y: 21 }
          }
        ]
      }
    );
    await assert.doesNotReject(validatePreparedRouteGeometry({
      bytes: first.bytes,
      descriptor: routeDescriptor,
      finished: true
    }));

    await assert.rejects(
      finishRouteArtifact({
        bytes: source,
        descriptor: {
          ...routeDescriptor,
          routeFinishing: {
            ...routeDescriptor.routeFinishing,
            maximumDetachedCoveredPermille: 16
          }
        },
        profile
      }),
      /detached alpha coverage is 17‰; expected at most 16‰/
    );
    await assert.rejects(
      finishRouteArtifact({
        bytes: source,
        descriptor: {
          ...routeDescriptor,
          routeFinishing: {
            ...routeDescriptor.routeFinishing,
            maximumTrimmedCoveredPermille: 224
          }
        },
        profile
      }),
      /source terminal inset removes 225‰.*expected at most 224‰/
    );
    await assert.rejects(
      finishRouteArtifact({
        bytes: source,
        descriptor: {
          ...routeDescriptor,
          routeFinishing: {
            ...routeDescriptor.routeFinishing,
            maximumScaleAnisotropyPermille: 3121
          }
        },
        profile
      }),
      /scale anisotropy is 3122‰; expected at most 3121‰/
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

  it('deterministically finishes and validates an isolated route in its box',
    async () => {
      const routeDescriptor = isolatedDescriptor();
      const first = await finishRouteArtifact({
        bytes: await sourcePng(),
        descriptor: routeDescriptor,
        profile: PROFILE
      });
      const second = await finishRouteArtifact({
        bytes: await sourcePng(),
        descriptor: routeDescriptor,
        profile: PROFILE
      });

      assert.deepEqual(first.bytes, second.bytes);
      assert.deepEqual(await alphaBounds(first.bytes), {
        width: 32,
        height: 24,
        bounds: { x: 6, y: 5, width: 18, height: 12 },
        blueFragmentPixels: 0
      });
      const validation = await validateFinishedRouteArtifact({
        bytes: first.bytes,
        descriptor: routeDescriptor
      });
      assert.deepEqual(validation.samples, []);
      assert.equal(validation.totalPixels, 32 * 24);
      assert.ok(validation.coveredPixels > 0);
      assert.equal(
        validation.coveragePermille,
        Math.floor(validation.coveredPixels * 1000 / validation.totalPixels)
      );
    });

  it('rejects isolated finishing with a foreign strategy or excluded anchor',
    async () => {
      const source = await sourcePng({ width: 32, height: 24 });
      await assert.rejects(
        finishRouteArtifact({
          bytes: source,
          descriptor: anchorScaleDescriptor({
            capabilities: { routeTopology: 'isolated' }
          }),
          profile: PROFILE
        }),
        /isolated route finishing requires largest-component-box-v1/
      );
      await assert.rejects(
        finishRouteArtifact({
          bytes: source,
          descriptor: isolatedDescriptor({
            placement: { anchor: { x: 25, y: 11 } }
          }),
          profile: PROFILE
        }),
        /isolated route finishing targetBox must contain the declared anchor/
      );
    });

  it('rejects isolated final alpha outside its target box and on the border',
    async () => {
      const routeDescriptor = isolatedDescriptor();
      const pixels = Buffer.alloc(32 * 24 * 4);
      const setVisible = (x, y) => pixels.set(
        [117, 76, 36, 255],
        ((y * 32) + x) * 4
      );
      setVisible(15, 11);
      setVisible(5, 11);
      const encode = () => sharp(pixels, {
        raw: { width: 32, height: 24, channels: 4 }
      }).png().toBuffer();

      await assert.rejects(
        validateFinishedRouteArtifact({
          bytes: await encode(),
          descriptor: routeDescriptor
        }),
        /visible pixel outside its descriptor-pinned targetBox at 5,11/
      );

      pixels.fill(0);
      setVisible(15, 11);
      setVisible(3, 11);
      await assert.rejects(
        validateFinishedRouteArtifact({
          bytes: await encode(),
          descriptor: routeDescriptor
        }),
        /outermost 4-pixel canvas border must be fully transparent/
      );
    });

  it('requires isolated coverage to contact the declared anchor neighborhood',
    async () => {
      const canvas = { width: 64, height: 48 };
      const routeDescriptor = isolatedDescriptor({
        canvas,
        placement: { anchor: { x: 32, y: 24 } },
        routeFinishing: {
          targetBox: { x: 8, y: 8, width: 48, height: 32 }
        }
      });
      const pixels = Buffer.alloc(canvas.width * canvas.height * 4);
      const encode = () => sharp(pixels, {
        raw: { ...canvas, channels: 4 }
      }).png().toBuffer();
      const setVisible = (x, y) => pixels.set(
        [117, 76, 36, 255],
        ((y * canvas.width) + x) * 4
      );

      await assert.rejects(
        validateFinishedRouteArtifact({
          bytes: await encode(),
          descriptor: routeDescriptor
        }),
        /has no visible subject/
      );

      setVisible(8, 24);
      await assert.rejects(
        validateFinishedRouteArtifact({
          bytes: await encode(),
          descriptor: routeDescriptor
        }),
        /alpha silhouette does not contact its declared anchor/
      );

      pixels.fill(0);
      setVisible(20, 24);
      assert.deepEqual(
        await validateFinishedRouteArtifact({
          bytes: await encode(),
          descriptor: routeDescriptor
        }),
        {
          samples: [],
          coveredPixels: 1,
          totalPixels: 64 * 48,
          coveragePermille: 0
        }
      );

      pixels.fill(0);
      setVisible(31, 23);
      setVisible(32, 24);
      await assert.rejects(
        validateFinishedRouteArtifact({
          bytes: await encode(),
          descriptor: routeDescriptor
        }),
        /must contain exactly one 4-connected visible component; found 2/
      );
    });

  it('continues to reject unknown topologies with no measurable arms',
    async () => {
      await assert.rejects(
        validateFinishedRouteArtifact({
          bytes: Buffer.from('not an image'),
          descriptor: descriptor({
            capabilities: { routeTopology: 'unknown' },
            placement: { anchor: { x: 16, y: 12 } }
          })
        }),
        /has no measurable declared route arms/
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
