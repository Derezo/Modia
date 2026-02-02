/**
 * @module world
 * @description World API router - composes navigation, activities, stamina, and progression sub-routers
 *
 * Route composition:
 * - /api/world/* - Navigation routes (regions, nodes, travel, current location)
 * - /api/world/* - Activity routes (shrines, chests, discoveries, watchtowers)
 * - /api/world/stamina/* - Stamina management routes
 * - /api/world/fast-travel/* - Fast travel progression routes
 *
 * @see ./world/navigation.js - Core navigation (regions, nodes, paths, travel)
 * @see ./world/activities.js - World activities (shrines, chests, discoveries)
 * @see ./world/stamina.js - Stamina recovery at towns
 * @see ./world/progression.js - Fast travel to region castles
 */
import express from 'express';
import navigationRouter from './world/navigation.js';
import activitiesRouter from './world/activities.js';
import staminaRouter from './world/stamina.js';
import progressionRouter from './world/progression.js';

const router = express.Router();

// ============================================================================
// COMPOSE SUB-ROUTERS
// ============================================================================

// Navigation routes (regions, nodes, paths, travel, current location)
// These mount at the root level: /api/world/seed, /api/world/regions, etc.
router.use('/', navigationRouter);

// Activity routes (shrines, chests, discoveries, watchtowers)
// These mount at the root level: /api/world/nodes/:id/claim-chest, etc.
router.use('/', activitiesRouter);

// Stamina management routes
// These mount at /api/world/stamina/*
router.use('/stamina', staminaRouter);

// Fast travel progression routes
// These mount at /api/world/fast-travel/*
router.use('/fast-travel', progressionRouter);

// ============================================================================
// RE-EXPORTS FOR BACKWARD COMPATIBILITY
// ============================================================================

// Export helper functions used by other modules
export {
  getBlockedNodes,
  getVisitedNodes,
  findWorldPath
} from './world/navigation.js';

export default router;
