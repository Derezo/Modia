-- Migration 063: Quest Progress Deduplication
-- Adds a progress_data column to character_daily_quests for tracking visited nodes/regions
-- to implement proper deduplication for 'visit different nodes' and 'visit all regions' quests.
-- Finding 38 & 115: Without this, players can complete these quests by revisiting the same
-- nodes/regions repeatedly.

-- Add progress_data column for tracking visited items per quest
ALTER TABLE character_daily_quests
ADD COLUMN IF NOT EXISTS progress_data JSONB DEFAULT '{}';

-- Add a comment explaining the structure
COMMENT ON COLUMN character_daily_quests.progress_data IS
'Tracks deduplicated progress for visit quests. Structure:
{
  "visited_node_ids": [1, 2, 3],     -- for visit_nodes quests
  "visited_region_ids": [1, 2]       -- for visit_regions quests
}
Updated atomically with progress to ensure correct distinct counts.';

-- Index for queries that filter on progress_data (e.g., checking if a node was visited)
CREATE INDEX IF NOT EXISTS idx_cdq_progress_data
ON character_daily_quests USING GIN (progress_data)
WHERE progress_data != '{}';
