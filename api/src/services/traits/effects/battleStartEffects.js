/**
 * Battle Start Effects
 *
 * These effects are applied once when a unit enters battle.
 * They modify base stats like HP, MP, movement, and attack range.
 */

import { registerEffectHandler, EFFECT_PHASES } from '../traitEffectRegistry.js';

/**
 * Register all battle-start effect handlers
 */
export function initBattleStartEffects() {
  // HP Bonus - Percentage increase to max HP
  registerEffectHandler('hp_bonus', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Percentage increase to max HP',
    apply(unit, effectValue) {
      const bonusHP = Math.floor(unit.maxHp * effectValue);
      unit.maxHp += bonusHP;
      unit.hp += bonusHP;
      return { type: 'stat_bonus', stat: 'hp', amount: bonusHP };
    }
  });

  // MP Bonus - Percentage increase to max MP
  registerEffectHandler('mp_bonus', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Percentage increase to max MP',
    apply(unit, effectValue) {
      const bonusMP = Math.floor(unit.maxMp * effectValue);
      unit.maxMp += bonusMP;
      unit.mp += bonusMP;
      return { type: 'stat_bonus', stat: 'mp', amount: bonusMP };
    }
  });

  // HP+MP Bonus - Percentage increase to both
  registerEffectHandler('hp_mp_bonus', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Percentage increase to both HP and MP',
    apply(unit, effectValue) {
      const bonusHP = Math.floor(unit.maxHp * effectValue);
      const bonusMP = Math.floor(unit.maxMp * effectValue);
      unit.maxHp += bonusHP;
      unit.hp += bonusHP;
      unit.maxMp += bonusMP;
      unit.mp += bonusMP;
      return { type: 'stat_bonus', stat: 'hp_mp', hpAmount: bonusHP, mpAmount: bonusMP };
    }
  });

  // Movement Bonus - Flat increase to movement tiles
  registerEffectHandler('movement_bonus', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Adds tiles to movement range',
    apply(unit, effectValue) {
      const bonus = Math.floor(effectValue);
      unit.movement = (unit.movement || 3) + bonus;
      return { type: 'stat_bonus', stat: 'movement', amount: bonus };
    }
  });

  // Range Bonus - Flat increase to attack range (e.g., Eagle Eye trait)
  registerEffectHandler('range_bonus', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Adds tiles to attack range',
    apply(unit, effectValue) {
      const bonus = Math.floor(effectValue);
      unit.attackRange = (unit.attackRange || 1) + bonus;
      return { type: 'stat_bonus', stat: 'attackRange', amount: bonus };
    }
  });

  // Initiative Bonus - Turn order priority
  registerEffectHandler('initiative_bonus', {
    phase: EFFECT_PHASES.BATTLE_START,
    description: 'Bonus to turn order initiative',
    apply(unit, effectValue) {
      // Initiative affects CT accumulation rate
      unit.initiativeBonus = (unit.initiativeBonus || 0) + effectValue;
      return { type: 'stat_bonus', stat: 'initiative', amount: effectValue };
    }
  });

  console.log('[TraitEffects] Battle start effects registered');
}
