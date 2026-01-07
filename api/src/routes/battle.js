const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { BATTLE_NODE_TYPES, MAX_BATTLE_PARTY_SIZE } = require('../config/constants');
const battleService = require('../services/battleService');
const aiService = require('../services/aiService');
const enemyService = require('../services/enemyService');
const itemDropService = require('../services/itemDropService');
const battleWebsocket = require('../services/battleWebsocket');
const { SKILL_TREES } = require('./skills');

/**
 * Get skill definition from SKILL_TREES
 * @param {string} unitClass - The unit's class (warrior, wizard, etc.)
 * @param {string} skillId - The skill ID to find
 * @returns {Object|null} Skill definition or null if not found
 */
function getSkillDefinition(unitClass, skillId) {
  const classTree = SKILL_TREES[unitClass?.toLowerCase()];
  if (!classTree) return null;

  for (const branch of classTree.branches) {
    const skill = branch.skills.find(s => s.id === skillId);
    if (skill) return skill;
  }
  return null;
}

/**
 * Initialize two-action turn state for a unit if not present (migration support)
 * @param {Object} unit - The unit to initialize
 */
function initializeTurnState(unit) {
  if (typeof unit.moveUsed !== 'boolean') {
    unit.moveUsed = false;
    unit.actUsed = false;
    unit.turnPhase = 'ready';
  }
}

/**
 * Process an action for any unit (player or enemy)
 * Two-action system: each turn allows 1 move + 1 act (attack/skill), in either order
 * @param {Object} state - Battle state
 * @param {Object} unit - The acting unit
 * @param {string} actionType - 'move' | 'attack' | 'skill' | 'wait'
 * @param {Object} targetTile - { x, y } target position
 * @param {string} skillId - Optional skill ID for skill actions
 * @returns {Object} Action result with turnEnded flag
 */
function processAction(state, unit, actionType, targetTile, skillId = null) {
  const result = { damage: 0, moved: false, turnEnded: false };

  // Initialize two-action state if missing (migration support)
  initializeTurnState(unit);

  switch (actionType) {
    case 'move':
      // Check if already moved this turn
      if (unit.moveUsed) {
        result.error = 'Already moved this turn';
        return result;
      }
      // Check if status effects prevent movement
      if (!battleService.canUnitMove(unit)) {
        result.error = 'Cannot move due to status effect';
        return result;
      }
      if (targetTile) {
        unit.tileX = targetTile.x;
        unit.tileY = targetTile.y;
        result.moved = true;
        result.newPosition = { x: targetTile.x, y: targetTile.y };
        unit.moveUsed = true;
      }
      break;

    case 'attack':
      // Check if already acted this turn
      if (unit.actUsed) {
        result.error = 'Already acted this turn';
        return result;
      }
      // Check if status effects prevent acting
      if (!battleService.canUnitAct(unit)) {
        result.error = 'Cannot act due to status effect';
        return result;
      }
      if (targetTile) {
        const target = state.units.find(u =>
          u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
        );
        if (target) {
          // Attack target at tile
          const hits = battleService.checkHit(unit, target);
          if (hits) {
            const damageResult = battleService.calculatePhysicalDamage(unit, target);
            target.hp = Math.max(0, target.hp - damageResult.damage);
            result.damage = damageResult.damage;
            result.isCritical = damageResult.isCritical;
            result.targetId = target.id;
            result.targetType = target.type; // 'player' or 'enemy'
          } else {
            result.missed = true;
            result.targetId = target.id;
          }
        } else {
          // Empty tile attack - animation plays but no effect
          result.attackedEmptyTile = true;
          result.targetTile = targetTile;
        }
        unit.actUsed = true;
      }
      break;

    case 'skill':
      // Check if already acted this turn
      if (unit.actUsed) {
        result.error = 'Already acted this turn';
        return result;
      }
      // Check if status effects prevent acting or using skills
      if (!battleService.canUnitAct(unit)) {
        result.error = 'Cannot act due to status effect';
        return result;
      }
      if (!battleService.canUnitUseSkills(unit)) {
        result.error = 'Cannot use skills due to silence';
        return result;
      }
      if (targetTile && skillId) {
        const skill = getSkillDefinition(unit.class, skillId);
        if (!skill) {
          result.error = 'Invalid skill';
          break;
        }

        // Calculate MP cost (use mpCost from skill definition, or derive from baseCost)
        const mpCost = skill.mpCost || (skill.baseCost ? Math.floor(skill.baseCost / 10) : 5);
        if (unit.mp < mpCost) {
          result.error = 'Not enough MP';
          break;
        }

        // Deduct MP
        unit.mp -= mpCost;
        result.skillUsed = skillId;
        result.mpCost = mpCost;
        result.skillEffects = [];

        // Handle self-targeting skills (buffs, heals)
        if (skill.selfBuff || skill.healPercent || skill.cleanse) {
          // Self-buff or self-heal
          if (skill.selfBuff) {
            battleService.applyStatusEffect(unit, skill.selfBuff, skill.buffDuration || 3);
            result.skillEffects.push({ type: 'buff', effect: skill.selfBuff, targetId: unit.id });
          }
          if (skill.healPercent) {
            const healAmount = Math.floor(unit.maxHp * skill.healPercent / 100);
            unit.hp = Math.min(unit.maxHp, unit.hp + healAmount);
            result.healing = healAmount;
            result.targetId = unit.id;
          }
          if (skill.mpRestore) {
            const mpAmount = Math.floor(unit.maxMp * skill.mpRestore / 100);
            unit.mp = Math.min(unit.maxMp, unit.mp + mpAmount);
            result.mpRestored = mpAmount;
          }
          if (skill.cleanse) {
            // Remove all negative status effects
            unit.statusEffects = (unit.statusEffects || []).filter(e =>
              ['rage', 'fortify', 'haste', 'regen'].includes(e.type)
            );
            result.skillEffects.push({ type: 'cleanse', targetId: unit.id });
          }
          unit.actUsed = true;
          break;
        }

        // Find target at tile
        const target = state.units.find(u =>
          u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
        );

        // Handle ally-targeting skills (heals, buffs)
        if (skill.targetAlly && target && target.type === unit.type) {
          if (skill.healPercent) {
            const healAmount = Math.floor(target.maxHp * skill.healPercent / 100);
            target.hp = Math.min(target.maxHp, target.hp + healAmount);
            result.healing = healAmount;
            result.targetId = target.id;
          }
          if (skill.effect && skill.effectChance >= Math.random()) {
            battleService.applyStatusEffect(target, skill.effect, skill.effectDuration || 3);
            result.skillEffects.push({ type: 'buff', effect: skill.effect, targetId: target.id });
          }
          unit.actUsed = true;
          break;
        }

        if (target) {
          // Apply skill damage (using power from skill or default 150%)
          const power = skill.power || 150;
          const damageType = skill.damageType || 'physical';
          const damageResult = damageType === 'magical'
            ? battleService.calculateMagicalDamage(unit, target, power)
            : battleService.calculatePhysicalDamage(unit, target, power);

          // Apply damage (multiply by hits if multi-hit skill)
          const hits = skill.hits || 1;
          let totalDamage = 0;
          for (let i = 0; i < hits; i++) {
            totalDamage += damageResult.damage;
          }
          target.hp = Math.max(0, target.hp - totalDamage);
          result.damage = totalDamage;
          result.hits = hits;
          result.isCritical = damageResult.isCritical;
          result.targetId = target.id;
          result.targetType = target.type;

          // Apply status effect if skill has one and chance succeeds
          if (skill.effect && skill.effectChance && Math.random() < skill.effectChance) {
            const effectApplied = battleService.applyStatusEffect(
              target,
              skill.effect,
              skill.effectDuration || 3
            );
            if (effectApplied) {
              result.skillEffects.push({
                type: 'debuff',
                effect: skill.effect,
                duration: skill.effectDuration || 3,
                targetId: target.id
              });
            }
          }
        } else {
          // Empty tile skill - animation plays but no damage
          result.attackedEmptyTile = true;
          result.targetTile = targetTile;
        }
        unit.actUsed = true;
      }
      break;

    case 'item':
      // Check if already acted this turn
      if (unit.actUsed) {
        result.error = 'Already acted this turn';
        return result;
      }
      // Check if status effects prevent acting
      if (!battleService.canUnitAct(unit)) {
        result.error = 'Cannot act due to status effect';
        return result;
      }
      // Item usage requires itemId in skillId parameter (reusing same field)
      if (skillId) {
        result.itemUsed = skillId;
        result.itemEffects = [];

        // Look up item from battle state consumables (loaded from database)
        const consumables = state.consumables || [];
        const consumable = consumables.find(c => c.itemId === parseInt(skillId) || c.itemId === skillId);

        if (!consumable || consumable.quantity <= 0) {
          result.error = 'Item not available';
          break;
        }

        // Find target (self or ally at tile)
        let itemTarget = unit; // Default to self
        if (targetTile) {
          const tileTarget = state.units.find(u =>
            u.tileX === targetTile.x && u.tileY === targetTile.y && u.type === 'player'
          );
          if (tileTarget) {
            itemTarget = tileTarget;
          }
        }

        // Apply item effects based on effectType from database
        const effectType = consumable.effectType || consumable.name?.toLowerCase();
        const effectValue = consumable.effectValue || 25; // Default to 25% if not specified

        // Handle different effect types
        if (effectType === 'hp_restore' || consumable.name?.toLowerCase().includes('potion')) {
          const healAmount = Math.floor(itemTarget.maxHp * effectValue / 100);
          itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + healAmount);
          result.healing = healAmount;
          result.itemEffects.push({ type: 'heal', amount: healAmount, targetId: itemTarget.id });
        }

        if (effectType === 'mp_restore' || consumable.name?.toLowerCase().includes('ether')) {
          const mpAmount = Math.floor(itemTarget.maxMp * effectValue / 100);
          itemTarget.mp = Math.min(itemTarget.maxMp, itemTarget.mp + mpAmount);
          result.mpRestored = mpAmount;
          result.itemEffects.push({ type: 'mpRestore', amount: mpAmount, targetId: itemTarget.id });
        }

        if (effectType === 'elixir' || consumable.name?.toLowerCase().includes('elixir')) {
          const healAmount = Math.floor(itemTarget.maxHp * effectValue / 100);
          const mpAmount = Math.floor(itemTarget.maxMp * effectValue / 100);
          itemTarget.hp = Math.min(itemTarget.maxHp, itemTarget.hp + healAmount);
          itemTarget.mp = Math.min(itemTarget.maxMp, itemTarget.mp + mpAmount);
          result.itemEffects.push({ type: 'heal', amount: healAmount, targetId: itemTarget.id });
          result.itemEffects.push({ type: 'mpRestore', amount: mpAmount, targetId: itemTarget.id });
        }

        if (effectType === 'cleanse' || consumable.name?.toLowerCase().includes('antidote')) {
          const cleansableEffects = ['poison', 'blind', 'silence', 'slow', 'burn'];
          itemTarget.statusEffects = (itemTarget.statusEffects || []).filter(e =>
            !cleansableEffects.includes(e.type)
          );
          result.itemEffects.push({ type: 'cleanse', effects: cleansableEffects, targetId: itemTarget.id });
        }

        if (effectType === 'revive' || consumable.name?.toLowerCase().includes('phoenix')) {
          if (itemTarget.hp <= 0) {
            const reviveHp = Math.floor(itemTarget.maxHp * effectValue / 100);
            itemTarget.hp = reviveHp;
            result.itemEffects.push({ type: 'revive', amount: reviveHp, targetId: itemTarget.id });
          }
        }

        // Consume the item in battle state
        consumable.quantity--;
        if (consumable.quantity <= 0) {
          state.consumables = consumables.filter(c => c.itemId !== consumable.itemId);
        }

        // Mark inventory item for consumption (will be processed after battle or immediately)
        result.consumedInventoryId = consumable.inventoryId;
        result.targetId = itemTarget.id;
        result.itemName = consumable.name;
        unit.actUsed = true;
      }
      break;

    case 'wait':
      // Wait ends turn immediately, skipping any remaining actions
      result.turnEnded = true;
      break;
  }

  // Determine if turn is complete
  // Turn ends if: wait was pressed, OR both move and act have been used
  if (actionType === 'wait' || (unit.moveUsed && unit.actUsed)) {
    unit.turnPhase = 'done';
    unit.hasActed = true; // backwards compatibility
    result.turnEnded = true;
  } else if (unit.moveUsed || unit.actUsed) {
    unit.turnPhase = 'partial';
  }

  // Calculate available actions for response
  const canMove = battleService.canUnitMove(unit) && !unit.moveUsed;
  const canAct = battleService.canUnitAct(unit) && !unit.actUsed;
  result.availableActions = { canMove, canAct };

  return result;
}

/**
 * Advance to the next actor using CT system
 * Consumes the current actor's CT and finds the next one
 * @param {Object} state - Battle state
 */
function advanceToNextActorWithCT(state) {
  // Consume CT for the unit that just acted
  const currentActor = state.units.find(u => u.id === state.activeUnitId);
  if (currentActor) {
    battleService.consumeCT(currentActor);
  }

  // Find the next actor
  battleService.advanceToNextActor(state);
}

/**
 * Check if battle has ended
 * @param {Object} state - Battle state
 * @returns {string} 'active' | 'victory' | 'defeat'
 */
function checkBattleEnd(state) {
  const playerUnitsAlive = state.units.filter(u => u.type === 'player' && u.hp > 0).length;
  const enemyUnitsAlive = state.units.filter(u => u.type === 'enemy' && u.hp > 0).length;

  if (enemyUnitsAlive === 0) return 'victory';
  if (playerUnitsAlive === 0) return 'defeat';
  return 'active';
}

/**
 * Process enemy turns until it's a player's turn or battle ends
 * Uses CT system to determine turn order
 * Two-action system: each enemy gets both a move and an action per turn
 * @param {Object} state - Battle state
 * @param {number} maxIterations - Safety limit to prevent infinite loops
 * @returns {Array} Array of enemy actions for frontend animation
 */
function processEnemyTurns(state, maxIterations = 50) {
  const enemyActions = [];
  let iterations = 0;

  while (iterations < maxIterations) {
    // Get the current active unit
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    // Safety check
    if (!activeUnit) {
      battleService.advanceToNextActor(state);
      iterations++;
      continue;
    }

    // Stop if it's a player's turn
    if (activeUnit.type === 'player') {
      break;
    }

    // Stop if unit is dead (shouldn't happen, but safety check)
    if (activeUnit.hp <= 0) {
      advanceToNextActorWithCT(state);
      iterations++;
      continue;
    }

    // Initialize turn state for enemy
    initializeTurnState(activeUnit);

    // Get AI decisions for the full turn (returns array of 1-2 actions)
    const decisions = aiService.decideTurnActions(activeUnit, state);

    // Process each action in the enemy's turn
    for (const decision of decisions) {
      // Skip if wait (ends turn)
      if (decision.actionType === 'wait') {
        break;
      }

      // Process the enemy action
      const result = processAction(state, activeUnit, decision.actionType, decision.targetTile, decision.skillId);

      // Skip recording if there was an error (shouldn't happen for AI, but safety)
      if (result.error) {
        continue;
      }

      // Record this action for frontend animation
      enemyActions.push({
        unitId: activeUnit.id,
        unitName: activeUnit.name,
        actionType: decision.actionType,
        targetTile: decision.targetTile,
        result
      });

      // Check if battle ended after this action
      const battleStatus = checkBattleEnd(state);
      if (battleStatus !== 'active') {
        return enemyActions;
      }
    }

    // Advance to next actor using CT system
    advanceToNextActorWithCT(state);
    iterations++;
  }

  return enemyActions;
}

// POST /api/battle/start - Start PvE battle at current node
router.post('/start', authenticate, asyncHandler(async (req, res) => {
  // Get user's battle party with equipment stat bonuses
  const partyResult = await query(
    `SELECT c.id, c.name, c.race, c.class, c.level,
            c.hp_current, c.hp_max, c.mp_current, c.mp_max,
            c.strength, c.intelligence, c.agility, c.vitality, c.luck,
            c.current_node_id, c.in_battle,
            COALESCE(eq.equip_strength, 0) as equip_strength,
            COALESCE(eq.equip_intelligence, 0) as equip_intelligence,
            COALESCE(eq.equip_agility, 0) as equip_agility,
            COALESCE(eq.equip_vitality, 0) as equip_vitality,
            COALESCE(eq.equip_luck, 0) as equip_luck,
            COALESCE(eq.equip_hp, 0) as equip_hp,
            COALESCE(eq.equip_mp, 0) as equip_mp,
            COALESCE(eq.equip_attack, 0) as equip_attack,
            COALESCE(eq.equip_defense, 0) as equip_defense,
            COALESCE(eq.equip_magic_attack, 0) as equip_magic_attack,
            COALESCE(eq.equip_magic_defense, 0) as equip_magic_defense
     FROM characters c
     LEFT JOIN LATERAL (
       SELECT
         SUM(COALESCE((it.stat_bonuses->>'strength')::int, 0) + COALESCE((ci.modifications->>'strength')::int, 0)) as equip_strength,
         SUM(COALESCE((it.stat_bonuses->>'intelligence')::int, 0) + COALESCE((ci.modifications->>'intelligence')::int, 0)) as equip_intelligence,
         SUM(COALESCE((it.stat_bonuses->>'agility')::int, 0) + COALESCE((ci.modifications->>'agility')::int, 0)) as equip_agility,
         SUM(COALESCE((it.stat_bonuses->>'vitality')::int, 0) + COALESCE((ci.modifications->>'vitality')::int, 0)) as equip_vitality,
         SUM(COALESCE((it.stat_bonuses->>'luck')::int, 0) + COALESCE((ci.modifications->>'luck')::int, 0)) as equip_luck,
         SUM(COALESCE((it.stat_bonuses->>'hp')::int, 0) + COALESCE((ci.modifications->>'hp_max')::int, 0)) as equip_hp,
         SUM(COALESCE((it.stat_bonuses->>'mp')::int, 0) + COALESCE((ci.modifications->>'mp_max')::int, 0)) as equip_mp,
         SUM(COALESCE((it.stat_bonuses->>'attack')::int, 0) + COALESCE((ci.modifications->>'attack')::int, 0)) as equip_attack,
         SUM(COALESCE((it.stat_bonuses->>'defense')::int, 0) + COALESCE((ci.modifications->>'defense')::int, 0)) as equip_defense,
         SUM(COALESCE((it.stat_bonuses->>'magic_attack')::int, 0) + COALESCE((ci.modifications->>'magic_attack')::int, 0)) as equip_magic_attack,
         SUM(COALESCE((it.stat_bonuses->>'magic_defense')::int, 0) + COALESCE((ci.modifications->>'magic_defense')::int, 0)) as equip_magic_defense
       FROM character_items ci
       JOIN item_templates it ON ci.item_template_id = it.id
       WHERE ci.character_id = c.id AND ci.equipped_slot IS NOT NULL
     ) eq ON true
     WHERE c.user_id = $1 AND c.party_slot <= $2 AND c.party_slot IS NOT NULL
     ORDER BY c.party_slot ASC`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  if (partyResult.rows.length === 0) {
    throw new AppError('No battle party set', 400);
  }

  const party = partyResult.rows;

  // Get learned skills for all party members
  const characterIds = party.map(c => c.id);
  const skillsResult = await query(
    `SELECT character_id, skill_id, level
     FROM character_skills
     WHERE character_id = ANY($1)`,
    [characterIds]
  );

  // Group skills by character and enhance with skill definitions
  const characterSkills = {};
  for (const row of skillsResult.rows) {
    if (!characterSkills[row.character_id]) {
      characterSkills[row.character_id] = [];
    }
    // Get character class to find skill definition
    const char = party.find(c => c.id === row.character_id);
    const skillDef = char ? getSkillDefinition(char.class, row.skill_id) : null;

    if (skillDef) {
      characterSkills[row.character_id].push({
        id: row.skill_id,
        name: skillDef.name,
        level: row.level,
        mpCost: skillDef.mpCost || 0,
        range: skillDef.range || 1,
        power: skillDef.power || 100,
        type: skillDef.type || 'active',
        effect: skillDef.effect || null,
        aoeRadius: skillDef.aoeRadius || 0,
        description: skillDef.description || ''
      });
    }
  }

  // Check if already in battle - if so, return existing battle data for rejoin
  if (party.some(c => c.in_battle)) {
    // Look for existing active battle
    const existingBattle = await query(
      `SELECT b.id, b.battle_type, b.battle_state, b.map_seed, b.map_width, b.map_height,
              wn.node_type, wn.name as node_name
       FROM battles b
       JOIN world_nodes wn ON b.node_id = wn.id
       WHERE b.player1_id = $1 AND b.status = 'active'
       ORDER BY b.started_at DESC
       LIMIT 1`,
      [req.user.userId]
    );

    if (existingBattle.rows.length > 0) {
      // Return existing battle for rejoin
      const battle = existingBattle.rows[0];
      return res.json({
        battleId: battle.id,
        battleType: battle.battle_type,
        mapSeed: battle.map_seed,
        mapWidth: battle.map_width,
        mapHeight: battle.map_height,
        nodeType: battle.node_type,
        nodeName: battle.node_name,
        state: battle.battle_state,
        rejoined: true
      });
    }

    // Corrupted state: in_battle=true but no active battle found - reset and continue
    await query(
      'UPDATE characters SET in_battle = false WHERE user_id = $1',
      [req.user.userId]
    );
  }

  // Check if any party member has 0 HP
  if (party.some(c => c.hp_current <= 0)) {
    throw new AppError('Cannot battle with incapacitated characters', 400);
  }

  const currentNodeId = party[0].current_node_id;

  // Get node info
  const nodeResult = await query(
    'SELECT node_type, difficulty_tier, local_seed FROM world_nodes WHERE id = $1',
    [currentNodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Current location not found', 400);
  }

  const node = nodeResult.rows[0];

  // Verify this is a battle node
  if (!BATTLE_NODE_TYPES.includes(node.node_type)) {
    throw new AppError('Cannot battle at this location', 400);
  }

  // Generate battle map seed
  const mapSeed = Math.floor(Math.random() * 1000000);

  // Create initial battle state
  const initialState = {
    turn: 1,
    phase: 'active',
    activeUnitIndex: 0,
    activeUnitId: null,
    mapWidth: 32,
    mapHeight: 32,
    units: party.map((char, idx) => ({
      id: char.id,
      type: 'player',
      name: char.name,
      class: char.class,
      level: char.level,
      hp: char.hp_current,
      maxHp: char.hp_max + (parseInt(char.equip_hp) || 0),
      mp: char.mp_current,
      maxMp: char.mp_max + (parseInt(char.equip_mp) || 0),
      // Apply equipment stat bonuses to combat stats
      strength: char.strength + (parseInt(char.equip_strength) || 0),
      intelligence: char.intelligence + (parseInt(char.equip_intelligence) || 0),
      agility: char.agility + (parseInt(char.equip_agility) || 0),
      vitality: char.vitality + (parseInt(char.equip_vitality) || 0),
      luck: char.luck + (parseInt(char.equip_luck) || 0),
      // Equipment-only combat bonuses
      attack: parseInt(char.equip_attack) || 0,
      defense: parseInt(char.equip_defense) || 0,
      magicAttack: parseInt(char.equip_magic_attack) || 0,
      magicDefense: parseInt(char.equip_magic_defense) || 0,
      tileX: 1 + (idx % 3),
      tileY: 13 + Math.floor(idx / 3) * 2,
      ct: 0,
      hasActed: false,
      statusEffects: [],
      // Include learned skills for this character
      skills: characterSkills[char.id] || []
    }))
  };

  // Get consumable items from party leader's inventory
  const partyLeaderId = party[0].id;
  const consumablesResult = await query(
    `SELECT ci.id as inventory_id, it.id as item_id, it.name, it.item_type,
            it.effect_type, it.effect_value, it.description, ci.quantity
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1 AND it.item_type = 'consumable' AND ci.quantity > 0
       AND ci.equipped_slot IS NULL
     ORDER BY it.name`,
    [partyLeaderId]
  );

  // Map consumables to battle format
  initialState.consumables = consumablesResult.rows.map(item => ({
    inventoryId: item.inventory_id,
    itemId: item.item_id,
    name: item.name,
    quantity: item.quantity,
    description: item.description,
    effectType: item.effect_type,
    effectValue: item.effect_value
  }));

  // Generate enemies from templates
  const enemies = await enemyService.generateEncounter(currentNodeId, party);
  initialState.units.push(...enemies);

  // Initialize CT values for all units (adds initial variation)
  battleService.initializeCT(initialState.units);

  // Advance CT and find the first actor
  battleService.advanceToNextActor(initialState);

  // Generate turn predictions
  initialState.turnPredictions = battleService.predictTurnOrder(initialState, 10);

  // Create battle record
  const battleResult = await query(
    `INSERT INTO battles (battle_type, status, node_id, battle_state, map_seed, map_width, map_height, player1_id)
     VALUES ('pve', 'active', $1, $2, $3, 32, 32, $4)
     RETURNING id`,
    [currentNodeId, JSON.stringify(initialState), mapSeed, req.user.userId]
  );

  const battleId = battleResult.rows[0].id;

  // Mark characters as in battle
  await query(
    `UPDATE characters SET in_battle = true
     WHERE user_id = $1 AND party_slot <= $2 AND party_slot IS NOT NULL`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  // Join battle WebSocket room
  battleWebsocket.joinBattle(battleId, req.user.userId);

  res.status(201).json({
    battleId,
    mapSeed,
    mapWidth: 32,
    mapHeight: 32,
    state: initialState
  });
}));

// GET /api/battle/current - Get current battle state
router.get('/current', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT b.id, b.battle_type, b.battle_state, b.map_seed, b.map_width, b.map_height,
            wn.node_type, wn.name as node_name
     FROM battles b
     JOIN world_nodes wn ON b.node_id = wn.id
     WHERE b.player1_id = $1 AND b.status = 'active'
     ORDER BY b.started_at DESC
     LIMIT 1`,
    [req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('No active battle', 404);
  }

  const battle = result.rows[0];

  res.json({
    battleId: battle.id,
    battleType: battle.battle_type,
    mapSeed: battle.map_seed,
    mapWidth: battle.map_width,
    mapHeight: battle.map_height,
    nodeType: battle.node_type,
    nodeName: battle.node_name,
    state: battle.battle_state
  });
}));

// POST /api/battle/action - Submit battle action
router.post('/action', authenticate, asyncHandler(async (req, res) => {
  const { battleId, actionType, unitId, targetTile, skillId } = req.body;

  // Get battle
  const battleResult = await query(
    `SELECT id, battle_state FROM battles
     WHERE id = $1 AND player1_id = $2 AND status = 'active'`,
    [battleId, req.user.userId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found or not active', 404);
  }

  const state = battleResult.rows[0].battle_state;

  // Migration: ensure all units have CT field (for existing battles)
  for (const unit of state.units) {
    if (typeof unit.ct !== 'number') {
      unit.ct = 0;
    }
  }

  // Get active unit using activeUnitId (or fall back to index for migration)
  let activeUnit;
  if (state.activeUnitId) {
    activeUnit = state.units.find(u => u.id === state.activeUnitId);
  }
  if (!activeUnit) {
    activeUnit = state.units[state.activeUnitIndex];
    state.activeUnitId = activeUnit?.id;
  }

  // Validate it's the player's turn
  if (!activeUnit || activeUnit.type !== 'player' || activeUnit.id !== unitId) {
    throw new AppError('Not this unit\'s turn', 400);
  }

  // Process player action using helper
  const result = processAction(state, activeUnit, actionType, targetTile, skillId);

  // If there was an error (e.g., already moved, status effect), return early
  if (result.error) {
    return res.status(400).json({
      error: result.error,
      state,
      availableActions: result.availableActions
    });
  }

  // Check if battle ended from player action
  let battleStatus = checkBattleEnd(state);

  // Process enemy turns ONLY if turn is complete and battle is still active
  let enemyActions = [];
  const turnContinues = !result.turnEnded && battleStatus === 'active';

  if (result.turnEnded && battleStatus === 'active') {
    // Turn is complete - advance to next actor using CT system
    advanceToNextActorWithCT(state);

    // Process all enemy turns until it's a player's turn again
    enemyActions = processEnemyTurns(state);

    // Check if battle ended after enemy turns
    battleStatus = checkBattleEnd(state);
  }

  // Update turn predictions
  state.turnPredictions = battleService.predictTurnOrder(state, 10);

  // Update battle state
  await query(
    'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
    [JSON.stringify(state), battleStatus, battleId]
  );

  // Consume item from inventory if an item was used
  if (result.consumedInventoryId) {
    // Reduce quantity or delete item from character_items
    const itemCheck = await query(
      'SELECT quantity FROM character_items WHERE id = $1',
      [result.consumedInventoryId]
    );
    if (itemCheck.rows.length > 0) {
      if (itemCheck.rows[0].quantity > 1) {
        await query(
          'UPDATE character_items SET quantity = quantity - 1 WHERE id = $1',
          [result.consumedInventoryId]
        );
      } else {
        await query(
          'DELETE FROM character_items WHERE id = $1',
          [result.consumedInventoryId]
        );
      }
    }
  }

  // Broadcast action executed via WebSocket
  battleWebsocket.broadcastActionExecuted(battleId, unitId, actionType, result, req.user.userId);

  // Broadcast enemy actions if any (only when turn completed)
  if (enemyActions && enemyActions.length > 0) {
    battleWebsocket.broadcastEnemyActions(battleId, enemyActions, req.user.userId);
  }

  // Broadcast turn changed only if turn actually ended
  if (result.turnEnded) {
    battleWebsocket.broadcastTurnChanged(
      battleId,
      state.activeUnitIndex,
      state.turn,
      req.user.userId,
      state.activeUnitId,
      state.turnPredictions
    );
  }

  // If battle ended, update characters
  if (battleStatus !== 'active') {
    await query(
      `UPDATE characters SET in_battle = false
       WHERE user_id = $1 AND party_slot <= $2`,
      [req.user.userId, MAX_BATTLE_PARTY_SIZE]
    );

    // Calculate rewards for victory
    if (battleStatus === 'victory') {
      const enemies = state.units.filter(u => u.type === 'enemy');
      const players = state.units.filter(u => u.type === 'player');
      const partyLevel = Math.floor(
        players.reduce((sum, u) => sum + (u.level || 1), 0) / players.length
      ) || 1;

      // Get node info for rewards calculation
      const nodeResult = await query(
        'SELECT difficulty_tier, node_type FROM world_nodes WHERE id = (SELECT node_id FROM battles WHERE id = $1)',
        [battleId]
      );
      const difficultyTier = nodeResult.rows[0]?.difficulty_tier || 1;
      const nodeType = nodeResult.rows[0]?.node_type || 'forest';

      // Calculate rewards using service
      const gold = battleService.calculateGoldReward(enemies, difficultyTier);
      const exp = battleService.calculateExperienceReward(enemies, partyLevel);

      // Roll item drops from each enemy
      const droppedItems = [];
      for (const enemy of enemies) {
        const drops = await itemDropService.rollDrops(enemy, difficultyTier, nodeType);
        droppedItems.push(...drops);
      }

      // Get party leader for item storage
      const partyLeaderResult = await query(
        'SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1',
        [req.user.userId]
      );
      const partyLeaderId = partyLeaderResult.rows[0]?.id;

      // Use transaction for rewards distribution
      await withTransaction(async (client) => {
        // Update battle record
        const rewardsData = {
          gold,
          experience: exp,
          items: itemDropService.formatDropsForResponse(droppedItems)
        };
        await client.query(
          'UPDATE battles SET rewards = $1, ended_at = NOW() WHERE id = $2',
          [JSON.stringify(rewardsData), battleId]
        );

        // Award gold to user
        await client.query(
          'UPDATE users SET gold = gold + $1 WHERE id = $2',
          [gold, req.user.userId]
        );

        // Distribute XP to battle party characters
        const xpPerCharacter = Math.floor(exp / players.length);
        await client.query(
          `UPDATE characters
           SET experience = experience + $1
           WHERE user_id = $2 AND party_slot <= $3 AND party_slot IS NOT NULL`,
          [xpPerCharacter, req.user.userId, MAX_BATTLE_PARTY_SIZE]
        );

        // Store dropped items in party leader's inventory
        if (partyLeaderId) {
          for (const item of droppedItems) {
            await itemDropService.storeDroppedItem(partyLeaderId, item, client);
          }
        }
      });

      result.rewards = {
        gold,
        experience: exp,
        items: itemDropService.formatDropsForResponse(droppedItems)
      };
    }

    // Broadcast battle end via WebSocket
    battleWebsocket.broadcastBattleEnd(battleId, battleStatus, result.rewards);

    // Leave battle room
    battleWebsocket.leaveBattle(battleId, req.user.userId);
  }

  res.json({
    state,
    actionResult: result,
    enemyActions,
    battleStatus,
    // Two-action turn system: indicate if turn continues
    turnContinues,
    availableActions: result.availableActions
  });
}));

// GET /api/battle/rewards - Get rewards after victory
router.get('/rewards/:battleId', authenticate, asyncHandler(async (req, res) => {
  const { battleId } = req.params;

  const result = await query(
    `SELECT rewards FROM battles
     WHERE id = $1 AND player1_id = $2 AND status = 'victory'`,
    [battleId, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Battle not found or not a victory', 404);
  }

  res.json({ rewards: result.rows[0].rewards });
}));

module.exports = router;
