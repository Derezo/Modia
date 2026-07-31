import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTHORITATIVE_FISHING_CONFIG,
  castPowerFromElapsed,
  claimBigOne,
  depthFromCastPower,
  fishingAttemptFitsSession,
  hashFishingAction,
  registerCatch,
  stopCleanupScheduler
} from '../../services/fishingService.js';

stopCleanupScheduler();

describe('authoritative fishing protocol helpers', () => {
  it('uses the exact 1.6-second server receive-time cast meter', () => {
    assert.equal(AUTHORITATIVE_FISHING_CONFIG.castPowerDurationMs, 1600);
    assert.equal(castPowerFromElapsed(-50), 0);
    assert.equal(castPowerFromElapsed(0), 0);
    assert.equal(castPowerFromElapsed(640), 40);
    assert.equal(castPowerFromElapsed(1200), 75);
    assert.equal(castPowerFromElapsed(1600), 100);
    assert.equal(castPowerFromElapsed(5000), 100);
  });

  it('maps exact power boundaries to Near, Mid, and Deep', () => {
    for (const power of [0, 1, 39]) assert.equal(depthFromCastPower(power), 'near');
    for (const power of [40, 41, 74]) assert.equal(depthFromCastPower(power), 'mid');
    for (const power of [75, 99, 100]) assert.equal(depthFromCastPower(power), 'deep');
  });

  it('publishes the required hook, reel, cue, and session timings', () => {
    assert.deepEqual(AUTHORITATIVE_FISHING_CONFIG, {
      sessionDurationMs: 1_800_000,
      castPowerDurationMs: 1600,
      hookWindowMs: 3000,
      normalReelDurationMs: 6000,
      hardReelDurationMs: 8000,
      normalCueCount: 3,
      hardCueCount: 4,
      normalRequiredHits: 2,
      hardRequiredHits: 3,
      bigCatchChance: 0.20,
      minWaitMs: 8000
    });
  });

  it('does not consume tackle for a cast that cannot finish before expiry', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    assert.equal(fishingAttemptFitsSession({
      now,
      sessionExpiresAt: new Date(now.getTime() + 46_001),
      waitMs: 35_000,
      reelDurationMs: 8_000
    }), true);
    assert.equal(fishingAttemptFitsSession({
      now,
      sessionExpiresAt: new Date(now.getTime() + 46_000),
      waitMs: 35_000,
      reelDurationMs: 8_000
    }), false);
  });

  it('hashes canonical payloads independently of object key order', () => {
    const one = hashFishingAction('reel', 7, 9, {
      attemptId: 'a',
      nested: { y: 2, x: 1 },
      direction: 'left'
    });
    const two = hashFishingAction('reel', 7, 9, {
      direction: 'left',
      nested: { x: 1, y: 2 },
      attemptId: 'a'
    });
    assert.equal(one, two);
    assert.match(one, /^[0-9a-f]{64}$/);
  });

  it('changes the request hash when an action UUID is reused with new semantics', () => {
    assert.notEqual(
      hashFishingAction('gear', 7, 9, { rodKey: 'weathered_rod' }),
      hashFishingAction('gear', 7, 9, { rodKey: 'runebound_rod' })
    );
    assert.notEqual(
      hashFishingAction('hook', 7, 9, { attemptId: 'a' }),
      hashFishingAction('resolve', 7, 9, { attemptId: 'a' })
    );
  });

  it('retires both insecure client-timed service entry points', async () => {
    await assert.rejects(registerCatch(), error => error.statusCode === 410);
    await assert.rejects(claimBigOne(), error => error.statusCode === 410);
  });
});
