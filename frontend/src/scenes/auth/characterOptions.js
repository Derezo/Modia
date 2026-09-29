/**
 * @module characterOptions
 * @description Race, class and gender choices shared by the registration
 * wizard (step 2) and CharacterCreateScene, plus the game-art thumbnails
 * shown on each choice tile.
 *
 * Tiles use the existing player portraits (`/assets/portraits/{size}/
 * {race}_{gender}_{class}.webp`, all 60 combinations exist) instead of OS
 * emoji. Each tile previews the option it represents combined with the
 * player's other current choices, so picking "Orc" turns every class tile
 * into an orc of that class.
 */

import { getAssetPath, getPlayerCharacterIdentity } from '@shared/assetPaths.js';
import { escapeHtmlAttribute } from '../../utils/escapeHtml.js';

export const RACES = Object.freeze([
  { id: 'human', name: 'Human', desc: '+10% EXP gain, balanced stats' },
  { id: 'elf', name: 'Elf', desc: '+20% MP regen, high INT/AGI' },
  { id: 'dwarf', name: 'Dwarf', desc: '+15% gold find, high STR/VIT' },
  { id: 'vampire', name: 'Vampire', desc: '10% lifesteal, high AGI' },
  { id: 'orc', name: 'Orc', desc: '+25% crit damage, high STR' }
]);

export const CLASSES = Object.freeze([
  { id: 'warrior', name: 'Warrior', desc: 'Tank/DPS, high HP and STR' },
  { id: 'wizard', name: 'Wizard', desc: 'Magic DPS, high MP and INT' },
  { id: 'monk', name: 'Monk', desc: 'Mobile DPS, high AGI' },
  { id: 'chemist', name: 'Chemist', desc: 'Support/Healer, balanced' }
]);

export const GENDERS = Object.freeze([
  { id: 'male', name: 'Male' },
  { id: 'female', name: 'Female' },
  { id: 'other', name: 'Other' }
]);

/** Fallbacks used for the parts of a tile's portrait the player has not chosen yet. */
export const OPTION_ART_DEFAULTS = Object.freeze({
  race: 'human',
  characterClass: 'warrior',
  gender: 'male'
});

const OPTION_KINDS = Object.freeze({
  race: 'race',
  class: 'characterClass',
  gender: 'gender'
});

/** Display size (CSS px) of a tile portrait; the 2x source keeps it sharp on HiDPI. */
const ART_SIZE = 64;
const ART_SIZE_2X = 128;

/**
 * Portrait identity for one option tile.
 * @param {'race'|'class'|'gender'} kind - Which option group the tile belongs to
 * @param {string} optionId - The tile's option id (e.g. 'orc')
 * @param {{race?: string|null, characterClass?: string|null, gender?: string|null}} [selection]
 * @returns {string} Portrait id such as 'orc_male_warrior'
 */
export function getOptionPortraitId(kind, optionId, selection = {}) {
  const field = OPTION_KINDS[kind];
  if (!field) throw new Error(`Unknown character option kind: ${kind}`);

  const pick = key => selection?.[key] || OPTION_ART_DEFAULTS[key];
  const parts = {
    race: pick('race'),
    characterClass: pick('characterClass'),
    gender: pick('gender'),
    [field]: optionId
  };
  return getPlayerCharacterIdentity({
    race: parts.race,
    gender: parts.gender,
    class: parts.characterClass
  }).id;
}

/**
 * Image sources for one option tile.
 * @returns {{src: string, srcset: string}}
 */
export function getOptionArtSources(kind, optionId, selection = {}) {
  const id = getOptionPortraitId(kind, optionId, selection);
  const src = getAssetPath('portraits', id, { size: ART_SIZE });
  const src2x = getAssetPath('portraits', id, { size: ART_SIZE_2X });
  return { src, srcset: `${src} 1x, ${src2x} 2x` };
}

/**
 * HTML for a tile's art. The image is decorative (the tile's name label
 * follows it); if it fails to load, `bindOptionArtFallback` swaps in the
 * option's initial via the wrapper's data-initial attribute.
 * @param {string} classPrefix - CSS prefix of the host UI ('regwiz' / 'charcreate')
 */
export function renderOptionArt(classPrefix, kind, option, selection = {}) {
  const { src, srcset } = getOptionArtSources(kind, option.id, selection);
  const initial = escapeHtmlAttribute(option.name.charAt(0));
  return `<span class="${classPrefix}-option-art" data-initial="${initial}">`
    + `<img src="${escapeHtmlAttribute(src)}" srcset="${escapeHtmlAttribute(srcset)}" alt=""`
    + ` width="${ART_SIZE}" height="${ART_SIZE}" draggable="false"`
    + ` data-art-kind="${escapeHtmlAttribute(kind)}" data-art-option="${escapeHtmlAttribute(option.id)}"></span>`;
}

/**
 * Re-point every tile image under `root` at the portrait for the current
 * selection. Call after any race/class/gender change.
 * @param {ParentNode} root
 * @param {{race?: string|null, characterClass?: string|null, gender?: string|null}} selection
 */
export function refreshOptionArt(root, selection) {
  if (!root) return;
  root.querySelectorAll('img[data-art-kind]').forEach(img => {
    const { src, srcset } = getOptionArtSources(img.dataset.artKind, img.dataset.artOption, selection);
    if (img.getAttribute('src') !== src) {
      img.setAttribute('srcset', srcset);
      img.setAttribute('src', src);
    }
  });
}

/**
 * Replace a tile image that fails to load with the option's initial (drawn by
 * CSS from the wrapper's data-initial), so a missing file never leaves a
 * broken-image glyph on the tile.
 * @param {ParentNode} root
 */
export function bindOptionArtFallback(root) {
  if (!root) return;
  root.querySelectorAll('img[data-art-kind]').forEach(img => {
    img.addEventListener('error', () => {
      img.parentElement?.classList.add('art-missing');
    });
    img.addEventListener('load', () => {
      img.parentElement?.classList.remove('art-missing');
    });
  });
}

/**
 * CSS for the tile art, shared by both hosts.
 * @param {string} classPrefix
 * @param {{size: number, borderColor: string, background: string, textColor: string, fontFamily: string}} theme
 */
export function getOptionArtCSS(classPrefix, theme) {
  const { size, borderColor, background, textColor, fontFamily } = theme;
  return `
      .${classPrefix}-option-art {
        position: relative;
        display: block;
        width: ${size}px;
        height: ${size}px;
        margin: 0 auto;
        border-radius: 50%;
        overflow: hidden;
        border: 2px solid ${borderColor};
        background: ${background};
        box-sizing: border-box;
      }

      .${classPrefix}-option-art img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .${classPrefix}-option-art.art-missing img {
        visibility: hidden;
      }

      .${classPrefix}-option-art.art-missing::after {
        content: attr(data-initial);
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${textColor};
        font-family: ${fontFamily};
        font-size: ${Math.round(size * 0.45)}px;
        font-weight: 700;
      }
  `;
}
