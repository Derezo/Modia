require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'modia',
  user: process.env.DB_USER || 'modia',
  password: process.env.DB_PASSWORD || '',
});

// Seeded random number generator (Mulberry32)
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

const NODE_NAME_PREFIXES = {
  city: ['New', 'Old', 'Port', 'Fort', 'North', 'South', 'East', 'West'],
  village: ['Little', 'Green', 'Quiet', 'Sunny', 'Misty', 'Hidden'],
  forest: ['Dark', 'Ancient', 'Whispering', 'Emerald', 'Twisted', 'Silent'],
  cave: ['Crystal', 'Shadow', 'Echo', 'Deep', 'Forgotten', 'Frost'],
  mountain: ['Storm', 'Iron', 'Snow', 'Thunder', 'Sky', 'Fire'],
  bridge: ['Stone', 'Hanging', 'Old', 'Broken', 'King\'s', 'Troll'],
  guild: ['Warriors\'', 'Wizards\'', 'Monks\'', 'Chemists\'']
};

const NODE_NAME_SUFFIXES = {
  city: ['Haven', 'Gate', 'Hold', 'Watch', 'Keep', 'Port'],
  village: ['Hollow', 'Dell', 'Crossing', 'Rest', 'Vale', 'Hamlet'],
  forest: ['Woods', 'Grove', 'Thicket', 'Wilds', 'Depths', 'Glade'],
  cave: ['Caverns', 'Grotto', 'Depths', 'Tunnels', 'Lair', 'Mine'],
  mountain: ['Peak', 'Summit', 'Crag', 'Ridge', 'Heights', 'Pass'],
  bridge: ['Crossing', 'Pass', 'Span', 'Way', 'Arch', 'Ford'],
  guild: ['Hall', 'Sanctum', 'Lodge', 'Academy', 'Tower', 'Keep']
};

const CITY_OPTIONS = ['blacksmith', 'apothecary', 'temple', 'stables'];
const CASTLE_FEATURES = ['coliseum', 'tavern', 'courtyard', 'throne', 'blacksmith', 'apothecary', 'temple', 'stables', 'marketplace'];

async function generateWorld(seed) {
  const rng = new SeededRandom(seed);
  const nodes = [];
  const connections = [];
  const nodeMap = new Map();

  function generateNodeName(type) {
    const prefixes = NODE_NAME_PREFIXES[type] || NODE_NAME_PREFIXES.city;
    const suffixes = NODE_NAME_SUFFIXES[type] || NODE_NAME_SUFFIXES.city;
    return `${rng.pick(prefixes)} ${rng.pick(suffixes)}`;
  }

  function addNode(x, y, type, name, features = [], guildClass = null, difficulty = 1) {
    const key = `${x},${y}`;
    if (nodeMap.has(key)) return null;

    const node = {
      node_type: type,
      name,
      x_coord: x,
      y_coord: y,
      distance_from_center: Math.round(Math.sqrt(x * x + y * y)),
      features: JSON.stringify(features),
      guild_class: guildClass,
      local_seed: rng.nextInt(1, 1000000),
      difficulty_tier: difficulty
    };
    nodes.push(node);
    nodeMap.set(key, nodes.length - 1);
    return nodes.length - 1;
  }

  function addConnection(idx1, idx2) {
    if (idx1 === null || idx2 === null) return;
    connections.push({ from: idx1, to: idx2 });
  }

  function findNearestNode(x, y, excludeIndex = -1) {
    let nearest = -1;
    let nearestDist = Infinity;

    for (let i = 0; i < nodes.length; i++) {
      if (i === excludeIndex) continue;
      const dx = nodes[i].x_coord - x;
      const dy = nodes[i].y_coord - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    return nearest;
  }

  // 1. Create central Castle
  const castleIdx = addNode(0, 0, 'castle', 'Royal Castle', CASTLE_FEATURES);
  console.log('Created central Castle');

  // 2. Create ring 1 - close nodes (3-4 distance)
  const ring1Types = ['city', 'village', 'forest'];
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI * 2 * i / 4) + rng.next() * 0.3;
    const dist = 3 + rng.nextInt(0, 1);
    const x = Math.round(Math.cos(angle) * dist);
    const y = Math.round(Math.sin(angle) * dist);
    const type = rng.pick(ring1Types);
    let features = [];

    if (type === 'city') {
      const shuffled = rng.shuffle(CITY_OPTIONS);
      features = ['tavern', shuffled[0], shuffled[1]];
    } else if (type === 'village') {
      features = ['farm'];
      if (rng.next() > 0.5) features.push('apothecary');
    }

    const idx = addNode(x, y, type, generateNodeName(type), features, null, 1);
    if (idx !== null) addConnection(castleIdx, idx);
  }
  console.log('Created ring 1');

  // 3. Create ring 2 (5-7 distance)
  const ring2Types = ['city', 'village', 'forest', 'cave'];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i / 6) + rng.next() * 0.4;
    const dist = 5 + rng.nextInt(0, 2);
    const x = Math.round(Math.cos(angle) * dist);
    const y = Math.round(Math.sin(angle) * dist);
    const type = rng.pick(ring2Types);
    let features = [];

    if (type === 'city') {
      const shuffled = rng.shuffle(CITY_OPTIONS);
      features = ['tavern', shuffled[0], shuffled[1]];
    } else if (type === 'village') {
      features = ['farm'];
      if (rng.next() > 0.5) features.push('apothecary');
    }

    const idx = addNode(x, y, type, generateNodeName(type), features, null, 2);
    if (idx !== null) {
      const nearest = findNearestNode(x, y, idx);
      addConnection(idx, nearest);
    }
  }
  console.log('Created ring 2');

  // 4. Create Guilds (one per class, distance 5-8)
  const classes = ['warrior', 'wizard', 'monk', 'chemist'];
  for (let i = 0; i < classes.length; i++) {
    const angle = (Math.PI * 2 * i / classes.length) + Math.PI / 4 + rng.next() * 0.3;
    const dist = 6 + rng.nextInt(0, 2);
    const x = Math.round(Math.cos(angle) * dist);
    const y = Math.round(Math.sin(angle) * dist);

    // Find nearby empty spot if occupied
    let finalX = x, finalY = y;
    for (let offset = 0; offset < 3; offset++) {
      if (!nodeMap.has(`${finalX},${finalY}`)) break;
      finalX = x + rng.nextInt(-1, 1);
      finalY = y + rng.nextInt(-1, 1);
    }

    const guildName = `${classes[i].charAt(0).toUpperCase() + classes[i].slice(1)}s' Guild`;
    const idx = addNode(finalX, finalY, 'guild', guildName, ['guild_hall', 'training_ground'], classes[i], 2);
    if (idx !== null) {
      const nearest = findNearestNode(finalX, finalY, idx);
      addConnection(idx, nearest);
    }
  }
  console.log('Created guilds');

  // 5. Create ring 3 (8-11 distance)
  const ring3Types = ['village', 'forest', 'cave', 'mountain', 'bridge'];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i / 8) + rng.next() * 0.3;
    const dist = 8 + rng.nextInt(0, 3);
    const x = Math.round(Math.cos(angle) * dist);
    const y = Math.round(Math.sin(angle) * dist);
    const type = rng.pick(ring3Types);
    let features = [];

    if (type === 'village') {
      features = ['farm'];
      if (rng.next() > 0.5) features.push('apothecary');
    }

    const idx = addNode(x, y, type, generateNodeName(type), features, null, 3);
    if (idx !== null) {
      const nearest = findNearestNode(x, y, idx);
      addConnection(idx, nearest);

      // Sometimes add second connection
      if (rng.next() > 0.6) {
        const secondNearest = findNearestNode(x, y, idx);
        if (secondNearest !== nearest) {
          addConnection(idx, secondNearest);
        }
      }
    }
  }
  console.log('Created ring 3');

  // 6. Create outer ring and Palace (12-16 distance)
  const outerTypes = ['forest', 'cave', 'mountain', 'bridge'];
  let palacePlaced = false;

  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * 2 * i / 10) + rng.next() * 0.3;
    const dist = 13 + rng.nextInt(0, 3);
    const x = Math.round(Math.cos(angle) * dist);
    const y = Math.round(Math.sin(angle) * dist);

    let type, name, features = [];

    // Place Palace exactly once at minimum distance 13
    if (!palacePlaced && i === 5) {
      type = 'palace';
      name = 'Ancient Palace';
      features = ['throne_room', 'treasury'];
      palacePlaced = true;
    } else {
      type = rng.pick(outerTypes);
      name = generateNodeName(type);
    }

    const idx = addNode(x, y, type, name, features, null, type === 'palace' ? 5 : 4);
    if (idx !== null) {
      const nearest = findNearestNode(x, y, idx);
      addConnection(idx, nearest);
    }
  }
  console.log('Created outer ring with Palace');

  return { nodes, connections };
}

async function seedItems() {
  const items = [
    // Weapons
    { name: 'Rusty Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 3 }, level_requirement: 1, base_price: 50, rarity: 1 },
    { name: 'Iron Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 7 }, level_requirement: 5, base_price: 150, rarity: 2 },
    { name: 'Steel Blade', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 12 }, level_requirement: 15, base_price: 400, rarity: 2 },
    { name: 'Oak Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 5 }, level_requirement: 1, base_price: 60, rarity: 1 },
    { name: 'Mystic Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 10, mp_max: 20 }, level_requirement: 10, base_price: 300, rarity: 2 },
    { name: 'Combat Gloves', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 4, agility: 2 }, level_requirement: 1, base_price: 45, rarity: 1 },

    // Armor
    { name: 'Leather Armor', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 3, hp_max: 15 }, level_requirement: 1, base_price: 80, rarity: 1 },
    { name: 'Chain Mail', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 6, hp_max: 30 }, level_requirement: 8, base_price: 250, rarity: 2 },
    { name: 'Cloth Robe', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { intelligence: 3, mp_max: 15 }, level_requirement: 1, base_price: 70, rarity: 1 },

    // Accessories
    { name: 'Lucky Charm', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 5 }, level_requirement: 1, base_price: 100, rarity: 2 },
    { name: 'Ring of Vitality', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { hp_max: 25 }, level_requirement: 5, base_price: 200, rarity: 2 },

    // Consumables
    { name: 'Health Potion', item_type: 'consumable', effect_type: 'heal_hp', effect_value: 50, base_price: 25, rarity: 1 },
    { name: 'Mana Potion', item_type: 'consumable', effect_type: 'heal_mp', effect_value: 30, base_price: 30, rarity: 1 },
    { name: 'Antidote', item_type: 'consumable', effect_type: 'cure_poison', effect_value: 0, base_price: 15, rarity: 1 },
    { name: 'Phoenix Feather', item_type: 'consumable', effect_type: 'revive', effect_value: 50, base_price: 500, rarity: 4 }
  ];

  for (const item of items) {
    await pool.query(
      `INSERT INTO item_templates (name, item_type, equipment_slot, stat_bonuses, level_requirement, effect_type, effect_value, base_price, rarity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        item.name,
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

  console.log(`Seeded ${items.length} item templates`);
}

async function seedEnemies() {
  const enemies = [
    { name: 'Forest Goblin', base_hp: 40, base_mp: 10, base_strength: 8, base_intelligence: 4, base_agility: 6, spawn_node_types: ['forest'], experience_reward: 20, gold_reward_max: 15 },
    { name: 'Wild Wolf', base_hp: 35, base_mp: 5, base_strength: 10, base_intelligence: 2, base_agility: 10, spawn_node_types: ['forest', 'mountain'], experience_reward: 25, gold_reward_max: 10 },
    { name: 'Cave Bat', base_hp: 25, base_mp: 15, base_strength: 5, base_intelligence: 6, base_agility: 12, spawn_node_types: ['cave'], experience_reward: 15, gold_reward_max: 8 },
    { name: 'Rock Golem', base_hp: 80, base_mp: 0, base_strength: 15, base_intelligence: 1, base_agility: 2, spawn_node_types: ['cave', 'mountain'], experience_reward: 50, gold_reward_max: 30, min_difficulty_tier: 2 },
    { name: 'Mountain Troll', base_hp: 100, base_mp: 5, base_strength: 18, base_intelligence: 3, base_agility: 4, spawn_node_types: ['mountain', 'bridge'], experience_reward: 75, gold_reward_max: 50, min_difficulty_tier: 3 },
    { name: 'Bridge Bandit', base_hp: 45, base_mp: 20, base_strength: 12, base_intelligence: 8, base_agility: 8, spawn_node_types: ['bridge'], experience_reward: 35, gold_reward_max: 40 },
    { name: 'Slime', base_hp: 30, base_mp: 10, base_strength: 5, base_intelligence: 3, base_agility: 4, spawn_node_types: ['forest', 'cave'], experience_reward: 10, gold_reward_max: 5 },
    { name: 'Skeleton Warrior', base_hp: 50, base_mp: 0, base_strength: 12, base_intelligence: 2, base_agility: 6, spawn_node_types: ['cave'], experience_reward: 40, gold_reward_max: 25, min_difficulty_tier: 2 }
  ];

  for (const enemy of enemies) {
    await pool.query(
      `INSERT INTO enemy_templates (name, base_hp, base_mp, base_strength, base_intelligence, base_agility, spawn_node_types, experience_reward, gold_reward_min, gold_reward_max, min_difficulty_tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING`,
      [
        enemy.name,
        enemy.base_hp,
        enemy.base_mp,
        enemy.base_strength,
        enemy.base_intelligence,
        enemy.base_agility,
        enemy.spawn_node_types,
        enemy.experience_reward,
        enemy.gold_reward_min || 1,
        enemy.gold_reward_max,
        enemy.min_difficulty_tier || 1
      ]
    );
  }

  console.log(`Seeded ${enemies.length} enemy templates`);
}

async function main() {
  const client = await pool.connect();

  try {
    console.log('Starting database seed...\n');

    // Clear existing data (in reverse dependency order)
    console.log('Clearing existing data...');
    await client.query('TRUNCATE world_node_connections, world_nodes CASCADE');
    await client.query('TRUNCATE item_templates CASCADE');
    await client.query('TRUNCATE enemy_templates CASCADE');

    // Generate world
    const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
    console.log(`\nGenerating world with seed: ${worldSeed}`);
    const { nodes, connections } = await generateWorld(worldSeed);

    // Insert nodes
    console.log(`\nInserting ${nodes.length} world nodes...`);
    const nodeIds = [];
    for (const node of nodes) {
      const result = await client.query(
        `INSERT INTO world_nodes (node_type, name, x_coord, y_coord, distance_from_center, features, guild_class, local_seed, difficulty_tier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [node.node_type, node.name, node.x_coord, node.y_coord, node.distance_from_center, node.features, node.guild_class, node.local_seed, node.difficulty_tier]
      );
      nodeIds.push(result.rows[0].id);
    }

    // Insert connections
    console.log(`Inserting ${connections.length} node connections...`);
    for (const conn of connections) {
      await client.query(
        `INSERT INTO world_node_connections (from_node_id, to_node_id, path_type)
         VALUES ($1, $2, 'road')
         ON CONFLICT DO NOTHING`,
        [nodeIds[conn.from], nodeIds[conn.to]]
      );
      // Add reverse connection
      await client.query(
        `INSERT INTO world_node_connections (from_node_id, to_node_id, path_type)
         VALUES ($1, $2, 'road')
         ON CONFLICT DO NOTHING`,
        [nodeIds[conn.to], nodeIds[conn.from]]
      );
    }

    // Seed items
    console.log('\nSeeding items...');
    await seedItems();

    // Seed enemies
    console.log('\nSeeding enemies...');
    await seedEnemies();

    console.log('\nSeed completed successfully!');
    console.log(`Total nodes: ${nodes.length}`);
    console.log(`Total connections: ${connections.length * 2} (bidirectional)`);

  } catch (err) {
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
