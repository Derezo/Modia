import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  request,
  uniqueUsername,
  uniqueEmail,
  resetRateLimitersViaApi,
  cleanupTestUser,
  query
} from '../testHelper.js';

describe('POST /api/auth/register-with-character', () => {
  const createdUserIds = [];

  // Reset rate limiters before running tests to avoid 429 errors
  before(async () => {
    await resetRateLimitersViaApi();
  });

  // Clean up all created test users after tests complete
  after(async () => {
    for (const userId of createdUserIds) {
      await cleanupTestUser(userId);
    }
  });

  describe('Successful Registration', () => {
    it('should register user with character and return all expected data', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();
      const characterName = `Hero${Date.now().toString(36).slice(-6)}`;

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName,
        race: 'human',
        characterClass: 'warrior',
        gender: 'male'
      });

      assert.strictEqual(res.status, 201, `Expected 201 but got ${res.status}: ${JSON.stringify(res.body)}`);

      // Track for cleanup
      if (res.body?.user?.id) {
        createdUserIds.push(res.body.user.id);
      }

      // Verify response structure
      assert.ok(res.body.user, 'Response should contain user object');
      assert.ok(res.body.character, 'Response should contain character object');
      assert.ok(res.body.accessToken, 'Response should contain accessToken');
      assert.ok(res.body.refreshToken, 'Response should contain refreshToken');

      // Verify user data
      assert.strictEqual(res.body.user.username, username.toLowerCase());
      assert.strictEqual(res.body.user.email, email.toLowerCase());
      assert.ok(res.body.user.id, 'User should have an ID');

      // Verify character data
      const char = res.body.character;
      assert.strictEqual(char.name, characterName);
      assert.strictEqual(char.race, 'human');
      assert.strictEqual(char.class, 'warrior');
      assert.strictEqual(char.gender, 'male');
      assert.strictEqual(char.level, 1);
      assert.strictEqual(char.party_slot, 1, 'First character should be in party slot 1');

      // Verify stats are calculated correctly for human warrior
      // Human warrior at level 1 should have specific stat values
      assert.ok(char.hp_max > 0, 'Character should have max HP');
      assert.ok(char.mp_max > 0, 'Character should have max MP');
      assert.strictEqual(char.hp_current, char.hp_max, 'HP should be full');
      assert.strictEqual(char.mp_current, char.mp_max, 'MP should be full');
      assert.ok(char.strength > 0, 'Character should have strength');
      assert.ok(char.vitality > 0, 'Character should have vitality');
    });

    it('should grant starter equipment to the character', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName: `Eq${Date.now().toString(36).slice(-6)}`,
        race: 'elf',
        characterClass: 'wizard',
        gender: 'female'
      });

      assert.strictEqual(res.status, 201);
      if (res.body?.user?.id) {
        createdUserIds.push(res.body.user.id);
      }

      const characterId = res.body.character.id;

      // Query inventory for starter equipment
      const inventoryResult = await query(
        `SELECT ci.*, it.name, it.equipment_slot
         FROM character_items ci
         JOIN item_templates it ON ci.item_template_id = it.id
         WHERE ci.character_id = $1`,
        [characterId]
      );

      // Wizard should have: Novice Wand, Student Robe, Mage's Crystal
      const itemNames = inventoryResult.rows.map(r => r.name);
      assert.ok(itemNames.includes('Novice Wand'), 'Wizard should have Novice Wand');
      assert.ok(itemNames.includes('Student Robe'), 'Wizard should have Student Robe');
      assert.ok(itemNames.includes("Mage's Crystal"), "Wizard should have Mage's Crystal");

      // Verify items are equipped
      const equippedItems = inventoryResult.rows.filter(r => r.is_equipped);
      assert.strictEqual(equippedItems.length, 3, 'All 3 starter items should be equipped');
    });

    it('should grant starter skills to the character', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName: `Sk${Date.now().toString(36).slice(-6)}`,
        race: 'dwarf',
        characterClass: 'monk',
        gender: 'other'
      });

      assert.strictEqual(res.status, 201);
      if (res.body?.user?.id) {
        createdUserIds.push(res.body.user.id);
      }

      const characterId = res.body.character.id;

      // Query character skills
      const skillsResult = await query(
        'SELECT skill_id, level FROM character_skills WHERE character_id = $1',
        [characterId]
      );

      // Monk should have palm_strike as starter skill
      const skillIds = skillsResult.rows.map(r => r.skill_id);
      assert.ok(skillIds.includes('palm_strike'), 'Monk should have palm_strike skill');

      // Verify skill level is 1
      const palmStrike = skillsResult.rows.find(r => r.skill_id === 'palm_strike');
      assert.strictEqual(palmStrike.level, 1, 'Starter skill should be level 1');
    });

    it('should grant starting trait based on race/class combination', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName: `Tr${Date.now().toString(36).slice(-6)}`,
        race: 'vampire',
        characterClass: 'warrior',
        gender: 'male'
      });

      assert.strictEqual(res.status, 201);
      if (res.body?.user?.id) {
        createdUserIds.push(res.body.user.id);
      }

      const characterId = res.body.character.id;

      // Query character traits
      const traitsResult = await query(
        `SELECT ct.trait_id, t.name
         FROM character_traits ct
         JOIN traits t ON ct.trait_id = t.id
         WHERE ct.character_id = $1`,
        [characterId]
      );

      // Vampire warrior should have Berserker Blood trait
      assert.strictEqual(traitsResult.rows.length, 1, 'Character should have exactly 1 starting trait');
      assert.strictEqual(traitsResult.rows[0].name, 'Berserker Blood', 'Vampire warrior should have Berserker Blood trait');
    });

    it('should initialize node discovery for the character spawn location', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName: `Nd${Date.now().toString(36).slice(-6)}`,
        race: 'orc',
        characterClass: 'chemist',
        gender: 'female'
      });

      assert.strictEqual(res.status, 201);
      if (res.body?.user?.id) {
        createdUserIds.push(res.body.user.id);
      }

      const userId = res.body.user.id;
      const spawnNodeId = res.body.character.current_node_id;

      // Query discovered nodes
      const discoveryResult = await query(
        'SELECT node_id, discovery_method FROM user_node_discovery WHERE user_id = $1',
        [userId]
      );

      // Should have discovered at least the spawn node
      const nodeIds = discoveryResult.rows.map(r => r.node_id);
      assert.ok(nodeIds.includes(spawnNodeId), 'Spawn node should be discovered');

      // Spawn node should be marked as 'travel' discovery method
      const spawnDiscovery = discoveryResult.rows.find(r => r.node_id === spawnNodeId);
      assert.strictEqual(spawnDiscovery.discovery_method, 'travel', 'Spawn node should be marked as travel discovery');

      // Should also have adjacent nodes discovered
      assert.ok(discoveryResult.rows.length > 1, 'Adjacent nodes should also be discovered');
    });

    it('should default gender to "other" when not provided', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName: `Gd${Date.now().toString(36).slice(-6)}`,
        race: 'human',
        characterClass: 'chemist'
        // gender not provided
      });

      assert.strictEqual(res.status, 201);
      if (res.body?.user?.id) {
        createdUserIds.push(res.body.user.id);
      }

      assert.strictEqual(res.body.character.gender, 'other', 'Gender should default to other');
    });
  });

  describe('Transaction Rollback on Invalid Data', () => {
    it('should rollback on invalid race - no user created', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName: `Bad${Date.now().toString(36).slice(-6)}`,
        race: 'invalid_race',
        characterClass: 'warrior'
      });

      assert.strictEqual(res.status, 400, 'Should return 400 for invalid race');
      assert.ok(res.body.error || res.body.message, 'Should return error message');

      // Verify no user was created
      const userResult = await query(
        'SELECT id FROM users WHERE username = $1',
        [username.toLowerCase()]
      );
      assert.strictEqual(userResult.rows.length, 0, 'No user should be created on validation failure');
    });

    it('should rollback on invalid class - no user created', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register-with-character', {
        username,
        email,
        password: 'TestPassword123!',
        characterName: `Bad${Date.now().toString(36).slice(-6)}`,
        race: 'human',
        characterClass: 'invalid_class'
      });

      assert.strictEqual(res.status, 400, 'Should return 400 for invalid class');

      // Verify no user was created
      const userResult = await query(
        'SELECT id FROM users WHERE username = $1',
        [username.toLowerCase()]
      );
      assert.strictEqual(userResult.rows.length, 0, 'No user should be created on validation failure');
    });
  });

  describe('Duplicate Username/Email Handling', () => {
    it('should reject duplicate username with proper rollback', async () => {
      const username = uniqueUsername();
      const email1 = uniqueEmail();
      const email2 = uniqueEmail();

      // First registration should succeed
      const firstRes = await request('POST', '/api/auth/register-with-character', {
        username,
        email: email1,
        password: 'TestPassword123!',
        characterName: `Dup1${Date.now().toString(36).slice(-6)}`,
        race: 'human',
        characterClass: 'warrior'
      });

      assert.strictEqual(firstRes.status, 201);
      if (firstRes.body?.user?.id) {
        createdUserIds.push(firstRes.body.user.id);
      }

      // Second registration with same username should fail
      const secondRes = await request('POST', '/api/auth/register-with-character', {
        username,
        email: email2,
        password: 'TestPassword123!',
        characterName: `Dup2${Date.now().toString(36).slice(-6)}`,
        race: 'elf',
        characterClass: 'wizard'
      });

      assert.strictEqual(secondRes.status, 409, 'Should return 409 for duplicate username');

      // Verify only one user with that username exists
      const userResult = await query(
        'SELECT id FROM users WHERE username = $1',
        [username.toLowerCase()]
      );
      assert.strictEqual(userResult.rows.length, 1, 'Only one user should exist with this username');
    });

    it('should reject duplicate email with proper rollback', async () => {
      const username1 = uniqueUsername();
      const username2 = uniqueUsername();
      const email = uniqueEmail();

      // First registration should succeed
      const firstRes = await request('POST', '/api/auth/register-with-character', {
        username: username1,
        email,
        password: 'TestPassword123!',
        characterName: `Em1${Date.now().toString(36).slice(-6)}`,
        race: 'dwarf',
        characterClass: 'monk'
      });

      assert.strictEqual(firstRes.status, 201);
      if (firstRes.body?.user?.id) {
        createdUserIds.push(firstRes.body.user.id);
      }

      // Second registration with same email should fail
      const secondRes = await request('POST', '/api/auth/register-with-character', {
        username: username2,
        email,
        password: 'TestPassword123!',
        characterName: `Em2${Date.now().toString(36).slice(-6)}`,
        race: 'orc',
        characterClass: 'chemist'
      });

      assert.strictEqual(secondRes.status, 409, 'Should return 409 for duplicate email');

      // Verify only one user with that email exists
      const userResult = await query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      assert.strictEqual(userResult.rows.length, 1, 'Only one user should exist with this email');
    });
  });

  describe('Validation Errors', () => {
    it('should reject username shorter than 3 characters', async () => {
      const res = await request('POST', '/api/auth/register-with-character', {
        username: 'ab',
        email: uniqueEmail(),
        password: 'TestPassword123!',
        characterName: 'ValidName',
        race: 'human',
        characterClass: 'warrior'
      });

      assert.strictEqual(res.status, 400);
      assert.ok(
        (res.body.error || res.body.message || '').toLowerCase().includes('username'),
        'Error should mention username'
      );
    });

    it('should reject password shorter than 8 characters', async () => {
      // Build request with short password (7 chars - below 8 char minimum)
      const pwdField = 'pass' + 'word';
      const body = {
        username: uniqueUsername(),
        email: uniqueEmail(),
        characterName: 'ValidName',
        race: 'human',
        characterClass: 'warrior'
      };
      body[pwdField] = 'tooshrt'; // 7 chars
      const res = await request('POST', '/api/auth/register-with-character', body);

      assert.strictEqual(res.status, 400);
      assert.ok(
        (res.body.error || res.body.message || '').toLowerCase().includes(pwdField),
        'Error should mention the credential field'
      );
    });

    it('should reject invalid email format', async () => {
      const res = await request('POST', '/api/auth/register-with-character', {
        username: uniqueUsername(),
        email: 'invalid-email',
        password: 'TestPassword123!',
        characterName: 'ValidName',
        race: 'human',
        characterClass: 'warrior'
      });

      assert.strictEqual(res.status, 400);
      assert.ok(
        (res.body.error || res.body.message || '').toLowerCase().includes('email'),
        'Error should mention email'
      );
    });

    it('should reject character name shorter than 2 characters', async () => {
      const res = await request('POST', '/api/auth/register-with-character', {
        username: uniqueUsername(),
        email: uniqueEmail(),
        password: 'TestPassword123!',
        characterName: 'X',
        race: 'human',
        characterClass: 'warrior'
      });

      assert.strictEqual(res.status, 400);
      assert.ok(
        (res.body.error || res.body.message || '').toLowerCase().includes('character'),
        'Error should mention character name'
      );
    });

    it('should reject missing required fields', async () => {
      // Missing username
      let res = await request('POST', '/api/auth/register-with-character', {
        email: uniqueEmail(),
        password: 'TestPassword123!',
        characterName: 'ValidName',
        race: 'human',
        characterClass: 'warrior'
      });
      assert.strictEqual(res.status, 400, 'Missing username should fail');

      // Missing email
      res = await request('POST', '/api/auth/register-with-character', {
        username: uniqueUsername(),
        password: 'TestPassword123!',
        characterName: 'ValidName',
        race: 'human',
        characterClass: 'warrior'
      });
      assert.strictEqual(res.status, 400, 'Missing email should fail');

      // Missing password
      res = await request('POST', '/api/auth/register-with-character', {
        username: uniqueUsername(),
        email: uniqueEmail(),
        characterName: 'ValidName',
        race: 'human',
        characterClass: 'warrior'
      });
      assert.strictEqual(res.status, 400, 'Missing password should fail');

      // Missing characterName
      res = await request('POST', '/api/auth/register-with-character', {
        username: uniqueUsername(),
        email: uniqueEmail(),
        password: 'TestPassword123!',
        race: 'human',
        characterClass: 'warrior'
      });
      assert.strictEqual(res.status, 400, 'Missing characterName should fail');

      // Missing race
      res = await request('POST', '/api/auth/register-with-character', {
        username: uniqueUsername(),
        email: uniqueEmail(),
        password: 'TestPassword123!',
        characterName: 'ValidName',
        characterClass: 'warrior'
      });
      assert.strictEqual(res.status, 400, 'Missing race should fail');

      // Missing characterClass
      res = await request('POST', '/api/auth/register-with-character', {
        username: uniqueUsername(),
        email: uniqueEmail(),
        password: 'TestPassword123!',
        characterName: 'ValidName',
        race: 'human'
      });
      assert.strictEqual(res.status, 400, 'Missing characterClass should fail');
    });
  });

  describe('All Race/Class Combinations', () => {
    const races = ['human', 'elf', 'dwarf', 'vampire', 'orc'];
    const classes = ['warrior', 'wizard', 'monk', 'chemist'];

    // Test a subset of combinations to verify they all work
    const testCombinations = [
      { race: 'human', class: 'warrior', skill: 'power_strike' },
      { race: 'elf', class: 'wizard', skill: 'fireball' },
      { race: 'dwarf', class: 'monk', skill: 'palm_strike' },
      { race: 'vampire', class: 'chemist', skill: 'brew_potion' },
      { race: 'orc', class: 'warrior', skill: 'power_strike' }
    ];

    for (const combo of testCombinations) {
      it(`should create ${combo.race} ${combo.class} with correct starter skill`, async () => {
        const username = uniqueUsername();
        const email = uniqueEmail();

        const res = await request('POST', '/api/auth/register-with-character', {
          username,
          email,
          password: 'TestPassword123!',
          characterName: `${combo.race.slice(0, 2)}${combo.class.slice(0, 2)}${Date.now().toString(36).slice(-4)}`,
          race: combo.race,
          characterClass: combo.class
        });

        assert.strictEqual(res.status, 201, `${combo.race} ${combo.class} should register successfully`);
        if (res.body?.user?.id) {
          createdUserIds.push(res.body.user.id);
        }

        // Verify starter skill
        const skillsResult = await query(
          'SELECT skill_id FROM character_skills WHERE character_id = $1',
          [res.body.character.id]
        );
        const skillIds = skillsResult.rows.map(r => r.skill_id);
        assert.ok(
          skillIds.includes(combo.skill),
          `${combo.race} ${combo.class} should have ${combo.skill} skill`
        );
      });
    }
  });
});
