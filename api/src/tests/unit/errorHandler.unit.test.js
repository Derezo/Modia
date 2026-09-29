/**
 * ErrorHandler Unit Tests
 *
 * SECURITY: Verify that error responses never include stack traces,
 * regardless of NODE_ENV setting. Stack traces are logged server-side
 * but must never be sent to clients.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { errorHandler, AppError } from '../../middleware/errorHandler.js';

describe('errorHandler security', () => {
  let mockReq;
  let mockRes;
  let capturedResponse;

  beforeEach(() => {
    mockReq = {
      method: 'GET',
      path: '/api/test',
      requestId: 'test-req-123'
    };
    capturedResponse = null;
    mockRes = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(body) {
        capturedResponse = body;
        return this;
      }
    };
  });

  it('should never include stack trace for 500 errors', () => {
    const error = new Error('Internal server error');
    error.stack = 'Error: Internal server error\n    at someFunction (/app/src/routes/test.js:42:15)';

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 500);
    assert.ok(capturedResponse, 'Response should be sent');
    assert.strictEqual(capturedResponse.error, 'Internal Server Error');
    assert.strictEqual(capturedResponse.stack, undefined, 'Stack trace should NOT be in response');
    assert.ok(!JSON.stringify(capturedResponse).includes('someFunction'), 'No function names in response');
    assert.ok(!JSON.stringify(capturedResponse).includes('.js:'), 'No file paths in response');
  });

  it('should never include stack trace for 4xx errors', () => {
    const error = new AppError('Bad request', 400);
    error.stack = 'AppError: Bad request\n    at validateInput (/app/src/middleware/validate.js:10:5)';

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 400);
    assert.ok(capturedResponse, 'Response should be sent');
    assert.strictEqual(capturedResponse.error, 'Bad request');
    assert.strictEqual(capturedResponse.stack, undefined, 'Stack trace should NOT be in response');
    assert.ok(!JSON.stringify(capturedResponse).includes('validateInput'), 'No function names in response');
  });

  it('should never include stack trace for 404 errors', () => {
    const error = new AppError('Not found', 404);
    error.stack = 'AppError: Not found\n    at findResource (/app/src/services/test.js:25:10)';

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 404);
    assert.strictEqual(capturedResponse.error, 'Not found');
    assert.strictEqual(capturedResponse.stack, undefined, 'Stack trace should NOT be in response');
  });

  it('should never include stack trace for validation errors', () => {
    const error = new Error('Validation failed');
    error.name = 'ValidationError';
    error.stack = 'ValidationError: Validation failed\n    at Schema.validate (/app/node_modules/validator/index.js:100:3)';

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 400);
    assert.strictEqual(capturedResponse.error, 'Validation Error');
    assert.strictEqual(capturedResponse.stack, undefined, 'Stack trace should NOT be in response');
  });

  it('should mask internal database errors with generic message', () => {
    const error = new Error('relation "users" does not exist');
    error.stack = 'Error: relation "users" does not exist\n    at Connection.parseE (/app/node_modules/pg/lib/client.js:526:11)';

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 500);
    assert.strictEqual(capturedResponse.error, 'Internal Server Error');
    // Make sure we don't expose database structure
    assert.ok(!JSON.stringify(capturedResponse).includes('relation'));
    assert.ok(!JSON.stringify(capturedResponse).includes('users'));
    assert.strictEqual(capturedResponse.stack, undefined);
  });

  it('should include requestId but not stack for 500 errors', () => {
    const error = new Error('Something broke');

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 500);
    assert.strictEqual(capturedResponse.requestId, 'test-req-123');
    assert.strictEqual(capturedResponse.stack, undefined);
  });

  it('should handle PostgreSQL unique violation without stack', () => {
    const error = new Error('duplicate key value violates unique constraint "users_email_key"');
    error.code = '23505';
    error.detail = 'Key (email)=(test@example.com) already exists.';
    error.stack = 'error: duplicate key value...\n    at Parser.parse...';

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 409);
    assert.strictEqual(capturedResponse.error, 'Resource already exists');
    // Should NOT expose email or constraint name
    assert.ok(!JSON.stringify(capturedResponse).includes('email'));
    assert.ok(!JSON.stringify(capturedResponse).includes('users_email_key'));
    assert.strictEqual(capturedResponse.stack, undefined);
  });

  it('should handle PostgreSQL foreign key violation without stack', () => {
    const error = new Error('insert or update on table "orders" violates foreign key constraint');
    error.code = '23503';
    error.detail = 'Key (user_id)=(999) is not present in table "users".';
    error.stack = 'error: insert or update...\n    at Parser.parse...';

    errorHandler(error, mockReq, mockRes, () => {});

    assert.strictEqual(mockRes.statusCode, 400);
    assert.strictEqual(capturedResponse.error, 'Invalid reference');
    // Should NOT expose table or column names
    assert.ok(!JSON.stringify(capturedResponse).includes('user_id'));
    assert.ok(!JSON.stringify(capturedResponse).includes('orders'));
    assert.strictEqual(capturedResponse.stack, undefined);
  });
});
