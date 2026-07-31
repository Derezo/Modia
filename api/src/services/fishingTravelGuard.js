import { AppError } from '../middleware/errorHandler.js';

/**
 * Lock and reject any unsettled fishing session while the caller holds the
 * user and party-leader locks. Remote packing remains available for a
 * migrated session, so preserving this invariant cannot strand its basket.
 */
export async function assertNoUnsettledFishingSession(client, userId) {
  const result = await client.query(
    `SELECT session_id, node_id, node_name, status
     FROM user_fishing_sessions
     WHERE user_id = $1 AND status IN ('active', 'expired')
     ORDER BY started_at
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  const session = result.rows[0];
  if (!session) return;
  throw new AppError(
    `Pack up and collect your fishing basket at ${session.node_name} before traveling.`,
    409,
    {
      fishingSession: {
        sessionId: session.session_id,
        nodeId: session.node_id,
        status: session.status
      }
    }
  );
}
