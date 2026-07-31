import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { respawnPartyWithClient } from '../../routes/characters.js';

describe('character respawn battle lifecycle', () => {
  it('blocks respawn when any owned character is marked in battle', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM users')) {
          return { rows: [{ id: 9 }] };
        }
        if (sql.includes('FROM characters c')) {
          return {
            rows: [
              {
                id: 1,
                party_slot: 1,
                home_region_id: 5,
                castle_node_id: 12,
                in_battle: false
              },
              {
                id: 2,
                party_slot: null,
                home_region_id: 5,
                castle_node_id: 12,
                in_battle: true
              }
            ]
          };
        }
        if (sql.includes('FROM battles')) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    await assert.rejects(
      respawnPartyWithClient(client, 9),
      error => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, 'Cannot respawn while in battle');
        return true;
      }
    );

    assert.match(calls[0].sql, /FROM users/);
    assert.match(calls[0].sql, /FOR UPDATE/);
    assert.match(calls[1].sql, /WHERE c\.user_id = \$1/);
    assert.match(calls[1].sql, /CASE WHEN c\.party_slot = 1/);
    assert.match(calls[1].sql, /FOR UPDATE OF c/);
    assert.deepEqual(calls[1].params, [9]);
    assert.equal(calls.length, 3);
  });

  it('blocks respawn while an authoritative active battle exists', async () => {
    const client = {
      async query(sql) {
        if (sql.includes('FROM users')) {
          return { rows: [{ id: 9 }] };
        }
        if (sql.includes('FROM characters c')) {
          return {
            rows: [{
              id: 1,
              party_slot: 1,
              home_region_id: 5,
              castle_node_id: 12,
              in_battle: false
            }]
          };
        }
        if (sql.includes('FROM battles')) {
          assert.match(sql, /FROM battle_players/);
          return { rows: [{ id: 41 }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    await assert.rejects(
      respawnPartyWithClient(client, 9),
      error => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, 'Cannot respawn while in battle');
        return true;
      }
    );
  });

  it('moves party characters after both battle checks pass', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM users')) {
          return { rows: [{ id: 9 }] };
        }
        if (sql.includes('FROM characters c')) {
          return {
            rows: [{
              id: 1,
              party_slot: 1,
              home_region_id: 5,
              castle_node_id: 12,
              in_battle: false
            }]
          };
        }
        if (sql.includes('FROM battles')) {
          return { rows: [] };
        }
        if (sql.includes('FROM user_fishing_sessions')) {
          return { rows: [] };
        }
        if (sql.includes('UPDATE characters')) {
          return {
            rows: [{ id: 1, name: 'Leader', current_node_id: 12 }]
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    assert.deepEqual(
      await respawnPartyWithClient(client, 9),
      {
        nodeId: 12,
        characters: [{ id: 1, name: 'Leader', current_node_id: 12 }]
      }
    );
    assert.deepEqual(calls[4].params, [12, 9]);
    assert.match(calls[4].sql, /party_slot IS NOT NULL/);
  });

  it('blocks respawn while an unexpired fishing session is active', async () => {
    const client = {
      async query(sql) {
        if (sql.includes('FROM users')) return { rows: [{ id: 9 }] };
        if (sql.includes('FROM characters c')) {
          return {
            rows: [{
              id: 1,
              party_slot: 1,
              home_region_id: 5,
              castle_node_id: 12,
              in_battle: false
            }]
          };
        }
        if (sql.includes('FROM battles')) return { rows: [] };
        if (sql.includes('FROM user_fishing_sessions')) {
          assert.match(sql, /status IN \('active', 'expired'\)/);
          return {
            rows: [{
              session_id: 'c6d60bb8-5594-45d6-89cc-fadcb4c533da',
              node_id: 7,
              node_name: 'Willow Pond',
              status: 'active'
            }]
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    await assert.rejects(
      respawnPartyWithClient(client, 9),
      error => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /Pack up and collect/);
        return true;
      }
    );
  });
});
