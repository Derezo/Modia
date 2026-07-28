/**
 * Pure helpers for planning a player-preserving world regeneration.
 *
 * Legacy records use the database's snake_case shape while assembled world
 * nodes use camelCase. The helpers accept either shape and never mutate their
 * inputs.
 */

export const COMBAT_NODE_TYPES = Object.freeze([
  'forest',
  'cave',
  'mountain',
  'bridge',
]);

export const NODE_PROGRESS_KEYS = Object.freeze([
  'bridge',
  'castle',
  'caravan',
  'cave',
  'chest',
  'city',
  'discovery',
  'farm',
  'fishing',
  'fishing_spot',
  'forest',
  'guild',
  'keep',
  'merchant_caravan',
  'merchant',
  'mountain',
  'palace',
  'ruins',
  'shrine',
  'village',
  'watchtower',
]);

const COMBAT_NODE_TYPE_SET = new Set(COMBAT_NODE_TYPES);
const ANCHOR_NODE_TYPES = new Set(['castle', 'keep', 'guild', 'palace']);
const DISCOVERY_METHOD_PRECEDENCE = Object.freeze({
  initial: 0,
  adjacent: 1,
  travel: 2,
});

const SEMANTIC_CLASSES = Object.freeze({
  bridge: 'combat',
  castle: 'castle',
  caravan: 'commerce',
  cave: 'combat',
  chest: 'reward_site',
  city: 'settlement',
  discovery: 'reward_site',
  farm: 'settlement',
  fishing: 'exploration_site',
  fishing_spot: 'exploration_site',
  forest: 'combat',
  guild: 'guild',
  keep: 'keep',
  merchant: 'commerce',
  merchant_caravan: 'commerce',
  mountain: 'combat',
  palace: 'palace',
  ruins: 'exploration_site',
  shrine: 'reward_site',
  village: 'settlement',
  watchtower: 'exploration_site',
});

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function canonicalCompare(left, right) {
  return String(left).localeCompare(String(right), 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareNumbers(left, right) {
  if (left === right) return 0;
  if (!Number.isFinite(left)) return 1;
  if (!Number.isFinite(right)) return -1;
  return left - right;
}

function normalizeNode(node, kind, index) {
  if (!node || typeof node !== 'object') {
    throw new TypeError(`${kind} node at index ${index} must be an object`);
  }

  const id = firstDefined(node.id, node.nodeId, node.node_id);
  const nodeKey = firstDefined(node.nodeKey, node.node_key);
  const nodeType = firstDefined(node.nodeType, node.node_type);
  const xCoord = Number(firstDefined(node.xCoord, node.x_coord));
  const yCoord = Number(firstDefined(node.yCoord, node.y_coord));
  const regionId = firstDefined(node.regionId, node.region_id);
  const regionRace = firstDefined(node.regionRace, node.region_race);
  const difficultyTier = Number(firstDefined(
    node.difficultyTier,
    node.difficulty_tier
  ));

  if (kind === 'legacy' && !Number.isInteger(id)) {
    throw new TypeError(`Legacy node at index ${index} has no integer id`);
  }
  if (kind === 'target' && (typeof nodeKey !== 'string' || nodeKey.length === 0)) {
    throw new TypeError(`Target node at index ${index} has no stable nodeKey`);
  }
  if (typeof nodeType !== 'string' || nodeType.length === 0) {
    throw new TypeError(`${kind} node at index ${index} has no node type`);
  }

  return {
    original: node,
    index,
    id,
    nodeKey: typeof nodeKey === 'string' ? nodeKey : null,
    nodeType,
    name: firstDefined(node.name, ''),
    xCoord,
    yCoord,
    regionId,
    regionRace,
    difficultyTier,
    guildType: firstDefined(
      node.guildType,
      node.guild_type,
      node.guildClass,
      node.guild_class
    ),
  };
}

function semanticClass(nodeType) {
  return SEMANTIC_CLASSES[nodeType] ?? `node_type:${nodeType}`;
}

function sameRegion(left, right) {
  if (left.regionRace != null && right.regionRace != null) {
    return left.regionRace === right.regionRace;
  }
  return left.regionId != null
    && right.regionId != null
    && left.regionId === right.regionId;
}

function sameName(left, right) {
  return left.name !== ''
    && right.name !== ''
    && left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) === 0;
}

function isSemanticAnchorMatch(legacy, target) {
  if (legacy.nodeType !== target.nodeType
      || !ANCHOR_NODE_TYPES.has(legacy.nodeType)) {
    return false;
  }
  if (legacy.nodeType === 'palace') return true;
  if (legacy.nodeType === 'guild') {
    return legacy.guildType != null
      && target.guildType != null
      && legacy.guildType === target.guildType
      && sameRegion(legacy, target);
  }
  return sameRegion(legacy, target);
}

function classifyCandidate(legacy, target) {
  if (legacy.nodeKey && legacy.nodeKey === target.nodeKey) {
    return {
      tier: 0,
      method: 'stable_key',
      confidence: 'high',
      reason: `stable node key ${legacy.nodeKey} is unchanged`,
    };
  }
  if (isSemanticAnchorMatch(legacy, target)) {
    return {
      tier: 1,
      method: 'semantic_anchor',
      confidence: 'high',
      reason: `${legacy.nodeType} anchor matches its region and role`,
    };
  }
  if (legacy.nodeType === target.nodeType
      && sameName(legacy, target)
      && sameRegion(legacy, target)) {
    return {
      tier: 2,
      method: 'type_name_region',
      confidence: 'high',
      reason: 'node type, name, and region identity match',
    };
  }
  if (legacy.nodeType === target.nodeType && sameName(legacy, target)) {
    return {
      tier: 3,
      method: 'type_name',
      confidence: 'high',
      reason: 'node type and name match',
    };
  }
  if (legacy.nodeType === target.nodeType && sameRegion(legacy, target)) {
    return {
      tier: 4,
      method: 'type_region',
      confidence: 'medium',
      reason: 'node type and region identity match',
    };
  }
  if (legacy.nodeType === target.nodeType) {
    return {
      tier: 5,
      method: 'node_type',
      confidence: 'medium',
      reason: 'node type matches; nearest balanced target selected',
    };
  }
  if (semanticClass(legacy.nodeType) === semanticClass(target.nodeType)
      && sameRegion(legacy, target)) {
    return {
      tier: 6,
      method: 'semantic_class_region',
      confidence: 'low',
      reason: `type changed within ${semanticClass(legacy.nodeType)} in the same region`,
    };
  }
  if (semanticClass(legacy.nodeType) === semanticClass(target.nodeType)) {
    return {
      tier: 7,
      method: 'semantic_class',
      confidence: 'low',
      reason: `type changed within ${semanticClass(legacy.nodeType)}`,
    };
  }
  return null;
}

function coordinateDistance(left, right) {
  if (![left.xCoord, left.yCoord, right.xCoord, right.yCoord].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.hypot(left.xCoord - right.xCoord, left.yCoord - right.yCoord);
}

function difficultyDistance(left, right) {
  if (!Number.isFinite(left.difficultyTier)
      || !Number.isFinite(right.difficultyTier)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(left.difficultyTier - right.difficultyTier);
}

function compareCandidates(left, right) {
  const leftGroup = left.classification.tier <= 1
    ? left.classification.tier
    : left.classification.tier <= 5 ? 2 : 3;
  const rightGroup = right.classification.tier <= 1
    ? right.classification.tier
    : right.classification.tier <= 5 ? 2 : 3;
  return leftGroup - rightGroup
    || (leftGroup >= 2 ? left.useCount - right.useCount : 0)
    || left.classification.tier - right.classification.tier
    || (leftGroup < 2 ? left.useCount - right.useCount : 0)
    || compareNumbers(left.coordinateDistance, right.coordinateDistance)
    || compareNumbers(left.difficultyDistance, right.difficultyDistance)
    || canonicalCompare(left.target.nodeKey, right.target.nodeKey);
}

function normalizeNodes(nodes, kind) {
  if (!Array.isArray(nodes)) {
    throw new TypeError(`${kind}Nodes must be an array`);
  }
  const normalized = nodes.map((node, index) => normalizeNode(node, kind, index));
  const identities = new Set();
  for (const node of normalized) {
    const identity = kind === 'legacy' ? node.id : node.nodeKey;
    if (identities.has(identity)) {
      throw new Error(`Duplicate ${kind} node identity: ${identity}`);
    }
    identities.add(identity);
  }
  return normalized;
}

function normalizeRequiredTargetNodeKeysByLegacyId(value, legacyNodes) {
  if (value === undefined) return null;

  if (value === null || typeof value !== 'object') {
    throw new TypeError(
      'requiredTargetNodeKeysByLegacyId must be a plain object'
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      'requiredTargetNodeKeysByLegacyId must be a plain object'
    );
  }

  const legacyNodeIds = new Set(legacyNodes.map((node) => node.id));
  const normalized = new Map();
  for (const legacyNodeIdKey of Reflect.ownKeys(value)) {
    if (typeof legacyNodeIdKey !== 'string') {
      throw new TypeError(
        'requiredTargetNodeKeysByLegacyId keys must be legacy node IDs'
      );
    }

    const legacyNodeId = Number(legacyNodeIdKey);
    if (!Number.isInteger(legacyNodeId)
        || String(legacyNodeId) !== legacyNodeIdKey) {
      throw new TypeError(
        `Invalid legacy node ID constraint key: ${legacyNodeIdKey}`
      );
    }
    if (!legacyNodeIds.has(legacyNodeId)) {
      throw new Error(
        `Eligibility constraint references unknown legacy node ${legacyNodeId}`
      );
    }

    const targetNodeKeys = value[legacyNodeIdKey];
    if (!Array.isArray(targetNodeKeys)) {
      throw new TypeError(
        `Eligibility constraint for legacy node ${legacyNodeId}`
        + ' must be an array of target node keys'
      );
    }

    const uniqueTargetNodeKeys = new Set();
    for (const targetNodeKey of targetNodeKeys) {
      if (typeof targetNodeKey !== 'string' || targetNodeKey.length === 0) {
        throw new TypeError(
          `Eligibility constraint for legacy node ${legacyNodeId}`
          + ' must contain only non-empty target node keys'
        );
      }
      if (uniqueTargetNodeKeys.has(targetNodeKey)) {
        throw new Error(
          `Eligibility constraint for legacy node ${legacyNodeId}`
          + ` contains duplicate target node key ${targetNodeKey}`
        );
      }
      uniqueTargetNodeKeys.add(targetNodeKey);
    }

    normalized.set(
      legacyNodeId,
      [...uniqueTargetNodeKeys].sort(canonicalCompare)
    );
  }
  return normalized;
}

function resolveCriticalReferences({
  references,
  kind,
  mappingByLegacyId,
  targetByKey,
}) {
  if (!Array.isArray(references)) {
    throw new TypeError(`${kind} references must be an array`);
  }

  return references.map((reference, index) => {
    const legacyNodeId = firstDefined(
      reference.nodeId,
      reference.node_id,
      reference.currentNodeId,
      reference.current_node_id
    );
    const referenceId = firstDefined(
      reference.characterId,
      reference.character_id,
      reference.battleId,
      reference.battle_id,
      reference.id,
      index
    );
    const mapping = mappingByLegacyId.get(legacyNodeId);
    if (mapping) {
      return {
        kind,
        referenceId,
        legacyNodeId,
        targetNodeKey: mapping.targetNodeKey,
        method: 'mapped',
        reason: `resolved through ${mapping.method}`,
      };
    }

    const fallbackNodeKey = firstDefined(
      reference.homeCastleNodeKey,
      reference.home_castle_node_key
    );
    const fallback = targetByKey.get(fallbackNodeKey);
    if (fallback?.nodeType === 'castle') {
      return {
        kind,
        referenceId,
        legacyNodeId,
        targetNodeKey: fallback.nodeKey,
        method: 'home_castle_fallback',
        reason: 'legacy node was unmappable; explicit home-castle fallback used',
      };
    }

    const fallbackDetail = fallbackNodeKey
      ? `; fallback ${fallbackNodeKey} is not a target castle`
      : '; no home-castle fallback was supplied';
    throw new Error(
      `Cannot map ${kind} ${referenceId} from legacy node ${legacyNodeId}`
      + fallbackDetail
    );
  });
}

/**
 * Build a deterministic, auditable mapping from legacy DB nodes to assembled
 * target nodes. Reuse is deliberate: when a type shrinks, multiple legacy
 * nodes can map to one target while progress rows are merged by their owners.
 */
export function buildWorldMigrationMappingPlan({
  legacyNodes,
  targetNodes,
  characterLocations = [],
  activeBattleNodes = [],
  requiredTargetNodeKeysByLegacyId,
}) {
  const legacy = normalizeNodes(legacyNodes, 'legacy')
    .sort((left, right) => left.id - right.id);
  const targets = normalizeNodes(targetNodes, 'target')
    .sort((left, right) => canonicalCompare(left.nodeKey, right.nodeKey));
  const eligibilityConstraints = normalizeRequiredTargetNodeKeysByLegacyId(
    requiredTargetNodeKeysByLegacyId,
    legacy
  );
  const targetUseCounts = new Map(targets.map((target) => [target.nodeKey, 0]));
  const mappings = [];
  const unmapped = [];

  for (const source of legacy) {
    const requiredTargetNodeKeys = eligibilityConstraints?.get(source.id);
    const allowedTargetNodeKeys = requiredTargetNodeKeys === undefined
      ? null
      : new Set(requiredTargetNodeKeys);
    const candidates = targets
      .filter((target) => allowedTargetNodeKeys === null
        || allowedTargetNodeKeys.has(target.nodeKey))
      .map((target) => {
        const classification = classifyCandidate(source, target);
        if (!classification) return null;
        return {
          target,
          classification,
          useCount: targetUseCounts.get(target.nodeKey),
          coordinateDistance: coordinateDistance(source, target),
          difficultyDistance: difficultyDistance(source, target),
        };
      })
      .filter(Boolean)
      .sort(compareCandidates);
    const selected = candidates[0];

    if (!selected) {
      const unmappedEntry = {
        legacyNodeId: source.id,
        legacyNodeKey: source.nodeKey,
        legacyNodeType: source.nodeType,
        semanticClass: semanticClass(source.nodeType),
        reason: allowedTargetNodeKeys === null
          ? 'target world has no compatible semantic class'
          : 'target eligibility constraint allows no compatible target',
      };
      if (allowedTargetNodeKeys !== null) {
        unmappedEntry.eligibilityConstraintApplied = true;
        unmappedEntry.requiredTargetNodeKeys = requiredTargetNodeKeys;
      }
      unmapped.push(unmappedEntry);
      continue;
    }

    const collisionOrdinal = selected.useCount + 1;
    targetUseCounts.set(selected.target.nodeKey, collisionOrdinal);
    const mapping = {
      legacyNodeId: source.id,
      legacyNodeKey: source.nodeKey,
      legacyNodeType: source.nodeType,
      targetNodeKey: selected.target.nodeKey,
      targetNodeType: selected.target.nodeType,
      semanticClass: semanticClass(source.nodeType),
      method: selected.classification.method,
      confidence: selected.classification.confidence,
      reason: selected.classification.reason,
      collisionOrdinal,
      coordinateDistance: Number.isFinite(selected.coordinateDistance)
        ? selected.coordinateDistance
        : null,
      difficultyDistance: Number.isFinite(selected.difficultyDistance)
        ? selected.difficultyDistance
        : null,
    };
    if (allowedTargetNodeKeys !== null) {
      mapping.eligibilityConstraintApplied = true;
      mapping.requiredTargetNodeKeys = requiredTargetNodeKeys;
    }
    mappings.push(mapping);
  }

  const mappingsByTarget = new Map();
  for (const mapping of mappings) {
    const group = mappingsByTarget.get(mapping.targetNodeKey) ?? [];
    group.push(mapping);
    mappingsByTarget.set(mapping.targetNodeKey, group);
  }
  for (const mapping of mappings) {
    const groupSize = mappingsByTarget.get(mapping.targetNodeKey).length;
    mapping.targetAssignmentCount = groupSize;
    mapping.isCollision = groupSize > 1;
  }

  const mappingByLegacyId = new Map(
    mappings.map((mapping) => [mapping.legacyNodeId, mapping])
  );
  const targetByKey = new Map(targets.map((target) => [target.nodeKey, target]));
  const criticalReferences = {
    characterLocations: resolveCriticalReferences({
      references: characterLocations,
      kind: 'character_location',
      mappingByLegacyId,
      targetByKey,
    }),
    activeBattleNodes: resolveCriticalReferences({
      references: activeBattleNodes,
      kind: 'active_battle',
      mappingByLegacyId,
      targetByKey,
    }),
  };

  const methodCounts = {};
  const confidenceCounts = {};
  for (const mapping of mappings) {
    methodCounts[mapping.method] = (methodCounts[mapping.method] ?? 0) + 1;
    confidenceCounts[mapping.confidence] =
      (confidenceCounts[mapping.confidence] ?? 0) + 1;
  }

  const audit = {
    legacyNodeCount: legacy.length,
    targetNodeCount: targets.length,
    mappedNodeCount: mappings.length,
    unmappedNodeCount: unmapped.length,
    collisionTargetCount: [...mappingsByTarget.values()]
      .filter((group) => group.length > 1)
      .length,
    collisionMappingCount: mappings.filter((mapping) => mapping.isCollision).length,
    methodCounts,
    confidenceCounts,
  };
  if (eligibilityConstraints !== null) {
    audit.eligibilityConstrainedNodeCount = eligibilityConstraints.size;
    audit.eligibilityConstraintUnmappedNodeCount = unmapped
      .filter((entry) => entry.eligibilityConstraintApplied)
      .length;
  }

  return {
    mappings,
    unmapped,
    criticalReferences,
    audit,
  };
}

/**
 * Return the strongest discovery method. Travel always beats adjacency, which
 * always beats initial discovery.
 */
export function mergeDiscoveryMethods(methods) {
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new TypeError('methods must be a non-empty array');
  }
  let strongest = null;
  for (const method of methods) {
    if (!Object.hasOwn(DISCOVERY_METHOD_PRECEDENCE, method)) {
      throw new Error(`Unsupported discovery method: ${method}`);
    }
    if (strongest === null
        || DISCOVERY_METHOD_PRECEDENCE[method]
          > DISCOVERY_METHOD_PRECEDENCE[strongest]) {
      strongest = method;
    }
  }
  return strongest;
}

/**
 * Merge discovery rows after node remapping has introduced key collisions.
 * The returned canonical rows are sorted and include the number of source
 * rows that were folded together.
 */
export function mergeDiscoveryRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('records must be an array');
  }
  const groups = new Map();

  for (const record of records) {
    const userId = firstDefined(record.userId, record.user_id);
    const nodeId = firstDefined(record.nodeId, record.node_id, record.nodeKey);
    const discoveryMethod = firstDefined(
      record.discoveryMethod,
      record.discovery_method
    );
    if (userId == null || nodeId == null) {
      throw new Error('Discovery record must identify both user and node');
    }
    mergeDiscoveryMethods([discoveryMethod]);
    const key = JSON.stringify([typeof userId, userId, typeof nodeId, nodeId]);
    const group = groups.get(key) ?? { userId, nodeId, records: [] };
    group.records.push({
      discoveryMethod,
      discoveredAt: firstDefined(record.discoveredAt, record.discovered_at, null),
    });
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const discoveryMethod = mergeDiscoveryMethods(
        group.records.map((record) => record.discoveryMethod)
      );
      const candidateTimes = group.records
        .filter((record) => record.discoveryMethod === discoveryMethod)
        .map((record) => record.discoveredAt)
        .filter((value) => value != null)
        // Migration inputs are canonical PostgreSQL TIMESTAMP WITHOUT TIME
        // ZONE strings. Compare their wall-clock values directly: Date would
        // both apply the host timezone and discard sub-millisecond precision.
        .sort(canonicalCompare);
      return {
        userId: group.userId,
        nodeId: group.nodeId,
        discoveryMethod,
        discoveredAt: candidateTimes[0] ?? null,
        sourceRecordCount: group.records.length,
      };
    })
    .sort((left, right) =>
      canonicalCompare(left.userId, right.userId)
      || canonicalCompare(left.nodeId, right.nodeId)
    );
}

export function hasFullCombatClearance(legacyNodes, clearedLegacyNodeIds) {
  const normalized = normalizeNodes(legacyNodes, 'legacy');
  const combatNodeIds = normalized
    .filter((node) => COMBAT_NODE_TYPE_SET.has(node.nodeType))
    .map((node) => node.id);
  if (combatNodeIds.length === 0) return false;
  const cleared = new Set(clearedLegacyNodeIds);
  return combatNodeIds.every((nodeId) => cleared.has(nodeId));
}

/**
 * Preserve mapped clearance and, for a player who cleared every legacy combat
 * node, extend that achievement to every combat node in the regenerated world.
 */
export function expandFullCombatClearance({
  legacyNodes,
  targetNodes,
  clearedLegacyNodeIds,
  mappedTargetNodeKeys = [],
}) {
  const targets = normalizeNodes(targetNodes, 'target');
  const hadFullLegacyCoverage = hasFullCombatClearance(
    legacyNodes,
    clearedLegacyNodeIds
  );
  const preserved = new Set(mappedTargetNodeKeys);
  const beforeExpansion = new Set(preserved);

  if (hadFullLegacyCoverage) {
    for (const target of targets) {
      if (COMBAT_NODE_TYPE_SET.has(target.nodeType)) {
        preserved.add(target.nodeKey);
      }
    }
  }

  const targetNodeKeys = [...preserved].sort(canonicalCompare);
  return {
    hadFullLegacyCoverage,
    targetNodeKeys,
    addedTargetNodeKeys: targetNodeKeys
      .filter((nodeKey) => !beforeExpansion.has(nodeKey)),
  };
}

function normalizeIntegerMapping(nodeIdMapping) {
  const entries = nodeIdMapping instanceof Map
    ? [...nodeIdMapping.entries()]
    : Object.entries(nodeIdMapping ?? {});
  const normalized = new Map();
  for (const [sourceValue, targetValue] of entries) {
    const source = Number(sourceValue);
    if (!Number.isInteger(source) || !Number.isInteger(targetValue)) {
      throw new TypeError('nodeIdMapping must contain only integer-to-integer mappings');
    }
    normalized.set(source, targetValue);
  }
  return normalized;
}

function remapKnownNodeIdArray(value, nodeIdMapping, path) {
  if (Number.isInteger(value)) {
    if (!nodeIdMapping.has(value)) {
      throw new Error(`Missing node ID mapping for ${value} at ${path}`);
    }
    return nodeIdMapping.get(value);
  }
  if (Array.isArray(value)) {
    const remapped = value.map((item, index) =>
      remapKnownNodeIdArray(item, nodeIdMapping, `${path}[${index}]`)
    );
    return remapped.filter((item, index) =>
      !Number.isInteger(item) || remapped.indexOf(item) === index
    );
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        remapKnownNodeIdArray(child, nodeIdMapping, `${path}.${key}`),
      ])
    );
  }
  return value;
}

/**
 * Recursively find known node_progress arrays and remap only integer values
 * inside those arrays. Numbers in material/enemy progress or metadata remain
 * untouched. Collisions are de-duplicated in first-seen order.
 */
export function remapNodeProgress(
  nodeProgress,
  nodeIdMapping,
  { knownNodeProgressKeys = NODE_PROGRESS_KEYS } = {}
) {
  const mapping = normalizeIntegerMapping(nodeIdMapping);
  const knownKeys = new Set(knownNodeProgressKeys);

  function visit(value, path) {
    if (Array.isArray(value)) {
      return value.map((item, index) => visit(item, `${path}[${index}]`));
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key;
        if (knownKeys.has(key) && Array.isArray(child)) {
          return [key, remapKnownNodeIdArray(child, mapping, childPath)];
        }
        return [key, visit(child, childPath)];
      })
    );
  }

  return visit(nodeProgress, '');
}
