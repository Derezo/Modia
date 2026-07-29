import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  dispatchBattleMapGeneration,
  generateTerrain,
  SUPPORTED_TERRAIN_GENERATION_VERSIONS,
  UnsupportedTerrainGenerationVersionError
} from '../mapGeneration.js';
import { generateTerrain as generateTerrainV1 } from './v1/mapGenerationV1.js';
import { V1_DIGEST_FIXTURES } from './v1Fixtures.js';
import { V1_SOURCE_SHA256 } from './v1SourceManifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const v1Root = path.join(here, 'v1');

function digestResult(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  }
  return files.sort();
}

function relativeToV1(absolute) {
  return path.relative(v1Root, absolute).split(path.sep).join('/');
}

test('V1 fixture outputs and explicit dispatcher remain byte-equivalent', () => {
  assert.deepEqual(SUPPORTED_TERRAIN_GENERATION_VERSIONS, [1, 2]);

  for (const fixture of V1_DIGEST_FIXTURES) {
    const direct = generateTerrainV1(
      fixture.seed,
      fixture.nodeType,
      fixture.width,
      fixture.height,
      fixture.options
    );
    const dispatched = dispatchBattleMapGeneration({
      terrainGenerationVersion: 1,
      terrainSeed: fixture.seed,
      nodeType: fixture.nodeType,
      mapWidth: fixture.width,
      mapHeight: fixture.height,
      options: fixture.options
    });
    const legacy = generateTerrain(
      fixture.seed,
      fixture.nodeType,
      fixture.width,
      fixture.height,
      fixture.options
    );

    const serialized = JSON.stringify(direct);
    assert.equal(digestResult(direct), fixture.digest, `${fixture.id}: frozen digest`);
    assert.equal(JSON.stringify(dispatched), serialized, `${fixture.id}: dispatcher parity`);
    assert.equal(JSON.stringify(legacy), serialized, `${fixture.id}: legacy parity`);
  }
});

test('dispatcher requires an explicit supported version and never falls through', async () => {
  const base = { terrainSeed: 1, nodeType: 'forest', mapWidth: 10, mapHeight: 10 };

  assert.throws(
    () => dispatchBattleMapGeneration(base),
    /terrainGenerationVersion must be an explicit integer/
  );
  for (const terrainGenerationVersion of [0, 99]) {
    assert.throws(
      () => dispatchBattleMapGeneration({ ...base, terrainGenerationVersion }),
      error => error instanceof UnsupportedTerrainGenerationVersionError &&
        error.terrainGenerationVersion === terrainGenerationVersion
    );
  }

  const v2 = await dispatchBattleMapGeneration({
    ...base,
    terrainGenerationVersion: 2,
    options: { maxAttempts: 1 }
  });
  assert.equal(v2.battleMapSchemaVersion, 2);
  assert.equal(v2.terrainGenerationVersion, 2);
});

test('frozen V1 source files exactly match the reviewed source manifest', () => {
  const actualFiles = listJavaScriptFiles(v1Root);
  assert.deepEqual(actualFiles.map(relativeToV1), Object.keys(V1_SOURCE_SHA256).sort());

  for (const absolute of actualFiles) {
    const relative = relativeToV1(absolute);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    assert.equal(digest, V1_SOURCE_SHA256[relative], relative);
  }
});

test('frozen V1 imports cannot escape into runtime traversal or V2', () => {
  const importPattern = /(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g;

  for (const absolute of listJavaScriptFiles(v1Root)) {
    const source = fs.readFileSync(absolute, 'utf8');
    let match;
    while ((match = importPattern.exec(source)) !== null) {
      const resolved = path.resolve(path.dirname(absolute), match[1]);
      const relative = path.relative(v1Root, resolved);
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        `${relativeToV1(absolute)} imports outside V1: ${match[1]}`
      );
      assert.doesNotMatch(resolved, /(?:^|[/\\])(?:v2|traversal)(?:[/\\]|$)/);
      assert.doesNotMatch(resolved, /pathfinding/i);
    }
  }
});
