import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  request,
  createTestUser,
  createTestCharacter,
  createTestPartyCharacter,
  cleanupTestUser,
  getClient,
  query
} from '../testHelper.js';

describe('Characters API', () => {
  let user = null;
  let character = null;
  const createdUserIds = [];

  async function createTrackedUser() {
    const created = await createTestUser();
    createdUserIds.push(created.userId);
    return created;
  }

  before(async () => {
    user = await createTrackedUser();
  });

  after(async () => {
    for (const userId of createdUserIds) {
      await cleanupTestUser(userId);
    }
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
        const raceUser = await createTrackedUser();
        const res = await request('POST', '/api/characters', {
          name: `Test${race}`,
          race,
          characterClass: 'wizard'
        }, raceUser.accessToken);

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.character.race, race);
      }
    });

    it('should create characters of different classes', async () => {
      const classes = ['monk', 'chemist'];

      for (const charClass of classes) {
        const classUser = await createTrackedUser();
        const res = await request('POST', '/api/characters', {
          name: `Test${charClass}`,
          race: 'human',
          characterClass: charClass
        }, classUser.accessToken);

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

    it('should apply the manual-creation policy before duplicate-name checks', async () => {
      const res = await request('POST', '/api/characters', {
        name: character.name,
        race: 'human',
        characterClass: 'warrior'
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /guild recruitment/i);
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

    it('should assign starting trait to new character', async () => {
      // Create a fresh user to ensure test isolation
      const freshUser = await createTrackedUser();

      const res = await request('POST', '/api/characters', {
        name: `TraitTest_${Date.now()}`,
        race: 'human',
        characterClass: 'warrior',
        gender: 'male'
      }, freshUser.accessToken);

      assert.strictEqual(res.status, 201, 'Character creation should succeed');

      const characterId = res.body.character.id;

      // Verify starting trait was assigned in database
      const traitResult = await query(
        `SELECT t.name, t.description
         FROM character_traits ct
         JOIN traits t ON ct.trait_id = t.id
         WHERE ct.character_id = $1`,
        [characterId]
      );

      assert.strictEqual(traitResult.rows.length, 1, 'Character should have exactly one starting trait');
      assert.strictEqual(traitResult.rows[0].name, 'Tough Skin', 'Human warrior should get Tough Skin trait');
    });

    it('should assign correct starting trait for elf wizard', async () => {
      // Create a fresh user to ensure test isolation
      const freshUser = await createTrackedUser();

      const res = await request('POST', '/api/characters', {
        name: `ElfWiz_${Date.now()}`,
        race: 'elf',
        characterClass: 'wizard',
        gender: 'female'
      }, freshUser.accessToken);

      assert.strictEqual(res.status, 201, 'Character creation should succeed');

      const characterId = res.body.character.id;

      // Verify starting trait was assigned in database
      const traitResult = await query(
        `SELECT t.name
         FROM character_traits ct
         JOIN traits t ON ct.trait_id = t.id
         WHERE ct.character_id = $1`,
        [characterId]
      );

      assert.strictEqual(traitResult.rows.length, 1, 'Character should have exactly one starting trait');
      assert.strictEqual(traitResult.rows[0].name, 'Arcane Affinity', 'Elf wizard should get Arcane Affinity trait');
    });

    it('should block manual character creation when user already has characters', async () => {
      // Create a fresh user to ensure test isolation
      const freshUser = await createTrackedUser();

      // Create the first character - this should succeed
      const firstRes = await request('POST', '/api/characters', {
        name: `FirstChar_${Date.now()}`,
        race: 'human',
        characterClass: 'warrior',
        gender: 'male'
      }, freshUser.accessToken);

      assert.strictEqual(firstRes.status, 201, 'First character creation should succeed');

      // Try to create a second character - this should be blocked
      const secondRes = await request('POST', '/api/characters', {
        name: 'SecondManualChar',
        race: 'human',
        characterClass: 'warrior',
        gender: 'male'
      }, freshUser.accessToken);

      assert.strictEqual(secondRes.status, 400);
      assert.ok(secondRes.body.error.includes('guild recruitment'),
        `Expected error about guild recruitment, got: ${secondRes.body.error}`);
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

    it('should include equipment object with equipped items', async () => {
      const res = await request('GET', '/api/characters', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.characters), 'Response should have characters array');

      for (const char of res.body.characters) {
        // Every character should have an equipment object (even if empty)
        assert.ok('equipment' in char, `Character ${char.name} should have equipment field`);
        assert.ok(typeof char.equipment === 'object', 'Equipment should be an object');

        // If there are equipped items, verify structure
        for (const [slot, item] of Object.entries(char.equipment)) {
          assert.ok(item.templateId !== undefined, `Item in ${slot} should have templateId`);
          assert.ok(item.type !== undefined, `Item in ${slot} should have type`);
          assert.ok(item.equipmentSlot !== undefined, `Item in ${slot} should have equipmentSlot`);
          assert.ok(item.levelRequirement !== undefined, `Item in ${slot} should have levelRequirement`);
          assert.ok('rarity' in item, `Item in ${slot} should have rarity field`);
        }
      }
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
      const otherUser = await createTrackedUser();
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

  describe('GET /api/characters/preview', () => {
    it('should return stats and traits for valid race/class combo', async () => {
      const res = await request('GET', '/api/characters/preview?race=human&characterClass=warrior');

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.stats, 'Response should include stats');
      assert.ok(res.body.traits, 'Response should include traits');

      // Check stats structure
      assert.ok(res.body.stats.hpMax > 0, 'HP max should be positive');
      assert.ok(res.body.stats.mpMax >= 0, 'MP max should be non-negative');
      assert.ok(res.body.stats.strength > 0, 'Strength should be positive');
      assert.ok(res.body.stats.intelligence > 0, 'Intelligence should be positive');
      assert.ok(res.body.stats.agility > 0, 'Agility should be positive');
      assert.ok(res.body.stats.vitality > 0, 'Vitality should be positive');

      // Check racial trait
      assert.ok(res.body.traits.racial, 'Should have racial trait');
      assert.strictEqual(res.body.traits.racial.type, 'racial');
      assert.ok(res.body.traits.racial.name, 'Racial trait should have name');
      assert.ok(res.body.traits.racial.description, 'Racial trait should have description');

      // Check starting trait
      assert.ok(res.body.traits.starting, 'Should have starting trait');
      assert.strictEqual(res.body.traits.starting.type, 'starting');
      assert.ok(res.body.traits.starting.name, 'Starting trait should have name');
      assert.ok(res.body.traits.starting.description, 'Starting trait should have description');
    });

    it('should return correct racial trait for human', async () => {
      const res = await request('GET', '/api/characters/preview?race=human&characterClass=warrior');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.traits.racial.name, 'Quick Learner');
    });

    it('should return correct starting trait for human warrior (Tough Skin)', async () => {
      const res = await request('GET', '/api/characters/preview?race=human&characterClass=warrior');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.traits.starting.name, 'Tough Skin');
    });

    it('should return correct starting trait for elf wizard (Arcane Affinity)', async () => {
      const res = await request('GET', '/api/characters/preview?race=elf&characterClass=wizard');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.traits.starting.name, 'Arcane Affinity');
    });

    it('should work for all race/class combinations', async () => {
      const races = ['human', 'elf', 'dwarf', 'vampire', 'orc'];
      const classes = ['warrior', 'wizard', 'monk', 'chemist'];

      for (const race of races) {
        for (const charClass of classes) {
          const res = await request('GET', `/api/characters/preview?race=${race}&characterClass=${charClass}`);

          assert.strictEqual(res.status, 200, `Should succeed for ${race} ${charClass}`);
          assert.ok(res.body.stats, `Should have stats for ${race} ${charClass}`);
          assert.ok(res.body.traits.racial, `Should have racial trait for ${race} ${charClass}`);
          assert.ok(res.body.traits.starting, `Should have starting trait for ${race} ${charClass}`);
        }
      }
    });

    it('should reject missing race parameter', async () => {
      const res = await request('GET', '/api/characters/preview?characterClass=warrior');

      assert.strictEqual(res.status, 400);
    });

    it('should reject missing class parameter', async () => {
      const res = await request('GET', '/api/characters/preview?race=human');

      assert.strictEqual(res.status, 400);
    });

    it('should reject invalid race', async () => {
      const res = await request('GET', '/api/characters/preview?race=dragon&characterClass=warrior');

      assert.strictEqual(res.status, 400);
    });

    it('should reject invalid class', async () => {
      const res = await request('GET', '/api/characters/preview?race=human&characterClass=ninja');

      assert.strictEqual(res.status, 400);
    });

    it('should not require authentication', async () => {
      // Preview endpoint should be accessible without auth for better UX
      const res = await request('GET', '/api/characters/preview?race=human&characterClass=warrior');

      assert.strictEqual(res.status, 200);
    });
  });

  describe('DELETE /api/characters/:id', () => {
    it('should delete character successfully', async () => {
      // Recruited party members can be deleted; the manually created leader
      // cannot. Establish a recruited-character persistence fixture directly.
      const characterToDelete = await createTestPartyCharacter(user.userId, {
        name: `ToDelete_${Date.now()}`
      });
      const charId = characterToDelete.id;

      const res = await request('DELETE', `/api/characters/${charId}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);

      // Verify deletion
      const getRes = await request('GET', `/api/characters/${charId}`, null, user.accessToken);
      assert.strictEqual(getRes.status, 404);
    });

    it('should reject deleting another user character', async () => {
      const otherUser = await createTrackedUser();
      const otherChar = await createTestCharacter(otherUser.accessToken);

      const res = await request('DELETE', `/api/characters/${otherChar.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should wait for the battle lock and preserve a character that enters battle', async () => {
      const characterToKeep = await createTestPartyCharacter(user.userId, {
        name: `DeleteRace_${Date.now()}`
      });
      const locker = await getClient();
      let transactionOpen = false;
      let deleteRequest = null;
      let requestSettled = false;

      try {
        await locker.query('BEGIN');
        transactionOpen = true;
        const lockerBackend = await locker.query(
          'SELECT pg_backend_pid() AS pid'
        );
        const lockerPid = lockerBackend.rows[0].pid;
        await locker.query(
          `SELECT id
           FROM characters
           WHERE user_id = $1
           ORDER BY id
           FOR UPDATE`,
          [user.userId]
        );

        deleteRequest = request(
          'DELETE',
          `/api/characters/${characterToKeep.id}`,
          null,
          user.accessToken
        ).then((response) => {
          requestSettled = true;
          return response;
        });

        const deadline = Date.now() + 5000;
        let deleteReachedLock = false;
        while (Date.now() < deadline) {
          const waiting = await query(
            `SELECT EXISTS (
               SELECT 1
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND state = 'active'
                 AND wait_event_type = 'Lock'
                 AND query LIKE '%FROM characters%'
                 AND query LIKE '%FOR UPDATE%'
                 AND $1 = ANY(pg_blocking_pids(pid))
             ) AS waiting`,
            [lockerPid]
          );
          if (waiting.rows[0].waiting) {
            deleteReachedLock = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.strictEqual(
          deleteReachedLock,
          true,
          'character deletion should reach and wait on the lifecycle row lock'
        );
        assert.strictEqual(
          requestSettled,
          false,
          'character deletion should wait for the owned-character lifecycle lock'
        );

        await locker.query(
          'UPDATE characters SET in_battle = true WHERE id = $1',
          [characterToKeep.id]
        );
        await locker.query('COMMIT');
        transactionOpen = false;

        const response = await deleteRequest;
        assert.strictEqual(response.status, 400);
        assert.match(response.body.error, /while in battle/i);

        const persisted = await query(
          'SELECT id, in_battle FROM characters WHERE id = $1 AND user_id = $2',
          [characterToKeep.id, user.userId]
        );
        assert.strictEqual(persisted.rowCount, 1);
        assert.strictEqual(persisted.rows[0].in_battle, true);
      } finally {
        if (transactionOpen) {
          await locker.query('ROLLBACK');
        }
        locker.release();
        if (deleteRequest) {
          await deleteRequest.catch(() => {});
        }
        await query(
          'UPDATE characters SET in_battle = false WHERE id = $1',
          [characterToKeep.id]
        );
      }
    });

    it('should block deletion of main character (oldest character)', async () => {
      // Get characters and identify main character
      const listRes = await request('GET', '/api/characters', null, user.accessToken);
      const characters = listRes.body.characters;

      assert.ok(characters.length > 0, 'User should have at least one character');

      // Main character is the one with party_slot = 1 (or oldest by created_at)
      const mainChar = characters.find(c => c.party_slot === 1) || characters[0];

      const res = await request('DELETE', `/api/characters/${mainChar.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('main character'),
        `Expected error about main character, got: ${res.body.error}`);
    });
  });
});
