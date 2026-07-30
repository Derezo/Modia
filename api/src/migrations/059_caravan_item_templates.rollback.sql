-- Refuse to remove canonical caravan templates while any table still
-- references them. Also refuse to drop catalog_key if another feature has
-- adopted it, because dropping the column would discard that feature's stable
-- identity even when its templates themselves remain.
DO $$
DECLARE
  reference_column RECORD;
  has_references BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'item_templates'
      AND column_name = 'catalog_key'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM item_templates
      WHERE catalog_key IS NOT NULL
        AND catalog_key NOT LIKE 'caravan:%'
    ) THEN
      RAISE EXCEPTION
        'Cannot roll back caravan item templates: non-caravan catalog keys exist';
    END IF;

    -- Scan every conventional item-template reference, not only declared
    -- foreign keys. Several projection/audit tables intentionally carry the
    -- identifier without a database constraint.
    FOR reference_column IN
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND column_name = 'item_template_id'
    LOOP
      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM %I.%I referenced_row
           JOIN %I.item_templates template
             ON referenced_row.%I = template.id
           WHERE template.catalog_key LIKE ''caravan:%%''
         )',
        reference_column.table_schema,
        reference_column.table_name,
        current_schema(),
        reference_column.column_name
      )
      INTO has_references;

      IF has_references THEN
        RAISE EXCEPTION
          'Cannot roll back caravan item templates: caravan templates are referenced by %.%',
          reference_column.table_schema,
          reference_column.table_name;
      END IF;
    END LOOP;

    DELETE FROM item_templates
    WHERE catalog_key LIKE 'caravan:%';
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_item_templates_catalog_key;

ALTER TABLE item_templates
  DROP COLUMN IF EXISTS catalog_key;
