import { test, expect } from './fixtures.js';
import {
  battleAction,
  clickNodeAction,
  createBattleReadyPlayer,
  currentBattleId,
  enterWorldMap,
  startBattleFromWorldMap,
  waitForPlayerTurn,
  waitForScene
} from './helpers/index.js';

/**
 * Battle System E2E Tests
 *
 * Each test provisions a fresh character on a forest node next to its castle
 * and starts a PvE battle the way a player does: node action menu > Battle >
 * formation grid > Start Battle. The battle map is canvas-drawn; actions are
 * driven through the DOM action bar (the "actionbar" action menu style).
 */

test.describe('Battle System', () => {
  test.describe.configure({ timeout: 120000 });

  test('should open the formation screen from a combat node', async ({ page, request }) => {
    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);

    await expect(page.locator('.node-action-menu__name')).toHaveText(player.battleNode.name);
    await clickNodeAction(page, 'battle');

    await waitForScene(page, 'battleFormation');
    await expect(page.locator('#bf-formation-grid-canvas')).toBeVisible({ timeout: 10000 });
    // Nothing is placed yet, so the battle cannot start.
    await expect(page.locator('.start-battle-btn')).toBeDisabled();
  });

  test('should start a battle once the party leader is placed', async ({ page, request }) => {
    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);

    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);

    const battleId = await currentBattleId(page);
    expect(battleId).toBeTruthy();
    // The server agrees this is the player's active battle.
    const current = await page.evaluate(() => window.game.api.getCurrentBattle());
    expect(current.battleId).toBe(battleId);
    expect(current.nodeName).toBe(player.battleNode.name);
  });

  test('should show the active unit and the action bar on the player turn', async ({ page, request }) => {
    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);
    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);

    const panel = page.locator('#active-unit-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(player.character.name);
    await expect(panel).toContainText(/HP/);
    await expect(panel).toContainText(/MP/);

    await expect(page.locator('.battle-action-bar')).toContainText(/your turn/i);
    for (const action of ['move', 'attack', 'skill', 'item', 'wait']) {
      await expect(battleAction(page, action)).toBeEnabled();
    }
  });

  test('should list the class skill and starter items', async ({ page, request }) => {
    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);
    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);

    await battleAction(page, 'skill').click();
    const skills = page.locator('#skill-dropdown');
    await expect(skills).toBeVisible();
    await expect(skills).toContainText('Power Strike');
    await expect(skills).toContainText(/10 MP/);
    await battleAction(page, 'skill').click();
    await expect(skills).toBeHidden();

    await battleAction(page, 'item').click();
    const items = page.locator('#item-dropdown');
    await expect(items).toBeVisible();
    for (const name of ['Antidote', 'Elixir', 'Hi-Potion', 'Mana Potion']) {
      await expect(items).toContainText(name);
    }
  });

  test('should list the combatants in the turn order', async ({ page, request }) => {
    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);
    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);

    await page.locator('.battle-menu-dropdown__trigger').click();
    await page.locator('.battle-menu-dropdown__item[data-action="turn-order"]').click();

    await expect(page.locator('.turn-order-modal-content')).toBeVisible();
    const names = await page.locator('.turn-order-unit__name').allInnerTexts();
    expect(names).toContain(player.character.name);
    expect(new Set(names).size).toBeGreaterThanOrEqual(2);

    await page.locator('.parchment-modal-close').click();
    await expect(page.locator('.turn-order-modal-content')).toHaveCount(0);
  });

  test('should enter and cancel attack targeting', async ({ page, request }) => {
    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);
    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);

    await battleAction(page, 'attack').click();
    await expect.poll(() => page.evaluate(() => window.game.scenes.getCurrentScene().currentAction))
      .toBe('attack');

    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(() => window.game.scenes.getCurrentScene().currentAction))
      .toBeNull();
    await expect(battleAction(page, 'attack')).toBeEnabled();
  });

  test('should not open Settings when Escape cancels targeting', async ({ page, request }) => {
    // Known bug: BattleInputHandler cancels the action on Escape, then
    // Game.setupGlobalKeyHandler sees no pending action and opens the Settings
    // modal for the same keypress. When this test starts failing as
    // "expected to fail", the bug is fixed: delete the test.fail() line.
    test.fail(true, 'Escape during battle targeting also opens the Settings modal');

    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);
    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);

    await battleAction(page, 'attack').click();
    await expect.poll(() => page.evaluate(() => window.game.scenes.getCurrentScene().currentAction))
      .toBe('attack');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.game.scenes.getCurrentScene().currentAction))
      .toBeNull();

    await page.waitForTimeout(500);
    expect(await page.evaluate(() => Boolean(window.game.settingsModal))).toBe(false);
  });

  test('should end the turn with Wait and get the turn back after the enemies act', async ({ page, request }) => {
    const player = await createBattleReadyPlayer(request);
    await enterWorldMap(page, player);
    await startBattleFromWorldMap(page);
    await waitForPlayerTurn(page);

    const revision = () => page.evaluate(() => window.game.scenes.getCurrentScene().stateRevision ?? 0);
    const before = await revision();
    await battleAction(page, 'wait').click();

    // battle.confirmEndTurn defaults on, so ending the turn asks for
    // confirmation first in a parchment dialog (c250c0cb replaced the native
    // window.confirm, which froze the game loop); answer it as a player would.
    const confirm = page.locator('.parchment-modal').filter({ hasText: /end your turn/i });
    await expect(confirm).toBeVisible();
    await confirm.locator('.parchment-modal-footer button', { hasText: 'End Turn' }).click();
    await expect(confirm).toHaveCount(0);

    // The server accepted the action: the battle state moved on. (The
    // "Turn Complete" banner can be gone again by the time it is polled when
    // the enemies act quickly, so the revision is the reliable signal.)
    await expect.poll(revision, { timeout: 30000 }).toBeGreaterThan(before);

    // The enemies take their turns, then control returns to the player.
    await waitForPlayerTurn(page, 90000);

    // The battle log recorded the round.
    await page.locator('.battle-menu-dropdown__trigger').click();
    await page.locator('.battle-menu-dropdown__item[data-action="battle-log"]').click();
    const log = page.locator('.parchment-modal');
    await expect(log).toContainText('Battle Log');
    await expect(log).not.toContainText('No actions yet');
    await page.locator('.parchment-modal-close').click();
  });
});
