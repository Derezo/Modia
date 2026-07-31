import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { caches: {} };

const { AssetLoader } = await import('../AssetLoader.js');

function asset(key = 'surface') {
  return {
    assetBundleId: 'bundle',
    key,
    contentVersion: 1,
    contentHash: `sha256:${'a'.repeat(64)}`,
    immutableUrl: `/assets/v3/${key}.webp`
  };
}

describe('AssetLoader BattleMapV3 exact assets', () => {
  it('exposes a V3 image only after verified bytes are decoded', async () => {
    const loader = new AssetLoader();
    const reference = asset();
    const image = { id: 'verified-image', width: 64, height: 64 };
    const events = [];
    loader.assetCache = {
      async fetchVerifiedBytes(received) {
        events.push(`verify:${received.key}`);
        assert.equal(loader.getBattleMapV3Asset(reference), null);
        return new Uint8Array([1, 2, 3]);
      }
    };
    loader._decodeBattleMapV3Image = async bytes => {
      events.push(`decode:${bytes.length}`);
      assert.equal(loader.getBattleMapV3Asset(reference), null);
      return image;
    };

    assert.equal(await loader.loadBattleMapV3Asset(reference), image);
    assert.equal(loader.getBattleMapV3Asset(reference), image);
    assert.equal(
      loader.getBattleMapV3Asset({
        ...reference,
        contentHash: `sha256:${'b'.repeat(64)}`
      }),
      null
    );
    assert.deepEqual(events, ['verify:surface', 'decode:3']);
  });

  it('rejects the complete V3 preload when any required asset fails', async () => {
    const loader = new AssetLoader();
    loader.loadBattleMapV3Asset = async reference => {
      if (reference.key === 'missing') {
        throw new Error('missing asset');
      }
      return { id: reference.key };
    };

    await assert.rejects(
      loader.preloadBattleMapV3Assets([
        asset('surface'),
        asset('missing')
      ]),
      /missing asset/
    );
  });
});

