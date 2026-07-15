/**
 * Skill Effect Categories - Visual effect configurations for skill animations
 *
 * Each category defines a color palette and particle configuration that
 * determines how skills of that type are rendered visually.
 */

/**
 * Visual effect category configurations
 * Each category has:
 * - name: Display name
 * - colors: { primary, secondary, tertiary } - Color palette
 * - flashColor: Color for initial impact flash
 * - particleCount: Number of particles to spawn
 * - particleStyle: 'burst', 'orbit', 'rise', 'fall', 'swirl'
 * - trailEnabled: Whether projectiles leave trails
 */
export const SKILL_EFFECT_CATEGORIES = {
  fire: {
    name: 'Fire',
    colors: {
      primary: '#ff4400',
      secondary: '#ffaa00',
      tertiary: '#ff6600'
    },
    flashColor: '#ff4400',
    particleCount: 12,
    particleStyle: 'burst',
    trailEnabled: true,
    glowColor: 'rgba(255, 68, 0, 0.4)'
  },

  ice: {
    name: 'Ice',
    colors: {
      primary: '#88ccff',
      secondary: '#ffffff',
      tertiary: '#4488cc'
    },
    flashColor: '#88ccff',
    particleCount: 10,
    particleStyle: 'fall',
    trailEnabled: true,
    glowColor: 'rgba(136, 204, 255, 0.4)'
  },

  lightning: {
    name: 'Lightning',
    colors: {
      primary: '#ffff44',
      secondary: '#ffffff',
      tertiary: '#88aaff'
    },
    flashColor: '#ffff88',
    particleCount: 8,
    particleStyle: 'burst',
    trailEnabled: false,
    glowColor: 'rgba(255, 255, 68, 0.5)'
  },

  physical: {
    name: 'Physical',
    colors: {
      primary: '#cc8844',
      secondary: '#ffffff',
      tertiary: '#aa6622'
    },
    flashColor: '#ffddaa',
    particleCount: 6,
    particleStyle: 'burst',
    trailEnabled: false,
    glowColor: 'rgba(204, 136, 68, 0.3)'
  },

  healing: {
    name: 'Healing',
    colors: {
      primary: '#44ff88',
      secondary: '#88ffaa',
      tertiary: '#22cc66'
    },
    flashColor: '#88ffaa',
    particleCount: 10,
    particleStyle: 'rise',
    trailEnabled: false,
    glowColor: 'rgba(68, 255, 136, 0.4)'
  },

  buff: {
    name: 'Buff',
    colors: {
      primary: '#ffdd44',
      secondary: '#ffffff',
      tertiary: '#ffaa22'
    },
    flashColor: '#ffdd88',
    particleCount: 8,
    particleStyle: 'rise',
    trailEnabled: false,
    glowColor: 'rgba(255, 221, 68, 0.4)'
  },

  debuff: {
    name: 'Debuff',
    colors: {
      primary: '#8844aa',
      secondary: '#aa66cc',
      tertiary: '#662288'
    },
    flashColor: '#8844aa',
    particleCount: 8,
    particleStyle: 'fall',
    trailEnabled: false,
    glowColor: 'rgba(136, 68, 170, 0.4)'
  },

  selfAura: {
    name: 'Self Aura',
    colors: {
      primary: '#44aaff',
      secondary: '#88ccff',
      tertiary: '#2288cc'
    },
    flashColor: '#88ccff',
    particleCount: 8,
    particleStyle: 'orbit',
    trailEnabled: false,
    glowColor: 'rgba(68, 170, 255, 0.4)'
  },

  poison: {
    name: 'Poison',
    colors: {
      primary: '#66cc44',
      secondary: '#88ff66',
      tertiary: '#448822'
    },
    flashColor: '#88cc66',
    particleCount: 10,
    particleStyle: 'rise',
    trailEnabled: true,
    glowColor: 'rgba(102, 204, 68, 0.4)'
  },

  holy: {
    name: 'Holy',
    colors: {
      primary: '#ffff88',
      secondary: '#ffffff',
      tertiary: '#ffdd44'
    },
    flashColor: '#ffffaa',
    particleCount: 12,
    particleStyle: 'rise',
    trailEnabled: true,
    glowColor: 'rgba(255, 255, 136, 0.5)'
  },

  shadow: {
    name: 'Shadow',
    colors: {
      primary: '#442266',
      secondary: '#664488',
      tertiary: '#221144'
    },
    flashColor: '#442266',
    particleCount: 10,
    particleStyle: 'swirl',
    trailEnabled: true,
    glowColor: 'rgba(68, 34, 102, 0.5)'
  },

  earth: {
    name: 'Earth',
    colors: {
      primary: '#886644',
      secondary: '#aa8866',
      tertiary: '#664422'
    },
    flashColor: '#aa8866',
    particleCount: 8,
    particleStyle: 'burst',
    trailEnabled: false,
    glowColor: 'rgba(136, 102, 68, 0.3)'
  },

  wind: {
    name: 'Wind',
    colors: {
      primary: '#aaccaa',
      secondary: '#ccffcc',
      tertiary: '#88aa88'
    },
    flashColor: '#ccffcc',
    particleCount: 12,
    particleStyle: 'swirl',
    trailEnabled: true,
    glowColor: 'rgba(170, 204, 170, 0.3)'
  },

  water: {
    name: 'Water',
    colors: {
      primary: '#4488ff',
      secondary: '#88bbff',
      tertiary: '#2266cc'
    },
    flashColor: '#88bbff',
    particleCount: 10,
    particleStyle: 'fall',
    trailEnabled: true,
    glowColor: 'rgba(68, 136, 255, 0.4)'
  },

  dark: {
    name: 'Dark',
    colors: {
      primary: '#aa66cc',
      secondary: '#cc88ee',
      tertiary: '#663388'
    },
    flashColor: '#aa66cc',
    particleCount: 10,
    particleStyle: 'swirl',
    trailEnabled: true,
    glowColor: 'rgba(170, 102, 204, 0.5)'
  }
};

/**
 * Maps consumable item effectTypes to visual effect categories and colors.
 * Used by BattleAnimations to determine which particle effects to play for item use.
 */
export const ITEM_EFFECT_VISUAL_MAP = {
  heal_hp: {
    category: 'healing',
    primaryColor: '#44ff88',
    orbColor: '#44ff88'
  },
  heal_mp: {
    category: 'selfAura',
    primaryColor: '#44aaff',
    orbColor: '#44aaff'
  },
  heal_both: {
    category: 'holy',
    primaryColor: '#ffff88',
    orbColor: '#ffdd44'
  },
  cure_poison: {
    category: 'wind',
    primaryColor: '#aaccaa',
    orbColor: '#88cc88'
  },
  cure_all: {
    category: 'buff',
    primaryColor: '#ffdd44',
    orbColor: '#ffdd44'
  },
  revive: {
    category: 'holy',
    primaryColor: '#ffff88',
    orbColor: '#ffffaa'
  }
};

const ELEMENT_CATEGORY_MAP = Object.freeze({
  fire: 'fire',
  flame: 'fire',
  ice: 'ice',
  frost: 'ice',
  lightning: 'lightning',
  electric: 'lightning',
  thunder: 'lightning',
  water: 'water',
  earth: 'earth',
  wind: 'wind',
  air: 'wind',
  holy: 'holy',
  light: 'holy',
  shadow: 'shadow',
  dark: 'dark',
  darkness: 'dark',
  void: 'dark',
  poison: 'poison',
  nature: 'poison',
  physical: 'physical'
});

function normalizeVisualToken(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveCategoryKey(value) {
  const normalized = normalizeVisualToken(value);
  return Object.keys(SKILL_EFFECT_CATEGORIES).find(
    category => category.toLowerCase() === normalized
  ) || null;
}

/**
 * Get visual category for a skill based on its properties
 * Priority: explicit visualCategory > inferred from effect > inferred from damageType > default
 * @param {Object} skill - Skill definition object
 * @returns {string} Category name (fire, ice, lightning, etc.)
 */
export function getVisualCategory(skill) {
  if (!skill) return 'physical';

  // 1. Explicit category takes precedence
  const explicitCategory = resolveCategoryKey(skill.visualCategory);
  if (explicitCategory) {
    return explicitCategory;
  }

  // 2. Element is the most specific mechanical presentation signal.
  const element = normalizeVisualToken(skill.element);
  if (ELEMENT_CATEGORY_MAP[element]) {
    return ELEMENT_CATEGORY_MAP[element];
  }

  // 3. Infer from status effect. Support both skill definitions and action
  // result payloads; the latter expose applied effects through skillEffects.
  const firstEffect = skill.skillEffects?.[0] ?? skill.effects?.[0] ?? null;
  const effectValue = typeof skill.effect === 'string'
    ? skill.effect
    : skill.effect?.effect || skill.effect?.type ||
      skill.effectApplied || skill.statusApplied ||
      (typeof firstEffect === 'string' ? firstEffect : firstEffect?.effect || firstEffect?.status);
  const effectType = typeof skill.effect === 'object'
    ? skill.effect?.type
    : (typeof firstEffect === 'object' ? firstEffect?.type : null);
  if (effectValue) {
    const effectMap = {
      burn: 'fire',
      freeze: 'ice',
      slow: 'ice',
      stun: 'lightning',
      poison: 'poison',
      bleed: 'physical',
      blind: 'debuff',
      silence: 'debuff',
      corrode: 'poison',
      marked: 'debuff',
      taunt: 'debuff',
      haste: 'buff'
    };
    const normalizedEffect = normalizeVisualToken(effectValue);
    if (effectMap[normalizedEffect]) {
      return effectMap[normalizedEffect];
    }
  }

  const effectTypeMap = {
    buff: 'buff',
    debuff: 'debuff',
    cleanse: 'selfAura',
    heal: 'healing',
    healing: 'healing'
  };
  const normalizedEffectType = normalizeVisualToken(effectType);
  if (effectTypeMap[normalizedEffectType]) {
    return effectTypeMap[normalizedEffectType];
  }

  // 4. Infer from skill/result properties.
  if (skill.healing || skill.healPercent || skill.targetAlly || skill.targetAllAllies) {
    return 'healing';
  }

  if (skill.selfBuff || skill.targetSelf || skill.cleanse) {
    return 'selfAura';
  }

  // 5. Infer from damage type
  if (normalizeVisualToken(skill.damageType) === 'magical') {
    return 'holy'; // Generic magical default
  }

  // 6. Default to physical
  return 'physical';
}

/**
 * Resolve the full skill definition associated with an action result.
 * Player results historically use `skillUsed`; observer/AI results use
 * `skillId`, so both are accepted during the normalized-event migration.
 */
export function resolveActionSkill(actor, result = {}, requestedSkillId = null) {
  const skillId = requestedSkillId || result.skillId || result.skillUsed || null;
  const skills = Array.isArray(actor?.skills) ? actor.skills : [];
  const skill = skills.find(candidate =>
    (candidate?.id || candidate?.skillId || candidate?.skill_id) === skillId
  ) || null;
  return skill ? { ...skill, id: skillId } : (skillId ? { id: skillId } : null);
}

/**
 * Build the presentation descriptor shared by local HTTP and observer
 * WebSocket action paths.
 */
export function getActionVisualDescriptor(actionType, result = {}, skill = null) {
  const presentationSource = {
    ...(skill || {}),
    ...(result || {}),
    visualCategory: result.visualCategory ?? skill?.visualCategory,
    element: result.element ?? skill?.element,
    damageType: result.damageType ?? skill?.damageType,
    effect: result.effect ?? skill?.effect
  };
  const category = getVisualCategory(presentationSource);
  const config = SKILL_EFFECT_CATEGORIES[category] || SKILL_EFFECT_CATEGORIES.physical;
  // An AoE can legitimately include its caster as the primary/center target.
  // That does not turn the area cast into a self aura.
  const selfTarget = isSelfTargetingSkill(presentationSource) ||
    (!result.isAoE && result.targetId != null && result.targetId === result.actorId);
  const isSkill = actionType === 'skill';
  const explicitlyPhysical = normalizeVisualToken(presentationSource.damageType) === 'physical' &&
    category === 'physical';
  const explicitProjectile = presentationSource.projectile ??
    presentationSource.isProjectile ?? presentationSource.rangedProjectile;

  return {
    category,
    actorAnimation: presentationSource.actorAnimation ||
      (isSkill && !explicitlyPhysical ? 'cast' : 'attack'),
    projectile: Boolean(
      isSkill && !selfTarget &&
      (explicitProjectile == null ? config.trailEnabled : explicitProjectile)
    ),
    selfTarget,
    trailEnabled: Boolean(config.trailEnabled),
    primaryColor: config.colors.primary,
    glowColor: config.glowColor,
    element: presentationSource.element || null
  };
}

/**
 * Get the category configuration for a skill
 * @param {Object} skill - Skill definition object
 * @returns {Object} Category configuration
 */
export function getSkillEffectConfig(skill) {
  const categoryName = getVisualCategory(skill);
  return SKILL_EFFECT_CATEGORIES[categoryName] || SKILL_EFFECT_CATEGORIES.physical;
}

/**
 * Get a random color from a category's palette
 * @param {string} categoryName - Category name
 * @returns {string} Random color from the category
 */
export function getRandomCategoryColor(categoryName) {
  const config = SKILL_EFFECT_CATEGORIES[categoryName] || SKILL_EFFECT_CATEGORIES.physical;
  const colors = [config.colors.primary, config.colors.secondary, config.colors.tertiary];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Check if a skill is self-targeting
 * @param {Object} skill - Skill definition object
 * @returns {boolean} True if skill targets self
 */
export function isSelfTargetingSkill(skill) {
  return !!(
    skill.targetSelf ||
    skill.selfBuff ||
    skill.cleanse ||
    (skill.healPercent && !skill.targetAlly && !skill.targetAllAllies && skill.range === 0)
  );
}
