-- Rollback Migration 063: Quest Progress Deduplication

DROP INDEX IF EXISTS idx_cdq_progress_data;
ALTER TABLE character_daily_quests DROP COLUMN IF EXISTS progress_data;
