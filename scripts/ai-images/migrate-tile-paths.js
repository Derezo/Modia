#!/usr/bin/env node
/**
 * Tile Path Migration Script
 * Moves wall and slope files from legacy naming to new convention
 *
 * Legacy format:
 *   - Walls: {biome}/wall_{biome}_{terrain}.png
 *   - Slopes: {biome}/slope_{biome}_{direction}_{levels}.png
 *
 * New format:
 *   - Walls: {biome}/walls/{terrain}_wall.png
 *   - Slopes: {biome}/slopes/{direction}_{levels}.png
 *
 * Usage:
 *   node scripts/ai-images/migrate-tile-paths.js                # Dry-run (default)
 *   node scripts/ai-images/migrate-tile-paths.js --execute      # Actually move files
 *   node scripts/ai-images/migrate-tile-paths.js --biome forest # Single biome only
 *   node scripts/ai-images/migrate-tile-paths.js --verify       # Verify migration success
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TERRAIN_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/terrain');

const BIOMES = ['base', 'bridge', 'castle', 'cave', 'forest', 'mountain'];

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    execute: args.includes('--execute'),
    verify: args.includes('--verify'),
    biome: args.includes('--biome') ? args[args.indexOf('--biome') + 1] : null,
    verbose: args.includes('--verbose') || args.includes('-v')
  };
}

/**
 * Find all wall files in legacy format
 */
function findLegacyWalls(biome) {
  const biomeDir = path.join(TERRAIN_DIR, biome);
  if (!fs.existsSync(biomeDir)) return [];

  const files = fs.readdirSync(biomeDir);
  const wallPattern = new RegExp(`^wall_${biome}_(.+)\\.png$`);

  return files
    .filter(f => wallPattern.test(f))
    .map(f => {
      const match = f.match(wallPattern);
      const terrain = match[1];
      return {
        type: 'wall',
        biome,
        terrain,
        oldPath: path.join(biomeDir, f),
        newPath: path.join(biomeDir, 'walls', `${terrain}_wall.png`)
      };
    });
}

/**
 * Find all slope files in legacy format (includes regular slopes and stairs)
 */
function findLegacySlopes(biome) {
  const biomeDir = path.join(TERRAIN_DIR, biome);
  if (!fs.existsSync(biomeDir)) return [];

  const files = fs.readdirSync(biomeDir);
  const results = [];

  // Regular slopes: slope_{biome}_{direction}_{levels}.png
  const slopePattern = new RegExp(`^slope_${biome}_(.+)_(\\d+)\\.png$`);
  for (const f of files) {
    const match = f.match(slopePattern);
    if (match) {
      results.push({
        type: 'slope',
        biome,
        direction: match[1],
        levels: match[2],
        oldPath: path.join(biomeDir, f),
        newPath: path.join(biomeDir, 'slopes', `${match[1]}_${match[2]}.png`)
      });
    }
  }

  // Stairs: stairs_{biome}_{direction}_{levels}.png
  const stairsPattern = new RegExp(`^stairs_${biome}_(.+)_(\\d+)\\.png$`);
  for (const f of files) {
    const match = f.match(stairsPattern);
    if (match) {
      results.push({
        type: 'stairs',
        biome,
        direction: match[1],
        levels: match[2],
        oldPath: path.join(biomeDir, f),
        newPath: path.join(biomeDir, 'slopes', `stairs_${match[1]}_${match[2]}.png`)
      });
    }
  }

  return results;
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Move a file (with safety checks)
 */
function moveFile(migration, dryRun) {
  const { oldPath, newPath } = migration;
  const relOld = path.relative(PROJECT_ROOT, oldPath);
  const relNew = path.relative(PROJECT_ROOT, newPath);

  if (!fs.existsSync(oldPath)) {
    console.log(`  [SKIP] Source not found: ${relOld}`);
    return { status: 'skip', reason: 'source_missing' };
  }

  if (fs.existsSync(newPath)) {
    console.log(`  [SKIP] Destination exists: ${relNew}`);
    return { status: 'skip', reason: 'dest_exists' };
  }

  if (dryRun) {
    console.log(`  [DRY] ${relOld}`);
    console.log(`     -> ${relNew}`);
    return { status: 'dry', oldPath: relOld, newPath: relNew };
  }

  // Actually move the file
  ensureDir(path.dirname(newPath));
  fs.renameSync(oldPath, newPath);
  console.log(`  [MOVED] ${relOld}`);
  console.log(`       -> ${relNew}`);
  return { status: 'moved', oldPath: relOld, newPath: relNew };
}

/**
 * Verify migration was successful
 */
function verifyMigration(biomes) {
  console.log('\n=== Verification ===\n');

  let issues = 0;

  for (const biome of biomes) {
    const biomeDir = path.join(TERRAIN_DIR, biome);
    if (!fs.existsSync(biomeDir)) continue;

    // Check for any remaining legacy files
    const legacyWalls = findLegacyWalls(biome);
    const legacySlopes = findLegacySlopes(biome);

    if (legacyWalls.length > 0 || legacySlopes.length > 0) {
      console.log(`[WARN] ${biome}: ${legacyWalls.length} walls, ${legacySlopes.length} slopes still in legacy format`);
      issues += legacyWalls.length + legacySlopes.length;
    }

    // Check walls/ subdirectory
    const wallsDir = path.join(biomeDir, 'walls');
    if (fs.existsSync(wallsDir)) {
      const wallFiles = fs.readdirSync(wallsDir).filter(f => f.endsWith('.png'));
      console.log(`[OK] ${biome}/walls/: ${wallFiles.length} files`);
    }

    // Check slopes/ subdirectory
    const slopesDir = path.join(biomeDir, 'slopes');
    if (fs.existsSync(slopesDir)) {
      const slopeFiles = fs.readdirSync(slopesDir).filter(f => f.endsWith('.png'));
      console.log(`[OK] ${biome}/slopes/: ${slopeFiles.length} files`);
    }
  }

  console.log(`\nTotal issues: ${issues}`);
  return issues === 0;
}

/**
 * Main migration function
 */
function migrate() {
  const options = parseArgs();

  console.log('=== Tile Path Migration ===\n');

  if (!options.execute && !options.verify) {
    console.log('Running in DRY-RUN mode (use --execute to actually move files)\n');
  }

  const biomes = options.biome ? [options.biome] : BIOMES;

  if (options.verify) {
    const success = verifyMigration(biomes);
    process.exit(success ? 0 : 1);
  }

  const stats = {
    walls: { dry: 0, moved: 0, skip: 0 },
    slopes: { dry: 0, moved: 0, skip: 0 }
  };

  for (const biome of biomes) {
    console.log(`\n--- ${biome} ---`);

    // Migrate walls
    const walls = findLegacyWalls(biome);
    if (walls.length > 0) {
      console.log(`\nWalls (${walls.length}):`);
      for (const migration of walls) {
        const result = moveFile(migration, !options.execute);
        stats.walls[result.status]++;
      }
    } else {
      console.log('\nNo legacy wall files found');
    }

    // Migrate slopes
    const slopes = findLegacySlopes(biome);
    if (slopes.length > 0) {
      console.log(`\nSlopes (${slopes.length}):`);
      for (const migration of slopes) {
        const result = moveFile(migration, !options.execute);
        stats.slopes[result.status]++;
      }
    } else {
      console.log('\nNo legacy slope files found');
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  if (options.execute) {
    console.log(`Walls:  ${stats.walls.moved} moved, ${stats.walls.skip} skipped`);
    console.log(`Slopes: ${stats.slopes.moved} moved, ${stats.slopes.skip} skipped`);
  } else {
    console.log(`Walls:  ${stats.walls.dry} would be moved, ${stats.walls.skip} would be skipped`);
    console.log(`Slopes: ${stats.slopes.dry} would be moved, ${stats.slopes.skip} would be skipped`);
    console.log('\nRun with --execute to perform migration');
  }
}

migrate();
