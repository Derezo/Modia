#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const SOURCES_PATH = path.join(
  PROJECT_ROOT,
  'ai-image-metadata/fishing/sources.json'
);
const ITEM_SIZES = Object.freeze([32, 64, 128]);
const checkOnly = process.argv.includes('--check');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function readSources() {
  return JSON.parse(await fs.readFile(SOURCES_PATH, 'utf8'));
}

async function expectedGearVariant(source, size) {
  if (size === 'originals') return source;
  return sharp(source)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3
    })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

async function ensureOutput(outputPath, expected, issues) {
  let current = null;
  try {
    current = await fs.readFile(outputPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (current?.equals(expected)) return false;
  const relative = path.relative(PROJECT_ROOT, outputPath);
  if (checkOnly) {
    issues.push(`${relative} is missing or differs from its accepted source`);
    return false;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, expected);
  return true;
}

async function compile() {
  const sources = await readSources();
  const issues = [];
  let written = 0;

  for (const asset of sources.backgrounds || []) {
    const sourcePath = path.join(PROJECT_ROOT, asset.source);
    const source = await fs.readFile(sourcePath);
    if (sha256(source) !== asset.sha256) {
      issues.push(`${asset.source} does not match its pinned SHA-256`);
      continue;
    }
    const output = path.join(
      PROJECT_ROOT,
      'frontend/public/assets/fishing/backgrounds',
      `${asset.id}.webp`
    );
    if (await ensureOutput(output, source, issues)) written += 1;
  }

  for (const asset of sources.gear || []) {
    const sourcePath = path.join(PROJECT_ROOT, asset.source);
    const source = await fs.readFile(sourcePath);
    if (sha256(source) !== asset.sha256) {
      issues.push(`${asset.source} does not match its pinned SHA-256`);
      continue;
    }

    for (const size of [...ITEM_SIZES, 'originals']) {
      const expected = await expectedGearVariant(source, size);
      const output = path.join(
        PROJECT_ROOT,
        'frontend/public/assets/items',
        String(size),
        'consumables',
        `${asset.id}.webp`
      );
      if (await ensureOutput(output, expected, issues)) written += 1;
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) console.error(`[fishing-assets] ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    checkOnly
      ? '[fishing-assets] accepted sources and runtime outputs are in sync'
      : `[fishing-assets] compiled ${written} changed runtime asset(s)`
  );
}

await compile();
