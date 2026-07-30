/**
 * @module battleLog
 * @description Battle log entry builder for action history display.
 *
 * Transforms raw action data into structured log entries for the battle log UI.
 * Includes portrait data for rendering actor/target portraits.
 *
 * @see BattleScene.js - Uses buildBattleLogEntry in addBattleLogEntry
 * @see BattleUI.js - Renders the battle log entries
 */

/**
 * Get a display name for an action type
 * @param {string} actionType - The action type
 * @param {Object} result - The action result (may contain skill/item name)
 * @returns {string} Display name
 */
export function getActionName(actionType, result) {
  switch (actionType) {
    case 'attack':
      return 'Attack';
    case 'skill':
      return result?.skillName || 'Skill';
    case 'move':
      return 'Move';
    case 'wait':
      return 'Wait';
    case 'item':
      return result?.itemName || 'Item';
    case 'zodiac_ability':
      return result?.abilityName || result?.name || 'Zodiac Ability';
    default:
      return actionType;
  }
}

/**
 * Build a unit data object for battle log entry (actor or target)
 * @param {Object} unit - The unit object
 * @returns {Object|null} Unit data for log entry
 */
function buildUnitData(unit) {
  if (!unit) return null;
  return {
    id: unit.id,
    name: unit.name,
    isPlayer: unit.type === 'player',
    // Portrait data for rendering
    type: unit.type,
    race: unit.race,
    gender: unit.gender,
    class: unit.class,
    enemyId: unit.enemyId
  };
}

/**
 * Build a battle log entry from action data
 * @param {Object} params - Entry parameters
 * @param {Object} params.actor - The unit performing the action
 * @param {string} params.actionType - Type of action (attack, skill, move, wait, item)
 * @param {Object} params.target - The target unit (optional)
 * @param {Object} params.result - The action result
 * @param {number} params.turnCounter - Current turn number
 * @returns {Object} Formatted battle log entry
 */
export function buildBattleLogEntry({ actor, actionType, target, result, turnCounter }) {
  const entry = {
    timestamp: Date.now(),
    turn: turnCounter || 1,
    actor: actor ? buildUnitData(actor) : { name: 'Unknown', isPlayer: false },
    action: {
      type: actionType,
      name: getActionName(actionType, result)
    },
    element: result?.element || 'physical',
    target: buildUnitData(target),
    result: {
      damage: result?.damage || 0,
      baseDamage: result?.baseDamage || null,
      critBonus: result?.critBonus || null,
      isCritical: result?.isCritical || false,
      missed: result?.missed || false,
      healing: result?.healing || 0,
      mpRestored: result?.mpRestored || 0,
      statusApplied: result?.statusApplied || null,
      damageType: result?.damageType || 'physical'
    }
  };

  // For movement, add position data if available
  if (actionType === 'move' && result?.from && result?.to) {
    entry.result.from = result.from;
    entry.result.to = result.to;
  }

  return entry;
}
