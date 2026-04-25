/**
 * Lore Content System
 *
 * Provides thematic discovery text for world exploration nodes.
 * Since lore_keys are position-based (lore_X_Y), content is generated
 * based on region race and node name for variety.
 *
 * Each region has its own collection of lore fragments that paint a picture
 * of the world's history, inhabitants, and mysteries.
 */

/**
 * Regional lore pools - each race has themed discoveries
 * Array of { title, text } entries that are procedurally selected
 */
export const REGIONAL_LORE = {
  human: [
    {
      title: 'Chronicles of the Heartlands',
      text: 'Crumbling parchments detail the founding of the Heartlands. The first settlers arrived three centuries past, fleeing a cataclysm in distant lands. They found fertile soil and built their castles upon ancient foundations, never questioning what lay beneath.'
    },
    {
      title: 'The Farmer\'s Almanac',
      text: 'A weathered tome records generations of harvests. Between crop yields and weather patterns, cryptic notes warn of "the years when shadows walk" and advise keeping iron above every doorway. The last entry abruptly ends mid-sentence.'
    },
    {
      title: 'Merchant\'s Lost Ledger',
      text: 'This leather-bound ledger lists trade routes connecting all five regions. Margins contain hand-drawn maps to hidden caches and notes about "the old roads that still remember." Several pages have been torn out.'
    },
    {
      title: 'The King\'s Decree',
      text: 'A royal proclamation forbids travel beyond the Third Ring after sunset. The wax seal bears an unfamiliar crest, and the decree references dangers that "even our strongest knights cannot face alone." No date is visible.'
    },
    {
      title: 'Pilgrim\'s Prayer Book',
      text: 'Prayers to forgotten gods fill these yellowed pages. One passage speaks of "the Convergence" when all shrines align and the veil between worlds grows thin. The faithful are instructed to seek shelter during such times.'
    },
    {
      title: 'Blacksmith\'s Secret',
      text: 'Hidden beneath forge stones, this journal describes metallurgical techniques lost to modern craftsmen. The author claims their weapons could "pierce the hide of shadow beasts" but warns the knowledge must never reach "those who dwell below."'
    },
    {
      title: 'The Watchtower Reports',
      text: 'Guard reports spanning decades document strange lights in distant mountains and unexplained disappearances near region borders. Each report is stamped "CLASSIFIED" yet somehow ended up here, far from any archive.'
    },
    {
      title: 'Healer\'s Memoirs',
      text: 'A physician documents treating wounds from "creatures that should not exist." The clinical descriptions give way to philosophical musings about the nature of the world and whether the five regions are truly all that remains of civilization.'
    }
  ],

  elf: [
    {
      title: 'Whispers of the Elder Trees',
      text: 'The ancient oaks remember when the world was young. Their rings tell of great fires and floods, of wars between powers long forgotten. The elves learned to listen, and in listening, gained wisdom that outlasts empires.'
    },
    {
      title: 'The Starlight Codex',
      text: 'Elvish astronomers mapped constellations that guided travelers for millennia. This fragment describes a "missing star" that vanished during the Age of Shadows. Its return, the text warns, will herald the Awakening.'
    },
    {
      title: 'Memories of the First Grove',
      text: 'Before the regions were divided, a single forest spanned the entire world. The elves tended it as sacred ground. When the Sundering came, they retreated to Sylvan Reaches, the last echo of that verdant paradise.'
    },
    {
      title: 'The Moonwell Records',
      text: 'Crystal-clear pools once dotted the elvish lands, conduits of pure magical energy. Most have dried or been corrupted. This tablet describes their locations and the rituals needed to restore them.'
    },
    {
      title: 'Song of the Lost Kingdom',
      text: 'Inscribed on silver leaves, this ballad mourns a kingdom beneath the waves. The elves remember their drowned cousins with ceremony and song, believing their spirits still swim in underwater palaces.'
    },
    {
      title: 'The Fey Compact',
      text: 'An ancient treaty written in languages that shift as you read them. The elves made bargains with beings from the realm between worlds. Some clauses appear to be coming due, judging by the dates.'
    },
    {
      title: 'Treatise on Living Magic',
      text: 'Unlike the dwarven forge-craft or human alchemy, elvish magic flows from life itself. This scroll explains techniques for channeling natural energies, warning that misuse creates "wounds in the world that never heal."'
    },
    {
      title: 'Chronicle of the Long Winter',
      text: 'Three centuries ago, a winter lasted seven years. The elves survived by entering a dream-state, their bodies sustained by the trees. When they woke, the world had changed. They do not speak of what changed it.'
    }
  ],

  dwarf: [
    {
      title: 'The Deep Cartography',
      text: 'These maps chart tunnels extending far below the Iron Depths. Notations warn of collapsed sections, flooded chambers, and passages marked simply as "SEALED - DO NOT OPEN." The lowest levels remain blank, labeled "Unknown."'
    },
    {
      title: 'Forge-Master\'s Testament',
      text: 'The greatest dwarven smith left instructions for creating weapons of legend. The process requires metals found only in the deepest mines and flames that "remember the world\'s birth." Few have dared attempt it.'
    },
    {
      title: 'The Mithril Veins',
      text: 'Precious mithril runs through the earth like blood through veins. This survey documents the richest deposits, but also records miners who heard "singing from the stone" before disappearing into new-found passages.'
    },
    {
      title: 'History of the Under-Wars',
      text: 'Long before surface conflicts, dwarves battled creatures in the deep places. This chronicle details campaigns against things that "consumed light itself." Victory came at great cost, and the deepest reaches were abandoned.'
    },
    {
      title: 'Ancestral Hall Inscriptions',
      text: 'Names of every dwarf who fell defending the Iron Depths fill these halls. Among them are heroes who held "the breach" for decades, ensuring whatever lurked below could never reach the upper tunnels.'
    },
    {
      title: 'The Rune Compendium',
      text: 'Dwarven runes do more than record words - they bind power into stone and steel. This fragment teaches protective wards, though it warns that some runes "attract attention from those who should not see."'
    },
    {
      title: 'Mining Guild Records',
      text: 'Production reports reveal a troubling pattern: the deeper the mines, the stranger the ore. Some metals defy classification, possessing properties that shift with the phases of the moon or the position of stars.'
    },
    {
      title: 'The Earth-Shaper\'s Confession',
      text: 'A master engineer admits to reshaping the very mountains to seal something within. The work took generations and cost thousands of lives, but "the dreaming one must never wake." No map shows what was buried.'
    }
  ],

  vampire: [
    {
      title: 'The Crimson Archives',
      text: 'These blood-inked pages chronicle the vampire lords who ruled before the current age. Their powers grew too great, their hungers too vast. The Covenant was formed not to protect mortals, but to prevent their own extinction.'
    },
    {
      title: 'Shadows of the First Night',
      text: 'When darkness first touched the world, it chose vessels to carry its essence. The vampires emerged not as monsters, but as guardians of the boundary between life and death. Somewhere along the centuries, they forgot.'
    },
    {
      title: 'The Blood Pact',
      text: 'An agreement between vampire houses defines territories, feeding rights, and forbidden practices. Hidden clauses reveal alliances with beings from realms of eternal night, promises not yet called due.'
    },
    {
      title: 'Memoirs of the Deathless',
      text: 'A vampire elder reflects on centuries of existence. They speak of watching civilizations rise and fall, of friends who aged and died, of the terrible clarity that comes with eternal life: nothing truly ends.'
    },
    {
      title: 'The Moon\'s Shadow',
      text: 'Lunar cycles affect vampire power in ways they rarely discuss. During the dark moon, passages open between Shadowmere and somewhere else. What crosses over is never quite the same as what crosses back.'
    },
    {
      title: 'Necropolis Blueprints',
      text: 'Beneath the surface lie vast underground cities built to shelter vampires from the sun. These plans show chambers filled with sleeping elders, waiting for a time when the world "remembers its true nature."'
    },
    {
      title: 'The Thrall Rebellion',
      text: 'A century ago, the living servants of vampire lords rose in revolt. The suppression was swift and total, but this account suggests some escaped with secrets that could threaten the undying aristocracy.'
    },
    {
      title: 'Covenant of Shadows',
      text: 'The formal agreement that binds all vampire houses. Its terms seem simple: no vampire may make a claim upon another\'s domain. But annotations reveal loopholes wide enough to drive entire armies through.'
    }
  ],

  orc: [
    {
      title: 'War-Chief\'s Chronicle',
      text: 'Generations of battle records fill these bound hides. Each victory and defeat is analyzed with surprising tactical depth. The orcs learned long ago that strength alone does not win wars - wisdom in battle does.'
    },
    {
      title: 'The Blood Plains Origin',
      text: 'The red soil of the Bloodplains was not always so. An ancient text describes a cataclysmic battle that soaked the earth so deeply with blood that it never recovered. The spirits of the fallen still march on moonless nights.'
    },
    {
      title: 'Shaman\'s Secret Texts',
      text: 'Orc magic differs from elvish sorcery or dwarven rune-craft. It calls upon ancestral spirits and the raw power of conflict itself. These scrolls teach rituals that "wake the warrior within" but warn of the price of failure.'
    },
    {
      title: 'The Great Migration',
      text: 'The orcs were not always of the Bloodplains. This oral history, finally transcribed, tells of their exodus from a "land of ice and darkness" where something hunted them. They fled until they found land worth defending.'
    },
    {
      title: 'Forge of the War-Gods',
      text: 'Deep in the mountains, ancient forges still burn. The orcs discovered them already lit, already producing weapons of terrifying power. Who built them, and why they were abandoned, remains a mystery best left unsolved.'
    },
    {
      title: 'The Honor Code',
      text: 'Complex rules govern orc warfare. Battles may be brutal, but they follow ancient laws. This tablet explains the challenges, duels, and rituals that prevent total war and preserve orcish culture from self-destruction.'
    },
    {
      title: 'Songs of the Fallen',
      text: 'Orc bards sing of heroes who died gloriously in battle. But between the verses, subtle warnings: those who die in certain places, or fighting certain enemies, do not find rest. Their spirits are claimed by something else.'
    },
    {
      title: 'The Warlord\'s Map',
      text: 'This strategic map shows the Bloodplains and surrounding territories. Red marks indicate contested zones, black marks denote "cursed ground," and a single golden mark shows something labeled only as "the objective."'
    }
  ]
};

/**
 * Generic lore for when region is unknown or for variety
 */
export const GENERIC_LORE = [
  {
    title: 'The Wanderer\'s Journal',
    text: 'A traveler\'s account of crossing between regions, documenting strange phenomena at the borders. Reality seems thinner there, they write, and sometimes one can glimpse places that don\'t exist on any map.'
  },
  {
    title: 'Map of the Lost',
    text: 'This fragmentary map shows locations that no longer exist - or perhaps never did. Yet explorers report finding ruins in the marked positions, structures that predate all known civilizations.'
  },
  {
    title: 'The Convergence Prophecy',
    text: 'An ancient seer predicted a time when all regions would face a common threat. The signs include "stars falling upward" and "shadows that remember." Some believe the prophecy has already begun to unfold.'
  },
  {
    title: 'Letter to a Lost Love',
    text: 'A heartbreaking letter that was never delivered. Between the personal sentiments, the writer describes fleeing some catastrophe, urging their beloved to "seek the high places" when "the deep roads open."'
  },
  {
    title: 'The Artifact Catalog',
    text: 'A collector\'s inventory of mysterious objects gathered from across all five regions. Each entry includes sketches, measurements, and unsettling notes about items that "move when not observed" or "whisper at midnight."'
  },
  {
    title: 'Explorer\'s Final Entry',
    text: 'The last pages of an explorer\'s logbook. They describe finding something wonderful and terrible beneath the surface, a discovery that would "change everything." The writing becomes increasingly erratic before stopping entirely.'
  },
  {
    title: 'The Zodiac Alignment',
    text: 'Astronomical calculations predict when all twelve zodiac shrines will align. According to these figures, the last alignment occurred a thousand years ago. The next is far closer than anyone suspects.'
  },
  {
    title: 'Covenant of the Five',
    text: 'A treaty signed by representatives of all five races, establishing the current order. Hidden clauses reveal mutual defense pacts against "threats from below and beyond." Each signatory pledged resources for a purpose left unspecified.'
  }
];

/**
 * Era names for lore context
 */
export const ERAS = {
  ancient: 'Age of Legends',
  old: 'Age of Kings',
  recent: 'Age of Strife',
  current: 'Age of Renewal'
};

/**
 * Get lore content for a discovery node
 *
 * Uses lore_key coordinates and region to deterministically select thematic content.
 * The same lore_key will always return the same content (seeded by coordinate hash).
 *
 * @param {string} loreKey - The lore key (format: 'lore_X_Y')
 * @param {string} fallbackName - Node name to use if no specific lore found
 * @param {string} regionRace - The race of the region ('human', 'elf', 'dwarf', 'vampire', 'orc')
 * @returns {Object} Lore content with title, text, region, and era
 */
export function getLoreContent(loreKey, fallbackName = 'Unknown Location', regionRace = null) {
  // Parse coordinates from lore_key for deterministic selection
  const coords = parseLoreKey(loreKey);
  const hash = coords ? simpleHash(coords.x, coords.y) : simpleHash(0, 0);

  // Select lore pool based on region
  const pool = getRegionalPool(regionRace);

  // Deterministically select from pool based on coordinate hash
  const index = Math.abs(hash) % pool.length;
  const selectedLore = pool[index];

  // Determine era based on position (outer = older lore)
  const distance = coords ? Math.sqrt(coords.x * coords.x + coords.y * coords.y) : 0;
  const era = distance > 35 ? ERAS.ancient
    : distance > 25 ? ERAS.old
    : distance > 15 ? ERAS.recent
    : ERAS.current;

  return {
    title: selectedLore.title,
    text: selectedLore.text,
    region: getRegionDisplayName(regionRace),
    era,
    lore_key: loreKey
  };
}

/**
 * Parse lore_key to extract coordinates
 * @param {string} loreKey - Format 'lore_X_Y'
 * @returns {Object|null} { x, y } or null if invalid
 */
function parseLoreKey(loreKey) {
  if (!loreKey || typeof loreKey !== 'string') return null;

  const match = loreKey.match(/^lore_(\d+)_(\d+)$/);
  if (!match) return null;

  return {
    x: parseInt(match[1], 10),
    y: parseInt(match[2], 10)
  };
}

/**
 * Simple hash function for deterministic selection
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {number} Hash value
 */
function simpleHash(x, y) {
  // Combine coordinates into a single hash
  let h = 2166136261; // FNV offset basis
  h ^= x;
  h = Math.imul(h, 16777619);
  h ^= y;
  h = Math.imul(h, 16777619);
  return h >>> 0; // Ensure positive
}

/**
 * Get the lore pool for a given region race
 * @param {string|null} regionRace - Race identifier
 * @returns {Array} Array of lore entries
 */
function getRegionalPool(regionRace) {
  if (regionRace && REGIONAL_LORE[regionRace]) {
    // Mix regional lore with some generic entries for variety
    return [...REGIONAL_LORE[regionRace], ...GENERIC_LORE.slice(0, 3)];
  }
  return GENERIC_LORE;
}

/**
 * Get display name for region based on race
 * @param {string|null} regionRace - Race identifier
 * @returns {string} Display name
 */
function getRegionDisplayName(regionRace) {
  const regionNames = {
    human: 'Heartlands',
    elf: 'Sylvan Reaches',
    dwarf: 'Iron Depths',
    vampire: 'Shadowmere',
    orc: 'Bloodplains'
  };
  return regionNames[regionRace] || 'Unknown Region';
}

/**
 * Get all available lore keys for a region (for testing/documentation)
 * @param {string} regionRace - Race identifier
 * @returns {Array} Array of lore entry titles
 */
export function getRegionalLoreTitles(regionRace) {
  if (!regionRace || !REGIONAL_LORE[regionRace]) {
    return GENERIC_LORE.map(l => l.title);
  }
  return REGIONAL_LORE[regionRace].map(l => l.title);
}

/**
 * Validate that all lore entries have required fields
 * @returns {Object} Validation result with any errors
 */
export function validateLoreContent() {
  const errors = [];

  // Check regional lore
  for (const [race, entries] of Object.entries(REGIONAL_LORE)) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.title || typeof entry.title !== 'string' || entry.title.length === 0) {
        errors.push(`${race}[${i}]: missing or empty title`);
      }
      if (!entry.text || typeof entry.text !== 'string' || entry.text.length === 0) {
        errors.push(`${race}[${i}]: missing or empty text`);
      }
    }
  }

  // Check generic lore
  for (let i = 0; i < GENERIC_LORE.length; i++) {
    const entry = GENERIC_LORE[i];
    if (!entry.title || typeof entry.title !== 'string' || entry.title.length === 0) {
      errors.push(`generic[${i}]: missing or empty title`);
    }
    if (!entry.text || typeof entry.text !== 'string' || entry.text.length === 0) {
      errors.push(`generic[${i}]: missing or empty text`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      human: REGIONAL_LORE.human.length,
      elf: REGIONAL_LORE.elf.length,
      dwarf: REGIONAL_LORE.dwarf.length,
      vampire: REGIONAL_LORE.vampire.length,
      orc: REGIONAL_LORE.orc.length,
      generic: GENERIC_LORE.length,
      total: Object.values(REGIONAL_LORE).reduce((sum, arr) => sum + arr.length, 0) + GENERIC_LORE.length
    }
  };
}
