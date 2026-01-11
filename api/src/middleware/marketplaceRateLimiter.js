import { createLimiter } from './rateLimiterFactory.js';

// Order placement (limit orders) - 10 per minute
// More restrictive to prevent order book spam
const orderLimiter = createLimiter({
  name: 'marketplace:order',
  windowMs: 60 * 1000,
  maxRequests: 5, // Base: 5, actual: 10 prod, 25 dev
  message: 'Too many orders placed. Please wait before placing more orders.'
});

// Market order placement - 5 per minute
// Most restrictive as market orders execute immediately
const marketOrderLimiter = createLimiter({
  name: 'marketplace:marketOrder',
  windowMs: 60 * 1000,
  maxRequests: 2, // Base: 2, actual: 4 prod (rounded), 10 dev
  message: 'Too many market orders. Please wait before placing more orders.'
});

// Order cancellation - 20 per minute
// More lenient to allow users to manage their orders
const cancelLimiter = createLimiter({
  name: 'marketplace:cancel',
  windowMs: 60 * 1000,
  maxRequests: 10, // Base: 10, actual: 20 prod, 50 dev
  message: 'Too many cancellations. Please wait before cancelling more orders.'
});

// Read operations (order book, history, stats, my orders) - 60 per minute
// Most lenient as these are read-only
const readLimiter = createLimiter({
  name: 'marketplace:read',
  windowMs: 60 * 1000,
  maxRequests: 30, // Base: 30, actual: 60 prod, 150 dev
  message: 'Too many requests. Please wait before making more requests.'
});

// Search operations - 30 per minute
// Moderate limit as search can be resource-intensive
const searchLimiter = createLimiter({
  name: 'marketplace:search',
  windowMs: 60 * 1000,
  maxRequests: 15, // Base: 15, actual: 30 prod, 75 dev
  message: 'Too many search requests. Please wait before searching again.'
});

export { orderLimiter, marketOrderLimiter, cancelLimiter, readLimiter, searchLimiter };
