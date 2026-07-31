import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RenderFailureCollector,
  assertNoSymlinkPath,
  buildHarnessUrl,
  buildReviewMetadata,
  buildViteCommand,
  captureMapReview,
  launchViteHarness,
  parseRenderArgs,
  readSafeProjectJson,
  validateCompiledMapPath,
  verifyRuntimeBundleBinding
} from './render-v3-maps.mjs';
import {
  computeTemplateMapAssetBundleManifestFullHash,
  hashCanonicalV3Value
} from '../../shared/battleMap/v3/index.js';
import { isStaticAssetRequest } from '../../frontend/vite.config.js';

const MAP_PATH = 'battle-maps/compiled/forest/forest-review.v1.json';
const MAP_HASH =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RENDERER_HASH_DOMAIN = 'modia:battle-art:renderer-manifest:v1';

async function temporaryProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-render-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'frontend'), { recursive: true });
  return root;
}

function fakeRecord() {
  return {
    path: MAP_PATH,
    map: {
      battleMapSchemaVersion: 3,
      contentId: 'forest-review',
      contentVersion: 1,
      hashes: { fullHash: MAP_HASH },
      provenance: {
        assetBundle: {
          id: 'bundle:test',
          version: 1,
          manifestFullHash: null
        }
      }
    }
  };
}

async function validRuntimeBundle() {
  const bundle = {
    schemaVersion: 'battle-art-runtime-bundle-v1',
    id: 'bundle:test',
    version: 1,
    manifestFullHash: null,
    rendererManifestFullHash: null,
    renderProfile: {
      id: 'iso64-retina-v3',
      sourcePixelScale: 4,
      tileWidth: 64,
      tileHeight: 32,
      elevationStep: 16
    },
    assets: [{
      key: 'forest-surface',
      contentVersion: 1,
      contentHash:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      immutableUrl:
        '/assets/battle-map-v3/forest/surface/forest-surface/v1/' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'
    }],
    renderers: [{
      id: 'forest-surface',
      theme: 'forest',
      category: 'surface',
      contentVersion: 1,
      sha256:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      immutableUrl:
        '/assets/battle-map-v3/forest/surface/forest-surface/v1/' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp',
      width: 256,
      height: 128,
      pivot: { x: 128, y: 64 },
      anchor: { x: 128, y: 64 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      collision: { kind: 'none', cells: [] },
      drawBounds: { x: 0, y: 0, width: 256, height: 128 },
      occlusionBounds: { x: 0, y: 0, width: 0, height: 0 },
      stratum: 'surface'
    }]
  };
  bundle.rendererManifestFullHash = await hashCanonicalV3Value(
    RENDERER_HASH_DOMAIN,
    {
      id: bundle.id,
      version: bundle.version,
      renderProfile: bundle.renderProfile,
      renderers: bundle.renderers
    }
  );
  bundle.manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(bundle);
  return bundle;
}

function tinyPng(width = 20, height = 10) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('CLI parsing is closed, bounded, and mode-specific', () => {
  assert.deepEqual(
    parseRenderArgs([
      'screenshot',
      '--map', MAP_PATH,
      '--output-dir', 'tmp/reviews',
      '--port', '4317',
      '--timeout', '12'
    ]),
    {
      mode: 'screenshot',
      maps: [MAP_PATH],
      allApproved: false,
      outputDirectory: 'tmp/reviews',
      port: 4317,
      timeoutMs: 12_000,
      help: false
    }
  );
  assert.equal(
    parseRenderArgs(['gallery', '--all-approved']).allApproved,
    true
  );
  assert.throws(
    () => parseRenderArgs(['preview', '--all-approved']),
    /only supported by gallery/
  );
  assert.throws(
    () => parseRenderArgs([
      'gallery', '--all-approved', '--map', MAP_PATH
    ]),
    /mutually exclusive/
  );
  assert.throws(
    () => parseRenderArgs(['screenshot', '--map', MAP_PATH, '--port', '80']),
    /1024 through 65535/
  );
  assert.throws(
    () => parseRenderArgs(['screenshot', '--map', MAP_PATH, '--wat']),
    /Unknown argument/
  );
});

test('compiled input paths reject traversal, encoding, query text, and wrong roots', () => {
  assert.equal(validateCompiledMapPath(MAP_PATH), MAP_PATH);
  for (const unsafe of [
    '/battle-maps/compiled/forest/map.json',
    'battle-maps/compiled/forest/../map.json',
    'battle-maps/compiled/forest/%2e%2e/map.json',
    'battle-maps/compiled/forest/map.json?raw',
    'ai-image-metadata/battle-maps/blueprints/forest/map.json',
    'battle-maps\\compiled\\forest\\map.json'
  ]) {
    assert.throws(() => validateCompiledMapPath(unsafe));
  }
});

test('safe JSON reads reject duplicate keys and symlink components', async t => {
  const root = await temporaryProject(t);
  const directory = path.join(root, 'battle-maps/compiled/forest');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'forest-review.v1.json'), '{"a":1,"a":2}\n');
  await assert.rejects(
    readSafeProjectJson(root, MAP_PATH),
    /strict JSON/
  );

  await rm(path.join(root, 'battle-maps'), { recursive: true });
  const external = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-render-link-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, path.join(root, 'battle-maps'));
  await assert.rejects(
    assertNoSymlinkPath(root, MAP_PATH),
    /forbidden symlink/
  );
});

test('harness URL targets only the production page and exact Vite filesystem artifact', () => {
  const root = '/workspace/modia';
  const value = buildHarnessUrl({
    projectRoot: root,
    mapPath: MAP_PATH,
    port: 4317
  });
  const url = new URL(value);
  assert.equal(url.origin, 'http://127.0.0.1:4317');
  assert.equal(url.pathname, '/battle-map-visual.html');
  assert.equal(
    url.searchParams.get('artifact'),
    `/@fs/${root}/${MAP_PATH}`
  );
  assert.equal(url.searchParams.get('autorun'), '1');
  assert.equal(url.searchParams.has('nodeType'), false);
});

test('Vite static-asset classification ignores JSON names in HTML query values', () => {
  assert.equal(
    isStaticAssetRequest(
      '/battle-map-visual.html?artifact=%2F%40fs%2Fworkspace%2Fmap.json'
    ),
    false
  );
  assert.equal(
    isStaticAssetRequest('/assets/battle-map-v3/forest/map.webp?revision=1'),
    true
  );
  assert.equal(isStaticAssetRequest('/assets/map.json'), true);
  assert.equal(isStaticAssetRequest('not a valid URL\u0000'), false);
});

test('runtime binding recomputes renderer/manifest hashes and binds the map pin', async () => {
  const bundle = await validRuntimeBundle();
  const record = fakeRecord();
  record.map.provenance.assetBundle.manifestFullHash = bundle.manifestFullHash;
  assert.deepEqual(
    await verifyRuntimeBundleBinding(record.map, bundle),
    {
      id: bundle.id,
      version: bundle.version,
      manifestFullHash: bundle.manifestFullHash,
      rendererManifestFullHash: bundle.rendererManifestFullHash
    }
  );
  const staleRenderer = structuredClone(bundle);
  staleRenderer.rendererManifestFullHash = MAP_HASH;
  await assert.rejects(
    verifyRuntimeBundleBinding(record.map, staleRenderer),
    /renderer manifest hash mismatch/
  );
  const stalePin = structuredClone(record.map);
  stalePin.provenance.assetBundle.manifestFullHash = MAP_HASH;
  await assert.rejects(
    verifyRuntimeBundleBinding(stalePin, bundle),
    /does not bind/
  );
});

test('failure collector records page, console, HTTP, request, API, WS, and remote failures', () => {
  const collector = new RenderFailureCollector(
    'http://127.0.0.1:4173/battle-map-visual.html'
  );
  collector.console({ type: () => 'warning', text: () => 'fine' });
  collector.console({ type: () => 'error', text: () => 'broken asset' });
  collector.pageError(new Error('render crashed'));
  collector.request({ url: () => 'http://127.0.0.1:4173/api/battles' });
  collector.webSocket({ url: () => 'ws://127.0.0.1:4173/?token=vite' });
  collector.webSocket({ url: () => 'ws://127.0.0.1:4173/ws/battle' });
  collector.request({ url: () => 'https://example.invalid/image.webp' });
  collector.requestFailed({
    url: () => 'http://127.0.0.1:4173/assets/missing.webp',
    failure: () => ({ errorText: 'net::ERR_FAILED' })
  });
  collector.response({
    status: () => 404,
    url: () => 'http://127.0.0.1:4173/assets/missing.webp'
  });
  assert.equal(collector.failures.length, 7);
  assert.throws(() => collector.assertClean(), /Visual harness failures/);
});

test('review metadata binds exact map, bundle, PNG, and harness metrics', async () => {
  const bundle = await validRuntimeBundle();
  const record = fakeRecord();
  record.map.provenance.assetBundle.manifestFullHash = bundle.manifestFullHash;
  const runtimeBinding = await verifyRuntimeBundleBinding(record.map, bundle);
  const png = tinyPng();
  const metadata = buildReviewMetadata({
    record,
    runtimeBinding,
    harnessUrl: 'http://127.0.0.1:4173/battle-map-visual.html?artifact=x',
    screenshotPath: 'tmp/review.png',
    screenshotBytes: png,
    screenshotDimensions: { width: 20, height: 10 },
    harnessResult: {
      renderDurationMs: 22,
      renderedCells: 64,
      exactAssetSelections: 1,
      worldBounds: { width: 320, height: 160 }
    }
  });
  assert.equal(metadata.map.fullHash, MAP_HASH);
  assert.equal(
    metadata.assetBundle.rendererManifestFullHash,
    bundle.rendererManifestFullHash
  );
  assert.equal(metadata.screenshot.bytes, png.length);
  assert.equal(metadata.screenshot.width, 20);
  assert.deepEqual(metadata.renderMetrics.worldBounds, {
    width: 320,
    height: 160
  });
});

test('Vite command and process launch support injected spawn/readiness with cleanup', async t => {
  const root = await temporaryProject(t);
  const built = buildViteCommand({
    projectRoot: root,
    port: 4317,
    nodeExecutable: '/node',
    viteBin: '/vite/bin/vite.js'
  });
  assert.deepEqual(built, {
    command: '/node',
    args: [
      '/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      '4317',
      '--strictPort'
    ],
    cwd: path.join(root, 'frontend')
  });

  let invocation;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 0;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = signal => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', 0, signal));
    return true;
  };
  const server = await launchViteHarness({
    projectRoot: root,
    port: 4317,
    timeoutMs: 1000,
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      return child;
    },
    async waitForReadyImpl({ port, timeoutMs, exited }) {
      assert.equal(port, 4317);
      assert.equal(timeoutMs, 1000);
      assert.ok(exited instanceof Promise);
    },
    commandOptions: {
      nodeExecutable: '/node',
      viteBin: '/vite/bin/vite.js'
    }
  });
  assert.equal(invocation.command, '/node');
  assert.deepEqual(invocation.args, built.args);
  assert.equal(invocation.options.cwd, built.cwd);
  assert.equal(invocation.options.env.BROWSER, 'none');
  await server.stop();
  assert.equal(child.exitCode, 0);
});

test('capture uses an injected browser while writing bound PNG and JSON outputs', async t => {
  const root = await temporaryProject(t);
  await mkdir(path.join(root, 'battle-maps/compiled/forest'), {
    recursive: true
  });
  const record = fakeRecord();
  const bundle = await validRuntimeBundle();
  record.map.provenance.assetBundle.manifestFullHash = bundle.manifestFullHash;
  const runtimeBinding = await verifyRuntimeBundleBinding(record.map, bundle);
  const png = tinyPng(1088, 704);

  class FakePage extends EventEmitter {
    async goto(url) {
      assert.match(url, /battle-map-visual\.html/);
    }

    async waitForFunction() {}

    locator(selector) {
      if (selector === 'body') {
        return { getAttribute: async () => 'ready' };
      }
      assert.equal(selector, '.capture');
      return { screenshot: async () => png };
    }

    async evaluate() {
      return {
        artifactUrl: `/@fs/${root}/${MAP_PATH}`,
        battleMapSchemaVersion: 3,
        contentId: record.map.contentId,
        contentVersion: record.map.contentVersion,
        fullHash: record.map.hashes.fullHash,
        assetBundleManifestFullHash: bundle.manifestFullHash,
        exactAssetSelections: 1,
        renderedCells: 64,
        worldBounds: { width: 640, height: 320 },
        renderDurationMs: 9
      };
    }
  }

  let contextClosed = false;
  const browser = {
    async newContext(options) {
      assert.equal(options.deviceScaleFactor, 1);
      return {
        newPage: async () => new FakePage(),
        close: async () => {
          contextClosed = true;
        }
      };
    }
  };
  const result = await captureMapReview({
    projectRoot: root,
    record,
    runtimeBinding,
    browser,
    port: 4317,
    timeoutMs: 1000,
    outputDirectory: 'reviews'
  });
  assert.equal(contextClosed, true);
  assert.equal(
    (await readFile(path.join(root, result.screenshotPath))).length,
    png.length
  );
  const metadata = JSON.parse(
    await readFile(path.join(root, result.metadataPath), 'utf8')
  );
  assert.equal(metadata.map.fullHash, MAP_HASH);
  assert.equal(metadata.screenshot.width, 1088);
  await assert.rejects(
    captureMapReview({
      projectRoot: root,
      record,
      runtimeBinding,
      browser,
      port: 4317,
      timeoutMs: 1000,
      outputDirectory: 'reviews'
    }),
    /Refusing to overwrite/
  );
});

test('capture reports DOM and collector evidence when the harness never starts', async t => {
  const root = await temporaryProject(t);
  const record = fakeRecord();
  const bundle = await validRuntimeBundle();
  record.map.provenance.assetBundle.manifestFullHash = bundle.manifestFullHash;
  const runtimeBinding = await verifyRuntimeBundleBinding(record.map, bundle);

  class StalledPage extends EventEmitter {
    async goto() {}

    async waitForFunction() {
      throw new Error('diagnostic timeout');
    }

    async evaluate() {
      return {
        status: 'idle',
        title: 'BattleMapV2 visual harness',
        details: 'Waiting for render request',
        error: '',
        result: null
      };
    }
  }

  let contextClosed = false;
  const browser = {
    async newContext() {
      return {
        newPage: async () => new StalledPage(),
        close: async () => {
          contextClosed = true;
        }
      };
    }
  };

  await assert.rejects(
    captureMapReview({
      projectRoot: root,
      record,
      runtimeBinding,
      browser,
      port: 4317,
      timeoutMs: 1000,
      outputDirectory: 'reviews'
    }),
    error => {
      assert.match(error.message, /diagnostic timeout/);
      assert.match(error.message, /status=idle/);
      assert.match(error.message, /Waiting for render request/);
      return true;
    }
  );
  assert.equal(contextClosed, true);
});
