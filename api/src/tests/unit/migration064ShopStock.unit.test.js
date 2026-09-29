/**
 * Migration 064 Part 3 matches npc_shop_inventory rows against an embedded
 * copy of SHOP_STOCK to decide which rows are native stock (keep restocking)
 * and which were created by player sells (stop restocking). If SHOP_STOCK
 * changes without the migration's VALUES list, native rows would be frozen or
 * player-sold rows would keep regenerating, so the two must stay identical.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SHOP_STOCK } from '../../db/templates/items.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(
  __dirname, '..', '..', 'migrations', '064_relic_redesign_and_cleanup.sql'
);

function parseNativeStock(sql) {
  const start = sql.indexOf('INSERT INTO migration_064_native_stock');
  assert.ok(start >= 0, 'native stock INSERT not found in migration 064');
  const end = sql.indexOf(';', start);
  const body = sql.slice(start, end);
  const rows = [...body.matchAll(/\('([a-z_]+)',\s*(\d+),\s*(\d+)\)/g)];
  return rows.map(([, shopType, templateId, qty]) => ({
    shopType,
    templateId: Number(templateId),
    qty: Number(qty)
  }));
}

const key = r => `${r.shopType}:${r.templateId}:${r.qty}`;

describe('migration 064 native shop stock', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('embeds exactly the SHOP_STOCK triples', () => {
    const fromMigration = parseNativeStock(sql).map(key).sort();
    const fromTemplates = Object.entries(SHOP_STOCK)
      .flatMap(([shopType, { items }]) =>
        items.map(i => key({ shopType, templateId: i.templateId, qty: i.qty })))
      .sort();
    assert.deepEqual(fromMigration, fromTemplates);
  });

  it('no longer uses the quantity > 50 heuristic', () => {
    assert.ok(!/quantity\s*>\s*50/.test(sql));
  });
});
