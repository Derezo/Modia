export const TERRAIN_GENERATION_VERSION = 2;
export const V2_GENERATOR_AVAILABLE = true;

export {
  generateBattleMapV2,
  normalizeBattleMapV2Request
} from './BattleMapGenerator.js';
export {
  V2_PRODUCTION_NODE_TYPES,
  getV2Recipe
} from './RecipeRegistry.js';
export {
  V2_RENDER_CAPABILITY_CATALOG,
  getV2VisualCapabilities
} from './RenderCapabilities.js';
export {
  ORGANIC_QUALITY_THRESHOLDS,
  evaluateOrganicQuality,
  measureOrganicQuality,
  validateHydrologyIntegrity
} from './OrganicQuality.js';
