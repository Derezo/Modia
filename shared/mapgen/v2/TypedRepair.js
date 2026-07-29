/**
 * Declarative, layer-complete repair operations for V2 candidates.
 *
 * A repair publishes replacement values for every affected layer and every
 * layer which can become stale because of that edit. This intentionally avoids
 * exposing a mutable candidate to repair callbacks.
 */

export const V2_REPAIR_LAYERS = Object.freeze([
  'terrain',
  'elevation',
  'elevationConnections',
  'obstacles',
  'spawnLayout',
  'variants',
  'transitions',
  'decorations',
  'features'
]);

export const DEFAULT_REPAIR_DEPENDENCIES = Object.freeze({
  terrain: Object.freeze([
    'elevation',
    'elevationConnections',
    'obstacles',
    'transitions',
    'features'
  ]),
  elevation: Object.freeze([
    'elevationConnections',
    'transitions',
    'features'
  ]),
  elevationConnections: Object.freeze(['transitions', 'features']),
  obstacles: Object.freeze(['features']),
  spawnLayout: Object.freeze(['features']),
  variants: Object.freeze([]),
  transitions: Object.freeze([]),
  decorations: Object.freeze([]),
  features: Object.freeze([])
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export class TypedRepairContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TypedRepairContractError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function normalizeLayerList(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypedRepairContractError(
      'REPAIR_LAYER_DECLARATION_INVALID',
      `${field} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`
    );
  }
  const result = [...new Set(value)];
  for (const layer of result) {
    if (!V2_REPAIR_LAYERS.includes(layer)) {
      throw new TypedRepairContractError(
        'REPAIR_LAYER_UNKNOWN',
        `Unknown V2 repair layer: ${layer}`,
        { field, layer }
      );
    }
  }
  return result.sort();
}

function validateDependencyGraph(dependencies) {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new TypedRepairContractError(
      'REPAIR_DEPENDENCY_GRAPH_INVALID',
      'Repair dependency graph must be an object'
    );
  }
  const normalized = {};
  for (const layer of V2_REPAIR_LAYERS) {
    const targets = dependencies[layer] ?? [];
    if (!Array.isArray(targets)) {
      throw new TypedRepairContractError(
        'REPAIR_DEPENDENCY_GRAPH_INVALID',
        `Dependencies for ${layer} must be an array`,
        { layer }
      );
    }
    normalized[layer] = [...new Set(targets)].sort();
    for (const target of normalized[layer]) {
      if (!V2_REPAIR_LAYERS.includes(target)) {
        throw new TypedRepairContractError(
          'REPAIR_LAYER_UNKNOWN',
          `Unknown V2 repair dependency: ${target}`,
          { layer, target }
        );
      }
    }
  }
  return normalized;
}

/**
 * Return the transitive layer dependencies of an edit in stable order.
 */
export function resolveRepairDependencies(
  affectedLayers,
  dependencies = DEFAULT_REPAIR_DEPENDENCIES
) {
  const graph = validateDependencyGraph(dependencies);
  const affected = normalizeLayerList(affectedLayers, 'affectedLayers');
  const required = new Set();
  const pending = [...affected];
  while (pending.length > 0) {
    const layer = pending.shift();
    for (const dependency of graph[layer]) {
      if (affected.includes(dependency) || required.has(dependency)) continue;
      required.add(dependency);
      pending.push(dependency);
    }
  }
  return Object.freeze([...required].sort());
}

/**
 * Validate and freeze a typed replacement edit.
 */
export function defineTypedRepair({
  id,
  type,
  affectedLayers,
  dependentLayers,
  updates,
  reason = null
}, {
  dependencies = DEFAULT_REPAIR_DEPENDENCIES
} = {}) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9:_-]*$/.test(id)) {
    throw new TypedRepairContractError(
      'REPAIR_ID_INVALID',
      'Repair id must be a stable lowercase identifier'
    );
  }
  if (typeof type !== 'string' || !/^[a-z][a-z0-9:_-]*$/.test(type)) {
    throw new TypedRepairContractError(
      'REPAIR_TYPE_INVALID',
      'Repair type must be a stable lowercase identifier'
    );
  }
  if (reason !== null && typeof reason !== 'string') {
    throw new TypedRepairContractError(
      'REPAIR_REASON_INVALID',
      'Repair reason must be a string or null'
    );
  }
  const affected = normalizeLayerList(affectedLayers, 'affectedLayers');
  const dependent = normalizeLayerList(
    dependentLayers,
    'dependentLayers',
    { allowEmpty: true }
  );
  const requiredDependencies = resolveRepairDependencies(affected, dependencies);
  const omittedDependencies = requiredDependencies.filter(
    layer => !dependent.includes(layer)
  );
  if (omittedDependencies.length > 0) {
    throw new TypedRepairContractError(
      'REPAIR_DEPENDENCY_OMITTED',
      `Repair ${id} omits dependent layers: ${omittedDependencies.join(', ')}`,
      { id, omittedDependencies }
    );
  }
  const unrelatedDependencies = dependent.filter(
    layer => !requiredDependencies.includes(layer)
  );
  if (unrelatedDependencies.length > 0) {
    throw new TypedRepairContractError(
      'REPAIR_DEPENDENCY_UNDECLARED',
      `Repair ${id} declares unrelated dependent layers: ${unrelatedDependencies.join(', ')}`,
      { id, unrelatedDependencies }
    );
  }
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new TypedRepairContractError(
      'REPAIR_UPDATES_INVALID',
      `Repair ${id} updates must be an object`,
      { id }
    );
  }
  const declared = new Set([...affected, ...dependent]);
  const updateLayers = Object.keys(updates).sort();
  const undeclaredUpdates = updateLayers.filter(layer => !declared.has(layer));
  if (undeclaredUpdates.length > 0) {
    throw new TypedRepairContractError(
      'REPAIR_UPDATE_UNDECLARED',
      `Repair ${id} updates undeclared layers: ${undeclaredUpdates.join(', ')}`,
      { id, undeclaredUpdates }
    );
  }
  const missingUpdates = [...declared].filter(layer => !(layer in updates)).sort();
  if (missingUpdates.length > 0) {
    throw new TypedRepairContractError(
      'REPAIR_UPDATE_MISSING',
      `Repair ${id} does not replace declared layers: ${missingUpdates.join(', ')}`,
      { id, missingUpdates }
    );
  }

  return deepFreeze({
    id,
    type,
    reason,
    affectedLayers: affected,
    dependentLayers: dependent,
    updates: { ...updates }
  });
}

/**
 * Apply a validated typed repair without mutating the input candidate.
 */
export function applyTypedRepair(candidate, repair, options = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypedRepairContractError(
      'REPAIR_CANDIDATE_INVALID',
      'Repair candidate must be an object'
    );
  }
  const validated = defineTypedRepair(repair, options);
  return {
    ...candidate,
    ...validated.updates
  };
}
