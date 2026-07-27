#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CHARACTER_KIND = process.env.MODIA_AUTHORED_CHARACTER_KIND === 'enemy' ? 'enemy' : 'player';
const SPEC_ROOT = path.join(
  PROJECT_ROOT,
  CHARACTER_KIND === 'enemy'
    ? 'ai-image-metadata/characters/enemy-authored-animations'
    : 'ai-image-metadata/characters/player-authored-animations'
);
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;
const VALID_PHASES = new Set(['reference', 'animations']);

function usage() {
  return `
Generate authored ${CHARACTER_KIND} candidates with isolated Codex CLI workers.

Usage:
  node scripts/ai-images/generate-authored-${CHARACTER_KIND}-candidates.js ${CHARACTER_KIND === 'enemy' ? '--biome <biome> (--id <id>|--all)' : '--id <id>'} [options]

Options:
  --id <id>                 Required authored ${CHARACTER_KIND} identity
  --biome <biome>           Required for enemies; selects the biome-scoped spec
  ${CHARACTER_KIND === 'enemy' ? '--all                     Process every configured enemy in the biome sequentially' : ''}
  --phase <phase>           reference or animations (default: reference)
  --actions <a,b,...>       Limit the animations phase to named actions
  --concurrency <n>         Parallel animation workers, 1-${MAX_CONCURRENCY} (default: ${DEFAULT_CONCURRENCY})
  --model <model>           Optional Codex model override
  --force                   Intentionally replace existing chroma and RGBA files
  --dry-run                 Print the worker plan without starting Codex
  --help                    Show this help

Recommended sequence:
  1. Run --phase reference and visually approve reference.png.
  2. Run --phase animations --concurrency 2.
  3. Visually review, approve, pin, and compile with the existing workflow.
`.trim();
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    id: null,
    ...(CHARACTER_KIND === 'enemy' ? { biome: null, all: false } : {}),
    phase: 'reference',
    actions: null,
    concurrency: DEFAULT_CONCURRENCY,
    model: null,
    force: false,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--id':
        options.id = readValue(argv, index, arg);
        index++;
        break;
      case '--phase':
        options.phase = readValue(argv, index, arg);
        index++;
        break;
      case '--biome':
        options.biome = readValue(argv, index, arg);
        index++;
        break;
      case '--all':
        if (CHARACTER_KIND !== 'enemy') throw new Error('--all is only supported for enemies');
        options.all = true;
        break;
      case '--actions':
        options.actions = readValue(argv, index, arg)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
        index++;
        break;
      case '--concurrency':
        options.concurrency = Number.parseInt(readValue(argv, index, arg), 10);
        index++;
        break;
      case '--model':
        options.model = readValue(argv, index, arg);
        index++;
        break;
      case '--force':
        options.force = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.help) return options;
  if (CHARACTER_KIND === 'enemy' && Boolean(options.id) === Boolean(options.all)) {
    throw new Error('provide exactly one of --id or --all');
  }
  if (CHARACTER_KIND !== 'enemy' && !options.id) throw new Error('--id is required');
  if (options.id && !/^[a-z0-9_]+$/.test(options.id)) {
    throw new Error(`Invalid --id '${options.id}'`);
  }
  if (options.biome && !/^[a-z0-9_]+$/.test(options.biome)) {
    throw new Error(`Invalid --biome '${options.biome}'`);
  }
  if (CHARACTER_KIND === 'enemy' && !options.biome) throw new Error('--biome is required for enemies');
  if (!VALID_PHASES.has(options.phase)) {
    throw new Error(`Invalid --phase '${options.phase}'; use reference or animations`);
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > MAX_CONCURRENCY
  ) {
    throw new Error(`--concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`);
  }
  if (options.phase === 'reference' && options.actions) {
    throw new Error('--actions can only be used with --phase animations');
  }

  return options;
}

function loadSpec(id, biome = null) {
  const specPath = path.join(SPEC_ROOT, ...(biome ? [biome] : []), `${id}.json`);
  if (!fs.existsSync(specPath)) {
    throw new Error(`Authored animation spec not found: ${path.relative(PROJECT_ROOT, specPath)}`);
  }
  return { specPath, spec: JSON.parse(fs.readFileSync(specPath, 'utf8')) };
}

function absolute(relativePath) {
  return path.resolve(PROJECT_ROOT, relativePath);
}

function referenceInputImages(spec) {
  const styleSource = spec.inputs?.style?.staged || spec.reference?.styleSource;
  const identitySource = spec.inputs?.identity?.staged || spec.reference?.identitySource;
  const missing = [];
  if (!identitySource) missing.push('identity');
  if (!styleSource) missing.push('style');
  if (missing.length) {
    throw new Error(
      `${spec.id} reference metadata is missing ${missing.join(' and ')} input source`
    );
  }
  return [
    { path: absolute(identitySource), role: 'identity authority (Image 1)' },
    { path: absolute(styleSource), role: 'rendering-style authority (Image 2)' }
  ];
}

function candidateState(job, force) {
  const chromaExists = fs.existsSync(job.chromaPath);
  const rgbaExists = fs.existsSync(job.rgbaPath);

  if (!force && rgbaExists && !chromaExists) {
    throw new Error(
      `${job.name} has an RGBA source but no retained chroma source; use --force to replace the pair`
    );
  }

  return {
    generate: force || !chromaExists,
    removeMatte: force || !rgbaExists,
    skip: !force && chromaExists && rgbaExists
  };
}

function buildJobs(spec, options) {
  if (options.phase === 'reference') {
    return [{
      name: 'reference',
      specField: 'reference',
      chromaPath: absolute(spec.reference.chromaSource),
      rgbaPath: absolute(spec.reference.source),
      images: referenceInputImages(spec)
    }];
  }

  const referencePath = absolute(spec.reference.source);
  if (!fs.existsSync(referencePath)) {
    throw new Error(
      `Accepted reference is missing: ${path.relative(PROJECT_ROOT, referencePath)}. ` +
      'Run --phase reference and review it first.'
    );
  }

  const available = Object.entries(spec.animations)
    .filter(([, animation]) => !animation.deriveFrom && animation.source && animation.chromaSource);
  const availableNames = available.map(([name]) => name);
  const selected = options.actions || availableNames;
  const unknown = selected.filter(name => !availableNames.includes(name));
  if (unknown.length) {
    throw new Error(
      `Unknown or derived animation(s): ${unknown.join(', ')}. Available: ${availableNames.join(', ')}`
    );
  }

  return available
    .filter(([name]) => selected.includes(name))
    .map(([name, animation]) => ({
      name,
      specField: `animations.${name}`,
      chromaPath: absolute(animation.chromaSource),
      rgbaPath: absolute(animation.source),
      images: [{ path: referencePath, role: 'approved full-body identity authority (Image 1)' }]
    }));
}

function assertInputs(jobs) {
  const missing = [];
  for (const job of jobs) {
    for (const image of job.images) {
      if (!fs.existsSync(image.path)) missing.push(image.path);
    }
  }
  if (missing.length) {
    throw new Error(
      `Missing worker input(s):\n${[...new Set(missing)]
        .map(file => `  - ${path.relative(PROJECT_ROOT, file)}`)
        .join('\n')}`
    );
  }
}

function buildWorkerPrompt(specPath, job, state) {
  const relativeSpec = path.relative(PROJECT_ROOT, specPath);
  const chroma = path.relative(PROJECT_ROOT, job.chromaPath);
  const rgba = path.relative(PROJECT_ROOT, job.rgbaPath);
  const imageRoles = job.images
    .map(image => `- ${image.role}: ${path.relative(PROJECT_ROOT, image.path)}`)
    .join('\n');
  const generationInstruction = state.generate
    ? `Call the built-in image_gen tool exactly once. Pass the prompt stored at ${job.specField}.prompt ` +
      `without rewriting, shortening, or expanding it. Copy the unmodified generated PNG to ${chroma}.`
    : `Do not call image_gen. Reuse the retained chroma candidate at ${chroma}.`;

  return `
Use the imagegen skill for one bounded Modia candidate-generation job.

Read ${relativeSpec} and process only "${job.name}". The attached input images have these roles:
${imageRoles}

${generationInstruction}

Then run the installed imagegen chroma-removal helper on ${chroma} and write ${rgba}, using:
--auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill --force

Validate that both files exist, the retained candidate is PNG, and the accepted file is RGBA with
transparent corners. Do not generate any other asset. Do not edit metadata, status, pins, docs,
runtime outputs, or any file other than the two exact candidate paths above. Do not approve or
compile the identity. Finish with a compact result naming both paths.
`.trim();
}

function buildCodexArgs(job, options, lastMessagePath) {
  const args = [
    'exec',
    '--ephemeral',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'danger-full-access',
    '-C',
    PROJECT_ROOT,
    '-c',
    'model_reasoning_effort="low"',
    '-o',
    lastMessagePath
  ];
  if (options.model) args.push('--model', options.model);
  for (const image of job.images) args.push('--image', image.path);
  return args;
}

function fileSnapshot(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function snapshotRequiredOutputs(job, state) {
  const required = [];
  if (state.generate) required.push(job.chromaPath);
  if (state.removeMatte) required.push(job.rgbaPath);
  return new Map(required.map(filePath => [filePath, fileSnapshot(filePath)]));
}

function requiredOutputsWereUpdated(snapshots) {
  return [...snapshots].every(
    ([filePath, previous]) => fs.existsSync(filePath) && fileSnapshot(filePath) !== previous
  );
}

function runWorker({ job, specPath, state, options, runDirectory }) {
  return new Promise((resolve, reject) => {
    const stem = job.name.replace(/[^a-z0-9_-]/gi, '_');
    const jsonlPath = path.join(runDirectory, `${stem}.jsonl`);
    const stderrPath = path.join(runDirectory, `${stem}.stderr.log`);
    const lastMessagePath = path.join(runDirectory, `${stem}.last.txt`);
    const prompt = buildWorkerPrompt(specPath, job, state);
    fs.writeFileSync(path.join(runDirectory, `${stem}.prompt.txt`), `${prompt}\n`);

    fs.mkdirSync(path.dirname(job.chromaPath), { recursive: true });
    fs.mkdirSync(path.dirname(job.rgbaPath), { recursive: true });
    const outputSnapshots = snapshotRequiredOutputs(job, state);

    const child = spawn('codex', buildCodexArgs(job, options, lastMessagePath), {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const jsonl = fs.createWriteStream(jsonlPath);
    const stderr = fs.createWriteStream(stderrPath);
    child.stdout.pipe(jsonl);
    child.stderr.pipe(stderr);
    child.stdin.end(`${prompt}\n`);

    child.once('error', reject);
    child.once('close', (code, signal) => {
      jsonl.end();
      stderr.end();
      if (code !== 0) {
        const exit = signal ? `was terminated by ${signal}` : `exited with code ${code}`;
        if (requiredOutputsWereUpdated(outputSnapshots)) {
          console.warn(
            `[recover] ${job.name}: Codex worker ${exit} after updating its outputs; ` +
            'validating the completed files'
          );
          resolve({ job, jsonlPath, lastMessagePath, recoveredExit: { code, signal } });
          return;
        }
        reject(new Error(`${job.name} Codex worker ${exit}; see ${jsonlPath}`));
        return;
      }
      resolve({ job, jsonlPath, lastMessagePath });
    });
  });
}

async function validateResult(job) {
  for (const file of [job.chromaPath, job.rgbaPath]) {
    if (!fs.existsSync(file)) {
      throw new Error(`${job.name} worker did not create ${path.relative(PROJECT_ROOT, file)}`);
    }
  }
  const chromaMetadata = await sharp(job.chromaPath).metadata();
  const rgbaMetadata = await sharp(job.rgbaPath).metadata();
  if (chromaMetadata.format !== 'png' || rgbaMetadata.format !== 'png') {
    throw new Error(`${job.name} outputs must both be PNG`);
  }
  if (!rgbaMetadata.hasAlpha || rgbaMetadata.channels !== 4) {
    throw new Error(`${job.name} accepted source is not RGBA`);
  }
  if (
    chromaMetadata.width !== rgbaMetadata.width ||
    chromaMetadata.height !== rgbaMetadata.height
  ) {
    throw new Error(`${job.name} chroma and RGBA dimensions differ`);
  }
  if (job.name === 'reference' && rgbaMetadata.width !== rgbaMetadata.height) {
    throw new Error('reference accepted source must be square');
  }
  const { data, info } = await sharp(job.rgbaPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[((y * info.width + x) * info.channels) + 3];
  const cornerAlpha = [
    alphaAt(0, 0),
    alphaAt(info.width - 1, 0),
    alphaAt(0, info.height - 1),
    alphaAt(info.width - 1, info.height - 1)
  ];
  if (cornerAlpha.some(alpha => alpha !== 0)) {
    throw new Error(`${job.name} accepted source does not have fully transparent corners`);
  }
}

async function normalizeReferenceResult(job) {
  if (
    job.name !== 'reference' ||
    !fs.existsSync(job.chromaPath) ||
    !fs.existsSync(job.rgbaPath)
  ) {
    return null;
  }

  const [chromaMetadata, rgbaMetadata] = await Promise.all([
    sharp(job.chromaPath).metadata(),
    sharp(job.rgbaPath).metadata()
  ]);
  if (
    chromaMetadata.width !== rgbaMetadata.width ||
    chromaMetadata.height !== rgbaMetadata.height ||
    rgbaMetadata.width === rgbaMetadata.height
  ) {
    return null;
  }

  const width = rgbaMetadata.width;
  const height = rgbaMetadata.height;
  const size = Math.max(width, height);
  const horizontalPadding = size - width;
  const verticalPadding = size - height;
  const extend = {
    left: Math.floor(horizontalPadding / 2),
    right: Math.ceil(horizontalPadding / 2),
    top: Math.floor(verticalPadding / 2),
    bottom: Math.ceil(verticalPadding / 2)
  };
  const chromaCorner = await sharp(job.chromaPath)
    .removeAlpha()
    .toColourspace('srgb')
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer();
  const chromaBackground = {
    r: chromaCorner[0],
    g: chromaCorner[1],
    b: chromaCorner[2]
  };
  const [chromaBuffer, rgbaBuffer] = await Promise.all([
    sharp(job.chromaPath)
      .removeAlpha()
      .extend({ ...extend, background: chromaBackground })
      .png()
      .toBuffer(),
    sharp(job.rgbaPath)
      .ensureAlpha()
      .extend({ ...extend, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  ]);

  const suffix = `.normalize-${process.pid}-${Date.now()}`;
  const chromaTemporary = `${job.chromaPath}${suffix}`;
  const rgbaTemporary = `${job.rgbaPath}${suffix}`;
  try {
    await Promise.all([
      fs.promises.writeFile(chromaTemporary, chromaBuffer),
      fs.promises.writeFile(rgbaTemporary, rgbaBuffer)
    ]);
    await fs.promises.rename(chromaTemporary, job.chromaPath);
    await fs.promises.rename(rgbaTemporary, job.rgbaPath);
  } finally {
    await Promise.all([
      fs.promises.rm(chromaTemporary, { force: true }),
      fs.promises.rm(rgbaTemporary, { force: true })
    ]);
  }

  return { width, height, size };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  return results;
}

function displayPlan(jobs, states, options) {
  console.log(`Identity: ${options.id}`);
  if (options.biome) console.log(`Biome: ${options.biome}`);
  console.log(`Phase: ${options.phase}`);
  console.log(`Concurrency: ${options.phase === 'reference' ? 1 : options.concurrency}`);
  for (const [index, job] of jobs.entries()) {
    const state = states[index];
    const operation = state.skip
      ? 'skip (complete)'
      : state.generate
        ? 'generate + remove matte'
        : 'remove matte only';
    console.log(`  ${job.name}: ${operation}`);
  }
}

async function processIdentity(options) {
  const { specPath, spec } = loadSpec(options.id, options.biome);
  if (spec.id !== options.id) {
    throw new Error(`Spec ID '${spec.id}' does not match --id '${options.id}'`);
  }
  if (options.biome && spec.biome !== options.biome) {
    throw new Error(`Spec biome '${spec.biome}' does not match --biome '${options.biome}'`);
  }
  const jobs = buildJobs(spec, options);
  assertInputs(jobs);
  const states = jobs.map(job => candidateState(job, options.force));
  displayPlan(jobs, states, options);
  if (options.dryRun) return;

  for (const job of jobs) {
    const normalized = await normalizeReferenceResult(job);
    if (normalized) {
      console.log(
        `[normalize] ${job.name}: padded ${normalized.width}x${normalized.height} ` +
        `to ${normalized.size}x${normalized.size}`
      );
    }
  }
  const pending = jobs
    .map((job, index) => ({ job, state: states[index] }))
    .filter(item => !item.state.skip);
  if (!pending.length) {
    console.log('All requested candidates already exist; nothing to do.');
    return;
  }

  const codexVersion = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (codexVersion.status !== 0) {
    throw new Error('codex CLI is unavailable on PATH');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDirectory = path.join(
    PROJECT_ROOT,
    'tmp/codex-imagegen',
    `${timestamp}-${options.biome ? `${options.biome}-` : ''}${options.id}`
  );
  fs.mkdirSync(runDirectory, { recursive: true });
  console.log(`Worker logs: ${path.relative(PROJECT_ROOT, runDirectory)}`);

  const concurrency = options.phase === 'reference' ? 1 : options.concurrency;
  await runPool(pending, concurrency, async ({ job, state }) => {
    console.log(`[start] ${job.name}`);
    const result = await runWorker({ job, specPath, state, options, runDirectory });
    const normalized = await normalizeReferenceResult(job);
    if (normalized) {
      console.log(
        `[normalize] ${job.name}: padded ${normalized.width}x${normalized.height} ` +
        `to ${normalized.size}x${normalized.size}`
      );
    }
    await validateResult(job);
    console.log(`[done] ${job.name}`);
    return result;
  });

  console.log(
    options.phase === 'reference'
      ? 'Reference candidate ready for visual review. Do not start animations until it is accepted.'
      : `Animation candidates ready for visual review. After review, run the explicit ${CHARACTER_KIND === 'enemy' ? '--approve ' : ''}compile command.`
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.all) return processIdentity(options);

  const registryPath = path.join(PROJECT_ROOT, 'ai-image-metadata/characters/enemies', `${options.biome}.json`);
  const registry = JSON.parse(await fs.promises.readFile(registryPath, 'utf8'));
  if (registry.biome !== options.biome) throw new Error(`registry biome '${registry.biome}' does not match --biome '${options.biome}'`);
  const aliasPath = path.join(PROJECT_ROOT, 'ai-image-metadata/characters/enemy-authored-identity-aliases.json');
  const aliasRegistry = JSON.parse(await fs.promises.readFile(aliasPath, 'utf8'));
  const ids = [
    ...(registry.enemies || []).map(enemy => enemy.id),
    ...(aliasRegistry.aliases || []).filter(alias => alias.biome === options.biome).map(alias => alias.id)
  ];
  if (!ids.length) throw new Error(`${options.biome} has no configured enemies`);
  console.log(`Sequential biome batch: ${options.biome} (${ids.length} enemies)`);
  for (const id of ids) {
    console.log(`\n=== ${options.biome}/${id} ===`);
    await processIdentity({ ...options, all: false, id });
  }
  return { ok: true, biome: options.biome, targets: ids.length };
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Candidate generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_CONCURRENCY,
  buildCodexArgs,
  buildJobs,
  buildWorkerPrompt,
  candidateState,
  normalizeReferenceResult,
  parseArgs,
  requiredOutputsWereUpdated,
  runPool,
  snapshotRequiredOutputs,
  processIdentity,
  main
};
