/**
 * Character Service
 * Handles character-related operations including ownership verification
 */

import { query } from '../config/database.js';

/**
 * Verify that a character belongs to a specific user
 * @param {number} characterId - The character ID to verify
 * @param {number} userId - The user ID to check ownership against
 * @returns {Promise<boolean>} True if the user owns the character, false otherwise
 */
export async function verifyCharacterOwnership(characterId, userId) {
  const result = await query(
    'SELECT 1 FROM characters WHERE id = $1 AND user_id = $2 LIMIT 1',
    [characterId, userId]
  );
  return result.rows.length > 0;
}

export default {
  verifyCharacterOwnership
};
