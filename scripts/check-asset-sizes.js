#!/usr/bin/env node
/**
 * Asset Size Check
 *
 * Scans frontend/public/assets/ and warns on files exceeding per-category
 * budgets. Intended for CI (warn-only, exit 0 unless --strict) and local
 * pre-commit checks.
 *
 * Usage:
 *   node scripts/check-asset-sizes.js            # warn only, exit 0
 *   node scripts/check-asset-sizes.js --strict   # exit 1 if violations
 *   node scripts/check-asset-sizes.js --top 10   # show top 10 biggest files
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ASSET_ROOT = path.join(PROJECT_ROOT, 'frontend/public/assets');

// Per-extension budgets in bytes
const BUDGETS = {
  png: 200 * 1024,
  webp: 150 * 1024,
  jpg: 200 * 1024,
  jpeg: 200 * 1024,
  gif: 100 * 1024,
  svg: 50 * 1024,
  mp3: 500 * 1024,
  ogg: 500 * 1024,
  opus: 400 * 1024,
  wav: 1024 * 1024,
  m4a: 500 * 1024
};

// Directories that are acceptable to have larger files (source originals,
// long-form music tracks). Listed as path prefixes relative to ASSET_ROOT.
// factor: Infinity => skip the budget entirely (treated as source / not shipped).
const BUDGET_OVERRIDES = [
  { prefix: 'portraits/originals/', factor: Infinity },
  { prefix: 'icons/originals/', factor: Infinity },
  { prefix: 'overlays/originals/', factor: Infinity },
  { prefix: 'items/originals/', factor: Infinity },
  { prefix: 'nodes/originals/', factor: Infinity },
  { prefix: 'audio/music/', factor: 20 }
];

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { strict: false, top: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--top') opts.top = parseInt(argv[++i], 10) || 10;
  }
  return opts;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function budgetFor(relativePath, extension) {
  const base = BUDGETS[extension];
  if (!base) return null;
  for (const override of BUDGET_OVERRIDES) {
    if (relativePath.startsWith(override.prefix)) {
      return base * override.factor;
    }
  }
  return base;
}

function formatBytes(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function main() {
  const opts = parseArgs();

  if (!fs.existsSync(ASSET_ROOT)) {
    console.log(`No asset directory found at ${path.relative(PROJECT_ROOT, ASSET_ROOT)}; nothing to check.`);
    return;
  }

  const violations = [];
  const all = [];

  for (const file of walk(ASSET_ROOT)) {
    const relative = path.relative(ASSET_ROOT, file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const size = fs.statSync(file).size;
    all.push({ relative, size, ext });

    const budget = budgetFor(relative, ext);
    if (budget !== null && Number.isFinite(budget) && size > budget) {
      violations.push({ relative, size, budget, ext });
    }
  }

  if (violations.length > 0) {
    console.log(`Asset size violations (${violations.length}):`);
    violations
      .sort((a, b) => b.size - a.size)
      .slice(0, 50)
      .forEach(v => {
        console.log(`  ${formatBytes(v.size).padStart(10)} (budget ${formatBytes(v.budget)})  ${v.relative}`);
      });
    if (violations.length > 50) {
      console.log(`  ... and ${violations.length - 50} more`);
    }
  } else {
    console.log('All assets within size budgets.');
  }

  if (opts.top > 0) {
    console.log(`\nTop ${opts.top} largest assets:`);
    all.sort((a, b) => b.size - a.size).slice(0, opts.top).forEach(f => {
      console.log(`  ${formatBytes(f.size).padStart(10)}  ${f.relative}`);
    });
  }

  if (opts.strict && violations.length > 0) {
    process.exit(1);
  }
}

main();
