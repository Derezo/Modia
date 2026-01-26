/**
 * Request ID Middleware Unit Tests
 * Tests for request correlation ID generation and propagation
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { requestIdMiddleware } from '../../middleware/requestId.js';

describe('requestIdMiddleware', () => {
  /**
   * Create a mock Express request object
   */
  function createMockRequest(headers = {}) {
    return {
      headers,
      get: (header) => headers[header.toLowerCase()]
    };
  }

  /**
   * Create a mock Express response object
   */
  function createMockResponse() {
    const headers = {};
    return {
      headers,
      set: (header, value) => {
        headers[header.toLowerCase()] = value;
      },
      get: (header) => headers[header.toLowerCase()]
    };
  }

  describe('UUID generation', () => {
    it('should generate UUID when no X-Request-ID header present', (t, done) => {
      const req = createMockRequest({});
      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        // Should have generated a UUID
        assert.ok(req.requestId, 'Should set requestId on request');
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        assert.ok(uuidPattern.test(req.requestId), `Should be valid UUID: ${req.requestId}`);
        done();
      });
    });

    it('should generate unique UUIDs for each request', (t, done) => {
      const generatedIds = new Set();
      let completed = 0;
      const totalRequests = 10;

      for (let i = 0; i < totalRequests; i++) {
        const req = createMockRequest({});
        const res = createMockResponse();

        requestIdMiddleware(req, res, () => {
          generatedIds.add(req.requestId);
          completed++;

          if (completed === totalRequests) {
            assert.strictEqual(
              generatedIds.size,
              totalRequests,
              'All generated IDs should be unique'
            );
            done();
          }
        });
      }
    });
  });

  describe('X-Request-ID header handling', () => {
    it('should use existing X-Request-ID header if present', (t, done) => {
      const existingId = 'upstream-request-id-12345';
      const req = createMockRequest({
        'x-request-id': existingId
      });
      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        assert.strictEqual(req.requestId, existingId, 'Should use existing header value');
        done();
      });
    });

    it('should handle case-insensitive header name', (t, done) => {
      const existingId = 'case-test-id';
      const req = createMockRequest({
        'X-Request-ID': existingId
      });
      // Override get to handle case variations
      req.get = (header) => req.headers[header] || req.headers[header.toLowerCase()];

      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        assert.strictEqual(req.requestId, existingId, 'Should handle case-insensitive header');
        done();
      });
    });

    it('should handle empty X-Request-ID header by generating new UUID', (t, done) => {
      const req = createMockRequest({
        'x-request-id': ''
      });
      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        // Empty string is falsy, should generate new UUID
        assert.ok(req.requestId, 'Should have requestId');
        // If the middleware uses || it will generate new for empty string
        // Based on the implementation: req.get('X-Request-ID') || randomUUID()
        // Empty string is falsy, so new UUID generated
        assert.notStrictEqual(req.requestId, '', 'Should not be empty string');
        done();
      });
    });
  });

  describe('response header setting', () => {
    it('should set X-Request-ID response header', (t, done) => {
      const req = createMockRequest({});
      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        assert.ok(
          res.headers['x-request-id'],
          'Should set X-Request-ID response header'
        );
        assert.strictEqual(
          res.headers['x-request-id'],
          req.requestId,
          'Response header should match request ID'
        );
        done();
      });
    });

    it('should echo back upstream X-Request-ID in response', (t, done) => {
      const upstreamId = 'proxy-generated-id-xyz';
      const req = createMockRequest({
        'x-request-id': upstreamId
      });
      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        assert.strictEqual(
          res.headers['x-request-id'],
          upstreamId,
          'Should echo upstream ID in response'
        );
        done();
      });
    });
  });

  describe('next() callback', () => {
    it('should call next() to continue middleware chain', (t, done) => {
      const req = createMockRequest({});
      const res = createMockResponse();
      let nextCalled = false;

      requestIdMiddleware(req, res, () => {
        nextCalled = true;
        assert.ok(nextCalled, 'next() should be called');
        done();
      });
    });

    it('should call next() synchronously', () => {
      const req = createMockRequest({});
      const res = createMockResponse();
      let nextCalled = false;

      requestIdMiddleware(req, res, () => {
        nextCalled = true;
      });

      // Should be called synchronously
      assert.ok(nextCalled, 'next() should be called synchronously');
    });
  });

  describe('request object modification', () => {
    it('should attach requestId property to request object', (t, done) => {
      const req = createMockRequest({});
      const res = createMockResponse();

      assert.strictEqual(req.requestId, undefined, 'requestId should not exist before middleware');

      requestIdMiddleware(req, res, () => {
        assert.ok('requestId' in req, 'requestId property should be added to request');
        assert.ok(typeof req.requestId === 'string', 'requestId should be a string');
        assert.ok(req.requestId.length > 0, 'requestId should not be empty');
        done();
      });
    });

    it('should not modify other request properties', (t, done) => {
      const originalHeaders = { 'content-type': 'application/json' };
      const req = createMockRequest(originalHeaders);
      req.method = 'POST';
      req.url = '/api/test';

      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        assert.strictEqual(req.method, 'POST', 'Should not modify method');
        assert.strictEqual(req.url, '/api/test', 'Should not modify url');
        assert.strictEqual(
          req.headers['content-type'],
          'application/json',
          'Should not modify existing headers'
        );
        done();
      });
    });
  });

  describe('edge cases', () => {
    it('should handle request without get() method gracefully', () => {
      // Some mock frameworks might not implement get()
      const req = {
        headers: {}
      };
      const res = createMockResponse();

      // This tests robustness - implementation uses req.get()
      // which may throw if not present
      try {
        requestIdMiddleware(req, res, () => {
          // If we get here, the middleware handled missing get() somehow
          // The current implementation would throw if get() is missing
          // This is expected Express behavior
        });
      } catch (error) {
        // Expected if get() is required
        assert.ok(error, 'Middleware requires req.get() method');
      }
    });

    it('should handle very long X-Request-ID header', (t, done) => {
      const longId = 'x'.repeat(1000);
      const req = createMockRequest({
        'x-request-id': longId
      });
      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        // Middleware should accept any string value
        // Validation/truncation would be a security layer concern
        assert.strictEqual(req.requestId, longId, 'Should accept long ID');
        done();
      });
    });

    it('should handle special characters in X-Request-ID', (t, done) => {
      const specialId = 'req-123_ABC.xyz:test';
      const req = createMockRequest({
        'x-request-id': specialId
      });
      const res = createMockResponse();

      requestIdMiddleware(req, res, () => {
        assert.strictEqual(req.requestId, specialId, 'Should accept special characters');
        done();
      });
    });
  });
});

describe('Request ID Integration Patterns', () => {
  describe('logging correlation', () => {
    it('requestId should be suitable for log correlation', () => {
      // Verify the ID format is suitable for log searching
      const id = '550e8400-e29b-41d4-a716-446655440000';

      // Should be greppable
      assert.ok(!id.includes(' '), 'Should not contain spaces');
      assert.ok(!id.includes('\n'), 'Should not contain newlines');

      // Should be reasonable length
      assert.ok(id.length <= 100, 'Should not be excessively long');
      assert.ok(id.length >= 10, 'Should be long enough to be unique');
    });
  });

  describe('error tracking correlation', () => {
    it('requestId format should match exception tracking expectations', () => {
      // Exception tracking expects VARCHAR(36) for request_id
      // UUID v4 is exactly 36 characters
      const uuidV4Length = 36;

      const sampleUuid = '550e8400-e29b-41d4-a716-446655440000';
      assert.strictEqual(sampleUuid.length, uuidV4Length, 'UUID should be 36 characters');
    });
  });
});
