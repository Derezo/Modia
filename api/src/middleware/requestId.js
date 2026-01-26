import { randomUUID } from 'crypto';

/**
 * Request ID middleware for correlation tracking
 * Generates or extracts request IDs for request correlation across logs and services
 *
 * The request ID is:
 * 1. Extracted from X-Request-ID header if provided (for upstream proxy correlation)
 * 2. Generated as a new UUID if not provided
 *
 * The ID is attached to req.requestId and returned in the response X-Request-ID header
 */
export function requestIdMiddleware(req, res, next) {
  // Use existing header if provided (for proxy/load balancer correlation)
  // Otherwise generate a new UUID
  const requestId = req.get('X-Request-ID') || randomUUID();

  // Attach to request for use in logging and error tracking
  req.requestId = requestId;

  // Set response header for client correlation
  res.set('X-Request-ID', requestId);

  next();
}
