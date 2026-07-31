import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  clearBattleMapV3RuntimeManifest,
  installBattleMapV3RuntimeBundle,
  installBattleMapV3RuntimeBundleRegistry
} from '../BattleMapAssets.js';
import { getBattleMapCapabilities } from '../BattleMapSession.js';
import {
  createSignedEmptyRuntimeBundle
} from './battleMapV3RuntimeFixture.js';

async function trackedRuntimeBundleRegistry() {
  return JSON.parse(await readFile(
    path.resolve(
      import.meta.dirname,
      '../../generated/battleMapV3RuntimeBundles.json'
    ),
    'utf8'
  ));
}

describe('BattleMapV3 production bootstrap', () => {
  it('statically imports and installs the tracked bundle registry before Game initialization', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../main.js'),
      'utf8'
    );
    assert.match(
      source,
      /import battleMapV3RuntimeBundles from '\.\/generated\/battleMapV3RuntimeBundles\.json'/
    );
    const install = source.indexOf(
      'installBattleMapV3RuntimeBundleRegistry(battleMapV3RuntimeBundles)'
    );
    const construct = source.indexOf('new Game()');
    assert.ok(install >= 0);
    assert.ok(construct > install);
  });

  it('does not advertise V3 for the valid empty draft mirror', async () => {
    clearBattleMapV3RuntimeManifest();
    assert.equal(
      await installBattleMapV3RuntimeBundle(
        await createSignedEmptyRuntimeBundle()
      ),
      false
    );
    assert.deepEqual(
      getBattleMapCapabilities().supportedBattleMapSchemaVersions,
      [1, 2]
    );
  });

  it('advertises V3 after installing the signed tracked production bundle', async () => {
    clearBattleMapV3RuntimeManifest();
    const registry = await trackedRuntimeBundleRegistry();
    const bundle = registry.bundles.at(-1);
    assert.ok(bundle.assets.length > 0);
    assert.equal(await installBattleMapV3RuntimeBundleRegistry(registry), true);
    assert.deepEqual(
      getBattleMapCapabilities().supportedBattleMapSchemaVersions,
      [1, 2, 3]
    );
  });

  it('verifies V3 harness artifacts before renderer adaptation', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../dev/BattleMapVisualHarness.js'),
      'utf8'
    );
    const verify = source.indexOf('loadAndFreezeBattleMapV3Final(');
    const adapt = source.indexOf('applyBattleMapV3RenderAdapter(grid, state)');
    assert.ok(verify >= 0);
    assert.ok(adapt > verify);
  });

  it('keeps the realistic combat harness overlay opt-in', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../dev/BattleMapVisualHarness.js'),
      'utf8'
    );
    assert.match(source, /query\.get\('combat'\) === '1'/);
    assert.match(source, /request\.combatOverlay\s*\?\s*renderCombatOverlay/);
    assert.match(source, /renderMinimap\(\{/);
    assert.match(source, /spawnContract\?\.playerSlots/);
    assert.match(source, /spawnContract\?\.opponentCandidates/);
  });

  it('uses the same production scene backdrop in BattleScene and the harness', async () => {
    const [sceneSource, harnessSource] = await Promise.all([
      readFile(
        path.resolve(import.meta.dirname, '../../scenes/BattleScene.js'),
        'utf8'
      ),
      readFile(
        path.resolve(import.meta.dirname, '../../dev/BattleMapVisualHarness.js'),
        'utf8'
      )
    ]);
    for (const source of [sceneSource, harnessSource]) {
      assert.match(source, /renderBattleSceneBackdrop/);
    }
    assert.doesNotMatch(harnessSource, /function paintBackground/);
    assert.match(
      sceneSource,
      /scene: this\.grid\?\.battleMapV3RenderData\?\.scene \?\? null/
    );
    assert.match(
      harnessSource,
      /scene: grid\.battleMapV3RenderData\.scene/
    );
  });
});
