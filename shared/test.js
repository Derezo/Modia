/**
 * Test script for shared modules
 * Run with: node shared/test.js
 */

import {
  // Constants
  RACES,
  CLASSES,
  SeededRandom,
  calculateStats,

  // Terrain
  IMPASSABLE_TERRAIN,
  TERRAIN_COSTS,
  isImpassable,
  getTerrainMovementCost,
  getTerrainWeights,

  // Map Generation
  generateTerrain,

  // Pathfinding
  getReachableTiles,
  calculatePathCost,
  findPath,
  getManhattanDistance,

  // Battle Math
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHealing,
  calculateHitChance,
  calculateCritChance,
  calculateCritMultiplier,
  calculateDamagePreview
} from './index.js';

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

// ============ Constants Tests ============
section('Constants');

test('RACES exports correctly', RACES.HUMAN === 'human' && RACES.ORC === 'orc');
test('CLASSES exports correctly', CLASSES.WARRIOR === 'warrior');

const rng = new SeededRandom(12345);
const val1 = rng.next();
const val2 = rng.next();
test('SeededRandom produces deterministic values', val1 !== val2 && val1 >= 0 && val1 < 1);

// Test same seed produces same sequence
const rng2 = new SeededRandom(12345);
test('SeededRandom is deterministic', rng2.next() === val1);

const stats = calculateStats('human', 'warrior', 10);
test('calculateStats works', stats.hpMax === 100 + 15 * 9 && stats.strength === 10 + 3 * 9);

// ============ Terrain Tests ============
section('Terrain');

test('IMPASSABLE_TERRAIN contains expected values',
  IMPASSABLE_TERRAIN.includes('rock') &&
  IMPASSABLE_TERRAIN.includes('lava') &&
  !IMPASSABLE_TERRAIN.includes('grass'));

test('TERRAIN_COSTS has correct values',
  TERRAIN_COSTS.grass === 1 &&
  TERRAIN_COSTS.forest === 2 &&
  TERRAIN_COSTS.water === 3);

test('isImpassable returns true for rock', isImpassable('rock') === true);
test('isImpassable returns false for grass', isImpassable('grass') === false);
test('isImpassable returns false for water', isImpassable('water') === false);

test('getTerrainMovementCost for grass', getTerrainMovementCost('grass') === 1);
test('getTerrainMovementCost for water', getTerrainMovementCost('water') === 3);
test('getTerrainMovementCost for rock', getTerrainMovementCost('rock') === Infinity);

const forestWeights = getTerrainWeights('forest');
test('getTerrainWeights for forest', forestWeights.grass === 0.6 && forestWeights.forest === 0.25);

const defaultWeights = getTerrainWeights('unknown');
test('getTerrainWeights defaults correctly', defaultWeights.grass === 0.7);

// ============ Map Generation Tests ============
section('Map Generation');

const seed = 54321;
const result1 = generateTerrain(seed, 'forest', 32, 32);
const result2 = generateTerrain(seed, 'forest', 32, 32);

test('generateTerrain returns terrain array',
  result1.terrain && result1.terrain.length === 32 && result1.terrain[0].length === 32);
test('generateTerrain returns obstacles array',
  result1.obstacles && result1.obstacles.length === 32);
test('generateTerrain returns variants array',
  result1.variants && result1.variants.length === 32);

// Test determinism
test('generateTerrain is deterministic (same seed = same terrain)',
  JSON.stringify(result1.terrain) === JSON.stringify(result2.terrain));

// Test spawn areas are cleared
let spawnAreaClear = true;
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 5; x++) {
    if (isImpassable(result1.terrain[y][x])) {
      spawnAreaClear = false;
    }
  }
  for (let x = 27; x < 32; x++) {
    if (isImpassable(result1.terrain[y][x])) {
      spawnAreaClear = false;
    }
  }
}
test('generateTerrain clears spawn areas', spawnAreaClear);

// Test different biomes produce different terrain
const caveResult = generateTerrain(seed, 'cave', 32, 32);
test('Different biomes produce different terrain',
  JSON.stringify(result1.terrain) !== JSON.stringify(caveResult.terrain));

// ============ Pathfinding Tests ============
section('Pathfinding');

// Create a simple terrain grid for testing
const testTerrain = [];
for (let y = 0; y < 10; y++) {
  const row = [];
  for (let x = 0; x < 10; x++) {
    row.push('grass');
  }
  testTerrain.push(row);
}
// Add some obstacles
testTerrain[5][5] = 'rock';
testTerrain[5][4] = 'rock';

const testUnits = [];

const reachable = getReachableTiles(3, 3, 3, testTerrain, testUnits, 10, 10);
test('getReachableTiles returns array', Array.isArray(reachable));
test('getReachableTiles excludes start position',
  !reachable.some(t => t.x === 3 && t.y === 3));
test('getReachableTiles includes adjacent tiles',
  reachable.some(t => t.x === 4 && t.y === 3 && t.cost === 1));

const pathCost = calculatePathCost(0, 0, 2, 0, testTerrain, testUnits, 10, 10, 10);
test('calculatePathCost returns correct cost', pathCost === 2);

const pathCostBlocked = calculatePathCost(4, 5, 6, 5, testTerrain, testUnits, 3, 10, 10);
test('calculatePathCost returns Infinity for blocked path', pathCostBlocked === Infinity);

const path = findPath(0, 0, 3, 3, testTerrain, testUnits, 10, 10);
test('findPath returns array', Array.isArray(path));
test('findPath starts at origin', path[0].x === 0 && path[0].y === 0);
test('findPath ends at destination', path[path.length - 1].x === 3 && path[path.length - 1].y === 3);

test('getManhattanDistance is correct', getManhattanDistance(0, 0, 3, 4) === 7);

// ============ Battle Math Tests ============
section('Battle Math');

const attacker = {
  strength: 20,
  attack: 10,
  intelligence: 15,
  magicAttack: 5,
  agility: 12,
  luck: 20,
  race: 'human'
};

const defender = {
  vitality: 15,
  defense: 5,
  intelligence: 10,
  magicDefense: 3,
  agility: 10,
  hp: 100,
  maxHp: 100
};

const physDmg = calculatePhysicalDamage(attacker, defender, 100);
test('calculatePhysicalDamage returns min/max/avg',
  physDmg.minDamage > 0 && physDmg.maxDamage >= physDmg.minDamage);

const magDmg = calculateMagicalDamage(attacker, defender, 100);
test('calculateMagicalDamage returns min/max/avg',
  magDmg.minDamage > 0 && magDmg.maxDamage >= magDmg.minDamage);

const healing = calculateHealing(attacker, { hp: 50, maxHp: 100 }, 100);
test('calculateHealing returns heal data',
  healing.minHeal > 0 && healing.maxHeal >= healing.minHeal);
test('calculateHealing detects overheal', healing.isOverheal === false);

const overhealing = calculateHealing(attacker, { hp: 95, maxHp: 100 }, 100);
test('calculateHealing detects actual overheal', overhealing.isOverheal === true);

const hitChance = calculateHitChance(attacker, defender);
test('calculateHitChance returns valid percentage', hitChance >= 0.5 && hitChance <= 1.0);

const critChance = calculateCritChance(attacker);
test('calculateCritChance returns valid percentage', critChance >= 0 && critChance <= 0.30);
test('calculateCritChance caps at 30%', calculateCritChance({ luck: 100 }) === 0.30);

const critMult = calculateCritMultiplier(attacker);
test('calculateCritMultiplier base is 1.5', critMult === 1.5);

const orcCritMult = calculateCritMultiplier({ race: 'orc' });
test('calculateCritMultiplier orc bonus', Math.abs(orcCritMult - 1.65) < 0.001);

const preview = calculateDamagePreview(attacker, defender, { power: 100, damageType: 'physical' });
test('calculateDamagePreview returns complete data',
  preview.minDamage > 0 &&
  preview.hitChance > 0 &&
  preview.critChance >= 0 &&
  preview.type === 'physical');

const healPreview = calculateDamagePreview(attacker, defender, { power: 100, effect: 'heal' });
test('calculateDamagePreview handles heals',
  healPreview.type === 'heal' &&
  healPreview.minHeal > 0 &&
  healPreview.hitChance === 1.0);

// ============ Summary ============
section('Summary');
console.log(`\nPassed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
