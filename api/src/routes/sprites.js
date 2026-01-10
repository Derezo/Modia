/**
 * Sprite Routes
 * Handles character sprite generation and retrieval
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import { getCharacterSpriteService } from '../services/characterSpriteService.js';

const router = express.Router();

/**
 * GET /api/sprites/character/:characterId
 * Get sprite info for a character (generates if needed)
 */
router.get('/character/:characterId', authenticate, async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.user.userId;

    // Get character with equipped items
    const characterResult = await pool.query(`
      SELECT
        c.id,
        c.name,
        c.race,
        c.class,
        c.level
      FROM characters c
      WHERE c.id = $1 AND c.user_id = $2
    `, [characterId, userId]);

    if (characterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const character = characterResult.rows[0];

    // Get equipped items
    const itemsResult = await pool.query(`
      SELECT
        ci.equipped_slot,
        ci.item_template_id as template_id,
        ci.modifications,
        it.name,
        it.item_type,
        it.equipment_slot
      FROM character_items ci
      JOIN item_templates it ON ci.item_template_id = it.id
      WHERE ci.character_id = $1 AND ci.is_equipped = true
    `, [characterId]);

    // Organize equipped items by slot
    character.equippedItems = {};
    for (const item of itemsResult.rows) {
      character.equippedItems[item.equipped_slot] = item;
    }

    // Get or generate sprite
    const spriteService = getCharacterSpriteService();
    const spriteInfo = await spriteService.getOrGenerateSprite(character);

    res.json({
      characterId,
      race: character.race,
      class: character.class,
      hash: spriteInfo.hash,
      sprites: spriteInfo.sprites
    });

  } catch (error) {
    console.error('Error getting character sprite:', error);
    res.status(500).json({ error: 'Failed to get character sprite' });
  }
});

/**
 * GET /api/sprites/character/:characterId/check
 * Check if sprite exists without generating
 */
router.get('/character/:characterId/check', authenticate, async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.user.userId;

    // Get character with equipped items
    const characterResult = await pool.query(`
      SELECT c.id, c.race, c.class
      FROM characters c
      WHERE c.id = $1 AND c.user_id = $2
    `, [characterId, userId]);

    if (characterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const character = characterResult.rows[0];

    // Get equipped items
    const itemsResult = await pool.query(`
      SELECT ci.equipped_slot, it.name
      FROM character_items ci
      JOIN item_templates it ON ci.item_template_id = it.id
      WHERE ci.character_id = $1 AND ci.is_equipped = true
    `, [characterId]);

    character.equippedItems = {};
    for (const item of itemsResult.rows) {
      character.equippedItems[item.equipped_slot] = item;
    }

    const spriteService = getCharacterSpriteService();
    const result = await spriteService.checkSpriteExists(character);

    res.json({
      characterId,
      exists: result.exists,
      hash: result.hash
    });

  } catch (error) {
    console.error('Error checking character sprite:', error);
    res.status(500).json({ error: 'Failed to check character sprite' });
  }
});

/**
 * POST /api/sprites/character/:characterId/generate
 * Force regenerate sprite for a character
 */
router.post('/character/:characterId/generate', authenticate, async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.user.userId;

    // Get character with equipped items
    const characterResult = await pool.query(`
      SELECT c.id, c.name, c.race, c.class, c.level
      FROM characters c
      WHERE c.id = $1 AND c.user_id = $2
    `, [characterId, userId]);

    if (characterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const character = characterResult.rows[0];

    // Get equipped items
    const itemsResult = await pool.query(`
      SELECT
        ci.equipped_slot,
        ci.item_template_id as template_id,
        ci.modifications,
        it.name,
        it.item_type,
        it.equipment_slot
      FROM character_items ci
      JOIN item_templates it ON ci.item_template_id = it.id
      WHERE ci.character_id = $1 AND ci.is_equipped = true
    `, [characterId]);

    character.equippedItems = {};
    for (const item of itemsResult.rows) {
      character.equippedItems[item.equipped_slot] = item;
    }

    // Force regenerate sprite
    const spriteService = getCharacterSpriteService();
    const spriteInfo = await spriteService.getOrGenerateSprite(character, true);

    res.json({
      characterId,
      regenerated: true,
      hash: spriteInfo.hash,
      sprites: spriteInfo.sprites
    });

  } catch (error) {
    console.error('Error regenerating character sprite:', error);
    res.status(500).json({ error: 'Failed to regenerate character sprite' });
  }
});

/**
 * DELETE /api/sprites/character/:characterId
 * Clear cached sprite for a character
 */
router.delete('/character/:characterId', authenticate, async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.user.userId;

    // Get character
    const characterResult = await pool.query(`
      SELECT c.id, c.race, c.class
      FROM characters c
      WHERE c.id = $1 AND c.user_id = $2
    `, [characterId, userId]);

    if (characterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const character = characterResult.rows[0];

    // Get equipped items for hash
    const itemsResult = await pool.query(`
      SELECT ci.equipped_slot, it.name
      FROM character_items ci
      JOIN item_templates it ON ci.item_template_id = it.id
      WHERE ci.character_id = $1 AND ci.is_equipped = true
    `, [characterId]);

    character.equippedItems = {};
    for (const item of itemsResult.rows) {
      character.equippedItems[item.equipped_slot] = item;
    }

    const spriteService = getCharacterSpriteService();
    const cleared = await spriteService.clearSprite(character);

    res.json({
      characterId,
      cleared
    });

  } catch (error) {
    console.error('Error clearing character sprite:', error);
    res.status(500).json({ error: 'Failed to clear character sprite' });
  }
});

/**
 * GET /api/sprites/list
 * List all generated sprites (admin/debug)
 */
router.get('/list', authenticate, async (req, res) => {
  try {
    const spriteService = getCharacterSpriteService();
    const sprites = await spriteService.listGeneratedSprites();

    res.json({
      count: sprites.length,
      sprites
    });

  } catch (error) {
    console.error('Error listing sprites:', error);
    res.status(500).json({ error: 'Failed to list sprites' });
  }
});

export default router;
