/**
 * Metadata Utilities
 * Load and manage AI image generation metadata
 */

const path = require('path');
const { loadMetadata, saveMetadata, getMetadataDir, fileExists } = require('./imageUtils');

/**
 * Get the full path to a metadata file
 * @param {string} relativePath - Path relative to ai-image-metadata/
 * @returns {string} Absolute path
 */
function getMetadataPath(relativePath) {
  return path.join(getMetadataDir(), relativePath);
}

/**
 * Load the master manifest
 * @returns {Object|null} Master manifest or null if not found
 */
function loadMasterManifest() {
  return loadMetadata(getMetadataPath('manifest.json'));
}

/**
 * Load a category manifest
 * @param {string} category - Category name (tiles, portraits, items, icons, nodes)
 * @returns {Object|null} Category manifest or null if not found
 */
function loadCategoryManifest(category) {
  return loadMetadata(getMetadataPath(`${category}/manifest.json`));
}

/**
 * Load all assets for a category
 * @param {string} category - Category name
 * @returns {Object} Object with manifest and all asset data
 */
function loadCategoryAssets(category) {
  const manifest = loadCategoryManifest(category);
  if (!manifest) {
    throw new Error(`Failed to load ${category} manifest`);
  }

  const result = {
    manifest,
    assets: [],
    byId: {}
  };

  // Different categories have different file structures
  let files = [];

  if (category === 'tiles') {
    // New structure: categoryFiles with nested biome files
    if (manifest.categoryFiles) {
      for (const catFiles of Object.values(manifest.categoryFiles)) {
        for (const fileOrFiles of Object.values(catFiles)) {
          if (Array.isArray(fileOrFiles)) {
            files.push(...fileOrFiles);
          } else {
            files.push(fileOrFiles);
          }
        }
      }
    } else if (manifest.biomeFiles) {
      // Legacy fallback
      files = Object.values(manifest.biomeFiles);
    }
  } else if (category === 'portraits') {
    files = [manifest.combinationsFile || 'combinations.json'];
  } else if (manifest.categoryFiles) {
    files = Object.values(manifest.categoryFiles);
  } else if (manifest.locationFile) {
    files = [manifest.locationFile];
  }

  for (const file of files) {
    const data = loadMetadata(getMetadataPath(`${category}/${file}`));
    if (!data) {
      console.warn(`Warning: Failed to load ${category}/${file}`);
      continue;
    }

    // Get assets from the appropriate field
    const assetArray = data.tiles || data.portraits || data.items || data.icons || data.nodes || [];

    for (const asset of assetArray) {
      asset._sourceFile = file;
      asset._category = category;
      // Normalize id field for tiles that use 'key'
      if (asset.key && !asset.id) {
        asset.id = asset.key;
      }
      result.assets.push(asset);
      result.byId[asset.id] = asset;
    }
  }

  return result;
}

/**
 * Load all tile metadata by category and biome
 * @param {Object} options - Filter options
 * @param {string} options.biome - Optional biome filter
 * @param {string} options.category - Optional category filter (floors, walls, slopes)
 * @returns {Object} Tile data organized by category and biome
 */
function loadTileMetadata(options = {}) {
  // Support legacy usage: loadTileMetadata(biomeName)
  if (typeof options === 'string') {
    options = { biome: options };
  }

  const { biome, category } = options;

  const manifest = loadCategoryManifest('tiles');
  if (!manifest) {
    throw new Error('Failed to load tiles manifest');
  }

  const result = {
    manifest,
    tiles: [],
    byBiome: {},
    byCategory: {}
  };

  // New structure: categories array with nested biome files
  const categories = category
    ? [category]
    : (manifest.categories || ['floors', 'walls', 'slopes']);
  const biomes = biome
    ? [biome]
    : (manifest.biomes || ['forest', 'cave', 'mountain', 'bridge', 'castle']);

  for (const cat of categories) {
    result.byCategory[cat] = {};

    // Get the appropriate style prefix for this category
    const stylePrefix = cat === 'walls' ? manifest.wallStylePrefix
                      : cat === 'slopes' ? manifest.slopeStylePrefix
                      : manifest.stylePrefix;

    // Helper function to load tiles from a file
    const loadTilesFromFile = (fileName, biomeName) => {
      const filePath = getMetadataPath(`tiles/${fileName}`);

      if (!fileExists(filePath)) {
        return; // Skip if file doesn't exist
      }

      const data = loadMetadata(filePath);
      if (!data) {
        console.warn(`Warning: Failed to load tiles/${fileName}`);
        return;
      }

      // Initialize biome data if not exists
      if (!result.byBiome[biomeName]) {
        result.byBiome[biomeName] = { tiles: [], stylePrefix };
      }
      if (!result.byCategory[cat][biomeName]) {
        result.byCategory[cat][biomeName] = data;
      }

      // Process tiles from this file
      for (const tile of data.tiles || []) {
        tile._biome = biomeName;
        tile._category = 'tiles';
        tile._tileCategory = cat; // floors, walls, or slopes
        tile._sourceFile = fileName;
        tile.id = tile.key || tile.id;  // Normalize to 'id' field
        result.tiles.push(tile);
        result.byBiome[biomeName].tiles.push(tile);
      }
    };

    // Check if manifest has categoryFiles with explicit file mappings
    const catFiles = manifest.categoryFiles?.[cat];

    for (const biomeName of biomes) {
      // Check if categoryFiles has an explicit mapping for this biome
      if (catFiles && catFiles[biomeName]) {
        const fileOrFiles = catFiles[biomeName];
        if (Array.isArray(fileOrFiles)) {
          // Handle array of files
          for (const fileName of fileOrFiles) {
            loadTilesFromFile(fileName, biomeName);
          }
        } else {
          // Handle single file string
          loadTilesFromFile(fileOrFiles, biomeName);
        }
      } else {
        // Default convention: {cat}/{biomeName}.json
        loadTilesFromFile(`${cat}/${biomeName}.json`, biomeName);
      }
    }
  }

  // Legacy support: biomeFiles mapping for old callers
  result.manifest.biomeFiles = {};
  for (const biomeName of biomes) {
    if (result.byBiome[biomeName]?.tiles?.length > 0) {
      result.manifest.biomeFiles[biomeName] = `floors/${biomeName}.json`;
    }
  }

  return result;
}

/**
 * Load all portrait metadata
 * @param {Object} filters - Optional filters
 * @param {string} filters.type - Filter by type: 'player', 'enemy', or 'all' (default: 'all')
 * @param {string} filters.race - Filter player portraits by race
 * @param {string} filters.gender - Filter player portraits by gender
 * @param {string} filters.class - Filter player portraits by class (base or advanced)
 * @param {string} filters.advancedClass - Filter to specific advanced class
 * @param {string} filters.archetype - Filter enemy portraits by archetype
 * @param {string} filters.region - Filter enemy portraits by region
 * @returns {Object} Portrait data
 */
function loadPortraitMetadata(filters = {}) {
  const manifest = loadCategoryManifest('portraits');
  if (!manifest) {
    throw new Error('Failed to load portraits manifest');
  }

  const type = filters.type || 'all';
  // If player-specific filters are set, exclude enemies automatically
  const hasPlayerFilters = filters.race || filters.gender || filters.class || filters.advancedClass;
  const hasEnemyFilters = filters.archetype || filters.region;
  const includePlayer = (type === 'all' && !hasEnemyFilters) || type === 'player' || hasPlayerFilters;
  const includeEnemy = (type === 'all' && !hasPlayerFilters) || type === 'enemy' || hasEnemyFilters;

  const result = {
    manifest,
    raceTraits: {},
    genderTraits: {},
    classTraits: {},
    advancedClassTraits: {},
    archetypeTraits: {},
    regionTraits: {},
    portraits: []
  };

  // Load player portraits from combinations.json
  if (includePlayer) {
    const data = loadMetadata(getMetadataPath('portraits/combinations.json'));
    if (!data) {
      throw new Error('Failed to load portrait combinations');
    }

    result.raceTraits = data.raceTraits || {};
    result.genderTraits = data.genderTraits || {};
    result.classTraits = data.classTraits || {};
    result.advancedClassTraits = data.advancedClassTraits || {};

    for (const portrait of data.portraits || []) {
      // Apply filters
      if (filters.race && portrait.race !== filters.race) continue;
      if (filters.gender && portrait.gender !== filters.gender) continue;
      if (filters.class && portrait.class !== filters.class) continue;
      if (filters.advancedClass) {
        if (!portrait.isAdvanced || portrait.class !== filters.advancedClass) continue;
      }

      portrait._sourceFile = 'combinations.json';
      portrait._type = 'player';
      portrait._category = 'portraits';
      result.portraits.push(portrait);
    }
  }

  // Load enemy portraits from enemies.json
  if (includeEnemy) {
    const enemyData = loadMetadata(getMetadataPath('portraits/enemies.json'));
    if (enemyData) {
      result.archetypeTraits = enemyData.archetypeTraits || {};
      result.regionTraits = enemyData.regionTraits || {};

      for (const enemy of enemyData.enemies || []) {
        // Apply filters
        if (filters.archetype && enemy.archetype !== filters.archetype) continue;
        if (filters.region && enemy.region !== filters.region) continue;

        enemy._sourceFile = 'enemies.json';
        enemy._type = 'enemy';
        enemy._category = 'portraits';
        result.portraits.push(enemy);
      }
    }
  }

  return result;
}

/**
 * Load enemy portrait metadata only
 * @param {Object} filters - Optional filters
 * @param {string} filters.archetype - Filter by archetype (beast, humanoid, undead, elemental)
 * @param {string} filters.region - Filter by region (forest, cave, mountain, bridge, palace)
 * @returns {Object} Enemy portrait data
 */
function loadEnemyPortraitMetadata(filters = {}) {
  return loadPortraitMetadata({
    ...filters,
    type: 'enemy'
  });
}

/**
 * Load item metadata by category
 * @param {string} itemCategory - Optional item category filter (weapons, armor, consumables)
 * @returns {Object} Item data
 */
function loadItemMetadata(itemCategory = null) {
  const manifest = loadCategoryManifest('items');
  if (!manifest) {
    throw new Error('Failed to load items manifest');
  }

  const result = {
    manifest,
    items: [],
    byCategory: {}
  };

  const categoryFiles = manifest.categoryFiles || {};
  const categoriesToLoad = itemCategory
    ? { [itemCategory]: categoryFiles[itemCategory] }
    : categoryFiles;

  for (const [catName, fileName] of Object.entries(categoriesToLoad)) {
    if (!fileName) continue;

    const data = loadMetadata(getMetadataPath(`items/${fileName}`));
    if (!data) {
      console.warn(`Warning: Failed to load items/${fileName}`);
      continue;
    }

    result.byCategory[catName] = data;

    for (const item of data.items || []) {
      item._itemCategory = catName;
      item._sourceFile = fileName;
      item._category = 'items';
      result.items.push(item);
    }
  }

  return result;
}

/**
 * Load icon metadata by category
 * @param {string} iconCategory - Optional icon category filter (actions, status, menu, augments)
 * @returns {Object} Icon data
 */
function loadIconMetadata(iconCategory = null) {
  const manifest = loadCategoryManifest('icons');
  if (!manifest) {
    throw new Error('Failed to load icons manifest');
  }

  const result = {
    manifest,
    icons: [],
    byCategory: {}
  };

  const categoryFiles = manifest.categoryFiles || {};
  const categoriesToLoad = iconCategory
    ? { [iconCategory]: categoryFiles[iconCategory] }
    : categoryFiles;

  for (const [catName, fileName] of Object.entries(categoriesToLoad)) {
    if (!fileName) continue;

    const data = loadMetadata(getMetadataPath(`icons/${fileName}`));
    if (!data) {
      console.warn(`Warning: Failed to load icons/${fileName}`);
      continue;
    }

    result.byCategory[catName] = data;

    for (const icon of data.icons || []) {
      icon._iconCategory = catName;
      icon._sourceFile = fileName;
      icon._category = 'icons';
      result.icons.push(icon);
    }
  }

  return result;
}

/**
 * Load node metadata
 * @returns {Object} Node data
 */
function loadNodeMetadata() {
  const manifest = loadCategoryManifest('nodes');
  if (!manifest) {
    throw new Error('Failed to load nodes manifest');
  }

  const data = loadMetadata(getMetadataPath('nodes/locations.json'));
  if (!data) {
    throw new Error('Failed to load node locations');
  }

  const nodes = data.nodes || [];
  for (const node of nodes) {
    node._category = 'nodes';
    node._sourceFile = 'locations.json';
  }

  return {
    manifest,
    nodes
  };
}

/**
 * Load overlay metadata by subcategory
 * @param {string} subcategory - Optional subcategory filter ('rarity', 'augments', or null for all)
 * @returns {Object} Overlay data
 */
function loadOverlayMetadata(subcategory = null) {
  const result = {
    overlays: [],
    bySubcategory: {}
  };

  const subcategories = subcategory
    ? [subcategory]
    : ['rarity', 'augments'];

  for (const subcat of subcategories) {
    const filePath = getMetadataPath(`overlays/${subcat}.json`);
    if (!fileExists(filePath)) {
      console.warn(`Warning: Overlay file not found: overlays/${subcat}.json`);
      continue;
    }

    const data = loadMetadata(filePath);
    if (!data) {
      console.warn(`Warning: Failed to load overlays/${subcat}.json`);
      continue;
    }

    result.bySubcategory[subcat] = data;

    for (const overlay of data.overlays || []) {
      overlay._subcategory = subcat;
      overlay._sourceFile = `${subcat}.json`;
      overlay._category = 'overlays';
      result.overlays.push(overlay);
    }
  }

  return result;
}

/**
 * Update asset generation status in metadata
 * @param {string} category - Asset category
 * @param {string} sourceFile - Source JSON file name
 * @param {string} assetId - Asset ID to update
 * @param {Object} updates - Fields to update
 */
function updateAssetStatus(category, sourceFile, assetId, updates) {
  const filePath = getMetadataPath(`${category}/${sourceFile}`);
  const data = loadMetadata(filePath);

  if (!data) {
    console.error(`Failed to load ${category}/${sourceFile} for update`);
    return;
  }

  // Find the asset array (different names in different files)
  const assetArray = data.tiles || data.portraits || data.enemies || data.items || data.icons || data.nodes;

  if (!assetArray) {
    console.error(`No asset array found in ${category}/${sourceFile}`);
    return;
  }

  // Search by 'id' or 'key' (tiles use 'key' in JSON, normalized to 'id' at runtime)
  const assetIndex = assetArray.findIndex(a => a.id === assetId || a.key === assetId);
  if (assetIndex === -1) {
    console.error(`Asset ${assetId} not found in ${category}/${sourceFile}`);
    return;
  }

  // Apply updates
  Object.assign(assetArray[assetIndex], updates);

  // Save
  saveMetadata(filePath, data);
}

/**
 * Mark an asset as generated
 * @param {Object} asset - Asset object with _category, _sourceFile, and id
 */
function markAssetGenerated(asset) {
  updateAssetStatus(asset._category, asset._sourceFile, asset.id, {
    generated: true,
    generatedAt: new Date().toISOString()
  });
}

/**
 * Get generation statistics for a category
 * @param {string} category - Category name
 * @returns {Object} Statistics object
 */
function getCategoryStats(category) {
  const data = loadCategoryAssets(category);

  const stats = {
    total: data.assets.length,
    generated: 0,
    pending: 0
  };

  for (const asset of data.assets) {
    if (asset.generated) {
      stats.generated++;
    } else {
      stats.pending++;
    }
  }

  stats.percentComplete = stats.total > 0
    ? Math.round((stats.generated / stats.total) * 100)
    : 0;

  return stats;
}

/**
 * Get overall generation statistics
 * @returns {Object} Statistics for all categories
 */
function getAllStats() {
  const categories = ['tiles', 'portraits', 'items', 'icons', 'nodes'];
  const stats = {
    categories: {},
    total: { total: 0, generated: 0, pending: 0 }
  };

  for (const category of categories) {
    try {
      const catStats = getCategoryStats(category);
      stats.categories[category] = catStats;
      stats.total.total += catStats.total;
      stats.total.generated += catStats.generated;
      stats.total.pending += catStats.pending;
    } catch (error) {
      console.warn(`Warning: Failed to get stats for ${category}: ${error.message}`);
    }
  }

  stats.total.percentComplete = stats.total.total > 0
    ? Math.round((stats.total.generated / stats.total.total) * 100)
    : 0;

  return stats;
}

module.exports = {
  getMetadataPath,
  loadMasterManifest,
  loadCategoryManifest,
  loadCategoryAssets,
  loadTileMetadata,
  loadPortraitMetadata,
  loadEnemyPortraitMetadata,
  loadItemMetadata,
  loadIconMetadata,
  loadNodeMetadata,
  loadOverlayMetadata,
  updateAssetStatus,
  markAssetGenerated,
  getCategoryStats,
  getAllStats
};
