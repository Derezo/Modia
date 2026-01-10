import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { request, createTestUser, createTestCharacter } from './testHelper.js';

describe('Inventory API', () => {
  let user = null;
  let character = null;

  before(async () => {
    user = await createTestUser();
    character = await createTestCharacter(user.accessToken);
  });

  describe('GET /api/inventory/:characterId', () => {
    it('should return character inventory', async () => {
      const res = await request('GET', `/api/inventory/${character.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.equipped !== undefined);
      assert.ok(res.body.inventory !== undefined);
      assert.ok(typeof res.body.equipped === 'object');
      assert.ok(Array.isArray(res.body.inventory));
    });

    it('should reject access to another user inventory', async () => {
      const otherUser = await createTestUser();
      const otherChar = await createTestCharacter(otherUser.accessToken);

      const res = await request('GET', `/api/inventory/${otherChar.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should return 404 for non-existent character', async () => {
      const res = await request('GET', '/api/inventory/999999', null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('GET', `/api/inventory/${character.id}`);

      assert.strictEqual(res.status, 401);
    });
  });

  describe('POST /api/inventory/equip', () => {
    it('should reject equip with invalid slot', async () => {
      const res = await request('POST', '/api/inventory/equip', {
        characterId: character.id,
        itemInstanceId: 1,
        slot: 'invalid_slot'
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should reject equip without required fields', async () => {
      const res = await request('POST', '/api/inventory/equip', {
        characterId: character.id
      }, user.accessToken);

      // Missing itemInstanceId and slot
      assert.strictEqual(res.status, 400);
    });

    it('should reject unauthenticated equip', async () => {
      const res = await request('POST', '/api/inventory/equip', {
        characterId: character.id,
        itemInstanceId: 1,
        slot: 'main_hand'
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('POST /api/inventory/unequip', () => {
    it('should reject unequip with invalid slot', async () => {
      const res = await request('POST', '/api/inventory/unequip', {
        characterId: character.id,
        slot: 'invalid_slot'
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should return error when no item equipped in slot', async () => {
      const res = await request('POST', '/api/inventory/unequip', {
        characterId: character.id,
        slot: 'main_hand'
      }, user.accessToken);

      // Should fail since nothing is equipped
      assert.ok([400, 404].includes(res.status));
    });
  });

  describe('POST /api/inventory/use', () => {
    it('should reject using non-existent item', async () => {
      const res = await request('POST', '/api/inventory/use', {
        characterId: character.id,
        itemInstanceId: 999999
      }, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should reject unauthenticated use', async () => {
      const res = await request('POST', '/api/inventory/use', {
        characterId: character.id,
        itemInstanceId: 1
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('POST /api/inventory/discard', () => {
    it('should reject discarding non-existent item', async () => {
      const res = await request('POST', '/api/inventory/discard', {
        characterId: character.id,
        itemInstanceId: 999999
      }, user.accessToken);

      assert.strictEqual(res.status, 404);
    });
  });
});
