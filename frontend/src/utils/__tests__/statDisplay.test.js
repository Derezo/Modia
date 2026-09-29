import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  formatStatName,
  formatStatValue,
  formatStatAmount,
  formatAugmentEffect,
  calculateStatChanges,
  normalizeRarity,
  sumItemStats,
  calculateItemPower,
  resolveAugmentIconName,
  AUGMENT_ICON_FILES,
  describeAugment,
  isAugmentEffectActive,
  matchesEquipmentSlot,
  getEquipRestriction
} from '../statDisplay.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const iconDir = size => join(repoRoot, 'frontend', 'public', 'assets', 'icons', 'png', String(size), 'augments');

describe('formatStatName / formatStatValue', () => {
  it('abbreviates snake_case resource keys without truncation artefacts', () => {
    assert.equal(formatStatName('hp_max', true), 'Max HP');
    assert.equal(formatStatName('mp_max', true), 'Max MP');
    assert.equal(formatStatName('luck', true), 'LCK');
    assert.equal(formatStatName('crit_chance', true), 'CRIT');
    assert.equal(formatStatName('crit_chance'), 'Critical Chance');
  });

  it('renders boolean flags as labels, never "+true"', () => {
    assert.equal(formatStatValue('fishing_tackle', true), 'Fishing Tackle');
    assert.equal(formatStatValue('fishing_tackle', false), '');
    assert.equal(formatStatAmount('fishing_tackle', true), '');
  });

  it('formats fractional percent stats as percentages', () => {
    assert.equal(formatStatValue('wait_reduction', 0.15), 'Bite Wait Reduction +15%');
    assert.equal(formatStatValue('crit_chance', 0.05, true), '+5% CRIT');
  });

  it('keeps the existing signed formats', () => {
    assert.equal(formatStatValue('strength', 5), 'Strength +5');
    assert.equal(formatStatValue('strength', 5, true), '+5 STR');
    assert.equal(formatStatValue('vitality', -2), 'Vitality -2');
  });
});

describe('formatAugmentEffect', () => {
  it('reads the rolled value of a stat_bonus instance augment', () => {
    const aug = { key: 'swiftness', name: 'of Swiftness', stat: 'agility', value: 9, effect: { stat: 'agility', type: 'stat_bonus' } };
    assert.equal(formatAugmentEffect(aug), '+9 Agility');
  });

  it('still supports template bonus ranges', () => {
    const aug = { stat: 'luck', bonus: [2, 6], effect: { type: 'stat_bonus', stat: 'luck' } };
    assert.equal(formatAugmentEffect(aug), '+6 Luck');
  });

  it('never returns "undefined" or "NaN" text', () => {
    const noValue = { name: 'of Fortune', effect: { type: 'stat_bonus', stat: 'luck' } };
    assert.equal(formatAugmentEffect(noValue), 'of Fortune');
    const noPercent = { name: 'Blazing', effect: { type: 'fire_damage' } };
    assert.equal(formatAugmentEffect(noPercent), 'Blazing');
  });

  it('formats mp_regen without a duration as a percentage', () => {
    assert.equal(formatAugmentEffect({ effect: { type: 'mp_regen', value: 0.03 } }), '+3% MP regeneration');
  });
});

describe('describeAugment', () => {
  it('labels the effect with the affix name and its rolled stat', () => {
    const aug = { name: 'Venomous', stat: 'luck', value: 4, effect: { type: 'poison_chance', value: 0.05 } };
    const d = describeAugment(aug);
    assert.equal(d.text, 'Venomous: 5% chance to poison (Luck +4)');
    assert.equal(d.active, false);
  });

  it('does not repeat the stat for stat_bonus augments', () => {
    const aug = { name: 'of Fortune', stat: 'luck', value: 4, effect: { stat: 'luck', type: 'stat_bonus' } };
    const d = describeAugment(aug);
    assert.equal(d.text, 'of Fortune: +4 Luck');
    assert.equal(isAugmentEffectActive(aug), true);
  });
});

describe('sumItemStats', () => {
  it('adds bonus stats to base stats sharing a key', () => {
    const item = { baseStats: { agility: 3, vitality: 9 }, bonusStats: { luck: 6, vitality: 7 } };
    assert.deepEqual(sumItemStats(item), { agility: 3, vitality: 16, luck: 6 });
  });

  it('includes attack/defense only when asked', () => {
    const item = { attack: 4, baseStats: { strength: 2 } };
    assert.deepEqual(sumItemStats(item), { strength: 2 });
    assert.deepEqual(sumItemStats(item, { includeCombat: true }), { attack: 4, strength: 2 });
    assert.equal(calculateItemPower(item), 6);
  });

  it('feeds calculateStatChanges with summed values', () => {
    const current = { baseStats: { vitality: 9 } };
    const next = { baseStats: { vitality: 9 }, bonusStats: { vitality: 7 } };
    assert.deepEqual(calculateStatChanges(current, next), [{ stat: 'vitality', oldValue: 9, newValue: 16, diff: 7 }]);
  });
});

describe('normalizeRarity', () => {
  it('maps numeric, numeric-string and mixed-case rarities', () => {
    assert.equal(normalizeRarity(4), 'epic');
    assert.equal(normalizeRarity('5'), 'legendary');
    assert.equal(normalizeRarity('Rare'), 'rare');
    assert.equal(normalizeRarity(undefined), 'common');
    assert.equal(normalizeRarity('bogus'), 'common');
  });
});

describe('resolveAugmentIconName', () => {
  it('lists exactly the augment icon files on disk', () => {
    const files = readdirSync(iconDir(32)).filter(f => f.endsWith('.webp')).map(f => f.replace(/\.webp$/, ''));
    assert.deepEqual([...AUGMENT_ICON_FILES].sort(), files.sort());
  });

  it('maps every augment category and effect type from itemDropService to an existing icon', () => {
    const source = readFileSync(join(repoRoot, 'api', 'src', 'services', 'itemDropService.js'), 'utf8');
    const categories = [...source.matchAll(/category:\s*'([a-z_-]+)'/g)].map(m => m[1]);
    const types = [...source.matchAll(/type:\s*'([a-z_]+)'/g)].map(m => m[1]);
    assert.ok(categories.length > 20, 'expected to find augment categories');
    for (const size of [16, 24, 32]) {
      const onDisk = new Set(readdirSync(iconDir(size)).map(f => f.replace(/\.webp$/, '')));
      for (const name of [...new Set([...categories, ...types])]) {
        const resolved = resolveAugmentIconName(name);
        assert.ok(onDisk.has(resolved), `${name} -> ${resolved} missing at ${size}px`);
      }
    }
  });

  it('maps slayers to kebab-case files and falls back gracefully', () => {
    assert.equal(resolveAugmentIconName('dragon_slayer'), 'dragon-slayer');
    assert.equal(resolveAugmentIconName({ category: 'potency' }), 'damage_boost');
    assert.equal(resolveAugmentIconName({ effect: { type: 'fire_damage' } }), 'fire');
    assert.equal(resolveAugmentIconName('totally_unknown'), 'power');
    assert.equal(resolveAugmentIconName(null), 'power');
  });
});

describe('equipment rules', () => {
  it('matches armor and accessories to their template slot exactly', () => {
    const helm = { type: 'armor', equipmentSlot: 'head' };
    assert.equal(matchesEquipmentSlot(helm, 'head'), true);
    assert.equal(matchesEquipmentSlot(helm, 'legs'), false);
    assert.equal(matchesEquipmentSlot({ type: 'accessory', equipmentSlot: 'accessory' }, 'accessory'), true);
  });

  it('lets main_hand weapons go in either hand but off_hand only in off_hand', () => {
    assert.equal(matchesEquipmentSlot({ type: 'weapon', equipmentSlot: 'main_hand' }, 'off_hand'), true);
    assert.equal(matchesEquipmentSlot({ type: 'weapon', equipmentSlot: 'off_hand' }, 'main_hand'), false);
    assert.equal(matchesEquipmentSlot({ type: 'weapon', equipmentSlot: 'main_hand' }, 'head'), false);
  });

  it('explains level and class restrictions', () => {
    const item = { level_requirement: 15, class_restriction: ['warrior'] };
    assert.equal(getEquipRestriction(item, { level: 3, class: 'warrior' }), 'Requires Lv 15');
    assert.equal(getEquipRestriction(item, { level: 20, class: 'mage' }), 'Warrior only');
    assert.equal(getEquipRestriction(item, { level: 20, class: 'Warrior' }), null);
  });
});

describe('stat display order and material chip', async () => {
  const { orderStats, getDisplayMaterial } = await import('../statDisplay.js');

  it('orders stats STR/AGI/INT/VIT/LCK after pools', () => {
    const ordered = orderStats({ luck: 1, vitality: 2, strength: 3, intelligence: 4, hp_max: 5, agility: 6 });
    assert.deepEqual(Object.keys(ordered), ['hp_max', 'strength', 'agility', 'intelligence', 'vitality', 'luck']);
    assert.deepEqual(Object.keys(sumItemStats({ baseStats: { luck: 1, strength: 2 } })), ['strength', 'luck']);
  });

  it('hides a rolled material that the item name contradicts', () => {
    assert.equal(getDisplayMaterial({ name: 'Exalted Leather Helm of Warding', material: 'iron' }), null);
    assert.equal(getDisplayMaterial({ name: 'Divine Blessed Iron Axe', material: 'iron' }), 'Iron');
    assert.equal(getDisplayMaterial({ name: 'Plain Thing' }), null);
  });
});
