-- =============================================================================
-- Migration: 20260906000000_post_analytics.sql
-- Description: Adds analytics metrics columns to public.posts and creates
--              public.post_analytics_history for timeline tracking with RLS.
-- =============================================================================

-- 1. Extend posts table with real-time cached metrics counters
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS likes_count INT DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS comments_count INT DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS shares_count INT DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS impressions_count INT DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS engagement_rate NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
ADD COLUMN IF NOT EXISTS metrics_last_synced_at TIMESTAMPTZ;

-- 2. Create historical analytics table for timeline graphs & weekly retention reports
CREATE TABLE IF NOT EXISTS public.post_analytics_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    likes INT DEFAULT 0 NOT NULL,
    comments INT DEFAULT 0 NOT NULL,
    shares INT DEFAULT 0 NOT NULL,
    impressions INT DEFAULT 0 NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_post_analytics_post_id 
    ON public.post_analytics_history(post_id);

CREATE INDEX IF NOT EXISTS idx_post_analytics_user_date 
    ON public.post_analytics_history(user_id, recorded_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.post_analytics_history ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Users can only read their own analytics history
DROP POLICY IF EXISTS "Users can view own post analytics" ON public.post_analytics_history;
CREATE POLICY "Users can view own post analytics" 
    ON public.post_analytics_history FOR SELECT 
    USING (auth.uid() = user_id);

-- Backend service role (used by corelink_server) automatically bypasses RLS
