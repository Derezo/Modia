import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { respawnPartyWithClient } from '../../routes/characters.js';

describe('character respawn battle lifecycle', () => {
  it('blocks respawn when any owned character is marked in battle', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
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
        if (sql.includes("status = 'active'")) {
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

    assert.match(calls[0].sql, /WHERE c\.user_id = \$1/);
    assert.match(calls[0].sql, /ORDER BY c\.id/);
    assert.match(calls[0].sql, /FOR UPDATE OF c/);
    assert.deepEqual(calls[0].params, [9]);
    assert.equal(calls.length, 2);
  });

  it('blocks respawn while an authoritative active battle exists', async () => {
    const client = {
      async query(sql) {
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
        if (sql.includes("status = 'active'")) {
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
        if (sql.includes("status = 'active'")) {
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
    assert.deepEqual(calls[2].params, [12, 9]);
    assert.match(calls[2].sql, /party_slot IS NOT NULL/);
  });
});
