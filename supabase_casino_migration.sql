-- Casino Games Migration
ALTER TABLE user_gamification ADD COLUMN IF NOT EXISTS last_wheel_spin TEXT DEFAULT '';
ALTER TABLE user_gamification ADD COLUMN IF NOT EXISTS casino_stats JSONB DEFAULT '{"totalWon": 0, "totalLost": 0, "biggestWin": 0}'::jsonb;

-- Flashcards Migration
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS category_flashcards JSONB DEFAULT '{}'::jsonb;
