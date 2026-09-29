-- ============================================
-- Migration 062: Set relic acquisition_id values
--
-- SECURITY FIX: Without proper acquisition_id values, relics were either:
-- - Unconditionally claimable (cartographers_eye with NULL node acquisition_id)
-- - Claimable after any quest (quest relics with NULL acquisition_id)
--
-- This migration sets sensible acquisition_id values:
-- - wayfarers_compass: First advancement quest (tier 1 warrior)
-- - vitality_charm: Second advancement quest (tier 1 wizard)
-- - cartographers_eye: First watchtower node ID (visit a watchtower to unlock)
-- - merchants_seal: Left NULL (INTEGER column vs string achievement_key mismatch)
--
-- The claimRelic service now denies claims when acquisition_id is NULL,
-- making unconfigured relics "not yet obtainable" rather than freely claimable.
--
-- NOTE: character_quests.quest_template_id references advancement_quest_templates.id,
-- so quest relics must point to advancement_quest_templates, not daily_quest_templates.
-- ============================================

-- wayfarers_compass: set to tier 1 warrior advancement quest
UPDATE relic_templates
SET acquisition_id = (SELECT id FROM advancement_quest_templates WHERE guild_id = 'warrior' AND tier = 1 LIMIT 1)
WHERE key = 'wayfarers_compass';

-- vitality_charm: set to tier 1 wizard advancement quest
UPDATE relic_templates
SET acquisition_id = (SELECT id FROM advancement_quest_templates WHERE guild_id = 'wizard' AND tier = 1 LIMIT 1)
WHERE key = 'vitality_charm';

-- cartographers_eye: set to first watchtower node (visit a watchtower to unlock)
UPDATE relic_templates
SET acquisition_id = (SELECT id FROM world_nodes WHERE node_type = 'watchtower' ORDER BY id LIMIT 1)
WHERE key = 'cartographers_eye';

-- merchants_seal: leave NULL for now (INTEGER column cannot hold achievement_key string)
-- The service will report "not yet obtainable" until the achievement system is fully implemented
-- with a proper acquisition_id reference.

-- Note: This migration uses subqueries to look up IDs by stable keys rather than
-- hard-coding numeric IDs which may differ across environments.
