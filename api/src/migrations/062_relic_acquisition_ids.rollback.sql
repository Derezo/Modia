-- ============================================
-- Rollback for Migration 062: Reset relic acquisition_id values
--
-- WARNING: This rollback reverts the security fix that prevents
-- unconditional relic claiming. After rollback, relics with NULL
-- acquisition_id may become freely claimable depending on service code.
-- ============================================

-- Reset all acquisition_id values to NULL
UPDATE relic_templates
SET acquisition_id = NULL
WHERE key IN ('wayfarers_compass', 'vitality_charm', 'cartographers_eye');
