import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MAX_SOLUTION_MOVES,
  createPuzzleSolution,
  createPuzzleState,
  createRewardPreview,
  deriveStreamSeed,
  getAwardedGold,
  getTierDefinition,
  replayPuzzleMoves
} from '../../routes/ruins.js';

describe('ruins puzzle integrity', () => {
  it('derives stable, separate puzzle and reward streams from local_seed', () => {
    const localSeed = 987654321;
    const firstPuzzle = createPuzzleState(localSeed, 3);
    const secondPuzzle = createPuzzleState(localSeed, 3);
    const rewards = getTierDefinition(1).rewards;
    const firstReward = createRewardPreview(localSeed, rewards);
    const secondReward = createRewardPreview(localSeed, rewards);

    assert.deepStrictEqual(firstPuzzle, secondPuzzle);
    assert.deepStrictEqual(firstReward, secondReward);
    assert.notStrictEqual(
      deriveStreamSeed(localSeed, 0x52555A31),
      deriveStreamSeed(localSeed, 0x52575231)
    );
  });

  it('awards exactly the previewed gold for both par outcomes', () => {
    const preview = createRewardPreview(13579, getTierDefinition(1).rewards);

    assert.strictEqual(getAwardedGold(preview, 15, 15), preview.underParGold);
    assert.strictEqual(getAwardedGold(preview, 15, 16), preview.gold);
  });

  it('replays a legal move sequence and verifies the solved board', () => {
    const initialTiles = [1, 2, 3, 4, 5, 6, 7, 0, 8];
    const result = replayPuzzleMoves(initialTiles, 3, [8]);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.solved, true);
    assert.deepStrictEqual(result.tiles, [1, 2, 3, 4, 5, 6, 7, 8, 0]);
    assert.deepStrictEqual(initialTiles, [1, 2, 3, 4, 5, 6, 7, 0, 8]);
  });

  it('accepts the deterministic reverse path for a generated puzzle', () => {
    const localSeed = 24680;
    const initialTiles = createPuzzleState(localSeed, 4);
    const moves = createPuzzleSolution(localSeed, 4);
    const result = replayPuzzleMoves(initialTiles, 4, moves);

    assert.ok(moves.length <= MAX_SOLUTION_MOVES);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.solved, true);
  });

  it('rejects illegal, non-integer, unsolved, empty, and oversized sequences', () => {
    const initialTiles = [1, 2, 3, 4, 5, 6, 7, 0, 8];

    assert.strictEqual(replayPuzzleMoves(initialTiles, 3, [0]).valid, false);
    assert.strictEqual(replayPuzzleMoves(initialTiles, 3, [8.5]).valid, false);
    assert.strictEqual(replayPuzzleMoves(initialTiles, 3, [6]).solved, false);
    assert.strictEqual(replayPuzzleMoves(initialTiles, 3, []).valid, false);
    assert.strictEqual(
      replayPuzzleMoves(initialTiles, 3, Array(MAX_SOLUTION_MOVES + 1).fill(8)).valid,
      false
    );
  });

  it('accepts only persisted tiers in the supported 1..3 range', () => {
    assert.strictEqual(getTierDefinition(1).config.gridSize, 3);
    assert.strictEqual(getTierDefinition(2).config.gridSize, 4);
    assert.strictEqual(getTierDefinition(3).config.gridSize, 5);
    assert.throws(() => getTierDefinition(null), /invalid reward tier/);
    assert.throws(() => getTierDefinition(0), /invalid reward tier/);
    assert.throws(() => getTierDefinition(4), /invalid reward tier/);
  });

  it('rejects unusable persisted local seeds', () => {
    assert.throws(() => createPuzzleState(undefined, 3), /invalid local seed/);
    assert.throws(() => createPuzzleState(Number.MAX_SAFE_INTEGER + 1, 3), /invalid local seed/);
  });
});
