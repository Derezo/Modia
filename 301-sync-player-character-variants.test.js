'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRegistry,
  canonicalIdentityReference,
  serialize
} = require('./sync-player-character-variants');

test('player variant registry materializes every canonical race/gender/class identity', () => {
  const registry = buildRegistry();
  assert.equal(registry.totalVariants, 300);
  assert.equal(new Set(registry.variants.map(variant => variant.id)).size, 300);
  assert.equal(new Set(registry.variants.map(variant => `${variant.race}/${variant.gender}/${variant.class}`)).size, 300);
});

test('every player identity declares the universal victory outro state', () => {
  const registry = buildRegistry();
  for (const variant of registry.variants) {
    assert.ok(variant.animations.includes('victory'), `${variant.id} lacks victory`);
    assert.equal(typeof variant.generatedAnimations.victory, 'boolean', `${variant.id} victory metadata`);
    assert.deepEqual(Object.keys(variant.generatedAnimations), variant.animations);
    assert.equal(variant.needsRegeneration, !variant.generated, `${variant.id} regeneration state`);
  }
  assert.equal(registry.variants.reduce((total, variant) => total + variant.animations.length, 0), 2235);
});

test('animation conditioning uses canonical full-body identity references while portraits remain provenance', () => {
  const registry = buildRegistry();
  for (const variant of registry.variants) {
    assert.equal(variant.sd15Config.referenceImage, canonicalIdentityReference(variant));
    assert.equal(variant.sd15Config.identitySource, variant.portraitReference);
    assert.notEqual(variant.sd15Config.referenceImage, variant.sd15Config.identitySource);
  }
});

test('registry serialization is deterministic', () => {
  assert.equal(serialize(buildRegistry()), serialize(buildRegistry()));
});
