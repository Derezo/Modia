import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORLD_ROUTE_CONNECTION_COLUMNS,
  loadWorldSeedMetadata
} from '../../routes/world/navigation.js';

describe('persisted world seed metadata', () => {
  it('defines every persisted route field returned by navigation connection reads', () => {
    assert.deepEqual(WORLD_ROUTE_CONNECTION_COLUMNS, [
      'path_type',
      'route_id',
      'route_pair_key',
      'route_kind',
      'segment_kind',
      'segment_order',
      'difficulty_policy'
    ]);
  });

  it('maps the singleton metadata row without reading process.env', async () => {
    const calls = [];
    const seededAt = new Date('2026-07-27T12:00:00.000Z');
    const metadata = await loadWorldSeedMetadata(async (text, params) => {
      calls.push({ text, params });
      return {
        rows: [{
          seed_version: 3,
          world_seed: -42,
          generator_version: 2,
          random_stream_version: 5,
          structural_graph_hash: 'a'.repeat(64),
          output_hash: 'b'.repeat(64),
          route_manifest_hash: 'c'.repeat(64),
          world_node_count: '123',
          seeded_at: seededAt
        }]
      };
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /FROM seed_metadata/);
    assert.match(calls[0].text, /WHERE id = 1/);
    assert.equal(calls[0].params, undefined);
    assert.deepEqual(metadata, {
      seed: -42,
      worldSeed: -42,
      seedVersion: 3,
      generatorVersion: 2,
      randomStreamVersion: 5,
      structuralHash: 'a'.repeat(64),
      outputHash: 'b'.repeat(64),
      routeManifestHash: 'c'.repeat(64),
      worldNodeCount: 123,
      seededAt
    });
    assert.doesNotMatch(calls[0].text, /\broute_manifest\b(?!_hash)/);
  });

  it('returns null when no world has been seeded', async () => {
    const metadata = await loadWorldSeedMetadata(async () => ({ rows: [] }));
    assert.equal(metadata, null);
  });
});
