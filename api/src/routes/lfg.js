import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { query } from '../config/database.js';
import { sendToUser } from '../websocket/index.js';
import { parseBoundedInt, parseLimit } from '../utils/parseParams.js';
import { validateFreeText } from '../utils/nameValidation.js';

const router = express.Router();

/**
 * GET /api/lfg
 * List active LFG posts (not expired)
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { minLevel, maxLevel, contentTier, limit = 50 } = req.query;

  // Validate params with proper error handling
  const parsedLimit = parseLimit(limit, 50, 100);
  const parsedMinLevel = minLevel !== undefined
    ? parseBoundedInt(minLevel, { min: 1, max: 100, name: 'minLevel' })
    : null;
  const parsedMaxLevel = maxLevel !== undefined
    ? parseBoundedInt(maxLevel, { min: 1, max: 100, name: 'maxLevel' })
    : null;
  const parsedContentTier = contentTier !== undefined
    ? parseBoundedInt(contentTier, { min: 1, max: 5, name: 'contentTier' })
    : null;

  let sql = `
    SELECT
      lp.id,
      lp.user_id,
      u.username,
      lp.party_id,
      lp.title,
      lp.description,
      lp.looking_for,
      lp.min_level,
      lp.max_level,
      lp.content_tier,
      lp.expires_at,
      lp.created_at,
      (
        SELECT json_agg(json_build_object(
          'id', c.id,
          'name', c.name,
          'level', c.level,
          'class', c.class
        ))
        FROM characters c
        WHERE c.user_id = lp.user_id
          AND c.party_slot IS NOT NULL
          AND c.party_slot <= 5
      ) as party_preview
    FROM lfg_posts lp
    JOIN users u ON lp.user_id = u.id
    WHERE lp.expires_at > NOW()
  `;

  const params = [];
  let paramIndex = 1;

  if (parsedMinLevel !== null) {
    sql += ` AND lp.max_level >= $${paramIndex}`;
    params.push(parsedMinLevel);
    paramIndex++;
  }

  if (parsedMaxLevel !== null) {
    sql += ` AND lp.min_level <= $${paramIndex}`;
    params.push(parsedMaxLevel);
    paramIndex++;
  }

  if (parsedContentTier !== null) {
    sql += ` AND lp.content_tier = $${paramIndex}`;
    params.push(parsedContentTier);
    paramIndex++;
  }

  sql += ` ORDER BY lp.created_at DESC LIMIT $${paramIndex}`;
  params.push(parsedLimit);

  const result = await query(sql, params);

  res.json({ posts: result.rows });
}));

/**
 * POST /api/lfg
 * Create a new LFG post
 */
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { title, description, lookingFor, minLevel, maxLevel, contentTier, expiresInHours } = req.body;

  // Validate title using free-text validation (allows punctuation like !, ?, etc.)
  const validatedTitle = validateFreeText(title, { label: 'Title', max: 64, optional: false });
  if (validatedTitle.length < 3) {
    throw new AppError('Title must be between 3 and 64 characters', 400);
  }

  // Validate description using proper string validation
  const validatedDescription = validateFreeText(description, { label: 'Description', max: 256 });

  // Validate lookingFor array
  const validRoles = ['warrior', 'wizard', 'monk', 'chemist', 'tank', 'healer', 'dps', 'any'];
  if (lookingFor && Array.isArray(lookingFor)) {
    for (const role of lookingFor) {
      if (!validRoles.includes(role)) {
        throw new AppError(`Invalid role: ${role}. Valid roles are: ${validRoles.join(', ')}`, 400);
      }
    }
  }

  // Validate level range with proper integer parsing
  const minLvl = minLevel !== undefined
    ? parseBoundedInt(minLevel, { min: 1, max: 100, name: 'minLevel' })
    : 1;
  const maxLvl = maxLevel !== undefined
    ? parseBoundedInt(maxLevel, { min: 1, max: 100, name: 'maxLevel' })
    : 100;

  if (minLvl > maxLvl) {
    throw new AppError('Minimum level cannot be greater than maximum level', 400);
  }

  // Validate content tier
  const tier = contentTier !== undefined
    ? parseBoundedInt(contentTier, { min: 1, max: 5, name: 'contentTier' })
    : null;

  // Calculate expiration (default 4 hours)
  // IMPORTANT: Use ISO string to avoid timezone conversion issues with 'timestamp without time zone' columns
  const hours = expiresInHours !== undefined
    ? parseBoundedInt(expiresInHours, { min: 1, max: 24, name: 'expiresInHours' })
    : 4;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  // Check if user already has an active post
  const existingPost = await query(
    'SELECT id FROM lfg_posts WHERE user_id = $1 AND expires_at > NOW()',
    [req.user.userId]
  );

  if (existingPost.rows.length > 0) {
    throw new AppError('You already have an active LFG post. Delete it before creating a new one.', 400);
  }

  // Get user's party if they have one (fix: use correct party status values)
  const partyResult = await query(
    `SELECT p.id FROM parties p
     JOIN party_members pm ON p.id = pm.party_id
     WHERE pm.user_id = $1 AND p.status IN ('forming', 'ready')
     LIMIT 1`,
    [req.user.userId]
  );

  const partyId = partyResult.rows.length > 0 ? partyResult.rows[0].id : null;

  // Create the post
  const result = await query(
    `INSERT INTO lfg_posts (user_id, party_id, title, description, looking_for, min_level, max_level, content_tier, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, user_id, party_id, title, description, looking_for, min_level, max_level, content_tier, expires_at, created_at`,
    [
      req.user.userId,
      partyId,
      validatedTitle,
      validatedDescription,
      lookingFor || [],
      minLvl,
      maxLvl,
      tier,
      expiresAt
    ]
  );

  res.status(201).json({ post: result.rows[0] });
}));

/**
 * DELETE /api/lfg/:postId
 * Remove own LFG post
 */
router.delete('/:postId', authenticate, asyncHandler(async (req, res) => {
  const { postId } = req.params;

  const postIdInt = parseInt(postId, 10);
  if (isNaN(postIdInt)) {
    throw new AppError('Invalid post ID', 400);
  }

  // Check if post exists and belongs to user
  const existingPost = await query(
    'SELECT id, user_id FROM lfg_posts WHERE id = $1',
    [postIdInt]
  );

  if (existingPost.rows.length === 0) {
    throw new AppError('LFG post not found', 404);
  }

  if (existingPost.rows[0].user_id !== req.user.userId) {
    throw new AppError('You can only delete your own LFG posts', 403);
  }

  await query('DELETE FROM lfg_posts WHERE id = $1', [postIdInt]);

  res.json({ success: true, message: 'LFG post deleted' });
}));

/**
 * POST /api/lfg/:postId/apply
 * Apply to join an LFG post (sends notification to post creator)
 */
router.post('/:postId/apply', authenticate, asyncHandler(async (req, res) => {
  const { postId } = req.params;
  // Same rule as the post's own description: optional, string, <= 256, no markup
  const message = validateFreeText(req.body.message, { label: 'Message', max: 256 });

  const postIdInt = parseInt(postId, 10);
  if (isNaN(postIdInt)) {
    throw new AppError('Invalid post ID', 400);
  }

  // Get the post
  const postResult = await query(
    `SELECT lp.id, lp.user_id, lp.title, lp.min_level, lp.max_level, u.username as creator_username
     FROM lfg_posts lp
     JOIN users u ON lp.user_id = u.id
     WHERE lp.id = $1 AND lp.expires_at > NOW()`,
    [postIdInt]
  );

  if (postResult.rows.length === 0) {
    throw new AppError('LFG post not found or has expired', 404);
  }

  const post = postResult.rows[0];

  // Cannot apply to own post
  if (post.user_id === req.user.userId) {
    throw new AppError('You cannot apply to your own LFG post', 400);
  }

  // Get applicant's highest level character in party
  const applicantResult = await query(
    `SELECT c.name, c.level, c.class
     FROM characters c
     WHERE c.user_id = $1 AND c.party_slot IS NOT NULL AND c.party_slot <= 5
     ORDER BY c.level DESC
     LIMIT 1`,
    [req.user.userId]
  );

  const applicantChar = applicantResult.rows.length > 0 ? applicantResult.rows[0] : null;

  // Check level requirements if character exists
  if (applicantChar) {
    if (applicantChar.level < post.min_level || applicantChar.level > post.max_level) {
      throw new AppError(`Your character level (${applicantChar.level}) does not meet the requirements (${post.min_level}-${post.max_level})`, 400);
    }
  }

  // Create notification for post creator
  const notificationPayload = {
    postId: post.id,
    postTitle: post.title,
    applicantId: req.user.userId,
    applicantUsername: req.user.username,
    applicantCharacter: applicantChar,
    message
  };

  await query(
    `INSERT INTO notifications (user_id, type, title, message, payload, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')`,
    [
      post.user_id,
      'lfg_application',
      `${req.user.username} wants to join your group`,
      message ?? `${req.user.username} applied to join "${post.title}"`,
      JSON.stringify(notificationPayload)
    ]
  );

  // Send real-time notification via WebSocket
  sendToUser(post.user_id, {
    type: 'notification:new',
    payload: {
      type: 'lfg_application',
      title: `${req.user.username} wants to join your group`,
      message: message ?? `${req.user.username} applied to join "${post.title}"`,
      ...notificationPayload
    }
  });

  res.json({
    success: true,
    message: `Application sent to ${post.creator_username}`
  });
}));

/**
 * GET /api/lfg/my-post
 * Get the current user's active LFG post if any
 */
router.get('/my-post', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, user_id, party_id, title, description, looking_for, min_level, max_level, content_tier, expires_at, created_at
     FROM lfg_posts
     WHERE user_id = $1 AND expires_at > NOW()
     LIMIT 1`,
    [req.user.userId]
  );

  res.json({ post: result.rows.length > 0 ? result.rows[0] : null });
}));

export default router;
