/**
 * Test Data Factories
 * Create test data for admin dashboard tests
 */

let idCounter = 0;

/**
 * Generate a unique ID
 */
export function generateId(prefix = 'test') {
  return `${prefix}_${++idCounter}`;
}

/**
 * Reset ID counter (call in beforeEach)
 */
export function resetIdCounter() {
  idCounter = 0;
}

/**
 * Create a tile asset
 */
export function createTileAsset(overrides = {}) {
  const id = overrides.id || generateId('tile');
  return {
    id,
    category: 'tiles',
    subcategory: 'floors',
    biome: 'forest',
    status: 'exists',
    file: `${id}.png`,
    path: `/assets/sprites/terrain/forest/${id}.png`,
    prompt: 'A forest floor tile with grass and fallen leaves',
    negativePrompt: 'text, watermark, blurry',
    needsRegeneration: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create a portrait asset
 */
export function createPortraitAsset(overrides = {}) {
  const id = overrides.id || generateId('portrait');
  return {
    id,
    category: 'portraits',
    race: 'human',
    gender: 'male',
    class: 'warrior',
    status: 'exists',
    file: `${id}.png`,
    path: `/assets/portraits/256/${id}.png`,
    prompt: 'A human male warrior portrait',
    negativePrompt: 'anime, cartoon, blurry',
    needsRegeneration: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create an item asset
 */
export function createItemAsset(overrides = {}) {
  const id = overrides.id || generateId('item');
  return {
    id,
    category: 'items',
    subcategory: 'weapons',
    itemType: 'sword',
    status: 'exists',
    file: `${id}.png`,
    path: `/assets/sprites/items/weapons/${id}.png`,
    prompt: 'A medieval sword icon',
    needsRegeneration: false,
    ...overrides
  };
}

/**
 * Create an icon asset
 */
export function createIconAsset(overrides = {}) {
  const id = overrides.id || generateId('icon');
  return {
    id,
    category: 'icons',
    subcategory: 'actions',
    status: 'exists',
    file: `${id}.png`,
    path: `/assets/sprites/icons/actions/${id}.png`,
    prompt: 'An action icon',
    needsRegeneration: false,
    ...overrides
  };
}

/**
 * Create a music asset
 */
export function createMusicAsset(overrides = {}) {
  const id = overrides.id || generateId('music');
  return {
    id,
    type: 'music',
    region: 'heartlands',
    subcategory: 'tavern',
    status: 'exists',
    path: `/assets/audio/music/regions/${id}.mp3`,
    prompt: 'A lively tavern tune with medieval instruments',
    duration: 180,
    variants: [],
    primaryVariant: null,
    needsRegeneration: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create an SFX asset
 */
export function createSfxAsset(overrides = {}) {
  const id = overrides.id || generateId('sfx');
  return {
    id,
    type: 'sfx',
    category: 'combat',
    subcategory: 'weapons',
    status: 'exists',
    path: `/assets/audio/sfx/combat/weapons/${id}.mp3`,
    prompt: 'Fantasy sword slash with metallic whoosh',
    duration: 1.5,
    needsRegeneration: false,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Create a generation job
 */
export function createGenerationJob(overrides = {}) {
  const id = overrides.id || generateId('job');
  return {
    id,
    category: 'tiles',
    filters: {},
    status: 'queued',
    progress: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    generatedAssets: [],
    ...overrides
  };
}

/**
 * Create an audio generation job
 */
export function createAudioJob(overrides = {}) {
  const id = overrides.id || generateId('audio_job');
  return {
    id,
    type: 'music',
    filters: {},
    status: 'queued',
    progress: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    generatedAssets: [],
    ...overrides
  };
}

/**
 * Create a backup entry
 */
export function createBackup(overrides = {}) {
  return {
    timestamp: new Date().toISOString(),
    reason: 'manual',
    size: 1024000 + Math.floor(Math.random() * 1000000),
    categories: ['tiles', 'portraits'],
    assetCount: 100,
    ...overrides
  };
}

/**
 * Create theme settings
 */
export function createTheme(overrides = {}) {
  return {
    primary: '#8B4513',
    secondary: '#D2691E',
    background: '#1a1a2e',
    surface: '#16213e',
    text: '#e4e4e4',
    accent: '#FFD700',
    error: '#DC143C',
    success: '#228B22',
    ...overrides
  };
}

/**
 * Create config
 */
export function createConfig(overrides = {}) {
  return {
    categories: ['tiles', 'portraits', 'items', 'icons', 'nodes'],
    audioTypes: ['music', 'sfx'],
    defaultModel: 'flux-pro',
    version: '1.0.0',
    ...overrides
  };
}

/**
 * Create stats
 */
export function createStats(overrides = {}) {
  return {
    tiles: { total: 100, existing: 75, missing: 25 },
    portraits: { total: 50, existing: 40, missing: 10 },
    items: { total: 30, existing: 30, missing: 0 },
    icons: { total: 20, existing: 15, missing: 5 },
    nodes: { total: 10, existing: 10, missing: 0 },
    ...overrides
  };
}

/**
 * Create audio stats
 */
export function createAudioStats(overrides = {}) {
  return {
    music: { total: 25, existing: 20, missing: 5 },
    sfx: { total: 100, existing: 80, missing: 20 },
    ...overrides
  };
}

/**
 * Create queue state
 */
export function createQueueState(overrides = {}) {
  return {
    current: null,
    pending: [],
    paused: false,
    stats: {
      pendingCount: 0,
      historyCount: 0,
      isProcessing: false
    },
    ...overrides
  };
}

/**
 * Create a list of assets for testing
 */
export function createAssetList(factory, count = 10, customizer = () => ({})) {
  return Array.from({ length: count }, (_, index) =>
    factory({ id: `${factory.name}_${index}`, ...customizer(index) })
  );
}

export default {
  generateId,
  resetIdCounter,
  createTileAsset,
  createPortraitAsset,
  createItemAsset,
  createIconAsset,
  createMusicAsset,
  createSfxAsset,
  createGenerationJob,
  createAudioJob,
  createBackup,
  createTheme,
  createConfig,
  createStats,
  createAudioStats,
  createQueueState,
  createAssetList
};
