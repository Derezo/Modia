import { query } from '../config/database.js';
import { asyncHandler, AppError } from './errorHandler.js';

/**
 * Middleware to require marketplace access
 * Checks that the user's lead character (party_slot = 1) is at a node with 'marketplace' feature
 */
export const requireMarketplaceAccess = asyncHandler(async (req, res, next) => {
  const userId = req.user.userId;

  // Get character's current node and its features
  const result = await query(
    `SELECT wn.id, wn.node_type, wn.features, wn.name, c.name as character_name
     FROM characters c
     JOIN world_nodes wn ON c.current_node_id = wn.id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('No active character found. Create a character first.', 400);
  }

  const node = result.rows[0];
  const features = node.features || [];

  // Check if current node has marketplace feature
  if (!features.includes('marketplace')) {
    throw new AppError(
      `You must be at the Castle marketplace to trade. ${node.name} does not have a marketplace. Travel to the Castle.`,
      403,
      {
        code: 'MARKETPLACE_ACCESS_DENIED',
        currentNode: node.name,
        currentNodeType: node.node_type
      }
    );
  }

  // Attach node info to request for potential use in route handlers
  req.marketplaceNode = {
    id: node.id,
    name: node.name,
    type: node.node_type
  };

  next();
});

/**
 * Optional middleware to check marketplace access without blocking
 * Sets req.hasMarketplaceAccess boolean
 */
export const checkMarketplaceAccess = asyncHandler(async (req, res, next) => {
  const userId = req.user?.userId;

  if (!userId) {
    req.hasMarketplaceAccess = false;
    return next();
  }

  const result = await query(
    `SELECT wn.features
     FROM characters c
     JOIN world_nodes wn ON c.current_node_id = wn.id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  const features = result.rows[0]?.features || [];
  req.hasMarketplaceAccess = features.includes('marketplace');

  next();
});
