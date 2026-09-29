import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      return {
        url: new URL(`../../../../shared/${specifier.slice('@shared/'.length)}`, import.meta.url).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

// RegistrationWizard / CharacterCreateScene pull in the responsive singleton,
// which reads window at module evaluation time. Provide the minimal surface.
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0 }
});
// escapeHtml serialises through a detached element's textContent/innerHTML.
function fakeElement() {
  let text = '';
  return {
    id: '',
    set textContent(value) { text = String(value); },
    get textContent() { return text; },
    get innerHTML() {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  };
}
globalThis.document = {
  createElement: fakeElement,
  head: { appendChild() {} },
  getElementById() { return null; }
};

const {
  RACES,
  CLASSES,
  GENDERS,
  getOptionPortraitId,
  getOptionArtSources,
  renderOptionArt,
  refreshOptionArt
} = await import('../auth/characterOptions.js');
const { RegistrationWizard } = await import('../auth/RegistrationWizard.js');
const { CharacterCreateScene } = await import('../CharacterCreateScene.js');

const PUBLIC_DIR = fileURLToPath(new URL('../../../public', import.meta.url));

function fakeImg(kind, option) {
  const attrs = { src: '', srcset: '' };
  return {
    dataset: { artKind: kind, artOption: option },
    getAttribute: name => attrs[name],
    setAttribute: (name, value) => { attrs[name] = value; },
    attrs
  };
}

function fakePreviewCard(character) {
  return {
    character,
    updates: [],
    update(patch) {
      this.updates.push(patch);
      Object.assign(this.character, patch);
    }
  };
}

describe('registration character option art', () => {
  it('previews each tile as its option combined with the other current choices', () => {
    assert.equal(getOptionPortraitId('race', 'orc'), 'orc_male_warrior');
    assert.equal(getOptionPortraitId('class', 'wizard', { race: 'elf', gender: 'female' }), 'elf_female_wizard');
    assert.equal(
      getOptionPortraitId('gender', 'other', { race: 'dwarf', characterClass: 'chemist', gender: 'male' }),
      'dwarf_other_chemist'
    );
    // The tile's own option wins over the current selection of the same kind
    assert.equal(getOptionPortraitId('race', 'vampire', { race: 'human' }), 'vampire_male_warrior');
    assert.throws(() => getOptionPortraitId('hair', 'red'), /Unknown character option kind/);
  });

  it('uses portrait art (1x and 2x) instead of emoji', () => {
    const { src, srcset } = getOptionArtSources('race', 'elf', { characterClass: 'monk', gender: 'female' });
    assert.equal(src, '/assets/portraits/64/elf_female_monk.webp');
    assert.equal(srcset, '/assets/portraits/64/elf_female_monk.webp 1x, /assets/portraits/128/elf_female_monk.webp 2x');

    const html = renderOptionArt('regwiz', 'race', RACES[4], {});
    assert.match(html, /<img src="\/assets\/portraits\/64\/orc_male_warrior\.webp"/);
    assert.match(html, /data-initial="O"/);
    assert.doesNotMatch(html, /&#x1F/);
  });

  it('refreshes every tile image when a choice changes', () => {
    const imgs = [fakeImg('race', 'orc'), fakeImg('class', 'monk'), fakeImg('gender', 'female')];
    const root = { querySelectorAll: () => imgs };

    refreshOptionArt(root, { race: 'elf', characterClass: 'wizard', gender: 'male' });

    assert.equal(imgs[0].attrs.src, '/assets/portraits/64/orc_male_wizard.webp');
    assert.equal(imgs[1].attrs.src, '/assets/portraits/64/elf_male_monk.webp');
    assert.equal(imgs[2].attrs.src, '/assets/portraits/64/elf_female_wizard.webp');
    assert.match(imgs[2].attrs.srcset, /128\/elf_female_wizard\.webp 2x$/);
  });

  it('has a portrait file for every race/class/gender tile combination', (t) => {
    const portraitDir = `${PUBLIC_DIR}/assets/portraits`;
    if (!existsSync(portraitDir)) {
      t.skip('generated assets are not present in this checkout (frontend/public/assets is gitignored)');
      return;
    }
    const missing = [];
    for (const race of RACES) {
      for (const cls of CLASSES) {
        for (const gender of GENDERS) {
          const id = `${race.id}_${gender.id}_${cls.id}`;
          for (const size of [64, 128]) {
            if (!existsSync(`${portraitDir}/${size}/${id}.webp`)) missing.push(`${size}/${id}`);
          }
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe('RegistrationWizard preview name', () => {
  function wizardWith(characterName, previewCard) {
    const wizard = Object.create(RegistrationWizard.prototype);
    wizard.formData = { characterName, race: 'elf', characterClass: 'wizard', gender: 'female' };
    wizard.previewCard = previewCard;
    return wizard;
  }

  it('updates the preview card name on every keystroke without refetching', () => {
    const card = fakePreviewCard({ name: 'Your Hero', race: 'elf', class: 'wizard' });
    const wizard = wizardWith('', card);
    wizard.fetchPreview = () => assert.fail('typing must not refetch the stat preview');

    for (const typed of ['A', 'Ar', 'Ari']) {
      wizard.formData.characterName = typed;
      wizard.updatePreviewName();
    }

    assert.deepEqual(card.updates, [{ name: 'A' }, { name: 'Ar' }, { name: 'Ari' }]);
    assert.equal(card.character.name, 'Ari');
  });

  it('falls back to the placeholder name when the input is cleared', () => {
    const card = fakePreviewCard({ name: 'Ari' });
    const wizard = wizardWith('   ', card);

    wizard.updatePreviewName();

    assert.equal(card.character.name, 'Your Hero');
  });

  it('does nothing before a race or class has put a card on screen', () => {
    const card = fakePreviewCard(null);
    const wizard = wizardWith('Ari', card);

    wizard.updatePreviewName();

    assert.deepEqual(card.updates, []);
  });
});

describe('CharacterCreateScene preview name', () => {
  it('updates the preview card name from the name input on every keystroke', () => {
    const input = { value: '' };
    const scene = Object.create(CharacterCreateScene.prototype);
    scene.uiElement = { querySelector: selector => (selector === '#char-name' ? input : null) };
    scene.previewCard = fakePreviewCard({ name: 'Your Hero', race: 'orc', class: 'monk' });
    scene.fetchPreview = () => assert.fail('typing must not refetch the stat preview');

    for (const typed of ['G', 'Gr', 'Gro']) {
      input.value = typed;
      scene.updatePreviewName();
    }
    assert.equal(scene.previewCard.character.name, 'Gro');

    input.value = '';
    scene.updatePreviewName();
    assert.equal(scene.previewCard.character.name, 'Your Hero');
  });

  it('exposes its choices in the shape the tile art expects', () => {
    const scene = Object.create(CharacterCreateScene.prototype);
    scene.selectedRace = 'dwarf';
    scene.selectedClass = null;
    scene.selectedGender = 'female';

    assert.deepEqual(scene.getSelection(), { race: 'dwarf', characterClass: null, gender: 'female' });
    assert.equal(getOptionPortraitId('class', 'chemist', scene.getSelection()), 'dwarf_female_chemist');
  });
});
