import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '../..');
const rateLimitTestDirectory = path.join(__dirname, 'ratelimit');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function allocateLoopbackPort() {
  const socket = net.createServer();

  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });

  const address = socket.address();
  const port = address.port;

  await new Promise((resolve, reject) => {
    socket.close(error => error ? reject(error) : resolve());
  });

  return port;
}

function signalChild(child, signal, processGroup) {
  if (processGroup && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  }
  child.kill(signal);
}

async function terminateChild(child, { processGroup = false } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exitPromise = once(child, 'exit');
  signalChild(child, 'SIGTERM', processGroup);

  const exited = await Promise.race([
    exitPromise.then(() => true),
    delay(5000).then(() => false)
  ]);

  if (!exited && child.exitCode === null && child.signalCode === null) {
    const forcedExitPromise = once(child, 'exit');
    signalChild(child, 'SIGKILL', processGroup);
    await forcedExitPromise;
  }
}

async function waitForServer(baseUrl, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        'Rate-limit test server exited before becoming ready ' +
        `(code=${child.exitCode}, signal=${child.signalCode})`
      );
    }

    try {
      const response = await fetch(`${baseUrl}/api/health/live`, {
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(100);
  }

  throw new Error(
    `Timed out waiting for rate-limit test server: ${lastError?.message || 'unknown error'}`
  );
}

let testProcess = null;

async function runTests(environment) {
  const entries = await readdir(rateLimitTestDirectory);
  const testFiles = entries
    .filter(entry => entry.endsWith('.test.js'))
    .sort()
    .map(entry => path.join(rateLimitTestDirectory, entry));

  if (testFiles.length === 0) {
    throw new Error('No rate-limit test files found');
  }

  testProcess = spawn(
    process.execPath,
    ['--test', '--test-concurrency=1', ...testFiles],
    {
      cwd: apiRoot,
      env: environment,
      stdio: 'inherit',
      detached: process.platform !== 'win32'
    }
  );

  const timeoutMs = Number.parseInt(
    environment.RATE_LIMIT_TEST_TIMEOUT_MS || '120000',
    10
  );
  let timeout = null;
  const result = await Promise.race([
    once(testProcess, 'exit'),
    new Promise(resolve => {
      timeout = setTimeout(() => resolve(null), timeoutMs);
    })
  ]);
  clearTimeout(timeout);

  if (!result) {
    await terminateChild(testProcess, { processGroup: true });
    throw new Error(`Rate-limit tests timed out after ${timeoutMs}ms`);
  }

  const [code, signal] = result;
  if (signal) {
    throw new Error(`Rate-limit tests terminated by ${signal}`);
  }
  return code ?? 1;
}

let serverProcess = null;
let handlingSignal = false;

async function handleSignal(signal, exitCode) {
  if (handlingSignal) {
    return;
  }
  handlingSignal = true;
  console.error(`Received ${signal}; stopping owned rate-limit test processes`);
  await terminateChild(testProcess, { processGroup: true });
  await terminateChild(serverProcess);
  process.exit(exitCode);
}

process.once('SIGINT', () => {
  void handleSignal('SIGINT', 130);
});
process.once('SIGTERM', () => {
  void handleSignal('SIGTERM', 143);
});

let testExitCode = 1;

try {
  const port = await allocateLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    TEST_RATE_LIMITS: 'true',
    TEST_REDIS: '',
    REDIS_URL: '',
    PORT: String(port),
    TEST_API_BASE_URL: baseUrl
  };

  serverProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: apiRoot,
    env: environment,
    stdio: 'inherit'
  });

  await waitForServer(baseUrl, serverProcess);
  testExitCode = await runTests(environment);
} catch (error) {
  console.error(error);
} finally {
  await terminateChild(serverProcess);
}

process.exitCode = testExitCode;
