import path from 'node:path';

import {
  auditCodexParentImagegenHandoffJsonl
} from '../battle-maps/codex-worker-boundary.mjs';

const SCRIPT_ROOT = path.resolve(import.meta.dirname, '../..');
const CODEX_WORKER_HOME = path.resolve(
  process.env.CODEX_HOME
    ?? path.join(process.env.HOME ?? SCRIPT_ROOT, '.codex')
);
const IMAGEGEN_SKILL_PATH = path.join(
  CODEX_WORKER_HOME,
  'skills/.system/imagegen/SKILL.md'
);

export const CANONICAL_ROUTE_SKILL_READ_COMMAND =
  `/bin/cat ${JSON.stringify(IMAGEGEN_SKILL_PATH)}`;

const PORTABLE_IMAGEGEN_SKILL_SUFFIX = Object.freeze([
  'skills',
  '.system',
  'imagegen',
  'SKILL.md'
]);

function isPortableCanonicalImagegenSkillRead(command) {
  if (typeof command !== 'string' || /[\r\n$`\\]/.test(command)) {
    return false;
  }
  const match = command.match(/^\/bin\/cat ("[^\"]+")$/);
  if (!match) return false;
  let skillPath;
  try {
    skillPath = JSON.parse(match[1]);
  } catch {
    return false;
  }
  if (
    typeof skillPath !== 'string'
    || !path.isAbsolute(skillPath)
    || path.normalize(skillPath) !== skillPath
  ) {
    return false;
  }
  const components = skillPath.split(path.sep).filter(Boolean);
  if (components.length <= PORTABLE_IMAGEGEN_SKILL_SUFFIX.length) return false;
  return PORTABLE_IMAGEGEN_SKILL_SUFFIX.every(
    (component, index) => (
      components[components.length - PORTABLE_IMAGEGEN_SKILL_SUFFIX.length + index]
        === component
    )
  );
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  assertObject(value, label);
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`${label}.${key} is not allowed`);
    }
  }
}

function assertParentHandoffItem(item, line) {
  const label = `Codex parent handoff stdout line ${line}.item`;
  assertObject(item, label);
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new Error(`${label}.id is required`);
  }
  if (item.type === 'agent_message' || item.type === 'reasoning') {
    assertAllowedKeys(item, ['id', 'type', 'text'], label);
    if (typeof item.text !== 'string') {
      throw new Error(`${label}.text is required`);
    }
    return;
  }
  if (item.type === 'command_execution') {
    assertAllowedKeys(item, [
      'id',
      'type',
      'command',
      'aggregated_output',
      'exit_code',
      'status',
      'call_id',
      'error'
    ], label);
    if (typeof item.command !== 'string') {
      throw new Error(`${label}.command is required`);
    }
    return;
  }
  if (
    item.type === 'mcp_tool_call'
    && item.server === 'image_gen'
    && item.tool === 'imagegen'
  ) {
    assertAllowedKeys(item, [
      'id',
      'type',
      'server',
      'tool',
      'status',
      'call_id',
      'error',
      'arguments',
      'result'
    ], label);
    return;
  }
  throw new Error(
    `${label}.type is not allowed for a parent imagegen handoff`
  );
}

function assertParentHandoffEventSurface(stdout) {
  const source = Buffer.from(stdout ?? '').toString('utf8');
  const lines = source.split(/\r?\n/).filter(line => line.length > 0);
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(
        `Codex parent handoff stdout line ${index + 1} is not valid JSONL`
      );
    }
    const label = `Codex parent handoff stdout line ${index + 1}`;
    assertObject(event, label);
    if (event.type === 'thread.started') {
      assertAllowedKeys(event, ['type', 'thread_id'], label);
      if (typeof event.thread_id !== 'string') {
        throw new Error(`${label}.thread_id is required`);
      }
      continue;
    }
    if (event.type === 'turn.started') {
      assertAllowedKeys(event, ['type'], label);
      continue;
    }
    if (event.type === 'turn.completed') {
      assertAllowedKeys(event, ['type', 'usage'], label);
      continue;
    }
    if ([
      'item.started',
      'item.completed',
      'item.failed',
      'item.cancelled',
      'item.canceled'
    ].includes(event.type)) {
      assertAllowedKeys(event, [
        'type',
        'item',
        'status',
        'call_id',
        'error'
      ], label);
      assertParentHandoffItem(event.item, index + 1);
      continue;
    }
    throw new Error(
      `${label}.type is not allowed for a parent imagegen handoff`
    );
  }
}

export function auditCanonicalParentRouteHandoffJsonl(stdout, {
  allowHistoricalSkillRead = false
} = {}) {
  assertParentHandoffEventSurface(stdout);
  return auditCodexParentImagegenHandoffJsonl(stdout, {
    canonicalSkillReadCommand: CANONICAL_ROUTE_SKILL_READ_COMMAND,
    ...(allowHistoricalSkillRead
      ? {
          validateHistoricalSkillReadCommand:
            isPortableCanonicalImagegenSkillRead
        }
      : {})
  });
}
