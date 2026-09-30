import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// escapeHtml relies on textContent -> innerHTML serialization; emulate it.
globalThis.document ??= {
  createElement: () => {
    let text = '';
    return {
      set textContent(value) { text = String(value); },
      get textContent() { return text; },
      get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    };
  }
};

const { getUnmetLevelRequirement, renderEquippedComparison } = await import('../shop/ShopEquipComparison.js');

const ironSword = {
  type: 'weapon',
  equipmentSlot: 'main_hand',
  levelRequirement: 5,
  statBonuses: { strength: 7 }
};

describe('shop: unmet level requirement', () => {
  it('flags the requirement only when no party member meets it', () => {
    assert.equal(getUnmetLevelRequirement(ironSword, [{ level: 3 }, { level: 4 }]), 5);
    assert.equal(getUnmetLevelRequirement(ironSword, [{ level: 3 }, { level: 5 }]), 0);
  });

  it('does not flag an unknown party or a level-1 item', () => {
    assert.equal(getUnmetLevelRequirement(ironSword, []), 0);
    assert.equal(getUnmetLevelRequirement({ levelRequirement: 1 }, [{ level: 1 }]), 0);
  });
});

describe('shop: vs equipped comparison', () => {
  const party = [
    {
      name: 'Bram', class: 'warrior', level: 6, party_slot: 1,
      equipment: { main_hand: { baseStats: { strength: 4, agility: 1 }, bonusStats: {} } }
    },
    { name: 'Lia', class: 'mage', level: 2, party_slot: 2, equipment: {} },
    { name: 'Benched', class: 'warrior', level: 9, party_slot: null, equipment: {} }
  ];

  it('shows each eligible party member\'s change against their current gear', () => {
    const html = renderEquippedComparison(ironSword, party);
    assert.match(html, /Vs Equipped/);
    // Bram: STR 4 -> 7 (+3), loses AGI 1
    assert.match(html, /Bram<\/span>\s*<span class="comparison-changes"><span class="stat-positive">STR \+3<\/span>, <span class="stat-negative">AGI -1<\/span>/);
    // Lia is below level 5, so she is not offered the comparison
    assert.doesNotMatch(html, /Lia/);
    // Benched characters are not in the party
    assert.doesNotMatch(html, /Benched/);
  });

  it('compares against an empty slot as a straight gain', () => {
    const html = renderEquippedComparison({ ...ironSword, levelRequirement: 1 }, party);
    assert.match(html, /Lia<\/span>\s*<span class="comparison-changes"><span class="stat-positive">STR \+7</);
  });

  it('says so when nobody in the party can equip it', () => {
    const html = renderEquippedComparison({ ...ironSword, levelRequirement: 50 }, party);
    assert.match(html, /No party member can equip this/);
  });

  it('renders nothing for non-equipment or without party equipment data', () => {
    assert.equal(renderEquippedComparison({ type: 'consumable', statBonuses: { hp_restore: 50 } }, party), '');
    assert.equal(renderEquippedComparison(ironSword, [{ name: 'X', level: 9 }]), '');
  });
});
