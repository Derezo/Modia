-- Give application-owned catalog items a stable, namespaced identity without
-- weakening the canonical character_items -> item_templates relationship.

ALTER TABLE item_templates
  ADD COLUMN IF NOT EXISTS catalog_key VARCHAR;

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_templates_catalog_key
  ON item_templates(catalog_key);
