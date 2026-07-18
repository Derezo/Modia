/**
 * Canonical battle ability icon paths with emoji fallback rendering.
 *
 * Ability icons are compiled under:
 *   /assets/abilities/icons/{source}/{id}.webp
 *
 * The current registry intentionally marks every ability icon as missing. The
 * renderer therefore keeps the established emoji visible after an image load
 * error, while automatically adopting canonical images as they are generated.
 */

import { escapeHtml, escapeHtmlAttribute } from '../utils/escapeHtml.js';
import { installImageFallbackHandler } from '../utils/imageFallback.js';
import { SKILL_ICONS } from './skillIcons.js';
import {
  ABILITY_ICON_SOURCES as CANONICAL_ABILITY_ICON_SOURCES,
  getAbilityIconPath as getCanonicalAbilityIconPath
} from '../../../shared/assetPaths.js';

export const ABILITY_ICON_ROOT = '/assets/abilities/icons';
export const ABILITY_ICON_SOURCES = CANONICAL_ABILITY_ICON_SOURCES;

const SOURCE_ALIASES = Object.freeze({
  player_skill_tree: 'player',
  player_skill: 'player',
  monster_skill_tree: 'monster',
  monster_skill: 'monster',
  zodiac_ability: 'zodiac'
});

const FALLBACK_ICONS = Object.freeze({
  fire: '🔥',
  ice: '❄️',
  lightning: '⚡',
  earth: '🪨',
  wind: '💨',
  air: '💨',
  water: '💧',
  holy: '✨',
  dark: '🌑',
  shadow: '🌑',
  poison: '☠️',
  physical: '⚔️',
  healing: '💚',
  heal: '💚',
  buff: '⬆️',
  debuff: '⬇️',
  selfaura: '✨'
});

const ICON_SIZES = Object.freeze({
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48
});

function normalizeSource(value) {
  const token = String(value || '').trim().toLowerCase();
  const source = SOURCE_ALIASES[token] || token;
  return ABILITY_ICON_SOURCES.includes(source) ? source : null;
}

function getAbilityId(abilityOrId) {
  if (typeof abilityOrId === 'string') return abilityOrId;
  return abilityOrId?.id || abilityOrId?.key || abilityOrId?.skillId || null;
}

/**
 * Infer which canonical registry source owns an ability DTO.
 * Player is the safe default for legacy battle skill payloads.
 */
export function getAbilityIconSource(ability = {}, explicitSource = null) {
  const sourceValue = explicitSource ?? ability.source ?? ability.abilitySource;
  if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
    return normalizeSource(sourceValue);
  }
  if (ability.ownerType === 'archetype' || ability.monsterArchetype) return 'monster';
  if (ability.ownerType === 'zodiac_sign' || ability.zodiacSign || ability.key) return 'zodiac';
  return 'player';
}

/**
 * Resolve the canonical path without touching the DOM or checking the network.
 */
export function getAbilityIconPath(abilityOrId, options = {}) {
  const ability = typeof abilityOrId === 'object' && abilityOrId ? abilityOrId : {};
  const id = String(getAbilityId(abilityOrId) || '').trim().toLowerCase();
  const source = getAbilityIconSource(ability, options.source);

  // Registry IDs and source folders are deliberately constrained. Returning
  // null keeps malformed DTO values out of HTML attributes and URLs.
  if (!/^[a-z0-9_]+$/.test(id) || !source) return null;
  return getCanonicalAbilityIconPath(id, { source });
}

/**
 * Preserve the current UI presentation while canonical images are missing.
 */
export function getAbilityIconFallback(ability = {}, explicitFallback = null) {
  if (typeof explicitFallback === 'string' && explicitFallback) return explicitFallback;
  if (typeof ability.icon === 'string' && ability.icon) return ability.icon;

  const id = getAbilityId(ability);
  if (id && SKILL_ICONS[id]) return SKILL_ICONS[id];

  const category = String(
    ability.visualCategory || ability.element || ability.type || ''
  ).trim().toLowerCase();
  return FALLBACK_ICONS[category] || '✦';
}

/**
 * Render a canonical ability image with a CSP-safe fallback. The fallback is
 * revealed by the shared captured error listener if the image cannot load.
 */
export function renderAbilityIcon(ability = {}, options = {}) {
  installImageFallbackHandler();
  const size = Object.hasOwn(ICON_SIZES, options.size) ? options.size : 'sm';
  const pixelSize = ICON_SIZES[size];
  const iconPath = getAbilityIconPath(ability, options);
  const fallback = getAbilityIconFallback(ability, options.fallback);
  const title = options.title ?? ability.name ?? '';
  const className = options.className ? ` ${options.className}` : '';
  const classes = `modia-ability-icon modia-ability-icon--${size}${className}`;
  const titleAttribute = title ? ` title="${escapeHtmlAttribute(title)}"` : '';
  const commonStyle = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    `width:${pixelSize}px`,
    `height:${pixelSize}px`,
    'flex:0 0 auto',
    'line-height:1'
  ].join(';');
  const safeFallback = escapeHtml(String(fallback));

  if (!iconPath) {
    return `<span class="${escapeHtmlAttribute(classes)} modia-ability-icon--fallback"${titleAttribute} style="${commonStyle}">` +
      `<span class="modia-ability-icon__fallback" aria-hidden="true">${safeFallback}</span>` +
      '</span>';
  }

  return `<span class="${escapeHtmlAttribute(classes)}"${titleAttribute} style="${commonStyle}" ` +
    `data-ability-icon-source="${escapeHtmlAttribute(getAbilityIconSource(ability, options.source))}">` +
    `<img class="modia-ability-icon__img" src="${escapeHtmlAttribute(iconPath)}" alt="" ` +
    `width="${pixelSize}" height="${pixelSize}" draggable="false" ` +
    'data-image-fallback data-fallback-display="inline-flex" ' +
    'data-fallback-error-class="modia-ability-icon--fallback">' +
    '<span class="modia-ability-icon__fallback" aria-hidden="true" ' +
    `style="display:none;align-items:center;justify-content:center;width:${pixelSize}px;height:${pixelSize}px;">` +
    `${safeFallback}</span></span>`;
}

export const AbilityIcon = Object.freeze({
  getPath: getAbilityIconPath,
  getSource: getAbilityIconSource,
  getFallback: getAbilityIconFallback,
  html: renderAbilityIcon
});
