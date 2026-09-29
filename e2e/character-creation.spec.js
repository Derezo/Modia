import { test, expect } from './fixtures.js';
import {
  apiCall,
  createPlayer,
  login,
  uniqueCharacterName,
  waitForScene,
  waitForWorldMapReady
} from './helpers/index.js';

/**
 * Character Creation E2E Tests
 *
 * An account without a character is sent to CharacterCreateScene after
 * login. (New registrations create their first character inside the
 * registration wizard instead; see registration-wizard.spec.js.)
 */

const RACES = ['human', 'elf', 'dwarf', 'vampire', 'orc'];
const CLASSES = ['warrior', 'wizard', 'monk', 'chemist'];
const GENDERS = ['male', 'female', 'other'];

async function openCharacterCreation(page, request) {
  const player = await createPlayer(request, { withCharacter: false });
  await login(page, player.username, player.password);
  await waitForScene(page, 'characterCreate');
  await expect(page.locator('#char-name')).toBeVisible({ timeout: 10000 });
  return player;
}

async function chooseOptions(page, { race = 'human', characterClass = 'warrior', gender = 'male' } = {}) {
  await page.locator(`.charcreate-option[data-race="${race}"]`).click();
  await page.locator(`.charcreate-option[data-class="${characterClass}"]`).click();
  await page.locator(`.charcreate-gender-option[data-gender="${gender}"]`).click();
}

test.describe('Character Creation', () => {
  test('should offer every race, class and gender', async ({ page, request }) => {
    await openCharacterCreation(page, request);

    const races = await page.locator('.charcreate-option[data-race]')
      .evaluateAll(els => els.map(el => el.dataset.race));
    const classes = await page.locator('.charcreate-option[data-class]')
      .evaluateAll(els => els.map(el => el.dataset.class));
    const genders = await page.locator('.charcreate-gender-option[data-gender]')
      .evaluateAll(els => els.map(el => el.dataset.gender));

    expect(races.sort()).toEqual([...RACES].sort());
    expect(classes.sort()).toEqual([...CLASSES].sort());
    expect(genders.sort()).toEqual([...GENDERS].sort());
  });

  test('should mark the chosen race and class as selected', async ({ page, request }) => {
    await openCharacterCreation(page, request);

    const elf = page.locator('.charcreate-option[data-race="elf"]');
    const wizard = page.locator('.charcreate-option[data-class="wizard"]');
    await elf.click();
    await wizard.click();

    await expect(elf).toHaveClass(/selected/);
    await expect(wizard).toHaveClass(/selected/);
    await expect(page.locator('.charcreate-option[data-race="human"]')).not.toHaveClass(/selected/);
    await expect(page.locator('#race-desc')).toContainText(/MP regen/i);
    await expect(page.locator('#class-desc')).toContainText(/Magic DPS/i);
  });

  test('should keep Create disabled until the form is complete', async ({ page, request }) => {
    await openCharacterCreation(page, request);
    const createButton = page.locator('#create-btn');
    const nameInput = page.locator('#char-name');

    await expect(createButton).toBeDisabled();

    await nameInput.fill(uniqueCharacterName());
    await expect(createButton).toBeDisabled();

    await chooseOptions(page);
    await expect(createButton).toBeEnabled();

    // One character is below the 2-character minimum.
    await nameInput.fill('A');
    await expect(createButton).toBeDisabled();
  });

  test('should cap the name at 24 characters', async ({ page, request }) => {
    await openCharacterCreation(page, request);
    const nameInput = page.locator('#char-name');

    await nameInput.pressSequentially('ThisNameIsWayTooLongForACharacterName');
    await expect(nameInput).toHaveValue('ThisNameIsWayTooLongForA');
  });

  test('should show the server error for a name without letters', async ({ page, request }) => {
    const player = await openCharacterCreation(page, request);

    await chooseOptions(page);
    await page.locator('#char-name').fill('12345');
    await page.locator('#create-btn').click();

    await expect(page.locator('#create-error')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#create-error')).toContainText(/must contain a letter/i);
    await waitForScene(page, 'characterCreate');

    const { body } = await apiCall(request, 'GET', '/characters', { token: player.token });
    expect(body.characters).toHaveLength(0);
  });

  test('should create a character and enter the world map', async ({ page, request }) => {
    const player = await openCharacterCreation(page, request);
    const name = uniqueCharacterName('Made');

    await chooseOptions(page, { race: 'dwarf', characterClass: 'monk', gender: 'female' });
    await page.locator('#char-name').fill(name);
    await page.locator('#create-btn').click();

    await waitForWorldMapReady(page);
    const active = await page.evaluate(() => window.game.state.get('activeCharacter'));
    expect(active.name).toBe(name);

    const { body } = await apiCall(request, 'GET', '/characters', { token: player.token });
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0]).toMatchObject({
      name,
      race: 'dwarf',
      class: 'monk',
      gender: 'female'
    });
  });

  test('should return to the login screen from Back when there is no character', async ({ page, request }) => {
    await openCharacterCreation(page, request);

    await page.locator('#back-btn').click();
    await waitForScene(page, 'login');
  });
});
