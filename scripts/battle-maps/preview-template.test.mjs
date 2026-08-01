import assert from 'node:assert/strict';
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
import sharp from 'sharp';

import {
  escapeHtml,
  parsePreviewArgs,
  previewTemplate,
  renderPreviewHtml
} from './preview-template.mjs';
import {
  approveTemplate,
  draftTemplate,
  inspectImage,
  loadTemplateSidecar,
  pinTemplateCompiler,
  sha256Bytes,
  stageTemplate
} from './source-template-lifecycle.mjs';
import {
  COMPILER_SOURCE_FILES,
  computeCurrentCompilerSourceSet
} from './content-release-lifecycle.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const THEME = 'forest';
const TEMPLATE = 'forest-template-01';
const MANIFEST = 'ai-image-metadata/battle-maps/manifest.json';
const PROMPT = 'ai-image-metadata/battle-maps/prompts/source-template-image-v1.json';
const DEFAULT_OUTPUT =
  'ai-image-metadata/battle-maps/review/forest/forest-template-01/source-template-preview.html';

async function temporaryDirectory(t, label = 'modia-template-preview-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), label));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function copyFixtureFile(root, relativePath) {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(PROJECT_ROOT, relativePath)));
}

async function createFixture(t) {
  const root = await temporaryDirectory(t);
  await Promise.all([
    copyFixtureFile(root, MANIFEST),
    copyFixtureFile(root, PROMPT),
    ...COMPILER_SOURCE_FILES.map(relativePath => (
      copyFixtureFile(root, relativePath)
    ))
  ]);
  await draftTemplate({ projectRoot: root, theme: THEME, template: TEMPLATE });
  return root;
}

async function createImage(root, relativePath, {
  color = { r: 28, g: 92, b: 48, alpha: 1 },
  width = 32,
  height = 32
} = {}) {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  }).png().toFile(absolute);
  return absolute;
}

async function readSidecar(root) {
  return (await loadTemplateSidecar({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE
  })).sidecar;
}

async function createCandidate(root, variant = 'candidate-01') {
  const sidecar = await readSidecar(root);
  const directory =
    `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}/${variant}`;
  const imageRelative = `${directory}/candidate.png`;
  const imagePath = await createImage(root, imageRelative);
  const image = await inspectImage(imagePath);
  const result = {
    schemaVersion: 'battle-map-source-image-candidate-v1',
    id: variant,
    theme: THEME,
    template: TEMPLATE,
    status: 'candidate-awaiting-review',
    promptProfile: sidecar.promptProfile,
    image: {
      path: imageRelative,
      ...image
    },
    worker: {
      command: 'codex',
      args: [
        'exec',
        '--ephemeral',
        '--enable',
        'image_generation',
        '--sandbox',
        'workspace-write'
      ],
      timeoutMs: 300_000,
      promptPath: `${directory}/prompt.txt`,
      stdoutPath: `${directory}/worker.jsonl`,
      stderrPath: `${directory}/worker.stderr.log`,
      lastMessagePath: null
    },
    approval: null
  };
  await writeFile(
    path.join(root, directory, 'result.json'),
    `${JSON.stringify(result, null, 2)}\n`
  );
  return { imagePath, result };
}

function previewOptions(root, overrides = {}) {
  return {
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    output: DEFAULT_OUTPUT,
    ...overrides
  };
}

test('preview CLI is closed and requires one theme/template with safe review output', () => {
  const parsed = parsePreviewArgs([
    '--theme=forest',
    '--template', TEMPLATE,
    '--output', 'ai-image-metadata/battle-maps/review/custom/template.html',
    '--project-root', '.',
    '--json'
  ]);
  assert.equal(parsed.theme, THEME);
  assert.equal(parsed.template, TEMPLATE);
  assert.equal(
    parsed.output,
    'ai-image-metadata/battle-maps/review/custom/template.html'
  );
  assert.equal(parsed.projectRoot, PROJECT_ROOT);
  assert.equal(parsed.json, true);
  assert.equal(
    parsePreviewArgs(['--theme', THEME, '--template', TEMPLATE]).output,
    DEFAULT_OUTPUT
  );

  assert.throws(() => parsePreviewArgs(['--template', TEMPLATE]), /--theme is required/);
  assert.throws(() => parsePreviewArgs(['--theme', THEME]), /--template is required/);
  assert.throws(
    () => parsePreviewArgs(['--theme', THEME, '--theme', THEME, '--template', TEMPLATE]),
    /--theme may only be provided once/
  );
  assert.throws(
    () => parsePreviewArgs(['--theme', THEME, '--template', TEMPLATE, '--json=yes']),
    /Unknown argument/
  );
  assert.throws(
    () => parsePreviewArgs(['--theme', THEME, '--template', TEMPLATE, '--browser']),
    /Unknown argument/
  );
  assert.throws(
    () => parsePreviewArgs([
      '--theme', THEME, '--template', TEMPLATE, '--output', '../review.html'
    ]),
    /project-relative|must not contain/
  );
  assert.throws(
    () => parsePreviewArgs([
      '--theme', THEME, '--template', TEMPLATE, '--output', 'tmp/review.html'
    ]),
    /must be below ai-image-metadata\/battle-maps\/review/
  );
});

test('HTML escaping covers text and attribute delimiters in semantic review content', () => {
  assert.equal(
    escapeHtml(`<script data-x="'">& go</script>`),
    '&lt;script data-x=&quot;&#39;&quot;&gt;&amp; go&lt;/script&gt;'
  );
  const html = renderPreviewHtml({
    output: DEFAULT_OUTPUT,
    sidecar: {
      id: 'template',
      theme: 'forest',
      status: 'approved',
      review: { decision: 'approved', reviewer: '<img src=x onerror=alert(1)>' },
      pins: {
        sourceImageSha256: null,
        promptProfileSha256: 'sha256:test',
        approvedBlueprintSha256: null,
        compilerSha256: null
      },
      composition: { summary: '</pre><script>alert(1)</script>' },
      topologyIntent: {},
      heightIntent: {},
      routeIntent: {},
      boundaryIntent: {},
      spawnIntent: {},
      forbiddenPatterns: ['<svg onload=alert(1)>']
    },
    sourceImage: null,
    candidates: []
  });
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;\/pre&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('preview rejects a staged source whose exact image hash no longer matches', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/source.png');
  const staged = await stageTemplate({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    source: 'incoming/source.png'
  });
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 150, g: 20, b: 20, alpha: 1 }
    }
  }).png().toFile(path.join(root, staged.sourceImage.path));

  await assert.rejects(previewTemplate(previewOptions(root)), /source image pin mismatch/);
});

test('approved exact source and review pins are rendered without changing lifecycle state', async t => {
  const root = await createFixture(t);
  await createImage(root, 'incoming/source.png', { width: 40, height: 36 });
  await stageTemplate({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    source: 'incoming/source.png'
  });
  const compiler = await computeCurrentCompilerSourceSet({ projectRoot: root });
  await pinTemplateCompiler({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    compilerFullHash: compiler.fullHash
  });
  await approveTemplate({
    projectRoot: root,
    theme: THEME,
    template: TEMPLATE,
    reviewer: 'reviewer-01',
    decision: 'approved'
  });
  const before = JSON.stringify(await readSidecar(root));
  const result = await previewTemplate(previewOptions(root));
  const html = await readFile(path.join(root, DEFAULT_OUTPUT), 'utf8');
  assert.equal(result.status, 'approved');
  assert.equal(result.sourceImage.verified, true);
  assert.match(html, /approved by reviewer-01/);
  assert.match(html, /40×36/);
  assert.match(html, /Exact staged source/);
  assert.equal(JSON.stringify(await readSidecar(root)), before);
});

test('preview output rejects traversal, symlink parents, and overwrite conflicts', async t => {
  const root = await createFixture(t);
  await assert.rejects(
    previewTemplate(previewOptions(root, { output: '../outside.html' })),
    /project-relative|must not contain/
  );
  await assert.rejects(
    previewTemplate(previewOptions(root, { output: 'tmp/preview.html' })),
    /must be below ai-image-metadata\/battle-maps\/review/
  );

  const outside = await temporaryDirectory(t, 'modia-template-preview-outside-');
  const reviewParent = path.join(root, 'ai-image-metadata/battle-maps');
  await mkdir(reviewParent, { recursive: true });
  await symlink(outside, path.join(reviewParent, 'review'));
  await assert.rejects(
    previewTemplate(previewOptions(root)),
    /--output: contains symbolic-link component/
  );
  await rm(path.join(reviewParent, 'review'));

  const first = await previewTemplate(previewOptions(root));
  assert.equal(first.ok, true);
  await assert.rejects(
    previewTemplate(previewOptions(root)),
    /refusing to overwrite existing review output/
  );
});

test('synthetic candidate pins are verified and preview HTML is byte-deterministic', async t => {
  const roots = await Promise.all([createFixture(t), createFixture(t)]);
  const outputs = [];
  for (const root of roots) {
    const candidate = await createCandidate(root);
    const lockDirectory = path.join(
      root,
      `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}/.locks`
    );
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(path.join(lockDirectory, 'candidate-01.lock'), '{"pid":123}\n');
    const result = await previewTemplate(previewOptions(root));
    assert.equal(result.sourceImage, null);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].reviewStatus, 'awaiting-review');
    assert.equal(result.candidates[0].image.verified, true);
    outputs.push({
      imagePath: candidate.imagePath,
      result,
      html: await readFile(path.join(root, DEFAULT_OUTPUT), 'utf8')
    });
  }
  assert.equal(outputs[0].html, outputs[1].html);
  assert.equal(outputs[0].result.outputSha256, outputs[1].result.outputSha256);
  const embedded = outputs[0].html.match(/src="data:image\/png;base64,([^"]+)"/);
  assert.ok(embedded, 'candidate bytes must be embedded in the durable review');
  assert.equal(
    sha256Bytes(Buffer.from(embedded[1], 'base64')),
    outputs[0].result.candidates[0].image.sha256
  );
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 200, g: 10, b: 10, alpha: 1 }
    }
  }).png().toFile(outputs[0].imagePath);
  assert.equal(
    await readFile(path.join(roots[0], DEFAULT_OUTPUT), 'utf8'),
    outputs[0].html,
    'saved review must not dereference mutable candidate bytes'
  );
  assert.match(outputs[0].html, /candidate-01/);
  assert.match(outputs[0].html, /Generated candidates/);
  assert.match(outputs[0].html, /Composition/);
  assert.match(outputs[0].html, /Topology/);
  assert.match(outputs[0].html, /Forbidden patterns/);
  assert.match(outputs[0].html, /sha256:[0-9a-f]{64}/);
});

test('preview rejects a non-directory candidate lock boundary', async t => {
  const root = await createFixture(t);
  await createCandidate(root);
  await writeFile(
    path.join(
      root,
      `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}/.locks`
    ),
    'not a directory\n'
  );
  await assert.rejects(
    previewTemplate(previewOptions(root)),
    /candidate lock directory must be a directory/
  );
});

test('candidate image hash mismatch fails closed before review output is written', async t => {
  const root = await createFixture(t);
  const { imagePath } = await createCandidate(root);
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 180, g: 80, b: 10, alpha: 1 }
    }
  }).png().toFile(imagePath);
  await assert.rejects(
    previewTemplate(previewOptions(root)),
    /candidate candidate-01 image pin mismatch/
  );
});

test('candidate preview requires explicit image-generation capability provenance', async t => {
  const root = await createFixture(t);
  const { result } = await createCandidate(root);
  result.worker.args = result.worker.args.filter(
    argument => !['--enable', 'image_generation'].includes(argument)
  );
  await writeFile(
    path.join(
      root,
      `ai-image-metadata/battle-maps/candidates/${THEME}/${TEMPLATE}/candidate-01/result.json`
    ),
    `${JSON.stringify(result, null, 2)}\n`
  );
  await assert.rejects(
    previewTemplate(previewOptions(root)),
    /candidate worker provenance is invalid/
  );
});
