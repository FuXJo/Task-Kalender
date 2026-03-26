-- Casino Games Migration
-- Adds casino columns, removes forest columns from gamification_state table

-- Add new casino columns
ALTER TABLE gamification_state ADD COLUMN IF NOT EXISTS last_wheel_spin TEXT DEFAULT '';
ALTER TABLE gamification_state ADD COLUMN IF NOT EXISTS casino_stats JSONB DEFAULT '{"totalWon": 0, "totalLost": 0, "biggestWin": 0}'::jsonb;

-- Remove old forest columns (optional - safe to keep)
-- ALTER TABLE gamification_state DROP COLUMN IF EXISTS forest;
-- ALTER TABLE gamification_state DROP COLUMN IF EXISTS unlocked_plants;
