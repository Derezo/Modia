import test from 'node:test';
import assert from 'node:assert/strict';

import { createTraversalView } from '../../traversal.js';
import { deriveAttemptSeed } from './Determinism.js';
import {
  CandidateSelectionError,
  ValidationCheckRegistry,
  countVertexDisjointRoutes,
  createDefaultValidationRegistry,
  measureTraversalMetrics,
  runBoundedCandidateSelection,
  toCandidateValidationDiagnostics,
  validateV2Candidate
} from './Validation.js';
import {
  TypedRepairContractError,
  applyTypedRepair,
  defineTypedRepair,
  resolveRepairDependencies
} from './TypedRepair.js';

function grid(rows) {
  return rows.map(row => [...row].map(cell => cell === '.' ? 'grass' : 'rock'));
}

function view(rows) {
  const terrain = grid(rows);
  return createTraversalView({
    terrain,
    obstacles: terrain.map(row => row.map(() => null)),
    elevation: terrain.map(row => row.map(() => 0)),
    elevationConnections: terrain.map(row => row.map(() => null)),
    units: [],
    dimensions: { width: terrain[0].length, height: terrain.length }
  });
}

function candidateFor(rows) {
  const terrain = grid(rows);
  return {
    mapWidth: terrain[0].length,
    mapHeight: terrain.length,
    terrain,
    elevation: terrain.map(row => row.map(() => 0)),
    spawnLayout: {
      playerCapacity: 1,
      enemyCapacity: 1
    }
  };
}

test('vertex-capacitated graph reports three independent protected-zone routes', () => {
  const traversal = view([
    '.......',
    '#######',
    '.......',
    '#######',
    '.......'
  ]);
  const source = [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 0, y: 4 }];
  const target = [{ x: 6, y: 0 }, { x: 6, y: 2 }, { x: 6, y: 4 }];
  assert.equal(countVertexDisjointRoutes(traversal, source, target), 3);

  const metrics = measureTraversalMetrics({
    traversalView: traversal,
    sourceZone: source,
    targetZone: target,
    requiredRegions: [
      { id: 'north', cells: [{ x: 3, y: 0 }] },
      { id: 'middle', cells: [{ x: 3, y: 2 }] },
      { id: 'south', cells: [{ x: 3, y: 4 }] }
    ]
  });
  assert.equal(metrics.authoritativeConnected, true);
  assert.equal(metrics.routeDiversity, 3);
  assert.equal(metrics.requiredRegionReachability.allReachable, true);
  assert.equal(metrics.requiredRegionReachability.reachableCount, 3);
  assert.equal(metrics.usableTileCount, 21);
  assert.equal(metrics.usableAreaRatio, 0.6);
  assert.equal(metrics.detourRatio, 1);
  assert.equal(metrics.clearance.minimum, 1);
  assert.equal(metrics.clearance.chokeRatio, 1);
  assert.equal(metrics.deadEnds.accidental, 0);
});

test('one protected endpoint cannot inflate disjoint-route capacity', () => {
  const traversal = view([
    '...',
    '...',
    '...'
  ]);
  assert.equal(
    countVertexDisjointRoutes(
      traversal,
      [{ x: 0, y: 1 }],
      [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }]
    ),
    1
  );
});

test('metrics distinguish accidental branches and report competitive parity', () => {
  const branch = measureTraversalMetrics({
    traversalView: view([
      '#.#',
      '...',
      '###'
    ]),
    sourceZone: [{ x: 0, y: 1 }],
    targetZone: [{ x: 2, y: 1 }]
  });
  assert.equal(branch.deadEnds.accidental, 1);
  assert.deepEqual(branch.deadEnds.accidentalKeys, ['1,0']);

  const symmetricView = view([
    '.....',
    '.....',
    '.....'
  ]);
  const parity = measureTraversalMetrics({
    traversalView: symmetricView,
    sourceZone: [{ x: 0, y: 1 }],
    targetZone: [{ x: 4, y: 1 }],
    competitive: {
      sides: [[{ x: 0, y: 1 }], [{ x: 4, y: 1 }]],
      objectives: [{ x: 2, y: 1 }]
    }
  }).competitiveParity;
  assert.deepEqual(parity.approachDistances, [2, 2]);
  assert.equal(parity.approachParity, 1);
  assert.deepEqual(parity.lineOfSightCounts, [1, 1]);
  assert.equal(parity.lineOfSightParity, 1);
});

test('validator keeps hard, tactical, and quality results independent', () => {
  const rows = [
    '.....',
    '.....',
    '.....'
  ];
  const candidate = candidateFor(rows);
  const result = validateV2Candidate({
    candidate,
    traversalView: view(rows),
    sourceZone: [{ x: 0, y: 1 }],
    targetZone: [{ x: 4, y: 1 }],
    spawnRequirements: { playerCount: 1, enemyCapacity: 1 },
    palette: ['grass', 'rock'],
    constraints: {
      minRouteDiversity: 4,
      minUsableAreaRatio: 0.5
    }
  });
  assert.equal(result.hardValid, true);
  assert.equal(result.tacticalPass, false);
  assert.equal(result.qualityPass, true);
  assert.ok(result.qualityScore >= 0 && result.qualityScore <= 1);
  assert.equal(result.hardViolations.length, 0);
  assert.equal(result.tacticalViolations[0].code, 'ROUTE_DIVERSITY_LOW');
  assert.notStrictEqual(result.hardChecks, result.tacticalChecks);
  assert.notStrictEqual(result.tacticalChecks, result.qualityChecks);
});

test('natural organic checks are independent quality gates and reach diagnostics', () => {
  const rows = ['.....'];
  const constraints = { minRouteDiversity: 1 };
  const result = validateV2Candidate({
    candidate: candidateFor(rows),
    traversalView: view(rows),
    sourceZone: [{ x: 0, y: 0 }],
    targetZone: [{ x: 4, y: 0 }],
    constraints,
    recipe: {
      family: 'natural',
      hydrology: { kind: 'none' }
    }
  });
  const diagnostics = toCandidateValidationDiagnostics(result, constraints);

  assert.equal(result.hardValid, true);
  assert.equal(result.tacticalPass, true);
  assert.equal(result.qualityPass, false);
  assert.equal(result.qualityViolations[0].code, 'ORGANIC_QUALITY_LOW');
  assert.ok(diagnostics.qualityMetrics.metrics.some(metric =>
    metric.id === 'organic.material-dominance' && metric.passed === false
  ));
  assert.ok(diagnostics.qualityMetrics.metrics.some(metric =>
    metric.id === 'organic.hydrology-integrity' && metric.passed === true
  ));
});

test('closed diagnostics projection excludes graph internals and preserves result separation', () => {
  const rows = ['.....'];
  const constraints = { minRouteDiversity: 1, maxDetourRatio: 1.5 };
  const result = validateV2Candidate({
    candidate: candidateFor(rows),
    traversalView: view(rows),
    sourceZone: [{ x: 0, y: 0 }],
    targetZone: [{ x: 4, y: 0 }],
    constraints
  });
  const diagnostics = toCandidateValidationDiagnostics(result, constraints);
  assert.deepEqual(Object.keys(diagnostics), [
    'hardValidation',
    'tacticalValidation',
    'qualityMetrics'
  ]);
  assert.equal(diagnostics.hardValidation.valid, true);
  assert.equal(diagnostics.tacticalValidation.passed, true);
  assert.equal(diagnostics.qualityMetrics.score, result.qualityScore);
  assert.ok(diagnostics.qualityMetrics.metrics.every(metric =>
    Number.isFinite(metric.value) &&
    (metric.target === null || Number.isFinite(metric.target))
  ));
  assert.equal('graph' in diagnostics.qualityMetrics, false);
});

test('initial hard checks reject non-finite, palette, capacity, and connectivity faults', () => {
  const rows = [
    '..#',
    '..#',
    '..#'
  ];
  const candidate = candidateFor(rows);
  candidate.elevation[0][0] = Number.NaN;
  candidate.spawnLayout.playerCapacity = 0;
  const result = validateV2Candidate({
    candidate,
    traversalView: view(rows),
    sourceZone: [{ x: 0, y: 1 }],
    targetZone: [{ x: 2, y: 1 }],
    spawnRequirements: { playerCount: 1, enemyCapacity: 1 },
    palette: ['grass']
  });
  assert.equal(result.hardValid, false);
  assert.deepEqual(
    result.hardViolations.map(item => item.code),
    [
      'NON_FINITE_VALUE',
      'PALETTE_INVALID',
      'SPAWN_CAPACITY_INSUFFICIENT',
      'AUTHORITATIVE_CONNECTIVITY_MISSING'
    ]
  );
});

test('spawn capacity recognizes serialized north/south arena sides', () => {
  const rows = [
    '.....',
    '.....',
    '.....'
  ];
  const candidate = candidateFor(rows);
  candidate.spawnLayout = {
    slots: [
      { side: 'arena_north', x: 2, y: 0 },
      { side: 'arena_south', x: 2, y: 2 }
    ]
  };
  const result = validateV2Candidate({
    candidate,
    traversalView: view(rows),
    sourceZone: [{ x: 2, y: 0 }],
    targetZone: [{ x: 2, y: 2 }],
    spawnRequirements: { playerCount: 1, enemyCapacity: 1 },
    palette: ['grass', 'rock']
  });

  assert.equal(
    result.hardViolations.some(item => item.code === 'SPAWN_CAPACITY_INSUFFICIENT'),
    false
  );
});

test('check registry is extensible without changing result categories', () => {
  const registry = createDefaultValidationRegistry();
  registry.register({
    id: 'feature-contract',
    category: 'hard',
    evaluate: () => ({
      pass: false,
      code: 'FEATURE_CONTRACT_MISSING',
      message: 'fixture'
    })
  });
  assert.ok(registry instanceof ValidationCheckRegistry);
  const rows = ['...'];
  const result = validateV2Candidate({
    candidate: candidateFor(rows),
    traversalView: view(rows),
    sourceZone: [{ x: 0, y: 0 }],
    targetZone: [{ x: 2, y: 0 }],
    registry
  });
  assert.equal(result.hardValid, false);
  assert.equal(result.hardViolations.at(-1).code, 'FEATURE_CONTRACT_MISSING');
});

test('typed terrain repair must declare and replace every dependent layer', () => {
  const affectedLayers = ['terrain'];
  const dependentLayers = resolveRepairDependencies(affectedLayers);
  assert.deepEqual(dependentLayers, [
    'elevation',
    'elevationConnections',
    'features',
    'obstacles',
    'transitions'
  ]);
  assert.throws(
    () => defineTypedRepair({
      id: 'repair:bad',
      type: 'carve-route',
      affectedLayers,
      dependentLayers: ['elevation'],
      updates: { terrain: [['grass']], elevation: [[0]] }
    }),
    error => error instanceof TypedRepairContractError &&
      error.code === 'REPAIR_DEPENDENCY_OMITTED'
  );

  const updates = {
    terrain: [['grass']],
    elevation: [[0]],
    elevationConnections: [],
    obstacles: [],
    transitions: [],
    features: {
      regions: [],
      waterBodies: [],
      routes: [],
      clearings: [],
      structures: []
    }
  };
  const repair = defineTypedRepair({
    id: 'repair:route-01',
    type: 'carve-route',
    affectedLayers,
    dependentLayers,
    updates
  });
  const original = {
    terrain: [['rock']],
    elevation: [[2]],
    elevationConnections: [{ id: 'old' }],
    obstacles: [{ id: 'old' }],
    transitions: [{ id: 'old' }],
    features: { routes: [{ id: 'old' }] },
    untouched: true
  };
  const repaired = applyTypedRepair(original, repair);
  assert.notStrictEqual(repaired, original);
  assert.deepEqual(repaired.terrain, [['grass']]);
  assert.equal(repaired.untouched, true);
  assert.deepEqual(original.terrain, [['rock']]);
});

test('a leaf-layer repair may explicitly declare no dependent layers', () => {
  const repair = defineTypedRepair({
    id: 'repair:decorations-01',
    type: 'replace-decorations',
    affectedLayers: ['decorations'],
    dependentLayers: [],
    updates: { decorations: [] }
  });
  assert.deepEqual(repair.dependentLayers, []);
});

function fakeValidation({
  hardValid = true,
  tacticalPass = true,
  qualityPass = true,
  qualityScore = 0,
  routeDiversity = 1
} = {}) {
  return {
    hardValid,
    tacticalPass,
    qualityPass,
    qualityScore,
    hardViolations: hardValid ? [] : [{ code: 'HARD' }],
    tacticalViolations: tacticalPass ? [] : [{ code: 'TACTICAL' }],
    qualityViolations: qualityPass ? [] : [{ code: 'QUALITY' }],
    metrics: {
      routeDiversity,
      clearance: { minimum: 1 },
      usableAreaRatio: 0.5
    }
  };
}

test('bounded attempt ranking is deterministic and uses derived attempt seeds', async () => {
  const qualities = [0.3, 0.8, 0.5];
  const first = await runBoundedCandidateSelection({
    terrainSeed: 991,
    maxAttempts: 3,
    generateCandidate: ({ attempt, attemptSeed }) => ({
      id: `candidate:${attempt}`,
      attemptSeed
    }),
    validateCandidate: candidate => fakeValidation({
      qualityScore: qualities[Number(candidate.id.split(':')[1])]
    })
  });
  assert.equal(first.selected.attempt, 1);
  assert.deepEqual(
    first.attempts.map(item => item.attemptSeed),
    [0, 1, 2].map(attempt => deriveAttemptSeed(991, 2, attempt))
  );

  const second = await runBoundedCandidateSelection({
    terrainSeed: 991,
    maxAttempts: 3,
    generateCandidate: ({ attempt, attemptSeed }) => ({
      id: `candidate:${attempt}`,
      attemptSeed
    }),
    validateCandidate: candidate => fakeValidation({
      qualityScore: qualities[Number(candidate.id.split(':')[1])]
    })
  });
  assert.equal(second.selected.stableKey, first.selected.stableKey);
  assert.deepEqual(
    second.attempts.map(item => item.attemptSeed),
    first.attempts.map(item => item.attemptSeed)
  );
});

test('bounded selection can require the organic quality gate', async () => {
  const result = await runBoundedCandidateSelection({
    terrainSeed: 88,
    maxAttempts: 2,
    generateCandidate: ({ attempt }) => ({ id: `quality:${attempt}` }),
    validateCandidate: candidate => fakeValidation({
      qualityPass: candidate.id.endsWith(':1'),
      qualityScore: candidate.id.endsWith(':0') ? 1 : 0.5
    }),
    requireQualityPass: true
  });

  assert.equal(result.selected.attempt, 1);
});

test('exhausting bounded attempts fails with a stable explicit code', async () => {
  await assert.rejects(
    runBoundedCandidateSelection({
      terrainSeed: 14,
      maxAttempts: 2,
      generateCandidate: ({ attempt }) => ({ id: `bad:${attempt}` }),
      validateCandidate: () => fakeValidation({ tacticalPass: false })
    }),
    error => error instanceof CandidateSelectionError &&
      error.code === 'ATTEMPT_BUDGET_EXHAUSTED' &&
      error.attempts.length === 2
  );
});

test('a failed generation attempt is recorded and a later valid attempt can win', async () => {
  const result = await runBoundedCandidateSelection({
    terrainSeed: 15,
    maxAttempts: 2,
    generateCandidate: ({ attempt }) => {
      if (attempt === 0) {
        const error = new Error('stage failed');
        error.code = 'STAGE_ERROR';
        throw error;
      }
      return { id: 'good' };
    },
    validateCandidate: () => fakeValidation({ qualityScore: 0.5 })
  });
  assert.equal(result.attempts[0].error.code, 'STAGE_ERROR');
  assert.equal(result.attempts[0].validation.hardValid, false);
  assert.equal(result.selected.attempt, 1);
});
