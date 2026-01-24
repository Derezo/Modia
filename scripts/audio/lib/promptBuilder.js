/**
 * Prompt Builder for Audio Generation
 * Constructs prompts for Suno (music) and ElevenLabs (SFX) based on game data
 */

// Region theme definitions for music generation
const REGION_THEMES = {
  heartlands: {
    name: 'Heartlands',
    race: 'Human',
    mood: 'noble, adventurous, hopeful',
    instruments: 'orchestral strings, brass fanfares, heroic horns',
    style: 'medieval fantasy, triumphant, warm',
    terrain: 'rolling hills, castles, villages'
  },
  sylvan_reaches: {
    name: 'Sylvan Reaches',
    race: 'Elf',
    mood: 'mystical, serene, ancient wisdom',
    instruments: 'ethereal flutes, harps, soft strings, wind chimes',
    style: 'elven fantasy, flowing, graceful',
    terrain: 'ancient forests, glowing groves, moonlit clearings'
  },
  iron_depths: {
    name: 'Iron Depths',
    race: 'Dwarf',
    mood: 'industrious, sturdy, determined',
    instruments: 'heavy percussion, anvil strikes, deep brass, war drums',
    style: 'dwarven forge, rhythmic, powerful',
    terrain: 'deep mines, underground halls, forges'
  },
  shadowmere: {
    name: 'Shadowmere',
    race: 'Vampire',
    mood: 'dark, gothic, mysterious, dangerous',
    instruments: 'pipe organ, harpsichord, minor strings, choir',
    style: 'gothic horror, haunting, elegant',
    terrain: 'dark castles, foggy crypts, moonless nights'
  },
  bloodplains: {
    name: 'Bloodplains',
    race: 'Orc',
    mood: 'fierce, tribal, primal, warlike',
    instruments: 'war drums, tribal percussion, aggressive brass, battle horns',
    style: 'barbaric fantasy, intense, savage',
    terrain: 'volcanic mountains, war camps, scorched earth'
  }
};

// Skill category SFX templates
const SKILL_SFX_TEMPLATES = {
  fire: {
    prefix: 'fantasy game sound effect',
    elements: ['crackling flames', 'whooshing fire', 'explosion', 'burning embers'],
    suffix: 'magical fire attack',
    variations: ['intense fireball', 'spreading flames', 'fiery burst']
  },
  ice: {
    prefix: 'fantasy game sound effect',
    elements: ['crystalline shattering', 'freezing wind', 'icy crackle', 'frost forming'],
    suffix: 'magical ice attack',
    variations: ['ice spike', 'freezing blast', 'blizzard wind']
  },
  lightning: {
    prefix: 'fantasy game sound effect',
    elements: ['electric crackle', 'thunder boom', 'static discharge', 'arc zap'],
    suffix: 'magical lightning attack',
    variations: ['thunderbolt strike', 'chain lightning', 'electric shock']
  },
  physical: {
    prefix: 'fantasy game sound effect',
    elements: ['metal clash', 'blade swing', 'impact thud', 'armor clang'],
    suffix: 'melee combat attack',
    variations: ['sword slash', 'heavy blow', 'crushing strike']
  },
  healing: {
    prefix: 'fantasy game sound effect',
    elements: ['gentle chimes', 'sparkling magic', 'soft glow', 'restoring energy'],
    suffix: 'healing magic spell',
    variations: ['light restoration', 'divine healing', 'recovery pulse']
  },
  buff: {
    prefix: 'fantasy game sound effect',
    elements: ['empowering surge', 'rising energy', 'magical enhancement', 'strength boost'],
    suffix: 'positive buff spell',
    variations: ['power up', 'shield activation', 'stat boost']
  },
  debuff: {
    prefix: 'fantasy game sound effect',
    elements: ['weakening pulse', 'draining energy', 'curse whisper', 'debilitating effect'],
    suffix: 'negative debuff spell',
    variations: ['curse application', 'weakness spell', 'slowing hex']
  },
  selfAura: {
    prefix: 'fantasy game sound effect',
    elements: ['surrounding energy', 'aura emanation', 'protective hum', 'self-buff activation'],
    suffix: 'self-targeting aura spell',
    variations: ['defensive aura', 'power aura', 'protective barrier']
  },
  poison: {
    prefix: 'fantasy game sound effect',
    elements: ['bubbling acid', 'toxic hiss', 'venomous drip', 'corrosive splash'],
    suffix: 'poison damage effect',
    variations: ['toxic cloud', 'acid spray', 'venom strike']
  },
  holy: {
    prefix: 'fantasy game sound effect',
    elements: ['divine light', 'celestial choir', 'radiant burst', 'holy power'],
    suffix: 'holy magic attack',
    variations: ['smite', 'divine judgment', 'purifying light']
  },
  shadow: {
    prefix: 'fantasy game sound effect',
    elements: ['dark whisper', 'shadow creep', 'void energy', 'darkness spreading'],
    suffix: 'dark magic attack',
    variations: ['shadow bolt', 'dark pulse', 'void strike']
  },
  earth: {
    prefix: 'fantasy game sound effect',
    elements: ['rumbling ground', 'stone crack', 'boulder impact', 'earthquake tremor'],
    suffix: 'earth magic attack',
    variations: ['rock throw', 'earthquake', 'stone spike']
  },
  wind: {
    prefix: 'fantasy game sound effect',
    elements: ['rushing wind', 'air blade', 'tornado whoosh', 'cutting gust'],
    suffix: 'wind magic attack',
    variations: ['wind slash', 'gale force', 'air cutter']
  },
  water: {
    prefix: 'fantasy game sound effect',
    elements: ['water splash', 'wave crash', 'bubbling stream', 'torrential rush'],
    suffix: 'water magic attack',
    variations: ['water jet', 'tidal wave', 'aqua blast']
  }
};

// Battle music mood modifiers
const BATTLE_MOODS = {
  normal: {
    tempo: 'moderate',
    intensity: 'building tension',
    style: 'tactical combat'
  },
  boss: {
    tempo: 'fast and intense',
    intensity: 'epic and dramatic',
    style: 'climactic boss battle'
  },
  victory: {
    tempo: 'triumphant fanfare',
    intensity: 'celebratory',
    style: 'heroic victory'
  },
  defeat: {
    tempo: 'slow and somber',
    intensity: 'melancholic',
    style: 'tragic loss'
  }
};

/**
 * Build a music generation prompt from track config and optional region theme
 * @param {Object} trackConfig - Track configuration
 * @param {string} trackConfig.name - Track name/identifier
 * @param {string} trackConfig.type - Track type (exploration, battle, ambient, etc.)
 * @param {string} [trackConfig.mood] - Override mood
 * @param {string} [trackConfig.instruments] - Override instruments
 * @param {string} [trackConfig.style] - Override style
 * @param {string} [trackConfig.description] - Additional description
 * @param {string|Object} [regionTheme] - Region key or theme object
 * @returns {Object} Prompt and tags for Suno generation
 */
function buildMusicPrompt(trackConfig, regionTheme = null) {
  // Resolve region theme if string key provided
  const region = typeof regionTheme === 'string'
    ? REGION_THEMES[regionTheme.toLowerCase().replace(/\s+/g, '_')]
    : regionTheme;

  // Determine battle mood if applicable
  const battleMood = trackConfig.battleType ? BATTLE_MOODS[trackConfig.battleType] : null;

  // Build prompt components
  const components = [];

  // Style/genre
  components.push('instrumental fantasy RPG game music');

  // Track type context
  if (trackConfig.type === 'exploration') {
    components.push('exploration theme for traveling through');
  } else if (trackConfig.type === 'battle') {
    components.push(`${battleMood?.style || 'combat'} battle music`);
    components.push(battleMood?.tempo || 'dynamic tempo');
    components.push(battleMood?.intensity || 'building intensity');
  } else if (trackConfig.type === 'ambient') {
    components.push('ambient background music');
  } else if (trackConfig.type === 'menu') {
    components.push('menu theme music');
  }

  // Region flavor
  if (region) {
    components.push(`${region.terrain}`);
    components.push(`${region.mood} atmosphere`);
  }

  // Instruments
  const instruments = trackConfig.instruments || (region?.instruments);
  if (instruments) {
    components.push(`featuring ${instruments}`);
  }

  // Style
  const style = trackConfig.style || (region?.style);
  if (style) {
    components.push(style);
  }

  // Mood override
  if (trackConfig.mood) {
    components.push(trackConfig.mood);
  }

  // Additional description
  if (trackConfig.description) {
    components.push(trackConfig.description);
  }

  // Build tags
  const tags = [];
  tags.push('instrumental');
  tags.push('game music');
  tags.push('fantasy');

  if (trackConfig.type === 'battle') {
    tags.push('epic');
    tags.push('orchestral');
    if (battleMood?.tempo === 'fast and intense') {
      tags.push('intense');
    }
  } else if (trackConfig.type === 'exploration') {
    tags.push('ambient');
    tags.push('atmospheric');
  }

  if (region) {
    tags.push(region.race.toLowerCase());
  }

  return {
    prompt: components.join('. '),
    tags: tags.join(', '),
    title: trackConfig.name || 'Untitled Track'
  };
}

/**
 * Build an SFX prompt from skill configuration and category template
 * @param {Object} skill - Skill configuration
 * @param {string} skill.name - Skill name
 * @param {string} skill.category - Skill category (fire, ice, physical, etc.)
 * @param {string} [skill.description] - Skill description
 * @param {number} [skill.power] - Skill power level (affects intensity)
 * @param {boolean} [skill.isAoE] - Is area of effect
 * @param {Object} [templates] - Override templates (defaults to SKILL_SFX_TEMPLATES)
 * @returns {Object} Prompt configuration for ElevenLabs
 */
function buildSkillSFXPrompt(skill, templates = SKILL_SFX_TEMPLATES) {
  const category = skill.category?.toLowerCase() || 'physical';
  const template = templates[category] || templates.physical;

  // Determine intensity based on power
  let intensity = 'moderate';
  if (skill.power >= 150) {
    intensity = 'powerful and impactful';
  } else if (skill.power >= 120) {
    intensity = 'strong';
  } else if (skill.power <= 60) {
    intensity = 'subtle and quick';
  }

  // Pick a variation or use first one
  const variation = template.variations[
    Math.floor(Math.random() * template.variations.length)
  ];

  // Build prompt
  const promptParts = [
    template.prefix,
    intensity,
    template.elements.slice(0, 2).join(' with '),
    template.suffix
  ];

  if (skill.isAoE) {
    promptParts.push('with area impact');
  }

  if (skill.description) {
    promptParts.push(`- ${skill.description}`);
  }

  // Determine duration based on skill type
  let duration = 2; // Default
  if (skill.isAoE) {
    duration = 3;
  } else if (skill.power >= 150) {
    duration = 2.5;
  } else if (skill.power <= 60) {
    duration = 1.5;
  }

  return {
    prompt: promptParts.join(', '),
    duration: skill.duration || duration,
    category: category,
    skillName: skill.name,
    variation: variation
  };
}

/**
 * Build a combat SFX prompt (hits, misses, criticals)
 * @param {string} type - Combat event type
 * @param {Object} [options] - Options
 * @returns {Object} Prompt configuration
 */
function buildCombatSFXPrompt(type, options = {}) {
  const combatTemplates = {
    hit: {
      prompt: 'fantasy game sound effect, weapon impact, metal on armor clash, satisfying hit',
      duration: 0.5
    },
    miss: {
      prompt: 'fantasy game sound effect, weapon swing through air, whoosh, near miss',
      duration: 0.4
    },
    critical: {
      prompt: 'fantasy game sound effect, powerful critical hit, devastating impact, armor shatter, dramatic',
      duration: 0.8
    },
    block: {
      prompt: 'fantasy game sound effect, shield block, metal clang, defensive deflection',
      duration: 0.5
    },
    parry: {
      prompt: 'fantasy game sound effect, sword parry, blade sliding, skilled deflection',
      duration: 0.4
    },
    death: {
      prompt: 'fantasy game sound effect, enemy defeat, body fall, combat end',
      duration: 1.0
    }
  };

  const template = combatTemplates[type] || combatTemplates.hit;

  return {
    prompt: template.prompt,
    duration: options.duration || template.duration,
    type: type
  };
}

/**
 * Build an ambient sound prompt
 * Uses proper 0-1 comma pattern per AUDIO_STYLE_GUIDE.md
 * Pattern: "[Fantasy context] [adjective] [adjective] [core sound noun] with [secondary quality]"
 * @param {string} environment - Environment type
 * @param {Object} [options] - Options
 * @returns {Object} Prompt configuration
 */
function buildAmbientPrompt(environment, options = {}) {
  const ambientTemplates = {
    forest: {
      prompt: 'Fantasy enchanted forest with rustling leaves and soft birdsong chorus',
      duration: 10
    },
    cave: {
      prompt: 'Fantasy deep underground cavern with echoing water drips and distant rumbles',
      duration: 10
    },
    mountain: {
      prompt: 'Fantasy exposed mountain peak with howling wind gusts and cold desolation',
      duration: 10
    },
    castle: {
      prompt: 'Fantasy grand palace hall with distant footsteps echoing on marble',
      duration: 10
    },
    tavern: {
      prompt: 'Fantasy cozy tavern atmosphere with murmuring crowd and crackling fireplace warmth',
      duration: 10
    },
    battle: {
      prompt: 'Fantasy distant battle sounds with clashing swords and war cries',
      duration: 8
    },
    shop: {
      prompt: 'Fantasy busy merchant shop with clinking coins and quiet marketplace activity',
      duration: 10
    },
    fishing: {
      prompt: 'Fantasy peaceful riverside with gentle lapping water and distant birdsong',
      duration: 10
    },
    ruins: {
      prompt: 'Fantasy ancient stone ruins with eerie echoing drips and mysterious atmosphere',
      duration: 10
    }
  };

  const template = ambientTemplates[environment] || ambientTemplates.forest;

  return {
    prompt: template.prompt,
    duration: options.duration || template.duration,
    environment: environment,
    type: 'ambient'
  };
}

/**
 * Build a UI sound prompt
 * @param {string} action - UI action type
 * @returns {Object} Prompt configuration
 */
function buildUISFXPrompt(action) {
  const uiTemplates = {
    button_click: {
      prompt: 'UI click sound, soft button press, satisfying tap, game menu',
      duration: 0.1
    },
    button_hover: {
      prompt: 'UI hover sound, subtle highlight, soft tone, menu selection',
      duration: 0.08
    },
    menu_open: {
      prompt: 'UI menu open, paper unfold, parchment slide, medieval interface',
      duration: 0.3
    },
    menu_close: {
      prompt: 'UI menu close, paper fold, soft whoosh, interface dismiss',
      duration: 0.2
    },
    notification: {
      prompt: 'UI notification, gentle chime, attention sound, positive alert',
      duration: 0.3
    },
    error: {
      prompt: 'UI error sound, negative feedback, soft warning tone, mistake',
      duration: 0.3
    },
    success: {
      prompt: 'UI success sound, positive chime, achievement, completion',
      duration: 0.4
    },
    level_up: {
      prompt: 'level up fanfare, triumphant jingle, achievement unlocked, celebration',
      duration: 1.5
    },
    item_pickup: {
      prompt: 'item pickup sound, collecting treasure, loot acquired, satisfying grab',
      duration: 0.3
    },
    gold_coins: {
      prompt: 'gold coins sound, money jingle, treasure acquired, coin clink',
      duration: 0.4
    }
  };

  const template = uiTemplates[action] || uiTemplates.button_click;

  return {
    prompt: template.prompt,
    duration: template.duration,
    action: action,
    type: 'ui'
  };
}

module.exports = {
  buildMusicPrompt,
  buildSkillSFXPrompt,
  buildCombatSFXPrompt,
  buildAmbientPrompt,
  buildUISFXPrompt,
  REGION_THEMES,
  SKILL_SFX_TEMPLATES,
  BATTLE_MOODS
};
