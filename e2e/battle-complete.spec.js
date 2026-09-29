import { test, expect } from './fixtures.js';
import {
  apiCall,
  battleAction,
  createBattleReadyPlayer,
  currentBattleId,
  enterWorldMap,
  sessionToken,
  startBattleFromWorldMap,
  waitForPlayerTurn,
  waitForScene,
  waitForWorldMapReady
} from './helpers/index.js';

/**
 * Battle lifecycle E2E Tests: persistence across a reload, and victory.
 *
 * Winning a real fight is long and random, so victory is forced with the
 * dev-only POST /api/debug/win-battle/:id (disabled in production). It
 * commits the battle result and broadcasts battle_end over the battle's
 * WebSocket room exactly like a won fight, so the client-side ending
 * (outro, rewards, return to the map) is the real one.
 */

test.describe('Battle Lifecycle', () => {
  test.describe.configure({ timeout: 120000 });

  let player;

  test.beforeEach(async ({ page, request }) => {
    player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);
    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);
  });

  test('should restore the same battle after a page reload', async ({ page }) => {
    const battleId = await currentBattleId(page);

    await page.reload();

    // The session check finds the active battle and reopens it directly.
    await waitForScene(page, 'battle', 30000);
    expect(await currentBattleId(page)).toBe(battleId);
    await waitForPlayerTurn(page);
    await expect(page.locator('#active-unit-panel')).toContainText(player.character.name);
  });

  test('should play the victory outro and return to the world map with rewards', async ({ page, request }) => {
    const battleId = await currentBattleId(page);
    const { body: before } = await apiCall(request, 'GET', '/auth/me', { token: player.token });

    const { body: result } = await apiCall(request, 'POST', `/debug/win-battle/${battleId}`, {
      token: await sessionToken(page)
    });
    expect(result.status).toBe('victory');
    expect(result.rewards.gold).toBeGreaterThan(0);
    expect(result.rewards.experience).toBeGreaterThan(0);

    // The canvas outro reveals the result, then waits for the player.
    await expect.poll(
      () => page.evaluate(() => window.game.scenes.getCurrentScene().outroSequence?.phase ?? null),
      { timeout: 30000 }
    ).toBe('awaiting_confirmation');
    await expect(battleAction(page, 'wait')).toBeDisabled();

    await page.keyboard.press('Enter');

    await waitForWorldMapReady(page);
    await expect(page.locator('.node-action-menu__name')).toHaveText(player.battleNode.name);

    const { body: after } = await apiCall(request, 'GET', '/auth/me', { token: player.token });
    expect(after.user.gold).toBe(before.user.gold + result.rewards.gold);
    await expect(page.locator('.profile-dropdown__gold-value'))
      .toHaveText(after.user.gold.toLocaleString('en-US'));

    const { body: world } = await apiCall(request, 'GET', '/world/nodes', { token: player.token });
    const node = world.nodes.find(candidate => candidate.id === player.battleNode.id);
    expect(node.cleared).toBe(true);
    expect(node.blocked).toBe(false);

    const { body: characters } = await apiCall(request, 'GET', '/characters', { token: player.token });
    const hero = characters.characters.find(character => character.id === player.character.id);
    expect(hero.in_battle).toBe(false);
    expect(hero.experience).toBeGreaterThan(player.character.experience ?? 0);
  });
});
