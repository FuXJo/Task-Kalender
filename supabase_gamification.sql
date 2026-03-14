-- ============================================
-- Gamification Tables for Study Calendar
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. User Gamification State
CREATE TABLE IF NOT EXISTS user_gamification (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  coins float NOT NULL DEFAULT 0,
  streak_freezes_used integer NOT NULL DEFAULT 0,
  streak_freeze_month text DEFAULT '',
  best_streak integer NOT NULL DEFAULT 0,
  achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
  exchange_rate float NOT NULL DEFAULT 0.25,
  weekly_challenge_target integer DEFAULT NULL,
  weekly_challenge_week text DEFAULT '',
  total_study_minutes float NOT NULL DEFAULT 0,
  total_tasks_done integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE user_gamification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own gamification" ON user_gamification
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own gamification" ON user_gamification
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own gamification" ON user_gamification
  FOR UPDATE USING (auth.uid() = user_id);

-- 2. Timer Sessions
CREATE TABLE IF NOT EXISTS timer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('study', 'break')),
  started_at timestamptz NOT NULL DEFAULT now(),
  duration_minutes float NOT NULL DEFAULT 0,
  coins_earned float NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE timer_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions" ON timer_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions" ON timer_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions" ON timer_sessions
  FOR UPDATE USING (auth.uid() = user_id);
