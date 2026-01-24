#!/usr/bin/env node
/**
 * Regenerate Prompts Script
 * Updates metadata files to have clean base prompts (stripped of theme elements).
 * The theme wrapping happens at generation time via buildThemedPrompt().
 *
 * Usage:
 *   node scripts/ai-images/regenerate-prompts.js                    # Preview changes (dry-run)
 *   node scripts/ai-images/regenerate-prompts.js --apply            # Apply changes to metadata
 *   node scripts/ai-images/regenerate-prompts.js --category items   # Only process items
 *   node scripts/ai-images/regenerate-prompts.js --category tiles   # Only process tiles
 *
 * This script is used when changing themes - it strips theme elements from prompts,
 * leaving only the core asset descriptions. The generation scripts will wrap these
 * with theme at generation time.
 */

const path = require('path');
const {
  log,
  loadMetadata,
  saveMetadata,
  getMetadataDir,
  loadTheme
} = require('./lib');

/**
 * Theme elements to strip from prompts
 * These are patterns that should be removed to get the base description.
 * Order matters - more specific patterns should come before generic ones.
 */
const THEME_PATTERNS_TO_STRIP = [
  // Trigger words (must be first)
  /^GRPZA,?\s*/i,
  /^wbgmsst,?\s*/i,

  // Full style prefix blocks (legacy - these may contain multiple elements)
  /medieval fantasy illustration,?\s*ink and wash technique with watercolor fills,?\s*bold black outlines of medium weight,?\s*visible aged parchment texture( with slight yellowing)?,?\s*cozy nostalgic JRPG aesthetic,?\s*warm and inviting storybook quality,?\s*hand-drawn illustration style,?\s*/gi,

  // Style phrases (from theme.json)
  /ink and wash watercolor illustration,?\s*/gi,
  /ink and wash illustration,?\s*/gi,
  /ink and wash technique with watercolor fills,?\s*/gi,
  /ink and wash technique,?\s*/gi,
  /ink and wash style,?\s*/gi,
  /bold black outlines with watercolor fills,?\s*/gi,
  /bold black outlines of medium weight,?\s*/gi,
  /bold black outlines,?\s*/gi,
  /thick black outlines,?\s*/gi,
  /flat watercolor fills,?\s*/gi,
  /watercolor fills,?\s*/gi,
  /visible aged parchment texture with slight yellowing,?\s*/gi,
  /visible aged parchment texture,?\s*/gi,
  /aged parchment texture background,?\s*/gi,
  /aged parchment texture,?\s*/gi,
  /cozy nostalgic JRPG aesthetic,?\s*/gi,
  /cozy JRPG aesthetic,?\s*/gi,
  /warm and inviting storybook quality,?\s*/gi,
  /hand-drawn illustration style,?\s*/gi,
  /medieval fantasy illustration,?\s*/gi,

  // Size suffixes (various formats)
  /\d+x\d+ isometric diamond rhombus shape,?\s*/gi,
  /\d+x\d+ game (sprite|portrait|icon),?\s*/gi,
  /\d+x\d+ (sprite|portrait|icon),?\s*/gi,

  // Background suffixes
  /clean white background for cutout,?\s*/gi,
  /white background for cutout,?\s*/gi,
  /clean white background,?\s*/gi,
  /white background,?\s*/gi,

  // Item-specific theme elements
  /fantasy RPG consumable item sprite,?\s*/gi,
  /fantasy RPG consumables sprite,?\s*/gi,
  /fantasy RPG weapon sprite,?\s*/gi,
  /fantasy RPG armor sprite,?\s*/gi,
  /fantasy RPG \w+ sprite,?\s*/gi,

  // Node-specific theme elements
  /fantasy map landmark icon,?\s*/gi,
  /top-down stylized view,?\s*/gi,
  /miniature landmark style,?\s*/gi,
  /clear silhouette,?\s*/gi,

  // Portrait-specific theme elements
  /portrait bust shot facing forward,?\s*/gi,
  /portrait,?\s*bust shot facing forward,?\s*/gi,
  /bust shot facing forward,?\s*/gi,
  /portrait bust shot,?\s*/gi,
  /bust shot,?\s*/gi,
  /expressive eyes,?\s*/gi,

  // Icon-specific theme elements
  /action skill icon,?\s*/gi,
  /status effect icon,?\s*/gi,
  /menu UI icon,?\s*/gi,
  /augment upgrade icon,?\s*/gi,
  /game icon,?\s*/gi,
  /simplified bold design,?\s*/gi,
  /high contrast silhouette,?\s*/gi,
  /clean edges,?\s*/gi,

  // General style elements
  /slight 3D depth,?\s*/gi,

  // Rarity modifiers
  /golden glow legendary aura,?\s*/gi,
  /soft blue glow,?\s*/gi,
  /subtle glow,?\s*/gi,

  // Isometric style elements (for tiles)
  /isometric fantasy game asset,?\s*/gi,
  /isometric diamond floor tile texture,?\s*/gi,
  /flat surface only,?\s*/gi,
  /no walls no borders no raised edges,?\s*/gi,
  /no objects no trees no decorations,?\s*/gi,
  /seamless tileable game terrain,?\s*/gi,
  /top-down 3\/4 view,?\s*/gi
];

/**
 * Strip theme elements from a prompt to get the base description
 * @param {string} prompt - The prompt to strip
 * @returns {string} The base prompt without theme elements
 */
function stripThemeElements(prompt) {
  if (!prompt) return prompt;

  let cleaned = prompt;

  // Apply all stripping patterns
  for (const pattern of THEME_PATTERNS_TO_STRIP) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up extra commas and whitespace
  cleaned = cleaned
    .replace(/,\s*,/g, ',')        // Remove double commas
    .replace(/^\s*,\s*/g, '')      // Remove leading comma
    .replace(/\s*,\s*$/g, '')      // Remove trailing comma
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim();

  return cleaned;
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    apply: false,
    category: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          log(`Unknown option: ${arg}`, 'warn');
        }
    }
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Regenerate Prompts Script
Updates metadata files to have clean base prompts (stripped of theme elements).

Usage:
  node scripts/ai-images/regenerate-prompts.js [options]

Options:
  --apply           Apply changes to metadata files (default is dry-run)
  --category <cat>  Only process specific category (items, icons, portraits, nodes, tiles)
  --help, -h        Show this help message

Categories:
  items      - Weapon, armor, and consumable sprites
  icons      - Action, status, menu, and augment icons
  portraits  - Character portraits (race/gender/class combinations)
  nodes      - World map location icons
  tiles      - Terrain tiles (floors, walls, slopes)

Examples:
  # Preview all changes (dry-run)
  node scripts/ai-images/regenerate-prompts.js

  # Apply changes to all categories
  node scripts/ai-images/regenerate-prompts.js --apply

  # Only process items
  node scripts/ai-images/regenerate-prompts.js --category items

  # Apply changes to icons only
  node scripts/ai-images/regenerate-prompts.js --category icons --apply
`);
}

/**
 * Process items metadata
 * @param {boolean} apply - Whether to apply changes
 * @returns {Object} Results with counts and changes
 */
function processItems(apply) {
  const metadataDir = getMetadataDir();
  const categoryFiles = ['weapons.json', 'armor.json', 'consumables.json'];
  const results = { total: 0, changed: 0, changes: [] };

  for (const fileName of categoryFiles) {
    const filePath = path.join(metadataDir, 'items', fileName);
    const data = loadMetadata(filePath);

    if (!data || !data.items) {
      log(`Warning: Could not load ${fileName}`, 'warn');
      continue;
    }

    let fileChanged = false;

    for (const item of data.items) {
      results.total++;

      const original = item.prompt;
      const stripped = stripThemeElements(original);

      if (stripped !== original) {
        results.changed++;
        results.changes.push({
          category: 'items',
          file: fileName,
          id: item.id,
          original,
          stripped
        });
        fileChanged = true;
        item.prompt = stripped;
      }
    }

    if (apply && fileChanged) {
      saveMetadata(filePath, data);
      log(`Saved: items/${fileName}`, 'success');
    }
  }

  return results;
}

/**
 * Process icons metadata
 * @param {boolean} apply - Whether to apply changes
 * @returns {Object} Results with counts and changes
 */
function processIcons(apply) {
  const metadataDir = getMetadataDir();
  const categoryFiles = ['actions.json', 'status.json', 'menu.json', 'augments.json'];
  const results = { total: 0, changed: 0, changes: [] };

  for (const fileName of categoryFiles) {
    const filePath = path.join(metadataDir, 'icons', fileName);
    const data = loadMetadata(filePath);

    if (!data || !data.icons) {
      log(`Warning: Could not load ${fileName}`, 'warn');
      continue;
    }

    let fileChanged = false;

    for (const icon of data.icons) {
      results.total++;

      const original = icon.prompt;
      const stripped = stripThemeElements(original);

      if (stripped !== original) {
        results.changed++;
        results.changes.push({
          category: 'icons',
          file: fileName,
          id: icon.id,
          original,
          stripped
        });
        fileChanged = true;
        icon.prompt = stripped;
      }
    }

    if (apply && fileChanged) {
      saveMetadata(filePath, data);
      log(`Saved: icons/${fileName}`, 'success');
    }
  }

  return results;
}

/**
 * Process portraits metadata
 * Note: Portraits use trait composition, not direct prompts,
 * but we still check if any prompts exist and need cleaning
 * @param {boolean} apply - Whether to apply changes
 * @returns {Object} Results with counts and changes
 */
function processPortraits(apply) {
  const metadataDir = getMetadataDir();
  const filePath = path.join(metadataDir, 'portraits', 'combinations.json');
  const data = loadMetadata(filePath);
  const results = { total: 0, changed: 0, changes: [] };

  if (!data) {
    log('Warning: Could not load portraits/combinations.json', 'warn');
    return results;
  }

  // Check traits for theme elements
  const traitTypes = ['raceTraits', 'genderTraits', 'classTraits'];
  let fileChanged = false;

  for (const traitType of traitTypes) {
    const traits = data[traitType];
    if (!traits) continue;

    for (const [key, value] of Object.entries(traits)) {
      results.total++;

      const original = value;
      const stripped = stripThemeElements(original);

      if (stripped !== original) {
        results.changed++;
        results.changes.push({
          category: 'portraits',
          file: 'combinations.json',
          id: `${traitType}.${key}`,
          original,
          stripped
        });
        fileChanged = true;
        traits[key] = stripped;
      }
    }
  }

  // Also check if portraits have direct prompts
  for (const portrait of data.portraits || []) {
    if (portrait.prompt) {
      results.total++;

      const original = portrait.prompt;
      const stripped = stripThemeElements(original);

      if (stripped !== original) {
        results.changed++;
        results.changes.push({
          category: 'portraits',
          file: 'combinations.json',
          id: portrait.id,
          original,
          stripped
        });
        fileChanged = true;
        portrait.prompt = stripped;
      }
    }
  }

  if (apply && fileChanged) {
    saveMetadata(filePath, data);
    log('Saved: portraits/combinations.json', 'success');
  }

  return results;
}

/**
 * Process nodes metadata
 * @param {boolean} apply - Whether to apply changes
 * @returns {Object} Results with counts and changes
 */
function processNodes(apply) {
  const metadataDir = getMetadataDir();
  const filePath = path.join(metadataDir, 'nodes', 'locations.json');
  const data = loadMetadata(filePath);
  const results = { total: 0, changed: 0, changes: [] };

  if (!data || !data.nodes) {
    log('Warning: Could not load nodes/locations.json', 'warn');
    return results;
  }

  let fileChanged = false;

  for (const node of data.nodes) {
    results.total++;

    const original = node.prompt;
    const stripped = stripThemeElements(original);

    if (stripped !== original) {
      results.changed++;
      results.changes.push({
        category: 'nodes',
        file: 'locations.json',
        id: node.id,
        original,
        stripped
      });
      fileChanged = true;
      node.prompt = stripped;
    }
  }

  if (apply && fileChanged) {
    saveMetadata(filePath, data);
    log('Saved: nodes/locations.json', 'success');
  }

  return results;
}

/**
 * Process tiles metadata
 * @param {boolean} apply - Whether to apply changes
 * @returns {Object} Results with counts and changes
 */
function processTiles(apply) {
  const metadataDir = getMetadataDir();
  const categories = ['floors', 'walls', 'slopes'];
  const biomes = ['forest', 'cave', 'mountain', 'bridge', 'castle'];
  const results = { total: 0, changed: 0, changes: [] };

  for (const category of categories) {
    for (const biome of biomes) {
      const filePath = path.join(metadataDir, 'tiles', category, `${biome}.json`);
      const data = loadMetadata(filePath);

      if (!data || !data.tiles) {
        continue; // File may not exist for all combinations
      }

      let fileChanged = false;

      for (const tile of data.tiles) {
        results.total++;

        const original = tile.prompt;
        const stripped = stripThemeElements(original);

        if (stripped !== original) {
          results.changed++;
          results.changes.push({
            category: 'tiles',
            file: `${category}/${biome}.json`,
            id: tile.id || tile.key,
            original,
            stripped
          });
          fileChanged = true;
          tile.prompt = stripped;
        }
      }

      if (apply && fileChanged) {
        saveMetadata(filePath, data);
        log(`Saved: tiles/${category}/${biome}.json`, 'success');
      }
    }
  }

  // Also check the legacy top-level biome files
  for (const biome of biomes) {
    const filePath = path.join(metadataDir, 'tiles', `${biome}.json`);
    const data = loadMetadata(filePath);

    if (!data || !data.tiles) {
      continue;
    }

    let fileChanged = false;

    for (const tile of data.tiles) {
      results.total++;

      const original = tile.prompt;
      const stripped = stripThemeElements(original);

      if (stripped !== original) {
        results.changed++;
        results.changes.push({
          category: 'tiles',
          file: `${biome}.json`,
          id: tile.id || tile.key,
          original,
          stripped
        });
        fileChanged = true;
        tile.prompt = stripped;
      }
    }

    if (apply && fileChanged) {
      saveMetadata(filePath, data);
      log(`Saved: tiles/${biome}.json`, 'success');
    }
  }

  return results;
}

/**
 * Display changes for a category
 * @param {string} categoryName - Name of the category
 * @param {Object} results - Results from processing
 */
function displayCategoryResults(categoryName, results) {
  console.log(`\n${categoryName.toUpperCase()}`);
  console.log('='.repeat(50));
  console.log(`Total assets: ${results.total}`);
  console.log(`Changed: ${results.changed}`);
  console.log(`Unchanged: ${results.total - results.changed}`);

  if (results.changes.length > 0) {
    console.log('\nChanges:');
    for (const change of results.changes.slice(0, 10)) {
      console.log(`\n  ${change.id} (${change.file})`);
      console.log(`    Before: ${change.original.substring(0, 60)}...`);
      console.log(`    After:  ${change.stripped.substring(0, 60)}...`);
    }

    if (results.changes.length > 10) {
      console.log(`\n  ... and ${results.changes.length - 10} more changes`);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  log('Regenerate Prompts Script', 'info');
  log('='.repeat(30), 'info');

  // Load current theme for reference
  try {
    const theme = loadTheme();
    log(`Current theme: ${theme.name} (${theme.description})`, 'info');
  } catch (error) {
    log(`Warning: Could not load theme: ${error.message}`, 'warn');
  }

  if (!options.apply) {
    log('\nDRY RUN - No changes will be made. Use --apply to save changes.\n', 'warn');
  }

  const processors = {
    items: processItems,
    icons: processIcons,
    portraits: processPortraits,
    nodes: processNodes,
    tiles: processTiles
  };

  const categoriesToProcess = options.category
    ? [options.category]
    : Object.keys(processors);

  // Validate category
  if (options.category && !processors[options.category]) {
    log(`Unknown category: ${options.category}`, 'error');
    log(`Valid categories: ${Object.keys(processors).join(', ')}`, 'info');
    process.exit(1);
  }

  const allResults = {
    totalAssets: 0,
    totalChanged: 0,
    byCategory: {}
  };

  // Process each category
  for (const category of categoriesToProcess) {
    log(`\nProcessing ${category}...`, 'info');
    const results = processors[category](options.apply);

    allResults.byCategory[category] = results;
    allResults.totalAssets += results.total;
    allResults.totalChanged += results.changed;

    displayCategoryResults(category, results);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  log('SUMMARY', 'info');
  console.log('='.repeat(50));
  console.log(`Total assets processed: ${allResults.totalAssets}`);
  console.log(`Total prompts changed: ${allResults.totalChanged}`);
  console.log(`Total unchanged: ${allResults.totalAssets - allResults.totalChanged}`);

  if (options.apply) {
    log('\nChanges have been saved to metadata files.', 'success');
    log('Generation scripts will now wrap prompts with the current theme.', 'info');
  } else {
    console.log('\nTo apply these changes, run:');
    console.log('  npm run ai:regenerate-prompts -- --apply');
  }

  process.exit(0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
