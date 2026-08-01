import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  acquirePersistentExclusiveLock,
  acquirePersistentExclusiveLocks,
  releasePersistentExclusiveLock,
  releasePersistentExclusiveLocks
} from './persistent-exclusive-lock.mjs';

function tryNonblockingLock(lockPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'flock',
      ['--nonblock', '--exclusive', lockPath, 'true'],
      { stdio: 'ignore' }
    );
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function waitForClose(child, timeoutMs, label) {
  return Promise.race([
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    }),
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        timeoutMs
      );
      timeout.unref();
    })
  ]);
}

test('single persistent lock holds the requested lock file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-single-'));
  const lockPath = path.join(root, 'requested.lock');
  const lock = await acquirePersistentExclusiveLock({ lockPath });

  try {
    assert.deepEqual(
      await tryNonblockingLock(lockPath),
      { code: 1, signal: null }
    );
  } finally {
    await releasePersistentExclusiveLock(lock);
  }

  assert.deepEqual(
    await tryNonblockingLock(lockPath),
    { code: 0, signal: null }
  );
});

test('persistent lock group holds every requested lock file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-group-'));
  const firstPath = path.join(root, 'first.lock');
  const secondPath = path.join(root, 'second.lock');
  const lock = await acquirePersistentExclusiveLocks({
    locks: [
      { lockPath: firstPath },
      { lockPath: secondPath }
    ]
  });

  try {
    assert.deepEqual(
      await tryNonblockingLock(firstPath),
      { code: 1, signal: null }
    );
    assert.deepEqual(
      await tryNonblockingLock(secondPath),
      { code: 1, signal: null }
    );
  } finally {
    await releasePersistentExclusiveLocks(lock);
  }

  assert.deepEqual(
    await tryNonblockingLock(firstPath),
    { code: 0, signal: null }
  );
  assert.deepEqual(
    await tryNonblockingLock(secondPath),
    { code: 0, signal: null }
  );
});

test('aborting a waiting persistent lock terminates its holder and preserves cause', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-abort-'));
  const lockPath = path.join(root, 'requested.lock');
  const held = await acquirePersistentExclusiveLock({ lockPath });
  const controller = new AbortController();
  const originalFailure = new Error('sibling generation failed');
  const waiting = acquirePersistentExclusiveLock({
    lockPath,
    signal: controller.signal
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  controller.abort(originalFailure);
  await assert.rejects(waiting, error => {
    assert.equal(error.code, 'PERSISTENT_LOCK_CANCELLED');
    assert.equal(error.cause, originalFailure);
    return true;
  });
  await releasePersistentExclusiveLock(held);
  assert.deepEqual(
    await tryNonblockingLock(lockPath),
    { code: 0, signal: null }
  );
});

test('persistent lock rechecks cancellation after final pathname validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-final-abort-'));
  const lockPath = path.join(root, 'requested.lock');
  const originalFailure = new Error('cancelled during final pathname check');
  let abortedReads = 0;
  const signal = {
    get aborted() {
      abortedReads += 1;
      return abortedReads >= 5;
    },
    reason: originalFailure,
    addEventListener() {},
    removeEventListener() {}
  };
  await assert.rejects(
    acquirePersistentExclusiveLock({ lockPath, signal }),
    error => {
      assert.equal(error.code, 'PERSISTENT_LOCK_CANCELLED');
      assert.equal(error.cause, originalFailure);
      return true;
    }
  );
  assert.ok(abortedReads >= 5);
  assert.deepEqual(
    await tryNonblockingLock(lockPath),
    { code: 0, signal: null }
  );
});

test('lock cancellation remains primary when holder termination also fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-cleanup-error-'));
  const lockPath = path.join(root, 'requested.lock');
  const controller = new AbortController();
  const originalFailure = new Error('cancel acquisition');
  const terminationFailure = Object.assign(
    new Error('simulated holder termination failure'),
    { code: 'TEST_LOCK_TERMINATION_FAILURE' }
  );
  let markSpawned;
  const spawned = new Promise(resolve => {
    markSpawned = resolve;
  });
  const killSignals = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = 987_654_321;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closeScheduled = false;
    child.kill = signal => {
      killSignals.push(signal);
      if (!closeScheduled) {
        closeScheduled = true;
        queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      }
      throw terminationFailure;
    };
    markSpawned();
    return child;
  };
  const pending = acquirePersistentExclusiveLock({
    lockPath,
    signal: controller.signal,
    spawnImpl
  });
  await spawned;
  controller.abort(originalFailure);
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'PERSISTENT_LOCK_CANCELLED');
    assert.equal(error.cause, originalFailure);
    assert.ok(error.secondaryFailures.some(diagnostic =>
      diagnostic.code === terminationFailure.code
    ));
    return true;
  });
  assert.deepEqual(killSignals, ['SIGTERM']);
  assert.deepEqual(
    await tryNonblockingLock(lockPath),
    { code: 0, signal: null }
  );
});

test('lock cancellation remains bounded when holder signals fail and close never arrives', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-no-close-'));
  const lockPath = path.join(root, 'requested.lock');
  const controller = new AbortController();
  const originalFailure = new Error('cancel no-close acquisition');
  const signalFailure = Object.assign(new Error('operation not permitted'), {
    code: 'EPERM'
  });
  let markSpawned;
  const spawned = new Promise(resolve => {
    markSpawned = resolve;
  });
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = 987_654_322;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      throw signalFailure;
    };
    markSpawned();
    return child;
  };
  const startedAt = Date.now();
  const pending = acquirePersistentExclusiveLock({
    lockPath,
    signal: controller.signal,
    spawnImpl,
    terminationGraceMs: 20
  });
  await spawned;
  controller.abort(originalFailure);
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'PERSISTENT_LOCK_CANCELLED');
    assert.equal(error.cause, originalFailure);
    assert.ok(error.secondaryFailures.some(diagnostic =>
      diagnostic.code === 'PERSISTENT_LOCK_HOLDER_CLEANUP_TIMEOUT'
    ));
    return true;
  });
  assert.ok(Date.now() - startedAt < 300);
  assert.deepEqual(
    await tryNonblockingLock(lockPath),
    { code: 0, signal: null }
  );
});

test('external parent signal terminates a waiting lock-acquisition helper', {
  skip: process.platform !== 'linux'
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-lock-signal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = path.join(root, 'requested.lock');
  const held = await acquirePersistentExclusiveLock({ lockPath });
  let heldReleased = false;
  t.after(async () => {
    if (!heldReleased) await releasePersistentExclusiveLock(held);
  });
  const moduleUrl = new URL('./persistent-exclusive-lock.mjs', import.meta.url).href;
  const wrapper = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { acquirePersistentExclusiveLock } =
  await import(${JSON.stringify(moduleUrl)});
await acquirePersistentExclusiveLock({ lockPath: ${JSON.stringify(lockPath)} });`
    ],
    { detached: true, stdio: 'ignore' }
  );
  t.after(() => {
    if (!processIsAlive(wrapper.pid)) return;
    try {
      process.kill(-wrapper.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
  const helperPid = await waitFor(async () => {
    const children = await readFile(
      `/proc/${wrapper.pid}/task/${wrapper.pid}/children`,
      'utf8'
    ).catch(() => '');
    return Number(children.trim().split(/\s+/)[0]) || null;
  }, 2_000, 'waiting lock helper PID');
  assert.equal(processIsAlive(helperPid), true);
  wrapper.kill('SIGTERM');
  assert.deepEqual(
    await waitForClose(wrapper, 3_000, 'lock wrapper shutdown'),
    { code: null, signal: 'SIGTERM' }
  );
  await waitFor(
    () => !processIsAlive(helperPid),
    2_000,
    'waiting lock helper exit'
  );
  await releasePersistentExclusiveLock(held);
  heldReleased = true;
  assert.deepEqual(
    await tryNonblockingLock(lockPath),
    { code: 0, signal: null }
  );
});

test('external signals terminate a group helper after its partial lock acquisition', {
  skip: process.platform !== 'linux'
}, async t => {
  const moduleUrl = new URL('./persistent-exclusive-lock.mjs', import.meta.url).href;
  for (const externalSignal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    await t.test(externalSignal, async t => {
      const root = await mkdtemp(path.join(
        os.tmpdir(),
        `modia-lock-group-signal-${externalSignal.toLowerCase()}-`
      ));
      t.after(() => rm(root, { recursive: true, force: true }));
      const firstPath = path.join(root, 'first.lock');
      const secondPath = path.join(root, 'second.lock');
      const heldSecond = await acquirePersistentExclusiveLock({
        lockPath: secondPath
      });
      let heldSecondReleased = false;
      t.after(async () => {
        if (!heldSecondReleased) {
          await releasePersistentExclusiveLock(heldSecond);
        }
      });
      const wrapper = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const { acquirePersistentExclusiveLocks } =
  await import(${JSON.stringify(moduleUrl)});
await acquirePersistentExclusiveLocks({
  locks: [
    { lockPath: ${JSON.stringify(firstPath)} },
    { lockPath: ${JSON.stringify(secondPath)} }
  ]
});`
        ],
        { detached: true, stdio: 'ignore' }
      );
      t.after(() => {
        if (!processIsAlive(wrapper.pid)) return;
        try {
          process.kill(-wrapper.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      });
      const helperPid = await waitFor(async () => {
        const children = await readFile(
          `/proc/${wrapper.pid}/task/${wrapper.pid}/children`,
          'utf8'
        ).catch(() => '');
        return Number(children.trim().split(/\s+/)[0]) || null;
      }, 2_000, `${externalSignal} group helper PID`);
      await waitFor(async () => (
        (await tryNonblockingLock(firstPath)).code === 1
      ), 2_000, `${externalSignal} first partial lock`);
      wrapper.kill(externalSignal);
      assert.deepEqual(
        await waitForClose(wrapper, 3_000, `${externalSignal} group wrapper`),
        { code: null, signal: externalSignal }
      );
      await waitFor(
        () => !processIsAlive(helperPid),
        2_000,
        `${externalSignal} group helper exit`
      );
      assert.deepEqual(
        await tryNonblockingLock(firstPath),
        { code: 0, signal: null }
      );
      await releasePersistentExclusiveLock(heldSecond);
      heldSecondReleased = true;
    });
  }
});
