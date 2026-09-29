/**
 * Every control the Settings screen renders must have a consumer somewhere in
 * the client, so the screen never offers a setting that does nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsPanelRenderer } from '../SettingsPanelRenderer.js';
import { DEFAULT_SETTINGS } from '../SettingsStateManager.js';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Files that only render, store or default settings; a key appearing here is
// not a consumer.
const NON_CONSUMERS = new Set([
  'settings/SettingsPanelRenderer.js',
  'settings/SettingsStateManager.js',
  'settings/index.js',
  'scenes/SettingsScene.js',
  'components/SettingsModal.js'
]);

// Battle settings whose consumers live in battle files outside the settings
// package; wiring them is tracked as a hand-off. Remove an entry once wired
// (the test fails on a stale entry, so the list cannot rot).
const PENDING_BATTLE_CONSUMERS = new Set([
  // All battle settings are now wired in BattleScene._applyBattleSettings()
]);

// Settings enforced by the API rather than read by client code. These are
// checked by the API owners (api/src/routes/settings.js validates them).
const SERVER_ENFORCED = new Set([
  'social.showOnlineStatus',
  'social.allowPartyInvites',
  'social.allowFriendRequests'
]);

function listSourceFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listSourceFiles(full));
    else if (name.endsWith('.js') && !name.endsWith('.test.js')) files.push(full);
  }
  return files;
}

function renderAllPanels() {
  const renderer = new SettingsPanelRenderer(structuredClone(DEFAULT_SETTINGS), true);
  return [
    renderer.renderBattlePanel(),
    renderer.renderAudioPanel(),
    renderer.renderDisplayPanel(),
    renderer.renderAccessibilityPanel(),
    renderer.renderGameplayPanel(),
    renderer.renderSocialPanel(),
    renderer.renderDeveloperPanel(),
    renderer.renderHelpPanel()
  ].join('\n');
}

describe('Settings screen controls', () => {
  const html = renderAllPanels();
  const paths = [...new Set([...html.matchAll(/data-setting="([^"]+)"/g)].map(m => m[1]))];
  const consumerSources = listSourceFiles(SRC_ROOT)
    .filter(file => !NON_CONSUMERS.has(relative(SRC_ROOT, file).split('\\').join('/')))
    .map(file => readFileSync(file, 'utf8'));

  // A consumer reads the setting by dotted path (getUserSetting('a.b')), by
  // property (settings.b), or by destructuring ({ b = ... } = settings.a).
  const hasConsumer = (path) => {
    const leaf = path.split('.').pop();
    const leafPattern = new RegExp(`\\b${leaf}\\b`);
    return consumerSources.some(source => source.includes(`'${path}'`) || leafPattern.test(source));
  };

  it('renders at least one control', () => {
    assert.ok(paths.length > 0);
  });

  it('only renders settings that some client code reads', () => {
    const dead = paths.filter(path =>
      !PENDING_BATTLE_CONSUMERS.has(path)
      && !SERVER_ENFORCED.has(path)
      && !hasConsumer(path));
    assert.deepEqual(dead, [], `Settings with no consumer: ${dead.join(', ')}`);
  });

  it('keeps the pending battle list accurate', () => {
    const wired = [...PENDING_BATTLE_CONSUMERS].filter(hasConsumer);
    assert.deepEqual(
      wired,
      [],
      `These settings are now consumed; remove them from PENDING_BATTLE_CONSUMERS: ${wired.join(', ')}`
    );
    const notRendered = [...PENDING_BATTLE_CONSUMERS].filter(path => !paths.includes(path));
    assert.deepEqual(notRendered, [], `Pending entries no longer rendered: ${notRendered.join(', ')}`);
  });

  it('no longer renders the removed no-op controls', () => {
    for (const removed of [
      'display.uiScale', 'display.particleQuality', 'gameplay.autoSave',
      'gameplay.showTutorialHints', 'gameplay.questMarkerStyle', 'controls.keybindScheme',
      'controls.touchGesturesEnabled', 'controls.doubleTapConfirm', 'controls.holdToCancel',
      'social.profanityFilter', 'developer.battle.logAIDecisions'
    ]) {
      assert.equal(paths.includes(removed), false, `${removed} is still rendered`);
    }
  });
});
