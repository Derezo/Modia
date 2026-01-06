-- Character Skills Table
-- ============================================
-- Stores learned skills and their levels for each character

CREATE TABLE IF NOT EXISTS character_skills (
    id SERIAL PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    skill_id VARCHAR(50) NOT NULL,
    level INTEGER DEFAULT 1 CHECK (level >= 1),
    learned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_character_skill UNIQUE (character_id, skill_id)
);

CREATE INDEX idx_character_skills_char ON character_skills(character_id);
CREATE INDEX idx_character_skills_skill ON character_skills(skill_id);
