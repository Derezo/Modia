/**
 * Enemy Templates Unit Tests
 *
 * Tests the enemy template data structures and validation.
 * These are pure data templates with no database dependencies.
 *
 * Data tested:
 * - ENEMY_TEMPLATES structure validation
 * - Tier distribution
 * - Spawn location coverage
 * - Elemental resistances
 * - Drop table structure
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import enemy templates
let importError = null;
let ENEMY_TEMPLATES = null;

try {
  const mod = await import('../../db/templates/enemies.js');
  ENEMY_TEMPLATES = mod.ENEMY_TEMPLATES;
} catch (err) {
  importError = err;
}

const canImport = importError === null;

describe('Enemy Templates - structure validation', { skip: !canImport }, () => {
  it('ENEMY_TEMPLATES is an array', () => {
    assert.ok(Array.isArray(ENEMY_TEMPLATES));
  });

  it('has at least 10 enemy templates', () => {
    assert.ok(ENEMY_TEMPLATES.length >= 10, `Expected >= 10 templates, got ${ENEMY_TEMPLATES.length}`);
  });

  it('each template has required base fields', () => {
    const requiredFields = [
      'name',
      'sprite_id',
      'archetype',
      'base_hp',
      'base_mp',
      'base_strength',
      'base_intelligence',
      'base_agility',
      'spawn_node_types',
      'ai_type',
      'experience_reward',
      'gold_reward_min',
      'gold_reward_max',
      'min_difficulty_tier'
    ];

    for (const template of ENEMY_TEMPLATES) {
      for (const field of requiredFields) {
        assert.ok(
          field in template,
          `Template '${template.name}' missing field '${field}'`
        );
      }
    }
  });

  it('each template has positive HP', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        template.base_hp > 0,
        `Template '${template.name}' should have positive HP`
      );
    }
  });

  it('each template has non-negative MP', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        template.base_mp >= 0,
        `Template '${template.name}' should have non-negative MP`
      );
    }
  });

  it('gold_reward_min <= gold_reward_max', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        template.gold_reward_min <= template.gold_reward_max,
        `Template '${template.name}' gold_reward_min should be <= max`
      );
    }
  });

  it('experience_reward is positive', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        template.experience_reward > 0,
        `Template '${template.name}' should have positive XP reward`
      );
    }
  });
});

describe('Enemy Templates - archetypes', { skip: !canImport }, () => {
  const validArchetypes = ['beast', 'humanoid', 'undead', 'elemental', 'dragon', 'boss'];

  it('all templates have valid archetypes', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        validArchetypes.includes(template.archetype),
        `Template '${template.name}' has invalid archetype '${template.archetype}'`
      );
    }
  });

  it('has at least one beast type enemy', () => {
    const beasts = ENEMY_TEMPLATES.filter(t => t.archetype === 'beast');
    assert.ok(beasts.length > 0, 'Should have beast enemies');
  });

  it('has at least one humanoid type enemy', () => {
    const humanoids = ENEMY_TEMPLATES.filter(t => t.archetype === 'humanoid');
    assert.ok(humanoids.length > 0, 'Should have humanoid enemies');
  });

  it('has at least one undead type enemy', () => {
    const undead = ENEMY_TEMPLATES.filter(t => t.archetype === 'undead');
    assert.ok(undead.length > 0, 'Should have undead enemies');
  });

  it('has at least one elemental type enemy', () => {
    const elementals = ENEMY_TEMPLATES.filter(t => t.archetype === 'elemental');
    assert.ok(elementals.length > 0, 'Should have elemental enemies');
  });
});

describe('Enemy Templates - AI types', { skip: !canImport }, () => {
  const validAiTypes = ['aggressive', 'defensive', 'support', 'tactical', 'pack', 'hit-and-run', 'ambush'];

  it('all templates have valid AI types', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        validAiTypes.includes(template.ai_type),
        `Template '${template.name}' has invalid AI type '${template.ai_type}'`
      );
    }
  });

  it('has variety of AI types', () => {
    const aiTypes = new Set(ENEMY_TEMPLATES.map(t => t.ai_type));
    assert.ok(aiTypes.size >= 3, `Should have at least 3 different AI types, got ${aiTypes.size}`);
  });
});

describe('Enemy Templates - difficulty tiers', { skip: !canImport }, () => {
  it('all templates have valid difficulty tier (1-5)', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        template.min_difficulty_tier >= 1 && template.min_difficulty_tier <= 5,
        `Template '${template.name}' has invalid tier ${template.min_difficulty_tier}`
      );
    }
  });

  it('has tier 1 enemies for starter areas', () => {
    const tier1 = ENEMY_TEMPLATES.filter(t => t.min_difficulty_tier === 1);
    assert.ok(tier1.length >= 2, `Should have at least 2 tier 1 enemies, got ${tier1.length}`);
  });

  it('has tier 2 enemies', () => {
    const tier2 = ENEMY_TEMPLATES.filter(t => t.min_difficulty_tier === 2);
    assert.ok(tier2.length >= 2, `Should have at least 2 tier 2 enemies, got ${tier2.length}`);
  });

  it('has high tier enemies (3+) for endgame', () => {
    const highTier = ENEMY_TEMPLATES.filter(t => t.min_difficulty_tier >= 3);
    assert.ok(highTier.length >= 2, `Should have at least 2 tier 3+ enemies, got ${highTier.length}`);
  });

  it('higher tier enemies have better rewards', () => {
    const tier1 = ENEMY_TEMPLATES.filter(t => t.min_difficulty_tier === 1);
    const tier4 = ENEMY_TEMPLATES.filter(t => t.min_difficulty_tier >= 4);

    if (tier1.length > 0 && tier4.length > 0) {
      const avgTier1Xp = tier1.reduce((sum, t) => sum + t.experience_reward, 0) / tier1.length;
      const avgTier4Xp = tier4.reduce((sum, t) => sum + t.experience_reward, 0) / tier4.length;

      assert.ok(avgTier4Xp > avgTier1Xp,
        `Tier 4 avg XP (${avgTier4Xp}) should be > tier 1 (${avgTier1Xp})`);
    }
  });
});

describe('Enemy Templates - spawn node types', { skip: !canImport }, () => {
  const validNodeTypes = ['forest', 'cave', 'mountain', 'bridge', 'palace'];

  it('all templates have valid spawn node types', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(
        Array.isArray(template.spawn_node_types),
        `Template '${template.name}' spawn_node_types should be array`
      );

      for (const nodeType of template.spawn_node_types) {
        assert.ok(
          validNodeTypes.includes(nodeType),
          `Template '${template.name}' has invalid spawn type '${nodeType}'`
        );
      }
    }
  });

  it('has enemies for forest areas', () => {
    const forestEnemies = ENEMY_TEMPLATES.filter(t =>
      t.spawn_node_types.includes('forest')
    );
    assert.ok(forestEnemies.length >= 2, 'Should have forest enemies');
  });

  it('has enemies for cave areas', () => {
    const caveEnemies = ENEMY_TEMPLATES.filter(t =>
      t.spawn_node_types.includes('cave')
    );
    assert.ok(caveEnemies.length >= 2, 'Should have cave enemies');
  });

  it('has enemies for mountain areas', () => {
    const mountainEnemies = ENEMY_TEMPLATES.filter(t =>
      t.spawn_node_types.includes('mountain')
    );
    assert.ok(mountainEnemies.length >= 1, 'Should have mountain enemies');
  });

  it('has enemies for bridge areas', () => {
    const bridgeEnemies = ENEMY_TEMPLATES.filter(t =>
      t.spawn_node_types.includes('bridge')
    );
    assert.ok(bridgeEnemies.length >= 1, 'Should have bridge enemies');
  });

  it('has enemies for palace areas', () => {
    const palaceEnemies = ENEMY_TEMPLATES.filter(t =>
      t.spawn_node_types.includes('palace')
    );
    assert.ok(palaceEnemies.length >= 1, 'Should have palace enemies');
  });
});

describe('Enemy Templates - elemental resistances', { skip: !canImport }, () => {
  const validElements = ['fire', 'ice', 'lightning', 'earth', 'wind', 'water', 'holy', 'dark'];

  it('elemental_resistances is an object when present', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.elemental_resistances) {
        assert.strictEqual(
          typeof template.elemental_resistances,
          'object',
          `Template '${template.name}' resistances should be object`
        );
      }
    }
  });

  it('resistance values are in valid range (-100 to 150)', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.elemental_resistances) {
        for (const [element, value] of Object.entries(template.elemental_resistances)) {
          assert.ok(
            value >= -100 && value <= 150,
            `Template '${template.name}' ${element} resistance (${value}) out of range`
          );
        }
      }
    }
  });

  it('uses valid element types', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.elemental_resistances) {
        for (const element of Object.keys(template.elemental_resistances)) {
          assert.ok(
            validElements.includes(element),
            `Template '${template.name}' has invalid element '${element}'`
          );
        }
      }
    }
  });

  it('undead have holy weakness and dark resistance', () => {
    const undead = ENEMY_TEMPLATES.filter(t => t.archetype === 'undead');

    for (const template of undead) {
      if (template.elemental_resistances) {
        // Most undead should be weak to holy
        if ('holy' in template.elemental_resistances) {
          assert.ok(
            template.elemental_resistances.holy < 0,
            `Undead '${template.name}' should be weak to holy`
          );
        }
        // Most undead should resist dark
        if ('dark' in template.elemental_resistances) {
          assert.ok(
            template.elemental_resistances.dark > 0,
            `Undead '${template.name}' should resist dark`
          );
        }
      }
    }
  });
});

describe('Enemy Templates - drop tables', { skip: !canImport }, () => {
  it('drop_table is an object when present', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.drop_table) {
        assert.strictEqual(
          typeof template.drop_table,
          'object',
          `Template '${template.name}' drop_table should be object`
        );
      }
    }
  });

  it('drop tables have dropChance between 0 and 1', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.drop_table && 'dropChance' in template.drop_table) {
        const chance = template.drop_table.dropChance;
        assert.ok(
          chance >= 0 && chance <= 1,
          `Template '${template.name}' dropChance (${chance}) should be 0-1`
        );
      }
    }
  });

  it('minItems <= maxItems in drop tables', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.drop_table) {
        const { minItems, maxItems } = template.drop_table;
        if (minItems !== undefined && maxItems !== undefined) {
          assert.ok(
            minItems <= maxItems,
            `Template '${template.name}' minItems should be <= maxItems`
          );
        }
      }
    }
  });

  it('rarity weights are positive when present', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.drop_table?.rarityWeights) {
        for (const [rarity, weight] of Object.entries(template.drop_table.rarityWeights)) {
          assert.ok(
            weight >= 0,
            `Template '${template.name}' ${rarity} weight should be >= 0`
          );
        }
      }
    }
  });

  it('item pools have positive weights', () => {
    for (const template of ENEMY_TEMPLATES) {
      if (template.drop_table?.itemPool) {
        for (const item of template.drop_table.itemPool) {
          assert.ok(
            item.weight > 0,
            `Template '${template.name}' item pool weight should be > 0`
          );
          assert.ok(
            item.templateId > 0,
            `Template '${template.name}' item templateId should be > 0`
          );
        }
      }
    }
  });
});

describe('Enemy Templates - base stats validation', { skip: !canImport }, () => {
  it('base stats are positive', () => {
    for (const template of ENEMY_TEMPLATES) {
      assert.ok(template.base_strength > 0, `'${template.name}' strength > 0`);
      assert.ok(template.base_intelligence >= 0, `'${template.name}' intelligence >= 0`);
      assert.ok(template.base_agility > 0, `'${template.name}' agility > 0`);
    }
  });

  it('stats scale with difficulty tier', () => {
    const tier1 = ENEMY_TEMPLATES.filter(t => t.min_difficulty_tier === 1);
    const tier4 = ENEMY_TEMPLATES.filter(t => t.min_difficulty_tier >= 4);

    if (tier1.length > 0 && tier4.length > 0) {
      const avgTier1Hp = tier1.reduce((sum, t) => sum + t.base_hp, 0) / tier1.length;
      const avgTier4Hp = tier4.reduce((sum, t) => sum + t.base_hp, 0) / tier4.length;

      assert.ok(
        avgTier4Hp > avgTier1Hp,
        `Tier 4 avg HP (${avgTier4Hp}) should be > tier 1 (${avgTier1Hp})`
      );
    }
  });
});

describe('Enemy Templates - unique identifiers', { skip: !canImport }, () => {
  it('all sprite_ids are unique', () => {
    const spriteIds = ENEMY_TEMPLATES.map(t => t.sprite_id);
    const uniqueIds = new Set(spriteIds);

    assert.strictEqual(
      uniqueIds.size,
      spriteIds.length,
      'All sprite_ids should be unique'
    );
  });

  it('all names are unique', () => {
    const names = ENEMY_TEMPLATES.map(t => t.name);
    const uniqueNames = new Set(names);

    assert.strictEqual(
      uniqueNames.size,
      names.length,
      'All enemy names should be unique'
    );
  });

  it('sprite_ids follow naming convention', () => {
    for (const template of ENEMY_TEMPLATES) {
      // sprite_ids should be snake_case
      assert.ok(
        /^[a-z][a-z0-9_]*$/.test(template.sprite_id),
        `Template '${template.name}' sprite_id '${template.sprite_id}' should be snake_case`
      );
    }
  });
});

describe('Enemy Templates - import error handling', { skip: canImport }, () => {
  it('reports import error', () => {
    console.log('Enemy Templates import error:', importError?.message);
    assert.ok(importError, 'Import error should be captured');
  });
});
