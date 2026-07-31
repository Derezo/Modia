import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const servicePath = new URL('../../services/fishingService.js', import.meta.url);
const routePath = new URL('../../routes/fishing.js', import.meta.url);
const travelGuardPath = new URL('../../services/fishingTravelGuard.js', import.meta.url);
const travelPath = new URL('../../routes/world/navigation.js', import.meta.url);
const fastTravelPath = new URL('../../routes/world/progression.js', import.meta.url);

describe('authoritative fishing lifecycle wiring', () => {
  it('uses database time and cryptographic randomness, never client reward fields', async () => {
    const source = await readFile(servicePath, 'utf8');
    assert.match(source, /SELECT clock_timestamp\(\) AS now/);
    assert.match(source, /randomInt\(/);
    assert.doesNotMatch(source, /options\.(fish|rarity|value|success|biome)/);
  });

  it('locks user, party leader, session, attempt, then tackle inventory', async () => {
    const source = await readFile(servicePath, 'utf8');
    const mutationStart = source.indexOf('async function withFishingMutation');
    const userLock = source.indexOf('lockUser(client', mutationStart);
    const leaderLock = source.indexOf('lockPartyLeader(client', mutationStart);
    const sessionLock = source.indexOf('loadSessionForUpdate', leaderLock);
    const attemptLock = source.indexOf('loadAttemptForUpdate', sessionLock);
    const inventoryLock = source.indexOf('consumeTackle', attemptLock);
    assert.ok(userLock > mutationStart);
    assert.ok(leaderLock > userLock);
    assert.ok(sessionLock > leaderLock);
    assert.ok(attemptLock > sessionLock);
    assert.ok(inventoryLock > attemptLock);
  });

  it('consumes tackle only while transitioning a locked cast to wait', async () => {
    const source = await readFile(servicePath, 'utf8');
    const releaseStart = source.indexOf('export async function releaseCast');
    const releaseEnd = source.indexOf('export async function hookBite');
    const release = source.slice(releaseStart, releaseEnd);
    assert.match(release, /attempt\.phase !== 'cast'/);
    assert.match(release, /await consumeTackle/);
    assert.match(release, /SET phase = 'wait'/);
  });

  it('casts shared phase placeholders consistently during timed hydration transitions', async () => {
    const source = await readFile(servicePath, 'utf8');
    const transitionStart = source.indexOf('async function writeAttemptPhase');
    const transitionEnd = source.indexOf('async function advanceTimedAttempt');
    const transition = source.slice(transitionStart, transitionEnd);
    assert.match(transition, /SET phase = \$1::VARCHAR\(16\)/);
    assert.match(
      transition,
      /WHEN \$1::VARCHAR\(16\) IN \('resolved', 'cancelled'\)/
    );
  });

  it('does not append new catches to legacy session JSON', async () => {
    const source = await readFile(servicePath, 'utf8');
    const resolveStart = source.indexOf('export async function resolveAttempt');
    const resolveEnd = source.indexOf('export async function endSession');
    const resolve = source.slice(resolveStart, resolveEnd);
    assert.match(resolve, /INSERT INTO user_fishing_catches/);
    assert.match(
      resolve,
      /ON CONFLICT \(attempt_id\) WHERE attempt_id IS NOT NULL DO NOTHING/
    );
    assert.doesNotMatch(resolve, /SET catches =/);
  });

  it('updates catch and credited-gold quests within the committing transaction', async () => {
    const source = await readFile(servicePath, 'utf8');
    assert.match(source, /updateProgressWithClient\(\s*client,\s*leader\.id,\s*'fish_catches'/s);
    assert.match(source, /updateProgressWithClient\(\s*client,\s*leader\.id,\s*'gold_earned'/s);
    assert.doesNotMatch(source, /fireFishCatchProgress/);
  });

  it('reports basket, credited, and gold-cap overflow independently', async () => {
    const source = await readFile(servicePath, 'utf8');
    assert.match(source, /basketValue/);
    assert.match(source, /creditedGold/);
    assert.match(source, /overflowLost/);
    assert.match(source, /MAX_GOLD - startingGold/);
  });

  it('restores unsettled baskets while allowing battle-safe remote packing', async () => {
    const [service, travelGuard] = await Promise.all([
      readFile(servicePath, 'utf8'),
      readFile(travelGuardPath, 'utf8')
    ]);
    const endStart = service.indexOf('export async function endSession');
    const statusStart = service.indexOf('async function readSessionStatus', endStart);
    const end = service.slice(endStart, statusStart);
    assert.match(end, /requireLocation: false/);
    assert.match(end, /await assertNotInBattle\(client, userId, leader\)/);
    assert.match(travelGuard, /status IN \('active', 'expired'\)/);
  });

  it('exposes every new route and permanently retires insecure endpoints', async () => {
    const source = await readFile(routePath, 'utf8');
    for (const route of [
      '/:nodeId/setup',
      '/:nodeId/start',
      '/:nodeId/gear',
      '/:nodeId/cast',
      '/:nodeId/casts/:attemptId/release',
      '/:nodeId/casts/:attemptId/hook',
      '/:nodeId/casts/:attemptId/reel',
      '/:nodeId/casts/:attemptId/resolve',
      '/:nodeId/end'
    ]) {
      assert.ok(source.includes(route), `missing ${route}`);
    }
    assert.match(source, /router\.post\('\/:nodeId\/catch'.*gone\)/s);
    assert.match(source, /router\.post\('\/:nodeId\/big-one'.*gone\)/s);
    assert.match(source, /410/);
  });

  it('applies the fishing limiter to every mutation including cue actions', async () => {
    const source = await readFile(routePath, 'utf8');
    const mutationCount = (source.match(/fishingLimiter/g) || []).length - 1;
    assert.ok(mutationCount >= 10);
  });

  it('makes normal and fast travel share the fishing lock guard', async () => {
    const normal = await readFile(travelPath, 'utf8');
    const fast = await readFile(fastTravelPath, 'utf8');
    for (const source of [normal, fast]) {
      assert.match(source, /withTransaction/);
      assert.match(source, /assertNoUnsettledFishingSession/);
      assert.match(source, /SELECT id.*FROM users.*FOR UPDATE/s);
      assert.match(source, /party_slot = 1.*FOR UPDATE/s);
    }
  });
});
