import { test, expect } from './fixtures.js';
import {
  apiCall,
  createPlayer,
  enterWorldMap,
  login,
  waitForScene
} from './helpers/index.js';

/**
 * Character routing after login.
 *
 * There is no character-select screen: AuthScene sends an account without a
 * character to CharacterCreateScene, and otherwise selects the party leader
 * (party_slot 1) automatically and opens the world map.
 */

test.describe('Character Management', () => {
  test('should send an account without a character to character creation', async ({ page, request }) => {
    const player = await createPlayer(request, { withCharacter: false });
    await login(page, player.username, player.password);

    await waitForScene(page, 'characterCreate');
    await expect(page.locator('#race-select')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#class-select')).toBeVisible();
    await expect(page.locator('#create-btn')).toBeDisabled();
  });

  test('should enter the world map as the party leader', async ({ page, request }) => {
    const player = await createPlayer(request, { race: 'elf', characterClass: 'wizard' });
    await enterWorldMap(page, player);

    const active = await page.evaluate(() => window.game.state.get('activeCharacter'));
    expect(active.id).toBe(player.character.id);
    expect(active.name).toBe(player.character.name);
    expect(active.party_slot).toBe(1);
  });

  test('should start the character at its region castle', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);

    const { body } = await apiCall(request, 'GET', '/world/current', { token: player.token });
    expect(body.currentNode.node_type).toBe('castle');
    await expect(page.locator('.node-action-menu__name')).toHaveText(body.currentNode.name);
    await expect(page.locator('.node-action-menu__badge')).toHaveText(/castle/i);
  });

  test('should resume on the world map after a page reload', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);

    await page.reload();

    // The session is restored from sessionStorage without the login form.
    await waitForScene(page, 'worldMap', 20000);
    await expect(page.locator('#auth-form')).toHaveCount(0);
    const user = await page.evaluate(() => window.game.state.get('user'));
    expect(user.username).toBe(player.username);
  });
});
