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

  describe('POST /api/characters - atomicity and parity (Finding 43)', () => {
    it('creates exactly one character when first-character requests race', async () => {
      const racer = await createTrackedUser();
      const attempts = await Promise.all([1, 2, 3, 4].map(n => request('POST', '/api/characters', {
        name: `Racer${n}`,
        race: 'human',
        characterClass: 'warrior'
      }, racer.accessToken)));

      const created = attempts.filter(r => r.status === 201);
      assert.strictEqual(created.length, 1, JSON.stringify(attempts.map(r => [r.status, r.body.error])));
      assert.ok(attempts.every(r => r.status === 201 || r.status === 400 || r.status === 409));

      const rows = await query(
        'SELECT party_slot FROM characters WHERE user_id = $1',
        [racer.userId]
      );
      assert.deepStrictEqual(rows.rows.map(r => r.party_slot), [1]);
    });

    it('the database refuses a second party leader for one user', async () => {
      const owner = await createTrackedUser();
      const first = await request('POST', '/api/characters', {
        name: 'SoleLeader',
        race: 'human',
        characterClass: 'warrior'
      }, owner.accessToken);
      assert.strictEqual(first.status, 201);

      await assert.rejects(
        query(
          `INSERT INTO characters (
             user_id, name, race, class, gender, level, experience,
             hp_current, hp_max, mp_current, mp_max,
             strength, intelligence, agility, vitality, luck,
             party_slot, current_node_id, home_region_id
           )
           SELECT user_id, 'SecondLeader', race, class, gender, level, experience,
                  hp_current, hp_max, mp_current, mp_max,
                  strength, intelligence, agility, vitality, luck,
                  1, current_node_id, home_region_id
           FROM characters WHERE id = $1`,
          [first.body.character.id]
        ),
        err => err.code === '23505'
      );
    });

    it('grants the same start as register-with-character', async () => {
      const manual = await createTrackedUser();
      const manualRes = await request('POST', '/api/characters', {
        name: 'ParityManual',
        race: 'elf',
        characterClass: 'wizard'
      }, manual.accessToken);
      assert.strictEqual(manualRes.status, 201, JSON.stringify(manualRes.body));

      const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const registered = await request('POST', '/api/auth/register-with-character', {
        username: `testparity_${suffix}`,
        email: `test_parity_${suffix}@test.com`,
        password: 'TestPassword123!',
        characterName: 'ParityRegistered',
        race: 'elf',
        characterClass: 'wizard'
      });
      assert.strictEqual(registered.status, 201, JSON.stringify(registered.body));
      createdUserIds.push(registered.body.user.id);

      async function startingKit(userId, characterId) {
        const shared = await query(
          `SELECT item_template_id, quantity FROM character_items
           WHERE user_id = $1 AND character_id IS NULL ORDER BY item_template_id`,
          [userId]
        );
        const equipped = await query(
          `SELECT item_template_id, equipped_slot FROM character_items
           WHERE character_id = $1 ORDER BY item_template_id`,
          [characterId]
        );
        const skills = await query(
          'SELECT skill_id FROM character_skills WHERE character_id = $1 ORDER BY skill_id',
          [characterId]
        );
        const traits = await query(
          'SELECT trait_id FROM character_traits WHERE character_id = $1 ORDER BY trait_id',
          [characterId]
        );
        return {
          shared: shared.rows,
          equipped: equipped.rows,
          skills: skills.rows,
          traits: traits.rows
        };
      }

      const manualKit = await startingKit(manual.userId, manualRes.body.character.id);
      const registeredKit = await startingKit(
        registered.body.user.id,
        registered.body.character.id
      );
      assert.ok(manualKit.shared.length > 0, 'starter consumables granted');
      assert.ok(manualKit.equipped.length > 0, 'starter equipment granted');
      assert.deepStrictEqual(manualKit, registeredKit);
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

    it('should delete character with marketplace_audit history (FK SET NULL)', async () => {
      // Create a recruited character that can be deleted
      // Name must be <= 24 chars (varchar(24) constraint)
      const charToDelete = await createTestPartyCharacter(user.userId, {
        name: `MktHist${Date.now() % 10000000}`
      });
      let auditId = null;

      try {
        // Create marketplace audit entry referencing this character
        const insertResult = await query(
          `INSERT INTO marketplace_audit (event_type, user_id, character_id, event_data)
           VALUES ('test_event', $1, $2, '{"test": true}')
           RETURNING id`,
          [user.userId, charToDelete.id]
        );
        auditId = insertResult.rows[0].id;

        // Verify the audit entry exists
        const beforeDelete = await query(
          'SELECT id FROM marketplace_audit WHERE character_id = $1',
          [charToDelete.id]
        );
        assert.ok(beforeDelete.rows.length > 0, 'Audit entry should exist before delete');

        // Delete the character - should succeed due to ON DELETE SET NULL
        const res = await request('DELETE', `/api/characters/${charToDelete.id}`, null, user.accessToken);
        assert.strictEqual(res.status, 200, 'Character deletion should succeed');

        // Verify the audit entry still exists but character_id is NULL
        const afterDelete = await query(
          'SELECT id, character_id FROM marketplace_audit WHERE id = $1',
          [auditId]
        );
        assert.ok(afterDelete.rows.length > 0, 'Audit entry should still exist after delete');
        assert.strictEqual(afterDelete.rows[0].character_id, null, 'character_id should be NULL after FK SET NULL');
      } finally {
        // Cleanup
        if (auditId) {
          await query('DELETE FROM marketplace_audit WHERE id = $1', [auditId]).catch(() => {});
        }
      }
    });

    it('should delete character with item_escrow row (open sell order, FK SET NULL)', async () => {
      // Test that deleting a character with an open sell order works
      // item_escrow.character_id has ON DELETE SET NULL
      const charToDelete = await createTestPartyCharacter(user.userId, {
        name: `Escrow${Date.now() % 10000000}`
      });
      let orderId = null;
      let escrowId = null;

      try {
        // Find a stackable tradeable item
        const itemResult = await query(
          `SELECT id FROM item_templates
           WHERE is_tradeable IS NOT FALSE
           AND is_stackable = TRUE
           AND item_type IN ('consumable', 'material')
           LIMIT 1`
        );
        assert.ok(itemResult.rows.length > 0, 'Need a stackable tradeable item');
        const itemTemplateId = itemResult.rows[0].id;

        // Create a market order (sell side, open status)
        const orderResult = await query(
          `INSERT INTO market_orders (user_id, item_template_id, side, price, quantity, status)
           VALUES ($1, $2, 'sell', 100, 5, 'open')
           RETURNING id`,
          [user.userId, itemTemplateId]
        );
        orderId = orderResult.rows[0].id;

        // Create item_escrow referencing the character
        // This simulates having escrowed items from a character's inventory for a sell order
        const escrowResult = await query(
          `INSERT INTO item_escrow (order_id, character_id, item_template_id, quantity)
           VALUES ($1, $2, $3, 5)
           RETURNING id`,
          [orderId, charToDelete.id, itemTemplateId]
        );
        escrowId = escrowResult.rows[0].id;

        // Delete the character - should succeed due to ON DELETE SET NULL
        const res = await request('DELETE', `/api/characters/${charToDelete.id}`, null, user.accessToken);
        assert.strictEqual(res.status, 200, 'Character deletion should succeed with item_escrow');

        // Verify item_escrow still exists but character_id is NULL
        const afterDelete = await query(
          'SELECT id, character_id FROM item_escrow WHERE id = $1',
          [escrowId]
        );
        assert.ok(afterDelete.rows.length > 0, 'item_escrow row should still exist');
        assert.strictEqual(afterDelete.rows[0].character_id, null, 'character_id should be NULL after FK SET NULL');
      } finally {
        // Cleanup
        if (escrowId) {
          await query('DELETE FROM item_escrow WHERE id = $1', [escrowId]).catch(() => {});
        }
        if (orderId) {
          await query('DELETE FROM market_orders WHERE id = $1', [orderId]).catch(() => {});
        }
      }
    });

    it('should delete character with item_listing_sales history (FK SET NULL)', async () => {
      // Test that deleting a character that has bought items works
      // item_listing_sales.buyer_character_id has ON DELETE SET NULL
      //
      // Setup: Create a seller user/character (persists) and a buyer character (to delete)
      // The listing is owned by seller, the sale records buyer_character_id = charToDelete
      // When charToDelete is deleted, item_listing_sales.buyer_character_id -> NULL

      const sellerUser = await createTrackedUser();
      const sellerChar = await createTestCharacter(sellerUser.accessToken);
      const charToDelete = await createTestPartyCharacter(user.userId, {
        name: `Buyer${Date.now() % 10000000}`
      });

      let characterItemId = null;
      let listingId = null;
      let saleId = null;

      try {
        // Find a tradeable equipment item
        const itemResult = await query(
          'SELECT id FROM item_templates WHERE is_tradeable IS NOT FALSE LIMIT 1'
        );
        assert.ok(itemResult.rows.length > 0, 'Need a tradeable item');
        const itemTemplateId = itemResult.rows[0].id;

        // Create a character_item owned by the seller user (shared inventory: user_id set, character_id null)
        const itemInsert = await query(
          'INSERT INTO character_items (user_id, item_template_id, quantity) ' +
          'VALUES ($1, $2, 1) ' +
          'RETURNING id',
          [sellerUser.userId, itemTemplateId]
        );
        characterItemId = itemInsert.rows[0].id;

        // Create a sold listing from the seller
        const listingResult = await query(
          'INSERT INTO item_listings (seller_id, character_id, character_item_id, item_template_id, price, status) ' +
          "VALUES ($1, $2, $3, $4, 100, 'sold') " +
          'RETURNING id',
          [sellerUser.userId, sellerChar.id, characterItemId, itemTemplateId]
        );
        listingId = listingResult.rows[0].id;

        // Create an item_listing_sales record with charToDelete as buyer
        const saleResult = await query(
          `INSERT INTO item_listing_sales (listing_id, buyer_id, buyer_character_id, seller_id, item_template_id, price)
           VALUES ($1, $2, $3, $4, $5, 100)
           RETURNING id`,
          [listingId, user.userId, charToDelete.id, sellerUser.userId, itemTemplateId]
        );
        saleId = saleResult.rows[0].id;

        // Verify the sale exists with the buyer character
        const beforeDelete = await query(
          'SELECT buyer_character_id FROM item_listing_sales WHERE id = $1',
          [saleId]
        );
        assert.strictEqual(beforeDelete.rows[0].buyer_character_id, charToDelete.id);

        // Delete the buyer character - should succeed due to ON DELETE SET NULL
        const res = await request('DELETE', `/api/characters/${charToDelete.id}`, null, user.accessToken);
        assert.strictEqual(res.status, 200, 'Character deletion should succeed with item_listing_sales');

        // Verify item_listing_sales still exists but buyer_character_id is NULL
        const afterDelete = await query(
          'SELECT id, buyer_character_id FROM item_listing_sales WHERE id = $1',
          [saleId]
        );
        assert.ok(afterDelete.rows.length > 0, 'item_listing_sales row should still exist');
        assert.strictEqual(afterDelete.rows[0].buyer_character_id, null, 'buyer_character_id should be NULL after FK SET NULL');
      } finally {
        // Cleanup in reverse order of creation
        if (saleId) {
          await query('DELETE FROM item_listing_sales WHERE id = $1', [saleId]).catch(() => {});
        }
        if (listingId) {
          await query('DELETE FROM item_listings WHERE id = $1', [listingId]).catch(() => {});
        }
        if (characterItemId) {
          await query('DELETE FROM character_items WHERE id = $1', [characterItemId]).catch(() => {});
        }
      }
    });

    it('should allow user deletion with market_trades history (FK SET NULL)', async () => {
      // Test that deleting a user with market_trades works
      // market_trades.buyer_id and seller_id have ON DELETE SET NULL
      const tradeUser = await createTrackedUser();
      // Create a character so the user has complete data (character not used in test)
      const _tradeChar = await createTestCharacter(tradeUser.accessToken);
      let tradeId = null;

      try {
        // Find a tradeable item
        const itemResult = await query(
          'SELECT id FROM item_templates WHERE is_tradeable IS NOT FALSE LIMIT 1'
        );
        assert.ok(itemResult.rows.length > 0, 'Need a tradeable item');
        const itemTemplateId = itemResult.rows[0].id;

        // Create a market_trades record with the user as buyer
        const tradeResult = await query(
          'INSERT INTO market_trades (item_template_id, buyer_id, seller_id, price, quantity, total_gold) ' +
          'VALUES ($1, $2, $2, 100, 1, 100) ' +
          'RETURNING id',
          [itemTemplateId, tradeUser.userId]
        );
        tradeId = tradeResult.rows[0].id;

        // Verify the trade exists
        const beforeDelete = await query(
          'SELECT buyer_id, seller_id FROM market_trades WHERE id = $1',
          [tradeId]
        );
        assert.strictEqual(beforeDelete.rows[0].buyer_id, tradeUser.userId);
        assert.strictEqual(beforeDelete.rows[0].seller_id, tradeUser.userId);

        // Delete the user via cleanupTestUser (which cascades)
        // This removes the user from tracking so we don't double-delete
        const userIdToDelete = tradeUser.userId;
        const idx = createdUserIds.indexOf(userIdToDelete);
        if (idx !== -1) createdUserIds.splice(idx, 1);

        await cleanupTestUser(userIdToDelete);

        // Verify market_trades still exists but buyer_id and seller_id are NULL
        const afterDelete = await query(
          'SELECT id, buyer_id, seller_id FROM market_trades WHERE id = $1',
          [tradeId]
        );
        assert.ok(afterDelete.rows.length > 0, 'market_trades row should still exist');
        assert.strictEqual(afterDelete.rows[0].buyer_id, null, 'buyer_id should be NULL after FK SET NULL');
        assert.strictEqual(afterDelete.rows[0].seller_id, null, 'seller_id should be NULL after FK SET NULL');
      } finally {
        // Cleanup
        if (tradeId) {
          await query('DELETE FROM market_trades WHERE id = $1', [tradeId]).catch(() => {});
        }
      }
    });
  });
});
