import { logger } from '../utils/logger.js';
import { trackException } from '../services/exceptionTrackingService.js';

const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const requestId = req.requestId;

  // Only log actual errors (5xx), not expected client errors (4xx)
  if (statusCode >= 500) {
    const reqLogger = logger.withRequest(req);
    reqLogger.error(`${req.method} ${req.path}`, err);

    // Track exception asynchronously (don't block response)
    trackException(err, req).catch(() => {
      // Silently ignore tracking errors
    });
  } else if (logger.isDebug()) {
    // In debug mode, log 4xx as debug info, not errors
    logger.debug('errorHandler', `${statusCode} ${err.message}`, { path: req.path });
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.message
    });
  }

  if (err.code === '23505') {
    // PostgreSQL unique violation
    // SECURITY: Log detail server-side but don't expose schema/values to client
    logger.warn('errorHandler', 'Unique constraint violation', {
      path: req.path,
      detail: err.detail
    });
    return res.status(409).json({
      error: 'Resource already exists'
    });
  }

  if (err.code === '23503') {
    // PostgreSQL foreign key violation
    // SECURITY: Log detail server-side but don't expose schema/values to client
    logger.warn('errorHandler', 'Foreign key violation', {
      path: req.path,
      detail: err.detail
    });
    return res.status(400).json({
      error: 'Invalid reference'
    });
  }

  // Default error response
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    ...(requestId && { requestId }),
    ...(err.data && { ...err.data }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Async handler wrapper to catch errors in async route handlers
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error class with status code and optional data
class AppError extends Error {
  constructor(message, statusCode = 500, data = null) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    this.data = data;
  }
}

export { errorHandler, asyncHandler, AppError };
