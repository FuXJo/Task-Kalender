-- Migration: Add gamification expansion columns
-- Run this AFTER the initial supabase_gamification.sql

-- Add new columns to user_gamification
ALTER TABLE user_gamification
  ADD COLUMN IF NOT EXISTS today_study_minutes float NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS today_study_date text DEFAULT '',
  ADD COLUMN IF NOT EXISTS forest jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unlocked_plants jsonb NOT NULL DEFAULT '["sprout"]'::jsonb,
  ADD COLUMN IF NOT EXISTS daily_challenges jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS weekly_challenges jsonb NOT NULL DEFAULT '[]'::jsonb;
