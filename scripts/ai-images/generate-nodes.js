#!/usr/bin/env node
/**
 * World Map Node Generation Script
 * Generates world map node icons using local ComfyUI (default) or HuggingFace API
 *
 * Usage:
 *   node scripts/ai-images/generate-nodes.js                    # Generate using local ComfyUI
 *   node scripts/ai-images/generate-nodes.js --huggingface      # Use HuggingFace API instead
 *   node scripts/ai-images/generate-nodes.js --dry-run          # Preview
 *   node scripts/ai-images/generate-nodes.js --key node_castle  # Generate specific
 *   node scripts/ai-images/generate-nodes.js --force            # Regenerate existing
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required only for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const {
  loadNodeMetadata,
  markAssetGenerated,
  generateNode,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  buildThemedPrompt,
  createBackup
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/nodes');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    key: null,
    force: false,
    backup: false,
    region: null,
    local: true,     // Local ComfyUI is now the default
    huggingface: false,
    verbose: false,
    quiet: false,
    delay: 2000,  // Default 2 second delay between requests
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--key':
        options.key = args[++i];
        break;
      case '--force':
        options.force = true;
        break;
      case '--backup':
        options.backup = true;
        break;
      case '--region':
        options.region = args[++i];
        break;
      case '--huggingface':
      case '--hf':
        options.huggingface = true;
        options.local = false;  // Disable local when using HuggingFace
        break;
      case '--local':
        // Explicit local flag (already default, but kept for clarity)
        options.local = true;
        options.huggingface = false;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--quiet':
      case '-q':
        options.quiet = true;
        break;
      case '--delay':
        options.delay = parseInt(args[++i], 10);
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
World Map Node Generation Script
Generates world map node icons using local ComfyUI (default) or HuggingFace API

Usage:
  node scripts/ai-images/generate-nodes.js [options]

Options:
  --dry-run           Show what would be generated without calling APIs
  --key <id>          Generate specific node (e.g., node_castle)
  --force             Regenerate even if file exists
  --backup            Create backup of existing images before regenerating
  --region <name>     Apply regional theme to prompts (e.g., heartlands, shadowmere)
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --verbose, -v       Show detailed output including full prompt construction
  --quiet, -q         Suppress all output except errors
  --delay <ms>        Delay between requests in milliseconds (default: 2000)
  --help, -h          Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-nodes.js --dry-run
  node scripts/ai-images/generate-nodes.js --key node_castle --force
  node scripts/ai-images/generate-nodes.js --force --backup
  node scripts/ai-images/generate-nodes.js --region shadowmere
  node scripts/ai-images/generate-nodes.js --huggingface  # Use HF API
`);
}

/**
 * Get the output path for a node
 */
function getOutputPath(node) {
  return path.join(OUTPUT_DIR, `${node.id}.png`);
}

/**
 * Check if a node needs generation
 */
function needsGeneration(node, options) {
  if (options.force) return true;
  if (node.generated) return false;
  return !fileExists(getOutputPath(node));
}

/**
 * Filter nodes based on CLI options
 */
function filterNodes(nodes, options) {
  let filtered = nodes;

  if (options.key) {
    filtered = filtered.filter(n => n.id === options.key);
  }

  return filtered;
}

/**
 * Validate required environment variables
 */
function validateEnvVars(options) {
  if (options.dryRun) return;

  // Only require HuggingFace token when using HuggingFace mode
  if (options.huggingface && !process.env.HUGGINGFACE_API_TOKEN) {
    log('Missing HUGGINGFACE_API_TOKEN in environment', 'error');
    log('Set it with: export HUGGINGFACE_API_TOKEN=hf_xxx', 'info');
    log('Or use local generation (default): remove --huggingface flag', 'info');
    process.exit(1);
  }

  // Warn about IMAGE_GENERATOR_ROOT for local mode
  if (options.local && !process.env.IMAGE_GENERATOR_ROOT) {
    log('IMAGE_GENERATOR_ROOT not set, will try default paths', 'warn');
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

  validateEnvVars(options);

  log('World Map Node Generation Script', 'info');
  log('================================', 'info');

  // Load metadata
  let metadata;
  try {
    metadata = loadNodeMetadata();
    log(`Loaded ${metadata.nodes.length} nodes`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter nodes
  const filteredNodes = filterNodes(metadata.nodes, options);
  log(`Filtered to ${filteredNodes.length} nodes`, 'info');

  // Determine which need generation
  const nodesToGenerate = filteredNodes.filter(n =>
    needsGeneration(n, options)
  );
  const skipped = filteredNodes.length - nodesToGenerate.length;

  if (skipped > 0) {
    log(`Skipping ${skipped} nodes (already exist or generated)`, 'info');
  }

  if (nodesToGenerate.length === 0) {
    log('No nodes need generation', 'success');
    process.exit(0);
  }

  log(`\nNodes to generate: ${nodesToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const node of nodesToGenerate) {
    const prompt = buildThemedPrompt('nodes', node.prompt, {
      region: options.region || null,
      skipTrigger: true  // Python script adds trigger
    });

    console.log(`  - ${node.id}`);
    console.log(`    Name: ${node.name}`);
    console.log(`    Output: ${getOutputPath(node)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${prompt}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${nodesToGenerate.length} nodes.`, 'success');
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    const backupResult = createBackup(nodesToGenerate, { reason: 'category regeneration' });
    if (backupResult.success) {
      log(`Backup created: ${backupResult.backupDir}`, 'success');
      log(`Backed up ${backupResult.assetCount} assets`, 'info');
    } else {
      log(`Backup failed: ${backupResult.error}`, 'warn');
    }
  }

  // Ensure output directory exists
  ensureDirectoryExists(OUTPUT_DIR);

  // Generate nodes
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < nodesToGenerate.length; i++) {
    const node = nodesToGenerate[i];

    log(`[${i + 1}/${nodesToGenerate.length}] Generating: ${node.id}`, 'info');

    try {
      const prompt = buildThemedPrompt('nodes', node.prompt, {
        region: options.region || null,
        skipTrigger: true  // Python script adds trigger
      });

      const result = await generateNode({
        prompt: prompt,
        key: node.id,
        seed: node.seed
      }, {
        verbose: options.verbose,
        quiet: options.quiet,
        local: options.local,
        huggingface: options.huggingface
      });

      if (result.success) {
        results.success.push({ id: node.id, node });

        node._category = 'nodes';
        node._sourceFile = 'locations.json';
        markAssetGenerated(node);

        log(`Generated: ${node.id}`, 'success');
      } else {
        results.failed.push({
          id: node.id,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${node.id}`, 'error');
      }

      // Rate limit delay
      if (i < nodesToGenerate.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }
    } catch (error) {
      log(`Failed to generate ${node.id}: ${error.message}`, 'error');
      results.failed.push({ id: node.id, error: error.message });
    }
  }

  // Summary
  console.log('\n========================================');
  log('Generation Summary', 'info');
  console.log('========================================');
  console.log(`  Success: ${results.success.length}`);
  console.log(`  Failed:  ${results.failed.length}`);
  console.log('');

  if (results.failed.length > 0) {
    log('Failed nodes:', 'error');
    for (const item of results.failed) {
      console.log(`  - ${item.id}: ${item.error}`);
    }
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
