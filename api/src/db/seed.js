/**
 * Database Seeder
 *
 * Main entry point for seeding the Modia database.
 * Orchestrates world generation (6 phases) and template seeding.
 *
 * World Generation Phases:
 * 1. Castle Placement - Force-directed + Lloyd's relaxation for 5 castle positions
 * 2. Voronoi Partitioning - Region boundaries from castle positions
 * 3. Internal Node Generation - Poisson disk sampling within each region
 * 4. Internal Connections - MST + extra connections per region
 * 5. Inter-Region Connections - Bridges, wilderness zones, trade routes, palace
 * 6. Validation & Cleanup - Terminators, difficulty tiers, connectivity check
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pg from 'pg';

// World generation modules
import { SeededRandom, CITY_OPTIONS, CASTLE_FEATURES, REGIONS, TERRAIN_DISTRIBUTION } from '../config/constants.js';
import {
  NODE_NAME_PREFIXES,
  NODE_NAME_SUFFIXES,
  PALACE_FEATURES,
  OBSTACLE_TYPES
} from './worldgen/constants.js';
import { generateCastlePlacements } from './worldgen/castlePlacement.js';
import { createVoronoiRegions, getRegionBorders, findGrandPalacePosition } from './worldgen/voronoiPartitioning.js';
import { generateAllRegionNodes } from './worldgen/nodeGeneration.js';
import { generateAllRegionConnections } from './worldgen/internalConnections.js';
import { generateInterRegionConnections } from './worldgen/interRegionConnections.js';
import { validateAndCleanup, calculateDifficultyTier } from './worldgen/validation.js';
import { generateObstacles, generateNodeFeatures } from './worldgen/terrain.js';

// Template data
import { ITEM_TEMPLATES, SHOP_STOCK } from './templates/items.js';
import { ENEMY_TEMPLATES } from './templates/enemies.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const { Pool } = pg;

// Increment this version when seed data changes significantly
// This allows dev-setup.sh to detect when re-seeding might be needed
const SEED_VERSION = 2;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'modia',
  user: process.env.DB_USER || 'modia',
  password: process.env.DB_PASSWORD || '',
});

// ============================================================================
// WORLD GENERATION ORCHESTRATION
// ============================================================================

/**
 * Get the guild class associated with a race's region
 * Each race has an affinity for a particular class
 *
 * @param {string} race - Race identifier
 * @returns {string} Guild class
 */
function getGuildClassForRace(race) {
  const raceToGuild = {
    human: 'warrior',
    elf: 'wizard',
    dwarf: 'monk',       // Dwarves are disciplined (monk fits)
    vampire: 'chemist',  // Alchemical nature
    orc: 'warrior'       // Combat focused
  };
  return raceToGuild[race] || 'warrior';
}

/**
 * Get the race for a region ID by looking up castle data
 *
 * @param {number} regionId - Region ID
 * @param {Array} castles - Castle data from Phase 1
 * @returns {string|null} Race identifier or null
 */
function getRegionRace(regionId, castles) {
  if (!regionId) return null;
  const castle = castles.find(c => c.region.id === regionId);
  return castle ? castle.region.race : null;
}

/**
 * NEW Regional World Generation Function
 *
 * Orchestrates all 6 phases of the 5-region world generation system.
 *
 * @param {number} seed - World seed for deterministic generation
 * @returns {Object} Database-ready world data { nodes, connections, obstacles, regions }
 */
async function generateWorld(seed) {
  const rng = new SeededRandom(seed);

  console.log('\n========================================');
  console.log('5-REGION WORLD GENERATION');
  console.log(`World Seed: ${seed}`);
  console.log('========================================\n');

  // Node name generation helper
  function generateNodeName(type) {
    const prefixes = NODE_NAME_PREFIXES[type] || NODE_NAME_PREFIXES.city;
    const suffixes = NODE_NAME_SUFFIXES[type] || NODE_NAME_SUFFIXES.city;
    const baseName = `${rng.pick(prefixes)} ${rng.pick(suffixes)}`;
    return baseName;
  }

  // Step 0: Generate terrain obstacles first (shared across regions)
  console.log('Generating terrain obstacles...');
  const obstacles = generateObstacles(rng);

  // ========================================
  // PHASE 1: Castle Placement
  // ========================================
  const castles = generateCastlePlacements(rng);

  // ========================================
  // PHASE 2: Voronoi Partitioning
  // ========================================
  const voronoiData = createVoronoiRegions(castles);

  // ========================================
  // PHASE 3: Internal Node Generation
  // ========================================
  const nodeData = generateAllRegionNodes(castles, voronoiData, rng);

  // ========================================
  // PHASE 4: Internal Connections
  // ========================================
  const connectionData = generateAllRegionConnections(nodeData, rng);

  // ========================================
  // PHASE 5: Inter-Region Connections
  // ========================================
  const interRegionData = generateInterRegionConnections(
    voronoiData,
    nodeData.nodesByRegion,
    nodeData.allNodes,
    castles,
    rng
  );

  // Merge all nodes (internal + inter-region)
  const mergedNodes = [...nodeData.allNodes, ...interRegionData.interRegionNodes];

  // Build region offset map for local->global index conversion
  const regionOffsetsForPhase6 = new Map();
  let phase6Offset = 0;
  for (const [regionId, regionNodes] of nodeData.nodesByRegion) {
    regionOffsetsForPhase6.set(regionId, phase6Offset);
    phase6Offset += regionNodes.length;
  }

  // Convert Phase 4 connections from local to global indices for Phase 6
  const globalRegionConnections = connectionData.allConnections.map(conn => {
    const offset = regionOffsetsForPhase6.get(conn.regionId) || 0;
    return {
      from: offset + conn.from,
      to: offset + conn.to,
      regionId: conn.regionId
    };
  });

  // ========================================
  // PHASE 6: Validation & Cleanup
  // ========================================
  const phase6Result = validateAndCleanup(
    mergedNodes,
    globalRegionConnections,
    interRegionData.interRegionConnections,
    castles,
    rng
  );

  // ========================================
  // Build Database-Ready Output
  // ========================================
  console.log('\n========================================');
  console.log('Building Database-Ready Output');
  console.log('========================================');

  // Track guild index for staggered refresh hours
  let guildIndex = 0;
  const GUILD_REFRESH_HOURS = [0, 6, 12, 18];

  // Build node map for inter-region connection resolution
  const nodeMap = new Map();
  phase6Result.allNodes.forEach((node, idx) => {
    nodeMap.set(node, idx);
  });

  // Track used coordinates to handle duplicates
  const usedCoords = new Set();

  // Convert nodes to database format
  const nodes = phase6Result.allNodes.map((node, idx) => {
    // Generate appropriate name
    let name;
    if (node.nodeType === 'castle') {
      const regionInfo = castles.find(c => c.region.id === node.regionId);
      name = regionInfo ? regionInfo.region.castleName : 'Castle';
    } else if (node.nodeType === 'palace') {
      name = 'Grand Palace';
    } else if (node.nodeType === 'guild') {
      const regionInfo = castles.find(c => c.region.id === node.regionId);
      const guildClass = regionInfo ? getGuildClassForRace(regionInfo.region.race) : 'warrior';
      node.guildClass = guildClass;
      name = `${guildClass.charAt(0).toUpperCase() + guildClass.slice(1)}s' Guild`;
    } else if (node.nodeType === 'keep') {
      const regionInfo = castles.find(c => c.region.id === node.regionId);
      name = regionInfo ? `${regionInfo.region.name} Keep` : 'Keep';
    } else if (node.name) {
      name = node.name;
    } else {
      name = generateNodeName(node.nodeType);
    }

    // Calculate distance from center (0,0)
    const distFromCenter = Math.round(Math.hypot(node.x, node.y));

    // Handle coordinate collisions by offsetting duplicates
    let x_coord = Math.round(node.x);
    let y_coord = Math.round(node.y);
    let coordKey = `${x_coord},${y_coord}`;

    // If coordinate already used, find a nearby available spot
    let offset = 1;
    while (usedCoords.has(coordKey)) {
      const offsets = [
        [offset, 0], [-offset, 0], [0, offset], [0, -offset],
        [offset, offset], [-offset, -offset], [offset, -offset], [-offset, offset]
      ];
      let found = false;
      for (const [dx, dy] of offsets) {
        const newX = Math.round(node.x) + dx;
        const newY = Math.round(node.y) + dy;
        const newKey = `${newX},${newY}`;
        if (!usedCoords.has(newKey)) {
          x_coord = newX;
          y_coord = newY;
          coordKey = newKey;
          found = true;
          break;
        }
      }
      if (!found) offset++;
      if (offset > 10) break; // Safety limit
    }
    usedCoords.add(coordKey);

    const nodeObj = {
      node_type: node.nodeType,
      name: name,
      x_coord: x_coord,
      y_coord: y_coord,
      distance_from_center: distFromCenter,
      features: JSON.stringify(generateNodeFeatures(rng, node.nodeType)),
      guild_class: node.guildClass || null,
      local_seed: rng.nextInt(1, 1000000),
      difficulty_tier: node.difficultyTier || calculateDifficultyTier(node),
      recruit_refresh_hour: null,
      is_terminator: node.isTerminator || false,
      shrine_buff_type: node.shrineBuffType || null,
      lore_key: node.loreKey || null,
      // NEW regional columns
      region_id: node.regionId || null,
      region_race: getRegionRace(node.regionId, castles),
      ring_distance: node.ringDistance || null
    };

    // Assign staggered refresh hours to guild nodes
    if (node.nodeType === 'guild') {
      nodeObj.recruit_refresh_hour = GUILD_REFRESH_HOURS[guildIndex % GUILD_REFRESH_HOURS.length];
      guildIndex++;
    }

    return nodeObj;
  });

  // Convert connections to index-based format for database insertion
  const connections = [];
  const connectionSet = new Set(); // Prevent duplicates

  // Add region internal connections
  for (const conn of globalRegionConnections) {
    const fromIdx = conn.from;
    const toIdx = conn.to;

    if (fromIdx >= 0 && fromIdx < phase6Result.allNodes.length &&
        toIdx >= 0 && toIdx < phase6Result.allNodes.length) {
      const key = `${Math.min(fromIdx, toIdx)},${Math.max(fromIdx, toIdx)}`;
      if (!connectionSet.has(key)) {
        connections.push({ from: fromIdx, to: toIdx });
        connectionSet.add(key);
      }
    }
  }

  console.log(`  Region internal connections: ${connections.length}`);

  // Add inter-region connections
  for (const conn of interRegionData.interRegionConnections) {
    let fromIdx, toIdx;

    if (typeof conn.from === 'number') {
      fromIdx = conn.from;
    } else {
      fromIdx = nodeMap.get(conn.from);
    }

    if (typeof conn.to === 'number') {
      toIdx = conn.to;
    } else if (conn.to && conn.to.node) {
      toIdx = nodeMap.get(conn.to.node);
    } else {
      toIdx = nodeMap.get(conn.to);
    }

    if (fromIdx !== undefined && toIdx !== undefined &&
        fromIdx >= 0 && fromIdx < phase6Result.allNodes.length &&
        toIdx >= 0 && toIdx < phase6Result.allNodes.length) {
      const key = `${Math.min(fromIdx, toIdx)},${Math.max(fromIdx, toIdx)}`;
      if (!connectionSet.has(key)) {
        connections.push({ from: fromIdx, to: toIdx });
        connectionSet.add(key);
      }
    }
  }

  console.log(`  Total connections after inter-region: ${connections.length}`);

  // Build regions data for world_regions table
  const regions = castles.map((castle, idx) => {
    const castleNode = nodes.find(n =>
      n.node_type === 'castle' && n.region_id === castle.region.id
    );
    const castleNodeIdx = castleNode ? nodes.indexOf(castleNode) : null;

    const keepNode = nodes.find(n =>
      n.node_type === 'keep' && n.region_id === castle.region.id
    );
    const keepNodeIdx = keepNode ? nodes.indexOf(keepNode) : null;

    const guildNode = nodes.find(n =>
      n.node_type === 'guild' && n.region_id === castle.region.id
    );
    const guildNodeIdx = guildNode ? nodes.indexOf(guildNode) : null;

    const cell = voronoiData.cells[idx];
    const boundaryPolygon = cell ? cell.polygon : null;

    return {
      id: castle.region.id,
      race: castle.region.race,
      castle_node_idx: castleNodeIdx,
      keep_node_idx: keepNodeIdx,
      guild_node_idx: guildNodeIdx,
      dominant_terrain: castle.region.dominantTerrain,
      secondary_terrains: castle.region.secondaryTerrains,
      boundary_polygon: boundaryPolygon
    };
  });

  // Summary
  console.log('\nWorld Generation Complete:');
  console.log(`  Total nodes: ${nodes.length}`);
  console.log(`  Total connections: ${connections.length}`);
  console.log(`  Regions: ${regions.length}`);
  console.log(`  Obstacles: ${obstacles.length}`);

  const nodeCounts = {};
  for (const node of nodes) {
    const regionId = node.region_id || 'inter-region';
    nodeCounts[regionId] = (nodeCounts[regionId] || 0) + 1;
  }
  console.log(`  Nodes by region: ${JSON.stringify(nodeCounts)}`);

  return { nodes, connections, obstacles, regions };
}

// ============================================================================
// DATABASE SEEDING FUNCTIONS
// ============================================================================

async function seedItems() {
  for (const item of ITEM_TEMPLATES) {
    await pool.query(
      `INSERT INTO item_templates (name, description, item_type, equipment_slot, stat_bonuses, level_requirement, effect_type, effect_value, base_price, rarity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [
        item.name,
        item.description || null,
        item.item_type,
        item.equipment_slot || null,
        JSON.stringify(item.stat_bonuses || {}),
        item.level_requirement || 1,
        item.effect_type || null,
        item.effect_value || null,
        item.base_price || 0,
        item.rarity || 1
      ]
    );
  }

  console.log(`Seeded ${ITEM_TEMPLATES.length} item templates`);
}

async function seedEnemies() {
  for (const enemy of ENEMY_TEMPLATES) {
    await pool.query(
      `INSERT INTO enemy_templates (name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility, base_vitality, base_luck, spawn_node_types, ai_type, abilities, drop_table, experience_reward, gold_reward_min, gold_reward_max, min_difficulty_tier, archetype, elemental_resistances)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT DO NOTHING`,
      [
        enemy.name,
        enemy.sprite_id,
        enemy.base_hp,
        enemy.base_mp,
        enemy.base_strength,
        enemy.base_intelligence,
        enemy.base_agility,
        enemy.base_vitality || 5,
        enemy.base_luck || 5,
        enemy.spawn_node_types,
        enemy.ai_type || 'aggressive',
        JSON.stringify(enemy.abilities || []),
        JSON.stringify(enemy.drop_table || {}),
        enemy.experience_reward,
        enemy.gold_reward_min || 1,
        enemy.gold_reward_max,
        enemy.min_difficulty_tier || 1,
        enemy.archetype || 'humanoid',
        JSON.stringify(enemy.elemental_resistances || {})
      ]
    );
  }

  console.log(`Seeded ${ENEMY_TEMPLATES.length} enemy templates`);
}

/**
 * Seed shop inventory for all nodes with shops
 * @param {Array} nodeIds - Array of node IDs (index matches nodes array)
 * @param {Array} nodes - Array of node objects with features
 */
async function seedShopInventory(nodeIds, nodes) {
  // Map features to shop types
  const featureToShop = {
    blacksmith: 'blacksmith',
    apothecary: 'apothecary',
    farm: 'farm'
  };

  let insertCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodeId = nodeIds[i];
    const features = JSON.parse(node.features || '[]');

    for (const feature of features) {
      const shopType = featureToShop[feature];
      if (!shopType || !SHOP_STOCK[shopType]) continue;

      const stock = SHOP_STOCK[shopType];
      for (const item of stock.items) {
        await pool.query(
          `INSERT INTO npc_shop_inventory (node_id, shop_type, item_template_id, quantity, restock_quantity)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (node_id, shop_type, item_template_id) DO NOTHING`,
          [nodeId, shopType, item.templateId, item.qty]
        );
        insertCount++;
      }
    }
  }

  console.log(`Seeded ${insertCount} shop inventory entries`);
}

/**
 * Seed developer test data with derezo user and generated equipment
 * Only runs in development environment
 */
async function seedDeveloperTestData(castleId) {
  // Skip in production
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping dev seed data in production');
    return;
  }

  console.log('\nSeeding developer test data...');

  // Import bcrypt for password hashing
  const bcrypt = await import('bcrypt');
  // nosec: Test password for development seed data only
  const hashedPassword = await bcrypt.default.hash('password', 10);

  // Create or update derezo user with 30,000 gold
  const userResult = await pool.query(
    `INSERT INTO users (username, email, password_hash, gold)
     VALUES ('derezo', 'derezo@test.local', $1, 30000)
     ON CONFLICT (username) DO UPDATE SET gold = 30000
     RETURNING id`,
    [hashedPassword]
  );
  const userId = userResult.rows[0].id;

  // Check if character already exists
  const existingChar = await pool.query(
    'SELECT id FROM characters WHERE user_id = $1 AND name = \'Derezo\'',
    [userId]
  );

  let characterId;
  if (existingChar.rows.length > 0) {
    characterId = existingChar.rows[0].id;
    console.log('  Developer character already exists, updating items...');

    // Ensure party_slot is set (may be missing from older seeds)
    await pool.query(
      'UPDATE characters SET party_slot = 1 WHERE id = $1 AND party_slot IS NULL',
      [characterId]
    );

    // Clear existing items for fresh test data
    await pool.query('DELETE FROM character_items WHERE character_id = $1', [characterId]);
  } else {
    // Create male elf wizard character at level 25
    const charResult = await pool.query(
      `INSERT INTO characters (user_id, name, race, class, gender, level, experience,
       current_node_id, hp_current, hp_max, mp_current, mp_max,
       strength, intelligence, agility, vitality, luck, party_slot)
       VALUES ($1, 'Derezo', 'elf', 'wizard', 'male', 25, 50000,
       $2, 200, 200, 300, 300, 12, 35, 18, 14, 15, 1)
       RETURNING id`,
      [userId, castleId]
    );
    characterId = charResult.rows[0].id;
    console.log('  Created developer character: Derezo (level 25 elf wizard)');
  }

  // Import item generation functions
  const { generateItem, storeDroppedItem } = await import('../services/itemDropService.js');

  // Test items covering various rarities and types
  const testItems = [
    // Legendary wizard staff (high level)
    { templateId: 5, seed: 999001, level: 90, rarity: 'legendary' },
    // Epic wizard robe
    { templateId: 9, seed: 999002, level: 80, rarity: 'epic' },
    // Rare wizard hat
    { templateId: 25, seed: 999003, level: 60, rarity: 'rare' },
    // Legendary accessory
    { templateId: 11, seed: 999004, level: 85, rarity: 'legendary' },
    // Epic boots
    { templateId: 24, seed: 999005, level: 70, rarity: 'epic' },
    // Rare accessory
    { templateId: 10, seed: 999006, level: 50, rarity: 'rare' },
    // Rare weapon for testing
    { templateId: 1, seed: 999007, level: 30, rarity: 'rare' },
    // Epic weapon
    { templateId: 2, seed: 999008, level: 40, rarity: 'epic' },
    // Legendary weapon
    { templateId: 3, seed: 999009, level: 50, rarity: 'legendary' },
    // Armor variations
    { templateId: 7, seed: 999010, level: 35, rarity: 'rare' },
    { templateId: 8, seed: 999011, level: 45, rarity: 'epic' },
    // Consumables (should NOT have equipment augments)
    { templateId: 12, seed: 999012, level: 1, rarity: 'common' },
    { templateId: 29, seed: 999013, level: 1, rarity: 'uncommon' },
    { templateId: 15, seed: 999014, level: 1, rarity: 'epic' },
    // Uncommon items for comparison
    { templateId: 1, seed: 999015, level: 10, rarity: 'uncommon' },
    { templateId: 7, seed: 999016, level: 15, rarity: 'uncommon' },
  ];

  let createdCount = 0;
  for (const itemDef of testItems) {
    try {
      const item = await generateItem(
        itemDef.templateId,
        itemDef.seed,
        itemDef.level,
        itemDef.rarity
      );
      if (item) {
        await storeDroppedItem(userId, item);
        console.log(`  Created: ${item.generatedName} (${item.rarity})`);
        createdCount++;
      }
    } catch (err) {
      console.error(`  Failed to create item ${itemDef.templateId}:`, err.message);
    }
  }

  // Initialize fog of war discovery for the user
  await pool.query('SELECT discover_node_and_adjacent($1, $2)', [userId, castleId]);

  console.log(`Developer seed data created: user 'derezo' with ${createdCount} items`);
  console.log('  Login: derezo / password');
  console.log('  Gold: 30,000');

  // Seed marketplace data for chart testing
  await seedMarketplaceData(userId, characterId);
}

/**
 * Seed marketplace trade history for chart data
 * Creates realistic price fluctuations over the past 14 days for common items
 */
async function seedMarketplaceData(userId, characterId) {
  // Skip in production
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping marketplace seed data in production');
    return;
  }

  console.log('\nSeeding marketplace trade history...');

  const rng = new SeededRandom(54321);

  // Items to seed trade history for (templateId: basePrice)
  const tradedItems = [
    { templateId: 1, basePrice: 50 },   // Rusty Sword
    { templateId: 2, basePrice: 150 },  // Iron Sword
    { templateId: 7, basePrice: 80 },   // Leather Armor
    { templateId: 8, basePrice: 250 },  // Chain Mail
    { templateId: 12, basePrice: 25 },  // Health Potion (high volume)
    { templateId: 13, basePrice: 30 },  // Mana Potion (high volume)
    { templateId: 21, basePrice: 40 },  // Leather Helm
    { templateId: 29, basePrice: 100 }, // Hi-Potion
    { templateId: 10, basePrice: 100 }, // Lucky Charm
    { templateId: 6, basePrice: 45 },   // Combat Gloves
  ];

  const now = new Date();
  let totalTrades = 0;

  for (const item of tradedItems) {
    // Determine trade volume based on item type
    const isConsumable = item.templateId >= 12 && item.templateId <= 15 || item.templateId >= 29;
    const tradesPerDay = isConsumable ? rng.nextInt(8, 15) : rng.nextInt(2, 6);

    // Generate trades for the past 14 days
    for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
      const dayTrades = rng.nextInt(Math.floor(tradesPerDay * 0.5), Math.ceil(tradesPerDay * 1.5));

      // Create a price trend (random walk with mean reversion)
      let priceMultiplier = 1 + (rng.next() - 0.5) * 0.2; // ±10% base variation

      // Add some market events (occasional spikes/dips)
      if (rng.next() < 0.1) {
        priceMultiplier *= (0.8 + rng.next() * 0.4); // ±20% event
      }

      for (let t = 0; t < dayTrades; t++) {
        // Individual trade price variation
        const tradeVariation = 1 + (rng.next() - 0.5) * 0.1; // ±5% per trade
        const price = Math.round(item.basePrice * priceMultiplier * tradeVariation);
        const quantity = isConsumable ? rng.nextInt(1, 10) : rng.nextInt(1, 3);

        // Calculate trade timestamp within the day
        const tradeDate = new Date(now);
        tradeDate.setDate(tradeDate.getDate() - daysAgo);
        tradeDate.setHours(rng.nextInt(6, 22), rng.nextInt(0, 59), rng.nextInt(0, 59));

        // Insert trade record (null order IDs for seeded data)
        await pool.query(
          `INSERT INTO market_trades
           (buy_order_id, sell_order_id, item_template_id, buyer_id, seller_id, price, quantity, total_gold, executed_at)
           VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7)`,
          [
            item.templateId,
            userId,        // buyer
            userId,        // seller (self-trades for seed data)
            price,
            quantity,
            price * quantity,
            tradeDate
          ]
        );
        totalTrades++;
      }

      // Evolve price for next day (mean reversion)
      priceMultiplier = priceMultiplier * 0.9 + 1.0 * 0.1 + (rng.next() - 0.5) * 0.1;
    }
  }

  // Also seed some active orders for order book depth
  console.log('Seeding active market orders...');
  let orderCount = 0;

  for (const item of tradedItems.slice(0, 5)) { // Top 5 items
    // Create some buy orders (bids)
    for (let i = 0; i < rng.nextInt(3, 6); i++) {
      const bidPrice = Math.round(item.basePrice * (0.85 + rng.next() * 0.1)); // 85-95% of base
      const quantity = rng.nextInt(1, 5);

      await pool.query(
        `INSERT INTO market_orders
         (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
         VALUES ($1, $2, $3, 'buy', $4, $5, 'open', NOW() - INTERVAL '${rng.nextInt(1, 72)} hours')`,
        [userId, characterId, item.templateId, bidPrice, quantity]
      );
      orderCount++;
    }

    // Create some sell orders (asks)
    for (let i = 0; i < rng.nextInt(3, 6); i++) {
      const askPrice = Math.round(item.basePrice * (1.05 + rng.next() * 0.15)); // 105-120% of base
      const quantity = rng.nextInt(1, 5);

      await pool.query(
        `INSERT INTO market_orders
         (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
         VALUES ($1, $2, $3, 'sell', $4, $5, 'open', NOW() - INTERVAL '${rng.nextInt(1, 72)} hours')`,
        [userId, characterId, item.templateId, askPrice, quantity]
      );
      orderCount++;
    }
  }

  console.log(`Seeded ${totalTrades} market trades and ${orderCount} active orders`);
}

/**
 * Save seed metadata for smart seeding detection in dev-setup.sh
 */
async function saveSeedMetadata(client, worldSeed, nodeCount) {
  const itemCount = await client.query('SELECT COUNT(*) FROM item_templates');
  const enemyCount = await client.query('SELECT COUNT(*) FROM enemy_templates');

  await client.query(`
    INSERT INTO seed_metadata (id, seed_version, world_seed, item_template_count, enemy_template_count, world_node_count, seeded_at)
    VALUES (1, $1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      seed_version = EXCLUDED.seed_version,
      world_seed = EXCLUDED.world_seed,
      item_template_count = EXCLUDED.item_template_count,
      enemy_template_count = EXCLUDED.enemy_template_count,
      world_node_count = EXCLUDED.world_node_count,
      seeded_at = NOW()
  `, [SEED_VERSION, worldSeed, itemCount.rows[0].count, enemyCount.rows[0].count, nodeCount]);

  console.log(`\nSeed metadata saved: version=${SEED_VERSION}, world_seed=${worldSeed}`);
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  const client = await pool.connect();

  try {
    console.log('Starting database seed...\n');

    // Clear existing data (in reverse dependency order)
    console.log('Clearing existing data...');
    await client.query('TRUNCATE world_regions RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE world_obstacles, world_node_connections, world_nodes RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE item_templates RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE enemy_templates RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE npc_shop_inventory RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE shop_transactions RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE market_trades RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE market_orders RESTART IDENTITY CASCADE');

    // Generate world using 5-region system
    const worldSeed = parseInt(process.env.WORLD_SEED || '12345', 10);
    console.log(`\nGenerating world with seed: ${worldSeed}`);
    const { nodes, connections, obstacles, regions } = await generateWorld(worldSeed);

    // Insert world_regions FIRST (without node references)
    console.log(`\nInserting ${regions.length} world regions (phase 1 - without node refs)...`);
    for (const region of regions) {
      await client.query(
        `INSERT INTO world_regions (id, race, dominant_terrain, secondary_terrains, boundary_polygon)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           race = EXCLUDED.race,
           dominant_terrain = EXCLUDED.dominant_terrain,
           secondary_terrains = EXCLUDED.secondary_terrains,
           boundary_polygon = EXCLUDED.boundary_polygon`,
        [
          region.id,
          region.race,
          region.dominant_terrain,
          JSON.stringify(region.secondary_terrains),
          region.boundary_polygon ? JSON.stringify(region.boundary_polygon) : null
        ]
      );
    }

    // Insert nodes with regional columns
    console.log(`\nInserting ${nodes.length} world nodes...`);
    const nodeIds = [];
    for (const node of nodes) {
      const result = await client.query(
        `INSERT INTO world_nodes (node_type, name, x_coord, y_coord, distance_from_center, features, guild_class, local_seed, difficulty_tier, recruit_refresh_hour, is_terminator, shrine_buff_type, lore_key, region_id, region_race, ring_distance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          node.node_type,
          node.name,
          node.x_coord,
          node.y_coord,
          node.distance_from_center,
          node.features,
          node.guild_class,
          node.local_seed,
          node.difficulty_tier,
          node.recruit_refresh_hour,
          node.is_terminator,
          node.shrine_buff_type,
          node.lore_key,
          node.region_id,
          node.region_race,
          node.ring_distance
        ]
      );
      nodeIds.push(result.rows[0].id);
    }

    // Insert connections
    console.log(`Inserting ${connections.length} node connections...`);
    for (const conn of connections) {
      const fromId = Math.min(nodeIds[conn.from], nodeIds[conn.to]);
      const toId = Math.max(nodeIds[conn.from], nodeIds[conn.to]);
      await client.query(
        `INSERT INTO world_node_connections (from_node_id, to_node_id, path_type)
         VALUES ($1, $2, 'road')
         ON CONFLICT DO NOTHING`,
        [fromId, toId]
      );
    }

    // Insert terrain obstacles
    console.log(`\nInserting ${obstacles.length} terrain obstacles...`);
    for (const obs of obstacles) {
      await client.query(
        `INSERT INTO world_obstacles (obstacle_type, x, y, radius, length, angle)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [obs.obstacle_type, obs.x, obs.y, obs.radius, obs.length, obs.angle]
      );
    }

    // Update world_regions with node ID references (phase 2)
    console.log(`\nUpdating ${regions.length} world regions with node references...`);
    for (const region of regions) {
      const castleNodeId = region.castle_node_idx !== null ? nodeIds[region.castle_node_idx] : null;
      const keepNodeId = region.keep_node_idx !== null ? nodeIds[region.keep_node_idx] : null;
      const guildNodeId = region.guild_node_idx !== null ? nodeIds[region.guild_node_idx] : null;

      await client.query(
        `UPDATE world_regions SET
           castle_node_id = $2,
           keep_node_id = $3,
           guild_node_id = $4
         WHERE id = $1`,
        [region.id, castleNodeId, keepNodeId, guildNodeId]
      );
    }
    console.log(`Updated ${regions.length} regions with node references`);

    // Seed items
    console.log('\nSeeding items...');
    await seedItems();

    // Seed enemies
    console.log('\nSeeding enemies...');
    await seedEnemies();

    // Seed shop inventory
    console.log('\nSeeding shop inventory...');
    await seedShopInventory(nodeIds, nodes);

    // Re-initialize user discovery for all existing users
    console.log('\nRe-initializing user discovery...');
    const castleIdx = nodes.findIndex(n => n.node_type === 'castle');
    const castleId = castleIdx >= 0 ? nodeIds[castleIdx] : nodeIds[0];
    console.log(`  Using castle node ID ${castleId} (index ${castleIdx}) as starting point`);

    const usersResult = await client.query('SELECT id FROM users');
    for (const user of usersResult.rows) {
      await client.query('SELECT discover_node_and_adjacent($1, $2)', [user.id, castleId]);
    }
    console.log(`Initialized discovery for ${usersResult.rows.length} users`);

    // Seed developer test data
    await seedDeveloperTestData(castleId);

    // Save seed metadata
    await saveSeedMetadata(client, worldSeed, nodes.length);

    console.log('\nSeed completed successfully!');
    console.log(`Total nodes: ${nodes.length}`);
    console.log(`Total connections: ${connections.length} (single-row, bidirectional travel)`);

  } catch (err) {
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
