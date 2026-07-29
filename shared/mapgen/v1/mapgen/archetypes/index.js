/**
 * Archetype System - Re-exports
 *
 * Provides curated map generation pipelines that replace random
 * algorithm selection with intentional, designed map archetypes.
 */

// Archetype definitions and utilities
export {
  ARCHETYPES,
  getArchetype,
  getArchetypeNames,
  getArchetypesByBaseTerrain,
  validateArchetypeDefinition
} from './archetypeDefinitions.js';

// Archetype selector for weighted selection
export {
  ArchetypeSelector,
  NODE_TYPE_ARCHETYPE_WEIGHTS,
  DEFAULT_ARCHETYPE_WEIGHTS,
  selectArchetypeForNode,
  getRecommendedArchetype,
  hasDefinedWeights
} from './ArchetypeSelector.js';

// Constraint definitions and utilities
export {
  DEFAULT_CONSTRAINTS,
  CONSTRAINT_PRESETS,
  getConstraints,
  validateConstraintConfig,
  getConstraint,
  strictenConstraints,
  relaxConstraints
} from './constraints.js';
