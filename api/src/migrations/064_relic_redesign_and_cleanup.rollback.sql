-- ============================================
-- Rollback for Migration 063: Relic Acquisition Redesign + Equipment Cleanup
--
-- WARNING: This rollback restores the previous guild-specific acquisition_ids
-- which makes relics class-dependent again. It does NOT restore the mis-equipped
-- items to their invalid slots (that would reintroduce the stat stacking bug).
-- ============================================

-- Restore wayfarers_compass to warrior tier-1 quest
UPDATE relic_templates
SET acquisition_id = (SELECT id FROM advancement_quest_templates WHERE guild_id = 'warrior' AND tier = 1 LIMIT 1)
WHERE key = 'wayfarers_compass';

-- Restore vitality_charm to wizard tier-1 quest
UPDATE relic_templates
SET acquisition_id = (SELECT id FROM advancement_quest_templates WHERE guild_id = 'wizard' AND tier = 1 LIMIT 1)
WHERE key = 'vitality_charm';

-- Restore cartographers_eye to specific watchtower node
UPDATE relic_templates
SET acquisition_id = (SELECT id FROM world_nodes WHERE node_type = 'watchtower' ORDER BY id LIMIT 1)
WHERE key = 'cartographers_eye';

-- Note: Equipment cleanup cannot be rolled back (would reintroduce stat stacking)
-- Note: Shop cleanup cannot be meaningfully rolled back (we don't know original values)
