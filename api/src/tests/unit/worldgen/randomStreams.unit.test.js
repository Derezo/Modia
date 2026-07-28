import { describe, it } from 'node:test';
import assert from 'node:assert';

import { SeededRandom } from '../../../config/constants.js';
import {
  DEFAULT_WORLD_SEED,
  GENERATOR_VERSION,
  RANDOM_STREAM_VERSION,
  RANDOM_STREAM_SALTS,
  parseWorldSeed,
  createWorldgenConfig,
  deriveRandomStreamSeed,
  createRandomStreams,
  canonicalKeyCompare,
  canonicalNumber,
  canonicalize,
  canonicalStringify,
  canonicalEncode
} from '../../../db/worldgen/randomStreams.js';

const REQUIRED_STREAMS = [
  'castlePlacement',
  'regionalNodes',
  'internalConnections',
  'interRegionRoutes',
  'finalization',
  'namesFeatures',
  'worldObstacles'
];

function take(rng, count = 5) {
  return Array.from({ length: count }, () => rng.next());
}

describe('worldgen seed configuration', () => {
  it('uses 123456 only when the seed is omitted', () => {
    assert.strictEqual(DEFAULT_WORLD_SEED, 123456);
    assert.strictEqual(parseWorldSeed(), 123456);
    assert.strictEqual(createWorldgenConfig().seed, 123456);

    for (const value of [null, '', ' ', false]) {
      assert.throws(() => parseWorldSeed(value));
    }
  });

  it('accepts the complete signed 32-bit integer range', () => {
    assert.strictEqual(parseWorldSeed('-2147483648'), -2147483648);
    assert.strictEqual(parseWorldSeed(2147483647), 2147483647);
    assert.strictEqual(parseWorldSeed('+42'), 42);
    assert.strictEqual(parseWorldSeed('-0'), 0);
  });

  it('rejects fractional, nonnumeric, ambiguous, and out-of-range seeds', () => {
    const invalidSeeds = [
      1.5,
      NaN,
      Infinity,
      -Infinity,
      '1.5',
      '1e3',
      '0x10',
      '42px',
      ' 42',
      '42 ',
      '2147483648',
      '-2147483649'
    ];

    for (const seed of invalidSeeds) {
      assert.throws(() => parseWorldSeed(seed), undefined, `accepted ${String(seed)}`);
    }
  });

  it('normalizes and freezes seed/version configuration', () => {
    const config = createWorldgenConfig({
      worldSeed: '-7',
      generatorVersion: 2,
      randomStreamVersion: 3
    });

    assert.deepStrictEqual(config, {
      seed: -7,
      worldSeed: -7,
      generatorVersion: 2,
      randomStreamVersion: 3
    });
    assert.ok(Object.isFrozen(config));
    assert.strictEqual(GENERATOR_VERSION, 1);
    assert.strictEqual(RANDOM_STREAM_VERSION, 1);
    assert.throws(() => createWorldgenConfig({ seed: 1, generatorVersion: 0 }));
    assert.throws(() => createWorldgenConfig({ seed: 1, generatorVersion: null }));
    assert.throws(() => createWorldgenConfig({ seed: 1, randomStreamVersion: 1.5 }));
    assert.throws(() => createWorldgenConfig({ seed: 1, randomStreamVersion: null }));
  });
});

describe('named worldgen random streams', () => {
  it('locks the fixed salts for every required stream', () => {
    assert.deepStrictEqual(Object.keys(RANDOM_STREAM_SALTS), REQUIRED_STREAMS);
    assert.deepStrictEqual(RANDOM_STREAM_SALTS, {
      castlePlacement: 2654435769,
      regionalNodes: 608135816,
      internalConnections: 3084996962,
      interRegionRoutes: 2246822507,
      finalization: 3266489909,
      namesFeatures: 1291169091,
      worldObstacles: 1390208809
    });
    assert.strictEqual(
      new Set(Object.values(RANDOM_STREAM_SALTS)).size,
      REQUIRED_STREAMS.length
    );
    assert.ok(Object.isFrozen(RANDOM_STREAM_SALTS));
  });

  it('creates SeededRandom-compatible streams', () => {
    const streams = createRandomStreams(123456);

    for (const name of REQUIRED_STREAMS) {
      assert.ok(streams[name] instanceof SeededRandom, `${name} is not SeededRandom`);
    }
    assert.ok(Object.isFrozen(streams));
  });

  it('repeats sequences for the same seed and versions', () => {
    const config = {
      seed: -123,
      generatorVersion: 4,
      randomStreamVersion: 7
    };
    const first = createRandomStreams(config);
    const second = createRandomStreams(config);

    for (const name of REQUIRED_STREAMS) {
      assert.deepStrictEqual(take(first[name]), take(second[name]), name);
    }
  });

  it('locks derived seeds at a signed boundary and explicit versions', () => {
    const config = {
      seed: -2147483648,
      generatorVersion: 3,
      randomStreamVersion: 5
    };

    assert.deepStrictEqual(
      Object.fromEntries(REQUIRED_STREAMS.map((name) => [
        name,
        deriveRandomStreamSeed(config, name)
      ])),
      {
        castlePlacement: 1991650033,
        regionalNodes: 498364634,
        internalConnections: -743649568,
        interRegionRoutes: -737132413,
        finalization: -2095732000,
        namesFeatures: 608245783,
        worldObstacles: -1187732796
      }
    );
  });

  it('locks initial stream output at a signed boundary and explicit versions', () => {
    const streams = createRandomStreams({
      seed: -2147483648,
      generatorVersion: 3,
      randomStreamVersion: 5
    });

    assert.deepStrictEqual(
      Object.fromEntries(REQUIRED_STREAMS.map((name) => [name, take(streams[name], 3)])),
      {
        castlePlacement: [
          0.6913445095997304,
          0.7664394313469529,
          0.8911315945442766
        ],
        regionalNodes: [
          0.9483026515226811,
          0.7963755247183144,
          0.48587554693222046
        ],
        internalConnections: [
          0.9761383119039237,
          0.9275742382742465,
          0.7296993474010378
        ],
        interRegionRoutes: [
          0.389337943168357,
          0.6861791298724711,
          0.1720800707116723
        ],
        finalization: [
          0.9997512851841748,
          0.5405038446187973,
          0.5472977058961987
        ],
        namesFeatures: [
          0.9803391194436699,
          0.14433443150483072,
          0.9561878689564764
        ],
        worldObstacles: [
          0.9476101342588663,
          0.22578430315479636,
          0.4677943135611713
        ]
      }
    );
  });

  it('changes derived streams when seed or either version changes', () => {
    const base = deriveRandomStreamSeed({
      seed: 10,
      generatorVersion: 1,
      randomStreamVersion: 1
    }, 'castlePlacement');

    assert.notStrictEqual(
      base,
      deriveRandomStreamSeed({
        seed: 11,
        generatorVersion: 1,
        randomStreamVersion: 1
      }, 'castlePlacement')
    );
    assert.notStrictEqual(
      base,
      deriveRandomStreamSeed({
        seed: 10,
        generatorVersion: 2,
        randomStreamVersion: 1
      }, 'castlePlacement')
    );
    assert.notStrictEqual(
      base,
      deriveRandomStreamSeed({
        seed: 10,
        generatorVersion: 1,
        randomStreamVersion: 2
      }, 'castlePlacement')
    );
  });

  it('does not advance structural streams when cosmetic streams are consumed', () => {
    const consumed = createRandomStreams(456);
    const untouched = createRandomStreams(456);

    take(consumed.namesFeatures, 100);
    take(consumed.worldObstacles, 100);

    assert.deepStrictEqual(
      take(consumed.castlePlacement),
      take(untouched.castlePlacement)
    );
    assert.deepStrictEqual(
      take(consumed.internalConnections),
      take(untouched.internalConnections)
    );
  });

  it('rejects unknown stream names', () => {
    assert.throws(
      () => deriveRandomStreamSeed(123, 'missing'),
      /Unknown worldgen random stream/
    );
  });
});

describe('canonical worldgen encoding', () => {
  it('orders object keys lexically while preserving array order', () => {
    const value = {
      z: 1,
      a: {
        'é': 4,
        b: 3,
        A: 2
      },
      list: [{ y: 2, x: 1 }, 'second', 'first']
    };

    assert.strictEqual(
      canonicalStringify(value),
      '{"a":{"A":2,"b":3,"é":4},"list":[{"x":1,"y":2},"second","first"],"z":1}'
    );
    assert.deepStrictEqual(
      ['z', 'a', 'aa', 'A'].sort(canonicalKeyCompare),
      ['A', 'a', 'aa', 'z']
    );
  });

  it('uses stable finite-number representations and normalizes negative zero', () => {
    assert.strictEqual(canonicalNumber(-0), '0');
    assert.strictEqual(canonicalNumber(1.25), '1.25');
    assert.strictEqual(canonicalNumber(1e+21), '1e+21');
    assert.strictEqual(
      canonicalStringify({ small: 1e-7, zero: -0 }),
      '{"small":1e-7,"zero":0}'
    );
  });

  it('rejects nonfinite numbers and values JSON would silently lose', () => {
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      undefined,
      { missing: undefined },
      [undefined],
      1n,
      new Date(0)
    ]) {
      assert.throws(() => canonicalStringify(value));
    }

    const sparse = [];
    sparse.length = 1;
    assert.throws(() => canonicalStringify(sparse), /sparse/);

    const namedArray = [];
    namedArray.extra = 1;
    assert.throws(() => canonicalStringify(namedArray), /named properties/);

    const disguisedNamedArray = [1];
    Object.defineProperty(disguisedNamedArray, '0', { enumerable: false });
    disguisedNamedArray.extra = 2;
    assert.throws(
      () => canonicalStringify(disguisedNamedArray),
      /named properties/
    );

    const symbolArray = [];
    symbolArray[Symbol('extra')] = 1;
    assert.throws(() => canonicalStringify(symbolArray), /symbol keys/);

    const cyclic = {};
    cyclic.self = cyclic;
    assert.throws(() => canonicalStringify(cyclic), /cyclic/);
  });

  it('returns a detached canonical value and UTF-8 bytes for hashing', () => {
    const input = { snowman: '☃', nested: { z: 2, a: -0 } };
    const canonical = canonicalize(input);
    const encoded = canonicalEncode(input);

    assert.deepStrictEqual(canonical, {
      nested: { a: 0, z: 2 },
      snowman: '☃'
    });
    assert.ok(encoded instanceof Uint8Array);
    assert.strictEqual(
      new TextDecoder().decode(encoded),
      canonicalStringify(input)
    );
  });
});
