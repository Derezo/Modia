/**
 * Daily/weekly quest progress for a completed travel.
 *
 * Every node on the path except the origin counts toward 'visit_nodes'
 * (Finding 38/115: +1 per shrine passed, distinct nodes counted by the
 * service), and the destination region toward 'visit_regions'.
 *
 * The updates run one after another. updateProgress is an autocommit
 * read-modify-write of the same quest row (current_progress and
 * progress_data.visited_node_ids); started in parallel, every call read the
 * same starting value and the last write won, so a 5-node path advanced
 * the quest by 1 instead of 4.
 */
import * as dailyQuestService from '../dailyQuestService.js';

/**
 * @param {number} characterId
 * @param {Array<{id: number, node_type: string}>} pathNodes - Path including the origin at index 0
 * @param {{region_id?: number}|null} destNode
 * @param {Function} [updateProgress] - Injectable for tests
 * @returns {Promise<void>} Resolves when every update has run; failures are logged, not thrown
 */
export async function trackTravelQuestProgress(
  characterId,
  pathNodes,
  destNode,
  updateProgress = dailyQuestService.updateProgress
) {
  const nodes = Array.isArray(pathNodes) ? pathNodes.slice(1) : [];
  for (const node of nodes) {
    try {
      // nodeType for filtered quests (shrines, taverns), nodeId for deduplication
      await updateProgress(characterId, 'visit_nodes', 1, {
        nodeType: node.node_type,
        nodeId: node.id
      });
    } catch (err) {
      console.warn('[Quest] visit_nodes progress failed:', err.message);
    }
  }

  if (destNode?.region_id) {
    try {
      await updateProgress(characterId, 'visit_regions', 1, {
        regionId: destNode.region_id
      });
    } catch (err) {
      console.warn('[Quest] visit_regions progress failed:', err.message);
    }
  }
}
