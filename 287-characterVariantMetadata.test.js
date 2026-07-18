const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadCharacterMetadata } = require('./metadataUtils');
const { getCharacterOutputPath } = require('./assetPathsBridge');

describe('portrait-matched player character metadata', () => {
  it('loads the complete 5 race x 3 gender x 20 class matrix by default', () => {
    const data = loadCharacterMetadata({ type: 'player' });
    const ids = new Set(data.characters.map(character => character.id));

    assert.equal(data.characters.length, 300);
    assert.equal(ids.size, 300);
    assert.ok(data.characters.every(character => character._variant === true));
  });

  it('inherits class animations while retaining portrait identity traits', () => {
    const data = loadCharacterMetadata({ type: 'player', id: 'orc_female_artificer' });
    const character = data.characters[0];

    assert.equal(character.race, 'orc');
    assert.equal(character.gender, 'female');
    assert.equal(character.class, 'artificer');
    assert.ok(character.animations.includes('idle'));
    assert.match(character.visualTraits, /orc/i);
    assert.equal(
      character.sd15Config.referenceImage,
      '/assets/characters/player/orc/female/artificer/orc_female_artificer_reference.png'
    );
    assert.equal(
      character.sd15Config.identitySource,
      '/assets/portraits/originals/orc_female_artificer.png'
    );
  });

  it('keeps class archetypes addressable as explicit migration fallbacks', () => {
    const data = loadCharacterMetadata({ type: 'player', id: 'warrior' });

    assert.equal(data.characters.length, 1);
    assert.equal(data.characters[0]._variant, false);
    assert.equal(data.characters[0].class, 'warrior');
  });

  it('constructs hierarchical generation output paths for variants', async () => {
    const output = await getCharacterOutputPath('orc_female_artificer', {
      type: 'player',
      race: 'orc',
      gender: 'female',
      class: 'artificer',
      animation: 'attack'
    });

    assert.match(
      output,
      /frontend\/public\/assets\/characters\/player\/orc\/female\/artificer\/orc_female_artificer_attack\.png$/
    );
  });
});
