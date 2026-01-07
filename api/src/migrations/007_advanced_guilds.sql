-- Advanced Guilds Migration
-- ============================================
-- Adds advanced class types for guild advancement system

-- Add new advanced class values to class_type enum
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'berserker';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'sorcerer';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'ninja';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'alchemist';

-- Note: Characters can advance from base class to advanced class at level 20+
-- Advancement path:
--   warrior  -> berserker
--   wizard   -> sorcerer
--   monk     -> ninja
--   chemist  -> alchemist
