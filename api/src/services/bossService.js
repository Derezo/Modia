/**
 * Boss Service - Handles multi-phase boss encounters
 *
 * Features:
 * - Phase transition detection based on HP thresholds
 * - Phase-specific ability unlocks
 * - Stat modifications per phase
 * - Phase entry effects (buffs, summons, auras)
 */

import { pool } from '../config/database.js';
import { createBattleSkill } from './npcSkillService.js';

/**
 * Check if an enemy template is a boss
 * @param {Object} template - Enemy template
 * @returns {boolean}
 */
function isBoss(template) {
  return template.is_boss === true && template.phases && template.phases.length > 0;
}

/**
 * Initialize boss state when battle starts
 * @param {Object} enemy - Enemy unit with template data
 * @param {number} battleId - Battle ID
 * @returns {Object} Initialized boss state
 */
function initializeBossState(enemy, battleId) {
  if (!enemy.phases || enemy.phases.length === 0) {
    return null;
  }

  const state = {
    battleId,
    unitId: enemy.id,
    templateId: enemy.templateId,
    currentPhase: 1,
    maxPhases: enemy.phases.length,
    phaseName: enemy.phases[0].name || 'Phase 1',
    phaseThresholds: enemy.phases.map(p => p.threshold),
    baseStats: {
      attack: enemy.attack,
      defense: enemy.defense,
      magicAttack: enemy.magicAttack,
      magicDefense: enemy.magicDefense,
      agility: enemy.agility
    }
  };

  return state;
}

/**
 * Save boss encounter to database
 * @param {Object} state - Boss state
 * @param {Object} options - Persistence options
 * @param {Object|null} options.client - Optional transaction client
 */
async function saveBossEncounter(state, { client = null } = {}) {
  const executor = client ?? pool;
  await executor.query(`
    INSERT INTO boss_encounters (battle_id, enemy_template_id, unit_id, current_phase, max_phases)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (battle_id, unit_id) DO UPDATE SET
      current_phase = EXCLUDED.current_phase,
      phase_triggered_at = CURRENT_TIMESTAMP
  `, [state.battleId, state.templateId, state.unitId, state.currentPhase, state.maxPhases]);
}

/**
 * Check if boss should transition to a new phase
 * @param {Object} boss - Boss unit
 * @param {Object} bossState - Current boss state
 * @returns {Object|null} Phase transition info or null if no transition
 */
function checkPhaseTransition(boss, bossState) {
  if (!bossState || !boss.phases) {
    return null;
  }

  const hpPercent = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  const currentPhaseIndex = bossState.currentPhase - 1;
  const phases = boss.phases;

  // Check each phase after current to see if threshold is crossed
  for (let i = currentPhaseIndex + 1; i < phases.length; i++) {
    const phase = phases[i];
    if (hpPercent <= phase.threshold) {
      return {
        fromPhase: bossState.currentPhase,
        toPhase: i + 1,
        phaseName: phase.name || `Phase ${i + 1}`,
        phaseConfig: phase
      };
    }
  }

  return null;
}

/**
 * Apply phase transition effects to boss
 * @param {Object} boss - Boss unit (modified in place)
 * @param {Object} transition - Phase transition info
 * @param {Object} bossState - Boss state (modified in place)
 * @param {Object} battleState - Full battle state (for summons, etc.)
 * @returns {Object} Effects that occurred during transition
 */
function applyPhaseTransition(boss, transition, bossState, _battleState) {
  const effects = {
    phaseName: transition.phaseName,
    fromPhase: transition.fromPhase,
    toPhase: transition.toPhase,
    statChanges: {},
    newAbilities: [],
    entryEffects: [],
    summons: []
  };

  const phase = transition.phaseConfig;

  // Update boss state
  bossState.currentPhase = transition.toPhase;
  bossState.phaseName = transition.phaseName;

  // Apply stat modifications
  if (phase.statMods) {
    for (const [stat, multiplier] of Object.entries(phase.statMods)) {
      const baseStat = bossState.baseStats[stat] || 0;
      const newValue = Math.floor(baseStat * multiplier);
      effects.statChanges[stat] = { from: boss[stat], to: newValue };
      boss[stat] = newValue;
    }
  }

  // Unlock new abilities
  if (phase.abilities && phase.abilities.length > 0) {
    const newSkills = phase.abilities
      .filter(skillId => !boss.skills.some(s => s.id === skillId))
      .map(skillId => createBattleSkillFromId(skillId, boss.level));

    for (const skill of newSkills) {
      if (skill) {
        boss.skills.push(skill);
        effects.newAbilities.push(skill.name);
      }
    }
  }

  // Apply entry effects
  if (phase.onEnter) {
    if (phase.onEnter.effect) {
      // Apply a status effect to the boss
      const statusEffect = {
        type: phase.onEnter.effect,
        duration: phase.onEnter.duration || 3,
        source: 'phase_transition'
      };
      boss.statusEffects = boss.statusEffects || [];
      boss.statusEffects.push(statusEffect);
      effects.entryEffects.push({
        type: 'buff',
        effect: phase.onEnter.effect,
        duration: phase.onEnter.duration
      });
    }

    if (phase.onEnter.summon) {
      // Mark that summons should occur (handled by battle service)
      effects.summons.push({
        templateName: phase.onEnter.summon,
        count: phase.onEnter.count || 1
      });
    }

    if (phase.onEnter.aura) {
      // Apply persistent aura effect
      boss.aura = {
        type: phase.onEnter.aura,
        damagePerTurn: phase.onEnter.damagePerTurn || 0
      };
      effects.entryEffects.push({
        type: 'aura',
        aura: phase.onEnter.aura,
        damage: phase.onEnter.damagePerTurn
      });
    }
  }

  console.log(`[BossService] ${boss.name} transitioned to ${transition.phaseName}`);

  return effects;
}

/**
 * Create a battle skill from a skill ID by looking up in npc_skill_templates
 * @param {string} skillId - Skill ID to look up
 * @param {number} level - Enemy level for scaling
 * @returns {Object|null} Battle-ready skill or null if not found
 */
function createBattleSkillFromId(skillId, level) {
  // Import skill data from config (synchronous fallback)
  const SKILL_DATA = getSkillDataById(skillId);

  if (!SKILL_DATA) {
    console.warn(`[BossService] Skill not found: ${skillId}`);
    return null;
  }

  return createBattleSkill(SKILL_DATA, Math.floor(level * 0.4) + 1);
}

/**
 * Get skill data by ID from monster skill trees
 * @param {string} skillId - Skill ID
 * @returns {Object|null} Skill definition
 */
function getSkillDataById(skillId) {
  // Dynamic import would be async, so we use a synchronous lookup
  // This is populated from monsterSkillTrees.js and guild skill trees

  // Common skills mapping (subset for boss abilities)
  const BOSS_SKILLS = {
    // Plant skills
    plant_vine_lash: { id: 'plant_vine_lash', name: 'Vine Lash', power: 90, range: 2, damageType: 'physical' },
    plant_entangle: { id: 'plant_entangle', name: 'Entangle', power: 60, range: 3, mpCost: 10, damageType: 'physical', effect: 'immobilize', effectChance: 0.65, aoeRadius: 1 },
    plant_regenerate: { id: 'plant_regenerate', name: 'Regenerate', range: 0, mpCost: 10, healPercent: 15 },
    plant_thorn_volley: { id: 'plant_thorn_volley', name: 'Thorn Volley', power: 100, range: 4, mpCost: 8, damageType: 'physical', effect: 'bleed', effectChance: 0.3 },
    plant_spore_cloud: { id: 'plant_spore_cloud', name: 'Spore Cloud', power: 80, range: 0, mpCost: 12, damageType: 'poison', effect: 'poison', effectChance: 0.55, aoeRadius: 2 },

    // Construct/Troll skills
    construct_slam: { id: 'construct_slam', name: 'Slam', power: 120, range: 1, damageType: 'physical', effect: 'stun', effectChance: 0.25 },
    construct_ground_pound: { id: 'construct_ground_pound', name: 'Ground Pound', power: 100, range: 1, mpCost: 8, damageType: 'physical', effect: 'knockdown', effectChance: 0.45, aoeRadius: 1 },
    construct_demolish: { id: 'construct_demolish', name: 'Demolish', power: 180, range: 1, mpCost: 20, damageType: 'physical', effect: 'stun', effectChance: 0.35 },

    // Beast skills
    beast_howl: { id: 'beast_howl', name: 'Howl', range: 0, mpCost: 5, damageType: 'support', selfBuff: { attack: 1.2 }, aoeRadius: 2 },
    beast_frenzy: { id: 'beast_frenzy', name: 'Frenzy', power: 80, range: 1, mpCost: 15, damageType: 'physical', selfBuff: { attack: 1.5, defense: 0.7 }, buffDuration: 3 },

    // Undead skills
    undead_bone_strike: { id: 'undead_bone_strike', name: 'Bone Strike', power: 100, range: 1, damageType: 'physical' },
    undead_life_drain: { id: 'undead_life_drain', name: 'Life Drain', power: 100, range: 2, mpCost: 10, damageType: 'dark', effect: 'drain' },
    undead_raise_dead: { id: 'undead_raise_dead', name: 'Raise Dead', range: 3, mpCost: 30, damageType: 'summon' },
    undead_necrotic_burst: { id: 'undead_necrotic_burst', name: 'Necrotic Burst', power: 120, range: 3, mpCost: 20, damageType: 'dark', effect: 'curse', effectChance: 0.5, aoeRadius: 2 },
    undead_soul_rend: { id: 'undead_soul_rend', name: 'Soul Rend', power: 130, range: 2, mpCost: 15, damageType: 'dark', effect: 'mp_drain', effectChance: 0.6 }
  };

  return BOSS_SKILLS[skillId] || null;
}

/**
 * Process damage dealt to a boss and check for phase transitions
 * @param {Object} boss - Boss unit
 * @param {Object} bossState - Boss state
 * @param {number} damage - Damage dealt
 * @param {Object} battleState - Full battle state
 * @returns {Object|null} Phase transition effects or null
 */
function processBossDamage(boss, bossState, damage, battleState) {
  if (!bossState) return null;

  const transition = checkPhaseTransition(boss, bossState);
  if (transition) {
    return applyPhaseTransition(boss, transition, bossState, battleState);
  }

  return null;
}

/**
 * Check all bosses in battle state for phase transitions.
 * Iterates over all living bosses and applies any triggered transitions.
 * @param {Object} battleState - Full battle state with bossStates and units
 * @returns {Array<Object>} Array of phase transition effects (one per boss that transitioned)
 */
function checkAllBossTransitions(battleState) {
  if (!battleState.bossStates) return [];

  const transitions = [];

  for (const [unitId, bossState] of Object.entries(battleState.bossStates)) {
    const boss = battleState.units.find(u => String(u.id) === String(unitId));
    if (!boss || boss.hp <= 0) continue;

    const transition = checkPhaseTransition(boss, bossState);
    if (transition) {
      const effects = applyPhaseTransition(boss, transition, bossState, battleState);
      if (effects) {
        transitions.push({
          unitId,
          bossName: boss.name,
          ...effects
        });
      }
    }
  }

  return transitions;
}

/**
 * Get boss state from battle state
 * @param {Object} battleState - Battle state
 * @param {string} unitId - Unit ID
 * @returns {Object|null} Boss state or null
 */
function getBossState(battleState, unitId) {
  if (!battleState.bossStates) return null;
  return battleState.bossStates[unitId] || null;
}

/**
 * Apply boss aura damage to all enemies at start of boss turn
 * @param {Object} boss - Boss unit with aura
 * @param {Object} battleState - Battle state
 * @returns {Array} Damage applied to each unit
 */
function applyAuraDamage(boss, battleState) {
  if (!boss.aura || !boss.aura.damagePerTurn) return [];

  const damages = [];
  const targetType = boss.type === 'enemy' ? 'player' : 'enemy';

  for (const unit of battleState.units) {
    if (unit.type === targetType && unit.hp > 0) {
      const damage = boss.aura.damagePerTurn;
      unit.hp = Math.max(0, unit.hp - damage);
      damages.push({
        unitId: unit.id,
        damage,
        auraType: boss.aura.type
      });
    }
  }

  return damages;
}

/**
 * Clean up boss encounter when battle ends
 * @param {number} battleId - Battle ID
 * @param {Object} options - Persistence options
 * @param {Object|null} options.client - Optional transaction client
 */
async function cleanupBossEncounter(battleId, { client = null } = {}) {
  const executor = client ?? pool;
  await executor.query('DELETE FROM boss_encounters WHERE battle_id = $1', [battleId]);
}

/**
 * Get phase display info for frontend
 * @param {Object} boss - Boss unit
 * @param {Object} bossState - Boss state
 * @returns {Object} Phase info for UI
 */
function getPhaseDisplayInfo(boss, bossState) {
  if (!bossState || !boss.phases) {
    return null;
  }

  return {
    name: boss.name,
    currentPhase: bossState.currentPhase,
    maxPhases: bossState.maxPhases,
    phaseName: bossState.phaseName,
    phaseThresholds: boss.phases.map(p => p.threshold),
    isBoss: true
  };
}

export {
  isBoss,
  initializeBossState,
  checkPhaseTransition,
  applyPhaseTransition,
  processBossDamage,
  checkAllBossTransitions,
  getBossState,
  applyAuraDamage,
  cleanupBossEncounter,
  getPhaseDisplayInfo,
  saveBossEncounter
};

export default {
  isBoss,
  initializeBossState,
  checkPhaseTransition,
  applyPhaseTransition,
  processBossDamage,
  checkAllBossTransitions,
  getBossState,
  applyAuraDamage,
  cleanupBossEncounter,
  getPhaseDisplayInfo,
  saveBossEncounter
};
