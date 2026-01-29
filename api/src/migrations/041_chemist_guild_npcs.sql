-- Migration 041: Add chemist guild support for healer/alchemist NPCs
-- Extends the guild system (introduced in migration 010) to include chemist-type humanoids
-- These NPCs will use chemist skill trees for healing and buff abilities

-- Healer/alchemist-type humanoids -> humanoid archetype with chemist guild
UPDATE enemy_templates SET archetype = 'humanoid', enemy_class = 'chemist', guild = 'chemist'
WHERE LOWER(name) LIKE '%healer%'
   OR LOWER(name) LIKE '%alchemist%'
   OR LOWER(name) LIKE '%apothecary%'
   OR LOWER(name) LIKE '%medic%';
