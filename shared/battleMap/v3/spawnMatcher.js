import { deepFreeze } from '../canonicalJson.js';
import {
  calculateTraversalPathCost,
  createBattleMapV3TraversalView,
  getReachableTilesForTraversal
} from './traversalView.js';

export const SPAWN_CLASSIFIER_VERSION = 1;
export const SPAWN_SCORER_VERSION = 1;
export const SPAWN_MATCH_MAX_SEARCH_NODES = 25_000;

const PRIMARY_ROLES = Object.freeze([
  'boss', 'ambush', 'support', 'ranged', 'mobile', 'defender', 'frontline'
]);
const PRIORITY = new Map(PRIMARY_ROLES.map((role, index) => [role, index]));

function fail(message, code = 'INVALID_BATTLE_MAP_V3_SPAWN_ASSIGNMENT') {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function stableUnitId(unit) {
  const value = unit?.id ?? unit?.unitId ?? unit?.characterId ?? unit?.npcId;
  if (!['string', 'number'].includes(typeof value) || String(value).length === 0) {
    fail('every unit must have a stable id, unitId, characterId, or npcId');
  }
  return String(value);
}

function text(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function abilityRecords(unit) {
  const records = [];
  for (const key of ['abilities', 'skills', 'skillEffects']) {
    if (Array.isArray(unit?.[key])) records.push(...unit[key]);
  }
  return records;
}

function hasSupportAbility(unit) {
  return abilityRecords(unit).some(record => {
    const value = [
      record?.type, record?.effectType, record?.category, record?.name, record?.id
    ].map(text).join(':');
    return value.includes('heal') || value.includes('support')
      || value.includes('restore') || value.includes('shield');
  });
}

/**
 * Versioned pure classifier over existing unit facts.
 */
export function classifySpawnRoleV1(unit) {
  const aiType = text(unit?.aiType);
  const archetype = text(unit?.archetype);
  const traits = new Set();
  let primaryRole;
  if (unit?.isBoss === true || unit?.boss === true || archetype.includes('boss')) {
    primaryRole = 'boss';
  } else if (aiType === 'ambush' || unit?.hidden === true || unit?.startsHidden === true) {
    primaryRole = 'ambush';
  } else if (aiType === 'support' || hasSupportAbility(unit)) {
    primaryRole = 'support';
  } else if (Number(unit?.attackRange) > 1 || Number(unit?.range) > 1) {
    primaryRole = 'ranged';
  } else if (aiType === 'hit-and-run' || aiType === 'mobile'
    || Number(unit?.movement) >= 6) {
    primaryRole = 'mobile';
  } else if (aiType === 'defensive' || aiType === 'defender'
    || archetype.includes('tank')) {
    primaryRole = 'defender';
  } else {
    primaryRole = 'frontline';
  }
  if (Number(unit?.attackRange) > 1 || Number(unit?.range) > 1) traits.add('ranged');
  if (Number(unit?.movement) >= 6) traits.add('mobile');
  if (unit?.hidden === true || unit?.startsHidden === true) traits.add('concealment');
  if (hasSupportAbility(unit)) traits.add('support');
  if (primaryRole === 'boss') traits.add('boss');
  return Object.freeze({
    version: SPAWN_CLASSIFIER_VERSION,
    primaryRole,
    traits: Object.freeze([...traits].sort())
  });
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function manhattan(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function seededTie(value) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function collectCandidates(map) {
  const zones = new Map(map.spawnContract.opponentZones.map(zone => [zone.id, zone]));
  const zoneByCell = new Map();
  for (const zone of map.spawnContract.opponentZones) {
    for (const cell of zone.cells) {
      const key = pointKey(cell);
      if (zoneByCell.has(key) && zoneByCell.get(key) !== zone.id) {
        fail(`opponent candidate cell ${key} belongs to multiple zones`, 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT');
      }
      zoneByCell.set(key, zone.id);
    }
  }
  const annotations = new Map(
    map.spawnContract.tacticalAnnotations.map(annotation => [annotation.id, annotation])
  );
  const byCell = new Map();
  for (const candidate of map.spawnContract.opponentCandidates) {
    const key = pointKey(candidate.cell);
    if (byCell.has(key)) {
      fail(`duplicate authored opponent candidate cell ${key}`, 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT');
    }
    const containingZoneId = zoneByCell.get(key) ?? null;
    if (candidate.zoneId !== containingZoneId) {
      fail(
        `candidate ${candidate.id} zoneId does not exactly match authored zone ownership at ${key}`,
        'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT'
      );
    }
    const zone = candidate.zoneId === null ? null : zones.get(candidate.zoneId);
    const tags = new Set([...(candidate.tags ?? []), ...(zone?.tags ?? [])]);
    for (const annotationId of candidate.tacticalAnnotationIds) {
      const annotation = annotations.get(annotationId);
      if (annotation) {
        if (!annotation.cells.some(cell => pointKey(cell) === key)) {
          fail(
            `candidate ${candidate.id} references annotation ${annotationId} outside its cells`,
            'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT'
          );
        }
        tags.add(annotation.kind);
        annotation.tags.forEach(tag => tags.add(tag));
      }
    }
    byCell.set(key, {
      id: candidate.id,
      cell: candidate.cell,
      zoneId: candidate.zoneId,
      minimumClearance: candidate.minimumClearance,
      tags: [...tags].sort()
    });
  }
  for (const zone of map.spawnContract.opponentZones) {
    for (const cell of zone.cells) {
      const key = pointKey(cell);
      if (!byCell.has(key)) {
        const generatedId = `zone:${zone.id}:${cell.x}:${cell.y}`;
        if (map.spawnContract.opponentCandidates.some(record => record.id === generatedId)) {
          fail(
            `generated zone candidate id ${generatedId} collides with an explicit candidate`,
            'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT'
          );
        }
        byCell.set(key, {
          id: generatedId,
          cell,
          zoneId: zone.id,
          minimumClearance: 0,
          tags: [...zone.tags].sort()
        });
      }
    }
  }
  const candidates = [...byCell.values()].sort((left, right) => compareText(left.id, right.id));
  if (candidates.length !== map.spawnContract.capacities.candidatePoolSize) {
    fail(
      `authored opponent candidate pool has ${candidates.length} cells; expected ${map.spawnContract.capacities.candidatePoolSize}`,
      'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
    );
  }
  return candidates;
}

function assertUniqueUnits(units, name) {
  if (!Array.isArray(units)) fail(`${name} must be an array`);
  const ids = new Set();
  return units.map(unit => {
    const id = stableUnitId(unit);
    if (ids.has(id)) fail(`${name} contains duplicate stable unit identity ${id}`, 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT');
    ids.add(id);
    return { id, unit, classification: classifySpawnRoleV1(unit) };
  });
}

function obstacleCells(map) {
  return new Set(map.obstacles.flatMap(obstacle => obstacle.cells.map(pointKey)));
}

function hasStaticClearance(map, blocked, candidate) {
  const radius = candidate.minimumClearance;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const x = candidate.cell.x + dx;
      const y = candidate.cell.y + dy;
      if (x < 0 || y < 0 || x >= map.dimensions.width || y >= map.dimensions.height
        || map.playableMask[y][x] !== true
        || map.terrain[y][x]?.passable !== true
        || blocked.has(`${x},${y}`)) {
        return false;
      }
    }
  }
  return true;
}

function isPairCompatible(classification, candidate) {
  if (candidate.tags.includes('no-spawn')) return false;
  const exclusiveRoles = candidate.tags
    .filter(tag => tag.startsWith('only:'))
    .map(tag => tag.slice('only:'.length));
  return exclusiveRoles.length === 0 || exclusiveRoles.includes(classification.primaryRole);
}

function pairScore({
  unitRecord,
  candidate,
  map,
  view,
  playerCells,
  playerExits,
  opponentExits
}) {
  const { classification, unit } = unitRecord;
  let score = 0;
  if (candidate.tags.includes(classification.primaryRole)) score += 10_000;
  for (const trait of classification.traits) {
    if (candidate.tags.includes(trait)) score += 1_000;
  }
  if (classification.primaryRole === 'boss' && candidate.tags.includes('boss')) score += 20_000;
  if (classification.primaryRole === 'ambush' && candidate.tags.includes('ambush')) score += 8_000;
  if (classification.primaryRole === 'ranged' && candidate.tags.includes('high-ground')) score += 6_000;
  if (classification.primaryRole === 'support' && candidate.tags.includes('support')) score += 6_000;
  if (classification.primaryRole === 'frontline' && candidate.tags.includes('frontline')) score += 6_000;

  const elevation = map.elevation[candidate.cell.y][candidate.cell.x];
  if (['ranged', 'support'].includes(classification.primaryRole)) score += elevation * 50;
  const playerDistance = Math.min(...playerCells.map(cell => manhattan(cell, candidate.cell)));
  if (['ranged', 'support'].includes(classification.primaryRole)) score += playerDistance * 10;
  if (['frontline', 'defender', 'boss'].includes(classification.primaryRole)) score -= playerDistance * 5;

  const ownExitDistance = Math.min(...opponentExits.map(exit =>
    calculateTraversalPathCost(view, { start: candidate.cell, goal: exit.cell })
  ));
  const opposingExitDistance = Math.min(...playerExits.map(exit =>
    calculateTraversalPathCost(view, { start: candidate.cell, goal: exit.cell })
  ));
  score -= Math.round(ownExitDistance * 20);
  if (Number.isFinite(opposingExitDistance)) score -= Math.round(opposingExitDistance);

  const movement = Math.max(1, Math.min(12, Number(unit?.movement) || 4));
  score += Math.min(500, getReachableTilesForTraversal(view, {
    start: candidate.cell,
    range: movement
  }).length * 5);
  return score;
}

function minimumCostMatching(unitRecords, candidates, zones, costs, {
  pairAllowed,
  partialAllowed,
  completeAllowed
}) {
  const candidateOrder = costs.map(row => row
    .map((cost, candidateIndex) => ({ cost, candidateIndex }))
    .filter(record => record.cost !== null)
    .sort((left, right) =>
      left.cost - right.cost
      || compareText(candidates[left.candidateIndex].id, candidates[right.candidateIndex].id)
    ));
  const suffixLowerBound = Array(unitRecords.length + 1).fill(0);
  for (let index = unitRecords.length - 1; index >= 0; index -= 1) {
    suffixLowerBound[index] = suffixLowerBound[index + 1] + candidateOrder[index][0].cost;
  }
  let bestCost = Infinity;
  let best = null;
  const selected = [];
  const used = new Set();
  const zoneCounts = new Map();
  let visitedNodes = 0;

  const search = (unitIndex, cost) => {
    visitedNodes += 1;
    if (visitedNodes > SPAWN_MATCH_MAX_SEARCH_NODES) {
      fail(
        `spawn matching exceeded deterministic work limit ${SPAWN_MATCH_MAX_SEARCH_NODES}`,
        'BATTLE_MAP_V3_SPAWN_MATCH_WORK_LIMIT'
      );
    }
    if (cost + suffixLowerBound[unitIndex] >= bestCost) return;
    if (unitIndex === unitRecords.length) {
      const assignments = selected.map((candidateIndex, index) => ({
        unit: unitRecords[index],
        candidate: candidates[candidateIndex]
      }));
      if (!completeAllowed(assignments)) return;
      bestCost = cost;
      best = [...selected];
      return;
    }
    for (const option of candidateOrder[unitIndex]) {
      const { candidateIndex } = option;
      if (used.has(candidateIndex)) continue;
      const candidate = candidates[candidateIndex];
      if (!pairAllowed(candidate, selected.map(index => candidates[index]))) continue;
      if (candidate.zoneId !== null) {
        const count = zoneCounts.get(candidate.zoneId) ?? 0;
        if (count >= zones.get(candidate.zoneId).capacity) continue;
        zoneCounts.set(candidate.zoneId, count + 1);
      }
      selected.push(candidateIndex);
      used.add(candidateIndex);
      const partial = selected.map((selectedIndex, index) => ({
        unit: unitRecords[index],
        candidate: candidates[selectedIndex]
      }));
      if (partialAllowed(partial)) search(unitIndex + 1, cost + option.cost);
      used.delete(candidateIndex);
      selected.pop();
      if (candidate.zoneId !== null) {
        const count = zoneCounts.get(candidate.zoneId) - 1;
        if (count === 0) zoneCounts.delete(candidate.zoneId);
        else zoneCounts.set(candidate.zoneId, count);
      }
    }
  };
  search(0, 0);
  if (best === null) {
    fail(
      'no complete deterministic opponent spawn matching satisfies all hard constraints',
      'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
    );
  }
  return best.map((candidateIndex, unitIndex) => ({
    unit: unitRecords[unitIndex],
    candidate: candidates[candidateIndex]
  }));
}

function assertFinalAssignment({
  map,
  playerAssignments,
  opponentAssignments,
  candidatesById
}) {
  const allAssignments = [...playerAssignments, ...opponentAssignments];
  const occupiedKeys = allAssignments.map(assignment => pointKey(assignment.cell));
  if (new Set(occupiedKeys).size !== occupiedKeys.length) {
    fail('spawn matcher produced overlapping assignments', 'AMBIGUOUS_BATTLE_MAP_V3_SPAWN_INPUT');
  }
  const playerBySlot = new Map(playerAssignments.map(assignment => [assignment.slotId, assignment]));
  const opponentByCandidate = new Map(
    opponentAssignments.map(assignment => [assignment.candidateId, assignment])
  );
  for (const clearance of map.spawnContract.protectedClearances) {
    const anchor = clearance.side === 'player'
      ? playerBySlot.get(clearance.anchorId)
      : opponentByCandidate.get(clearance.anchorId);
    if (!anchor) continue;
    const others = clearance.side === 'player' ? opponentAssignments : allAssignments;
    for (const other of others) {
      if (other === anchor) continue;
      if (manhattan(anchor.cell, other.cell) <= clearance.radius) {
        fail(
          `assignment violates protected clearance ${clearance.id}`,
          'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
        );
      }
    }
  }
  for (let left = 0; left < opponentAssignments.length; left += 1) {
    const leftCandidate = candidatesById.get(opponentAssignments[left].candidateId);
    for (let right = left + 1; right < opponentAssignments.length; right += 1) {
      const rightCandidate = candidatesById.get(opponentAssignments[right].candidateId);
      const required = Math.max(
        leftCandidate?.minimumClearance ?? 0,
        rightCandidate?.minimumClearance ?? 0
      );
      if (manhattan(opponentAssignments[left].cell, opponentAssignments[right].cell) <= required) {
        fail(
          'selected opponent candidates violate authored minimum clearance',
          'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
        );
      }
    }
  }

  const finalUnits = playerAssignments.map(assignment => ({
    id: assignment.unitId,
    x: assignment.cell.x,
    y: assignment.cell.y,
    hp: 1,
    type: 'player',
    teamId: 1
  })).concat(opponentAssignments.map(assignment => ({
    id: assignment.unitId,
    x: assignment.cell.x,
    y: assignment.cell.y,
    hp: 1,
    type: 'enemy',
    teamId: 2
  })));
  const occupiedView = createBattleMapV3TraversalView(map, {
    units: finalUnits
  });
  const exits = side => map.spawnContract.exits.filter(exit => exit.side === side);
  for (const [side, assignments] of [
    ['player', playerAssignments],
    ['opponent', opponentAssignments]
  ]) {
    for (const assignment of assignments) {
      if (!exits(side).some(exit => Number.isFinite(calculateTraversalPathCost(
        occupiedView,
        { start: assignment.cell, goal: exit.cell }
      )))) {
        fail(
          `final ${side} assignment ${assignment.unitId} cannot reach an authored exit`,
          'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
        );
      }
    }
  }
}

/**
 * Assign actual units to immutable authored spawn candidates without reading
 * or mutating any preliminary unit coordinates.
 */
export function assignBattleMapV3Spawns({
  map,
  playerUnits,
  opponentUnits,
  encounterSeed
}) {
  if (!['string', 'number'].includes(typeof encounterSeed) || String(encounterSeed).length === 0) {
    fail('encounterSeed must be a non-empty string or number');
  }
  const players = assertUniqueUnits(playerUnits, 'playerUnits');
  const opponents = assertUniqueUnits(opponentUnits, 'opponentUnits');
  if (players.length === 0 || opponents.length === 0) {
    fail('playerUnits and opponentUnits must each contain at least one unit');
  }
  const { capacities } = map.spawnContract;
  if (players.length > capacities.playerCapacity) {
    fail(
      `player roster ${players.length} exceeds playerCapacity ${capacities.playerCapacity}`,
      'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
    );
  }
  if (opponents.length > capacities.maxAssignableOpponents) {
    fail(
      `opponent roster ${opponents.length} exceeds maxAssignableOpponents ${capacities.maxAssignableOpponents}`,
      'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
    );
  }
  const playerAssignments = players.map((record, index) => ({
    unitId: record.id,
    slotId: map.spawnContract.playerSlots[index].id,
    cell: { ...map.spawnContract.playerSlots[index].cell }
  }));
  const playerCells = playerAssignments.map(assignment => assignment.cell);
  const blocked = obstacleCells(map);
  const reserved = new Set(playerCells.map(pointKey));
  const view = createBattleMapV3TraversalView(map, {
    movementPolicy: { ignoreUnits: true }
  });
  const playerExits = map.spawnContract.exits.filter(exit => exit.side === 'player');
  const opponentExits = map.spawnContract.exits.filter(exit => exit.side === 'opponent');
  const playerProtected = map.spawnContract.protectedClearances
    .filter(clearance => clearance.side === 'player')
    .map(clearance => ({
      ...clearance,
      cell: playerAssignments.find(assignment => assignment.slotId === clearance.anchorId)?.cell
    }));
  const candidates = collectCandidates(map).filter(candidate => {
    const key = pointKey(candidate.cell);
    if (reserved.has(key) || blocked.has(key)
      || map.playableMask[candidate.cell.y][candidate.cell.x] !== true
      || map.terrain[candidate.cell.y][candidate.cell.x]?.passable !== true) return false;
    if (!hasStaticClearance(map, blocked, candidate)) {
      return false;
    }
    if (playerCells.some(cell => manhattan(cell, candidate.cell) <= candidate.minimumClearance)) return false;
    if (playerProtected.some(clearance =>
      clearance.cell && manhattan(clearance.cell, candidate.cell) <= clearance.radius
    )) return false;
    return opponentExits.some(exit => Number.isFinite(calculateTraversalPathCost(view, {
      start: candidate.cell,
      goal: exit.cell
    })));
  });
  if (candidates.length < opponents.length) {
    fail(
      `only ${candidates.length} legal candidates remain for ${opponents.length} opponents`,
      'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL'
    );
  }

  const orderedOpponents = [...opponents].sort((left, right) =>
    PRIORITY.get(left.classification.primaryRole) - PRIORITY.get(right.classification.primaryRole)
      || compareText(left.id, right.id)
  );
  const mapIdentity = map.hashes?.fullHash ?? `${map.contentId}:${map.contentVersion}`;
  const costs = orderedOpponents.map(unitRecord => candidates.map(candidate => {
    if (!isPairCompatible(unitRecord.classification, candidate)) return null;
    const score = pairScore({
      unitRecord,
      candidate,
      map,
      view,
      playerCells,
      playerExits,
      opponentExits
    });
    const tie = seededTie([
      mapIdentity,
      String(encounterSeed),
      SPAWN_CLASSIFIER_VERSION,
      SPAWN_SCORER_VERSION,
      unitRecord.id,
      candidate.id
    ].join('\0')) % 1_000_000;
    return -score * 1_000_000 + tie;
  }));
  if (costs.some(row => row.every(cost => cost === null))) {
    fail('at least one opponent has no role-compatible authored candidate', 'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL');
  }

  const zones = new Map(map.spawnContract.opponentZones.map(zone => [zone.id, zone]));
  const opponentProtected = map.spawnContract.protectedClearances
    .filter(clearance => clearance.side === 'opponent');
  const buildOpponentAssignments = assignments => assignments.map(({ unit, candidate }) => ({
    unitId: unit.id,
    candidateId: candidate.id,
    role: unit.classification.primaryRole,
    cell: { ...candidate.cell }
  }));
  const occupiedValidityCache = new Map();
  const occupiedAssignmentAllowed = assignments => {
    const key = assignments.map(({ candidate }) => candidate.id).sort(compareText).join('\0');
    if (occupiedValidityCache.has(key)) return occupiedValidityCache.get(key);
    try {
      assertFinalAssignment({
        map,
        playerAssignments,
        opponentAssignments: buildOpponentAssignments(assignments),
        candidatesById: new Map(candidates.map(candidate => [candidate.id, candidate]))
      });
      occupiedValidityCache.set(key, true);
      return true;
    } catch (error) {
      if (error?.code === 'BATTLE_MAP_V3_SPAWN_CAPACITY_SHORTFALL') {
        occupiedValidityCache.set(key, false);
        return false;
      }
      throw error;
    }
  };
  const selected = minimumCostMatching(orderedOpponents, candidates, zones, costs, {
    pairAllowed(candidate, selectedCandidates) {
      return selectedCandidates.every(other => {
        const required = Math.max(candidate.minimumClearance, other.minimumClearance);
        if (manhattan(candidate.cell, other.cell) <= required) return false;
        return opponentProtected.every(clearance =>
          ![candidate.id, other.id].includes(clearance.anchorId)
          || manhattan(candidate.cell, other.cell) > clearance.radius
        );
      });
    },
    partialAllowed(assignments) {
      return occupiedAssignmentAllowed(assignments);
    },
    completeAllowed(assignments) {
      return occupiedAssignmentAllowed(assignments);
    }
  });
  const opponentAssignments = buildOpponentAssignments(selected);
  assertFinalAssignment({
    map,
    playerAssignments,
    opponentAssignments,
    candidatesById: new Map(candidates.map(candidate => [candidate.id, candidate]))
  });
  return deepFreeze({
    classifierVersion: SPAWN_CLASSIFIER_VERSION,
    scorerVersion: SPAWN_SCORER_VERSION,
    playerAssignments,
    opponentAssignments
  });
}
