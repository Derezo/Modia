/**
 * PixelLab Prompt Templates
 * Organized prompts for AI sprite generation
 *
 * IMPORTANT: Terrain names must match BattleGrid.getTerrainWeights():
 * - forest biome: grass, forest, stone, rock
 * - cave biome: stone, rock, water, lava, grass
 * - mountain biome: stone, rock, grass, cliff
 * - bridge biome: stone, water, grass
 * - castle biome: stone, grass
 */

// Common style suffix for cohesive visuals
const STYLE_SUFFIX = 'pixel art, 16-bit fantasy RPG, consistent lighting from top-left, cohesive color palette';

// Isometric-specific suffix for tiles - emphasize seamless edges for tiling
const ISOMETRIC_SUFFIX = 'isometric diamond tile, 64x64 pixel canvas, seamless edges that blend with adjacent tiles, flat ground plane';

// Combined suffix for terrain tiles
const TERRAIN_STYLE = `${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`;

// =====================
// TERRAIN TILES
// Prompts optimized for cohesive isometric tiling
// =====================

const TERRAIN_PROMPTS = {
  forest: {
    // Walkable terrain (60% of forest)
    grass: [
      `Lush green grass, forest floor, SEAMLESS EDGES on all sides, tileable texture, ${TERRAIN_STYLE}`,
      `Green meadow grass, natural variation, EDGES MUST BLEND with adjacent tiles, ${TERRAIN_STYLE}`,
      `Vibrant grass with subtle details, CONTINUOUS PATTERN at borders, soft green, ${TERRAIN_STYLE}`,
      `Forest grass, earthy green, TILEABLE seamless texture, consistent coloring, ${TERRAIN_STYLE}`
    ],
    // Walkable stone paths (10% of forest)
    stone: [
      `Gray cobblestone path, SEAMLESS EDGES, tileable stone pattern, ${TERRAIN_STYLE}`,
      `Weathered stone tiles, EDGES BLEND seamlessly, gray-brown tones, ${TERRAIN_STYLE}`,
      `Flat stone floor, CONTINUOUS PATTERN at borders, natural walkway, ${TERRAIN_STYLE}`,
      `Old stone pavement, TILEABLE texture, consistent gray surface, ${TERRAIN_STYLE}`
    ],
    // Impassable dense forest (25% of forest)
    forest: [
      `Dense undergrowth, ferns and brambles, SEAMLESS EDGES, dark green, ${TERRAIN_STYLE}`,
      `Thick forest floor, tangled vegetation, EDGES BLEND with adjacent, ${TERRAIN_STYLE}`,
      `Overgrown thicket, natural barrier, TILEABLE pattern, deep shadows, ${TERRAIN_STYLE}`,
      `Dense foliage, forest obstacle, SEAMLESS borders, consistent green, ${TERRAIN_STYLE}`
    ],
    // Impassable rocks (5% of forest)
    rock: [
      `Rocky ground, mossy patches, SEAMLESS EDGES, forest rocks, ${TERRAIN_STYLE}`,
      `Stone debris, lichen covered, EDGES BLEND seamlessly, gray-green, ${TERRAIN_STYLE}`,
      `Rocky terrain, moss patches, TILEABLE texture, forest setting, ${TERRAIN_STYLE}`,
      `Boulder ground, ancient stones, SEAMLESS pattern, forest rock, ${TERRAIN_STYLE}`
    ]
  },

  cave: {
    // Walkable stone floor (50% of cave)
    stone: [
      `Dark cave stone floor, SEAMLESS EDGES, tileable dungeon texture, ${TERRAIN_STYLE}`,
      `Gray cavern floor, EDGES BLEND seamlessly, worn rock surface, ${TERRAIN_STYLE}`,
      `Smooth cave stone, TILEABLE pattern, underground path, ${TERRAIN_STYLE}`,
      `Dungeon floor, SEAMLESS borders, dark gray stone texture, ${TERRAIN_STYLE}`
    ],
    // Walkable grass patches (10% of cave)
    grass: [
      `Cave moss patch, SEAMLESS EDGES, underground vegetation, ${TERRAIN_STYLE}`,
      `Subterranean moss, EDGES BLEND with adjacent, pale green growth, ${TERRAIN_STYLE}`,
      `Underground moss carpet, TILEABLE texture, soft green glow, ${TERRAIN_STYLE}`,
      `Cave flora, SEAMLESS pattern, fungal grass ground, ${TERRAIN_STYLE}`
    ],
    // Impassable rocky ground (20% of cave)
    rock: [
      `Jagged cave rocks, SEAMLESS EDGES, rocky debris ground, ${TERRAIN_STYLE}`,
      `Broken stone debris, EDGES BLEND seamlessly, cave rubble, ${TERRAIN_STYLE}`,
      `Sharp rock ground, TILEABLE texture, cave obstacle, ${TERRAIN_STYLE}`,
      `Cave rock debris, SEAMLESS pattern, unstable ground, ${TERRAIN_STYLE}`
    ],
    // Impassable water (15% of cave)
    water: [
      `Underground pool, SEAMLESS EDGES, dark cave water, ${TERRAIN_STYLE}`,
      `Subterranean water, EDGES BLEND seamlessly, deep blue-black, ${TERRAIN_STYLE}`,
      `Cave stream, TILEABLE pattern, dark flowing water, ${TERRAIN_STYLE}`,
      `Cave water pool, SEAMLESS borders, murky surface, ${TERRAIN_STYLE}`
    ],
    // Impassable lava (5% of cave)
    lava: [
      `Molten lava pool, SEAMLESS EDGES, glowing orange, ${TERRAIN_STYLE}`,
      `Lava flow, EDGES BLEND seamlessly, bright orange magma, ${TERRAIN_STYLE}`,
      `Volcanic fissure, TILEABLE pattern, glowing red lava, ${TERRAIN_STYLE}`,
      `Magma pool, SEAMLESS borders, fiery orange glow, ${TERRAIN_STYLE}`
    ]
  },

  mountain: {
    // Walkable stone (40% of mountain)
    stone: [
      `Mountain rock surface, SEAMLESS EDGES, gray alpine stone, ${TERRAIN_STYLE}`,
      `Weathered mountain path, EDGES BLEND seamlessly, highland walkway, ${TERRAIN_STYLE}`,
      `Rocky plateau, TILEABLE pattern, flat stone surface, ${TERRAIN_STYLE}`,
      `Mountain granite floor, SEAMLESS borders, cold gray stone, ${TERRAIN_STYLE}`
    ],
    // Walkable grass (20% of mountain)
    grass: [
      `Alpine grass, SEAMLESS EDGES, sparse highland vegetation, ${TERRAIN_STYLE}`,
      `Mountain meadow, EDGES BLEND with adjacent, short tough grass, ${TERRAIN_STYLE}`,
      `Rocky grass ground, TILEABLE texture, sparse green growth, ${TERRAIN_STYLE}`,
      `Highland grass, SEAMLESS pattern, wind-swept vegetation, ${TERRAIN_STYLE}`
    ],
    // Impassable rocks (30% of mountain)
    rock: [
      `Mountain boulder ground, SEAMLESS EDGES, rocky debris, ${TERRAIN_STYLE}`,
      `Jagged rock terrain, EDGES BLEND seamlessly, alpine obstacle, ${TERRAIN_STYLE}`,
      `Rocky debris ground, TILEABLE texture, mountain stones, ${TERRAIN_STYLE}`,
      `Alpine rock formation, SEAMLESS pattern, stone debris, ${TERRAIN_STYLE}`
    ],
    // Impassable cliffs (10% of mountain)
    cliff: [
      `Cliff edge terrain, SEAMLESS EDGES, dangerous precipice, ${TERRAIN_STYLE}`,
      `Steep cliff ground, EDGES BLEND seamlessly, rocky ledge, ${TERRAIN_STYLE}`,
      `Mountain cliff edge, TILEABLE pattern, sheer rock, ${TERRAIN_STYLE}`,
      `Precipice ground, SEAMLESS borders, crumbling cliff, ${TERRAIN_STYLE}`
    ]
  },

  bridge: {
    // Walkable stone (60% of bridge)
    stone: [
      `Bridge stone tiles, SEAMLESS EDGES, ancient masonry, ${TERRAIN_STYLE}`,
      `Cobblestone bridge, EDGES BLEND seamlessly, weathered gray stone, ${TERRAIN_STYLE}`,
      `Stone bridge deck, TILEABLE pattern, medieval construction, ${TERRAIN_STYLE}`,
      `Ancient bridge stones, SEAMLESS borders, worn smooth surface, ${TERRAIN_STYLE}`
    ],
    // Walkable grass on edges (10% of bridge)
    grass: [
      `Bridge edge grass, SEAMLESS EDGES, moss on stone, ${TERRAIN_STYLE}`,
      `Grass at bridge base, EDGES BLEND with adjacent, green vegetation, ${TERRAIN_STYLE}`,
      `Overgrown bridge section, TILEABLE texture, grass through cracks, ${TERRAIN_STYLE}`,
      `Riverbank grass, SEAMLESS pattern, bridge approach ground, ${TERRAIN_STYLE}`
    ],
    // Impassable water (30% of bridge)
    water: [
      `River water, SEAMLESS EDGES, flowing blue stream, ${TERRAIN_STYLE}`,
      `Deep river, EDGES BLEND seamlessly, rushing water, ${TERRAIN_STYLE}`,
      `Stream flow, TILEABLE pattern, blue-green water, ${TERRAIN_STYLE}`,
      `River current, SEAMLESS borders, flowing water surface, ${TERRAIN_STYLE}`
    ]
  },

  castle: {
    // Walkable stone (70% of castle)
    stone: [
      `Castle floor tiles, SEAMLESS EDGES, polished stone, ${TERRAIN_STYLE}`,
      `Dungeon stone floor, EDGES BLEND seamlessly, gray brick surface, ${TERRAIN_STYLE}`,
      `Castle courtyard stone, TILEABLE pattern, formal pavement, ${TERRAIN_STYLE}`,
      `Throne room floor, SEAMLESS borders, ornate stone tiles, ${TERRAIN_STYLE}`
    ],
    // Walkable grass courtyard (30% of castle)
    grass: [
      `Castle garden grass, SEAMLESS EDGES, manicured lawn, ${TERRAIN_STYLE}`,
      `Courtyard grass, EDGES BLEND with adjacent, formal green, ${TERRAIN_STYLE}`,
      `Fortress lawn, TILEABLE texture, well-kept grass, ${TERRAIN_STYLE}`,
      `Royal garden ground, SEAMLESS pattern, lush castle grass, ${TERRAIN_STYLE}`
    ]
  }
};

// =====================
// TILE GENERATION CONFIG
// =====================

const TILE_CONFIG = {
  // Consistent style across all tiles
  // Valid values from PixelLab API:
  // - outline: 'single color outline', 'selective outline', 'lineless'
  // - shading: 'flat shading', 'basic shading', 'medium shading', 'detailed shading', 'highly detailed shading'
  // - detail: 'low detail', 'medium detail', 'highly detailed'
  defaultParams: {
    outline: 'selective outline',
    shading: 'medium shading',
    detail: 'medium detail'
  },

  // Tile shape based on terrain type
  tileShapes: {
    // Walkable = thin tiles (flat ground)
    walkable: 'thin',
    // Obstacles = thick tiles (elevated)
    obstacle: 'thick',
    // Structures = block tiles
    structure: 'block'
  },

  // Terrain classification
  terrainTypes: {
    walkable: ['grass', 'stone'],
    obstacle: ['forest', 'rock', 'water', 'lava', 'cliff']
  },

  // Variants per terrain type
  variantsPerTerrain: 4
};

// =====================
// OBSTACLES
// =====================

const OBSTACLE_PROMPTS = {
  rocks: {
    rock_small: `Small gray boulder, mossy patches, fantasy RPG obstacle, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    rock_medium: `Medium rock formation, weathered stone, natural obstacle, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    rock_large: `Large imposing boulder, ancient moss-covered stone, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    stalagmite: `Dark cave stalagmite, crystalline formation, underground, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    mountain_boulder: `Snow-dusted mountain boulder, alpine rock, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`
  },
  trees: {
    oak_tree: `Large oak tree, thick trunk, lush green canopy, fantasy forest, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    pine_tree: `Tall pine tree, dark green needles, forest conifer, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    dead_tree: `Gnarled dead tree, bare twisted branches, spooky, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    mushroom_large: `Giant glowing mushroom, bioluminescent cap, cave flora, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    mountain_pine: `Hardy mountain pine, snow on branches, alpine tree, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`
  },
  decorative: {
    grass_tufts: `Tall grass tuft cluster, wild meadow grass, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    wildflowers: `Colorful wildflower patch, purple and yellow blooms, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    cave_crystals: `Small crystal cluster, purple and blue gems, magical, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    fallen_log: `Moss-covered fallen log, forest debris, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`,
    stone_ruins: `Ancient broken pillar, ruined stone column, ${ISOMETRIC_SUFFIX}, ${STYLE_SUFFIX}`
  }
};

// =====================
// CHARACTER CLASSES
// =====================

const CHARACTER_PROMPTS = {
  warrior: `Medieval fantasy warrior, heavy plate armor, sword and shield, heroic stance, ${STYLE_SUFFIX}`,
  wizard: `Fantasy wizard, flowing blue robes, pointed hat, magical staff with crystal, ${STYLE_SUFFIX}`,
  monk: `Fantasy martial artist monk, simple brown gi, wrapped hands, fighting stance, ${STYLE_SUFFIX}`,
  chemist: `Fantasy alchemist, leather apron, brass goggles, potion belt, ${STYLE_SUFFIX}`
};

// =====================
// RACE-SPECIFIC PROMPTS
// =====================

const RACE_PROMPTS = {
  human: {
    base: 'human',
    traits: 'average build, determined expression',
    skinTone: 'natural skin tone'
  },
  elf: {
    base: 'elf',
    traits: 'pointed ears, slender build, graceful features',
    skinTone: 'fair pale skin, ethereal glow'
  },
  dwarf: {
    base: 'dwarf',
    traits: 'short stocky build, thick beard, broad shoulders',
    skinTone: 'ruddy complexion'
  },
  vampire: {
    base: 'vampire',
    traits: 'pale undead, fangs visible, crimson eyes, dark elegant',
    skinTone: 'deathly pale skin, dark veins'
  },
  orc: {
    base: 'orc',
    traits: 'green skin, tusks, muscular brutish build',
    skinTone: 'green-gray skin'
  }
};

// =====================
// EQUIPMENT PROMPTS
// =====================

const EQUIPMENT_PROMPTS = {
  weapons: {
    // Staves
    oak_staff: 'wooden oak staff, simple design',
    crystal_staff: 'crystalline staff, glowing blue crystal orb',
    enchanted_staff: 'enchanted staff, magical runes, pulsing energy',
    dark_staff: 'dark obsidian staff, shadowy wisps',
    // Swords
    rusty_sword: 'rusty iron sword, worn blade',
    iron_sword: 'iron sword, simple but sturdy',
    steel_sword: 'polished steel longsword',
    // Other
    dagger: 'curved dagger, sharp blade',
    bow: 'longbow, polished wood'
  },
  armor: {
    // Robes
    cloth_robe: 'simple cloth robe',
    apprentice_robe: 'apprentice wizard robes, basic arcane trim',
    wizard_robe: 'flowing blue wizard robes, arcane symbols',
    archmage_robe: 'ornate archmage robes, powerful enchantments glowing',
    // Armor
    leather_armor: 'brown leather armor, practical',
    chain_mail: 'chain mail armor, metal links',
    plate_armor: 'shining plate armor, full coverage'
  }
};

// =====================
// ENEMY ANIMATION ACTIONS
// =====================

const ENEMY_ANIMATION_ACTIONS = {
  gray_wolf: {
    idle: 'wolf standing alert, ears perked, watching',
    walk: 'wolf prowling forward, hunting stance',
    attack: 'wolf lunging forward, jaws open, biting attack',
    hit: 'wolf recoiling, pain reaction, yelping',
    death: 'wolf collapsing, falling to ground'
  },
  alpha_wolf: {
    idle: 'alpha wolf standing commanding, scarred, glowing eyes',
    walk: 'alpha wolf prowling menacingly, leading pack',
    attack: 'alpha wolf leaping, savage bite attack',
    hit: 'alpha wolf snarling, shaking off blow',
    death: 'alpha wolf falling, final howl'
  },
  goblin_warrior: {
    idle: 'goblin warrior standing guard, sword ready',
    walk: 'goblin warrior marching, aggressive stride',
    attack: 'goblin warrior slashing sword overhead',
    hit: 'goblin warrior staggering back, hit reaction',
    death: 'goblin warrior falling defeated'
  },
  goblin_archer: {
    idle: 'goblin archer crouched, bow ready',
    walk: 'goblin archer sneaking forward, cautious',
    attack: 'goblin archer drawing and releasing arrow',
    hit: 'goblin archer stumbling, dropping bow',
    death: 'goblin archer collapsing, arrows scattering'
  },
  treant: {
    idle: 'treant standing still, branches swaying',
    walk: 'treant lumbering forward, roots moving',
    attack: 'treant sweeping branches, crushing blow',
    hit: 'treant shuddering, bark cracking',
    death: 'treant toppling, falling timber'
  },
  forest_sprite: {
    idle: 'sprite hovering, wings shimmering',
    walk: 'sprite floating forward, trail of sparkles',
    attack: 'sprite casting nature magic, leaves swirling',
    hit: 'sprite flickering, magical shield breaking',
    death: 'sprite fading, dissolving into light'
  },
  spider: {
    idle: 'spider crouched, legs twitching',
    walk: 'spider crawling forward, legs moving',
    attack: 'spider lunging, fangs extended, venom dripping',
    hit: 'spider recoiling, legs curling',
    death: 'spider collapsing, legs curling inward'
  },
  forest_slime: {
    idle: 'slime blob wobbling, gelatinous body pulsing',
    walk: 'slime oozing forward, leaving trail',
    attack: 'slime launching acidic spit, stretching',
    hit: 'slime rippling violently, splashing',
    death: 'slime dissolving, melting into puddle'
  }
};

// =====================
// CHARACTER ANIMATION ACTIONS (BY CLASS)
// =====================

const CHARACTER_ANIMATION_ACTIONS = {
  warrior: {
    idle: 'warrior standing alert, sword and shield ready, defensive stance',
    walk: 'warrior walking forward, heavy armor clanking, shield raised',
    attack: 'warrior powerful sword slash, shield forward, aggressive',
    hit: 'warrior recoiling, shield absorbing blow, staggered',
    death: 'warrior falling to knees, sword dropping, defeated'
  },
  wizard: {
    idle: 'wizard standing calm, staff resting, robes flowing gently',
    walk: 'wizard walking steadily, robes billowing, staff in hand',
    attack: 'wizard casting spell, staff raised high, magical energy burst',
    hit: 'wizard stumbling back, magical shield flicker, stunned',
    death: 'wizard collapsing, robes settling, staff falling, defeated'
  },
  monk: {
    idle: 'monk centered breathing, martial arts stance, focused',
    walk: 'monk light-footed movement, balanced stride, ready',
    attack: 'monk rapid punch combo, ki energy flowing, fierce',
    hit: 'monk nimble dodge attempt, taking hit, recovering',
    death: 'monk graceful collapse, peaceful expression, accepting'
  },
  chemist: {
    idle: 'chemist examining potion flask, curious expression, analyzing',
    walk: 'chemist careful movement, protecting potions, cautious',
    attack: 'chemist throwing potion, arc motion, explosive',
    hit: 'chemist potion splash, chemical spill, stumbling',
    death: 'chemist flask shattering, collapsing, smoke rising'
  }
};

/**
 * Build animation prompt for a character class
 * @param {string} charClass - Character class (warrior, wizard, monk, chemist)
 * @param {string} animation - Animation state (idle, walk, attack, hit, death)
 * @returns {string} Animation action description or null
 */
function buildCharacterAnimationPrompt(charClass, animation) {
  const classActions = CHARACTER_ANIMATION_ACTIONS[charClass];
  if (!classActions) {
    return null;
  }
  return classActions[animation] || classActions.idle;
}

// =====================
// WIZARD ANIMATION ACTIONS (BY RACE)
// =====================

const WIZARD_ANIMATION_ACTIONS = {
  human: {
    idle: 'human wizard standing calm, staff resting, robes flowing gently, focused expression',
    walk: 'human wizard walking steadily, robes billowing, staff in hand, confident stride',
    attack: 'human wizard casting spell, staff raised high, magical energy burst, determined',
    hit: 'human wizard stumbling back, magical shield flicker, stunned expression',
    death: 'human wizard collapsing, robes settling, staff falling, defeated'
  },
  elf: {
    idle: 'elf wizard standing gracefully, staff glowing softly, ethereal presence, pointed ears visible',
    walk: 'elf wizard gliding elegantly, robes flowing, staff trailing magic, light-footed',
    attack: 'elf wizard casting spell, staff blazing, arcane runes orbiting, fierce elegance',
    hit: 'elf wizard recoiling gracefully, magical barrier shimmering, pained expression',
    death: 'elf wizard falling gracefully, robes spreading, staff dimming, serene'
  },
  dwarf: {
    idle: 'dwarf wizard standing sturdy, staff planted firmly, beard braided, runes on armor',
    walk: 'dwarf wizard marching steadily, heavy robes, staff thumping ground, determined',
    attack: 'dwarf wizard casting earth magic, staff erupting power, beard flapping, fierce',
    hit: 'dwarf wizard bracing impact, magical runes flashing, gritting teeth, stubborn',
    death: 'dwarf wizard falling heavily, staff clattering, beard spreading, stoic end'
  },
  vampire: {
    idle: 'vampire wizard standing menacingly, staff pulsing dark energy, crimson eyes glowing',
    walk: 'vampire wizard gliding forward, dark robes trailing, staff leaving shadow wisps',
    attack: 'vampire wizard casting dark magic, staff erupting crimson, fangs bared, sinister',
    hit: 'vampire wizard hissing in pain, dark shield shattering, recoiling dramatically',
    death: 'vampire wizard dissolving into shadows, staff crumbling, dramatic death pose'
  },
  orc: {
    idle: 'orc wizard standing powerfully, staff crackling energy, tusks prominent, intimidating',
    walk: 'orc wizard stomping forward, heavy robes, staff dragging sparks, aggressive',
    attack: 'orc wizard casting primal magic, staff exploding power, roaring, savage power',
    hit: 'orc wizard staggering back, magical barrier breaking, snarling in rage',
    death: 'orc wizard collapsing heavily, staff shattering, final defiant roar'
  }
};

/**
 * Build a complete character prompt with race, class, and equipment
 * @param {string} race - Character race (human, elf, dwarf, vampire, orc)
 * @param {string} charClass - Character class (warrior, wizard, monk, chemist)
 * @param {string} weapon - Weapon key from EQUIPMENT_PROMPTS.weapons
 * @param {string} armor - Armor key from EQUIPMENT_PROMPTS.armor
 * @returns {string} Complete prompt for character generation
 */
function buildEquippedCharacterPrompt(race, charClass, weapon, armor) {
  const raceInfo = RACE_PROMPTS[race] || RACE_PROMPTS.human;
  const weaponDesc = weapon && EQUIPMENT_PROMPTS.weapons[weapon]
    ? EQUIPMENT_PROMPTS.weapons[weapon]
    : 'magical staff';
  const armorDesc = armor && EQUIPMENT_PROMPTS.armor[armor]
    ? EQUIPMENT_PROMPTS.armor[armor]
    : 'wizard robes';

  return `Fantasy ${raceInfo.base} ${charClass}, ${raceInfo.traits}, ` +
    `${raceInfo.skinTone}, wielding ${weaponDesc}, wearing ${armorDesc}, ` +
    `heroic stance, ${STYLE_SUFFIX}`;
}

/**
 * Build animation prompt for a wizard character
 * @param {string} race - Character race
 * @param {string} animation - Animation state (idle, walk, attack, hit, death)
 * @returns {string} Animation prompt
 */
function buildWizardAnimationPrompt(race, animation) {
  const raceActions = WIZARD_ANIMATION_ACTIONS[race] || WIZARD_ANIMATION_ACTIONS.human;
  const raceInfo = RACE_PROMPTS[race] || RACE_PROMPTS.human;
  const action = raceActions[animation] || raceActions.idle;

  return `${action}, ${raceInfo.skinTone}, ${STYLE_SUFFIX}`;
}

/**
 * Build animation prompt for an enemy
 * @param {string} enemyName - Enemy name key
 * @param {string} animation - Animation state (idle, walk, attack, hit, death)
 * @returns {string} Animation prompt
 */
function buildEnemyAnimationPrompt(enemyName, animation) {
  const enemyActions = ENEMY_ANIMATION_ACTIONS[enemyName];
  if (!enemyActions) {
    return null;
  }
  return enemyActions[animation] || enemyActions.idle;
}

// =====================
// ENEMIES BY BIOME
// =====================

const ENEMY_PROMPTS = {
  forest: {
    gray_wolf: `Fierce gray wolf, snarling stance, forest predator, ${STYLE_SUFFIX}`,
    alpha_wolf: `Large alpha wolf, scarred, commanding presence, glowing eyes, ${STYLE_SUFFIX}`,
    goblin_warrior: `Green goblin warrior, crude armor, jagged sword, ${STYLE_SUFFIX}`,
    goblin_archer: `Goblin archer, leather scraps, shortbow, sneaky pose, ${STYLE_SUFFIX}`,
    treant: `Ancient treant, bark armor, glowing green eyes, tree creature, ${STYLE_SUFFIX}`,
    forest_sprite: `Ethereal forest sprite, glowing wings, nature magic, tiny fey, ${STYLE_SUFFIX}`,
    spider: `Giant forest spider, dark chitin, venomous fangs, hairy legs, ${STYLE_SUFFIX}`,
    forest_slime: `Green forest slime, gelatinous blob body, dripping ooze, transparent, ${STYLE_SUFFIX}`
  },
  cave: {
    stone_golem: `Massive stone golem, rocky body, glowing runes, construct, ${STYLE_SUFFIX}`,
    skeleton_warrior: `Armored skeleton warrior, rusted sword and shield, undead, ${STYLE_SUFFIX}`,
    skeleton_mage: `Skeleton mage, tattered robes, purple energy, skull staff, ${STYLE_SUFFIX}`,
    cave_bat: `Giant cave bat, dark fur, red eyes, leathery wings, ${STYLE_SUFFIX}`,
    slime: `Green dungeon slime, gelatinous body, acidic drip, blob, ${STYLE_SUFFIX}`,
    ghost: `Translucent ghost, spectral pale form, haunting presence, ${STYLE_SUFFIX}`
  },
  mountain: {
    mountain_troll: `Massive mountain troll, gray warty skin, wooden club, ${STYLE_SUFFIX}`,
    troll_shaman: `Troll shaman, bone decorations, tribal markings, totems, ${STYLE_SUFFIX}`,
    harpy: `Fierce harpy, feathered wings, taloned feet, shrieking, ${STYLE_SUFFIX}`,
    ice_elemental: `Frost elemental, crystalline ice body, cold blue aura, ${STYLE_SUFFIX}`,
    yeti: `Massive yeti, white fur, icy breath, apex predator, ${STYLE_SUFFIX}`,
    gargoyle: `Stone gargoyle, demonic features, bat wings, perched, ${STYLE_SUFFIX}`
  },
  bridge: {
    bandit_captain: `Human bandit captain, leather armor, dual swords, scarred, ${STYLE_SUFFIX}`,
    bandit_archer: `Bandit archer, hooded cloak, longbow drawn, ${STYLE_SUFFIX}`,
    bandit_rogue: `Bandit rogue, dark cloak, dual daggers, shadowy, ${STYLE_SUFFIX}`,
    mercenary: `Armored mercenary, heavy shield, professional soldier, ${STYLE_SUFFIX}`,
    toll_troll: `Bridge troll, greedy expression, coin bag, blocking, ${STYLE_SUFFIX}`
  },
  bosses: {
    troll_king: `Mighty troll king, bone crown, massive spiked club, boss, ${STYLE_SUFFIX}`,
    frost_wyvern: `Frost wyvern, icy blue scales, frozen breath, wings, ${STYLE_SUFFIX}`,
    dragon: `Ancient dragon, gold and red scales, fire breath, ultimate boss, ${STYLE_SUFFIX}`
  }
};

// =====================
// WORLD MAP NODES
// =====================

const NODE_PROMPTS = {
  castle: `Medieval stone castle, tall towers, red banners, imposing, top-down, ${STYLE_SUFFIX}`,
  city: `Walled medieval city, market square, church spire, bustling, top-down, ${STYLE_SUFFIX}`,
  village: `Small rustic village, thatched cottages, windmill, peaceful, top-down, ${STYLE_SUFFIX}`,
  forest: `Dense enchanted forest, tall trees, mysterious paths, top-down, ${STYLE_SUFFIX}`,
  cave: `Dark cave entrance, rocky formations, torches, crystals, ${STYLE_SUFFIX}`,
  mountain: `Snow-capped mountain peak, rocky cliffs, dramatic, ${STYLE_SUFFIX}`,
  bridge: `Ancient stone bridge, deep chasm, weathered ropes, ${STYLE_SUFFIX}`,
  palace: `Grand royal palace, golden spires, ornate gates, gardens, ${STYLE_SUFFIX}`,
  guild_warrior: `Warriors guild hall, crossed swords banner, training dummies, ${STYLE_SUFFIX}`,
  guild_wizard: `Mages tower, glowing blue crystals, arcane symbols, ${STYLE_SUFFIX}`,
  guild_monk: `Serene monastery, zen garden, martial arts grounds, ${STYLE_SUFFIX}`,
  guild_chemist: `Alchemist workshop, bubbling cauldrons, potion bottles, ${STYLE_SUFFIX}`
};

// =====================
// WORLD MAP BACKDROP TILES (Seamless)
// Prompts optimized for tileable textures - NO focal points, uniform patterns
// =====================

const WORLD_BACKDROP_PROMPTS = {
  world_grass: {
    description: `Seamless grass ground texture, uniform green meadow, NO FOCAL POINT, tileable all edges, continuous pattern, top-down view, fantasy world map, ${STYLE_SUFFIX}`,
    size: 64
  },
  world_forest: {
    description: `Seamless forest canopy texture, green treetops from above, varied shades, NO FOCAL POINT, tileable all edges, continuous pattern, top-down view, ${STYLE_SUFFIX}`,
    size: 64
  },
  world_mountain: {
    description: `Seamless rocky mountain texture, gray stone with snow hints, NO FOCAL POINT, tileable all edges, continuous pattern, top-down view, ${STYLE_SUFFIX}`,
    size: 64
  },
  world_water: {
    description: `Seamless water surface texture, blue with subtle wave pattern, NO FOCAL POINT, tileable all edges, continuous pattern, top-down view, ${STYLE_SUFFIX}`,
    size: 64
  },
  world_desert: {
    description: `Seamless desert sand texture, golden tan dunes, wind ripples, NO FOCAL POINT, tileable all edges, continuous pattern, top-down view, ${STYLE_SUFFIX}`,
    size: 64
  }
};

// Number of variants per backdrop type for visual variety
const BACKDROP_VARIANTS = 4;

// =====================
// WORLD MAP PATH TEXTURES
// Horizontal segments that tile along path length
// =====================

const PATH_TEXTURE_PROMPTS = {
  dirt_road: {
    description: `Horizontal dirt road segment, packed brown earth, wagon ruts, seamless left-right edges, top-down view, ${STYLE_SUFFIX}`,
    width: 32,
    height: 16
  },
  stone_path: {
    description: `Horizontal cobblestone road segment, gray fitted stones, seamless left-right edges, top-down view, ${STYLE_SUFFIX}`,
    width: 32,
    height: 16
  },
  bridge_planks: {
    description: `Horizontal wooden bridge planks, weathered wood boards, seamless left-right edges, top-down view, ${STYLE_SUFFIX}`,
    width: 32,
    height: 16
  }
};

// =====================
// ITEM ICONS
// =====================

const ITEM_PROMPTS = {
  weapons: {
    sword: `Medieval sword, steel blade, leather handle, weapon icon, ${STYLE_SUFFIX}`,
    axe: `Battle axe, sharp steel head, wooden handle, viking, ${STYLE_SUFFIX}`,
    staff: `Wizard staff, wooden shaft, glowing crystal orb, magical, ${STYLE_SUFFIX}`,
    dagger: `Curved dagger, sharp blade, ornate handle, assassin, ${STYLE_SUFFIX}`,
    bow: `Longbow, polished wood, tight string, elven style, ${STYLE_SUFFIX}`
  },
  armor: {
    helmet: `Steel helmet, medieval knight, visor, headgear icon, ${STYLE_SUFFIX}`,
    breastplate: `Steel breastplate, medieval knight, chestpiece icon, ${STYLE_SUFFIX}`,
    boots: `Armored boots, steel plated, leather straps, footwear icon, ${STYLE_SUFFIX}`,
    shield: `Round shield, steel with wood, heraldic design, ${STYLE_SUFFIX}`
  },
  accessories: {
    ring: `Magical ring, gold band, glowing gemstone, enchanted, ${STYLE_SUFFIX}`,
    amulet: `Mystical amulet, gold chain, glowing pendant, ${STYLE_SUFFIX}`,
    cloak: `Flowing cloak, mysterious fabric, hood, magical, ${STYLE_SUFFIX}`
  },
  consumables: {
    potion_red: `Health potion, red liquid, cork stopper, healing, ${STYLE_SUFFIX}`,
    potion_blue: `Mana potion, blue liquid, cork stopper, magic, ${STYLE_SUFFIX}`,
    potion_green: `Stamina potion, green liquid, cork stopper, energy, ${STYLE_SUFFIX}`,
    scroll: `Ancient scroll, rolled parchment, magical runes, ${STYLE_SUFFIX}`
  }
};

// =====================
// MATERIAL & AUGMENT MODIFIERS
// =====================

const MATERIAL_MODIFIERS = {
  copper: 'copper colored, warm orange-brown metal',
  iron: 'dark iron, gray steel, sturdy',
  bronze: 'bronze metal, golden-brown, polished',
  steel: 'shining steel, silver-gray, fine quality',
  silver: 'gleaming silver, ethereal glow',
  gold: 'golden metal, ornate details, luxurious',
  platinum: 'platinum, pale silver-white, noble',
  mythril: 'mythril silver-blue, lightweight, magical shimmer',
  obsidian: 'obsidian black glass, sharp edges',
  adamantine: 'adamantine dark metal, indestructible',
  dragonbone: 'dragon bone white, scale patterns',
  celestial: 'celestial glowing, starlight sparkles, divine'
};

const AUGMENT_MODIFIERS = {
  fire: 'flames emanating, orange fire effects',
  ice: 'frost crystals, icy blue glow',
  lightning: 'electrical sparks, yellow-white lightning',
  life: 'green healing aura, nature energy',
  fortune: 'golden sparkles, lucky charms',
  power: 'red power aura, strength runes',
  wisdom: 'purple arcane glow, knowledge symbols',
  swift: 'motion blur, wind effects, speed lines'
};

const RARITY_MODIFIERS = {
  common: '',
  uncommon: 'subtle green glow',
  rare: 'blue shimmer effect',
  epic: 'purple pulsing aura',
  legendary: 'golden particles, radiant glow'
};

// =====================
// CHARACTER PORTRAITS (64x64 head shots)
// By race, gender, and class
// =====================

const PORTRAIT_GENDER_MODIFIERS = {
  male: {
    human: 'male human, strong jaw, short hair, determined expression',
    elf: 'male elf, pointed ears, angular features, long flowing hair, wise expression',
    dwarf: 'male dwarf, thick braided beard, broad nose, rugged features',
    vampire: 'male vampire, pale skin, fangs visible, crimson eyes, elegant aristocratic features',
    orc: 'male orc, green skin, prominent tusks, battle scars, fierce expression'
  },
  female: {
    human: 'female human, soft features, flowing hair, determined expression',
    elf: 'female elf, pointed ears, delicate features, long graceful hair, serene expression',
    dwarf: 'female dwarf, braided hair with beads, strong features, practical look',
    vampire: 'female vampire, pale skin, fangs visible, crimson eyes, elegant beautiful features',
    orc: 'female orc, green skin, smaller tusks, fierce expression, braided warrior hair'
  },
  other: {
    human: 'androgynous human, neutral features, determined expression',
    elf: 'androgynous elf, pointed ears, ethereal features, mysterious expression',
    dwarf: 'androgynous dwarf, strong features, practical hairstyle with runes',
    vampire: 'androgynous vampire, pale skin, fangs visible, crimson eyes, elegant haunting features',
    orc: 'androgynous orc, green skin, tusks, fierce expression'
  }
};

const PORTRAIT_CLASS_MODIFIERS = {
  warrior: 'wearing warrior helm glimpse, battle-hardened, confident',
  wizard: 'wearing wizard hat hint, arcane knowledge in eyes, thoughtful',
  monk: 'serene centered expression, inner strength, disciplined',
  chemist: 'brass goggles on forehead, curious intelligent expression, vials visible',
  berserker: 'war paint markings, wild fierce eyes, battle rage',
  sorcerer: 'glowing magical eyes, arcane energy visible, powerful',
  ninja: 'face mask pulled down, alert watchful expression, deadly calm',
  alchemist: 'multiple lenses on goggles, chemical stains, brilliant expression'
};

/**
 * Build a portrait prompt for a character
 * @param {string} race - Character race
 * @param {string} gender - Character gender (male, female, other)
 * @param {string} charClass - Character class
 * @returns {string} Portrait generation prompt
 */
function buildPortraitPrompt(race, gender, charClass) {
  const genderPrompts = PORTRAIT_GENDER_MODIFIERS[gender] || PORTRAIT_GENDER_MODIFIERS.other;
  const basePrompt = genderPrompts[race] || genderPrompts.human;
  const classModifier = PORTRAIT_CLASS_MODIFIERS[charClass] || PORTRAIT_CLASS_MODIFIERS.warrior;

  return `Close-up portrait, head and shoulders, ${basePrompt}, ${classModifier}, facing forward, fantasy RPG character portrait, 64x64, ${STYLE_SUFFIX}`;
}

module.exports = {
  STYLE_SUFFIX,
  ISOMETRIC_SUFFIX,
  TERRAIN_STYLE,
  TERRAIN_PROMPTS,
  TILE_CONFIG,
  OBSTACLE_PROMPTS,
  CHARACTER_PROMPTS,
  CHARACTER_ANIMATION_ACTIONS,
  RACE_PROMPTS,
  EQUIPMENT_PROMPTS,
  ENEMY_ANIMATION_ACTIONS,
  WIZARD_ANIMATION_ACTIONS,
  ENEMY_PROMPTS,
  NODE_PROMPTS,
  WORLD_BACKDROP_PROMPTS,
  BACKDROP_VARIANTS,
  PATH_TEXTURE_PROMPTS,
  ITEM_PROMPTS,
  MATERIAL_MODIFIERS,
  AUGMENT_MODIFIERS,
  RARITY_MODIFIERS,
  PORTRAIT_GENDER_MODIFIERS,
  PORTRAIT_CLASS_MODIFIERS,
  // Helper functions
  buildEquippedCharacterPrompt,
  buildCharacterAnimationPrompt,
  buildWizardAnimationPrompt,
  buildEnemyAnimationPrompt,
  buildPortraitPrompt
};
