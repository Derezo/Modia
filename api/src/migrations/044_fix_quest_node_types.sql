-- Migration: Fix invalid node_type in quest templates
-- The 'daily_visit_taverns' quest incorrectly used 'tavern' as a node_type
-- 'tavern' is a FEATURE that exists on castle and city nodes, not a node_type
-- This fixes the 500 error: 'invalid input value for enum node_type: "tavern"'

-- Update the quest to target nodes that have tavern feature (castle, city)
UPDATE daily_quest_templates
SET objective_requirements = '{"node_types": ["castle", "city"]}'::jsonb,
    quest_description = 'Visit 3 castles or cities with taverns'
WHERE quest_key = 'daily_visit_taverns';
