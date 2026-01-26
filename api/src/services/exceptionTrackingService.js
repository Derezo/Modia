/**
 * Exception Tracking Service
 * Captures and groups exceptions for monitoring and debugging
 *
 * Key features:
 * - Groups similar exceptions by fingerprint (normalized stack trace hash)
 * - Tracks occurrence counts and timestamps
 * - Captures request context for debugging
 * - Supports resolution workflow (new → investigating → resolved/ignored)
 */

import { createHash } from 'crypto';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { logException } from '../config/fileLogger.js';

const ERROR_TRACKING_ENABLED = process.env.ERROR_TRACKING_ENABLED !== 'false';

/**
 * Compute a fingerprint for an exception based on normalized error details
 * Groups same errors together even if line numbers vary slightly
 *
 * @param {string} message - Error message
 * @param {string} stack - Full stack trace
 * @returns {string} SHA-256 hash of normalized error (first 64 chars)
 */
function computeFingerprint(message, stack) {
  const normalized = normalizeStackTrace(stack);
  const input = `${message || 'unknown'}:${normalized}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 64);
}

/**
 * Normalize a stack trace for fingerprinting
 * Strips variable parts like line numbers in node_modules
 *
 * @param {string} stack - Raw stack trace
 * @returns {string} Normalized stack trace
 */
function normalizeStackTrace(stack) {
  if (!stack) return '';

  return stack
    .split('\n')
    // Keep only frame lines (starting with "at")
    .filter(line => line.trim().startsWith('at '))
    // Strip line:column numbers from node_modules paths
    .map(line => {
      // Replace line:col in node_modules: "node_modules/foo/bar.js:123:45" → "node_modules/foo/bar.js"
      return line.replace(/(node_modules\/[^:]+):\d+:\d+/g, '$1');
    })
    // Take first 5 frames for fingerprinting (enough to identify unique errors)
    .slice(0, 5)
    .join('\n');
}

/**
 * Extract source location from the first relevant stack frame
 *
 * @param {string} stack - Full stack trace
 * @returns {Object} { file, line, function }
 */
function extractSourceLocation(stack) {
  if (!stack) return { file: null, line: null, function: null };

  const lines = stack.split('\n');
  // Find first stack frame (skip the error message)
  for (const line of lines) {
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):\d+\)?/);
    if (match) {
      return {
        function: match[1] || null,
        file: match[2] || null,
        line: match[3] ? parseInt(match[3], 10) : null
      };
    }
  }
  return { file: null, line: null, function: null };
}

/**
 * Find or create an exception group for this fingerprint
 * Uses INSERT ON CONFLICT to upsert atomically
 *
 * @param {string} fingerprint - Error fingerprint
 * @param {Object} errorDetails - Error details
 * @returns {number} Exception group ID
 */
async function findOrCreateExceptionGroup(fingerprint, errorDetails) {
  const { type, message, normalizedStack, file, line, functionName } = errorDetails;

  // Upsert: insert if new, update occurrence count if exists
  const result = await query(`
    INSERT INTO exception_groups (
      fingerprint, exception_type, exception_message, stack_trace_normalized,
      source_file, source_line, source_function
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (fingerprint) DO UPDATE SET
      last_seen_at = CURRENT_TIMESTAMP,
      occurrence_count = exception_groups.occurrence_count + 1,
      -- Reopen if was resolved (might be a regression)
      status = CASE
        WHEN exception_groups.status = 'resolved' THEN 'new'
        ELSE exception_groups.status
      END
    RETURNING id
  `, [fingerprint, type, message, normalizedStack, file, line, functionName]);

  return result.rows[0].id;
}

/**
 * Create an individual exception event record
 *
 * @param {number} groupId - Exception group ID
 * @param {Object} context - Request and error context
 * @returns {number} Event ID
 */
async function createExceptionEvent(groupId, context) {
  const {
    requestId,
    method,
    url,
    headers,
    userId,
    characterId,
    fullStack,
    errorContext,
    ip,
    userAgent,
    environment
  } = context;

  // Sanitize headers (remove sensitive data)
  const sanitizedHeaders = { ...headers };
  delete sanitizedHeaders.authorization;
  delete sanitizedHeaders.cookie;

  const result = await query(`
    INSERT INTO exception_events (
      exception_group_id, request_id, request_method, request_url,
      request_headers, user_id, character_id, full_stack_trace,
      error_context, ip_address, user_agent, environment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `, [
    groupId,
    requestId || null,
    method || null,
    url || null,
    JSON.stringify(sanitizedHeaders || {}),
    userId || null,
    characterId || null,
    fullStack || null,
    JSON.stringify(errorContext || {}),
    ip || null,
    userAgent || null,
    environment || process.env.NODE_ENV || 'development'
  ]);

  return result.rows[0].id;
}

/**
 * Main entry point: track an exception
 * Call this from the error handler for 5xx errors
 *
 * @param {Error} error - The error object
 * @param {Object} req - Express request object
 * @param {Object} additionalContext - Optional additional context
 * @returns {Object} { fingerprint, groupId, eventId } or null if tracking disabled
 */
export async function trackException(error, req, additionalContext = {}) {
  if (!ERROR_TRACKING_ENABLED) {
    return null;
  }

  try {
    const message = error?.message || 'Unknown error';
    const stack = error?.stack || '';
    const type = error?.name || error?.constructor?.name || 'Error';

    // Compute fingerprint
    const fingerprint = computeFingerprint(message, stack);
    const normalizedStack = normalizeStackTrace(stack);
    const { file, line, function: functionName } = extractSourceLocation(stack);

    // Find or create exception group
    const groupId = await findOrCreateExceptionGroup(fingerprint, {
      type,
      message,
      normalizedStack,
      file,
      line,
      functionName
    });

    // Extract request context
    const context = {
      requestId: req?.requestId,
      method: req?.method,
      url: req?.originalUrl || req?.url,
      headers: req?.headers || {},
      userId: req?.user?.id,
      characterId: req?.body?.characterId || req?.params?.characterId,
      fullStack: stack,
      errorContext: {
        ...additionalContext,
        body: req?.body ? sanitizeBody(req.body) : undefined,
        params: req?.params,
        query: req?.query
      },
      ip: req?.ip,
      userAgent: req?.get?.('user-agent'),
      environment: process.env.NODE_ENV || 'development'
    };

    // Create event record
    const eventId = await createExceptionEvent(groupId, context);

    // Write to file log for VPS log aggregation
    logException({
      error,
      req,
      fingerprint,
      context: { groupId, eventId }
    }).catch(() => {
      // Silently ignore file logging errors
    });

    logger.debug('exceptionTracking', `Tracked exception: ${fingerprint.substring(0, 8)}`, {
      groupId,
      eventId,
      type,
      message: message.substring(0, 100)
    });

    return { fingerprint, groupId, eventId };
  } catch (trackingError) {
    // Don't let tracking errors break the application
    logger.error('exceptionTracking', trackingError);
    return null;
  }
}

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;

  const sanitized = { ...body };
  const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'authorization'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Get exception statistics for monitoring
 *
 * @param {Object} options - Query options
 * @returns {Object} Statistics
 */
export async function getExceptionStats(options = {}) {
  const { hours = 24 } = options;

  // Validate hours to prevent SQL injection (defense in depth)
  const validHours = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 720);

  const result = await query(`
    SELECT
      COUNT(DISTINCT eg.id) as unique_exceptions,
      SUM(eg.occurrence_count) as total_occurrences,
      COUNT(CASE WHEN eg.status = 'new' THEN 1 END) as new_count,
      COUNT(CASE WHEN eg.status = 'investigating' THEN 1 END) as investigating_count
    FROM exception_groups eg
    WHERE eg.last_seen_at > NOW() - $1 * INTERVAL '1 hour'
  `, [validHours]);

  return result.rows[0];
}

/**
 * Get recent exception groups for admin dashboard
 *
 * @param {Object} options - Query options
 * @returns {Array} Exception groups
 */
export async function getRecentExceptionGroups(options = {}) {
  const { status, limit = 50, offset = 0 } = options;

  let whereClause = '';
  const params = [];

  if (status) {
    params.push(status);
    whereClause = `WHERE status = $${params.length}`;
  }

  params.push(limit, offset);

  const result = await query(`
    SELECT
      id, fingerprint, exception_type, exception_message,
      source_file, source_line, source_function,
      first_seen_at, last_seen_at, occurrence_count, status
    FROM exception_groups
    ${whereClause}
    ORDER BY last_seen_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return result.rows;
}

export { computeFingerprint, normalizeStackTrace };
