import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAmbientSoundKey,
  getInteractionSoundKey,
  getUiSoundKey
} from '../helpers/audioHelpers.js';
import { AMBIENT_MANIFEST } from '../manifests/ambientManifest.js';
import { INTERACTION_MANIFEST } from '../manifests/interactionManifest.js';
import { UI_MANIFEST } from '../manifests/uiManifest.js';

test('category helpers return runtime manifest keys without metadata prefixes', () => {
  const uiKey = getUiSoundKey('button_click');
  const interactionKey = getInteractionSoundKey('fishing_catch');
  const ambientKey = getAmbientSoundKey('fishing_water');

  assert.equal(uiKey, 'button_click');
  assert.equal(interactionKey, 'fishing_catch');
  assert.equal(ambientKey, 'fishing_water');
  assert.ok(UI_MANIFEST[uiKey]);
  assert.ok(INTERACTION_MANIFEST[interactionKey]);
  assert.ok(AMBIENT_MANIFEST[ambientKey]);
});
