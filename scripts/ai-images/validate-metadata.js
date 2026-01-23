#!/usr/bin/env node
/**
 * AI Image Metadata Validation Script
 * Validates coverage of AI image metadata against game data sources
 *
 * Usage:
 *   node scripts/ai-images/validate-metadata.js              # Run all checks
 *   node scripts/ai-images/validate-metadata.js --fix        # Auto-add stub entries
 *   node scripts/ai-images/validate-metadata.js --check itemCoverage  # Specific check
 *
 * Checks:
 *   - itemCoverage: Item templates vs metadata
 *   - portraitCoverage: Race x gender x class combinations
 *   - nodeCoverage: World map node types
 *   - iconCoverage: Battle actions and status effects
 *   - promptQuality: Embedded theme phrases in prompts
 */

const path = require('path');
const {
  log,
  loadMetadata,
  saveMetadata,
  getProjectRoot,
  getMetadataDir,
  loadItemMetadata,
  loadPortraitMetadata,
  loadNodeMetadata,
  loadIconMetadata
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const METADATA_DIR = getMetadataDir();

// Theme phrases that should NOT be embedded in prompts
// These are added by the theme system at generation time
const EMBEDDED_THEME_PHRASES = [
  'wbgmsst',  // LoRA v2 trigger (current)
  'GRPZA',    // LoRA v1 trigger (legacy)
  'ink and wash',
  'watercolor',
  'parchment',
  'bold black outlines'
];

// Expected game constants (loaded dynamically where possible)
const EXPECTED_RACES = ['human', 'elf', 'dwarf', 'vampire', 'orc'];
const EXPECTED_GENDERS = ['male', 'female', 'other'];
const EXPECTED_BASE_CLASSES = ['warrior', 'wizard', 'monk', 'chemist'];

// Node types from worldgen constants
const EXPECTED_NODE_TYPES = [
  'castle', 'city', 'village', 'forest', 'cave', 'mountain', 'bridge',
  'guild', 'palace', 'keep', 'chest', 'shrine', 'discovery',
  'fishing_spot', 'merchant_caravan', 'ruins', 'watchtower', 'farm'
];

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    fix: false,
    check: null,
    verbose: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--fix':
        options.fix = true;
        break;
      case '--check':
        options.check = args[++i];
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
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
AI Image Metadata Validation Script
Validates coverage of AI image metadata against game data sources

Usage:
  node scripts/ai-images/validate-metadata.js [options]

Options:
  --fix              Auto-add stub entries for missing items
  --check <name>     Run specific check only
  --verbose, -v      Show detailed validation results
  --help, -h         Show this help message

Available Checks:
  itemCoverage       Item templates vs image metadata
  portraitCoverage   Race x gender x class combinations
  nodeCoverage       World map node types
  iconCoverage       Battle actions and status effects
  promptQuality      Embedded theme phrases in prompts

Examples:
  node scripts/ai-images/validate-metadata.js --fix
  node scripts/ai-images/validate-metadata.js --check promptQuality --verbose
`);
}

/**
 * Load item templates from the game source
 */
function loadItemTemplates() {
  try {
    // Dynamic import of ESM module from CommonJS
    const templatePath = path.join(PROJECT_ROOT, 'api/src/db/templates/items.js');
    // Read the file and extract item names (simple parse for CommonJS context)
    const fs = require('fs');
    const content = fs.readFileSync(templatePath, 'utf8');

    // Extract item names from the template array
    const itemNames = [];
    const nameRegex = /name:\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = nameRegex.exec(content)) !== null) {
      itemNames.push(match[1]);
    }

    return itemNames;
  } catch (error) {
    log(`Failed to load item templates: ${error.message}`, 'error');
    return [];
  }
}

/**
 * Check item coverage
 */
function checkItemCoverage(options) {
  const results = {
    name: 'itemCoverage',
    passed: true,
    total: 0,
    covered: 0,
    missing: [],
    extra: []
  };

  // Load game item templates
  const gameItems = loadItemTemplates();
  results.total = gameItems.length;

  // Load metadata items
  const metadataItems = loadItemMetadata();
  const metadataNames = new Set(metadataItems.items.map(i => i.name));

  // Check for missing items
  for (const itemName of gameItems) {
    if (metadataNames.has(itemName)) {
      results.covered++;
    } else {
      results.missing.push(itemName);
      results.passed = false;
    }
  }

  // Check for extra items in metadata (not necessarily bad, but informative)
  const gameItemSet = new Set(gameItems);
  for (const item of metadataItems.items) {
    if (!gameItemSet.has(item.name)) {
      results.extra.push(item.name);
    }
  }

  return results;
}

/**
 * Check portrait coverage (race x gender x class)
 */
function checkPortraitCoverage(options) {
  const results = {
    name: 'portraitCoverage',
    passed: true,
    total: 0,
    covered: 0,
    missing: [],
    extra: []
  };

  // Calculate expected combinations
  const expectedCombos = new Set();
  for (const race of EXPECTED_RACES) {
    for (const gender of EXPECTED_GENDERS) {
      for (const cls of EXPECTED_BASE_CLASSES) {
        expectedCombos.add(`${race}_${gender}_${cls}`);
      }
    }
  }
  results.total = expectedCombos.size;

  // Load portrait metadata
  const portraitData = loadPortraitMetadata();
  const metadataIds = new Set(portraitData.portraits.map(p => p.id));

  // Check for missing combinations
  for (const combo of expectedCombos) {
    if (metadataIds.has(combo)) {
      results.covered++;
    } else {
      results.missing.push(combo);
      results.passed = false;
    }
  }

  // Check for extra portraits (advanced classes, etc.)
  for (const portrait of portraitData.portraits) {
    if (!expectedCombos.has(portrait.id)) {
      results.extra.push(portrait.id);
    }
  }

  return results;
}

/**
 * Check node coverage
 */
function checkNodeCoverage(options) {
  const results = {
    name: 'nodeCoverage',
    passed: true,
    total: EXPECTED_NODE_TYPES.length,
    covered: 0,
    missing: [],
    extra: []
  };

  // Load node metadata
  const nodeData = loadNodeMetadata();
  const metadataIds = new Set(nodeData.nodes.map(n => n.id.replace('node_', '')));

  // Check for missing node types
  for (const nodeType of EXPECTED_NODE_TYPES) {
    if (metadataIds.has(nodeType)) {
      results.covered++;
    } else {
      results.missing.push(nodeType);
      results.passed = false;
    }
  }

  // Check for extra node types in metadata
  const expectedSet = new Set(EXPECTED_NODE_TYPES);
  for (const node of nodeData.nodes) {
    const nodeType = node.id.replace('node_', '');
    if (!expectedSet.has(nodeType)) {
      results.extra.push(nodeType);
    }
  }

  return results;
}

/**
 * Check icon coverage
 */
function checkIconCoverage(options) {
  const results = {
    name: 'iconCoverage',
    passed: true,
    categories: {},
    total: 0,
    covered: 0,
    missing: [],
    notes: []
  };

  // Load icon metadata
  const iconData = loadIconMetadata();

  // Track by category
  for (const [category, data] of Object.entries(iconData.byCategory)) {
    const catIcons = data.icons || [];
    results.categories[category] = {
      count: catIcons.length,
      icons: catIcons.map(i => i.id)
    };
    results.total += catIcons.length;
    results.covered += catIcons.length;
  }

  // Check for expected action icons
  const expectedActions = [
    'action_attack', 'action_defend', 'action_move', 'action_wait',
    'action_item', 'action_skill', 'action_flee'
  ];

  const actionIds = new Set(
    (iconData.byCategory.actions?.icons || []).map(i => i.id)
  );

  for (const action of expectedActions) {
    if (!actionIds.has(action)) {
      results.missing.push(action);
      results.passed = false;
    }
  }

  // Check for expected status icons
  const expectedStatus = [
    'status_poison', 'status_burn', 'status_freeze', 'status_stun',
    'status_sleep', 'status_blind', 'status_silence', 'status_slow'
  ];

  const statusIds = new Set(
    (iconData.byCategory.status?.icons || []).map(i => i.id)
  );

  for (const status of expectedStatus) {
    if (!statusIds.has(status)) {
      results.missing.push(status);
      results.passed = false;
    }
  }

  return results;
}

/**
 * Check prompt quality - ensure no embedded theme phrases
 */
function checkPromptQuality(options) {
  const results = {
    name: 'promptQuality',
    passed: true,
    total: 0,
    covered: 0,
    issues: [],
    byPhrase: {}
  };

  // Initialize tracking for each phrase
  for (const phrase of EMBEDDED_THEME_PHRASES) {
    results.byPhrase[phrase] = [];
  }

  // Check all categories
  const categories = [
    { name: 'items', load: loadItemMetadata, field: 'items', promptField: 'prompt' },
    { name: 'portraits', load: loadPortraitMetadata, field: 'portraits', promptField: 'prompt' },
    { name: 'nodes', load: loadNodeMetadata, field: 'nodes', promptField: 'prompt' },
    { name: 'icons', load: loadIconMetadata, field: 'icons', promptField: 'prompt' }
  ];

  for (const cat of categories) {
    try {
      const data = cat.load();
      const assets = data[cat.field] || [];

      for (const asset of assets) {
        results.total++;
        const prompt = asset[cat.promptField] || '';

        let hasIssue = false;
        for (const phrase of EMBEDDED_THEME_PHRASES) {
          if (prompt.toLowerCase().includes(phrase.toLowerCase())) {
            results.issues.push({
              category: cat.name,
              id: asset.id || asset.name,
              phrase,
              prompt: prompt.substring(0, 80) + (prompt.length > 80 ? '...' : '')
            });
            results.byPhrase[phrase].push(`${cat.name}/${asset.id || asset.name}`);
            results.passed = false;
            hasIssue = true;
          }
        }
        if (!hasIssue) {
          results.covered++;
        }
      }
    } catch (error) {
      log(`Warning: Failed to check ${cat.name}: ${error.message}`, 'warn');
    }
  }

  return results;
}

/**
 * Create stub entries for missing items
 */
function fixMissingItems(results, options) {
  if (!options.fix) return;

  // Fix missing items
  const itemResults = results.find(r => r.name === 'itemCoverage');
  if (itemResults && itemResults.missing.length > 0) {
    log(`Creating stub entries for ${itemResults.missing.length} missing items...`, 'info');

    // Determine which category file to update based on item name patterns
    for (const itemName of itemResults.missing) {
      const stub = {
        id: itemName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'),
        name: itemName,
        prompt: `TODO: Add prompt for ${itemName}`,
        rarity: 'common',
        seed: Math.floor(Math.random() * 90000) + 10000,
        generated: false
      };

      // Categorize by item type based on name keywords
      let category = 'consumables';
      const nameLower = itemName.toLowerCase();
      if (nameLower.includes('sword') || nameLower.includes('staff') ||
          nameLower.includes('axe') || nameLower.includes('wand') ||
          nameLower.includes('gloves') || nameLower.includes('wraps') ||
          nameLower.includes('knives') || nameLower.includes('fist') ||
          nameLower.includes('rod')) {
        category = 'weapons';
      } else if (nameLower.includes('armor') || nameLower.includes('mail') ||
                 nameLower.includes('robe') || nameLower.includes('helm') ||
                 nameLower.includes('boots') || nameLower.includes('coat') ||
                 nameLower.includes('tunic') || nameLower.includes('gi')) {
        category = 'armor';
      }

      // Load the category file
      const filePath = path.join(METADATA_DIR, 'items', `${category}.json`);
      const data = loadMetadata(filePath);
      if (data) {
        data.items = data.items || [];
        // Check if already exists
        if (!data.items.find(i => i.name === itemName)) {
          data.items.push(stub);
          saveMetadata(filePath, data);
          log(`  Added stub: ${itemName} -> items/${category}.json`, 'info');
        }
      }
    }
  }

  // Fix missing portraits
  const portraitResults = results.find(r => r.name === 'portraitCoverage');
  if (portraitResults && portraitResults.missing.length > 0) {
    log(`Creating stub entries for ${portraitResults.missing.length} missing portraits...`, 'info');

    const filePath = path.join(METADATA_DIR, 'portraits', 'combinations.json');
    const data = loadMetadata(filePath);
    if (data) {
      data.portraits = data.portraits || [];

      for (const combo of portraitResults.missing) {
        const [race, gender, cls] = combo.split('_');
        const stub = {
          id: combo,
          race,
          gender,
          class: cls,
          seed: Math.floor(Math.random() * 90000) + 10000,
          generated: false
        };

        if (!data.portraits.find(p => p.id === combo)) {
          data.portraits.push(stub);
          log(`  Added stub: ${combo}`, 'info');
        }
      }

      // Update total count
      data.totalCombinations = data.portraits.length;
      saveMetadata(filePath, data);
    }
  }

  // Fix missing nodes
  const nodeResults = results.find(r => r.name === 'nodeCoverage');
  if (nodeResults && nodeResults.missing.length > 0) {
    log(`Creating stub entries for ${nodeResults.missing.length} missing nodes...`, 'info');

    const filePath = path.join(METADATA_DIR, 'nodes', 'locations.json');
    const data = loadMetadata(filePath);
    if (data) {
      data.nodes = data.nodes || [];

      for (const nodeType of nodeResults.missing) {
        const stub = {
          id: `node_${nodeType}`,
          name: nodeType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          prompt: `TODO: Add prompt for ${nodeType}`,
          seed: Math.floor(Math.random() * 90000) + 40000,
          generated: false
        };

        if (!data.nodes.find(n => n.id === `node_${nodeType}`)) {
          data.nodes.push(stub);
          log(`  Added stub: node_${nodeType}`, 'info');
        }
      }

      saveMetadata(filePath, data);
    }
  }
}

/**
 * Print results table
 */
function printResultsTable(results) {
  console.log('');
  console.log('Metadata Coverage Summary');
  console.log('=========================');
  console.log('');

  // Calculate column widths
  const nameWidth = 20;
  const statusWidth = 8;
  const coverageWidth = 15;

  // Header
  console.log(
    'Check'.padEnd(nameWidth) +
    'Status'.padEnd(statusWidth) +
    'Coverage'.padEnd(coverageWidth) +
    'Details'
  );
  console.log('-'.repeat(70));

  // Results
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const statusColor = result.passed ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';

    const coverage = result.total > 0
      ? `${result.covered}/${result.total} (${Math.round((result.covered / result.total) * 100)}%)`
      : 'N/A';

    let details = '';
    if (result.missing && result.missing.length > 0) {
      details = `${result.missing.length} missing`;
    }
    if (result.issues && result.issues.length > 0) {
      details = `${result.issues.length} issues`;
    }

    console.log(
      result.name.padEnd(nameWidth) +
      `${statusColor}${status}${resetColor}`.padEnd(statusWidth + 9) +
      coverage.padEnd(coverageWidth) +
      details
    );
  }

  console.log('');
}

/**
 * Print detailed results
 */
function printDetailedResults(results, options) {
  if (!options.verbose) return;

  console.log('Detailed Results');
  console.log('================');

  for (const result of results) {
    if (result.passed && result.missing?.length === 0) continue;

    console.log('');
    console.log(`${result.name}:`);
    console.log('-'.repeat(40));

    if (result.missing && result.missing.length > 0) {
      console.log('  Missing:');
      const displayCount = Math.min(result.missing.length, 15);
      for (let i = 0; i < displayCount; i++) {
        console.log(`    - ${result.missing[i]}`);
      }
      if (result.missing.length > displayCount) {
        console.log(`    ... and ${result.missing.length - displayCount} more`);
      }
    }

    if (result.extra && result.extra.length > 0) {
      console.log('  Extra (in metadata but not in game):');
      const displayCount = Math.min(result.extra.length, 10);
      for (let i = 0; i < displayCount; i++) {
        console.log(`    - ${result.extra[i]}`);
      }
      if (result.extra.length > displayCount) {
        console.log(`    ... and ${result.extra.length - displayCount} more`);
      }
    }

    if (result.issues && result.issues.length > 0) {
      console.log('  Issues:');
      const displayCount = Math.min(result.issues.length, 10);
      for (let i = 0; i < displayCount; i++) {
        const issue = result.issues[i];
        console.log(`    - ${issue.category}/${issue.id}: contains "${issue.phrase}"`);
      }
      if (result.issues.length > displayCount) {
        console.log(`    ... and ${result.issues.length - displayCount} more`);
      }
    }

    if (result.byPhrase) {
      for (const [phrase, items] of Object.entries(result.byPhrase)) {
        if (items.length > 0) {
          console.log(`  Phrase "${phrase}": ${items.length} occurrences`);
        }
      }
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

  log('AI Image Metadata Validation', 'info');
  console.log('');

  // Define available checks
  const checks = {
    itemCoverage: checkItemCoverage,
    portraitCoverage: checkPortraitCoverage,
    nodeCoverage: checkNodeCoverage,
    iconCoverage: checkIconCoverage,
    promptQuality: checkPromptQuality
  };

  // Validate check name if specified
  if (options.check && !checks[options.check]) {
    log(`Unknown check: ${options.check}`, 'error');
    log(`Available checks: ${Object.keys(checks).join(', ')}`, 'info');
    process.exit(1);
  }

  // Run checks
  const checksToRun = options.check
    ? { [options.check]: checks[options.check] }
    : checks;

  const results = [];

  for (const [name, checkFn] of Object.entries(checksToRun)) {
    try {
      const result = checkFn(options);
      results.push(result);
    } catch (error) {
      log(`Error running ${name}: ${error.message}`, 'error');
      results.push({
        name,
        passed: false,
        error: error.message
      });
    }
  }

  // Print results
  printResultsTable(results);
  printDetailedResults(results, options);

  // Apply fixes if requested
  if (options.fix) {
    console.log('');
    log('Applying fixes...', 'info');
    fixMissingItems(results, options);
  }

  // Summary
  const allPassed = results.every(r => r.passed);
  const failCount = results.filter(r => !r.passed).length;

  console.log('');
  if (allPassed) {
    log('All checks passed!', 'success');
  } else {
    log(`${failCount} check(s) failed`, 'warn');
    if (!options.fix) {
      log('Run with --fix to auto-add stub entries for missing items', 'info');
    }
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
