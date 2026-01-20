-- Migration: Fix HP/MP for existing characters
-- Bug: HP/MP were never updated when characters leveled up via skill learning
-- This migration recalculates hp_max and mp_max for all characters based on their
-- race, class, and level using the formula from shared/constants.js

-- Create a temporary table with race base stats
CREATE TEMP TABLE race_base_stats (
    race TEXT PRIMARY KEY,
    base_hp INTEGER,
    base_mp INTEGER,
    base_vitality INTEGER
);

INSERT INTO race_base_stats (race, base_hp, base_mp, base_vitality) VALUES
    ('human', 100, 50, 10),
    ('elf', 80, 80, 6),
    ('dwarf', 120, 30, 16),
    ('vampire', 90, 60, 8),
    ('orc', 130, 20, 14);

-- Create a temporary table with class growth rates
CREATE TEMP TABLE class_growth (
    class TEXT PRIMARY KEY,
    hp_growth NUMERIC,
    mp_growth NUMERIC,
    vit_growth NUMERIC
);

-- Base classes
INSERT INTO class_growth (class, hp_growth, mp_growth, vit_growth) VALUES
    ('warrior', 15, 3, 2),
    ('wizard', 8, 12, 1),
    ('monk', 10, 6, 1),
    ('chemist', 10, 8, 2);

-- Advanced classes - Warrior line
INSERT INTO class_growth (class, hp_growth, mp_growth, vit_growth) VALUES
    ('berserker', 18, 2, 2),
    ('paladin', 16, 6, 3),
    ('guardian', 20, 4, 4),
    ('warlord', 17, 5, 2);

-- Advanced classes - Wizard line
INSERT INTO class_growth (class, hp_growth, mp_growth, vit_growth) VALUES
    ('sorcerer', 7, 15, 1),
    ('summoner', 9, 14, 2),
    ('conjurer', 8, 13, 1),
    ('oracle', 8, 14, 1);

-- Advanced classes - Monk line
INSERT INTO class_growth (class, hp_growth, mp_growth, vit_growth) VALUES
    ('ninja', 10, 5, 1),
    ('martial_artist', 12, 5, 1),
    ('brawler', 14, 4, 2),
    ('ascetic', 11, 8, 1);

-- Advanced classes - Chemist line
INSERT INTO class_growth (class, hp_growth, mp_growth, vit_growth) VALUES
    ('alchemist', 11, 10, 2),
    ('medic', 12, 12, 2),
    ('plague_doctor', 10, 11, 1),
    ('artificer', 11, 9, 2);

-- Update hp_max and mp_max for all characters
-- HP formula: baseHP + (hp_growth * (level - 1)) + vitBonus
-- VIT bonus = floor((level / 2) + (vitality * 0.5))
-- Where vitality = base_vitality + (vit_growth * (level - 1))
-- MP formula: baseMP + (mp_growth * (level - 1))

UPDATE characters c
SET
    hp_max = (
        SELECT
            -- baseHP + level growth
            rbs.base_hp + (cg.hp_growth * (c.level - 1))
            -- + vitBonus
            + FLOOR(
                (c.level::NUMERIC / 2) +
                (
                    -- vitality = base_vitality + vit_growth * (level - 1)
                    (rbs.base_vitality + (cg.vit_growth * (c.level - 1))) * 0.5
                )
            )
        FROM race_base_stats rbs, class_growth cg
        WHERE rbs.race = c.race::TEXT AND cg.class = c.class::TEXT
    ),
    mp_max = (
        SELECT
            rbs.base_mp + (cg.mp_growth * (c.level - 1))
        FROM race_base_stats rbs, class_growth cg
        WHERE rbs.race = c.race::TEXT AND cg.class = c.class::TEXT
    )
WHERE EXISTS (
    SELECT 1 FROM race_base_stats rbs, class_growth cg
    WHERE rbs.race = c.race::TEXT AND cg.class = c.class::TEXT
);

-- Also update hp_current and mp_current if they were at/above old max
-- (don't over-heal injured characters, but fix those who were at "full" health)
-- For simplicity, cap hp_current/mp_current to new max if they exceed it
UPDATE characters
SET
    hp_current = LEAST(hp_current, hp_max),
    mp_current = LEAST(mp_current, mp_max);

-- Also ensure hp_current/mp_current are at least 1 (alive characters)
UPDATE characters
SET
    hp_current = GREATEST(hp_current, 1),
    mp_current = GREATEST(mp_current, 0)
WHERE hp_current > 0;

-- Drop temporary tables
DROP TABLE IF EXISTS race_base_stats;
DROP TABLE IF EXISTS class_growth;

-- Log the migration
COMMENT ON TABLE characters IS 'Migration 037: Fixed HP/MP calculation for existing characters';
