import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { request, createTestUser, createTestCharacter } from '../testHelper.js';

describe('Characters API', () => {
  let user = null;
  let character = null;

  before(async () => {
    user = await createTestUser();
  });

  describe('POST /api/characters', () => {
    it('should create a character successfully', async () => {
      const res = await request('POST', '/api/characters', {
        name: 'TestHero',
        race: 'human',
        characterClass: 'warrior'
      }, user.accessToken);

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.character);
      assert.strictEqual(res.body.character.name, 'TestHero');
      assert.strictEqual(res.body.character.race, 'human');
      assert.strictEqual(res.body.character.class, 'warrior');
      assert.strictEqual(res.body.character.level, 1);

      character = res.body.character;
    });

    it('should create characters of different races', async () => {
      const races = ['elf', 'dwarf', 'orc'];

      for (const race of races) {
        const res = await request('POST', '/api/characters', {
          name: `Test${race}`,
          race,
          characterClass: 'wizard'
        }, user.accessToken);

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.character.race, race);
      }
    });

    it('should create characters of different classes', async () => {
      const classes = ['monk', 'chemist'];

      for (const charClass of classes) {
        const res = await request('POST', '/api/characters', {
          name: `Test${charClass}`,
          race: 'human',
          characterClass: charClass
        }, user.accessToken);

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.character.class, charClass);
      }
    });

    it('should reject invalid race', async () => {
      const res = await request('POST', '/api/characters', {
        name: 'InvalidRace',
        race: 'dragon',
        characterClass: 'warrior'
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should reject invalid class', async () => {
      const res = await request('POST', '/api/characters', {
        name: 'InvalidClass',
        race: 'human',
        characterClass: 'ninja'
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should reject duplicate character name for same user', async () => {
      const name = `UniqueName_${Date.now()}`;

      // Create first character
      await request('POST', '/api/characters', {
        name,
        race: 'human',
        characterClass: 'warrior'
      }, user.accessToken);

      // Try to create second with same name
      const res = await request('POST', '/api/characters', {
        name,
        race: 'elf',
        characterClass: 'wizard'
      }, user.accessToken);

      assert.strictEqual(res.status, 409);
    });

    it('should reject missing name', async () => {
      const res = await request('POST', '/api/characters', {
        race: 'human',
        characterClass: 'warrior'
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('POST', '/api/characters', {
        name: 'NoAuth',
        race: 'human',
        characterClass: 'warrior'
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/characters', () => {
    it('should return list of user characters', async () => {
      const res = await request('GET', '/api/characters', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.characters));
      assert.ok(res.body.characters.length > 0);
    });

    it('should include character stats', async () => {
      const res = await request('GET', '/api/characters', null, user.accessToken);

      const char = res.body.characters[0];
      assert.ok(char.hp_max !== undefined);
      assert.ok(char.strength !== undefined);
      assert.ok(char.vitality !== undefined);
      assert.ok(char.agility !== undefined);
      assert.ok(char.intelligence !== undefined);
      assert.ok(char.luck !== undefined);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('GET', '/api/characters');

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/characters/:id', () => {
    it('should return specific character details', async () => {
      assert.ok(character, 'Character should be created');

      const res = await request('GET', `/api/characters/${character.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.character.id, character.id);
      assert.strictEqual(res.body.character.name, character.name);
    });

    it('should reject access to another user character', async () => {
      // Create another user
      const otherUser = await createTestUser();
      const otherChar = await createTestCharacter(otherUser.accessToken);

      // Try to access with original user
      const res = await request('GET', `/api/characters/${otherChar.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should return 404 for non-existent character', async () => {
      const res = await request('GET', '/api/characters/999999', null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/characters/:id', () => {
    it('should delete character successfully', async () => {
      // Create a character to delete
      const charRes = await request('POST', '/api/characters', {
        name: `ToDelete_${Date.now()}`,
        race: 'human',
        characterClass: 'warrior'
      }, user.accessToken);

      const charId = charRes.body.character.id;

      const res = await request('DELETE', `/api/characters/${charId}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);

      // Verify deletion
      const getRes = await request('GET', `/api/characters/${charId}`, null, user.accessToken);
      assert.strictEqual(getRes.status, 404);
    });

    it('should reject deleting another user character', async () => {
      const otherUser = await createTestUser();
      const otherChar = await createTestCharacter(otherUser.accessToken);

      const res = await request('DELETE', `/api/characters/${otherChar.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });
  });
});
