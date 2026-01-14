#!/usr/bin/env node
/**
 * Test script for castle placement algorithm
 *
 * Run with: node api/src/db/testCastlePlacement.js [seed]
 *
 * Tests the force-directed castle placement algorithm with multiple seeds
 * to ensure consistent results across different random configurations.
 */

import { SeededRandom } from '../config/constants.js';
import {
  generateCastlePlacements,
  validateCastlePlacement,
  CASTLE_PLACEMENT
} from './seed.js';

// Parse command line arguments
const args = process.argv.slice(2);
const testSeed = args[0] ? parseInt(args[0], 10) : null;

console.log('Castle Placement Algorithm Test Suite');
console.log('=====================================\n');

if (testSeed !== null) {
  // Single seed test
  console.log(`Running single test with seed: ${testSeed}\n`);
  const result = validateCastlePlacement(testSeed);
  process.exit(result.passed ? 0 : 1);
}

// Multi-seed test suite
const testSeeds = [12345, 54321, 99999, 1, 999999, 123456789];
let passCount = 0;
let failCount = 0;
const results = [];

console.log(`Running tests with ${testSeeds.length} different seeds...\n`);

for (const seed of testSeeds) {
  console.log(`\nTesting seed ${seed}...`);
  const result = validateCastlePlacement(seed);

  if (result.passed) {
    passCount++;
  } else {
    failCount++;
  }

  results.push({
    seed,
    passed: result.passed,
    minDist: result.minDist,
    avgDist: result.avgDist
  });
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('TEST SUITE SUMMARY');
console.log('='.repeat(60));
console.log(`\nTests run: ${testSeeds.length}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

console.log('\nResults by seed:');
for (const r of results) {
  const status = r.passed ? 'PASS' : 'FAIL';
  console.log(`  Seed ${r.seed.toString().padStart(9)}: ${status} (min: ${r.minDist.toFixed(2)}, avg: ${r.avgDist.toFixed(2)})`);
}

console.log('\nConfiguration used:');
console.log(`  MIN_DISTANCE: ${CASTLE_PLACEMENT.MIN_DISTANCE}`);
console.log(`  POSITION_RANGE: ${CASTLE_PLACEMENT.POSITION_RANGE}`);
console.log(`  FORCE_MAX_ITERATIONS: ${CASTLE_PLACEMENT.FORCE_MAX_ITERATIONS}`);
console.log(`  LLOYD_ITERATIONS: ${CASTLE_PLACEMENT.LLOYD_ITERATIONS}`);

// Determinism test
console.log('\nDeterminism test (same seed should produce same results):');
const rng1 = new SeededRandom(12345);
const rng2 = new SeededRandom(12345);
const castles1 = generateCastlePlacements(rng1);
const castles2 = generateCastlePlacements(rng2);

let deterministic = true;
for (let i = 0; i < castles1.length; i++) {
  if (castles1[i].x !== castles2[i].x || castles1[i].y !== castles2[i].y) {
    deterministic = false;
    break;
  }
}
console.log(`  Same seed produces identical results: ${deterministic ? 'YES' : 'NO'}`);

console.log('\n' + '='.repeat(60));
const overallPass = failCount === 0 && deterministic;
console.log(`OVERALL RESULT: ${overallPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
console.log('='.repeat(60) + '\n');

process.exit(overallPass ? 0 : 1);
