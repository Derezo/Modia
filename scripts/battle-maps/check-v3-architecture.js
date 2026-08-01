#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_PATH, '../../..');
const SELF_PATH = 'scripts/battle-maps/check-v3-architecture.js';
export const V3_PRODUCTION_SELECTOR_PATH = 'shared/battleMap/BattleMapV3Selector.js';
export const V3_TRACKED_CATALOG_RUNTIME_PATH =
  'api/src/services/battle/BattleMapV3CatalogRuntime.js';
export const V3_BATTLE_MAP_GENERATION_SERVICE_PATH =
  'api/src/services/battle/battleMapGenerationService.js';
const SOURCE_EXTENSIONS = new Set([
  '.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'
]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  'docs',
  'fixtures',
  'generated',
  'node_modules',
  'test',
  'tests',
  '__tests__'
]);
const OFFLINE_TOOL_TERMS = /(?:^|[-_.])(approve|approval|audit|candidate|compare|comparison|generate|generation|preview|rehearsal|validate|validation)(?:[-_.]|$)/i;
const FEATURE_FLAG_PROVIDER = /(?:launchdarkly|openfeature|unleash|splitio|growthbook|flagsmith|configcat|flipt|feature[-_/]?flags?|featureFlagProvider)/i;
const CONFIG_PROVIDER = /(?:^|[/_.-])(?:app[-_]?config|config(?:uration)?|config[-_]?provider|runtime[-_]?config|runtime[-_]?settings|settings)(?:[/_.-]|$)/i;
const FLAG_CONTROL_NAME = /(?:battlemapv3enabled|enabledprofiles|activationprofile|featureflags?|flagprovider|getflag|isfeatureenabled|isenabled|variation|evaluateflag|rollout|toggle|killswitch|fallback(?:mode|enabled))/i;
const CONFIG_READ_METHOD = /^(?:get|getboolean|read|resolve|value)$/i;

export const V3_ARCHITECTURE_CHECKER_ALLOWLIST = Object.freeze({
  [SELF_PATH]: 'The checker must contain the prohibited spellings it detects.'
});

function slashPath(path) {
  return path.split(sep).join('/');
}

/**
 * Tests and non-production/generated content are outside this architecture
 * boundary. The checker itself is the only production-source allowlist entry.
 */
export function isProductionSourcePath(filePath) {
  const normalized = slashPath(filePath).replace(/^\.\//, '');
  if (normalized === SELF_PATH) return false;
  if (!SOURCE_EXTENSIONS.has(extname(normalized).toLowerCase())) return false;
  const parts = normalized.split('/');
  if (parts.some(part => EXCLUDED_DIRECTORY_NAMES.has(part))) return false;
  const basename = parts.at(-1);
  if (/(?:^|[.-])(?:spec|test)(?=\.)/i.test(basename)) return false;
  if (/(?:^|[.-])generated(?=\.)/i.test(basename)) return false;
  return true;
}

function maskComments(source) {
  let result = '';
  let state = 'code';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        result += '\n';
      } else {
        result += ' ';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  ';
        index += 1;
        state = 'code';
      } else {
        result += char === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (
        (state === 'single-quote' && char === "'")
        || (state === 'double-quote' && char === '"')
        || (state === 'template' && char === '`')
      ) {
        state = 'code';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      result += '  ';
      index += 1;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      result += '  ';
      index += 1;
      state = 'block-comment';
    } else {
      result += char;
      if (char === "'") state = 'single-quote';
      else if (char === '"') state = 'double-quote';
      else if (char === '`') state = 'template';
    }
  }
  return result;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function excerptAt(source, line) {
  return source.split('\n')[line - 1]?.trim().slice(0, 240) ?? '';
}

function v3Module(filePath, source) {
  return /v3(?:[/_.-]|$)/i.test(slashPath(filePath))
    || /(?:BattleMapV3|battleMapV3|battle-map-v3)/.test(source)
    || /\bbattleMapSchemaVersion\s*[:=]\s*3\b/.test(source);
}

function offlineTool(filePath) {
  const normalized = slashPath(filePath);
  return normalized.startsWith('scripts/')
    && OFFLINE_TOOL_TERMS.test(normalized);
}

function compact(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function flagControlName(value) {
  return typeof value === 'string' && FLAG_CONTROL_NAME.test(compact(value));
}

function configActivationValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = compact(value);
  return flagControlName(normalized)
    || normalized === 'battlemapv3'
    || normalized === 'authoredmaps';
}

function addViolation(violations, seen, source, filePath, index, code, message) {
  const line = lineNumberAt(source, index);
  const identity = `${code}:${line}`;
  if (seen.has(identity)) return;
  seen.add(identity);
  violations.push(Object.freeze({
    code,
    filePath,
    line,
    message,
    excerpt: excerptAt(source, line)
  }));
}

function matchAll(source, pattern) {
  return [...source.matchAll(pattern)];
}

function parseAst(source) {
  try {
    return espree.parse(source, {
      ecmaFeatures: { jsx: true },
      ecmaVersion: 'latest',
      range: true,
      sourceType: 'module'
    });
  } catch {
    // Keep the lexical checks as a conservative fallback for TS syntax and
    // proposal syntax that Espree deliberately does not parse.
    return null;
  }
}

function astNodes(ast) {
  if (!ast) return [];
  const nodes = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.type === 'string') nodes.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'parent' || key === 'range' || key === 'loc') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(ast);
  return nodes;
}

function unwrapChain(node) {
  return node?.type === 'ChainExpression' ? node.expression : node;
}

function staticPropertyName(node) {
  const value = unwrapChain(node);
  if (!value) return null;
  if (!value.computed && value.property?.type === 'Identifier') {
    return value.property.name;
  }
  if (value.computed && value.property?.type === 'Literal'
    && typeof value.property.value === 'string') {
    return value.property.value;
  }
  if (value.computed && value.property?.type === 'TemplateLiteral'
    && value.property.expressions.length === 0) {
    return value.property.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function literalString(node) {
  const value = unwrapChain(node);
  if (value?.type === 'Literal' && typeof value.value === 'string') return value.value;
  if (value?.type === 'TemplateLiteral' && value.expressions.length === 0) {
    return value.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function localPatternNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'AssignmentPattern') return localPatternNames(pattern.left);
  if (pattern.type === 'RestElement') return localPatternNames(pattern.argument);
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.flatMap(property => (
      property.type === 'RestElement'
        ? localPatternNames(property.argument)
        : localPatternNames(property.value)
    ));
  }
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(localPatternNames);
  return [];
}

function objectPatternProperties(pattern) {
  if (pattern?.type !== 'ObjectPattern') return [];
  return pattern.properties.flatMap(property => {
    if (property.type !== 'Property') return [];
    const imported = property.computed
      ? literalString(property.key)
      : property.key?.name ?? property.key?.value;
    return localPatternNames(property.value).map(local => ({ imported, local }));
  });
}

function nodeIndex(node) {
  return node?.range?.[0] ?? 0;
}

const ENV_ACCESS_PATTERNS = Object.freeze([
  /\b(?:process|Bun)\s*\.\s*env\s*(?:\.|\?\.)\s*[A-Za-z_$][\w$]*/g,
  /\b(?:process|Bun)\s*\.\s*env\s*(?:\?\.)?\s*\[\s*(['"`])[^'"`\]]+\1\s*\]/g,
  /\bimport\s*\.\s*meta\s*\.\s*env\s*(?:\.|\?\.)\s*[A-Za-z_$][\w$]*/g,
  /\bimport\s*\.\s*meta\s*\.\s*env\s*(?:\?\.)?\s*\[\s*(['"`])[^'"`\]]+\1\s*\]/g,
  /\b(?:Deno\s*\.\s*env\s*\.\s*(?:get|has)|getenv)\s*\(\s*(['"`])[^'"`]+\1\s*\)/g
]);

function envAccesses(source) {
  return ENV_ACCESS_PATTERNS.flatMap(pattern => matchAll(source, pattern));
}

function envWindow(source, index, radius = 280) {
  return source.slice(
    Math.max(0, index - radius),
    Math.min(source.length, index + radius)
  );
}

function checkEnvironmentReads(source, filePath, violations, seen) {
  const sourceIsV3Module = v3Module(filePath, source);
  const accesses = envAccesses(source);
  for (const match of accesses) {
    const access = match[0];
    const window = envWindow(source, match.index);
    if (/BATTLE_MAP_V3_[A-Z0-9_]+/i.test(access)) {
      addViolation(
        violations,
        seen,
        source,
        filePath,
        match.index,
        'v3-specific-environment',
        'V3 activation must not read BATTLE_MAP_V3_* environment variables'
      );
      continue;
    }

    const normalizedAccess = compact(access);
    const normalizedWindow = compact(window);
    const battleMapActivationKey = /battlemap(?:v3|version|enabled|active|activation|rollout|catalog|profile|fallback)/.test(
      normalizedAccess
    );
    const v3ActivationWindow = normalizedWindow.includes('v3')
      && /(?:active|activate|activation|enable|fallback|flag|killswitch|rollout|shadow|toggle)/.test(
        normalizedWindow
      );
    const activationInV3Module = sourceIsV3Module
      && /(?:active|activate|activation|enable|fallback|flag|killswitch|profile|rollout|shadow|toggle|version)/.test(
        normalizedWindow
      )
      && /(?:authored|battlemap|catalog|mapselection|mapversion|profile)/.test(
        normalizedWindow
      );
    if (battleMapActivationKey || v3ActivationWindow || activationInV3Module) {
      addViolation(
        violations,
        seen,
        source,
        filePath,
        match.index,
        'environment-derived-v3-activation',
        'BattleMap V3 activation or version selection must not derive from environment configuration'
      );
    }
  }

  for (const match of matchAll(
    source,
    /\{[^}\n]*\bBATTLE_MAP_V3_[A-Z0-9_]+\b[^}\n]*\}\s*=\s*(?:process|Bun)\s*\.\s*env\b/gi
  )) {
    addViolation(
      violations,
      seen,
      source,
      filePath,
      match.index,
      'v3-specific-environment',
      'V3 activation must not destructure BATTLE_MAP_V3_* environment variables'
    );
  }
}

function checkLexicalEnvironmentAliases(source, filePath, violations, seen) {
  const aliases = new Set();
  const declarationPatterns = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;\n]+)?\s*=\s*(?:process|Bun)\s*(?:\?\.|\.)\s*env\b/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;\n]+)?\s*=\s*(?:process|Bun)\s*(?:\?\.)?\s*\[\s*(['"`])env\2\s*\]/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;\n]+)?\s*=\s*import\s*\.\s*meta\s*\.\s*env\b/g
  ];
  for (const pattern of declarationPatterns) {
    for (const match of matchAll(source, pattern)) aliases.add(match[1]);
  }
  for (const match of matchAll(
    source,
    /\b(?:const|let|var)\s*\{\s*env\s*(?::\s*([A-Za-z_$][\w$]*))?[^}\n]*\}\s*=\s*(?:process|Bun)\b/g
  )) {
    aliases.add(match[1] ?? 'env');
  }
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let changed = true;
  while (changed) {
    changed = false;
    for (const alias of [...aliases]) {
      const pattern = new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)(?:\\s*:[^=;\\n]+)?\\s*=\\s*${escaped(alias)}\\b`,
        'g'
      );
      for (const match of matchAll(source, pattern)) {
        if (!aliases.has(match[1])) {
          aliases.add(match[1]);
          changed = true;
        }
      }
    }
  }
  for (const alias of aliases) {
    const name = escaped(alias);
    const patterns = [
      new RegExp(`\\b${name}\\s*(?:\\?\\.|\\.)\\s*(BATTLE_MAP_V3_[A-Z0-9_]+)\\b`, 'gi'),
      new RegExp(`\\b${name}\\s*(?:\\?\\.)?\\s*\\[\\s*(['"\`])(BATTLE_MAP_V3_[A-Z0-9_]+)\\1\\s*\\]`, 'gi'),
      new RegExp(`\\{[^}\\n]*\\b(BATTLE_MAP_V3_[A-Z0-9_]+)\\b[^}\\n]*\\}\\s*=\\s*${name}\\b`, 'gi')
    ];
    for (const pattern of patterns) {
      for (const match of matchAll(source, pattern)) {
        addViolation(
          violations,
          seen,
          source,
          filePath,
          match.index,
          'v3-specific-environment',
          'V3 activation must not read aliased BATTLE_MAP_V3_* environment variables'
        );
      }
    }
  }
}

function checkAstEnvironmentReads(source, filePath, ast, violations, seen) {
  if (!ast) return;
  const nodes = astNodes(ast);
  const runtimeAliases = new Set();
  const envAliases = new Set();
  const isRuntimeExpression = input => {
    const node = unwrapChain(input);
    return node?.type === 'Identifier'
      && (node.name === 'process' || node.name === 'Bun' || runtimeAliases.has(node.name));
  };
  const isImportMeta = node => (
    node?.type === 'MetaProperty'
    && node.meta?.name === 'import'
    && node.property?.name === 'meta'
  );
  const isEnvExpression = input => {
    const node = unwrapChain(input);
    if (!node) return false;
    if (node.type === 'Identifier') return envAliases.has(node.name);
    if (node.type === 'LogicalExpression') {
      return isEnvExpression(node.left) || isEnvExpression(node.right);
    }
    if (node.type !== 'MemberExpression') return false;
    const property = staticPropertyName(node);
    return property === 'env'
      && (isRuntimeExpression(node.object) || isImportMeta(unwrapChain(node.object)));
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.type === 'VariableDeclarator') {
        if (node.id.type === 'Identifier') {
          if (isRuntimeExpression(node.init) && !runtimeAliases.has(node.id.name)) {
            runtimeAliases.add(node.id.name);
            changed = true;
          }
          if (isEnvExpression(node.init) && !envAliases.has(node.id.name)) {
            envAliases.add(node.id.name);
            changed = true;
          }
        } else if (isRuntimeExpression(node.init)) {
          for (const property of objectPatternProperties(node.id)) {
            if (property.imported === 'env' && !envAliases.has(property.local)) {
              envAliases.add(property.local);
              changed = true;
            }
          }
        }
      } else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
        if (isRuntimeExpression(node.right) && !runtimeAliases.has(node.left.name)) {
          runtimeAliases.add(node.left.name);
          changed = true;
        }
        if (isEnvExpression(node.right) && !envAliases.has(node.left.name)) {
          envAliases.add(node.left.name);
          changed = true;
        }
      }
    }
  }

  const sourceIsV3Module = v3Module(filePath, source);
  const reportKey = (key, index, destructured = false) => {
    if (typeof key === 'string' && /^BATTLE_MAP_V3_[A-Z0-9_]+$/i.test(key)) {
      addViolation(
        violations,
        seen,
        source,
        filePath,
        index,
        'v3-specific-environment',
        destructured
          ? 'V3 activation must not destructure BATTLE_MAP_V3_* environment variables'
          : 'V3 activation must not read BATTLE_MAP_V3_* environment variables'
      );
      return;
    }
    const window = envWindow(source, index);
    const normalizedKey = compact(key ?? '');
    const normalizedWindow = compact(window);
    const keyControlsBattleMap = /battlemap(?:v3|version|enabled|active|activation|rollout|catalog|profile|fallback)/.test(
      normalizedKey
    );
    const activationInV3Module = sourceIsV3Module
      && (
        key === null
        || (
          /(?:active|activate|activation|enable|fallback|flag|killswitch|profile|rollout|shadow|toggle|version)/.test(
            normalizedWindow
          )
          && /(?:authored|battlemap|catalog|mapselection|mapversion|profile)/.test(
            normalizedWindow
          )
        )
      );
    if (keyControlsBattleMap || activationInV3Module) {
      addViolation(
        violations,
        seen,
        source,
        filePath,
        index,
        'environment-derived-v3-activation',
        'BattleMap V3 activation or version selection must not derive from environment configuration'
      );
    }
  };

  for (const node of nodes) {
    if (node.type === 'MemberExpression' && isEnvExpression(node.object)) {
      reportKey(staticPropertyName(node), nodeIndex(node));
    }
    if ((node.type === 'VariableDeclarator' && isEnvExpression(node.init))
      || (node.type === 'AssignmentExpression' && isEnvExpression(node.right))) {
      const pattern = node.type === 'VariableDeclarator' ? node.id : node.left;
      for (const property of objectPatternProperties(pattern)) {
        reportKey(property.imported, nodeIndex(node), true);
      }
    }
  }
}

function checkFeatureFlagImports(source, filePath, violations, seen) {
  if (!v3Module(filePath, source)) return;
  const importPattern = /\b(?:from\s*|require\s*\(\s*|import\s*\(\s*)(['"`])([^'"`]+)\1/g;
  for (const match of matchAll(source, importPattern)) {
    const moduleName = match[2];
    if (!FEATURE_FLAG_PROVIDER.test(moduleName)) continue;
    addViolation(
      violations,
      seen,
      source,
      filePath,
      match.index,
      'v3-feature-flag-provider',
      `V3 modules must not depend on feature-flag provider "${moduleName}"`
    );
  }
}

function collectModuleBindings(ast) {
  const nodes = astNodes(ast);
  const requireAliases = new Set(['require']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier'
        || node.init?.type !== 'Identifier' || !requireAliases.has(node.init.name)
        || requireAliases.has(node.id.name)) continue;
      requireAliases.add(node.id.name);
      changed = true;
    }
  }
  const requireSource = input => {
    const node = unwrapChain(input);
    if (node?.type !== 'CallExpression' || node.arguments.length !== 1
      || node.callee.type !== 'Identifier' || !requireAliases.has(node.callee.name)) {
      return null;
    }
    return literalString(node.arguments[0]);
  };
  const bindings = [];
  const moduleLoads = [];
  for (const node of nodes) {
    if (node.type !== 'CallExpression') continue;
    const moduleName = requireSource(node);
    if (moduleName) moduleLoads.push({ index: nodeIndex(node), moduleName, node });
  }
  for (const node of nodes) {
    if (node.type === 'ImportDeclaration') {
      const moduleName = literalString(node.source);
      for (const specifier of node.specifiers) {
        const imported = specifier.type === 'ImportSpecifier'
          ? specifier.imported?.name ?? specifier.imported?.value
          : specifier.type === 'ImportDefaultSpecifier' ? 'default' : '*';
        bindings.push({
          imported,
          index: nodeIndex(node),
          local: specifier.local.name,
          moduleName
        });
      }
      continue;
    }
    if (node.type !== 'VariableDeclarator') continue;
    let moduleName = requireSource(node.init);
    let imported = '*';
    const init = unwrapChain(node.init);
    if (!moduleName && init?.type === 'MemberExpression') {
      moduleName = requireSource(init.object);
      imported = staticPropertyName(init);
    }
    if (!moduleName) continue;
    if (node.id.type === 'Identifier') {
      bindings.push({
        imported,
        index: nodeIndex(node),
        local: node.id.name,
        moduleName
      });
    } else {
      for (const property of objectPatternProperties(node.id)) {
        bindings.push({
          imported: property.imported,
          index: nodeIndex(node),
          local: property.local,
          moduleName
        });
      }
    }
  }
  return { bindings, moduleLoads, nodes };
}

function v3SelectionModule(filePath, source) {
  if (!v3Module(filePath, source)) return false;
  return /(?:select|selection|selector)/i.test(filePath)
    || /selectBattleMapV3|selectMap\s*\(|stableWeightedCatalogChoice/.test(source);
}

function checkAstFeatureFlagProviders(source, filePath, ast, violations, seen) {
  if (!ast || !v3Module(filePath, source)) return;
  const { bindings, moduleLoads, nodes } = collectModuleBindings(ast);
  for (const load of moduleLoads) {
    if (!FEATURE_FLAG_PROVIDER.test(load.moduleName)) continue;
    addViolation(
      violations,
      seen,
      source,
      filePath,
      load.index,
      'v3-feature-flag-provider',
      `V3 modules must not depend on feature-flag provider "${load.moduleName}"`
    );
  }
  for (const binding of bindings) {
    if (!FEATURE_FLAG_PROVIDER.test(binding.moduleName)) continue;
    addViolation(
      violations,
      seen,
      source,
      filePath,
      binding.index,
      'v3-feature-flag-provider',
      `V3 modules must not depend on feature-flag provider "${binding.moduleName}"`
    );
  }
  if (!v3SelectionModule(filePath, source)) return;

  const configBindings = new Set();
  const activationBindings = new Set();
  for (const binding of bindings) {
    if (!CONFIG_PROVIDER.test(binding.moduleName)) continue;
    configBindings.add(binding.local);
    if (flagControlName(binding.imported) || flagControlName(binding.local)) {
      activationBindings.add(binding.local);
      addViolation(
        violations,
        seen,
        source,
        filePath,
        binding.index,
        'v3-feature-flag-provider',
        `V3 selection must not import activation control "${binding.imported}" from config provider "${binding.moduleName}"`
      );
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.type !== 'VariableDeclarator') continue;
      const init = unwrapChain(node.init);
      if (node.id.type === 'Identifier' && init?.type === 'Identifier'
        && configBindings.has(init.name) && !configBindings.has(node.id.name)) {
        configBindings.add(node.id.name);
        if (activationBindings.has(init.name)) activationBindings.add(node.id.name);
        changed = true;
      }
      if (node.id.type === 'Identifier' && init?.type === 'MemberExpression'
        && init.object.type === 'Identifier' && configBindings.has(init.object.name)) {
        const property = staticPropertyName(init);
        configBindings.add(node.id.name);
        if (flagControlName(property)) activationBindings.add(node.id.name);
      }
      if (node.id.type === 'ObjectPattern' && init?.type === 'Identifier'
        && configBindings.has(init.name)) {
        for (const property of objectPatternProperties(node.id)) {
          configBindings.add(property.local);
          if (flagControlName(property.imported)) {
            activationBindings.add(property.local);
          }
        }
      }
    }
  }

  const report = (node, detail) => addViolation(
    violations,
    seen,
    source,
    filePath,
    nodeIndex(node),
    'v3-feature-flag-provider',
    `V3 selection must not use config-derived feature controls${detail ? ` (${detail})` : ''}`
  );
  for (const node of nodes) {
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier'
      && configBindings.has(node.object.name)) {
      const property = staticPropertyName(node);
      if (flagControlName(property)) report(node, property);
    }
    if (node.type !== 'CallExpression') continue;
    const callee = unwrapChain(node.callee);
    if (callee?.type === 'Identifier' && activationBindings.has(callee.name)) {
      report(node, callee.name);
      continue;
    }
    if (callee?.type !== 'MemberExpression' || callee.object.type !== 'Identifier'
      || !configBindings.has(callee.object.name)) {
      if (callee?.type !== 'MemberExpression') continue;
      const directLoad = moduleLoads.find(load => load.node === unwrapChain(callee.object));
      if (!directLoad || !CONFIG_PROVIDER.test(directLoad.moduleName)) continue;
      const directProperty = staticPropertyName(callee);
      const directActivationArgument = node.arguments.some(argument => (
        configActivationValue(literalString(argument))
      ));
      if (flagControlName(directProperty)
        || (CONFIG_READ_METHOD.test(directProperty ?? '') && directActivationArgument)) {
        report(node, directProperty);
      }
      continue;
    }
    const property = staticPropertyName(callee);
    const activationArgument = node.arguments.some(argument => (
      configActivationValue(literalString(argument))
    ));
    if (flagControlName(property)
      || (CONFIG_READ_METHOD.test(property ?? '') && activationArgument)) {
      report(node, property);
    }
  }
}

function prohibitedControl(window, sourceIsV3Module) {
  const hasV3Token = /battle.?map.?v3/i.test(window)
    || /\b[vV]3(?:\b|(?=[A-Z_]))/.test(window);
  if (!hasV3Token && !sourceIsV3Module) {
    return null;
  }
  const normalized = compact(window);
  if (
    (
      /(?:v3.*shadow|shadow.*v3)/.test(normalized)
      && /(?:config|enabled|flag|mode|runtime|schedule|selection|selector|toggle)/.test(
        normalized
      )
    )
    || (
      sourceIsV3Module
      && /(?:shadow(?:generation|enabled|mode|selection|selector)|(?:runtime|schedule).*shadow)/.test(
        normalized
      )
    )
  ) {
    return {
      code: 'v3-shadow-control',
      message: 'Runtime V3 shadow selection or shadow switches are prohibited'
    };
  }
  if (
    /(?:v3.*(?:killswitch|emergencystop)|(?:killswitch|emergencystop).*v3)/.test(normalized)
    || (sourceIsV3Module && /(?:killswitch|emergencystop)/.test(normalized))
  ) {
    return {
      code: 'v3-kill-switch',
      message: 'Runtime V3 kill switches are prohibited'
    };
  }
  if (
    (
      /(?:v3.*fallback|fallback.*v3)/.test(normalized)
      || (sourceIsV3Module && normalized.includes('fallback'))
    )
    && /(?:config|enabled|flag|mode|option|setting|switch|toggle)/.test(normalized)
  ) {
    return {
      code: 'v3-configurable-fallback',
      message: 'V3 fallback may depend only on catalog coverage, not configuration'
    };
  }
  if (
    /(?:v3.*(?:activationprofile|enabledprofiles|rolloutgate)|(?:activationprofile|enabledprofiles|rolloutgate).*v3)/.test(normalized)
    || (
      sourceIsV3Module
      && /(?:activationprofile|enabledprofiles|rolloutgate)/.test(normalized)
    )
  ) {
    return {
      code: 'v3-rollout-control',
      message: 'V3 activation profiles and rollout gates are prohibited'
    };
  }
  return null;
}

function checkRuntimeControls(source, filePath, violations, seen) {
  if (offlineTool(filePath)) return;
  const offlineBattleArt = slashPath(filePath).startsWith('scripts/battle-art/');
  const sourceIsV3Module = v3Module(filePath, source);
  const lines = source.split('\n');
  let offset = 0;
  lines.forEach((line, index) => {
    const window = lines.slice(Math.max(0, index - 1), index + 2).join('\n');
    const prohibited = prohibitedControl(window, sourceIsV3Module);
    if (
      prohibited
      && !(offlineBattleArt && prohibited.code === 'v3-configurable-fallback')
    ) {
      addViolation(
        violations,
        seen,
        source,
        filePath,
        offset,
        prohibited.code,
        prohibited.message
      );
    }
    offset += line.length + 1;
  });
}

/**
 * Analyze one production source string without filesystem access.
 */
export function findV3ArchitectureViolations(
  source,
  { filePath = 'fixture.js' } = {}
) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('filePath must be a non-empty string');
  }
  const normalizedPath = slashPath(filePath);
  if (normalizedPath === SELF_PATH) return [];

  const masked = maskComments(source);
  const ast = parseAst(masked);
  const violations = [];
  const seen = new Set();
  checkEnvironmentReads(masked, normalizedPath, violations, seen);
  checkLexicalEnvironmentAliases(masked, normalizedPath, violations, seen);
  checkAstEnvironmentReads(masked, normalizedPath, ast, violations, seen);
  checkFeatureFlagImports(masked, normalizedPath, violations, seen);
  checkAstFeatureFlagProviders(masked, normalizedPath, ast, violations, seen);
  checkRuntimeControls(masked, normalizedPath, violations, seen);
  return violations.sort((left, right) => (
    left.line - right.line || left.code.localeCompare(right.code)
  ));
}

function functionNode(ast, name) {
  return astNodes(ast).find(node => (
    node.type === 'FunctionDeclaration' && node.id?.name === name
  ));
}

function callNodes(node) {
  return astNodes(node).filter(candidate => candidate.type === 'CallExpression');
}

function identifierCall(call, names) {
  const callee = unwrapChain(call?.callee);
  return callee?.type === 'Identifier' && names.has(callee.name);
}

function bindingNames(bindings, imported, modulePattern) {
  return new Set(bindings
    .filter(binding => (
      binding.imported === imported && modulePattern.test(binding.moduleName)
    ))
    .map(binding => binding.local));
}

function nodeContainsCall(node, names) {
  return callNodes(node).some(call => identifierCall(call, names));
}

function runtimeImplementsAutomaticCatalogFlow(source) {
  const ast = parseAst(maskComments(source));
  if (!ast) return false;
  const { bindings, nodes } = collectModuleBindings(ast);
  const sharedModule = /(?:^|\/)shared(?:\/index|\/battleMap\/BattleMapV3Selector)(?:\.[cm]?[jt]sx?)?$/;
  const normalizers = bindingNames(
    bindings,
    'normalizeBattleMapV3CatalogRelease',
    sharedModule
  );
  const selectors = bindingNames(
    bindings,
    'selectBattleMapV3CatalogEntry',
    sharedModule
  );
  const pinLoader = functionNode(ast, 'loadBattleMapV3ReleaseFromPin');
  const deployedLoader = functionNode(ast, 'loadDeployedBattleMapV3Catalog');
  const deployedSelector = functionNode(ast, 'selectDeployedBattleMapV3');
  if (normalizers.size === 0 || selectors.size === 0
    || !pinLoader || !deployedLoader || !deployedSelector) {
    return false;
  }

  const hasTrackedActivePin = nodes.some(node => (
    literalString(node)?.endsWith('/battle-maps/catalog/active-release.json')
  ));
  const pinLoaderNormalizesTrackedCatalog = callNodes(pinLoader).some(call => (
    identifierCall(call, normalizers)
    && nodeContainsCall(call, new Set(['readJson']))
    && astNodes(call).some(node => (
      node.type === 'MemberExpression'
      && staticPropertyName(node) === 'catalogPath'
    ))
  ));
  const deployedLoaderReadsPin = callNodes(deployedLoader).some(call => (
    identifierCall(call, new Set(['readJson']))
    && astNodes(call).some(node => (
      node.type === 'Identifier' && node.name === 'activeReleaseUrl'
    ))
  ));
  const deployedLoaderUsesPinLoader = nodeContainsCall(
    deployedLoader,
    new Set(['loadBattleMapV3ReleaseFromPin'])
  );
  const activePathIsDefault = astNodes(deployedLoader).some(node => (
    node.type === 'AssignmentPattern'
    && node.left?.type === 'Identifier'
    && node.left.name === 'activeReleaseUrl'
    && node.right?.type === 'Identifier'
    && node.right.name === 'BATTLE_MAP_V3_ACTIVE_RELEASE_PATH'
  ));
  const deployedValue = astNodes(deployedSelector).find(node => (
    node.type === 'VariableDeclarator'
    && node.id?.type === 'Identifier'
    && node.id.name === 'deployed'
    && nodeContainsCall(node.init, new Set(['loadCatalog']))
  ));
  const deployedSelection = callNodes(deployedSelector).some(call => {
    if (!identifierCall(call, selectors)) return false;
    const release = unwrapChain(call.arguments[0]);
    return release?.type === 'MemberExpression'
      && release.object?.type === 'Identifier'
      && release.object.name === 'deployed'
      && staticPropertyName(release) === 'release'
      && unwrapChain(call.arguments[1])?.type === 'Identifier'
      && unwrapChain(call.arguments[1]).name === 'query';
  });
  const deployedLoaderIsDefault = astNodes(deployedSelector).some(node => (
    node.type === 'AssignmentPattern'
    && node.left?.type === 'Identifier'
    && node.left.name === 'loadCatalog'
    && node.right?.type === 'Identifier'
    && node.right.name === 'loadDeployedBattleMapV3Catalog'
  ));

  return hasTrackedActivePin
    && pinLoaderNormalizesTrackedCatalog
    && deployedLoaderReadsPin
    && deployedLoaderUsesPinLoader
    && activePathIsDefault
    && Boolean(deployedValue)
    && deployedSelection
    && deployedLoaderIsDefault;
}

function productionSelectorNormalizesCatalog(source) {
  const ast = parseAst(maskComments(source));
  if (!ast) return false;
  const { bindings } = collectModuleBindings(ast);
  const normalizers = bindingNames(
    bindings,
    'normalizeBattleMapV3CatalogRelease',
    /(?:^|\/)v3\/(?:catalog|index)(?:\.[cm]?[jt]sx?)?$/
  );
  const selector = functionNode(ast, 'selectBattleMapV3CatalogEntry');
  return Boolean(selector)
    && normalizers.size > 0
    && nodeContainsCall(selector, normalizers);
}

function generationServiceUsesDeployedCatalog(source) {
  const ast = parseAst(maskComments(source));
  if (!ast) return false;
  const { bindings } = collectModuleBindings(ast);
  const deployedSelectors = bindingNames(
    bindings,
    'selectDeployedBattleMapV3',
    /(?:^|\/)BattleMapV3CatalogRuntime(?:\.[cm]?[jt]sx?)?$/
  );
  const generation = functionNode(ast, 'generateBattleMap');
  if (!generation || deployedSelectors.size === 0) return false;
  const selectV3Default = astNodes(generation).some(node => (
    node.type === 'AssignmentPattern'
    && node.left?.type === 'Identifier'
    && node.left.name === 'selectV3'
    && node.right?.type === 'Identifier'
    && deployedSelectors.has(node.right.name)
  ));
  const selectionCall = callNodes(generation).some(call => (
    identifierCall(call, new Set(['selectV3']))
  ));
  const selectedCoverageBranch = astNodes(generation).some(node => (
    node.type === 'BinaryExpression'
    && node.operator === '==='
    && literalString(node.right) === 'selected'
    && node.left?.type === 'MemberExpression'
    && node.left.object?.type === 'Identifier'
    && node.left.object.name === 'selection'
    && staticPropertyName(node.left) === 'coverage'
  ));
  const absentOnlyCompatibility = astNodes(generation).some(node => (
    node.type === 'BinaryExpression'
    && node.operator === '!=='
    && literalString(node.right) === 'absent'
    && node.left?.type === 'MemberExpression'
    && node.left.object?.type === 'Identifier'
    && node.left.object.name === 'selection'
    && staticPropertyName(node.left) === 'coverage'
  ));
  return selectV3Default
    && selectionCall
    && selectedCoverageBranch
    && absentOnlyCompatibility;
}

function automaticCatalogSelectionViolations(
  sources,
  { requireAutomaticCatalogFlow = false } = {}
) {
  const productionSources = sources.filter(({ filePath }) => isProductionSourcePath(filePath));
  const expectedPaths = new Set([
    V3_PRODUCTION_SELECTOR_PATH,
    V3_TRACKED_CATALOG_RUNTIME_PATH,
    V3_BATTLE_MAP_GENERATION_SERVICE_PATH
  ]);
  const relevantSources = productionSources.filter(({ filePath }) => (
    expectedPaths.has(slashPath(filePath))
  ));
  // Pure unit callers may provide an unrelated partial source set. Once any
  // production catalog-flow module is present, however, the whole tracked-pin
  // chain is mandatory and missing modules fail closed.
  if (relevantSources.length === 0 && !requireAutomaticCatalogFlow) return [];
  const sourceByPath = new Map(relevantSources.map(source => [
    slashPath(source.filePath),
    source
  ]));
  const selector = sourceByPath.get(V3_PRODUCTION_SELECTOR_PATH);
  const runtime = sourceByPath.get(V3_TRACKED_CATALOG_RUNTIME_PATH);
  const generation = sourceByPath.get(V3_BATTLE_MAP_GENERATION_SERVICE_PATH);
  if (selector
    && runtime
    && generation
    && productionSelectorNormalizesCatalog(selector.source)
    && runtimeImplementsAutomaticCatalogFlow(runtime.source)
    && generationServiceUsesDeployedCatalog(generation.source)) {
    return [];
  }
  const location = runtime ?? generation ?? selector;
  if (!location) {
    return [Object.freeze({
      code: 'v3-catalog-not-automatic',
      filePath: V3_TRACKED_CATALOG_RUNTIME_PATH,
      line: 1,
      message: 'New battles must load the tracked active V3 catalog pin, normalize its release, pass it to the deployed selector, and use that selector by default with V2 compatibility only on catalog coverage absence',
      excerpt: ''
    })];
  }
  const violations = [];
  addViolation(
    violations,
    new Set(),
    location.source,
    location.filePath,
    0,
    'v3-catalog-not-automatic',
    'New battles must load the tracked active V3 catalog pin, normalize its release, pass it to the deployed selector, and use that selector by default with V2 compatibility only on catalog coverage absence'
  );
  return violations;
}

async function collectProductionSources(rootDirectory, directory = rootDirectory) {
  const sources = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = resolve(directory, entry.name);
    const relativePath = slashPath(relative(rootDirectory, absolutePath));
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;
      sources.push(...await collectProductionSources(rootDirectory, absolutePath));
    } else if (entry.isFile() && isProductionSourcePath(relativePath)) {
      sources.push({
        filePath: relativePath,
        source: await readFile(absolutePath, 'utf8')
      });
    }
  }
  return sources;
}

/**
 * Check in-memory sources. This is the pure multi-file entry point used by
 * tests and callers that already own file discovery.
 */
export function checkV3ArchitectureSources(
  sources,
  { requireAutomaticCatalogFlow = false } = {}
) {
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
  const sourceViolations = sources.flatMap(({ filePath, source }) => (
    isProductionSourcePath(filePath)
      ? findV3ArchitectureViolations(source, { filePath })
      : []
  ));
  return [
    ...sourceViolations,
    ...automaticCatalogSelectionViolations(sources, { requireAutomaticCatalogFlow })
  ]
    .sort((left, right) => (
      left.filePath.localeCompare(right.filePath)
      || left.line - right.line
      || left.code.localeCompare(right.code)
    ));
}

export async function checkV3Architecture(rootDirectory = DEFAULT_PROJECT_ROOT) {
  const root = resolve(rootDirectory);
  return checkV3ArchitectureSources(
    await collectProductionSources(root),
    { requireAutomaticCatalogFlow: true }
  );
}

function parseArguments(argv) {
  let rootDirectory = DEFAULT_PROJECT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') {
      if (!argv[index + 1]) throw new TypeError('--root requires a directory');
      rootDirectory = resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new TypeError(`Unknown argument: ${argv[index]}`);
    }
  }
  return rootDirectory;
}

export async function main(argv = process.argv.slice(2)) {
  const root = parseArguments(argv);
  const violations = await checkV3Architecture(root);
  if (violations.length === 0) {
    console.log('BattleMap V3 architecture guardrails passed.');
    return 0;
  }
  console.error(`BattleMap V3 architecture guardrails failed (${violations.length}):`);
  for (const violation of violations) {
    console.error(
      `  ${violation.filePath}:${violation.line} [${violation.code}] ${violation.message}`
    );
    if (violation.excerpt) console.error(`    ${violation.excerpt}`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      console.error(error.stack ?? error.message);
      process.exitCode = 1;
    }
  );
}
