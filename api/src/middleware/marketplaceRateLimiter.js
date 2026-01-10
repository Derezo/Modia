import rateLimit from 'express-rate-limit';

// Security: Rate limiting is ENABLED by default
// Only explicitly disable in test environment
// In development, use higher limits but still enforce them
const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV === 'development';

// Create rate limiter with environment-aware settings
const createLimiter = (windowMs, maxRequests, message) => {
  return rateLimit({
    windowMs,
    max: isTest ? 0 : (isDev ? maxRequests * 5 : maxRequests),
    skip: () => isTest,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Order placement (limit orders) - 10 per minute
// More restrictive to prevent order book spam
const orderLimiter = createLimiter(
  60 * 1000, // 1 minute
  10,
  'Too many orders placed. Please wait before placing more orders.'
);

// Market order placement - 5 per minute
// Most restrictive as market orders execute immediately
const marketOrderLimiter = createLimiter(
  60 * 1000, // 1 minute
  5,
  'Too many market orders. Please wait before placing more orders.'
);

// Order cancellation - 20 per minute
// More lenient to allow users to manage their orders
const cancelLimiter = createLimiter(
  60 * 1000, // 1 minute
  20,
  'Too many cancellations. Please wait before cancelling more orders.'
);

// Read operations (order book, history, stats, my orders) - 60 per minute
// Most lenient as these are read-only
const readLimiter = createLimiter(
  60 * 1000, // 1 minute
  60,
  'Too many requests. Please wait before making more requests.'
);

// Search operations - 30 per minute
// Moderate limit as search can be resource-intensive
const searchLimiter = createLimiter(
  60 * 1000, // 1 minute
  30,
  'Too many search requests. Please wait before searching again.'
);

export { orderLimiter, marketOrderLimiter, cancelLimiter, readLimiter, searchLimiter };
