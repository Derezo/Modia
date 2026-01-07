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
  // Items are seeded in order - templateId corresponds to array index + 1
  const items = [
    // Weapons (templateId 1-6)
    { name: 'Rusty Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 3 }, level_requirement: 1, base_price: 50, rarity: 1, description: 'A worn blade, but still sharp enough to cut.' },           // 1
    { name: 'Iron Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 7 }, level_requirement: 5, base_price: 150, rarity: 2, description: 'A sturdy iron blade forged by skilled smiths.' },            // 2
    { name: 'Steel Blade', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 12, agility: 3 }, level_requirement: 15, base_price: 400, rarity: 3, description: 'High-quality steel, perfectly balanced.' },   // 3
    { name: 'Oak Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 5 }, level_requirement: 1, base_price: 60, rarity: 1, description: 'A simple staff carved from oak wood.' },                  // 4
    { name: 'Mystic Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 10, mp_max: 20 }, level_requirement: 10, base_price: 300, rarity: 2, description: 'Imbued with magical essence.' },         // 5
    { name: 'Combat Gloves', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 4, agility: 3 }, level_requirement: 1, base_price: 45, rarity: 1, description: 'Reinforced gloves for martial artists.' },     // 6

    // Armor (templateId 7-9)
    { name: 'Leather Armor', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 3, hp_max: 15 }, level_requirement: 1, base_price: 80, rarity: 1, description: 'Light armor that allows free movement.' },           // 7
    { name: 'Chain Mail', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 6, hp_max: 30 }, level_requirement: 8, base_price: 250, rarity: 2, description: 'Interlocking rings provide solid protection.' },       // 8
    { name: 'Cloth Robe', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { intelligence: 3, mp_max: 15 }, level_requirement: 1, base_price: 70, rarity: 1, description: 'A robe favored by spellcasters.' },                 // 9

    // Accessories (templateId 10-11)
    { name: 'Lucky Charm', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 5 }, level_requirement: 1, base_price: 100, rarity: 2, description: 'A four-leaf clover preserved in crystal.' },                 // 10
    { name: 'Ring of Vitality', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { hp_max: 25, vitality: 3 }, level_requirement: 5, base_price: 200, rarity: 2, description: 'Pulses with life energy.' },            // 11

    // Consumables (templateId 12-15)
    { name: 'Health Potion', item_type: 'consumable', effect_type: 'heal_hp', effect_value: 50, base_price: 25, rarity: 1, description: 'Restores 50 HP when consumed.' },                                                              // 12
    { name: 'Mana Potion', item_type: 'consumable', effect_type: 'heal_mp', effect_value: 30, base_price: 30, rarity: 1, description: 'Restores 30 MP when consumed.' },                                                                // 13
    { name: 'Antidote', item_type: 'consumable', effect_type: 'cure_poison', effect_value: 0, base_price: 15, rarity: 1, description: 'Cures poison status.' },                                                                         // 14
    { name: 'Phoenix Feather', item_type: 'consumable', effect_type: 'revive', effect_value: 50, base_price: 500, rarity: 4, description: 'Revives a fallen ally with 50% HP.' },                                                       // 15

    // Additional Weapons (templateId 16-20)
    { name: 'Bronze Axe', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 5 }, level_requirement: 3, base_price: 90, rarity: 1, description: 'A heavy axe with a bronze head.' },                          // 16
    { name: 'Iron Axe', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 9, vitality: 2 }, level_requirement: 8, base_price: 220, rarity: 2, description: 'A brutish weapon favored by warriors.' },         // 17
    { name: 'Apprentice Wand', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 3, mp_max: 10 }, level_requirement: 1, base_price: 40, rarity: 1, description: 'A basic wand for magic students.' },     // 18
    { name: 'Steel Fist', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 7, agility: 5 }, level_requirement: 10, base_price: 180, rarity: 2, description: 'Metal knuckles for devastating punches.' },     // 19
    { name: 'Throwing Knives', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { agility: 6, luck: 3 }, level_requirement: 5, base_price: 120, rarity: 2, description: 'A set of balanced throwing blades.' },          // 20

    // Additional Armor (templateId 21-25)
    { name: 'Leather Helm', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { vitality: 2 }, level_requirement: 1, base_price: 40, rarity: 1, description: 'A simple leather cap.' },                                         // 21
    { name: 'Iron Helm', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { vitality: 4, strength: 1 }, level_requirement: 8, base_price: 120, rarity: 2, description: 'Solid iron protection for the head.' },                // 22
    { name: 'Leather Boots', item_type: 'armor', equipment_slot: 'feet', stat_bonuses: { agility: 2 }, level_requirement: 1, base_price: 35, rarity: 1, description: 'Comfortable boots for travel.' },                                 // 23
    { name: 'Iron Greaves', item_type: 'armor', equipment_slot: 'feet', stat_bonuses: { vitality: 3, agility: 1 }, level_requirement: 8, base_price: 100, rarity: 2, description: 'Heavy leg armor.' },                                 // 24
    { name: 'Wizard Hat', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { intelligence: 4, mp_max: 10 }, level_requirement: 5, base_price: 90, rarity: 2, description: 'A pointy hat imbued with magic.' },                 // 25

    // Additional Accessories (templateId 26-28)
    { name: 'Iron Ring', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { strength: 2, vitality: 1 }, level_requirement: 1, base_price: 50, rarity: 1, description: 'A simple iron band.' },                        // 26
    { name: 'Mage Ring', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { intelligence: 4, mp_max: 15 }, level_requirement: 5, base_price: 150, rarity: 2, description: 'Enhances magical power.' },                // 27
    { name: 'Speed Amulet', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { agility: 5 }, level_requirement: 3, base_price: 130, rarity: 2, description: 'Increases reflexes and speed.' },                        // 28

    // Additional Consumables (templateId 29-32)
    { name: 'Hi-Potion', item_type: 'consumable', effect_type: 'heal_hp', effect_value: 150, base_price: 100, rarity: 2, description: 'Restores 150 HP when consumed.' },                                                               // 29
    { name: 'Hi-Ether', item_type: 'consumable', effect_type: 'heal_mp', effect_value: 80, base_price: 120, rarity: 2, description: 'Restores 80 MP when consumed.' },                                                                  // 30
    { name: 'Elixir', item_type: 'consumable', effect_type: 'heal_both', effect_value: 100, base_price: 300, rarity: 3, description: 'Restores 100 HP and 50 MP.' },                                                                    // 31
    { name: 'Status Cure', item_type: 'consumable', effect_type: 'cure_all', effect_value: 0, base_price: 75, rarity: 2, description: 'Cures all negative status effects.' }                                                            // 32
  ];

  for (const item of items) {
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

  console.log(`Seeded ${items.length} item templates`);
}

async function seedEnemies() {
  const enemies = [
    // Tier 1 - Forest (starter area)
    {
      name: 'Goblin Warrior',
      sprite_id: 'goblin_warrior',
      base_hp: 40, base_mp: 10, base_strength: 8, base_intelligence: 4, base_agility: 6,
      spawn_node_types: ['forest'], ai_type: 'aggressive',
      experience_reward: 20, gold_reward_min: 5, gold_reward_max: 15, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.6, minItems: 0, maxItems: 1, rarityWeights: { common: 85, uncommon: 15 }, itemPool: [{ templateId: 1, weight: 50 }, { templateId: 12, weight: 50 }] }
    },
    {
      name: 'Gray Wolf',
      sprite_id: 'gray_wolf',
      base_hp: 35, base_mp: 5, base_strength: 10, base_intelligence: 2, base_agility: 10,
      spawn_node_types: ['forest', 'mountain'], ai_type: 'pack',
      experience_reward: 25, gold_reward_min: 3, gold_reward_max: 10, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.5, minItems: 0, maxItems: 1, rarityWeights: { common: 90, uncommon: 10 }, itemPool: [{ templateId: 12, weight: 70 }, { templateId: 13, weight: 30 }] }
    },
    {
      name: 'Forest Slime',
      sprite_id: 'forest_slime',
      base_hp: 30, base_mp: 10, base_strength: 5, base_intelligence: 3, base_agility: 4,
      spawn_node_types: ['forest', 'cave'], ai_type: 'defensive',
      experience_reward: 10, gold_reward_min: 1, gold_reward_max: 5, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.4, minItems: 0, maxItems: 1, rarityWeights: { common: 95, uncommon: 5 }, itemPool: [{ templateId: 12, weight: 100 }] }
    },

    // Tier 1-2 - Caves
    {
      name: 'Cave Bat',
      sprite_id: 'cave_bat',
      base_hp: 25, base_mp: 15, base_strength: 5, base_intelligence: 6, base_agility: 12,
      spawn_node_types: ['cave'], ai_type: 'hit-and-run',
      experience_reward: 15, gold_reward_min: 2, gold_reward_max: 8, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.35, minItems: 0, maxItems: 1, rarityWeights: { common: 90, uncommon: 10 }, itemPool: [{ templateId: 13, weight: 100 }] }
    },
    {
      name: 'Giant Spider',
      sprite_id: 'giant_spider',
      base_hp: 45, base_mp: 20, base_strength: 10, base_intelligence: 5, base_agility: 9,
      spawn_node_types: ['cave', 'forest'], ai_type: 'ambush',
      experience_reward: 35, gold_reward_min: 8, gold_reward_max: 20, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.65, minItems: 0, maxItems: 2, rarityWeights: { common: 70, uncommon: 25, rare: 5 }, itemPool: [{ templateId: 13, weight: 40 }, { templateId: 7, weight: 30 }, { templateId: 12, weight: 30 }] }
    },
    {
      name: 'Skeleton Warrior',
      sprite_id: 'skeleton_warrior',
      base_hp: 50, base_mp: 0, base_strength: 12, base_intelligence: 2, base_agility: 6,
      spawn_node_types: ['cave'], ai_type: 'tactical',
      experience_reward: 40, gold_reward_min: 10, gold_reward_max: 25, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.7, minItems: 0, maxItems: 2, rarityWeights: { common: 60, uncommon: 30, rare: 10 }, itemPool: [{ templateId: 1, weight: 35 }, { templateId: 2, weight: 25 }, { templateId: 7, weight: 40 }] }
    },
    {
      name: 'Stone Golem',
      sprite_id: 'stone_golem',
      base_hp: 80, base_mp: 0, base_strength: 15, base_intelligence: 1, base_agility: 2,
      spawn_node_types: ['cave', 'mountain'], ai_type: 'defensive',
      experience_reward: 50, gold_reward_min: 15, gold_reward_max: 30, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.75, minItems: 1, maxItems: 2, rarityWeights: { common: 50, uncommon: 35, rare: 15 }, itemPool: [{ templateId: 8, weight: 50 }, { templateId: 11, weight: 50 }] }
    },

    // Tier 2-3 - Mountains
    {
      name: 'Mountain Troll',
      sprite_id: 'mountain_troll',
      base_hp: 100, base_mp: 5, base_strength: 18, base_intelligence: 3, base_agility: 4,
      spawn_node_types: ['mountain', 'bridge'], ai_type: 'aggressive',
      experience_reward: 75, gold_reward_min: 25, gold_reward_max: 50, min_difficulty_tier: 3,
      drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 40, uncommon: 40, rare: 18, epic: 2 }, itemPool: [{ templateId: 2, weight: 30 }, { templateId: 3, weight: 25 }, { templateId: 8, weight: 25 }, { templateId: 15, weight: 20 }] }
    },
    {
      name: 'Troll Shaman',
      sprite_id: 'troll_shaman',
      base_hp: 70, base_mp: 50, base_strength: 10, base_intelligence: 14, base_agility: 6,
      spawn_node_types: ['mountain'], ai_type: 'support',
      experience_reward: 65, gold_reward_min: 20, gold_reward_max: 45, min_difficulty_tier: 3,
      abilities: [{ type: 'heal', power: 30 }, { type: 'debuff', effect: 'slow' }],
      drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 35, uncommon: 40, rare: 20, epic: 5 }, itemPool: [{ templateId: 4, weight: 35 }, { templateId: 5, weight: 35 }, { templateId: 13, weight: 30 }] }
    },
    {
      name: 'Harpy',
      sprite_id: 'harpy',
      base_hp: 55, base_mp: 30, base_strength: 12, base_intelligence: 8, base_agility: 14,
      spawn_node_types: ['mountain'], ai_type: 'hit-and-run',
      experience_reward: 55, gold_reward_min: 15, gold_reward_max: 35, min_difficulty_tier: 3,
      drop_table: { dropChance: 0.7, minItems: 0, maxItems: 2, rarityWeights: { common: 45, uncommon: 40, rare: 15 }, itemPool: [{ templateId: 10, weight: 40 }, { templateId: 6, weight: 30 }, { templateId: 13, weight: 30 }] }
    },

    // Tier 2 - Bridges
    {
      name: 'Bridge Bandit',
      sprite_id: 'bridge_bandit',
      base_hp: 45, base_mp: 20, base_strength: 12, base_intelligence: 8, base_agility: 8,
      spawn_node_types: ['bridge'], ai_type: 'tactical',
      experience_reward: 35, gold_reward_min: 20, gold_reward_max: 40, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.75, minItems: 1, maxItems: 2, rarityWeights: { common: 55, uncommon: 35, rare: 10 }, itemPool: [{ templateId: 1, weight: 30 }, { templateId: 6, weight: 30 }, { templateId: 10, weight: 20 }, { templateId: 12, weight: 20 }] }
    },
    {
      name: 'Bandit Captain',
      sprite_id: 'bandit_captain',
      base_hp: 65, base_mp: 25, base_strength: 14, base_intelligence: 10, base_agility: 10,
      spawn_node_types: ['bridge'], ai_type: 'tactical',
      experience_reward: 55, gold_reward_min: 35, gold_reward_max: 60, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.85, minItems: 1, maxItems: 3, rarityWeights: { common: 40, uncommon: 40, rare: 17, epic: 3 }, itemPool: [{ templateId: 2, weight: 25 }, { templateId: 3, weight: 20 }, { templateId: 8, weight: 25 }, { templateId: 10, weight: 15 }, { templateId: 15, weight: 15 }] }
    },
    {
      name: 'Bridge Troll',
      sprite_id: 'bridge_troll',
      base_hp: 90, base_mp: 10, base_strength: 16, base_intelligence: 4, base_agility: 5,
      spawn_node_types: ['bridge'], ai_type: 'aggressive',
      experience_reward: 70, gold_reward_min: 30, gold_reward_max: 55, min_difficulty_tier: 3,
      drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 35, uncommon: 45, rare: 18, epic: 2 }, itemPool: [{ templateId: 3, weight: 35 }, { templateId: 8, weight: 35 }, { templateId: 11, weight: 30 }] }
    },

    // Tier 4+ - Palace area
    {
      name: 'Dark Knight',
      sprite_id: 'dark_knight',
      base_hp: 120, base_mp: 30, base_strength: 20, base_intelligence: 8, base_agility: 10,
      spawn_node_types: ['palace'], ai_type: 'tactical',
      experience_reward: 120, gold_reward_min: 50, gold_reward_max: 100, min_difficulty_tier: 4,
      drop_table: { dropChance: 0.9, minItems: 1, maxItems: 3, rarityWeights: { common: 20, uncommon: 40, rare: 30, epic: 10 }, itemPool: [{ templateId: 3, weight: 30 }, { templateId: 8, weight: 30 }, { templateId: 11, weight: 25 }, { templateId: 15, weight: 15 }] }
    },
    {
      name: 'Shadow Assassin',
      sprite_id: 'shadow_assassin',
      base_hp: 75, base_mp: 40, base_strength: 16, base_intelligence: 12, base_agility: 18,
      spawn_node_types: ['palace'], ai_type: 'ambush',
      experience_reward: 100, gold_reward_min: 40, gold_reward_max: 80, min_difficulty_tier: 4,
      drop_table: { dropChance: 0.85, minItems: 1, maxItems: 2, rarityWeights: { common: 25, uncommon: 40, rare: 28, epic: 7 }, itemPool: [{ templateId: 6, weight: 40 }, { templateId: 10, weight: 35 }, { templateId: 15, weight: 25 }] }
    },
    {
      name: 'Palace Guard',
      sprite_id: 'palace_guard',
      base_hp: 100, base_mp: 20, base_strength: 16, base_intelligence: 6, base_agility: 8,
      spawn_node_types: ['palace'], ai_type: 'defensive',
      experience_reward: 90, gold_reward_min: 35, gold_reward_max: 70, min_difficulty_tier: 4,
      drop_table: { dropChance: 0.85, minItems: 1, maxItems: 2, rarityWeights: { common: 30, uncommon: 40, rare: 25, epic: 5 }, itemPool: [{ templateId: 2, weight: 30 }, { templateId: 8, weight: 35 }, { templateId: 11, weight: 35 }] }
    }
  ];

  for (const enemy of enemies) {
    await pool.query(
      `INSERT INTO enemy_templates (name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility, spawn_node_types, ai_type, abilities, drop_table, experience_reward, gold_reward_min, gold_reward_max, min_difficulty_tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING`,
      [
        enemy.name,
        enemy.sprite_id,
        enemy.base_hp,
        enemy.base_mp,
        enemy.base_strength,
        enemy.base_intelligence,
        enemy.base_agility,
        enemy.spawn_node_types,
        enemy.ai_type || 'aggressive',
        JSON.stringify(enemy.abilities || []),
        JSON.stringify(enemy.drop_table || {}),
        enemy.experience_reward,
        enemy.gold_reward_min || 1,
        enemy.gold_reward_max,
        enemy.min_difficulty_tier || 1
      ]
    );
  }

  console.log(`Seeded ${enemies.length} enemy templates`);
}

/**
 * Seed shop inventory for all nodes with shops
 * @param {Array} nodeIds - Array of node IDs (index matches nodes array)
 * @param {Array} nodes - Array of node objects with features
 */
async function seedShopInventory(nodeIds, nodes) {
  // Item template IDs by shop type
  // Based on seedItems() order: weapons 1-6, armor 7-9, accessories 10-11, consumables 12-15,
  // more weapons 16-20, more armor 21-25, more accessories 26-28, more consumables 29-32

  const shopStock = {
    blacksmith: {
      // Weapons and armor
      items: [
        { templateId: 1, qty: 10 },  // Rusty Sword
        { templateId: 4, qty: 8 },   // Oak Staff
        { templateId: 6, qty: 8 },   // Combat Gloves
        { templateId: 7, qty: 10 },  // Leather Armor
        { templateId: 9, qty: 8 },   // Cloth Robe
        { templateId: 16, qty: 6 },  // Bronze Axe
        { templateId: 18, qty: 6 },  // Apprentice Wand
        { templateId: 21, qty: 10 }, // Leather Helm
        { templateId: 23, qty: 10 }, // Leather Boots
        // Higher level items (less stock)
        { templateId: 2, qty: 4 },   // Iron Sword
        { templateId: 8, qty: 4 },   // Chain Mail
        { templateId: 17, qty: 3 },  // Iron Axe
        { templateId: 19, qty: 3 },  // Steel Fist
        { templateId: 22, qty: 4 },  // Iron Helm
        { templateId: 24, qty: 4 },  // Iron Greaves
        { templateId: 25, qty: 3 },  // Wizard Hat
      ]
    },
    apothecary: {
      // Consumables
      items: [
        { templateId: 12, qty: 20 }, // Health Potion
        { templateId: 13, qty: 15 }, // Mana Potion
        { templateId: 14, qty: 10 }, // Antidote
        { templateId: 29, qty: 8 },  // Hi-Potion
        { templateId: 30, qty: 6 },  // Hi-Ether
        { templateId: 31, qty: 3 },  // Elixir
        { templateId: 32, qty: 5 },  // Status Cure
        { templateId: 15, qty: 2 },  // Phoenix Feather (rare)
      ]
    },
    farm: {
      // Basic consumables at lower prices (village economy)
      items: [
        { templateId: 12, qty: 15 }, // Health Potion
        { templateId: 13, qty: 10 }, // Mana Potion
        { templateId: 14, qty: 8 },  // Antidote
      ]
    }
  };

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
      if (!shopType || !shopStock[shopType]) continue;

      const stock = shopStock[shopType];
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

async function main() {
  const client = await pool.connect();

  try {
    console.log('Starting database seed...\n');

    // Clear existing data (in reverse dependency order)
    console.log('Clearing existing data...');
    await client.query('TRUNCATE world_node_connections, world_nodes CASCADE');
    await client.query('TRUNCATE item_templates CASCADE');
    await client.query('TRUNCATE enemy_templates CASCADE');
    // Clear shop inventory (will be re-seeded)
    await client.query('TRUNCATE npc_shop_inventory CASCADE');
    await client.query('TRUNCATE shop_transactions CASCADE');

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

    // Seed shop inventory
    console.log('\nSeeding shop inventory...');
    await seedShopInventory(nodeIds, nodes);

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
