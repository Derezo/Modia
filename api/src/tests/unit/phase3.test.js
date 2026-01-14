/**
 * Unit test for Phase 3: Internal Node Generation
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  isPointInPolygon,
  poissonDiskSampleInPolygon,
  assignRegionNodeTypes,
  generateRegionNodes,
  generateAllRegionNodes,
  validateRegionNodeGeneration
} from '../../db/worldgen/nodeGeneration.js';
import { generateCastlePlacements } from '../../db/worldgen/castlePlacement.js';
import { createVoronoiRegions } from '../../db/worldgen/voronoiPartitioning.js';
import { REGION_NODE_CONFIG } from '../../db/worldgen/constants.js';
import { SeededRandom, REGIONS } from '../../config/constants.js';

describe('Phase 3: Internal Node Generation', () => {

  describe('isPointInPolygon', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

    test('returns true for point inside polygon', () => {
      assert.strictEqual(isPointInPolygon(5, 5, square), true);
      assert.strictEqual(isPointInPolygon(1, 1, square), true);
      assert.strictEqual(isPointInPolygon(9, 9, square), true);
    });

    test('returns false for point outside polygon', () => {
      assert.strictEqual(isPointInPolygon(-1, 5, square), false);
      assert.strictEqual(isPointInPolygon(11, 5, square), false);
      assert.strictEqual(isPointInPolygon(5, -1, square), false);
      assert.strictEqual(isPointInPolygon(5, 11, square), false);
    });

    test('handles triangle polygon', () => {
      const triangle = [[0, 0], [10, 0], [5, 10], [0, 0]];
      assert.strictEqual(isPointInPolygon(5, 3, triangle), true);
      assert.strictEqual(isPointInPolygon(9, 9, triangle), false);
    });
  });

  describe('poissonDiskSampleInPolygon', () => {
    test('generates samples within polygon bounds', () => {
      const rng = new SeededRandom(12345);
      const square = [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]];
      const startPoint = { x: 10, y: 10 };

      const samples = poissonDiskSampleInPolygon(square, 3.5, rng, 30, startPoint);

      assert(samples.length > 0, 'Should generate at least one sample');
      assert(samples.length <= 50, 'Should not exceed target * 1.5');

      // All samples should be inside polygon
      for (const sample of samples) {
        assert(isPointInPolygon(sample.x, sample.y, square),
          `Sample (${sample.x}, ${sample.y}) should be inside polygon`);
      }
    });

    test('maintains minimum spacing between samples', () => {
      const rng = new SeededRandom(54321);
      const square = [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]];
      const startPoint = { x: 15, y: 15 };
      const minSpacing = 3.5;

      const samples = poissonDiskSampleInPolygon(square, minSpacing, rng, 50, startPoint);

      // Check all pairs for minimum spacing
      for (let i = 0; i < samples.length; i++) {
        for (let j = i + 1; j < samples.length; j++) {
          const dist = Math.hypot(
            samples[i].x - samples[j].x,
            samples[i].y - samples[j].y
          );
          assert(dist >= minSpacing * 0.95, // Allow 5% tolerance for floating point
            `Distance ${dist.toFixed(2)} between samples should be >= ${minSpacing}`);
        }
      }
    });
  });

  describe('assignRegionNodeTypes', () => {
    test('assigns castle to first position at castle location', () => {
      const rng = new SeededRandom(12345);
      const castle = { x: 0, y: 0 };
      const region = REGIONS.HEARTLANDS;
      const positions = [
        { x: 0, y: 0 },     // Castle position
        { x: 5, y: 0 },     // Close node
        { x: 10, y: 10 },   // Mid range
        { x: 20, y: 20 }    // Far node
      ];

      const nodes = assignRegionNodeTypes(positions, castle, region, rng);

      const castleNode = nodes.find(n => Math.abs(n.x) < 0.5 && Math.abs(n.y) < 0.5);
      assert(castleNode, 'Should have a node at castle position');
      assert.strictEqual(castleNode.nodeType, 'castle');
    });

    test('assigns region-appropriate battle terrain', () => {
      const rng = new SeededRandom(12345);
      const castle = { x: 0, y: 0 };
      const region = REGIONS.IRON_DEPTHS; // Dominant: cave
      const positions = [];

      // Generate many positions in Ring 0 (all should be battle nodes)
      for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        positions.push({
          x: Math.cos(angle) * 3,
          y: Math.sin(angle) * 3
        });
      }

      const nodes = assignRegionNodeTypes(positions, castle, region, rng);
      const battleNodes = nodes.filter(n =>
        ['cave', 'mountain', 'forest'].includes(n.nodeType)
      );

      // Most should be cave (dominant terrain)
      const caveNodes = battleNodes.filter(n => n.nodeType === 'cave');
      assert(caveNodes.length >= battleNodes.length * 0.5,
        `Expected majority cave nodes for Iron Depths, got ${caveNodes.length}/${battleNodes.length}`);
    });
  });

  describe('generateRegionNodes', () => {
    test('generates correct number of nodes per region', () => {
      const rng = new SeededRandom(12345);
      const region = REGIONS.HEARTLANDS;
      const polygon = [[-25, -25], [25, -25], [25, 25], [-25, 25], [-25, -25]];
      const castle = { x: 0, y: 0 };

      const nodes = generateRegionNodes(region, polygon, castle, rng);

      assert(nodes.length >= 40, `Expected at least 40 nodes, got ${nodes.length}`);
      assert(nodes.length <= 130, `Expected at most 130 nodes, got ${nodes.length}`);
    });

    test('includes required node types', () => {
      const rng = new SeededRandom(12345);
      const region = REGIONS.SYLVAN_REACHES;
      const polygon = [[-30, -30], [30, -30], [30, 30], [-30, 30], [-30, -30]];
      const castle = { x: 0, y: 0 };

      const nodes = generateRegionNodes(region, polygon, castle, rng);

      const typeCounts = {};
      for (const node of nodes) {
        typeCounts[node.nodeType] = (typeCounts[node.nodeType] || 0) + 1;
      }

      assert.strictEqual(typeCounts.castle, 1, 'Should have exactly 1 castle');
      assert(typeCounts.city >= 2 && typeCounts.city <= 3,
        `Expected 2-3 cities, got ${typeCounts.city}`);
      assert.strictEqual(typeCounts.keep, 1, 'Should have exactly 1 keep');
      assert.strictEqual(typeCounts.guild, 3, 'Should have exactly 3 guilds (1 primary + 2 secondary)');
      assert(typeCounts.village >= 6 && typeCounts.village <= 10,
        `Expected 6-10 villages, got ${typeCounts.village}`);
    });
  });

  describe('generateAllRegionNodes', () => {
    test('generates nodes for all 5 regions', () => {
      const rng = new SeededRandom(12345);
      const castles = generateCastlePlacements(rng);
      const voronoiData = createVoronoiRegions(castles);

      const { allNodes, nodesByRegion } = generateAllRegionNodes(castles, voronoiData, rng);

      assert.strictEqual(nodesByRegion.size, 5, 'Should have 5 regions');
      assert(allNodes.length >= 250, `Expected at least 250 total nodes, got ${allNodes.length}`);
      assert(allNodes.length <= 500, `Expected at most 500 total nodes, got ${allNodes.length}`);
    });

    test('each region has nodes inside its polygon', () => {
      const rng = new SeededRandom(12345);
      const castles = generateCastlePlacements(rng);
      const voronoiData = createVoronoiRegions(castles);

      const { nodesByRegion } = generateAllRegionNodes(castles, voronoiData, rng);

      for (let i = 0; i < castles.length; i++) {
        const regionId = castles[i].region.id;
        const nodes = nodesByRegion.get(regionId);
        const polygon = voronoiData.cells[i].polygon;

        for (const node of nodes) {
          assert(isPointInPolygon(node.x, node.y, polygon),
            `Node at (${node.x}, ${node.y}) should be inside region ${regionId} polygon`);
        }
      }
    });
  });

  describe('validateRegionNodeGeneration', () => {
    test('passes validation with default seed', () => {
      const result = validateRegionNodeGeneration(12345);

      assert.strictEqual(result.passed, true, `Validation should pass. Issues: ${result.issues.join(', ')}`);
      assert(result.allNodes.length >= 250, 'Should have adequate nodes');
      assert.strictEqual(result.nodesByRegion.size, 5, 'Should have 5 regions');
    });

    test('produces consistent results for same seed', () => {
      const result1 = validateRegionNodeGeneration(99999);
      const result2 = validateRegionNodeGeneration(99999);

      assert.strictEqual(result1.allNodes.length, result2.allNodes.length,
        'Same seed should produce same node count');

      // Check first few nodes are identical
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(result1.allNodes[i].x, result2.allNodes[i].x);
        assert.strictEqual(result1.allNodes[i].y, result2.allNodes[i].y);
        assert.strictEqual(result1.allNodes[i].nodeType, result2.allNodes[i].nodeType);
      }
    });

    test('assigns exactly 12 zodiac shrines globally', () => {
      const result = validateRegionNodeGeneration(12345);

      const zodiacShrines = result.allNodes.filter(node =>
        node.nodeType === 'shrine' && node.shrineBuffType && node.shrineBuffType.startsWith('zodiac_')
      );

      assert.strictEqual(zodiacShrines.length, 12, `Expected 12 zodiac shrines, got ${zodiacShrines.length}`);

      // Verify all 12 zodiac types are present
      const zodiacTypes = new Set(zodiacShrines.map(s => s.shrineBuffType));
      assert.strictEqual(zodiacTypes.size, 12, 'Should have all 12 unique zodiac types');
    });

    test('assigns 3 guilds per region with different types', () => {
      const result = validateRegionNodeGeneration(12345);

      // Check each region has exactly 3 guilds of different types
      for (const [regionId, regionNodes] of result.nodesByRegion) {
        const guilds = regionNodes.filter(n => n.nodeType === 'guild');
        assert.strictEqual(guilds.length, 3, `Region ${regionId} should have exactly 3 guilds`);

        // Verify all 3 guild types are different
        const guildTypes = new Set(guilds.map(g => g.guildType));
        assert.strictEqual(guildTypes.size, 3, `Region ${regionId} should have 3 different guild types`);
      }
    });

    test('includes activity node types', () => {
      const result = validateRegionNodeGeneration(12345);

      const activityTypes = ['fishing_spot', 'merchant_caravan', 'ruins'];
      const activityNodes = result.allNodes.filter(n => activityTypes.includes(n.nodeType));

      // Should have some activity nodes (at least 10% of non-settlement nodes)
      assert(activityNodes.length >= 20, `Expected at least 20 activity nodes, got ${activityNodes.length}`);
    });
  });

});
