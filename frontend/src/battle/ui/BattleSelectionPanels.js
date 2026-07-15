/**
 * @module BattleSelectionPanels
 * @description Manages skill, item, and zodiac ability selection panels in battle UI.
 * Extracted from BattleUI.js for maintainability.
 */

import { escapeHtml, escapeHtmlAttribute } from '../../utils/escapeHtml.js';
import { renderBattleItemIcon } from '../BattleItemIcon.js';
import { renderAbilityIcon } from '../AbilityIcon.js';

/**
 * Get element icon for zodiac abilities.
 * @param {string} element - Element type (fire, water, earth, air, neutral)
 * @returns {string} Unicode emoji
 */
export function getElementIcon(element) {
  const icons = {
    fire: String.fromCodePoint(0x1F525),    // Fire emoji
    water: String.fromCodePoint(0x1F4A7),   // Droplet emoji
    earth: String.fromCodePoint(0x26F0),    // Mountain emoji
    air: String.fromCodePoint(0x1F4A8),     // Dashing away emoji
    neutral: String.fromCodePoint(0x2728)   // Sparkles emoji
  };
  return icons[element] || icons.neutral;
}

/**
 * Render an item with its canonical sprite.
 * @param {Object} item - Battle inventory item
 * @returns {string} ItemIcon HTML
 */
export function getItemIcon(item) {
  return renderBattleItemIcon(item, { size: 'sm' });
}

/**
 * Render skill panel contents.
 * @param {HTMLElement} list - The skill list container element
 * @param {Array} skills - Array of skill objects
 * @param {number} currentMp - Current MP of the active unit
 * @param {Function} onSelectSkill - Callback when a skill is selected
 */
export function renderSkillPanel(list, skills, currentMp, onSelectSkill) {
  list.innerHTML = skills.map(skill => {
    const onCooldown = skill.currentCooldown && skill.currentCooldown > 0;
    const notEnoughMp = skill.mpCost > currentMp;
    const isDisabled = onCooldown || notEnoughMp;
    const titleText = onCooldown
      ? `On cooldown: ${skill.currentCooldown} turn(s) remaining`
      : `${skill.description || skill.name} (${skill.mpCost} MP)`;

    return `
      <button class="btn btn-secondary skill-btn ${onCooldown ? 'on-cooldown' : ''}"
              data-skill-id="${escapeHtmlAttribute(skill.id)}"
              ${isDisabled ? 'disabled' : ''}
              title="${escapeHtmlAttribute(titleText)}"
              style="${onCooldown ? 'opacity: 0.5; position: relative;' : ''}">
        ${renderAbilityIcon(skill, { size: 'sm' })} ${escapeHtml(skill.name)}
        <span style="font-size: 10px; color: ${onCooldown ? '#f88' : '#6af'}; margin-left: 4px;">
          ${onCooldown ? `${skill.currentCooldown}\u{23F1}` : `${skill.mpCost}MP`}
        </span>
      </button>
    `;
  }).join('');

  // Add click handlers for skill buttons
  list.querySelectorAll('.skill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const skillId = btn.dataset.skillId;
      onSelectSkill?.(skillId);
    });
  });
}

/**
 * Render item panel contents.
 * @param {HTMLElement} list - The item list container element
 * @param {HTMLElement} noItemsElement - The "no items" message element
 * @param {Array} items - Array of item objects
 * @param {Function} onSelectItem - Callback when an item is selected
 */
export function renderItemPanel(list, noItemsElement, items, onSelectItem) {
  if (!items || items.length === 0) {
    list.innerHTML = '';
    if (noItemsElement) noItemsElement.style.display = 'block';
    return;
  }

  if (noItemsElement) noItemsElement.style.display = 'none';
  list.innerHTML = items.map(item => `
    <button class="btn btn-secondary item-btn"
            data-item-id="${escapeHtmlAttribute(item.itemId)}"
            data-inventory-id="${escapeHtmlAttribute(item.inventoryId)}"
            title="${escapeHtmlAttribute(item.description || item.name)}">
      ${getItemIcon(item)} ${escapeHtml(item.name)}
      <span style="font-size: 10px; color: #8f8; margin-left: 4px;">x${escapeHtml(String(item.quantity ?? 0))}</span>
    </button>
  `).join('');

  // Add click handlers for item buttons
  list.querySelectorAll('.item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.dataset.itemId;
      const inventoryId = btn.dataset.inventoryId;
      onSelectItem?.({ itemId, inventoryId });
    });
  });
}

/**
 * Render zodiac ability panel contents.
 * @param {HTMLElement} list - The zodiac list container element
 * @param {HTMLElement} noZodiacElement - The "no zodiac" message element
 * @param {Array} abilities - Array of zodiac ability objects
 * @param {Function} onSelectZodiacAbility - Callback when an ability is selected
 */
export function renderZodiacPanel(list, noZodiacElement, abilities, onSelectZodiacAbility) {
  if (!abilities || abilities.length === 0) {
    list.innerHTML = '';
    if (noZodiacElement) noZodiacElement.style.display = 'block';
    return;
  }

  if (noZodiacElement) noZodiacElement.style.display = 'none';
  list.innerHTML = abilities.map(ability => {
    const elementIcon = getElementIcon(ability.element);
    const abilityIcon = renderAbilityIcon({
      ...ability,
      id: ability.id || ability.key,
      source: 'zodiac',
      icon: elementIcon
    }, { size: 'sm' });
    return `
      <button class="btn btn-secondary zodiac-btn"
              data-ability-key="${escapeHtmlAttribute(ability.key)}"
              data-needs-target="${ability.needsTarget || false}"
              title="${escapeHtmlAttribute(ability.description || ability.name)}"
              style="background: linear-gradient(135deg, #2a1f4e 0%, #1a1a2e 100%); border-color: #d4af37;">
        ${abilityIcon} ${escapeHtml(ability.name)}
      </button>
    `;
  }).join('');

  // Add click handlers for zodiac buttons
  list.querySelectorAll('.zodiac-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const abilityKey = btn.dataset.abilityKey;
      const needsTarget = btn.dataset.needsTarget === 'true';
      onSelectZodiacAbility?.(abilityKey, needsTarget);
    });
  });
}
