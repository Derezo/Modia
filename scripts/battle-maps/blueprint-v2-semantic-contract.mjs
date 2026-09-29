const LEGACY_BLUEPRINT_TEMPLATE_IDS = new Set([
  'forest-template-01',
  'forest-template-02'
]);
const TEMPLATE_07_ID = 'forest-template-07';
const CAVE_TEMPLATE_01_ID = 'cave-template-01';
const CAVE_CROSS_THEME_SEMANTIC_TOKENS = new Set([
  'forest',
  'grove',
  'oak',
  'birch',
  'pine',
  'tree',
  'shrub',
  'hawthorn',
  'clover',
  'fern'
]);
const CAVE_CONNECTION_FAMILY_BY_KIND = new Map([
  ['slope', 'natural-ramp'],
  ['stairs', 'carved-stairs']
]);
// Eight consecutive adjacency rungs occupy one quarter of the fixed 32-cell
// V2 canvas and read as a parallel ladder. Seven or fewer preserves room for
// compact figure-eight crossings and interlocking junctions.
const MAXIMUM_PARALLEL_ROUTE_LADDER_RUN = 7;

function fail(message) {
  const error = new Error(message);
  error.code = 'INVALID_TEMPLATE_MAP_BLUEPRINT';
  throw error;
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function undirectedEdgeKey(left, right) {
  const leftKey = cellKey(left);
  const rightKey = cellKey(right);
  return leftKey < rightKey
    ? `${leftKey}~${rightKey}`
    : `${rightKey}~${leftKey}`;
}

function sameCellSet(left, right) {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(cellKey));
  return rightKeys.size === right.length
    && left.every(cell => rightKeys.has(cellKey(cell)));
}

function routeIntentRequiresConnectedCenterlines(routeIntent) {
  if (
    routeIntent !== null
    && typeof routeIntent === 'object'
    && Object.hasOwn(routeIntent, 'minimumApproachesPerFormation')
  ) return true;
  const text = JSON.stringify(routeIntent).toLowerCase();
  return text.includes('interlocking loops') || text.includes('figure-eight');
}

function cardinalNeighbors(cell) {
  return [
    `${cell.x - 1},${cell.y}`,
    `${cell.x + 1},${cell.y}`,
    `${cell.x},${cell.y - 1}`,
    `${cell.x},${cell.y + 1}`
  ];
}

export function passableTraversalComponents(blueprint) {
  const blockedCellKeys = new Set(
    blueprint.obstacles.flatMap(obstacle => obstacle.cells).map(cellKey)
  );
  const remaining = new Set();
  for (let y = 0; y < blueprint.dimensions.height; y += 1) {
    for (let x = 0; x < blueprint.dimensions.width; x += 1) {
      const key = `${x},${y}`;
      if (
        blueprint.playableMask[y][x] === true
        && !blockedCellKeys.has(key)
      ) remaining.add(key);
    }
  }
  const cardinalConnectionsByEdge = new Map(
    blueprint.connections
      .filter(connection => (
        Math.abs(connection.from.x - connection.to.x)
          + Math.abs(connection.from.y - connection.to.y) === 1
      ))
      .map(connection => [
        undirectedEdgeKey(connection.from, connection.to),
        connection
      ])
  );
  const components = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value;
    remaining.delete(first);
    const queue = [first];
    const cells = [];
    while (queue.length > 0) {
      const currentKey = queue.pop();
      const [x, y] = currentKey.split(',').map(Number);
      const current = { x, y };
      cells.push(current);
      for (const adjacentKey of cardinalNeighbors(current)) {
        if (!remaining.has(adjacentKey)) continue;
        const [adjacentX, adjacentY] = adjacentKey.split(',').map(Number);
        const adjacent = { x: adjacentX, y: adjacentY };
        const connection = cardinalConnectionsByEdge.get(
          undirectedEdgeKey(current, adjacent)
        );
        const level =
          blueprint.elevation[y][x]
            === blueprint.elevation[adjacentY][adjacentX];
        if (level) {
          if (
            connection
            && (
              connection.traversable !== true
              || connection.bidirectional !== true
            )
          ) continue;
        } else if (
          connection?.traversable !== true
          || connection.bidirectional !== true
        ) {
          continue;
        }
        remaining.delete(adjacentKey);
        queue.push(adjacentKey);
      }
    }
    components.push(cells);
  }
  return components.sort((left, right) => right.length - left.length);
}

function assertTemplate07PassableTraversalConnected(blueprint) {
  const components = passableTraversalComponents(blueprint);
  if (components.length === 1) return;
  const isolatedCells = components
    .filter(component => component.length === 1)
    .map(component => cellKey(component[0]));
  fail(
    'Template-07 passable traversal must form one connected component using '
      + 'cardinal same-level adjacency or an exact declared traversable '
      + 'bidirectional cardinal elevation connection; component sizes '
      + `[${components.map(component => component.length).join(', ')}]`
      + (
        isolatedCells.length === 0
          ? ''
          : `; isolated cells ${isolatedCells.join(', ')}`
      )
  );
}

function minimumManhattanDistance(cell, targets) {
  return Math.min(...targets.map(target => (
    Math.abs(cell.x - target.x) + Math.abs(cell.y - target.y)
  )));
}

function assertCardinallyConnected(cells, message) {
  const remaining = new Set(cells.map(cellKey));
  const first = remaining.values().next().value;
  if (first === undefined) return;
  const queue = [first];
  remaining.delete(first);
  while (queue.length > 0) {
    const current = queue.shift();
    const [x, y] = current.split(',').map(Number);
    for (const adjacent of cardinalNeighbors({ x, y })) {
      if (!remaining.delete(adjacent)) continue;
      queue.push(adjacent);
    }
  }
  if (remaining.size > 0) fail(message);
}

function cellsIntersectOrCardinallyTouch(leftCells, rightCellKeys) {
  return leftCells.some(cell => (
    rightCellKeys.has(cellKey(cell))
    || cardinalNeighbors(cell).some(key => rightCellKeys.has(key))
  ));
}

function longestConsecutiveRun(values) {
  const ordered = [...new Set(values)].sort((left, right) => left - right);
  let longest = 0;
  let current = 0;
  let previous;
  for (const value of ordered) {
    current = previous !== undefined && value === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = value;
  }
  return longest;
}

function parallelRouteLadderLength(leftRoute, rightRoute) {
  const horizontalRungsByBand = new Map();
  const verticalRungsByBand = new Map();
  for (const left of leftRoute.cells) {
    for (const right of rightRoute.cells) {
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
      if (dy === 0) {
        const band = Math.min(left.x, right.x);
        const positions = horizontalRungsByBand.get(band) ?? [];
        positions.push(left.y);
        horizontalRungsByBand.set(band, positions);
      } else {
        const band = Math.min(left.y, right.y);
        const positions = verticalRungsByBand.get(band) ?? [];
        positions.push(left.x);
        verticalRungsByBand.set(band, positions);
      }
    }
  }
  return Math.max(
    0,
    ...[...horizontalRungsByBand.values(), ...verticalRungsByBand.values()]
      .map(longestConsecutiveRun)
  );
}

function addResidualEdge(graph, from, to, capacity) {
  const forward = { to, capacity, reverse: null };
  const reverse = { to: from, capacity: 0, reverse: forward };
  forward.reverse = reverse;
  const fromEdges = graph.get(from) ?? [];
  const toEdges = graph.get(to) ?? [];
  fromEdges.push(forward);
  toEdges.push(reverse);
  graph.set(from, fromEdges);
  graph.set(to, toEdges);
}

function maximumVertexDisjointRoutePaths({
  routes,
  playerCells,
  opponentCells,
  limit,
  orderedEndpoints
}) {
  const routeCells = new Map();
  const routeEdges = new Map();
  const playerEndpoints = new Set();
  const opponentEndpoints = new Set();
  for (const route of routes) {
    for (const cell of route.cells) routeCells.set(cellKey(cell), cell);
    for (let index = 1; index < route.cells.length; index += 1) {
      const left = route.cells[index - 1];
      const right = route.cells[index];
      routeEdges.set(
        undirectedEdgeKey(left, right),
        [cellKey(left), cellKey(right)]
      );
    }
    const first = route.cells[0];
    const last = route.cells.at(-1);
    if (orderedEndpoints) {
      playerEndpoints.add(cellKey(first));
      opponentEndpoints.add(cellKey(last));
    } else {
      const forwardDistance =
        minimumManhattanDistance(first, playerCells)
        + minimumManhattanDistance(last, opponentCells);
      const reverseDistance =
        minimumManhattanDistance(last, playerCells)
        + minimumManhattanDistance(first, opponentCells);
      const playerEndpoint = forwardDistance <= reverseDistance ? first : last;
      const opponentEndpoint = forwardDistance <= reverseDistance ? last : first;
      playerEndpoints.add(cellKey(playerEndpoint));
      opponentEndpoints.add(cellKey(opponentEndpoint));
    }
  }

  const graph = new Map();
  const source = 'flow:source';
  const sink = 'flow:sink';
  for (const key of routeCells.keys()) {
    addResidualEdge(graph, `${key}:in`, `${key}:out`, 1);
  }
  for (const [left, right] of routeEdges.values()) {
    addResidualEdge(graph, `${left}:out`, `${right}:in`, limit);
    addResidualEdge(graph, `${right}:out`, `${left}:in`, limit);
  }
  for (const key of playerEndpoints) {
    addResidualEdge(graph, source, `${key}:in`, 1);
  }
  for (const key of opponentEndpoints) {
    addResidualEdge(graph, `${key}:out`, sink, 1);
  }

  let flow = 0;
  while (flow < limit) {
    const previous = new Map([[source, null]]);
    const queue = [source];
    while (queue.length > 0 && !previous.has(sink)) {
      const current = queue.shift();
      for (const edge of graph.get(current) ?? []) {
        if (edge.capacity < 1 || previous.has(edge.to)) continue;
        previous.set(edge.to, { from: current, edge });
        queue.push(edge.to);
      }
    }
    if (!previous.has(sink)) break;
    for (let current = sink; current !== source;) {
      const step = previous.get(current);
      step.edge.capacity -= 1;
      step.edge.reverse.capacity += 1;
      current = step.from;
    }
    flow += 1;
  }
  return flow;
}

function mixedElevationApproachTargets(sidecar) {
  const areas = new Map(
    sidecar.topologyIntent.areas.map(area => [area.id, area])
  );
  return sidecar.topologyIntent.relationships.flatMap(relationship => {
    const kind = String(relationship.kind).toLowerCase();
    const tokens = new Set(kind.match(/[a-z]+/g) ?? []);
    const hasGradualAccess = [...tokens].some(token =>
      token === 'slope'
      || token === 'slopes'
      || token === 'ramp'
      || token === 'ramps'
    );
    const hasStairAccess = [...tokens].some(token =>
      token === 'stair'
      || token === 'stairs'
      || token === 'stairway'
      || token === 'stairways'
    );
    if (!relationship.required || !hasGradualAccess || !hasStairAccess) {
      return [];
    }
    const elevated = [relationship.from, relationship.to].find(id => (
      /elevated|overlook|ridge|terrace/.test(
        String(areas.get(id)?.description ?? '').toLowerCase()
      )
    ));
    return [elevated ?? relationship.to];
  });
}

function caveSemanticStrings(blueprint) {
  const values = [];
  const add = (path, value) => {
    if (typeof value === 'string') {
      values.push({ path, value });
      return;
    }
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => add(`${path}[${index}]`, item));
  };
  const addRecords = (root, records, fields) => {
    records.forEach((record, index) => {
      for (const field of fields) {
        add(`${root}[${index}].${field}`, record[field]);
      }
    });
  };

  blueprint.surfaceGrid.forEach((row, y) => row.forEach((surface, x) => {
    if (surface === null) return;
    add(`surfaceGrid[${y}][${x}].material`, surface.material);
    add(`surfaceGrid[${y}][${x}].featureId`, surface.featureId);
  }));
  addRecords('regions', blueprint.regions, ['id', 'kind', 'annotations']);
  addRecords(
    'features',
    blueprint.features,
    ['id', 'kind', 'ownerFeatureId', 'annotations']
  );
  addRecords(
    'routes',
    blueprint.routes,
    ['id', 'kind', 'material', 'featureId', 'assetFamily']
  );
  addRecords(
    'connections',
    blueprint.connections,
    ['id', 'kind', 'featureId', 'assetFamily']
  );
  addRecords(
    'boundaries',
    blueprint.boundaries,
    ['id', 'kind', 'featureId', 'assetFamily']
  );
  addRecords(
    'obstacles',
    blueprint.obstacles,
    ['id', 'kind', 'featureId', 'assetFamily']
  );
  addRecords(
    'decorations',
    blueprint.decorations,
    ['id', 'kind', 'featureId', 'anchor', 'assetFamily']
  );
  add('spawn.formationFacing.player', blueprint.spawn.formationFacing.player);
  add('spawn.formationFacing.opponent', blueprint.spawn.formationFacing.opponent);
  addRecords(
    'spawn.playerSlots',
    blueprint.spawn.playerSlots,
    ['id', 'role', 'tags']
  );
  addRecords(
    'spawn.opponentCandidates',
    blueprint.spawn.opponentCandidates,
    ['id', 'tags', 'zoneId', 'tacticalAnnotationIds']
  );
  addRecords('spawn.opponentZones', blueprint.spawn.opponentZones, ['id', 'tags']);
  addRecords(
    'spawn.protectedClearances',
    blueprint.spawn.protectedClearances,
    ['id', 'side', 'anchorId']
  );
  addRecords(
    'spawn.exits',
    blueprint.spawn.exits,
    ['id', 'side', 'approachRegionId']
  );
  addRecords(
    'spawn.approachRegions',
    blueprint.spawn.approachRegions,
    ['id', 'side']
  );
  addRecords(
    'spawn.tacticalAnnotations',
    blueprint.spawn.tacticalAnnotations,
    ['id', 'kind', 'tags']
  );
  addRecords(
    'expectedAssetFamilies',
    blueprint.expectedAssetFamilies,
    ['category', 'symbol']
  );
  add('generationNotes', blueprint.generationNotes);
  return values;
}

function containsCaveCrossThemeSemanticToken(value) {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.some(token => CAVE_CROSS_THEME_SEMANTIC_TOKENS.has(token));
}

export function usesBlueprintV2SemanticContract(templateId) {
  return !LEGACY_BLUEPRINT_TEMPLATE_IDS.has(templateId);
}

export function validateV2BlueprintSemanticContract(blueprint, sidecar) {
  if (sidecar.id === TEMPLATE_07_ID) {
    assertTemplate07PassableTraversalConnected(blueprint);
  }
  const playerCells = blueprint.spawn.playerSlots.map(slot => slot.cell);
  const opponentCells =
    blueprint.spawn.opponentCandidates.map(candidate => candidate.cell);
  const exitAndApproachCells = new Set([
    ...blueprint.spawn.exits.map(exit => cellKey(exit.cell)),
    ...blueprint.spawn.approachRegions
      .flatMap(region => region.cells)
      .map(cellKey)
  ]);
  for (const [side, cells] of [
    ['player', playerCells],
    ['opponent', opponentCells]
  ]) {
    if (cells.some(cell => exitAndApproachCells.has(cellKey(cell)))) {
      fail(`V2 ${side} formation cells must not overlap exits or approach regions`);
    }
  }

  const requiredRoutes = blueprint.routes.filter(route => route.required);
  const requiredRouteCellKeys = new Set(
    requiredRoutes.flatMap(route => route.cells).map(cellKey)
  );
  const regionIds = new Set(blueprint.regions.map(region => region.id));
  const missingRequiredAreaIds = sidecar.topologyIntent.areas
    .filter(area => area.required === true && !regionIds.has(area.id))
    .map(area => area.id);
  if (missingRequiredAreaIds.length > 0) {
    fail(
      'V2 blueprint requires region records for every required topology area; '
        + `missing ${missingRequiredAreaIds.join(', ')}`
    );
  }
  if (sidecar.id === CAVE_TEMPLATE_01_ID) {
    const requiredAreaIds = sidecar.topologyIntent.areas
      .filter(area => area.required === true)
      .map(area => area.id);
    const unexpectedRegionIds = blueprint.regions
      .map(region => region.id)
      .filter(id => !requiredAreaIds.includes(id));
    if (
      blueprint.regions.length !== requiredAreaIds.length
      || unexpectedRegionIds.length > 0
    ) {
      fail(
        'cave-template-01 region IDs must exactly equal the five reviewed '
          + `topology areas; unexpected ${unexpectedRegionIds.join(', ') || 'count mismatch'}`
      );
    }
    for (const semantic of caveSemanticStrings(blueprint)) {
      if (!containsCaveCrossThemeSemanticToken(semantic.value)) continue;
      fail(
        `cave-template-01 ${semantic.path} contains a cross-theme semantic label`
      );
    }
    blueprint.connections.forEach((connection, index) => {
      const expectedFamily = CAVE_CONNECTION_FAMILY_BY_KIND.get(connection.kind);
      if (expectedFamily === connection.assetFamily) return;
      fail(
        `cave-template-01 connections[${index}] kind ${connection.kind} must use `
          + `assetFamily ${expectedFamily ?? 'from the reviewed cave connection set'}`
      );
    });
  }
  const traversableConnections =
    blueprint.connections.filter(connection => connection.traversable);
  if (traversableConnections.length > sidecar.mapProfile.width) {
    fail(
      `V2 blueprint has ${traversableConnections.length} traversable elevation `
        + `connections; at most the fixed map width of ${sidecar.mapProfile.width} `
        + 'is allowed'
    );
  }
  const routeTouchingConnectionCount = traversableConnections.filter(connection => (
    requiredRouteCellKeys.has(cellKey(connection.from))
    || requiredRouteCellKeys.has(cellKey(connection.to))
  )).length;
  if (
    routeTouchingConnectionCount * 4
    < traversableConnections.length * 3
  ) {
    fail(
      'V2 traversable elevation connections require at least 75% to have from '
        + 'or to on a required route centerline; '
        + `${routeTouchingConnectionCount}/${traversableConnections.length} qualify`
    );
  }
  for (const region of blueprint.regions) {
    if (region.kind === 'formation-clearing') continue;
    if (region.cells.length > 1) {
      assertCardinallyConnected(
        region.cells,
        `V2 tactical region ${region.id} must use one cardinally connected cell set`
      );
    }
    if (!cellsIntersectOrCardinallyTouch(region.cells, requiredRouteCellKeys)) {
      fail(
        `V2 tactical region ${region.id} must intersect or cardinally touch a `
          + 'required route'
      );
    }
  }

  for (let leftIndex = 0; leftIndex < requiredRoutes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < requiredRoutes.length;
      rightIndex += 1
    ) {
      const left = requiredRoutes[leftIndex];
      const right = requiredRoutes[rightIndex];
      const ladderLength = parallelRouteLadderLength(left, right);
      if (ladderLength <= MAXIMUM_PARALLEL_ROUTE_LADDER_RUN) continue;
      const article = ladderLength === 8 ? 'an' : 'a';
      fail(
        `V2 required routes ${left.id} and ${right.id} form ${article} `
          + `${ladderLength}-cell `
          + 'side-by-side parallel adjacency ladder; use curved distinct routes '
          + 'with compact interlocking junctions'
      );
    }
  }

  if (
    /-c$/.test(blueprint.candidateId)
    && sidecar.routeIntent.minimumApproachesPerFormation < 3
  ) {
    if (requiredRoutes.length < 3) {
      fail('V2 variant C requires at least three required route segments');
    }
    const flankClearings = blueprint.regions.filter(
      region => region.kind === 'flank-clearing'
    );
    const primaryRouteCellKeys = new Set(
      requiredRoutes.slice(0, 2).flatMap(route => route.cells).map(cellKey)
    );
    const additionalFlankBranches = requiredRoutes.slice(2).filter(route => (
      route.cells.some(cell => !primaryRouteCellKeys.has(cellKey(cell)))
      && flankClearings.some(region =>
        cellsIntersectOrCardinallyTouch(region.cells, new Set(route.cells.map(cellKey)))
      )
    ));
    if (
      flankClearings.length === 0
      || additionalFlankBranches.length === 0
    ) {
      fail(
        'V2 variant C requires an additional distinct required route segment '
          + 'through or cardinally touching a flank-clearing'
      );
    }
  }

  const formationRegions =
    blueprint.regions.filter(region => region.kind === 'formation-clearing');
  if (formationRegions.length < 2) {
    fail('V2 blueprints require at least two exact formation-clearing regions');
  }
  const containsEvery = (region, cells) => {
    const regionKeys = new Set(region.cells.map(cellKey));
    return cells.every(cell => regionKeys.has(cellKey(cell)));
  };
  const playerRegions =
    formationRegions.filter(region => containsEvery(region, playerCells));
  const opponentRegions =
    formationRegions.filter(region => containsEvery(region, opponentCells));
  if (
    playerRegions.length !== 1
    || opponentRegions.length !== 1
    || !sameCellSet(playerRegions[0].cells, playerCells)
    || !sameCellSet(opponentRegions[0].cells, opponentCells)
    || playerRegions[0].id === opponentRegions[0].id
  ) {
    fail(
      'V2 player and opponent spawn cells must each exactly equal one different '
        + 'formation-clearing region'
    );
  }

  const maximumWidth = Math.ceil(blueprint.dimensions.width / 2);
  const maximumHeight = Math.ceil(blueprint.dimensions.height / 2);
  for (const [side, cells] of [
    ['player', playerCells],
    ['opponent', opponentCells]
  ]) {
    const xs = cells.map(cell => cell.x);
    const ys = cells.map(cell => cell.y);
    const width = Math.max(...xs) - Math.min(...xs) + 1;
    const height = Math.max(...ys) - Math.min(...ys) + 1;
    if (width > maximumWidth || height > maximumHeight) {
      fail(
        `V2 ${side} formation inclusive bounding box ${width}x${height} exceeds `
          + `${maximumWidth}x${maximumHeight}`
      );
    }
  }

  if (routeIntentRequiresConnectedCenterlines(sidecar.routeIntent)) {
    const minimumApproaches =
      sidecar.routeIntent.minimumApproachesPerFormation;
    if (!Number.isInteger(minimumApproaches) || minimumApproaches < 2) {
      fail(
        'V2 routeIntent.minimumApproachesPerFormation must be an integer '
          + 'greater than or equal to 2'
      );
    }
    const primaryRoutes = requiredRoutes.filter(route => route.kind === 'primary');
    if (minimumApproaches >= 3 && primaryRoutes.length < minimumApproaches) {
      fail(
        `V2 route intent requires at least ${minimumApproaches} distinct required `
          + 'primary formation-to-formation route records'
      );
    }
    const playerCellKeys = new Set(playerCells.map(cellKey));
    const opponentCellKeys = new Set(opponentCells.map(cellKey));
    if (minimumApproaches >= 3) {
      for (const route of primaryRoutes) {
        const first = route.cells[0];
        const last = route.cells.at(-1);
        if (
          !cellsIntersectOrCardinallyTouch([first], playerCellKeys)
          || !cellsIntersectOrCardinallyTouch([last], opponentCellKeys)
        ) {
          fail(
            `V2 required primary route ${route.id} must be ordered from an endpoint `
              + 'that intersects or cardinally touches the player formation to an '
              + 'endpoint that intersects or cardinally touches the opponent formation'
          );
        }
      }
      if (
        new Set(primaryRoutes.map(route => cellKey(route.cells[0]))).size
          !== primaryRoutes.length
        || new Set(primaryRoutes.map(route => cellKey(route.cells.at(-1)))).size
          !== primaryRoutes.length
      ) {
        fail(
          'V2 required primary formation-to-formation route records must use '
            + 'distinct ordered player and opponent endpoints'
        );
      }
      for (let leftIndex = 0; leftIndex < primaryRoutes.length; leftIndex += 1) {
        const left = primaryRoutes[leftIndex];
        const leftInternalCells = new Set(left.cells.slice(1, -1).map(cellKey));
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < primaryRoutes.length;
          rightIndex += 1
        ) {
          const right = primaryRoutes[rightIndex];
          if (
            right.cells.slice(1, -1).some(cell =>
              leftInternalCells.has(cellKey(cell))
            )
          ) {
            fail(
              `V2 required primary routes ${left.id} and ${right.id} must be `
                + 'internally vertex-disjoint route families'
            );
          }
        }
      }
      const primaryRouteCellKeys = new Set(
        primaryRoutes.flatMap(route => route.cells).map(cellKey)
      );
      for (const route of requiredRoutes.filter(
        record => record.kind === 'secondary'
      )) {
        const attachedCellKeys = new Set([
          ...primaryRouteCellKeys,
          ...playerCellKeys,
          ...opponentCellKeys
        ]);
        if (
          !cellsIntersectOrCardinallyTouch([route.cells[0]], attachedCellKeys)
          || !cellsIntersectOrCardinallyTouch(
            [route.cells.at(-1)],
            attachedCellKeys
          )
        ) {
          fail(
            `V2 required secondary route ${route.id} is a dangling branch; `
              + 'both ordered endpoints must attach to the primary route network '
              + 'or a formation'
          );
        }
      }
    }
    const requiredCells = requiredRoutes.flatMap(route => route.cells);
    const remaining = new Set(requiredCells.map(cellKey));
    const first = remaining.values().next().value;
    if (first === undefined) {
      fail('V2 interlocking-loop intent requires connected required route centerlines');
    }
    const queue = [first];
    remaining.delete(first);
    while (queue.length > 0) {
      const current = queue.shift();
      const [x, y] = current.split(',').map(Number);
      for (const adjacent of [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`
      ]) {
        if (!remaining.delete(adjacent)) continue;
        queue.push(adjacent);
      }
    }
    if (remaining.size > 0) {
      fail(
        'V2 interlocking-loop intent requires connected required route centerlines; '
          + 'annotations do not establish route connectivity'
      );
    }
    const disjointApproaches = maximumVertexDisjointRoutePaths({
      routes: primaryRoutes,
      playerCells,
      opponentCells,
      limit: minimumApproaches,
      orderedEndpoints: minimumApproaches >= 3
    });
    if (disjointApproaches < minimumApproaches) {
      fail(
        'V2 interlocking-loop intent requires at least '
          + `${minimumApproaches} internally vertex-disjoint formation-to-formation `
          + 'route crossings; a shared articulation cell or edge is a choke point'
      );
    }
  }

  const requiredRouteEdges = new Map();
  for (const route of requiredRoutes) {
    for (let index = 1; index < route.cells.length; index += 1) {
      const key = undirectedEdgeKey(route.cells[index - 1], route.cells[index]);
      const routeIds = requiredRouteEdges.get(key) ?? new Set();
      routeIds.add(route.id);
      requiredRouteEdges.set(key, routeIds);
    }
  }
  for (const targetId of new Set(mixedElevationApproachTargets(sidecar))) {
    const target = blueprint.regions.find(region => region.id === targetId);
    if (!target) {
      fail(
        `V2 mixed slope/stair approach target ${targetId} requires a matching region`
      );
    }
    const targetCells = new Set(target.cells.map(cellKey));
    const portals = traversableConnections.filter(connection => (
      connection.bidirectional === true
      && ['slope', 'stairs'].includes(connection.kind)
      && (
        targetCells.has(cellKey(connection.from))
        !== targetCells.has(cellKey(connection.to))
      )
    )).map(connection => ({
      connection,
      routeIds:
        requiredRouteEdges.get(undirectedEdgeKey(connection.from, connection.to))
        ?? new Set()
    }));
    const hasIndependentMixedPair = portals.some(left => (
      portals.some(right => (
        left.connection.kind !== right.connection.kind
        && left.routeIds.size === 1
        && right.routeIds.size === 1
        && [...left.routeIds][0] !== [...right.routeIds][0]
        && ![
          cellKey(left.connection.from),
          cellKey(left.connection.to)
        ].some(key => (
          key === cellKey(right.connection.from)
          || key === cellKey(right.connection.to)
        ))
      ))
    ));
    if (!hasIndependentMixedPair) {
      fail(
        `V2 region ${targetId} requires separate required-route approaches: `
          + 'one natural slope portal and one vertex-disjoint stair portal'
      );
    }
  }

  const traversableElevationCrossings = new Map(
    traversableConnections
      .filter(connection => (
        connection.bidirectional === true
        && ['slope', 'stairs'].includes(connection.kind)
      ))
      .map(connection => [
        undirectedEdgeKey(connection.from, connection.to),
        connection
      ])
  );
  for (const route of requiredRoutes) {
    for (let index = 1; index < route.cells.length; index += 1) {
      const previous = route.cells[index - 1];
      const current = route.cells[index];
      const previousElevation = blueprint.elevation[previous.y][previous.x];
      const currentElevation = blueprint.elevation[current.y][current.x];
      if (previousElevation === currentElevation) continue;
      const crossing = traversableElevationCrossings.get(
        undirectedEdgeKey(previous, current)
      );
      if (crossing) continue;
      fail(
        `V2 required route ${route.id} index ${index} crosses elevation `
          + `${previous.x},${previous.y},z${previousElevation}->`
          + `${current.x},${current.y},z${currentElevation} without that exact `
          + 'undirected edge authored as a traversable bidirectional slope or stairs'
      );
    }
  }
  return blueprint;
}
