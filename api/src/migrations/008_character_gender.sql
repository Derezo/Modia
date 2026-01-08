-- Character Gender Migration
-- Adds gender field to characters for portrait generation and character customization

-- Create gender type enum
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other');

-- Add gender column to characters table
-- Default to 'other' for backwards compatibility with existing characters
ALTER TABLE characters
ADD COLUMN gender gender_type NOT NULL DEFAULT 'other';

-- Create index for potential gender-based queries
CREATE INDEX idx_characters_gender ON characters(gender);
