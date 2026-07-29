import { GUILD_ADVANCEMENT_TIERS } from '../../../shared/constants.js';

const BASE_GUILDS = Object.keys(GUILD_ADVANCEMENT_TIERS);

function sameId(left, right) {
  return left !== null
    && left !== undefined
    && right !== null
    && right !== undefined
    && String(left) === String(right);
}

export function getGuildForClass(className) {
  const normalizedClass = String(className || '').toLowerCase();
  if (BASE_GUILDS.includes(normalizedClass)) return normalizedClass;

  return BASE_GUILDS.find(guild => (
    GUILD_ADVANCEMENT_TIERS[guild].includes(normalizedClass)
  )) || null;
}

export function getGuildCharacters(characters, guildClass) {
  const normalizedGuild = String(guildClass || '').toLowerCase();
  const roster = Array.isArray(characters) ? characters : [];

  if (!normalizedGuild) return [...roster];
  return roster.filter(character => getGuildForClass(character?.class) === normalizedGuild);
}

export function isCharacterAtNode(character, nodeId) {
  if (nodeId === null || nodeId === undefined) return true;
  return sameId(
    character?.current_node_id ?? character?.currentNodeId,
    nodeId
  );
}

export function selectGuildCharacter({
  characters,
  guildClass,
  preferredCharacterId = null,
  activeCharacter = null,
  nodeId = null
}) {
  const guildCharacters = getGuildCharacters(characters, guildClass);
  const presentCharacters = guildCharacters.filter(character => (
    isCharacterAtNode(character, nodeId)
  ));
  if (presentCharacters.length === 0) {
    return { character: null, guildCharacters, presentCharacters };
  }

  const activeCharacterId = typeof activeCharacter === 'object'
    ? activeCharacter?.id
    : activeCharacter;
  const preferred = presentCharacters.find(character => sameId(character.id, preferredCharacterId));
  const active = presentCharacters.find(character => sameId(character.id, activeCharacterId));
  const partyLeader = presentCharacters.find(character => (
    Number(character.party_slot ?? character.partySlot) === 1
  ));

  return {
    character: preferred || active || partyLeader || presentCharacters[0],
    guildCharacters,
    presentCharacters
  };
}

export function formatClassName(className) {
  return String(className || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function positiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function objective(label, current, required, complete = null) {
  const normalizedCurrent = positiveNumber(current);
  const normalizedRequired = positiveNumber(required);
  const isComplete = complete ?? (
    normalizedRequired === 0 || normalizedCurrent >= normalizedRequired
  );

  return {
    label,
    current: normalizedCurrent,
    required: normalizedRequired,
    complete: Boolean(isComplete),
    percentage: normalizedRequired > 0
      ? Math.min(100, Math.round((normalizedCurrent / normalizedRequired) * 100))
      : 100
  };
}

function normalizeMaterialObjectives(quest) {
  const calculated = quest?.progress?.materials?.items;
  if (Array.isArray(calculated)) {
    return calculated.map(item => {
      const itemId = item.itemTemplateId ?? item.item_template_id ?? item.itemId;
      return objective(
        item.name || `Item #${itemId ?? '?'}`,
        item.collected,
        item.required ?? item.quantity,
        item.complete
      );
    });
  }

  const progress = quest?.materialProgress || {};
  return (quest?.materialRequirements || []).map(item => {
    const itemId = item.itemTemplateId ?? item.item_template_id ?? item.itemId;
    return objective(
      item.name || `Item #${itemId ?? '?'}`,
      progress[itemId] || 0,
      item.required ?? item.quantity
    );
  });
}

function normalizeEnemyObjectives(quest) {
  const calculated = quest?.progress?.enemies?.enemies;
  if (Array.isArray(calculated)) {
    return calculated.map(enemy => {
      const archetype = enemy.enemyArchetype ?? enemy.enemy_archetype ?? enemy.type;
      return objective(
        `Defeat ${enemy.name || formatClassName(archetype)}`,
        enemy.killed,
        enemy.required ?? enemy.count,
        enemy.complete
      );
    });
  }

  const progress = quest?.enemyProgress || {};
  return (quest?.enemyRequirements || []).map(enemy => {
    const archetype = enemy.enemyArchetype ?? enemy.enemy_archetype ?? enemy.type;
    return objective(
      `Defeat ${formatClassName(archetype)}`,
      progress[archetype] || 0,
      enemy.required ?? enemy.count
    );
  });
}

function normalizeNodeObjectives(quest) {
  const calculated = quest?.progress?.nodes?.nodes;
  if (Array.isArray(calculated)) {
    return calculated.map(node => {
      const nodeType = node.nodeType ?? node.node_type ?? node.type;
      return objective(
        node.name || `Visit ${formatClassName(nodeType)} nodes`,
        node.visited,
        node.required ?? node.count,
        node.complete
      );
    });
  }

  const progress = quest?.nodeProgress || {};
  return (quest?.nodeRequirements || []).map(node => {
    const nodeType = node.nodeType ?? node.node_type ?? node.type;
    const value = progress[nodeType];
    const visited = Array.isArray(value) ? value.length : value || 0;
    return objective(
      `Visit ${formatClassName(nodeType)} nodes`,
      visited,
      node.required ?? node.count
    );
  });
}

export function getQuestObjectives(quest) {
  const materials = normalizeMaterialObjectives(quest);
  const enemies = normalizeEnemyObjectives(quest);
  const nodes = normalizeNodeObjectives(quest);
  const all = [...materials, ...enemies, ...nodes];

  return {
    materials,
    enemies,
    nodes,
    allComplete: quest?.progress?.allComplete ?? all.every(item => item.complete)
  };
}

/**
 * Preserve the complete negotiated battle response when handing a guild trial
 * to BattleScene. Battle Map V2 responses carry `snapshot` instead of the
 * legacy `state` field.
 */
export function buildBossBattleSceneData(response) {
  return {
    ...(response || {}),
    isBossBattle: true
  };
}
