DROP INDEX IF EXISTS idx_fishing_catches_session;
DROP INDEX IF EXISTS idx_fishing_catches_attempt_unique;

ALTER TABLE user_fishing_catches
  DROP COLUMN IF EXISTS is_big_catch,
  DROP COLUMN IF EXISTS size_multiplier,
  DROP COLUMN IF EXISTS value,
  DROP COLUMN IF EXISTS rarity,
  DROP COLUMN IF EXISTS attempt_id,
  DROP COLUMN IF EXISTS session_id;

DROP TABLE IF EXISTS fishing_action_receipts;
DROP TABLE IF EXISTS user_fishing_attempts;

ALTER TABLE user_fishing_sessions
  DROP COLUMN IF EXISTS session_expires_at,
  DROP COLUMN IF EXISTS biome_source,
  DROP COLUMN IF EXISTS biome_key,
  DROP COLUMN IF EXISTS selected_tackle_key,
  DROP COLUMN IF EXISTS selected_rod_key;

UPDATE enemy_templates
SET drop_table = drop_table - 'fixedDrops'
WHERE LOWER(name) IN ('harpy', 'forest slime', 'bridge bandit', 'bridge troll')
  AND jsonb_typeof(drop_table) = 'object';

DELETE FROM item_templates
WHERE catalog_key LIKE 'fishing:%'
  AND NOT EXISTS (
    SELECT 1
    FROM character_items
    WHERE character_items.item_template_id = item_templates.id
  );
