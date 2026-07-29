import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBossBattleSceneData,
  getGuildCharacters,
  getGuildForClass,
  getQuestObjectives,
  selectGuildCharacter
} from '../guildAdvancementModel.js';

describe('guild advancement character selection', () => {
  const roster = [
    { id: 1, name: 'Bran', class: 'warrior', party_slot: 1, current_node_id: 44 },
    { id: 2, name: 'Mira', class: 'wizard', party_slot: 2, current_node_id: 44 },
    { id: 3, name: 'Sable', class: 'sorcerer', party_slot: null, current_node_id: 44 },
    { id: 4, name: 'Orin', class: 'summoner', party_slot: null, current_node_id: 9 }
  ];

  it('selects a guild-compatible character without relying on retired party state', () => {
    const result = selectGuildCharacter({
      characters: roster,
      guildClass: 'wizard',
      activeCharacter: roster[0],
      nodeId: 44
    });

    assert.equal(result.character.id, 2);
    assert.deepEqual(result.presentCharacters.map(character => character.id), [2, 3]);
  });

  it('honors an explicitly selected advanced-class wizard at the guild', () => {
    const result = selectGuildCharacter({
      characters: roster,
      guildClass: 'wizard',
      preferredCharacterId: 3,
      nodeId: 44
    });

    assert.equal(result.character.id, 3);
  });

  it('does not select a matching character who is away from the guild', () => {
    const result = selectGuildCharacter({
      characters: [roster[3]],
      guildClass: 'wizard',
      nodeId: 44
    });

    assert.equal(result.character, null);
    assert.equal(result.guildCharacters.length, 1);
    assert.equal(result.presentCharacters.length, 0);
  });

  it('maps every earned wizard tier back to the Wizards Guild', () => {
    assert.equal(getGuildForClass('wizard'), 'wizard');
    assert.equal(getGuildForClass('sorcerer'), 'wizard');
    assert.equal(getGuildForClass('summoner'), 'wizard');
    assert.deepEqual(
      getGuildCharacters(roster, 'wizard').map(character => character.id),
      [2, 3, 4]
    );
  });
});

describe('guild advancement objective presentation', () => {
  it('normalizes the nested current-progress DTO with display metadata', () => {
    const result = getQuestObjectives({
      progress: {
        materials: {
          items: [
            { itemTemplateId: 7, name: 'Moonstone', collected: 2, required: 3, complete: false }
          ]
        },
        enemies: {
          enemies: [
            { enemyArchetype: 'arcane_wisp', name: 'Arcane Wisps', killed: 4, required: 4, complete: true }
          ]
        },
        nodes: {
          nodes: [
            { nodeType: 'ruins', name: 'Ancient Ruins', visited: 1, required: 2, complete: false }
          ]
        },
        allComplete: false
      }
    });

    assert.deepEqual(result.materials[0], {
      label: 'Moonstone',
      current: 2,
      required: 3,
      complete: false,
      percentage: 67
    });
    assert.equal(result.enemies[0].label, 'Defeat Arcane Wisps');
    assert.equal(result.nodes[0].label, 'Ancient Ruins');
    assert.equal(result.allComplete, false);
  });

  it('normalizes raw snake-case requirements from available quests', () => {
    const result = getQuestObjectives({
      materialRequirements: [
        { item_template_id: 12, quantity: 5, name: 'Silver Dust' }
      ],
      enemyRequirements: [
        { enemy_archetype: 'forest_spirit', count: 3 }
      ],
      nodeRequirements: [
        { node_type: 'magic_spring', count: 2 }
      ]
    });

    assert.equal(result.materials[0].label, 'Silver Dust');
    assert.equal(result.materials[0].required, 5);
    assert.equal(result.enemies[0].label, 'Defeat Forest Spirit');
    assert.equal(result.nodes[0].label, 'Visit Magic Spring nodes');
    assert.equal(result.allComplete, false);
  });
});

describe('guildmaster battle handoff', () => {
  it('preserves a negotiated V2 snapshot for BattleScene', () => {
    const snapshot = {
      battleId: 81,
      battleMapSchemaVersion: 2,
      stateRevision: 0
    };
    const capabilities = {
      negotiatedBattleMapSchemaVersion: 2
    };

    assert.deepEqual(
      buildBossBattleSceneData({
        battleId: 81,
        snapshot,
        battleMapCapabilities: capabilities,
        guildmaster: { name: 'Archmage' }
      }),
      {
        battleId: 81,
        snapshot,
        battleMapCapabilities: capabilities,
        guildmaster: { name: 'Archmage' },
        isBossBattle: true
      }
    );
  });
});
