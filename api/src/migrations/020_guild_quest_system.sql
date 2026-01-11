-- Migration 020: Guild Quest System
-- Adds advancement quest templates and character quest tracking

-- ============================================
-- ADD REMAINING ADVANCED CLASS TYPES
-- ============================================
-- Warrior guild advancements (T2-T4)
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'paladin';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'guardian';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'warlord';

-- Wizard guild advancements (T2-T4)
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'summoner';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'conjurer';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'oracle';

-- Monk guild advancements (T2-T4)
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'martial_artist';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'brawler';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'ascetic';

-- Chemist guild advancements (T2-T4)
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'medic';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'plague_doctor';
ALTER TYPE class_type ADD VALUE IF NOT EXISTS 'artificer';

-- ============================================
-- QUEST STATUS TYPE
-- ============================================
CREATE TYPE quest_status AS ENUM ('active', 'boss_ready', 'completed', 'abandoned');

-- ============================================
-- ADVANCEMENT QUEST TEMPLATES
-- ============================================
-- Static quest definitions for each class advancement path
CREATE TABLE advancement_quest_templates (
  id SERIAL PRIMARY KEY,

  -- Guild and tier identification
  guild_id VARCHAR(20) NOT NULL,              -- Base guild: warrior, wizard, monk, chemist
  tier INTEGER NOT NULL CHECK (tier >= 1 AND tier <= 4),
  target_class VARCHAR(30) NOT NULL,          -- Class to advance to
  prerequisite_class VARCHAR(30),             -- Required current class (null for T1 from base)

  -- Quest info
  quest_name VARCHAR(100) NOT NULL,
  quest_description TEXT NOT NULL,

  -- Requirements (JSONB for flexibility)
  -- material_requirements: [{item_template_id, quantity, rarity}]
  material_requirements JSONB NOT NULL DEFAULT '[]',

  -- enemy_requirements: [{enemy_archetype, count, zone_tier}]
  enemy_requirements JSONB NOT NULL DEFAULT '[]',

  -- node_requirements: [{node_type, count, min_tier}]
  node_requirements JSONB NOT NULL DEFAULT '[]',

  -- Boss configuration
  -- boss_config: {guildmaster_class, phase_count, disciple_classes: [...]}
  boss_config JSONB NOT NULL,

  -- Rewards beyond class advancement
  gold_reward INTEGER DEFAULT 0,
  xp_reward INTEGER DEFAULT 0,
  title_reward VARCHAR(50),                   -- Optional title earned

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_quest_per_tier UNIQUE (guild_id, tier)
);

CREATE INDEX idx_quest_templates_guild ON advancement_quest_templates(guild_id);
CREATE INDEX idx_quest_templates_tier ON advancement_quest_templates(tier);
CREATE INDEX idx_quest_templates_target ON advancement_quest_templates(target_class);

-- ============================================
-- CHARACTER QUEST PROGRESS
-- ============================================
-- Tracks active/completed quests per character
CREATE TABLE character_quests (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_template_id INTEGER NOT NULL REFERENCES advancement_quest_templates(id),
  status quest_status DEFAULT 'active',

  -- Progress tracking (JSONB for flexibility)
  -- material_progress: {item_template_id: collected_count}
  material_progress JSONB DEFAULT '{}',

  -- enemy_progress: {enemy_archetype: kill_count}
  enemy_progress JSONB DEFAULT '{}',

  -- node_progress: {node_type: [visited_node_ids]}
  node_progress JSONB DEFAULT '{}',

  -- Timestamps
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  boss_unlocked_at TIMESTAMP,                 -- When objectives completed
  completed_at TIMESTAMP,
  abandoned_at TIMESTAMP,

  CONSTRAINT one_active_quest_per_character UNIQUE (character_id)
    -- Note: This constraint only allows one row per character
    -- We'll handle status filtering in application logic
);

CREATE INDEX idx_character_quests_character ON character_quests(character_id);
CREATE INDEX idx_character_quests_status ON character_quests(status);
CREATE INDEX idx_character_quests_template ON character_quests(quest_template_id);

-- ============================================
-- QUEST ITEM TRACKING
-- ============================================
-- Tracks quest-specific items (not in regular inventory)
CREATE TABLE character_quest_items (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id INTEGER NOT NULL REFERENCES character_quests(id) ON DELETE CASCADE,
  item_template_id INTEGER NOT NULL,
  quantity INTEGER DEFAULT 0,
  obtained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(character_id, quest_id, item_template_id)
);

CREATE INDEX idx_quest_items_character ON character_quest_items(character_id);
CREATE INDEX idx_quest_items_quest ON character_quest_items(quest_id);

-- ============================================
-- CHARACTER TITLES
-- ============================================
-- Titles earned from completing advancement quests
CREATE TABLE character_titles (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title VARCHAR(50) NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT FALSE,            -- Currently displayed title

  UNIQUE(character_id, title)
);

CREATE INDEX idx_character_titles_character ON character_titles(character_id);
CREATE INDEX idx_character_titles_active ON character_titles(is_active) WHERE is_active = TRUE;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to check if a character can start a specific quest
CREATE OR REPLACE FUNCTION can_start_advancement_quest(
  p_character_id INTEGER,
  p_quest_template_id INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_char_level INTEGER;
  v_char_class VARCHAR(30);
  v_quest_prereq VARCHAR(30);
  v_has_active_quest BOOLEAN;
BEGIN
  -- Get character info
  SELECT level, class::TEXT INTO v_char_level, v_char_class
  FROM characters WHERE id = p_character_id;

  -- Check minimum level (10)
  IF v_char_level < 10 THEN
    RETURN FALSE;
  END IF;

  -- Check if character already has an active quest
  SELECT EXISTS(
    SELECT 1 FROM character_quests
    WHERE character_id = p_character_id
    AND status IN ('active', 'boss_ready')
  ) INTO v_has_active_quest;

  IF v_has_active_quest THEN
    RETURN FALSE;
  END IF;

  -- Get quest prerequisite
  SELECT prerequisite_class INTO v_quest_prereq
  FROM advancement_quest_templates WHERE id = p_quest_template_id;

  -- Check prerequisite class
  IF v_quest_prereq IS NOT NULL AND v_char_class != v_quest_prereq THEN
    RETURN FALSE;
  END IF;

  -- T1 quests require base class
  IF v_quest_prereq IS NULL THEN
    IF v_char_class NOT IN ('warrior', 'wizard', 'monk', 'chemist') THEN
      RETURN FALSE;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to check if quest objectives are complete
CREATE OR REPLACE FUNCTION check_quest_objectives_complete(p_quest_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_template_id INTEGER;
  v_mat_req JSONB;
  v_enemy_req JSONB;
  v_node_req JSONB;
  v_mat_prog JSONB;
  v_enemy_prog JSONB;
  v_node_prog JSONB;
  v_req JSONB;
  v_count INTEGER;
BEGIN
  -- Get quest info
  SELECT cq.quest_template_id, cq.material_progress, cq.enemy_progress, cq.node_progress,
         qt.material_requirements, qt.enemy_requirements, qt.node_requirements
  INTO v_template_id, v_mat_prog, v_enemy_prog, v_node_prog, v_mat_req, v_enemy_req, v_node_req
  FROM character_quests cq
  JOIN advancement_quest_templates qt ON qt.id = cq.quest_template_id
  WHERE cq.id = p_quest_id;

  -- Check material requirements
  FOR v_req IN SELECT * FROM jsonb_array_elements(v_mat_req)
  LOOP
    v_count := COALESCE((v_mat_prog->>((v_req->>'item_template_id')))::INTEGER, 0);
    IF v_count < (v_req->>'quantity')::INTEGER THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  -- Check enemy requirements
  FOR v_req IN SELECT * FROM jsonb_array_elements(v_enemy_req)
  LOOP
    v_count := COALESCE((v_enemy_prog->>((v_req->>'enemy_archetype')))::INTEGER, 0);
    IF v_count < (v_req->>'count')::INTEGER THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  -- Check node requirements
  FOR v_req IN SELECT * FROM jsonb_array_elements(v_node_req)
  LOOP
    v_count := COALESCE(jsonb_array_length(v_node_prog->(v_req->>'node_type')), 0);
    IF v_count < (v_req->>'count')::INTEGER THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
