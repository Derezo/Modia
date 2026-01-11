import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { request, createTestUser, createTestCharacter } from '../testHelper.js';

describe('Skills API', () => {
  let user = null;
  let warriorChar = null;
  let wizardChar = null;

  before(async () => {
    user = await createTestUser();

    // Create characters of specific classes
    const warRes = await request('POST', '/api/characters', {
      name: `Warrior_${Date.now()}`,
      race: 'human',
      characterClass: 'warrior'
    }, user.accessToken);
    warriorChar = warRes.body.character;

    const wizRes = await request('POST', '/api/characters', {
      name: `Wizard_${Date.now()}`,
      race: 'elf',
      characterClass: 'wizard'
    }, user.accessToken);
    wizardChar = wizRes.body.character;
  });

  describe('GET /api/skills/tree/:guildId', () => {
    it('should return warrior skill tree', async () => {
      const res = await request('GET', '/api/skills/tree/warrior', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.name, 'Warrior Guild');
      assert.ok(Array.isArray(res.body.branches));
      assert.ok(res.body.branches.length > 0);

      // Check that branches have skills
      const branch = res.body.branches[0];
      assert.ok(branch.name);
      assert.ok(Array.isArray(branch.skills));
      assert.ok(branch.skills.length > 0);

      // Check skill structure
      const skill = branch.skills[0];
      assert.ok(skill.id);
      assert.ok(skill.name);
      assert.ok(skill.maxLevel);
      assert.ok(skill.baseCost);
      assert.ok(skill.type);
    });

    it('should return wizard skill tree', async () => {
      const res = await request('GET', '/api/skills/tree/wizard', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.name, 'Wizard Guild');
      assert.ok(res.body.branches.some(b => b.name === 'Fire'));
      assert.ok(res.body.branches.some(b => b.name === 'Ice'));
      assert.ok(res.body.branches.some(b => b.name === 'Lightning'));
    });

    it('should return monk skill tree', async () => {
      const res = await request('GET', '/api/skills/tree/monk', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.name, 'Monk Guild');
    });

    it('should return chemist skill tree', async () => {
      const res = await request('GET', '/api/skills/tree/chemist', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.name, 'Chemist Guild');
    });

    it('should return 404 for invalid guild', async () => {
      // Note: 'ninja' is a valid advanced guild, use truly invalid name
      const res = await request('GET', '/api/skills/tree/nonexistent_guild', null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('GET', '/api/skills/tree/warrior');

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/skills/characters/:characterId/skills', () => {
    it('should return character skills (empty initially)', async () => {
      const res = await request('GET', `/api/skills/characters/${warriorChar.id}/skills`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.characterId, warriorChar.id);
      assert.strictEqual(res.body.class, 'warrior');
      assert.ok(res.body.xpPool !== undefined);
      assert.ok(typeof res.body.skills === 'object');
    });

    it('should reject access to another user character skills', async () => {
      const otherUser = await createTestUser();
      const otherChar = await createTestCharacter(otherUser.accessToken);

      const res = await request('GET', `/api/skills/characters/${otherChar.id}/skills`, null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('GET', `/api/skills/characters/${warriorChar.id}/skills`);

      assert.strictEqual(res.status, 401);
    });
  });

  describe('POST /api/skills/learn', () => {
    it('should reject learning skill without enough XP', async () => {
      // New character starts with 0 XP, so learning should fail
      const res = await request('POST', '/api/skills/learn', {
        characterId: warriorChar.id,
        skillId: 'power_strike',
        levels: 1
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.includes('XP') || res.body.message?.includes('XP'));
    });

    it('should reject learning skill from wrong guild', async () => {
      // Try to learn warrior skill on wizard
      const res = await request('POST', '/api/skills/learn', {
        characterId: wizardChar.id,
        skillId: 'power_strike',
        levels: 1
      }, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should reject learning non-existent skill', async () => {
      const res = await request('POST', '/api/skills/learn', {
        characterId: warriorChar.id,
        skillId: 'super_ultra_strike',
        levels: 1
      }, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should reject learning skill with unmet prerequisites', async () => {
      // Cleave requires power_strike at level 3
      const res = await request('POST', '/api/skills/learn', {
        characterId: warriorChar.id,
        skillId: 'cleave',
        levels: 1
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.includes('Requires') || res.body.message?.includes('Requires'));
    });

    it('should reject unauthenticated skill learning', async () => {
      const res = await request('POST', '/api/skills/learn', {
        characterId: warriorChar.id,
        skillId: 'power_strike',
        levels: 1
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/skills/guilds', () => {
    it('should return list of all guilds', async () => {
      const res = await request('GET', '/api/skills/guilds', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.guilds));
      assert.ok(res.body.guilds.length >= 4); // At least 4 guilds

      // Check guild structure
      const guild = res.body.guilds[0];
      assert.ok(guild.id);
      assert.ok(guild.name);
      assert.ok(guild.description);
      assert.ok(guild.branchCount !== undefined);
      assert.ok(guild.skillCount !== undefined);
    });

    it('should include all expected guilds', async () => {
      const res = await request('GET', '/api/skills/guilds', null, user.accessToken);

      const guildIds = res.body.guilds.map(g => g.id);
      assert.ok(guildIds.includes('warrior'));
      assert.ok(guildIds.includes('wizard'));
      assert.ok(guildIds.includes('monk'));
      assert.ok(guildIds.includes('chemist'));
    });
  });
});
