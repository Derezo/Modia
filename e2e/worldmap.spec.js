import { test, expect } from './fixtures.js';
import {
  apiCall,
  createPlayer,
  enterWorldMap,
  openProfileMenuItem,
  waitForScene,
  waitForWorldMapReady
} from './helpers/index.js';

/**
 * World Map E2E Tests
 *
 * The map is canvas-drawn; nodes are located through the scene's own
 * projection (WorldMapScene.getNodeScreenPosition) and clicked with the mouse
 * at that viewport point, exactly where a player would click.
 */

/**
 * Adjacent nodes of the current node whose centre lies inside the viewport.
 * @returns {Promise<Array<{ id: number, name: string, type: string, x: number, y: number }>>}
 */
function visibleAdjacentNodes(page) {
  return page.evaluate(() => {
    const scene = window.game.scenes.getCurrentScene();
    return scene.nodes
      .filter(node => scene.isNodeAdjacent(node))
      .map(node => ({ node, pos: scene.getNodeScreenPosition(node) }))
      .filter(({ pos }) => pos
        && pos.x > 40 && pos.x < window.innerWidth - 40
        && pos.y > 80 && pos.y < window.innerHeight - 80)
      .map(({ node, pos }) => ({ id: node.id, name: node.name, type: node.node_type, x: pos.x, y: pos.y }));
  });
}

test.describe('World Map', () => {
  let player;

  test.beforeEach(async ({ page, request }) => {
    player = await createPlayer(request);
    await enterWorldMap(page, player);
  });

  test('should show the castle actions for the starting node', async ({ page }) => {
    await expect(page.locator('#game-canvas')).toBeVisible();
    await expect(page.locator('.node-action-menu__badge')).toHaveText(/castle/i);

    const actions = await page.locator('.node-action-menu [data-action]')
      .evaluateAll(els => els.map(el => el.dataset.action));
    for (const feature of ['blacksmith', 'marketplace', 'tavern', 'apothecary', 'coliseum', 'garrison']) {
      expect(actions).toContain(feature);
    }
    // A castle is not a combat node.
    expect(actions).not.toContain('battle');
  });

  test('should show the account gold in the profile HUD', async ({ page }) => {
    await expect(page.locator('.profile-dropdown__gold-value'))
      .toHaveText(player.gold.toLocaleString('en-US'));
  });

  test('should list the profile menu entries', async ({ page }) => {
    await page.locator('.profile-dropdown__trigger').click();

    const entries = await page.locator('.profile-dropdown__menu-item[data-action]')
      .evaluateAll(els => els.map(el => el.dataset.action));
    expect(entries).toEqual(expect.arrayContaining(
      ['formation', 'friends', 'quests', 'leaderboard', 'settings', 'logout']
    ));
  });

  test('should show a mystery tooltip when hovering an unvisited adjacent node', async ({ page }) => {
    const [target] = await visibleAdjacentNodes(page);
    expect(target, 'an adjacent node is on screen').toBeTruthy();

    await page.mouse.move(target.x, target.y);

    // A fresh character has only visited its castle; neighbours are known
    // to exist but keep their names hidden until visited.
    const tooltip = page.locator('.node-hover-tooltip__name');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toHaveText('Undiscovered');
    await expect(tooltip).toHaveClass(/node-hover-tooltip__name--mystery/);
  });

  test('should travel to an adjacent node when it is clicked', async ({ page, request }) => {
    const [target] = await visibleAdjacentNodes(page);
    expect(target, 'an adjacent node is on screen').toBeTruthy();

    await page.mouse.click(target.x, target.y);

    await expect(page.locator('.node-action-menu__name')).toHaveText(target.name, { timeout: 15000 });
    const { body } = await apiCall(request, 'GET', '/world/current', { token: player.token });
    expect(body.currentNode.id).toBe(target.id);

    // Combat nodes offer a battle.
    if (['forest', 'cave', 'mountain', 'bridge'].includes(target.type)) {
      await expect(page.locator('.node-action-menu [data-action="battle"]')).toBeVisible();
    }
  });

  test('should open a scene from the profile menu and return', async ({ page }) => {
    await openProfileMenuItem(page, 'leaderboard');
    await waitForScene(page, 'leaderboard');

    // Every scene clears the UI overlay; the node menu is gone until return.
    await expect(page.locator('.node-action-menu--expanded')).toHaveCount(0);

    await page.locator('.leaderboard-back-btn').click();
    await waitForWorldMapReady(page);
  });

  test('should log out from the profile menu', async ({ page }) => {
    await openProfileMenuItem(page, 'logout');

    await expect(page.locator('#auth-form')).toBeVisible({ timeout: 10000 });
    const stored = await page.evaluate(() => sessionStorage.getItem('modia_auth'));
    expect(stored === null || JSON.parse(stored).token === null).toBe(true);
  });
});
