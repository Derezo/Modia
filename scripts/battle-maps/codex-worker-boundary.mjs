import {
  lstat,
  open,
  readdir,
  realpath
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

export const CODEX_WORKER_ENV_KEYS = Object.freeze([
  'PATH',
  'HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy'
]);

export function buildCodexWorkerEnvironment(source = process.env) {
  const environment = {};
  for (const key of CODEX_WORKER_ENV_KEYS) {
    if (typeof source[key] === 'string' && source[key].length > 0) {
      environment[key] = source[key];
    }
  }
  return environment;
}

function toolIdentity(item, recordType) {
  const identity = [
    item?.server,
    item?.tool,
    item?.name,
    item?.tool_name,
    item?.function?.name
  ].filter(Boolean).join(':').toLowerCase();
  if (identity) return identity;
  if (recordType === 'command_execution') return recordType;
  return 'unknown';
}

function isImagegenToolCall(item) {
  const server = String(item?.server ?? '').toLowerCase();
  const tool = String(
    item?.tool
      ?? item?.tool_name
      ?? item?.function?.name
      ?? item?.name
      ?? ''
  ).toLowerCase();
  return server === 'image_gen' && tool === 'imagegen';
}

function lifecycleStatusKind(value) {
  if (value === undefined || value === null || value === '') return null;
  const status = String(value).toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(status)) return 'success';
  if (['failed', 'cancelled', 'canceled', 'error'].includes(status)) {
    return 'failure';
  }
  if (['in_progress', 'started', 'running', 'pending'].includes(status)) {
    return 'nonterminal';
  }
  return 'unknown';
}

function toolLifecycleOutcome(event, item) {
  const eventType = String(event?.type ?? '').toLowerCase();
  const itemStatus = lifecycleStatusKind(item?.status);
  const envelopeStatus = lifecycleStatusKind(event?.status);
  if (
    itemStatus !== null
    && envelopeStatus !== null
    && itemStatus !== envelopeStatus
  ) {
    throw new Error(
      'Codex worker invocation has contradictory item/envelope status'
    );
  }
  const status = itemStatus ?? envelopeStatus;
  const hasError = (
    (item?.error !== undefined && item.error !== null)
    || (event?.error !== undefined && event.error !== null)
  );
  if (hasError && status !== null && status !== 'failure') {
    throw new Error(
      'Codex worker invocation has contradictory status and error'
    );
  }
  const failureEvent = [
    'item.failed',
    'item.cancelled',
    'item.canceled'
  ].includes(eventType);
  if (failureEvent && status !== null && status !== 'failure') {
    throw new Error(
      'Codex worker invocation has contradictory event type and status'
    );
  }
  if (failureEvent || hasError || status === 'failure') return 'failure';
  if (eventType === 'item.completed') {
    if (status === null || status === 'success') return 'success';
    throw new Error(
      'Codex worker invocation has contradictory completed lifecycle status'
    );
  }
  if (status === 'success') {
    throw new Error(
      'Codex worker invocation has contradictory nonterminal lifecycle status'
    );
  }
  return null;
}

function correlateToolLifecycle(aliasStates, lifecycleStates, itemCallIds, {
  event,
  identity,
  imagegen,
  fallbackId
}) {
  const item = event.item ?? event;
  const itemId = item?.id === undefined || item.id === null
    ? null
    : String(item.id);
  const itemCallId = item?.call_id === undefined || item.call_id === null
    ? null
    : String(item.call_id);
  const eventCallId = event?.call_id === undefined || event.call_id === null
    ? null
    : String(event.call_id);
  if (itemCallId !== null && eventCallId !== null && itemCallId !== eventCallId) {
    throw new Error('Codex worker invocation has conflicting call_id fields');
  }
  const callId = itemCallId ?? eventCallId;
  if (itemId !== null && callId !== null) {
    const correlatedCallId = itemCallIds.get(itemId);
    if (correlatedCallId !== undefined && correlatedCallId !== callId) {
      throw new Error(
        `Codex worker invocation ${itemId} has contradictory call IDs`
      );
    }
    itemCallIds.set(itemId, callId);
  }
  const aliases = [...new Set(
    [itemId, callId].filter(value => value !== null)
  )];
  if (aliases.length === 0) aliases.push(fallbackId);
  const correlatedStates = new Set(
    aliases.map(alias => aliasStates.get(alias)).filter(Boolean)
  );
  if (correlatedStates.size > 1) {
    throw new Error('Codex worker invocation aliases correlate conflicting records');
  }
  const existing = [...correlatedStates][0];
  if (existing && existing.tool !== identity) {
    throw new Error(
      `Codex worker has conflicting tool identities for invocation ${callId ?? itemId}`
    );
  }
  const lifecycle = existing ?? {
    id: callId ?? itemId ?? fallbackId,
    tool: identity,
    imagegen,
    terminal: null
  };
  if (callId !== null) lifecycle.id = callId;
  if (lifecycle.imagegen !== imagegen) {
    throw new Error(
      `Codex worker has conflicting imagegen identity for invocation ${lifecycle.id}`
    );
  }
  const outcome = toolLifecycleOutcome(event, item);
  if (outcome === null) {
    if (lifecycle.terminal !== null) {
      throw new Error(
        `Codex worker has a nonterminal record after terminal invocation ${lifecycle.id}`
      );
    }
  } else if (lifecycle.terminal !== null && lifecycle.terminal !== outcome) {
    throw new Error(
      `Codex worker has conflicting terminal lifecycle for invocation ${lifecycle.id}`
    );
  } else {
    lifecycle.terminal = outcome;
  }
  for (const alias of aliases) aliasStates.set(alias, lifecycle);
  lifecycleStates.add(lifecycle);
  return lifecycle;
}

const GENERATED_RASTER_NAME_SOURCE = [
  'call_[A-Za-z0-9_-]+\\.(?:png|webp|jpe?g)',
  'exec-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.png'
].join('|');
const GENERATED_RASTER_NAME_PATTERN = new RegExp(
  `^(?:${GENERATED_RASTER_NAME_SOURCE})$`,
  'i'
);

function isSafePathComponent(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

export function auditCodexParentImagegenHandoffJsonl(stdout, {
  canonicalSkillReadCommand,
  validateHistoricalSkillReadCommand
} = {}) {
  if (
    typeof canonicalSkillReadCommand !== 'string'
    || canonicalSkillReadCommand.length === 0
  ) {
    throw new Error('parent imagegen handoff requires a canonical skill-read command');
  }
  if (
    validateHistoricalSkillReadCommand !== undefined
    && typeof validateHistoricalSkillReadCommand !== 'function'
  ) {
    throw new Error(
      'parent imagegen handoff historical skill-read validator must be a function'
    );
  }
  const source = Buffer.from(stdout ?? '').toString('utf8');
  const invocationAliasStates = new Map();
  const invocationLifecycles = new Set();
  const invocationItemCallIds = new Map();
  const commandText = new Map();
  const terminalRecords = new Map();
  const threadStartedRecords = [];
  let successfulSkillReadLine = null;
  let validatedSkillReadCommand = null;
  let firstObservableImagegenLine = null;
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
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(
        `Codex parent handoff stdout line ${index + 1} is not a JSON object`
      );
    }
    if (event.type === 'thread.started') {
      threadStartedRecords.push(event.thread_id);
    }
    const item = event.item
      && typeof event.item === 'object'
      && !Array.isArray(event.item)
      ? event.item
      : event;
    const recordType = String(item.type ?? event.type ?? '').toLowerCase();
    if (
      ['file_change', 'file_write', 'apply_patch'].some(
        type => recordType.includes(type)
      )
    ) {
      throw new Error(
        'Codex parent handoff worker must not perform file writes'
      );
    }
    const isCommand = recordType === 'command_execution';
    const isInvocation = isCommand
      || recordType.includes('tool')
      || recordType.includes('function')
      || recordType.includes('web_search')
      || recordType.includes('computer_action');
    if (!isInvocation) continue;
    const imagegen = isImagegenToolCall(item);
    if (imagegen && firstObservableImagegenLine === null) {
      firstObservableImagegenLine = index;
    }
    if (!isCommand && !imagegen) {
      throw new Error(
        `Codex parent handoff worker invoked prohibited tool ${toolIdentity(item, recordType)}`
      );
    }
    if (isCommand && typeof item.command !== 'string') {
      throw new Error(
        'Codex parent handoff command execution must include a command'
      );
    }
    const lifecycle = correlateToolLifecycle(
      invocationAliasStates,
      invocationLifecycles,
      invocationItemCallIds,
      {
        event,
        identity: isCommand ? 'command_execution' : toolIdentity(item, recordType),
        imagegen,
        fallbackId: `line:${index + 1}`
      }
    );
    if (isCommand) {
      const prior = commandText.get(lifecycle);
      if (prior !== undefined && prior !== item.command) {
        throw new Error(
          `Codex parent handoff command invocation ${lifecycle.id} changed command text`
        );
      }
      const unwrapped = unwrapSafeShellCommand(item.command);
      if (
        unwrapped !== canonicalSkillReadCommand
        && !validateHistoricalSkillReadCommand?.(unwrapped)
      ) {
        throw new Error(
          'Codex parent handoff worker may execute only the canonical imagegen skill read'
        );
      }
      validatedSkillReadCommand = unwrapped;
      commandText.set(lifecycle, item.command);
    }
    const outcome = toolLifecycleOutcome(event, item);
    if (
      isCommand
      && outcome === 'success'
      && item.exit_code !== 0
    ) {
      throw new Error(
        'Codex parent handoff canonical skill-read command did not exit successfully'
      );
    }
    if (isCommand && outcome === 'success') {
      successfulSkillReadLine = index;
    }
    if (outcome !== null) {
      terminalRecords.set(
        lifecycle,
        (terminalRecords.get(lifecycle) ?? 0) + 1
      );
    }
  }
  if (
    threadStartedRecords.length !== 1
    || !isSafePathComponent(threadStartedRecords[0])
  ) {
    throw new Error(
      'Codex parent handoff requires exactly one safe thread.started record'
    );
  }
  const commands = [...invocationLifecycles].filter(
    lifecycle => lifecycle.tool === 'command_execution'
  );
  if (
    commands.length !== 1
    || commands[0].terminal !== 'success'
    || terminalRecords.get(commands[0]) !== 1
  ) {
    throw new Error(
      'Codex parent handoff requires exactly one successful canonical skill-read command'
    );
  }
  const imagegenInvocations = [...invocationLifecycles].filter(
    lifecycle => lifecycle.imagegen
  );
  if (
    imagegenInvocations.length > 1
    || imagegenInvocations.some(lifecycle => (
      lifecycle.terminal !== 'success'
      || terminalRecords.get(lifecycle) !== 1
    ))
  ) {
    throw new Error(
      'Codex parent handoff requires exactly one successful imagegen invocation when observable'
    );
  }
  if (
    firstObservableImagegenLine !== null
    && successfulSkillReadLine >= firstObservableImagegenLine
  ) {
    throw new Error(
      'Codex parent handoff skill read must complete before observable imagegen execution'
    );
  }
  return {
    threadId: threadStartedRecords[0],
    commandCount: 1,
    observableImagegenInvocationCount: imagegenInvocations.length,
    ...(validateHistoricalSkillReadCommand === undefined
      ? {}
      : { skillReadCommand: validatedSkillReadCommand })
  };
}

function isDirectChild(root, candidate) {
  return path.dirname(path.resolve(candidate)) === path.resolve(root);
}

function parseGeneratedArtifactPath(artifactPath) {
  if (
    typeof artifactPath !== 'string'
    || (!path.isAbsolute(artifactPath) && !/^[A-Za-z]:[/\\]/.test(artifactPath))
  ) {
    return null;
  }
  const match = artifactPath.match(
    /[/\\]generated_images[/\\]([^/\\]+)[/\\]([^/\\]+)$/i
  );
  if (!match || !GENERATED_RASTER_NAME_PATTERN.test(match[2])) return null;
  return {
    path: artifactPath,
    threadId: match[1],
    callId: match[2].replace(/\.(?:png|webp|jpe?g)$/i, '')
  };
}

const REMOVE_CHROMA_KEY_SUFFIX =
  '/skills/.system/imagegen/scripts/remove_chroma_key.py';

function unwrapSafeShellCommand(command) {
  const payload = command.trim();
  const shellPrefix = /^(?:\/bin\/)?(?:ba)?sh(?:[\t ]|$)/;
  if (!shellPrefix.test(payload)) return payload;
  const wrapper = payload.match(
    /^(?:\/bin\/)?(?:ba)?sh[\t ]+-(?:l)?c[\t ]+(['"])([\s\S]*)\1$/
  );
  if (!wrapper) return null;
  const quote = wrapper[1];
  const inner = wrapper[2];
  if (inner.includes(quote)) return null;
  if (quote === '"' && /[$`\\]/.test(inner)) return null;
  return inner.trim();
}

function tokenizeSafeShellCommand(command) {
  if (/[\r\n]/.test(command)) return null;
  const tokens = [];
  let offset = 0;
  while (offset < command.length) {
    while (/[\t ]/.test(command[offset] ?? '')) offset += 1;
    if (offset >= command.length) break;
    const quote = command[offset] === "'" || command[offset] === '"'
      ? command[offset++]
      : null;
    let token = '';
    if (quote) {
      const end = command.indexOf(quote, offset);
      if (end < 0) return null;
      token = command.slice(offset, end);
      if (
        token.length === 0
        || (quote === '"' && /[$`\\]/.test(token))
        || !/[\t ]/.test(command[end + 1] ?? ' ')
      ) {
        return null;
      }
      offset = end + 1;
    } else {
      const start = offset;
      while (offset < command.length && !/[\t ]/.test(command[offset])) {
        offset += 1;
      }
      token = command.slice(start, offset);
      if (/['"`$\\;&|<>(){}*?\[\]#!]/.test(token)) return null;
    }
    tokens.push(token);
  }
  return tokens;
}

export function parseGeneratedArtifactCopyCommand(command, {
  requireAbsoluteCp = false,
  candidateNames = null
} = {}) {
  const payload = unwrapSafeShellCommand(command);
  if (payload === null) return null;
  const tokens = tokenizeSafeShellCommand(payload);
  if (!tokens || tokens.length !== 3) return null;
  const [executable, artifactPath, candidateName] = tokens;
  if (
    requireAbsoluteCp
      ? executable !== '/bin/cp'
      : !['cp', '/bin/cp'].includes(executable)
  ) {
    return null;
  }
  const allowedCandidateNames = candidateNames ?? [
    'candidate.png',
    './candidate.png',
    'candidate.webp',
    './candidate.webp'
  ];
  if (
    !Array.isArray(allowedCandidateNames)
    || !allowedCandidateNames.includes(candidateName)
  ) {
    return null;
  }
  return parseGeneratedArtifactPath(artifactPath);
}

function isAbsoluteNormalizedPath(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\0-\x1f\x7f]/.test(value)) {
    return false;
  }
  if (path.posix.isAbsolute(value)) {
    return path.posix.normalize(value) === value;
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return path.win32.normalize(value) === value;
  }
  return false;
}

function isCanonicalRemoveChromaKeyCommand(tokens) {
  if (tokens.length < 4 || !isAbsoluteNormalizedPath(tokens[1])) return false;
  if (!/^python(?:3(?:\.\d+)*)?$/.test(tokens[0].toLowerCase())) return false;
  return tokens[1].replaceAll('\\', '/').toLowerCase()
    .endsWith(REMOVE_CHROMA_KEY_SUFFIX);
}

function helperAndArtifactShareCodexHome(helperPath, artifact) {
  const normalizedHelper = helperPath.replaceAll('\\', '/');
  const normalizedArtifact = artifact.path.replaceAll('\\', '/');
  const generatedImagesIndex = normalizedArtifact.toLowerCase()
    .lastIndexOf('/generated_images/');
  if (generatedImagesIndex <= 0) return false;
  const helperRoot = normalizedHelper.slice(
    0,
    normalizedHelper.length - REMOVE_CHROMA_KEY_SUFFIX.length
  );
  const artifactRoot = normalizedArtifact.slice(0, generatedImagesIndex);
  const windowsPaths = /^[A-Za-z]:\//.test(helperRoot)
    && /^[A-Za-z]:\//.test(artifactRoot);
  return windowsPaths
    ? helperRoot.toLowerCase() === artifactRoot.toLowerCase()
    : helperRoot === artifactRoot;
}

function parsePostprocessedArtifactCommand(command) {
  const payload = unwrapSafeShellCommand(command);
  if (payload === null) return null;
  const tokens = tokenizeSafeShellCommand(payload);
  if (!tokens || !isCanonicalRemoveChromaKeyCommand(tokens)) return null;
  const inputValues = [];
  for (let index = 2; index < tokens.length; index += 1) {
    if (tokens[index] === '--input') {
      if (index + 1 >= tokens.length) return null;
      inputValues.push(tokens[index + 1]);
      index += 1;
    } else if (tokens[index].startsWith('--input=')) {
      inputValues.push(tokens[index].slice('--input='.length));
    }
  }
  if (inputValues.length !== 1 || !isAbsoluteNormalizedPath(inputValues[0])) {
    return null;
  }
  const artifact = parseGeneratedArtifactPath(inputValues[0]);
  if (!artifact || !isSafePathComponent(artifact.threadId)) return null;
  if (!helperAndArtifactShareCodexHome(tokens[1], artifact)) return null;
  return artifact;
}

export function auditCodexWorkerJsonl(stdout, {
  allowExactDuplicateArtifactEvidence = false,
  allowPostprocessedArtifactEvidence = false,
  allowMixedExplicitArtifactEvidence = false
} = {}) {
  if (typeof allowExactDuplicateArtifactEvidence !== 'boolean') {
    throw new Error('Codex worker duplicate-artifact policy must be boolean');
  }
  if (typeof allowPostprocessedArtifactEvidence !== 'boolean') {
    throw new Error('Codex worker postprocessed-artifact policy must be boolean');
  }
  if (typeof allowMixedExplicitArtifactEvidence !== 'boolean') {
    throw new Error('Codex worker mixed-artifact policy must be boolean');
  }
  const source = Buffer.from(stdout ?? '').toString('utf8');
  const invocationAliasStates = new Map();
  const invocationLifecycles = new Set();
  const invocationItemCallIds = new Map();
  const artifactCandidates = [];
  const threadStartedRecords = [];
  const lines = source.split(/\r?\n/).filter(line => line.length > 0);
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Codex worker stdout line ${index + 1} is not valid JSONL`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`Codex worker stdout line ${index + 1} is not a JSON object`);
    }
    const item = event.item && typeof event.item === 'object' && !Array.isArray(event.item)
      ? event.item
      : event;
    if (event.type === 'thread.started') {
      threadStartedRecords.push(event.thread_id);
    }
    const recordType = String(item.type ?? event.type ?? '').toLowerCase();
    const isInvocation = recordType.includes('tool')
      || recordType.includes('function')
      || recordType === 'command_execution';
    if (!isInvocation) continue;
    const identity = toolIdentity(item, recordType);
    const imagegen = isImagegenToolCall(item);
    correlateToolLifecycle(
      invocationAliasStates,
      invocationLifecycles,
      invocationItemCallIds,
      {
        event,
        identity,
        imagegen,
        fallbackId: `line:${index + 1}`
      }
    );
    if (
      recordType === 'command_execution'
      && event.type === 'item.completed'
      && item.status === 'completed'
      && item.exit_code === 0
      && typeof item.command === 'string'
    ) {
      const artifact = parseGeneratedArtifactCopyCommand(item.command);
      if (artifact) artifactCandidates.push({ artifact, kind: 'copy' });
      if (allowPostprocessedArtifactEvidence) {
        const postprocessedArtifact = parsePostprocessedArtifactCommand(item.command);
        if (postprocessedArtifact) {
          artifactCandidates.push({
            artifact: postprocessedArtifact,
            kind: 'postprocess'
          });
        }
      }
    }
  }
  const explicitImagegenLifecycles = [...invocationLifecycles]
    .filter(lifecycle => lifecycle.imagegen);
  const hasExplicitImagegenRecords = explicitImagegenLifecycles.length > 0;
  const hasCompleteSuccessfulExplicitImagegenSet = (
    hasExplicitImagegenRecords
    && explicitImagegenLifecycles.every(
      lifecycle => lifecycle.terminal === 'success'
    )
  );
  const artifactImagegenCalls = new Map();
  if (artifactCandidates.length > 0) {
    if (hasExplicitImagegenRecords && !allowMixedExplicitArtifactEvidence) {
      throw new Error(
        'Codex worker has ambiguous mixed explicit-tool-call and generated-artifact evidence'
      );
    }
    if (threadStartedRecords.length !== 1) {
      throw new Error(
        'Codex worker artifact evidence requires exactly one thread.started record'
      );
    }
    const [threadId] = threadStartedRecords;
    if (!isSafePathComponent(threadId)) {
      throw new Error('Codex worker thread ID must be a safe path component');
    }
    for (const candidate of artifactCandidates) {
      const { artifact } = candidate;
      if (artifact.threadId !== threadId) {
        throw new Error(
          'Codex worker artifact evidence references a different JSONL thread: '
            + artifact.threadId
        );
      }
      const existing = artifactImagegenCalls.get(artifact.callId);
      if (existing) {
        const exactDuplicate =
          existing.path === artifact.path
          && existing.threadId === artifact.threadId
          && existing.callId === artifact.callId;
        const repeatedPostprocess = exactDuplicate && (
          candidate.kind === 'postprocess'
          && existing.kind === 'postprocess'
        );
        if (
          !exactDuplicate
          || (!allowExactDuplicateArtifactEvidence && !repeatedPostprocess)
        ) {
          throw new Error(
            `Codex worker has duplicate artifact evidence for ${artifact.callId}`
          );
        }
        continue;
      }
      artifactImagegenCalls.set(artifact.callId, {
        ...artifact,
        kind: candidate.kind
      });
    }
    if (
      artifactCandidates.some(candidate => candidate.kind === 'postprocess')
      && artifactImagegenCalls.size !== 1
    ) {
      throw new Error(
        'Codex worker postprocessed artifact evidence requires exactly one distinct artifact'
      );
    }
  }
  // Current Codex JSONL suppresses built-in image-generation events. In that
  // mode, a successful worker still has to consume the immutable artifact from
  // CODEX_HOME/generated_images/<current-thread> in a command before it can
  // write the project candidate. Legacy releases name those immutable rasters
  // call_<id>; current releases name them exec-<uuid>. Restrict fallback
  // evidence to completed, successful command records and the current JSONL
  // thread so agent-message text, failed commands, cross-thread paths, and
  // mixed evidence cannot spoof or obscure a generation call.
  const imagegenInvocationCount = hasExplicitImagegenRecords
    ? explicitImagegenLifecycles.length
    : artifactImagegenCalls.size;

  return {
    invocationCount: invocationLifecycles.size,
    imagegenInvocationCount,
    imagegenEvidence: hasCompleteSuccessfulExplicitImagegenSet
      ? 'explicit-tool-call'
      : artifactImagegenCalls.size > 0
        ? 'generated-artifact'
        : 'none',
    imagegenArtifacts: [...artifactImagegenCalls.values()].map(
      ({ kind: _kind, ...artifact }) => artifact
    ),
    invocations: [...invocationLifecycles].map(({ id, tool }) => ({ id, tool }))
  };
}

function codexHome(environmentSource) {
  if (
    typeof environmentSource.CODEX_HOME === 'string'
    && environmentSource.CODEX_HOME.length > 0
  ) {
    return path.resolve(environmentSource.CODEX_HOME);
  }
  if (
    typeof environmentSource.HOME === 'string'
    && environmentSource.HOME.length > 0
  ) {
    return path.resolve(environmentSource.HOME, '.codex');
  }
  throw new Error('Codex worker artifact verification requires CODEX_HOME or HOME');
}

function strictCodexHome(environmentSource) {
  const configured = typeof environmentSource?.CODEX_HOME === 'string'
    && environmentSource.CODEX_HOME.length > 0
    ? environmentSource.CODEX_HOME
    : typeof environmentSource?.HOME === 'string'
      && environmentSource.HOME.length > 0
      ? path.join(environmentSource.HOME, '.codex')
      : null;
  if (configured === null) {
    throw new Error(
      'Codex parent handoff artifact resolution requires CODEX_HOME or HOME'
    );
  }
  if (!path.isAbsolute(configured) || path.normalize(configured) !== configured) {
    throw new Error(
      'Codex parent handoff CODEX_HOME must resolve from an absolute normalized environment path'
    );
  }
  return configured;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative)
  );
}

const DEFAULT_FILESYSTEM_SOURCE = Object.freeze({
  lstat,
  open,
  readdir,
  realpath
});
const NOFOLLOW_FILE_FLAGS =
  fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const NOFOLLOW_DIRECTORY_FLAGS = NOFOLLOW_FILE_FLAGS
  | (fsConstants.O_DIRECTORY ?? 0);

function sameFilesystemIdentity(left, right) {
  return (
    left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
  );
}

function sameReadIdentity(left, right) {
  return (
    sameFilesystemIdentity(left, right)
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
  );
}

async function readStableRegularFile(filePath, label, filesystem) {
  const details = await filesystem.lstat(filePath, { bigint: true });
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  const realPath = await filesystem.realpath(filePath);
  const handle = await filesystem.open(filePath, NOFOLLOW_FILE_FLAGS);
  try {
    const openedDetails = await handle.stat({ bigint: true });
    if (!openedDetails.isFile() || !sameReadIdentity(details, openedDetails)) {
      throw new Error(`${label} changed before secure read`);
    }
    const bytes = await handle.readFile();
    const [openedAfter, pathAfter, realPathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      filesystem.lstat(filePath, { bigint: true }),
      filesystem.realpath(filePath)
    ]);
    if (
      !sameReadIdentity(openedDetails, openedAfter)
      || !sameReadIdentity(openedAfter, pathAfter)
      || realPathAfter !== realPath
    ) {
      throw new Error(`${label} changed during secure read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function verifyCodexImagegenEvidence(audit, {
  environmentSource = process.env,
  candidatePath = null,
  requireCandidateByteIdentity = false,
  returnGeneratedArtifactBytes = false,
  filesystemSource = null
} = {}) {
  const explicitEvidence = audit.imagegenEvidence === 'explicit-tool-call';
  const artifactEvidence = audit.imagegenEvidence === 'generated-artifact';
  if (!explicitEvidence && !artifactEvidence) {
    throw new Error('Codex worker has no verifiable imagegen evidence');
  }
  if (explicitEvidence && audit.imagegenInvocationCount < 1) {
    throw new Error('Codex worker explicit imagegen evidence is empty');
  }
  if (
    artifactEvidence
    && (
      audit.imagegenInvocationCount < 1
      || audit.imagegenArtifacts.length !== audit.imagegenInvocationCount
    )
  ) {
    throw new Error('Codex worker has no verifiable imagegen evidence');
  }
  if (requireCandidateByteIdentity && candidatePath === null) {
    throw new Error('candidatePath is required for imagegen artifact byte verification');
  }
  if (typeof returnGeneratedArtifactBytes !== 'boolean') {
    throw new Error('generated artifact byte-return policy must be boolean');
  }
  if (
    returnGeneratedArtifactBytes
    && (
      !artifactEvidence
      || audit.imagegenInvocationCount !== 1
      || audit.imagegenArtifacts.length !== 1
    )
  ) {
    throw new Error(
      'returning generated artifact bytes requires exactly one artifact evidence record'
    );
  }
  const filesystem = filesystemSource === null
    ? DEFAULT_FILESYSTEM_SOURCE
    : { ...DEFAULT_FILESYSTEM_SOURCE, ...filesystemSource };
  const candidateBytes = candidatePath === null
    ? null
    : await readStableRegularFile(
      candidatePath,
      'Codex worker candidate',
      filesystem
    );
  if (explicitEvidence) {
    return {
      evidence: audit.imagegenEvidence,
      artifacts: [],
      candidateBytes
    };
  }

  const generatedImagesRoot = path.resolve(
    codexHome(environmentSource),
    'generated_images'
  );
  const [threadId] = new Set(
    audit.imagegenArtifacts.map(artifact => artifact.threadId)
  );
  if (
    !isSafePathComponent(threadId)
    || audit.imagegenArtifacts.some(artifact => artifact.threadId !== threadId)
  ) {
    throw new Error('Codex worker generated-artifact evidence must belong to one thread');
  }
  const expectedThreadRoot = path.resolve(generatedImagesRoot, threadId);
  if (!isDirectChild(generatedImagesRoot, expectedThreadRoot)) {
    throw new Error(
      'Codex worker generated-artifact thread root must be a direct child of generated_images'
    );
  }
  const generatedImagesRootDetails = await filesystem.lstat(
    generatedImagesRoot,
    { bigint: true }
  );
  if (
    !generatedImagesRootDetails.isDirectory()
    || generatedImagesRootDetails.isSymbolicLink()
  ) {
    throw new Error('Codex worker generated_images root must be a real directory');
  }
  const realGeneratedImagesRoot = await filesystem.realpath(generatedImagesRoot);
  const threadRootDetails = await filesystem.lstat(
    expectedThreadRoot,
    { bigint: true }
  );
  if (!threadRootDetails.isDirectory() || threadRootDetails.isSymbolicLink()) {
    throw new Error('Codex worker thread root must be a real directory');
  }
  const realThreadRoot = await filesystem.realpath(expectedThreadRoot);
  if (!isDirectChild(realGeneratedImagesRoot, realThreadRoot)) {
    throw new Error(
      'Codex worker thread root must remain a direct child of generated_images'
    );
  }
  const threadHandle = await filesystem.open(
    expectedThreadRoot,
    NOFOLLOW_DIRECTORY_FLAGS
  );
  try {
    const openedThreadDetails = await threadHandle.stat({ bigint: true });
    if (
      !openedThreadDetails.isDirectory()
      || !sameFilesystemIdentity(threadRootDetails, openedThreadDetails)
    ) {
      throw new Error(
        'Codex worker thread root changed before secure artifact verification'
      );
    }
    const threadEntries = await filesystem.readdir(realThreadRoot, {
      withFileTypes: true
    });
    const generatedRasterNames = [];
    for (const entry of threadEntries) {
      if (!GENERATED_RASTER_NAME_PATTERN.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(
          `Codex worker thread artifact must be a regular non-symlink file: ${entry.name}`
        );
      }
      generatedRasterNames.push(entry.name);
    }
    const referencedRasterNames = new Set(
      audit.imagegenArtifacts.map(artifact => path.basename(artifact.path))
    );
    if (
      generatedRasterNames.length !== audit.imagegenInvocationCount
      || generatedRasterNames.length !== referencedRasterNames.size
      || generatedRasterNames.some(name => !referencedRasterNames.has(name))
    ) {
      throw new Error(
        'Codex worker thread must contain exactly the referenced imagegen artifact set; '
        + `found ${generatedRasterNames.length}, referenced ${referencedRasterNames.size}`
      );
    }

    const verified = [];
    let generatedArtifactBytes = null;
    for (const artifact of audit.imagegenArtifacts) {
      const artifactPath = path.resolve(artifact.path);
      if (!isWithin(expectedThreadRoot, artifactPath)) {
        throw new Error(
          `Codex worker artifact is outside its current-thread generated-images root: ${artifact.path}`
        );
      }
      let details;
      try {
        details = await filesystem.lstat(artifactPath, { bigint: true });
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`Codex worker generated artifact does not exist: ${artifact.path}`);
        }
        throw error;
      }
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error(`Codex worker generated artifact must be a regular non-symlink file: ${artifact.path}`);
      }
      const realArtifactPath = await filesystem.realpath(artifactPath);
      if (!isWithin(realThreadRoot, realArtifactPath)) {
        throw new Error(
          `Codex worker generated artifact resolves outside its thread root: ${artifact.path}`
        );
      }
      const artifactHandle = await filesystem.open(
        artifactPath,
        NOFOLLOW_FILE_FLAGS
      );
      try {
        const openedDetails = await artifactHandle.stat({ bigint: true });
        if (
          !openedDetails.isFile()
          || !sameReadIdentity(details, openedDetails)
        ) {
          throw new Error(
            `Codex worker generated artifact changed before secure read: ${artifact.path}`
          );
        }
        if (
          requireCandidateByteIdentity
          || returnGeneratedArtifactBytes
        ) {
          const artifactBytes = await artifactHandle.readFile();
          if (
            requireCandidateByteIdentity
            && !artifactBytes.equals(candidateBytes)
          ) {
            throw new Error(
              'source-template candidate must be byte-identical to the one generated artifact'
            );
          }
          if (returnGeneratedArtifactBytes) {
            generatedArtifactBytes = artifactBytes;
          }
        }
        const [openedAfter, pathAfter, realPathAfter] = await Promise.all([
          artifactHandle.stat({ bigint: true }),
          filesystem.lstat(artifactPath, { bigint: true }),
          filesystem.realpath(artifactPath)
        ]);
        if (
          !sameReadIdentity(openedDetails, openedAfter)
          || !sameReadIdentity(openedAfter, pathAfter)
          || realPathAfter !== realArtifactPath
        ) {
          throw new Error(
            `Codex worker generated artifact changed during secure read: ${artifact.path}`
          );
        }
        verified.push({
          ...artifact,
          path: realArtifactPath,
          bytes: Number(openedAfter.size),
          identity: {
            device: String(openedAfter.dev),
            inode: String(openedAfter.ino),
            size: String(openedAfter.size),
            mtimeNs: String(openedAfter.mtimeNs),
            ctimeNs: String(openedAfter.ctimeNs)
          }
        });
      } finally {
        await artifactHandle.close();
      }
    }
    const [
      generatedImagesRootAfter,
      threadRootAfter,
      openedThreadAfter
    ] = await Promise.all([
      filesystem.lstat(generatedImagesRoot, { bigint: true }),
      filesystem.lstat(expectedThreadRoot, { bigint: true }),
      threadHandle.stat({ bigint: true })
    ]);
    if (
      !sameReadIdentity(
        generatedImagesRootDetails,
        generatedImagesRootAfter
      )
      || !sameReadIdentity(threadRootDetails, threadRootAfter)
      || !sameReadIdentity(openedThreadDetails, openedThreadAfter)
      || !sameFilesystemIdentity(threadRootAfter, openedThreadAfter)
    ) {
      throw new Error(
        'Codex worker generated-images thread path changed during verification'
      );
    }
    return {
      evidence: audit.imagegenEvidence,
      artifacts: verified,
      candidateBytes,
      generatedArtifactBytes
    };
  } finally {
    await threadHandle.close();
  }
}

export async function resolveCodexCurrentThreadImagegenArtifact({
  threadId,
  environmentSource = process.env,
  filesystemSource = null
} = {}) {
  if (!isSafePathComponent(threadId)) {
    throw new Error(
      'Codex parent handoff thread ID must be a safe path component'
    );
  }
  const filesystem = filesystemSource === null
    ? DEFAULT_FILESYSTEM_SOURCE
    : { ...DEFAULT_FILESYSTEM_SOURCE, ...filesystemSource };
  const home = strictCodexHome(environmentSource);
  const homeDetails = await filesystem.lstat(home, { bigint: true });
  if (!homeDetails.isDirectory() || homeDetails.isSymbolicLink()) {
    throw new Error('Codex parent handoff CODEX_HOME must be a real directory');
  }
  const generatedImagesRoot = path.join(home, 'generated_images');
  const generatedImagesDetails = await filesystem.lstat(
    generatedImagesRoot,
    { bigint: true }
  );
  if (
    !generatedImagesDetails.isDirectory()
    || generatedImagesDetails.isSymbolicLink()
  ) {
    throw new Error(
      'Codex parent handoff generated_images root must be a real directory'
    );
  }
  const threadRoot = path.join(generatedImagesRoot, threadId);
  if (!isDirectChild(generatedImagesRoot, threadRoot)) {
    throw new Error(
      'Codex parent handoff thread root must be a direct generated_images child'
    );
  }
  const threadDetails = await filesystem.lstat(threadRoot, { bigint: true });
  if (!threadDetails.isDirectory() || threadDetails.isSymbolicLink()) {
    throw new Error(
      'Codex parent handoff thread root must be a real directory'
    );
  }
  const [realHome, realGeneratedImagesRoot, realThreadRoot] =
    await Promise.all([
      filesystem.realpath(home),
      filesystem.realpath(generatedImagesRoot),
      filesystem.realpath(threadRoot)
    ]);
  if (
    !isDirectChild(realHome, realGeneratedImagesRoot)
    || !isDirectChild(realGeneratedImagesRoot, realThreadRoot)
  ) {
    throw new Error(
      'Codex parent handoff ancestor directories must retain canonical direct-child identities'
    );
  }
  const handles = [];
  try {
    for (const directory of [home, generatedImagesRoot, threadRoot]) {
      handles.push(await filesystem.open(directory, NOFOLLOW_DIRECTORY_FLAGS));
    }
    const openedDetails = await Promise.all(
      handles.map(handle => handle.stat({ bigint: true }))
    );
    const initialDetails = [
      homeDetails,
      generatedImagesDetails,
      threadDetails
    ];
    if (openedDetails.some((details, index) => (
      !details.isDirectory()
      || !sameFilesystemIdentity(details, initialDetails[index])
    ))) {
      throw new Error(
        'Codex parent handoff ancestor directory changed before verification'
      );
    }

    const entries = await filesystem.readdir(threadRoot, {
      withFileTypes: true
    });
    const rasters = entries.filter(entry => (
      GENERATED_RASTER_NAME_PATTERN.test(entry.name)
    ));
    for (const entry of rasters) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(
          `Codex parent handoff raster must be a regular non-symlink file: ${entry.name}`
        );
      }
    }
    if (rasters.length !== 1) {
      throw new Error(
        'Codex parent handoff current thread must contain exactly one matching '
        + `imagegen raster; found ${rasters.length}`
      );
    }
    const artifactPath = path.join(threadRoot, rasters[0].name);
    const artifact = parseGeneratedArtifactPath(artifactPath);
    if (artifact === null || artifact.threadId !== threadId) {
      throw new Error('Codex parent handoff resolved an unsafe raster identity');
    }
    const audit = {
      imagegenEvidence: 'generated-artifact',
      imagegenInvocationCount: 1,
      imagegenArtifacts: [artifact]
    };
    const verification = await verifyCodexImagegenEvidence(audit, {
      environmentSource,
      returnGeneratedArtifactBytes: true,
      filesystemSource: filesystem
    });
    const [pathDetailsAfter, openedDetailsAfter, realPathsAfter] =
      await Promise.all([
        Promise.all([
          filesystem.lstat(home, { bigint: true }),
          filesystem.lstat(generatedImagesRoot, { bigint: true }),
          filesystem.lstat(threadRoot, { bigint: true })
        ]),
        Promise.all(handles.map(handle => handle.stat({ bigint: true }))),
        Promise.all([
          filesystem.realpath(home),
          filesystem.realpath(generatedImagesRoot),
          filesystem.realpath(threadRoot)
        ])
      ]);
    const initialRealPaths = [
      realHome,
      realGeneratedImagesRoot,
      realThreadRoot
    ];
    if (pathDetailsAfter.some((details, index) => (
      !details.isDirectory()
      || details.isSymbolicLink()
      || !sameReadIdentity(initialDetails[index], details)
      || !sameReadIdentity(openedDetails[index], openedDetailsAfter[index])
      || !sameFilesystemIdentity(details, openedDetailsAfter[index])
      || realPathsAfter[index] !== initialRealPaths[index]
    ))) {
      throw new Error(
        'Codex parent handoff ancestor directory path changed during verification'
      );
    }
    return {
      threadId,
      artifact: verification.artifacts[0],
      bytes: verification.generatedArtifactBytes,
      verificationAudit: audit
    };
  } finally {
    await Promise.all(handles.reverse().map(handle => handle.close()));
  }
}
