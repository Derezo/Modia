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

export function auditCodexWorkerJsonl(stdout) {
  const source = Buffer.from(stdout ?? '').toString('utf8');
  const invocations = new Map();
  const explicitImagegenCalls = new Set();
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
    const recordType = String(item.type ?? event.type ?? '').toLowerCase();
    const isInvocation = recordType.includes('tool')
      || recordType.includes('function')
      || recordType === 'command_execution';
    if (!isInvocation) continue;
    const identity = toolIdentity(item, recordType);
    const invocationId = String(
      item.id ?? item.call_id ?? event.call_id ?? `line:${index + 1}`
    );
    invocations.set(
      `${identity}:${invocationId}`,
      { id: invocationId, tool: identity }
    );
    if (isImagegenToolCall(item)) explicitImagegenCalls.add(invocationId);
  }

  return {
    invocationCount: invocations.size,
    imagegenInvocationCount: explicitImagegenCalls.size,
    invocations: [...invocations.values()]
  };
}
