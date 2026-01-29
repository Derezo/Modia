/**
 * Cross-Process File Locking Unit Tests
 * Tests for the cross-process file locking utility
 *
 * @module crossProcessLock.unit.test
 * @description Tests lock acquisition, release, exclusive access, stale lock handling,
 * security validations, and error handling for both async and sync variants.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'fs';
import {
  existsSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  statSync,
  readdirSync,
  rmSync,
  readFileSync
} from 'fs';
import path from 'path';
import os from 'os';

import crossProcessLock, {
  acquireLockAsync,
  releaseLockAsync,
  withFileLockAsync,
  acquireLockSync,
  releaseLockSync,
  withFileLockSync
} from '../../utils/crossProcessLock.js';

// getLockPath is only available via default export
const { getLockPath } = crossProcessLock;

describe('crossProcessLock', () => {
  const testDir = path.join(os.tmpdir(), `crossprocesslock-test-${process.pid}-${Date.now()}`);
  const testLockDir = path.join(testDir, '.locks');
  const testFile = path.join(testDir, 'test.json');

  before(() => {
    mkdirSync(testDir, { recursive: true });
  });

  after(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Clean lock directory before each test
    if (existsSync(testLockDir)) {
      try {
        const files = readdirSync(testLockDir);
        files.forEach(f => {
          try {
            unlinkSync(path.join(testLockDir, f));
          } catch {
            // Ignore individual file cleanup errors
          }
        });
      } catch {
        // Ignore directory read errors
      }
    }
  });

  afterEach(() => {
    // Clean lock directory after each test for isolation
    if (existsSync(testLockDir)) {
      try {
        const files = readdirSync(testLockDir);
        files.forEach(f => {
          try {
            unlinkSync(path.join(testLockDir, f));
          } catch {
            // Ignore individual file cleanup errors
          }
        });
      } catch {
        // Ignore directory read errors
      }
    }
  });

  describe('getLockPath', () => {
    it('should return a path in the lock directory', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      assert.ok(lockPath.startsWith(testLockDir));
      assert.ok(lockPath.endsWith('.lock'));
    });

    it('should sanitize file paths to safe filenames', () => {
      const weirdPath = '/some/path/with spaces/and:colons/file.json';
      const lockPath = getLockPath(weirdPath, testLockDir);

      // Should not contain special characters that could cause issues
      const filename = path.basename(lockPath);
      assert.ok(!filename.includes('/'));
      assert.ok(!filename.includes(':'));
      assert.ok(!filename.includes(' '));
    });

    it('should produce consistent paths for the same input', () => {
      const path1 = getLockPath(testFile, testLockDir);
      const path2 = getLockPath(testFile, testLockDir);

      assert.strictEqual(path1, path2);
    });

    it('should produce different paths for different files', () => {
      const path1 = getLockPath('/path/to/file1.json', testLockDir);
      const path2 = getLockPath('/path/to/file2.json', testLockDir);

      assert.notStrictEqual(path1, path2);
    });

    it('should truncate very long paths', () => {
      const longPath = '/very/long/path/' + 'a'.repeat(500) + '.json';
      const lockPath = getLockPath(longPath, testLockDir);

      // Filename should be reasonable length (200 char limit + .lock)
      const filename = path.basename(lockPath);
      assert.ok(filename.length <= 210);
    });
  });

  describe('acquireLockAsync', () => {
    it('should create lock file with pid and timestamp', async () => {
      const result = await acquireLockAsync(testFile, { lockDir: testLockDir });

      assert.strictEqual(result.acquired, true);
      assert.ok(existsSync(result.lockPath));

      const content = JSON.parse(await fs.readFile(result.lockPath, 'utf8'));
      assert.strictEqual(content.pid, process.pid);
      assert.ok(content.timestamp > 0);
      assert.strictEqual(content.file, testFile);

      await releaseLockAsync(result.lockPath);
    });

    it('should create lock file with correct permissions (0o600)', async () => {
      const result = await acquireLockAsync(testFile, { lockDir: testLockDir });

      assert.strictEqual(result.acquired, true);

      const stat = statSync(result.lockPath);
      // Check file permissions (owner read/write only)
      const mode = stat.mode & 0o777;
      assert.strictEqual(mode, 0o600, `Expected 0o600, got 0o${mode.toString(8)}`);

      await releaseLockAsync(result.lockPath);
    });

    it('should create lock directory with secure permissions (0o700)', async () => {
      const newLockDir = path.join(testDir, '.new-locks');

      // Ensure directory doesn't exist
      if (existsSync(newLockDir)) {
        rmSync(newLockDir, { recursive: true });
      }

      const result = await acquireLockAsync(testFile, { lockDir: newLockDir });

      assert.strictEqual(result.acquired, true);

      const stat = statSync(newLockDir);
      const mode = stat.mode & 0o777;
      assert.strictEqual(mode, 0o700, `Expected 0o700, got 0o${mode.toString(8)}`);

      await releaseLockAsync(result.lockPath);
    });

    it('should return acquired: false after max retries when lock is held', async () => {
      // Acquire first lock
      const firstLock = await acquireLockAsync(testFile, { lockDir: testLockDir });
      assert.strictEqual(firstLock.acquired, true);

      // Try to acquire second lock with minimal retries
      const secondLock = await acquireLockAsync(testFile, {
        lockDir: testLockDir,
        maxRetries: 3,
        retryDelayMs: 10
      });

      assert.strictEqual(secondLock.acquired, false);

      await releaseLockAsync(firstLock.lockPath);
    });

    it('should successfully acquire lock after previous lock is released', async () => {
      // Acquire first lock
      const firstLock = await acquireLockAsync(testFile, { lockDir: testLockDir });
      assert.strictEqual(firstLock.acquired, true);

      // Release first lock
      await releaseLockAsync(firstLock.lockPath);

      // Acquire second lock
      const secondLock = await acquireLockAsync(testFile, { lockDir: testLockDir });
      assert.strictEqual(secondLock.acquired, true);

      await releaseLockAsync(secondLock.lockPath);
    });
  });

  describe('acquireLockSync', () => {
    it('should create lock file with pid and timestamp', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });

      assert.strictEqual(result.acquired, true);
      assert.ok(existsSync(result.lockPath));

      const content = JSON.parse(readFileSync(result.lockPath, 'utf8'));
      assert.strictEqual(content.pid, process.pid);
      assert.ok(content.timestamp > 0);
      assert.strictEqual(content.file, testFile);

      releaseLockSync(result.lockPath);
    });

    it('should create lock file exclusively', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });
      assert.strictEqual(result.acquired, true);

      // Second attempt with minimal retries should fail
      const secondResult = acquireLockSync(testFile, {
        lockDir: testLockDir,
        maxRetries: 2,
        retryDelayMs: 5
      });

      assert.strictEqual(secondResult.acquired, false);

      releaseLockSync(result.lockPath);
    });

    it('should create lock file with correct permissions (0o600)', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });

      assert.strictEqual(result.acquired, true);

      const stat = statSync(result.lockPath);
      const mode = stat.mode & 0o777;
      assert.strictEqual(mode, 0o600, `Expected 0o600, got 0o${mode.toString(8)}`);

      releaseLockSync(result.lockPath);
    });
  });

  describe('releaseLockAsync', () => {
    it('should remove lock file', async () => {
      const result = await acquireLockAsync(testFile, { lockDir: testLockDir });
      assert.ok(existsSync(result.lockPath));

      await releaseLockAsync(result.lockPath);
      assert.ok(!existsSync(result.lockPath));
    });

    it('should be idempotent (no error if already released)', async () => {
      const result = await acquireLockAsync(testFile, { lockDir: testLockDir });
      await releaseLockAsync(result.lockPath);

      // Release again - should not throw
      await assert.doesNotReject(async () => {
        await releaseLockAsync(result.lockPath);
      });
    });

    it('should not release lock owned by another process', async () => {
      // Create a lock file manually with a different PID
      if (!existsSync(testLockDir)) {
        mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      }

      const fakeLockPath = path.join(testLockDir, 'fake_test.lock');
      const fakeContent = JSON.stringify({
        pid: process.pid + 99999, // Different PID
        timestamp: Date.now(),
        file: testFile
      });
      writeFileSync(fakeLockPath, fakeContent, { mode: 0o600 });

      // Try to release - should not delete because we don't own it
      await releaseLockAsync(fakeLockPath);

      // Lock should still exist
      assert.ok(existsSync(fakeLockPath));

      // Clean up manually
      unlinkSync(fakeLockPath);
    });
  });

  describe('releaseLockSync', () => {
    it('should remove lock file', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });
      assert.ok(existsSync(result.lockPath));

      releaseLockSync(result.lockPath);
      assert.ok(!existsSync(result.lockPath));
    });

    it('should be idempotent (no error if already released)', () => {
      const result = acquireLockSync(testFile, { lockDir: testLockDir });
      releaseLockSync(result.lockPath);

      // Release again - should not throw
      assert.doesNotThrow(() => {
        releaseLockSync(result.lockPath);
      });
    });

    it('should not release lock owned by another process', () => {
      // Create a lock file manually with a different PID
      if (!existsSync(testLockDir)) {
        mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      }

      const fakeLockPath = path.join(testLockDir, 'fake_sync_test.lock');
      const fakeContent = JSON.stringify({
        pid: process.pid + 99999, // Different PID
        timestamp: Date.now(),
        file: testFile
      });
      writeFileSync(fakeLockPath, fakeContent, { mode: 0o600 });

      // Try to release - should not delete because we don't own it
      releaseLockSync(fakeLockPath);

      // Lock should still exist
      assert.ok(existsSync(fakeLockPath));

      // Clean up manually
      unlinkSync(fakeLockPath);
    });
  });

  describe('withFileLockAsync', () => {
    it('should execute function with lock held', async () => {
      let executedInsideLock = false;

      const result = await withFileLockAsync(
        testFile,
        async () => {
          // Check that lock exists while function is running
          const lockPath = getLockPath(testFile, testLockDir);
          assert.ok(existsSync(lockPath), 'Lock should exist while function executes');
          executedInsideLock = true;
          return 'success';
        },
        { lockDir: testLockDir }
      );

      assert.strictEqual(result, 'success');
      assert.ok(executedInsideLock);

      // Lock should be released after function completes
      const lockPath = getLockPath(testFile, testLockDir);
      assert.ok(!existsSync(lockPath), 'Lock should be released after function');
    });

    it('should release lock even if function throws', async () => {
      const lockPath = getLockPath(testFile, testLockDir);

      await assert.rejects(
        async () => {
          await withFileLockAsync(
            testFile,
            async () => {
              throw new Error('Test error');
            },
            { lockDir: testLockDir }
          );
        },
        /Test error/
      );

      // Lock should be released even after error
      assert.ok(!existsSync(lockPath), 'Lock should be released after error');
    });

    it('should throw on acquisition failure', async () => {
      // Acquire lock first
      const firstLock = await acquireLockAsync(testFile, { lockDir: testLockDir });

      // Try withFileLockAsync with minimal retries
      await assert.rejects(
        async () => {
          await withFileLockAsync(
            testFile,
            async () => 'should not run',
            { lockDir: testLockDir, maxRetries: 2, retryDelayMs: 5 }
          );
        },
        /Failed to acquire lock/
      );

      await releaseLockAsync(firstLock.lockPath);
    });

    it('should return the value from the executed function', async () => {
      const expectedValue = { data: 'test', count: 42 };

      const result = await withFileLockAsync(
        testFile,
        async () => expectedValue,
        { lockDir: testLockDir }
      );

      assert.deepStrictEqual(result, expectedValue);
    });
  });

  describe('withFileLockSync', () => {
    it('should execute function with lock held', () => {
      let executedInsideLock = false;

      const result = withFileLockSync(
        testFile,
        () => {
          // Check that lock exists while function is running
          const lockPath = getLockPath(testFile, testLockDir);
          assert.ok(existsSync(lockPath), 'Lock should exist while function executes');
          executedInsideLock = true;
          return 'success';
        },
        { lockDir: testLockDir }
      );

      assert.strictEqual(result, 'success');
      assert.ok(executedInsideLock);

      // Lock should be released after function completes
      const lockPath = getLockPath(testFile, testLockDir);
      assert.ok(!existsSync(lockPath), 'Lock should be released after function');
    });

    it('should release lock even if function throws', () => {
      const lockPath = getLockPath(testFile, testLockDir);

      assert.throws(
        () => {
          withFileLockSync(
            testFile,
            () => {
              throw new Error('Test error');
            },
            { lockDir: testLockDir }
          );
        },
        /Test error/
      );

      // Lock should be released even after error
      assert.ok(!existsSync(lockPath), 'Lock should be released after error');
    });

    it('should throw on acquisition failure', () => {
      // Acquire lock first
      const firstLock = acquireLockSync(testFile, { lockDir: testLockDir });

      // Try withFileLockSync with minimal retries
      assert.throws(
        () => {
          withFileLockSync(
            testFile,
            () => 'should not run',
            { lockDir: testLockDir, maxRetries: 2, retryDelayMs: 5 }
          );
        },
        /Failed to acquire lock/
      );

      releaseLockSync(firstLock.lockPath);
    });

    it('should return the value from the executed function', () => {
      const expectedValue = { data: 'test', count: 42 };

      const result = withFileLockSync(
        testFile,
        () => expectedValue,
        { lockDir: testLockDir }
      );

      assert.deepStrictEqual(result, expectedValue);
    });
  });

  describe('stale lock handling', () => {
    it('should clean up stale locks from dead processes', async () => {
      // Create a lock file with a non-existent PID
      if (!existsSync(testLockDir)) {
        mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      }

      // Use a PID that almost certainly doesn't exist
      const deadPid = 999999;
      const staleLockPath = getLockPath(testFile, testLockDir);
      const staleContent = JSON.stringify({
        pid: deadPid,
        timestamp: Date.now() - 120000, // 2 minutes ago (beyond 60s stale threshold)
        file: testFile
      });
      writeFileSync(staleLockPath, staleContent, { mode: 0o600 });

      // Try to acquire lock - should clean up stale lock and succeed
      const result = await acquireLockAsync(testFile, { lockDir: testLockDir });

      assert.strictEqual(result.acquired, true);

      // Verify the lock is now owned by current process
      const content = JSON.parse(await fs.readFile(result.lockPath, 'utf8'));
      assert.strictEqual(content.pid, process.pid);

      await releaseLockAsync(result.lockPath);
    });

    it('should respect non-stale locks from running processes', async () => {
      // Acquire a lock normally
      const firstLock = await acquireLockAsync(testFile, { lockDir: testLockDir });
      assert.strictEqual(firstLock.acquired, true);

      // Try to acquire another lock - should fail because the process is running
      const secondLock = await acquireLockAsync(testFile, {
        lockDir: testLockDir,
        maxRetries: 3,
        retryDelayMs: 10
      });

      assert.strictEqual(secondLock.acquired, false);

      await releaseLockAsync(firstLock.lockPath);
    });

    it('should clean up stale locks based on dead PID even if not old', async () => {
      // Create a lock file with a non-existent PID but recent timestamp
      if (!existsSync(testLockDir)) {
        mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      }

      const deadPid = 999999;
      const staleLockPath = getLockPath(testFile, testLockDir);
      const recentButDeadContent = JSON.stringify({
        pid: deadPid,
        timestamp: Date.now(), // Just now, but process is dead
        file: testFile
      });
      writeFileSync(staleLockPath, recentButDeadContent, { mode: 0o600 });

      // Try to acquire lock - should clean up because PID is dead
      const result = await acquireLockAsync(testFile, { lockDir: testLockDir });

      assert.strictEqual(result.acquired, true);

      await releaseLockAsync(result.lockPath);
    });
  });

  describe('security validations', () => {
    it('should detect and reject symlinks', async () => {
      // Create lock directory if needed
      if (!existsSync(testLockDir)) {
        mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      }

      // Create a target file
      const targetFile = path.join(testDir, 'target.txt');
      writeFileSync(targetFile, 'target content');

      // Create a symlink where the lock file would be
      const lockPath = getLockPath(testFile, testLockDir);
      try {
        symlinkSync(targetFile, lockPath);

        // Attempting to acquire should throw security error
        await assert.rejects(
          async () => {
            await acquireLockAsync(testFile, { lockDir: testLockDir });
          },
          /Security violation.*symlink/
        );
      } finally {
        // Clean up symlink
        try {
          unlinkSync(lockPath);
        } catch {
          // Ignore cleanup errors
        }
        try {
          unlinkSync(targetFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should detect and reject symlinks (sync version)', () => {
      // Create lock directory if needed
      if (!existsSync(testLockDir)) {
        mkdirSync(testLockDir, { recursive: true, mode: 0o700 });
      }

      // Create a target file
      const targetFile = path.join(testDir, 'target_sync.txt');
      writeFileSync(targetFile, 'target content');

      // Create a symlink where the lock file would be
      const lockPath = getLockPath(testFile, testLockDir);
      try {
        symlinkSync(targetFile, lockPath);

        // Attempting to acquire should throw security error
        assert.throws(
          () => {
            acquireLockSync(testFile, { lockDir: testLockDir });
          },
          /Security violation.*symlink/
        );
      } finally {
        // Clean up symlink
        try {
          unlinkSync(lockPath);
        } catch {
          // Ignore cleanup errors
        }
        try {
          unlinkSync(targetFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('error handling', () => {
    it('should return acquired: false after max retries (async)', async () => {
      // Acquire first lock
      const firstLock = await acquireLockAsync(testFile, { lockDir: testLockDir });

      // Second attempt should fail after retries
      const result = await acquireLockAsync(testFile, {
        lockDir: testLockDir,
        maxRetries: 3,
        retryDelayMs: 10
      });

      assert.strictEqual(result.acquired, false);
      assert.ok(result.lockPath); // Should still return the path

      await releaseLockAsync(firstLock.lockPath);
    });

    it('should return acquired: false after max retries (sync)', () => {
      // Acquire first lock
      const firstLock = acquireLockSync(testFile, { lockDir: testLockDir });

      // Second attempt should fail after retries
      const result = acquireLockSync(testFile, {
        lockDir: testLockDir,
        maxRetries: 3,
        retryDelayMs: 5
      });

      assert.strictEqual(result.acquired, false);
      assert.ok(result.lockPath); // Should still return the path

      releaseLockSync(firstLock.lockPath);
    });

    it('withFileLockAsync should throw on acquisition failure', async () => {
      // Acquire lock to block
      const blocker = await acquireLockAsync(testFile, { lockDir: testLockDir });

      await assert.rejects(
        async () => {
          await withFileLockAsync(
            testFile,
            async () => 'never runs',
            { lockDir: testLockDir, maxRetries: 2, retryDelayMs: 5 }
          );
        },
        /Failed to acquire lock/
      );

      await releaseLockAsync(blocker.lockPath);
    });

    it('withFileLockSync should throw on acquisition failure', () => {
      // Acquire lock to block
      const blocker = acquireLockSync(testFile, { lockDir: testLockDir });

      assert.throws(
        () => {
          withFileLockSync(
            testFile,
            () => 'never runs',
            { lockDir: testLockDir, maxRetries: 2, retryDelayMs: 5 }
          );
        },
        /Failed to acquire lock/
      );

      releaseLockSync(blocker.lockPath);
    });
  });

  describe('retry behavior', () => {
    it('should retry with exponential backoff (async)', async () => {
      // Acquire blocking lock
      const blocker = await acquireLockAsync(testFile, { lockDir: testLockDir });

      const startTime = Date.now();

      // Try to acquire with known retry settings
      await acquireLockAsync(testFile, {
        lockDir: testLockDir,
        maxRetries: 3,
        retryDelayMs: 50,
        maxRetryDelayMs: 200
      });

      const elapsed = Date.now() - startTime;

      // Should have waited approximately: 50 + 75 + ~100 = ~225ms minimum
      // Allow some variance for execution time
      assert.ok(elapsed >= 100, `Expected at least 100ms, got ${elapsed}ms`);

      await releaseLockAsync(blocker.lockPath);
    });
  });

  describe('concurrent access simulation', () => {
    it('should handle rapid sequential acquire/release cycles', async () => {
      // Simulate rapid lock churn
      for (let i = 0; i < 10; i++) {
        const result = await acquireLockAsync(testFile, { lockDir: testLockDir });
        assert.strictEqual(result.acquired, true, `Iteration ${i} failed to acquire`);
        await releaseLockAsync(result.lockPath);
      }
    });

    it('should handle rapid sequential acquire/release cycles (sync)', () => {
      // Simulate rapid lock churn
      for (let i = 0; i < 10; i++) {
        const result = acquireLockSync(testFile, { lockDir: testLockDir });
        assert.strictEqual(result.acquired, true, `Iteration ${i} failed to acquire`);
        releaseLockSync(result.lockPath);
      }
    });

    it('should correctly serialize access with withFileLockAsync', async () => {
      let counter = 0;
      const increments = [];

      // Run multiple operations that should be serialized
      const operation = async (id) => {
        return withFileLockAsync(
          testFile,
          async () => {
            const before = counter;
            await new Promise(resolve => setTimeout(resolve, 10));
            counter++;
            increments.push({ id, before, after: counter });
            return counter;
          },
          { lockDir: testLockDir }
        );
      };

      // Run operations sequentially (parallel would require more complex setup)
      await operation(1);
      await operation(2);
      await operation(3);

      assert.strictEqual(counter, 3);
      assert.strictEqual(increments.length, 3);

      // Each increment should see the previous value
      assert.strictEqual(increments[0].before, 0);
      assert.strictEqual(increments[0].after, 1);
      assert.strictEqual(increments[1].before, 1);
      assert.strictEqual(increments[1].after, 2);
      assert.strictEqual(increments[2].before, 2);
      assert.strictEqual(increments[2].after, 3);
    });
  });

  describe('default configuration', () => {
    it('should use default lock directory when not specified', async () => {
      // This test verifies the function works with defaults
      // We won't actually use the default dir to avoid polluting cwd
      const lockPath = getLockPath(testFile);

      // Should be in the default .locks directory
      assert.ok(lockPath.includes('.locks'));
    });
  });
});
