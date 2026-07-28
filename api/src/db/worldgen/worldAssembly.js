/**
 * Pure world-generation assembly boundary.
 *
 * This module owns the only supported conversion from the phase-specific
 * index/reference formats into the stable-key graph that is finalized,
 * validated, hashed, and persisted.
 */

import { createHash } from 'node:crypto';
import {
  canonicalKeyCompare,
  canonicalStringify,
  createRandomStreamsForAttempt,
  createWorldgenConfig
} from './randomStreams.js';
import {
  INTER_REGION_CONFIG,
  FINALIZED_WORLD_DOMAINS,
  GUILD_CONFIG,
  NODE_NAME_PREFIXES,
  NODE_NAME_SUFFIXES,
  OPENING_PROGRESSION_CONFIG,
  PHASE6_CONFIG
} from './constants.js';
import { generateCastlePlacements } from './castlePlacement.js';
import { createVoronoiRegions } from './voronoiPartitioning.js';
import { generateAllRegionNodes, isPointInPolygon } from './nodeGeneration.js';
import { generateAllRegionConnections } from './internalConnections.js';
import { generateInterRegionConnections } from './interRegionConnections.js';
import { calculateDifficultyTier, validateFinalizedWorld } from './validation.js';
import { generateNodeFeatures, generateObstacles } from './terrain.js';
import {
  COMBAT_NODE_TYPES as SHARED_COMBAT_NODE_TYPES,
  isBlockingNode
} from '../../../../shared/constants.js';

const COMBAT_NODE_TYPES = new Set(SHARED_COMBAT_NODE_TYPES);
const VALID_PATH_TYPES = new Set(['road', 'trail', 'bridge', 'tunnel']);
const REWARD_NODE_TYPES = ['chest', 'shrine', 'discovery'];

/**
 * Hash the finalized persisted-world payload. Migration-only semantic
 * projections use this same boundary so seed metadata always describes the
 * node records that will actually be inserted.
 */
export function calculateWorldOutputHash({
  config,
  castles,
  regions,
  nodes,
  connections,
  routeManifest,
  obstacles
}) {
  return createHash('sha256')
    .update(canonicalStringify({
      config,
      castles,
      regions,
      nodes,
      connections,
      routeManifest,
      obstacles
    }))
    .digest('hex');
}

function unwrapNodeReference(value) {
  if (value && typeof value === 'object' && value.node) return value.node;
  return value;
}

function normalizeInternalEdges(connectionData) {
  const nodeByKey = new Map(
    [...connectionData.nodesByRegion.values()]
      .flat()
      .map((node) => [node.nodeKey, node])
  );
  const edges = [];
  for (const connection of connectionData.allConnections) {
    const from = nodeByKey.get(connection.fromNodeKey);
    const to = nodeByKey.get(connection.toNodeKey);
    if (!from || !to) {
      throw new Error(
        `Unresolved Phase-4 stable edge in region ${connection.regionId}: `
        + `${connection.fromNodeKey ?? '<missing>'} -> `
        + `${connection.toNodeKey ?? '<missing>'}`
      );
    }
    if (from.regionId !== connection.regionId || to.regionId !== connection.regionId) {
      throw new Error(
        `Phase-4 edge ${connection.fromNodeKey} -> ${connection.toNodeKey} `
        + `does not belong to declared region ${connection.regionId}`
      );
    }
    edges.push({
      fromNodeKey: connection.fromNodeKey,
      toNodeKey: connection.toNodeKey,
      regionId: connection.regionId,
      routeId: null,
      routePairKey: null,
      routeKind: null,
      regionPair: [],
      segmentIndex: null,
      segmentKind: null,
      pathType: 'road',
      difficultyPolicy: null
    });
  }
  return edges;
}

function pathTypeForConnection(connection, from, to) {
  if (connection.pathType && VALID_PATH_TYPES.has(connection.pathType)) {
    return connection.pathType;
  }
  const kind = connection.connectionType ?? '';
  if (from.isBridge || to.isBridge || kind.includes('bridge')) return 'bridge';
  if (kind.includes('trade')) return 'road';
  if (kind.includes('wilderness')) return 'trail';
  if (kind.includes('palace')) return 'road';
  return 'trail';
}

function normalizeInterRegionEdges(connections) {
  return connections.map((connection, ordinal) => {
    const from = unwrapNodeReference(connection.from);
    const to = unwrapNodeReference(connection.to);
    const missingFields = [
      'fromNodeKey',
      'toNodeKey',
      'routeId',
      'routeKind',
      'segmentKind',
      'difficultyPolicy'
    ].filter((field) =>
      connection[field] === undefined
      || connection[field] === null
      || connection[field] === ''
    );
    if (missingFields.length > 0
        || !Array.isArray(connection.regionPair)
        || connection.regionPair.length === 0
        || !Number.isInteger(connection.segmentIndex)
        || connection.segmentIndex < 0) {
      throw new Error(
        `Inter-region edge at position ${ordinal} is missing canonical Phase-5 metadata: `
        + `${missingFields.join(', ') || 'regionPair/segmentIndex'}`
      );
    }
    if (!from?.nodeKey || !to?.nodeKey
        || from.nodeKey !== connection.fromNodeKey
        || to.nodeKey !== connection.toNodeKey) {
      throw new Error(
        `Inter-region edge ${connection.routeId} has endpoint identity drift: `
        + `${connection.fromNodeKey} -> ${connection.toNodeKey}`
      );
    }
    if (connection.routeKind !== 'palace'
        && (typeof connection.routePairKey !== 'string'
          || connection.routePairKey.length === 0)) {
      throw new Error(
        `Inter-region edge ${connection.routeId} is missing its competing-pair key`
      );
    }
    return {
      fromNodeKey: connection.fromNodeKey,
      toNodeKey: connection.toNodeKey,
      regionPair: [...connection.regionPair],
      routeId: connection.routeId,
      routePairKey: connection.routePairKey ?? null,
      routeKind: connection.routeKind,
      segmentIndex: connection.segmentIndex,
      segmentKind: connection.segmentKind,
      pathType: pathTypeForConnection(connection, from, to),
      difficultyPolicy: connection.difficultyPolicy
    };
  });
}

function adjacencyForKeys(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.nodeKey, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeKey)?.add(edge.toNodeKey);
    adjacency.get(edge.toNodeKey)?.add(edge.fromNodeKey);
  }
  return adjacency;
}

export function ensureCastleOpenings(nodes, edges) {
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  let adjacency = adjacencyForKeys(nodes, edges);
  const approved = new Set(OPENING_PROGRESSION_CONFIG.APPROVED_SAFE_TYPES);
  const destinationTypes = new Set(
    OPENING_PROGRESSION_CONFIG.DESIGNATED_DESTINATION_TYPES
  );

  for (const castle of nodes.filter((node) => node.nodeType === 'castle')) {
    const invalidNeighborKeys = [...(adjacency.get(castle.nodeKey) ?? [])]
      .filter((neighborKey) => {
        const neighbor = nodeByKey.get(neighborKey);
        return neighbor && !isBlockingNode(neighbor)
          && !approved.has(neighbor.nodeType);
      })
      .sort(canonicalKeyCompare);
    for (const neighborKey of invalidNeighborKeys) {
      const neighbor = nodeByKey.get(neighborKey);
      const edge = edges.find((candidate) =>
        (candidate.fromNodeKey === castle.nodeKey
          && candidate.toNodeKey === neighborKey)
        || (candidate.toNodeKey === castle.nodeKey
          && candidate.fromNodeKey === neighborKey)
      );
      const replacement = nodes
        .filter((candidate) =>
          candidate.regionId === castle.regionId
          && candidate.nodeType !== 'castle'
          && candidate.nodeKey !== neighborKey
          && Math.hypot(candidate.x - neighbor.x, candidate.y - neighbor.y)
            <= INTER_REGION_CONFIG.MAX_NODE_SPACING
          && !(adjacency.get(neighborKey) ?? new Set()).has(candidate.nodeKey)
        )
        .sort((left, right) =>
          Math.hypot(left.x - neighbor.x, left.y - neighbor.y)
            - Math.hypot(right.x - neighbor.x, right.y - neighbor.y)
          || canonicalKeyCompare(left.nodeKey, right.nodeKey)
        )[0];
      if (!edge || !replacement) {
        throw new Error(
          `Castle ${castle.nodeKey} cannot rewire unapproved neighbor ${neighborKey}`
        );
      }
      if (edge.fromNodeKey === castle.nodeKey) {
        edge.fromNodeKey = replacement.nodeKey;
      } else {
        edge.toNodeKey = replacement.nodeKey;
      }
      adjacency = adjacencyForKeys(nodes, edges);
    }
    const candidates = nodes
      .filter((node) =>
        node.regionId === castle.regionId && destinationTypes.has(node.nodeType)
      )
      .map((candidate) => {
        const component = new Set([candidate.nodeKey]);
        const queue = [candidate.nodeKey];
        let head = 0;
        while (head < queue.length) {
          const currentKey = queue[head++];
          for (const neighborKey of adjacency.get(currentKey) ?? []) {
            const neighbor = nodeByKey.get(neighborKey);
            if (!neighbor || isBlockingNode(neighbor)
                || component.has(neighborKey)) continue;
            component.add(neighborKey);
            queue.push(neighborKey);
          }
        }
        const valid = component.size < OPENING_PROGRESSION_CONFIG.MAX_SAFE_COMPONENT_SIZE
          && [...component].every((key) => approved.has(nodeByKey.get(key)?.nodeType))
          && Math.hypot(candidate.x - castle.x, candidate.y - castle.y)
            <= INTER_REGION_CONFIG.MAX_NODE_SPACING;
        return {
          candidate,
          component,
          valid,
          distance: Math.hypot(candidate.x - castle.x, candidate.y - castle.y)
        };
      })
      .filter(({ valid }) => valid)
      .sort((left, right) =>
        left.distance - right.distance
        || canonicalKeyCompare(left.candidate.nodeKey, right.candidate.nodeKey)
      );

    const selection = candidates[0];
    if (!selection) {
      const error = new Error(
        `Region ${castle.regionId} has no valid existing settlement or guild `
        + `for castle ${castle.nodeKey}'s designated opening`
      );
      error.code = 'CASTLE_OPENING_DESTINATION_UNAVAILABLE';
      error.regionId = castle.regionId;
      error.castleNodeKey = castle.nodeKey;
      throw error;
    }
    selection.candidate.openingRole = 'designated_safe_destination';
    castle.openingDestinationNodeKey = selection.candidate.nodeKey;
    const existingOpeningEdge = edges.find((edge) =>
      (edge.fromNodeKey === castle.nodeKey
        && edge.toNodeKey === selection.candidate.nodeKey)
      || (edge.toNodeKey === castle.nodeKey
        && edge.fromNodeKey === selection.candidate.nodeKey)
    );
    if (existingOpeningEdge) {
      existingOpeningEdge.openingRole = 'designated_safe_edge';
      existingOpeningEdge.pathType = 'road';
    } else {
      edges.push({
        fromNodeKey: castle.nodeKey,
        toNodeKey: selection.candidate.nodeKey,
        regionId: castle.regionId,
        routeId: null,
        routePairKey: null,
        routeKind: null,
        regionPair: [],
        segmentIndex: null,
        segmentKind: null,
        pathType: 'road',
        difficultyPolicy: null,
        openingRole: 'designated_safe_edge'
      });
      adjacency.get(castle.nodeKey).add(selection.candidate.nodeKey);
      adjacency.get(selection.candidate.nodeKey).add(castle.nodeKey);
    }

    const safeComponent = new Set([castle.nodeKey]);
    const safeQueue = [castle.nodeKey];
    let safeHead = 0;
    while (safeHead < safeQueue.length) {
      const currentKey = safeQueue[safeHead++];
      for (const neighborKey of adjacency.get(currentKey) ?? []) {
        const neighbor = nodeByKey.get(neighborKey);
        if (!neighbor || isBlockingNode(neighbor)
            || safeComponent.has(neighborKey)) continue;
        safeComponent.add(neighborKey);
        safeQueue.push(neighborKey);
      }
    }
    if (safeComponent.size > OPENING_PROGRESSION_CONFIG.MAX_SAFE_COMPONENT_SIZE
        || [...safeComponent].some((key) => !approved.has(nodeByKey.get(key)?.nodeType))) {
      throw new Error(`Castle opening in region ${castle.regionId} has an invalid safe component`);
    }
    let boundaryCount = 0;
    for (const safeKey of safeComponent) {
      for (const neighborKey of adjacency.get(safeKey) ?? []) {
        if (safeComponent.has(neighborKey)) continue;
        const neighbor = nodeByKey.get(neighborKey);
        if (!neighbor || !isBlockingNode(neighbor)) {
          throw new Error(
            `Castle opening in region ${castle.regionId} exits through noncombat node ${neighborKey}`
          );
        }
        neighbor.difficultyTier = OPENING_PROGRESSION_CONFIG.REQUIRED_BOUNDARY_TIER;
        if (neighbor.routeDifficultyTier != null) {
          neighbor.routeDifficultyTier =
            OPENING_PROGRESSION_CONFIG.REQUIRED_BOUNDARY_TIER;
          for (const routeEdge of edges.filter((edge) =>
            edge.routeId === neighbor.routeId
            && (edge.fromNodeKey === neighborKey || edge.toNodeKey === neighborKey)
          )) {
            routeEdge.routeDifficultyTier =
              OPENING_PROGRESSION_CONFIG.REQUIRED_BOUNDARY_TIER;
          }
        }
        neighbor.openingRole = 'tier_1_boundary';
        const boundaryEdge = edges.find((edge) =>
          (edge.fromNodeKey === safeKey && edge.toNodeKey === neighborKey)
          || (edge.toNodeKey === safeKey && edge.fromNodeKey === neighborKey)
        );
        if (boundaryEdge) boundaryEdge.openingRole = 'tier_1_boundary_edge';
        boundaryCount++;
      }
    }
    if (boundaryCount === 0) {
      throw new Error(`Castle opening in region ${castle.regionId} has no Tier-1 combat boundary`);
    }
  }
}

function applyRouteDifficultyPolicies(nodes, edges) {
  const pairs = new Map();
  for (const node of nodes) {
    if (!node.routeKind || !Array.isArray(node.regionPair)
        || node.regionPair.length !== 2) continue;
    node.routePairKey = `route-pair:${node.regionPair.join('-')}`;
    const pair = pairs.get(node.routePairKey) ?? { trade: [], wilderness: [] };
    if (node.routeKind === 'trade') pair.trade.push(node);
    if (node.routeKind === 'wilderness') pair.wilderness.push(node);
    pairs.set(node.routePairKey, pair);
  }
  for (const pair of pairs.values()) {
    const wildernessTiers = pair.wilderness
      .filter((node) => COMBAT_NODE_TYPES.has(node.nodeType))
      .map((node) => node.difficultyTier ?? calculateDifficultyTier(node));
    if (pair.trade.length === 0 || wildernessTiers.length === 0) continue;
    const wildernessFloor = Math.min(...wildernessTiers);
    if (wildernessFloor <= 1) {
      const error = new Error(
        'A lower-risk trade route cannot be assigned below a Tier-1 wilderness route'
      );
      error.code = 'ROUTE_TIER_POLICY_UNSATISFIABLE';
      throw error;
    }
    const tradeTier = wildernessFloor - 1;
    for (const node of pair.trade) {
      node.difficultyPolicy = 'lower_risk_trade';
      node.routeDifficultyTier = tradeTier;
      if (COMBAT_NODE_TYPES.has(node.nodeType)) node.difficultyTier = tradeTier;
    }
    for (const node of pair.wilderness) {
      node.difficultyPolicy = 'higher_risk_wilderness';
      node.routeDifficultyTier = wildernessFloor;
    }
  }

  for (const edge of edges) {
    if (!edge.routePairKey || !['trade', 'wilderness'].includes(edge.routeKind)) continue;
    const pair = pairs.get(edge.routePairKey);
    if (!pair) continue;
    const wildernessTiers = pair.wilderness
      .filter((node) => COMBAT_NODE_TYPES.has(node.nodeType))
      .map((node) => node.difficultyTier ?? calculateDifficultyTier(node));
    if (wildernessTiers.length === 0) continue;
    const wildernessFloor = Math.min(...wildernessTiers);
    edge.difficultyPolicy = edge.routeKind === 'trade'
      ? 'lower_risk_trade'
      : 'higher_risk_wilderness';
    edge.routeDifficultyTier = edge.routeKind === 'trade'
      ? wildernessFloor - 1
      : wildernessFloor;
  }
}

function analyzeOpeningSafeComponents(nodes, edges) {
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const adjacency = adjacencyForKeys(nodes, edges);
  const approved = new Set(OPENING_PROGRESSION_CONFIG.APPROVED_SAFE_TYPES);

  return nodes
    .filter((node) => node.nodeType === 'castle')
    .sort((left, right) => canonicalKeyCompare(left.nodeKey, right.nodeKey))
    .map((castle) => {
      const nodeKeys = new Set([castle.nodeKey]);
      const queue = [castle.nodeKey];
      let head = 0;
      while (head < queue.length) {
        const currentKey = queue[head++];
        const neighborKeys = [...(adjacency.get(currentKey) ?? [])]
          .sort(canonicalKeyCompare);
        for (const neighborKey of neighborKeys) {
          const neighbor = nodeByKey.get(neighborKey);
          if (!neighbor || isBlockingNode(neighbor) || nodeKeys.has(neighborKey)) continue;
          nodeKeys.add(neighborKey);
          queue.push(neighborKey);
        }
      }

      const boundaryNodeKeys = new Set();
      for (const nodeKey of nodeKeys) {
        for (const neighborKey of adjacency.get(nodeKey) ?? []) {
          if (!nodeKeys.has(neighborKey)) boundaryNodeKeys.add(neighborKey);
        }
      }
      const orderedNodeKeys = [...nodeKeys].sort(canonicalKeyCompare);
      const orderedBoundaryNodeKeys = [...boundaryNodeKeys].sort(canonicalKeyCompare);
      const valid = orderedNodeKeys.length <= OPENING_PROGRESSION_CONFIG.MAX_SAFE_COMPONENT_SIZE
        && orderedNodeKeys.every((nodeKey) => approved.has(nodeByKey.get(nodeKey)?.nodeType))
        && orderedBoundaryNodeKeys.length > 0
        && orderedBoundaryNodeKeys.every((nodeKey) => {
          const node = nodeByKey.get(nodeKey);
          return isBlockingNode(node)
            && node.difficultyTier === OPENING_PROGRESSION_CONFIG.REQUIRED_BOUNDARY_TIER;
        });
      return {
        sourceNodeKey: castle.nodeKey,
        nodeKeys: orderedNodeKeys,
        boundaryNodeKeys: orderedBoundaryNodeKeys,
        valid
      };
    });
}

function openingComponentSignature(components) {
  return canonicalStringify(components.map((component) => ({
    sourceNodeKey: component.sourceNodeKey,
    nodeKeys: component.nodeKeys,
    boundaryNodeKeys: component.boundaryNodeKeys,
    valid: component.valid
  })));
}

function progressionAnchorKeys(nodes, edges) {
  const anchors = new Set(nodes
    .filter((node) =>
      node.nodeType === 'palace'
      || (
        node.nodeType === 'shrine'
        && typeof node.shrineBuffType === 'string'
        && node.shrineBuffType.startsWith('zodiac_')
      )
      || node.isRequiredMilestone === true
    )
    .map((node) => node.nodeKey));
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  for (const edge of edges) {
    if (!edge.routeId) continue;
    for (const nodeKey of [edge.fromNodeKey, edge.toNodeKey]) {
      if (nodeByKey.get(nodeKey)?.regionId != null) anchors.add(nodeKey);
    }
  }
  return [...anchors].sort(canonicalKeyCompare);
}

function minimumGateDistances(nodes, edges, sourceKeys) {
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const adjacency = adjacencyForKeys(nodes, edges);
  const result = new Map();
  for (const sourceKey of sourceKeys) {
    const distances = new Map(nodes.map((node) => [node.nodeKey, Infinity]));
    distances.set(sourceKey, 0);
    const deque = new Map([[0, { nodeKey: sourceKey, distance: 0 }]]);
    let left = 0;
    let right = 0;
    while (left <= right) {
      const current = deque.get(left);
      deque.delete(left);
      left++;
      if (!current || current.distance !== distances.get(current.nodeKey)) continue;
      const currentKey = current.nodeKey;
      const currentDistance = distances.get(currentKey);
      const neighborKeys = [...(adjacency.get(currentKey) ?? [])]
        .sort(canonicalKeyCompare);
      for (const neighborKey of neighborKeys) {
        const neighbor = nodeByKey.get(neighborKey);
        const cost = isBlockingNode(neighbor) ? 1 : 0;
        const nextDistance = currentDistance + cost;
        if (nextDistance >= distances.get(neighborKey)) continue;
        distances.set(neighborKey, nextDistance);
        const entry = { nodeKey: neighborKey, distance: nextDistance };
        if (cost === 0) {
          left--;
          deque.set(left, entry);
        } else {
          right++;
          deque.set(right, entry);
        }
      }
    }
    result.set(sourceKey, distances);
  }
  return result;
}

function assignRewardSites(nodes, edges, rng) {
  const adjacency = adjacencyForKeys(nodes, edges);
  const openingComponents = analyzeOpeningSafeComponents(nodes, edges);
  if (openingComponents.some((component) => !component.valid)) {
    throw new Error('Reward-site selection received an invalid castle-opening component');
  }
  const acceptedOpeningSignature = openingComponentSignature(openingComponents);
  const sources = openingComponents.map((component) => component.sourceNodeKey);
  const sourceComponents = new Map(openingComponents.map((component) => [
    component.sourceNodeKey,
    component.nodeKeys
  ]));
  const anchors = progressionAnchorKeys(nodes, edges);
  const anchorSet = new Set(anchors);
  let acceptedDistances = minimumGateDistances(nodes, edges, sources);
  const gateDeltas = [];
  const candidates = nodes.filter((node) =>
    COMBAT_NODE_TYPES.has(node.nodeType)
    && !node.routeKind
    && !node.openingRole
    && !anchorSet.has(node.nodeKey)
    && (node.ringDistance >= PHASE6_CONFIG.MIN_RING_FOR_TERMINATOR || node.isWilderness)
    && [1, 2].includes(adjacency.get(node.nodeKey)?.size)
  );
  const degreeOne = rng.shuffle(
    candidates
      .filter((node) => adjacency.get(node.nodeKey).size === 1)
      .sort((a, b) => canonicalKeyCompare(a.nodeKey, b.nodeKey))
  );
  const degreeTwo = rng.shuffle(
    candidates
      .filter((node) => adjacency.get(node.nodeKey).size === 2)
      .sort((a, b) => canonicalKeyCompare(a.nodeKey, b.nodeKey))
  );
  const target = Math.floor(nodes.length * PHASE6_CONFIG.TARGET_TERMINATOR_RATIO);
  const deadEndTarget = Math.round(target * PHASE6_CONFIG.TERMINATOR_DEAD_END_RATIO);
  const ordered = [
    ...degreeTwo
      .map((node) => ({ node, deadEnd: false, removeEdge: false })),
    ...degreeOne
      .map((node) => ({ node, deadEnd: true, removeEdge: false })),
    ...degreeTwo
      .map((node) => ({ node, deadEnd: true, removeEdge: true }))
  ];

  let assigned = 0;
  let degreeTwoAssigned = 0;
  let degreeOneAssigned = 0;
  for (const entry of ordered) {
    if (assigned >= target) break;
    if (entry.deadEnd && degreeOneAssigned >= deadEndTarget) continue;
    if (!entry.deadEnd && degreeTwoAssigned >= target - deadEndTarget) continue;
    if (entry.node.isTerminator) continue;
    const previousType = entry.node.nodeType;
    entry.node.nodeType = rng.pick(REWARD_NODE_TYPES);
    const incidentEdges = entry.removeEdge
      ? edges
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => {
          if (edge.fromNodeKey !== entry.node.nodeKey
              && edge.toNodeKey !== entry.node.nodeKey) return false;
          const otherNodeKey = edge.fromNodeKey === entry.node.nodeKey
            ? edge.toNodeKey
            : edge.fromNodeKey;
          return !nodes.find((node) => node.nodeKey === otherNodeKey)?.isTerminator;
        })
        .sort((left, right) =>
          canonicalKeyCompare(
            `${left.edge.fromNodeKey}:${left.edge.toNodeKey}`,
            `${right.edge.fromNodeKey}:${right.edge.toNodeKey}`
          )
        )
      : [{ edge: null, index: -1 }];
    let acceptedTrial = null;
    let acceptedGateVector = null;
    let removedEdge = null;
    for (const incident of incidentEdges) {
      if (incident.edge) {
        [removedEdge] = edges.splice(incident.index, 1);
      }
      const trial = minimumGateDistances(nodes, edges, sources);
      const trialOpeningComponents = analyzeOpeningSafeComponents(nodes, edges);
      const openingSafe = trialOpeningComponents.every((component) => component.valid)
        && openingComponentSignature(trialOpeningComponents) === acceptedOpeningSignature;
      const gateVector = sources.flatMap((sourceNodeKey) =>
        anchors.map((anchorNodeKey) => {
          const before = acceptedDistances.get(sourceNodeKey).get(anchorNodeKey);
          const after = trial.get(sourceNodeKey).get(anchorNodeKey);
          return {
            sourceNodeKey,
            sourceComponentNodeKeys: sourceComponents.get(sourceNodeKey),
            anchorNodeKey,
            before,
            after,
            delta: after - before
          };
        })
      );
      const connected = sources.every((sourceNodeKey) =>
        nodes.every((node) => Number.isFinite(trial.get(sourceNodeKey).get(node.nodeKey)))
      );
      const safe = connected
        && openingSafe
        && gateVector.every(({ before, after }) =>
          Number.isFinite(before) && Number.isFinite(after) && after >= before
        );
      if (safe) {
        acceptedTrial = trial;
        acceptedGateVector = gateVector;
        break;
      }
      if (removedEdge) {
        edges.splice(incident.index, 0, removedEdge);
        removedEdge = null;
      }
    }
    if (!acceptedTrial) {
      entry.node.nodeType = previousType;
      continue;
    }
    entry.node.isTerminator = true;
    entry.node.rewardSiteOriginalType = previousType;
    const deltas = acceptedGateVector.map(({ delta }) => delta);
    gateDeltas.push({
      nodeKey: entry.node.nodeKey,
      minimumDelta: Math.min(...deltas),
      maximumDelta: Math.max(...deltas),
      gateVector: acceptedGateVector,
      removedEdge: removedEdge
        ? {
          fromNodeKey: removedEdge.fromNodeKey,
          toNodeKey: removedEdge.toNodeKey
        }
        : null
    });
    acceptedDistances = acceptedTrial;
    if (entry.node.nodeType === 'shrine') {
      entry.node.shrineBuffType = rng.pick(PHASE6_CONFIG.SHRINE_BUFF_TYPES);
    } else if (entry.node.nodeType === 'discovery') {
      entry.node.loreKey = `lore_${Math.abs(Math.round(entry.node.x))}_${Math.abs(Math.round(entry.node.y))}`;
    }
    assigned++;
    if (entry.deadEnd) degreeOneAssigned++;
    else degreeTwoAssigned++;
  }
  const assignedNodeKeys = new Set(
    nodes.filter((node) => node.isTerminator).map((node) => node.nodeKey)
  );
  const finalAdjacency = adjacencyForKeys(nodes, edges);
  const deadEndsAssigned = [...assignedNodeKeys]
    .filter((nodeKey) => finalAdjacency.get(nodeKey)?.size === 1)
    .length;
  return { target, assigned, deadEndsAssigned, gateDeltas };
}

export function canonicalizeEdges(edges, nodeIndexByKey) {
  const seen = new Set();
  const canonical = [];

  for (const edge of edges) {
    if (edge.fromNodeKey === edge.toNodeKey) {
      throw new Error(`Self edge is not allowed: ${edge.fromNodeKey}`);
    }
    if (!nodeIndexByKey.has(edge.fromNodeKey) || !nodeIndexByKey.has(edge.toNodeKey)) {
      throw new Error(`Edge references an unknown node: ${edge.fromNodeKey} -> ${edge.toNodeKey}`);
    }
    const [fromNodeKey, toNodeKey] = [edge.fromNodeKey, edge.toNodeKey]
      .sort(canonicalKeyCompare);
    const identity = `${fromNodeKey}\u0000${toNodeKey}`;
    if (seen.has(identity)) {
      throw new Error(`Duplicate undirected edge is not allowed: ${fromNodeKey} -> ${toNodeKey}`);
    }
    seen.add(identity);
    canonical.push({ ...edge, fromNodeKey, toNodeKey });
  }

  canonical.sort((left, right) => {
    const leftKey = `${left.fromNodeKey}\u0000${left.toNodeKey}`;
    const rightKey = `${right.fromNodeKey}\u0000${right.toNodeKey}`;
    return canonicalKeyCompare(leftKey, rightKey);
  });

  return canonical.map((edge, ordinal) => ({
    ...edge,
    edgeKey: `edge:${String(ordinal).padStart(5, '0')}`,
    from: nodeIndexByKey.get(edge.fromNodeKey),
    to: nodeIndexByKey.get(edge.toNodeKey)
  }));
}

function assignRouteSegmentOrders(connections, nodes) {
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const routeGroups = new Map();
  for (const connection of connections) {
    if (!connection.routeId || connection.routeKind === 'regional') continue;
    const group = routeGroups.get(connection.routeId) ?? [];
    group.push(connection);
    routeGroups.set(connection.routeId, group);
  }

  const segmentOrderByEdgeKey = new Map();
  for (const [, routeConnections] of [...routeGroups.entries()]
    .sort(([left], [right]) => canonicalKeyCompare(left, right))) {
    const incident = new Map();
    for (const connection of routeConnections) {
      for (const nodeKey of [connection.fromNodeKey, connection.toNodeKey]) {
        const entries = incident.get(nodeKey) ?? [];
        entries.push(connection);
        incident.set(nodeKey, entries);
      }
    }
    for (const entries of incident.values()) {
      entries.sort((left, right) => canonicalKeyCompare(left.edgeKey, right.edgeKey));
    }

    const regionPair = routeConnections[0].regionPair ?? [];
    const startRank = (nodeKey) => {
      const node = nodeByKey.get(nodeKey);
      const regionIndex = regionPair.indexOf(node?.regionId);
      return [
        (incident.get(nodeKey)?.length ?? 0) === 1 ? 0 : 1,
        regionIndex < 0 ? Number.MAX_SAFE_INTEGER : regionIndex,
        node?.routeOrder ?? Number.MAX_SAFE_INTEGER,
        nodeKey
      ];
    };
    const compareStart = (left, right) => {
      const leftRank = startRank(left);
      const rightRank = startRank(right);
      for (let index = 0; index < leftRank.length - 1; index++) {
        if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index];
      }
      return canonicalKeyCompare(leftRank.at(-1), rightRank.at(-1));
    };

    const pendingStarts = [...incident.keys()].sort(compareStart);
    const visitedEdges = new Set();
    let segmentOrder = 0;
    for (const start of pendingStarts) {
      const stack = [start];
      while (stack.length > 0) {
        const current = stack.pop();
        const unvisited = (incident.get(current) ?? [])
          .filter((connection) => !visitedEdges.has(connection.edgeKey));
        for (const connection of unvisited.toReversed()) {
          visitedEdges.add(connection.edgeKey);
          segmentOrderByEdgeKey.set(connection.edgeKey, segmentOrder++);
          stack.push(
            connection.fromNodeKey === current
              ? connection.toNodeKey
              : connection.fromNodeKey
          );
        }
      }
    }
  }

  return connections.map((connection) => {
    const segmentOrder = segmentOrderByEdgeKey.get(connection.edgeKey);
    return segmentOrder == null
      ? connection
      : { ...connection, segmentOrder, segmentIndex: segmentOrder };
  });
}

export function buildRouteManifest(connections, nodes, regions) {
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const grouped = new Map();
  for (const connection of connections) {
    if (!connection.routeId) continue;
    const routeConnections = grouped.get(connection.routeId) ?? [];
    routeConnections.push(connection);
    grouped.set(connection.routeId, routeConnections);
  }

  const manifest = [];
  for (const [routeId, routeConnections] of [...grouped.entries()]
    .sort(([left], [right]) => canonicalKeyCompare(left, right))) {
    const first = routeConnections[0];
    const invariantFields = [
      'routePairKey',
      'routeKind',
      'difficultyPolicy'
    ];
    for (const connection of routeConnections) {
      if (invariantFields.some((field) => connection[field] !== first[field])
          || canonicalStringify(connection.regionPair ?? [])
            !== canonicalStringify(first.regionPair ?? [])) {
        throw new Error(`Route ${routeId} has inconsistent route-level metadata`);
      }
    }

    const incidentCount = new Map();
    for (const connection of routeConnections) {
      for (const nodeKey of [connection.fromNodeKey, connection.toNodeKey]) {
        incidentCount.set(nodeKey, (incidentCount.get(nodeKey) ?? 0) + 1);
      }
    }
    const endpointNodeKeys = [...incidentCount.keys()]
      .filter((nodeKey) => {
        const node = nodeByKey.get(nodeKey);
        return node?.routeId !== routeId
          || node?.nodeType === 'palace'
          || incidentCount.get(nodeKey) === 1;
      })
      .sort(canonicalKeyCompare);
    const endpointIdentities = endpointNodeKeys.map((nodeKey) => {
      const node = nodeByKey.get(nodeKey);
      if (!node) throw new Error(`Route ${routeId} references missing endpoint ${nodeKey}`);
      return {
        nodeKey,
        nodeType: node.nodeType,
        regionId: node.regionId ?? null,
        regionName: node.regionName ?? null
      };
    });
    const declaredRegions = (first.regionPair ?? []).map((regionId) => {
      const region = regionById.get(regionId);
      if (!region) {
        throw new Error(`Route ${routeId} declares unknown region ${regionId}`);
      }
      return {
        regionId,
        regionName: region.name,
        castleKey: region.castleKey
      };
    });
    const blockingTiers = nodes
      .filter((node) => node.routeId === routeId && isBlockingNode(node))
      .map((node) => node.difficultyTier)
      .sort((left, right) => left - right);
    const segments = [...routeConnections]
      .sort((left, right) =>
        left.segmentIndex - right.segmentIndex
        || canonicalKeyCompare(left.edgeKey, right.edgeKey)
      )
      .map((connection) => ({
        edgeKey: connection.edgeKey,
        segmentIndex: connection.segmentIndex,
        segmentKind: connection.segmentKind,
        fromNodeKey: connection.fromNodeKey,
        toNodeKey: connection.toNodeKey,
        pathType: connection.pathType,
        difficultyPolicy: connection.difficultyPolicy,
        routeDifficultyTier: connection.routeDifficultyTier ?? null
      }));

    manifest.push({
      routeId,
      routePairKey: first.routePairKey ?? null,
      routeKind: first.routeKind,
      regionPair: [...(first.regionPair ?? [])],
      declaredRegions,
      endpointIdentities,
      difficultyPolicy: first.difficultyPolicy,
      tierPolicy: {
        supportedTierDomain: [1, 5],
        blockingTiers,
        blockingTierFloor: blockingTiers.length > 0 ? Math.min(...blockingTiers) : null,
        blockingTierCeiling: blockingTiers.length > 0 ? Math.max(...blockingTiers) : null,
        comparison: null
      },
      segments
    });
  }

  const routesByPair = new Map();
  for (const route of manifest) {
    if (!route.routePairKey || !['trade', 'wilderness'].includes(route.routeKind)) continue;
    const pair = routesByPair.get(route.routePairKey) ?? {};
    pair[route.routeKind] = route;
    routesByPair.set(route.routePairKey, pair);
  }
  for (const [routePairKey, pair] of routesByPair) {
    if (!pair.trade || !pair.wilderness) continue;
    const tradeCeiling = pair.trade.tierPolicy.blockingTierCeiling;
    const wildernessFloor = pair.wilderness.tierPolicy.blockingTierFloor;
    const comparison = {
      routePairKey,
      lowerRiskRouteId: pair.trade.routeId,
      higherRiskRouteId: pair.wilderness.routeId,
      requiredTierGap: 1,
      observedTierGap: Number.isInteger(tradeCeiling)
        && Number.isInteger(wildernessFloor)
        ? wildernessFloor - tradeCeiling
        : null
    };
    pair.trade.tierPolicy.comparison = comparison;
    pair.wilderness.tierPolicy.comparison = comparison;
  }

  return manifest;
}

function findAvailableNear(x, y, occupied) {
  const originX = Math.round(x);
  const originY = Math.round(y);
  for (let radius = 0; radius <= 12; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidateX = originX + dx;
        const candidateY = originY + dy;
        const key = `${candidateX},${candidateY}`;
        if (!occupied.has(key)) {
          occupied.add(key);
          return { x: candidateX, y: candidateY };
        }
      }
    }
  }
  throw new Error(`Unable to place final spacing infill near ${originX},${originY}`);
}

function enforceFinalSpacing(nodes, edges) {
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const occupied = new Set(nodes.map((node) => `${node.x},${node.y}`));
  const expandedEdges = [];
  const addedNodes = [];

  for (const edge of edges) {
    const from = nodeByKey.get(edge.fromNodeKey);
    const to = nodeByKey.get(edge.toNodeKey);
    const routed = edge.routeId != null;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const segmentCount = Math.ceil(distance / INTER_REGION_CONFIG.MAX_NODE_SPACING);
    const isDesignatedOpening = edge.openingRole === 'designated_safe_edge';
    if (isDesignatedOpening && segmentCount > 1) {
      const castle = from.nodeType === 'castle' ? from : to;
      const error = new Error(
        `Castle ${castle.nodeKey}'s existing designated destination exceeds final spacing`
      );
      error.code = 'CASTLE_OPENING_DESTINATION_UNAVAILABLE';
      error.regionId = castle.regionId;
      error.castleNodeKey = castle.nodeKey;
      throw error;
    }
    if (segmentCount <= 1) {
      expandedEdges.push(edge);
      continue;
    }

    let previousKey = from.nodeKey;
    for (let segment = 1; segment < segmentCount; segment++) {
      const fraction = segment / segmentCount;
      const coordinate = findAvailableNear(
        from.x + (to.x - from.x) * fraction,
        from.y + (to.y - from.y) * fraction,
        occupied
      );
      const nodeKey = `spacing:${edge.fromNodeKey}:${edge.toNodeKey}:${segment}`;
      const difficultyTier = edge.openingRole === 'tier_1_boundary_edge'
        ? OPENING_PROGRESSION_CONFIG.REQUIRED_BOUNDARY_TIER
        : edge.routeDifficultyTier != null
          ? edge.routeDifficultyTier
          : Math.max(from.difficultyTier, to.difficultyTier);
      const node = {
        nodeKey,
        nodeType: edge.pathType === 'bridge' ? 'bridge' : 'forest',
        x: coordinate.x,
        y: coordinate.y,
        xCoord: coordinate.x,
        yCoord: coordinate.y,
        regionId: null,
        regionName: null,
        name: edge.pathType === 'bridge' ? 'Bridge Approach' : 'Trail Marker',
        features: [],
        guildType: null,
        guildClass: null,
        difficultyTier,
        ringDistance: routed
          ? FINALIZED_WORLD_DOMAINS.INTER_REGION_RING_DISTANCE
          : Math.max(from.ringDistance ?? 0, to.ringDistance ?? 0),
        regionRace: null,
        localSeed: null,
        ruinsTier: null,
        blockedByDefault: true,
        isTerminator: false,
        shrineBuffType: null,
        loreKey: null,
        isBridge: edge.pathType === 'bridge',
        isWilderness: edge.routeKind === 'wilderness',
        isTradeRoute: edge.routeKind === 'trade',
        isPalace: false,
        isIntermediateNode: true,
        routeId: routed ? edge.routeId : null,
        routePairKey: routed ? edge.routePairKey ?? null : null,
        routeKind: routed ? edge.routeKind ?? null : null,
        routeOrder: routed ? segment : null,
        segmentIndex: routed ? edge.segmentIndex ?? segment : null,
        segmentKind: routed
          ? `${edge.segmentKind ?? 'route'}_final_infill`
          : null,
        difficultyPolicy: routed ? edge.difficultyPolicy ?? null : null,
        routeDifficultyTier: routed ? edge.routeDifficultyTier ?? null : null,
        regionPair: routed ? edge.regionPair ?? [] : [],
        openingRole: edge.openingRole === 'tier_1_boundary_edge'
          ? 'tier_1_boundary'
          : null
      };
      addedNodes.push(node);
      nodeByKey.set(nodeKey, node);
      expandedEdges.push({
        ...edge,
        fromNodeKey: previousKey,
        toNodeKey: nodeKey,
        segmentKind: routed ? `${edge.segmentKind}_final_infill` : null
      });
      previousKey = nodeKey;
    }
    expandedEdges.push({
      ...edge,
      fromNodeKey: previousKey,
      toNodeKey: to.nodeKey
    });
  }

  return {
    nodes: [...nodes, ...addedNodes].sort((left, right) =>
      canonicalKeyCompare(left.nodeKey, right.nodeKey)
    ),
    edges: expandedEdges
  };
}

function pointIsOnPolygonBoundary(x, y, polygon, epsilon = 1e-9) {
  for (let index = 0; index < polygon.length; index++) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    if (Math.abs(cross) > epsilon) continue;
    if (x >= Math.min(x1, x2) - epsilon && x <= Math.max(x1, x2) + epsilon
        && y >= Math.min(y1, y2) - epsilon && y <= Math.max(y1, y2) + epsilon) {
      return true;
    }
  }
  return false;
}

function pointIsInOrOnPolygon(x, y, polygon) {
  return isPointInPolygon(x, y, polygon) || pointIsOnPolygonBoundary(x, y, polygon);
}

function reserveIntegerCoordinate(node, usedCoordinates, polygon = null) {
  const originX = Math.round(node.x);
  const originY = Math.round(node.y);
  for (let radius = 0; radius <= 100; radius++) {
    const candidates = [];
    if (radius === 0) {
      candidates.push([originX, originY]);
    } else {
      for (let offset = -radius; offset <= radius; offset++) {
        candidates.push(
          [originX + offset, originY - radius],
          [originX + radius, originY + offset],
          [originX - offset, originY + radius],
          [originX - radius, originY - offset]
        );
      }
    }
    for (const [x, y] of candidates) {
      const key = `${x},${y}`;
      if (!usedCoordinates.has(key)
          && (!polygon || pointIsInOrOnPolygon(x, y, polygon))) {
        usedCoordinates.add(key);
        return { x, y };
      }
    }
  }
  throw new Error(`Unable to reserve a coordinate for ${node.nodeKey}`);
}

function deriveLocalSeeds(nodes, config) {
  const used = new Set();
  const byKey = new Map();

  for (const node of [...nodes].sort((left, right) => canonicalKeyCompare(left.nodeKey, right.nodeKey))) {
    let counter = 0;
    let localSeed;
    do {
      const identity = [
        config.worldSeed,
        config.generatorVersion,
        config.randomStreamVersion,
        node.nodeKey,
        counter
      ].join('|');
      localSeed = createHash('sha256').update(identity).digest().readInt32BE(0);
      counter += 1;
    } while (used.has(localSeed));

    used.add(localSeed);
    byKey.set(node.nodeKey, localSeed);
  }

  return nodes.map((node) => ({ ...node, localSeed: byKey.get(node.nodeKey) }));
}

function resolveFinalizedGuildType(node, castlesByRegion) {
  if (node.nodeType !== 'guild') return null;
  if (node.guildType != null
      && node.guildClass != null
      && node.guildType !== node.guildClass) {
    throw new Error(
      `Guild ${node.nodeKey} has conflicting class metadata: `
      + `${node.guildType} vs ${node.guildClass}`
    );
  }
  const race = castlesByRegion.get(node.regionId)?.region.race;
  const guildType = node.guildType
    ?? node.guildClass
    ?? GUILD_CONFIG.RACE_PRIMARY_GUILD[race];
  if (!GUILD_CONFIG.TYPES.includes(guildType)) {
    throw new Error(
      `Guild ${node.nodeKey} has no supported finalized guild class`
    );
  }
  return guildType;
}

function generateNodeName(node, castlesByRegion, rng, guildType) {
  if (node.nodeType === 'castle') {
    return castlesByRegion.get(node.regionId)?.region.castleName ?? 'Castle';
  }
  if (node.nodeType === 'palace') return 'Grand Palace';
  if (node.nodeType === 'guild') {
    return `${guildType.charAt(0).toUpperCase()}${guildType.slice(1)}s' Guild`;
  }
  if (node.nodeType === 'keep') {
    const region = castlesByRegion.get(node.regionId)?.region;
    return region ? `${region.name} Keep` : 'Keep';
  }
  if (node.name) return node.name;
  const prefixes = NODE_NAME_PREFIXES[node.nodeType] ?? NODE_NAME_PREFIXES.city;
  const suffixes = NODE_NAME_SUFFIXES[node.nodeType] ?? NODE_NAME_SUFFIXES.city;
  return `${rng.pick(prefixes)} ${rng.pick(suffixes)}`;
}

function finalizeNodes(nodes, castles, cellsByRegion, namesFeaturesRng) {
  const usedCoordinates = new Set();
  const castlesByRegion = new Map(castles.map((castle) => [castle.regionId, castle]));
  const finalized = [];

  // Castles reserve their already-frozen generator coordinates first.
  const ordered = [
    ...nodes.filter((node) => node.nodeType === 'castle'),
    ...nodes.filter((node) => node.nodeType !== 'castle')
  ];
  for (const node of ordered) {
    const routed = node.routeId != null;
    const polygon = node.regionId == null
      ? null
      : cellsByRegion.get(node.regionId)?.polygon;
    if (node.regionId != null && !polygon) {
      throw new Error(`Missing Voronoi cell for regional node ${node.nodeKey}`);
    }
    const coordinates = reserveIntegerCoordinate(node, usedCoordinates, polygon);
    const guildType = resolveFinalizedGuildType(node, castlesByRegion);
    const difficultyTier = node.difficultyTier ?? calculateDifficultyTier(node);
    const region = castlesByRegion.get(node.regionId)?.region;
    finalized.push({
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      x: coordinates.x,
      y: coordinates.y,
      xCoord: coordinates.x,
      yCoord: coordinates.y,
      regionId: node.regionId ?? null,
      regionName: node.regionName ?? null,
      name: generateNodeName(
        node,
        castlesByRegion,
        namesFeaturesRng,
        guildType
      ),
      features: generateNodeFeatures(namesFeaturesRng, node.nodeType),
      guildType,
      guildClass: guildType,
      difficultyTier,
      ringDistance: node.ringDistance ?? null,
      regionRace: region?.race ?? null,
      localSeed: null,
      ruinsTier: node.nodeType === 'ruins'
        ? Math.max(1, Math.min(3, difficultyTier))
        : null,
      blockedByDefault: isBlockingNode(node),
      isTerminator: Boolean(node.isTerminator),
      shrineBuffType: node.shrineBuffType ?? null,
      loreKey: node.loreKey ?? null,
      isBridge: Boolean(node.isBridge),
      isWilderness: Boolean(node.isWilderness),
      isTradeRoute: Boolean(node.isTradeRoute),
      isPalace: Boolean(node.isPalace),
      isIntermediateNode: Boolean(node.isIntermediateNode),
      routeId: routed ? node.routeId : null,
      routePairKey: routed ? node.routePairKey ?? null : null,
      routeKind: routed ? node.routeKind ?? null : null,
      routeOrder: routed ? node.routeOrder ?? null : null,
      segmentIndex: routed ? node.segmentIndex ?? null : null,
      segmentKind: routed ? node.segmentKind ?? null : null,
      difficultyPolicy: routed ? node.difficultyPolicy ?? null : null,
      routeDifficultyTier: routed ? node.routeDifficultyTier ?? null : null,
      regionPair: routed ? node.regionPair ?? [] : [],
      openingRole: node.openingRole ?? null,
      openingDestinationNodeKey: node.openingDestinationNodeKey ?? null,
      rewardSiteOriginalType: node.rewardSiteOriginalType ?? null
    });
  }
  return finalized.sort((left, right) => canonicalKeyCompare(left.nodeKey, right.nodeKey));
}

function buildRegions(castles, voronoiData, nodeIndexByKey) {
  return [...castles]
    .sort((a, b) => a.regionId - b.regionId)
    .map((castle) => {
      const nodes = [...nodeIndexByKey.keys()];
      const findIndex = (type) => {
        const key = nodes.find((nodeKey) => {
          const parts = nodeKey.split(':');
          return parts[0] === 'region' && Number(parts[1]) === castle.regionId
            && nodeIndexByKey.nodeByKey?.get(nodeKey)?.nodeType === type;
        });
        return key ? nodeIndexByKey.get(key) : null;
      };
      const cell = voronoiData.cellsByRegion.get(castle.regionId);
      if (!cell || cell.castleKey !== castle.castleKey
          || cell.regionId !== castle.regionId) {
        throw new Error(
          `Voronoi identity mismatch for ${castle.castleKey} in region ${castle.regionId}`
        );
      }
      const castleNodeIndex = findIndex('castle');
      const castleNode = castleNodeIndex == null ? null : nodeIndexByKey.nodeByKey.get(
        [...nodeIndexByKey.entries()]
          .find(([, index]) => index === castleNodeIndex)?.[0]
      );
      if (!castleNode
          || castleNode.x !== cell.castle.x
          || castleNode.y !== cell.castle.y
          || castle.x !== cell.castle.x
          || castle.y !== cell.castle.y) {
        throw new Error(
          'Finalized castle coordinate differs from frozen Voronoi generator '
          + `${castle.castleKey}`
        );
      }
      return {
        id: castle.regionId,
        name: castle.region.name,
        race: castle.region.race,
        dominantTerrain: castle.region.dominantTerrain,
        secondaryTerrains: castle.region.secondaryTerrains,
        castleKey: castle.castleKey,
        generatorPoint: {
          x: cell.castle.x,
          y: cell.castle.y
        },
        boundaryPolygon: cell.polygon,
        castleNodeIndex,
        keepNodeIndex: findIndex('keep'),
        guildNodeIndex: findIndex('guild')
      };
    });
}

/**
 * Assemble a complete world without database or process side effects.
 *
 * @param {object|number|string} [input]
 * @returns {object} finalized, validated, canonical world model
 */
function assembleWorldAttempt(input, generationAttempt) {
  const config = createWorldgenConfig(input);
  const streams = createRandomStreamsForAttempt(config, generationAttempt);

  const obstacles = generateObstacles(streams.worldObstacles);
  const castles = generateCastlePlacements(streams.castlePlacement);
  const voronoiData = createVoronoiRegions(castles);
  const nodeData = generateAllRegionNodes(castles, voronoiData, streams.regionalNodes);

  const connectionData = generateAllRegionConnections(
    nodeData,
    streams.internalConnections
  );
  const regionalNodes = [...connectionData.nodesByRegion.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, nodes]) => nodes);

  const interRegionData = generateInterRegionConnections(
    voronoiData,
    connectionData.nodesByRegion,
    regionalNodes,
    castles,
    streams.interRegionRoutes
  );

  const assembledNodes = [...regionalNodes, ...interRegionData.interRegionNodes];
  const normalizedEdges = [
    ...normalizeInternalEdges(connectionData),
    ...normalizeInterRegionEdges(interRegionData.interRegionConnections)
  ];
  applyRouteDifficultyPolicies(assembledNodes, normalizedEdges);
  ensureCastleOpenings(assembledNodes, normalizedEdges);
  const rewardSiteStats = assignRewardSites(
    assembledNodes,
    normalizedEdges,
    streams.finalization
  );
  const initiallyFinalizedNodes = finalizeNodes(
    assembledNodes,
    castles,
    voronoiData.cellsByRegion,
    streams.namesFeatures
  );
  const spacingFinalized = enforceFinalSpacing(initiallyFinalizedNodes, normalizedEdges);
  const nodes = deriveLocalSeeds(spacingFinalized.nodes, config);
  const nodeIndexByKey = new Map(nodes.map((node, index) => [node.nodeKey, index]));
  nodeIndexByKey.nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const connections = assignRouteSegmentOrders(
    canonicalizeEdges(spacingFinalized.edges, nodeIndexByKey),
    nodes
  );

  const regions = buildRegions(castles, voronoiData, nodeIndexByKey);
  const routeManifest = buildRouteManifest(connections, nodes, regions);

  const structuralPayload = {
    config,
    castles,
    regions,
    nodes: nodes.map((node) => ({
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      x: node.x,
      y: node.y,
      regionId: node.regionId,
      difficultyTier: node.difficultyTier,
      ringDistance: node.ringDistance,
      guildType: node.guildType,
      shrineBuffType: node.shrineBuffType,
      routeId: node.routeId,
      routePairKey: node.routePairKey ?? null,
      routeKind: node.routeKind,
      routeOrder: node.routeOrder,
      openingRole: node.openingRole ?? null,
      openingDestinationNodeKey: node.openingDestinationNodeKey ?? null,
      isTerminator: node.isTerminator
    })),
    connections,
    routeManifest
  };
  const structuralHash = createHash('sha256')
    .update(canonicalStringify(structuralPayload))
    .digest('hex');
  const routeManifestHash = createHash('sha256')
    .update(canonicalStringify(routeManifest))
    .digest('hex');
  const outputHash = calculateWorldOutputHash({
    config,
    castles,
    regions,
    nodes,
    connections,
    routeManifest,
    obstacles
  });
  const world = {
    config,
    castles,
    regions,
    nodes,
    connections,
    routeManifest,
    rewardSiteStats,
    obstacles,
    metadata: {
      worldSeed: config.worldSeed,
      generatorVersion: config.generatorVersion,
      randomStreamVersion: config.randomStreamVersion,
      generationAttempt,
      structuralHash,
      outputHash,
      routeManifestHash
    }
  };
  const validation = validateFinalizedWorld(world);
  if (!validation.valid) {
    const error = new Error(
      `World generation failed validation: ${validation.errors
        .slice(0, 10)
        .map((issue) => issue.code)
        .join(', ')}`
    );
    error.validation = validation;
    throw error;
  }
  return Object.freeze({ ...world, validation });
}

export function assembleWorld(input = {}) {
  const config = createWorldgenConfig(input);
  let lastOpeningError;
  for (
    let generationAttempt = 0;
    generationAttempt < OPENING_PROGRESSION_CONFIG.MAX_GENERATION_ATTEMPTS;
    generationAttempt++
  ) {
    try {
      return assembleWorldAttempt(config, generationAttempt);
    } catch (error) {
      if (error.code !== 'CASTLE_OPENING_DESTINATION_UNAVAILABLE') throw error;
      lastOpeningError = error;
    }
  }
  throw lastOpeningError;
}
