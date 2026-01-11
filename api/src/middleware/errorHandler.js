import { logger } from '../utils/logger.js';

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Only log actual errors (5xx), not expected client errors (4xx)
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.path}`, err);
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
    return res.status(409).json({
      error: 'Resource already exists',
      details: err.detail
    });
  }

  if (err.code === '23503') {
    // PostgreSQL foreign key violation
    return res.status(400).json({
      error: 'Invalid reference',
      details: err.detail
    });
  }

  // Default error response
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
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
