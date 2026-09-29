/**
 * Game-state helpers for E2E tests.
 *
 * Modia is a single-page canvas app: there is no URL routing and the session
 * lives in sessionStorage ('modia_auth') and the game's StateManager, not in
 * localStorage. Scene changes are observed through the `window.game` handle
 * that main.js exposes on localhost, and players are provisioned through the
 * real API so each test starts from a known, isolated account.
 */

import { expect } from '@playwright/test';

export const API_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;

/**
 * The API's dev-only rate-limit bypass (rateLimiterFactory.js). The e2e suite
 * logs in far more often than the 50-per-15-minutes dev auth limit allows, so
 * both provisioning calls and the browser's own /api traffic carry it. It is
 * ignored when NODE_ENV=production. Rate limiting itself is covered by
 * `npm run test:ratelimit -w api`.
 */
export const RATE_LIMIT_BYPASS_HEADERS = Object.freeze({
  'x-test-bypass-rate-limit': process.env.TEST_BYPASS_SECRET || 'modia-test-bypass-2024'
});

/** Every account this suite creates starts with this prefix (see globalTeardown). */
export const E2E_USERNAME_PREFIX = 'e2etest_';

export const E2E_PASSWORD = 'TestPassword123!';

/** Node types that host PvE battles (shared/constants.js BATTLE_NODE_TYPES). */
export const BATTLE_NODE_TYPES = Object.freeze(['forest', 'cave', 'mountain', 'bridge']);

/**
 * Unique credentials for a throwaway account (username max 32 chars).
 * @returns {{ username: string, email: string, password: string }}
 */
export function uniqueCredentials() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const username = `${E2E_USERNAME_PREFIX}${suffix}`;
  return { username, email: `${username}@test.com`, password: E2E_PASSWORD };
}

/**
 * Short unique character name (2-24 chars).
 * @param {string} [prefix]
 */
export function uniqueCharacterName(prefix = 'Hero') {
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
}

/**
 * Call the API directly (not through the browser). Fails the test on a
 * non-2xx status unless `expectStatus` names the expected one.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} path - Path under /api, e.g. '/world/current'
 * @param {{ token?: string, data?: object, expectStatus?: number }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function apiCall(request, method, path, { token, data, expectStatus } = {}) {
  const response = await request.fetch(`${API_ORIGIN}/api${path}`, {
    method,
    headers: {
      // A fresh connection per call: a reused keep-alive socket that the API
      // (5s keepAliveTimeout) has just closed surfaces as ECONNRESET.
      Connection: 'close',
      ...RATE_LIMIT_BYPASS_HEADERS,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    data
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  const status = response.status();
  if (expectStatus !== undefined) {
    expect(status, `${method} ${path}: ${text.slice(0, 300)}`).toBe(expectStatus);
  } else {
    expect(response.ok(), `${method} ${path} returned ${status}: ${text.slice(0, 300)}`).toBe(true);
  }
  return { status, body };
}

/**
 * Register a fresh account through the API and give it a first character.
 * The character starts at the region castle (King's Keep for humans).
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ race?: string, characterClass?: string, gender?: string, withCharacter?: boolean }} [options]
 */
export async function createPlayer(request, {
  race = 'human',
  characterClass = 'warrior',
  gender = 'male',
  withCharacter = true
} = {}) {
  const credentials = uniqueCredentials();
  const { body: registered } = await apiCall(request, 'POST', '/auth/register', {
    data: credentials,
    expectStatus: 201
  });

  let character = null;
  if (withCharacter) {
    const { body } = await apiCall(request, 'POST', '/characters', {
      token: registered.accessToken,
      data: { name: uniqueCharacterName(), race, characterClass, gender },
      expectStatus: 201
    });
    character = body.character;
  }

  return {
    ...credentials,
    userId: registered.user.id,
    gold: registered.user.gold,
    token: registered.accessToken,
    character
  };
}

/**
 * Move a player (server side, through the real travel endpoint) to a node
 * adjacent to its current one that matches `predicate`.
 * @returns {Promise<object>} The destination node
 */
export async function travelToAdjacentNode(request, token, predicate) {
  const { body: current } = await apiCall(request, 'GET', '/world/current', { token });
  const currentId = current.currentNode.id;
  const { body: world } = await apiCall(request, 'GET', '/world/nodes', { token });
  const adjacentIds = new Set(world.connections
    .filter(c => c.from_node_id === currentId || c.to_node_id === currentId)
    .map(c => (c.from_node_id === currentId ? c.to_node_id : c.from_node_id)));
  const target = world.nodes.find(node => adjacentIds.has(node.id) && predicate(node));
  expect(target, `no adjacent node from ${currentId} matches the predicate`).toBeTruthy();

  await apiCall(request, 'POST', '/world/travel', { token, data: { targetNodeId: target.id } });
  return target;
}

/** Travel to an adjacent node that hosts PvE battles. */
export function travelToAdjacentBattleNode(request, token) {
  return travelToAdjacentNode(request, token, node => BATTLE_NODE_TYPES.includes(node.node_type));
}

/**
 * Name of the active scene (SceneManager key, e.g. 'worldMap', 'battle').
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string|null>}
 */
export function currentScene(page) {
  return page.evaluate(() => window.game?.state?.get('currentScene') ?? null);
}

/**
 * Wait until the game has switched to `sceneName`.
 * @param {import('@playwright/test').Page} page
 * @param {string} sceneName
 * @param {number} [timeout]
 */
export async function waitForScene(page, sceneName, timeout = 15000) {
  await expect.poll(() => currentScene(page), {
    message: `waiting for scene '${sceneName}'`,
    timeout
  }).toBe(sceneName);
}

/**
 * The access token the running game holds (StateManager), or null.
 * @param {import('@playwright/test').Page} page
 */
export function sessionToken(page) {
  return page.evaluate(() => window.game?.state?.get('token') ?? null);
}

/**
 * Wait for the world map to finish loading: the scene is active and the
 * node action menu for the current node is shown and expanded.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForWorldMapReady(page) {
  await waitForScene(page, 'worldMap', 20000);
  await expect(page.locator('.node-action-menu.node-action-menu--expanded'))
    .toBeVisible({ timeout: 20000 });
}

/**
 * Click a feature button in the node action menu (e.g. 'blacksmith',
 * 'marketplace', 'battle').
 * @param {import('@playwright/test').Page} page
 * @param {string} feature
 */
export async function clickNodeAction(page, feature) {
  const button = page.locator(`.node-action-menu [data-action="${feature}"]`);
  await expect(button).toBeVisible({ timeout: 10000 });
  await button.click();
}

/**
 * Open a profile dropdown menu entry (formation, quests, settings, ...).
 * @param {import('@playwright/test').Page} page
 * @param {string} action
 */
export async function openProfileMenuItem(page, action) {
  await page.locator('.profile-dropdown__trigger').click();
  const item = page.locator(`.profile-dropdown__menu-item[data-action="${action}"]`);
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
}

/**
 * From the world map at a battle node: open the formation scene, place the
 * party leader on the grid and start the battle.
 * @param {import('@playwright/test').Page} page
 */
export async function startBattleFromWorldMap(page) {
  await clickNodeAction(page, 'battle');
  await waitForScene(page, 'battleFormation');

  const gridCanvas = page.locator('#bf-formation-grid-canvas');
  await expect(gridCanvas).toBeVisible({ timeout: 10000 });
  const startButton = page.locator('#bf-start-button-container button');
  await expect(startButton).toBeDisabled();

  // The formation grid is canvas-drawn; click the centre of tile (2,1) using
  // the grid's own projection so the click lands regardless of layout. The
  // roster and the grid's final size load asynchronously, so retry the click
  // until the placement registers (a repeat click on the same tile keeps a
  // lone character in place).
  await expect.poll(() => page.evaluate(() => {
    const scene = window.game.scenes.getCurrentScene();
    return Boolean(scene.formationGrid?.canvas) && (scene.selectableCharacters?.length ?? 0) > 0;
  }), { timeout: 15000 }).toBe(true);
  await expect(async () => {
    const point = await page.evaluate(() =>
      window.game.scenes.getCurrentScene().formationGrid.gridToScreen(2, 1)
    );
    await gridCanvas.click({ position: { x: point.x, y: point.y } });
    await expect(startButton).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 15000 });

  await startButton.click();
  await waitForScene(page, 'battle', 20000);
}

/**
 * Provision a player standing on a PvE battle node, with the battle action
 * menu set to the DOM action bar (a real user preference: Settings > Battle >
 * Action menu style). The default radial menu only opens from a click on the
 * unit's canvas position; the action bar exposes the same actions as buttons.
 * @param {import('@playwright/test').APIRequestContext} request
 */
export async function createBattleReadyPlayer(request) {
  const player = await createPlayer(request);
  await apiCall(request, 'PUT', '/settings', {
    token: player.token,
    data: { battle: { actionMenuStyle: 'actionbar' } }
  });
  player.battleNode = await travelToAdjacentBattleNode(request, player.token);
  return player;
}

/** The action bar button for a battle action (move, attack, skill, item, zodiac, wait). */
export function battleAction(page, action) {
  return page.locator(`.battle-action-bar button[data-action="${action}"]`);
}

/**
 * Wait until the battle intro has finished and it is the player's turn.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForPlayerTurn(page, timeout = 60000) {
  // The intro only starts once the map assets have loaded, and the action bar
  // can already show the player's turn before that, so wait for the intro to
  // have run to completion rather than for its overlay to be absent.
  await expect.poll(() => page.evaluate(() => {
    const scene = window.game.scenes.getCurrentScene();
    return Boolean(scene.intro?.isComplete?.()) && scene.isIntroPlaying === false;
  }), { message: 'waiting for the battle intro to finish', timeout }).toBe(true);
  await expect(battleAction(page, 'wait')).toBeEnabled({ timeout });
}

/** Id of the battle the BattleScene is showing. */
export function currentBattleId(page) {
  return page.evaluate(() => window.game.scenes.getCurrentScene().battleId ?? null);
}
