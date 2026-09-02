-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS & DOMAINS (Optional / Safe Fallbacks)
DO $$ BEGIN
    CREATE TYPE post_status_enum AS ENUM ('draft', 'pending', 'processing', 'published', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE media_type_enum AS ENUM ('none', 'image', 'video', 'document');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================================================
-- 4. TABLE: PROFILES
-- Stores user account info, LinkedIn profile data, and AES-256 encrypted tokens.
-- Linked to Supabase auth.users for secure session management.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    linkedin_member_id TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT,
    picture_url TEXT,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    token_expires_at TIMESTAMPTZ NOT NULL,
    refresh_token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Trigger for profiles updated_at
DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. TABLE: POSTS
-- Stores drafts, scheduled posts, published posts, and error logs.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    media_url TEXT,
    media_type TEXT CHECK (media_type IN ('none', 'image', 'video', 'document')) DEFAULT 'none' NOT NULL,
    media_asset_urn TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    status TEXT CHECK (status IN ('draft', 'pending', 'processing', 'published', 'failed')) DEFAULT 'pending' NOT NULL,
    linkedin_post_urn TEXT,
    error_log TEXT,
    retry_count INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Trigger for posts updated_at
DROP TRIGGER IF EXISTS set_posts_updated_at ON public.posts;
CREATE TRIGGER set_posts_updated_at
    BEFORE UPDATE ON public.posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 6. TABLE: AI_GENERATION_LOGS (Audit & Quota Tracking)
-- Tracks AI generation history, topics, and models used.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ai_generation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    tone TEXT DEFAULT 'insightful',
    generated_content TEXT NOT NULL,
    model TEXT DEFAULT 'mistral-small-latest' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- 7. PERFORMANCE INDEXES
-- Designed for sub-5ms Cloudflare Worker cron polling and fast UI feeds.
-- =============================================================================

-- Partial Index: Ultra-fast cron polling for pending due posts
CREATE INDEX IF NOT EXISTS idx_posts_poll 
    ON public.posts (status, scheduled_at) 
    WHERE status = 'pending';

-- Index for listing user posts by status & schedule order (Calendar/Feed views)
CREATE INDEX IF NOT EXISTS idx_posts_user_status_schedule 
    ON public.posts (user_id, status, scheduled_at DESC);

-- Index for user profiles by LinkedIn Member ID
CREATE INDEX IF NOT EXISTS idx_profiles_linkedin_member 
    ON public.profiles (linkedin_member_id);

-- Index for AI generation logs per user
CREATE INDEX IF NOT EXISTS idx_ai_logs_user 
    ON public.ai_generation_logs (user_id, created_at DESC);

-- =============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures mobile clients can only access/mutate their own authorized data.
-- Service Role (Backend Server) bypasses RLS automatically.
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_logs ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" 
    ON public.profiles FOR SELECT 
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
    ON public.profiles FOR UPDATE 
    USING (auth.uid() = id);

-- Posts Policies
DROP POLICY IF EXISTS "Users can view own posts" ON public.posts;
CREATE POLICY "Users can view own posts" 
    ON public.posts FOR SELECT 
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own posts" ON public.posts;
CREATE POLICY "Users can insert own posts" 
    ON public.posts FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
CREATE POLICY "Users can update own posts" 
    ON public.posts FOR UPDATE 
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own posts" ON public.posts;
CREATE POLICY "Users can delete own posts" 
    ON public.posts FOR DELETE 
    USING (auth.uid() = user_id);

-- AI Generation Logs Policies
DROP POLICY IF EXISTS "Users can view own AI logs" ON public.ai_generation_logs;
CREATE POLICY "Users can view own AI logs" 
    ON public.ai_generation_logs FOR SELECT 
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own AI logs" ON public.ai_generation_logs;
CREATE POLICY "Users can insert own AI logs" 
    ON public.ai_generation_logs FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- 9. ATOMIC CLAIMING STORED PROCEDURE
-- Used by the backend publishing engine to atomically claim and lock due posts,
-- eliminating race conditions across concurrent cron executions.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_due_posts(batch_limit INT DEFAULT 10)
RETURNS TABLE (
    post_id UUID,
    post_user_id UUID,
    post_content TEXT,
    post_media_url TEXT,
    post_media_type TEXT,
    post_media_asset_urn TEXT,
    post_scheduled_at TIMESTAMPTZ,
    post_retry_count INT,
    user_encrypted_token TEXT,
    user_linkedin_member_id TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH due_posts AS (
        SELECT p.id
        FROM public.posts p
        WHERE p.status = 'pending'
          AND p.scheduled_at <= NOW()
        ORDER BY p.scheduled_at ASC
        LIMIT batch_limit
        FOR UPDATE SKIP LOCKED
    ),
    updated AS (
        UPDATE public.posts p
        SET status = 'processing',
            updated_at = NOW()
        FROM due_posts d
        WHERE p.id = d.id
        RETURNING p.id, p.user_id, p.content, p.media_url, p.media_type, p.media_asset_urn, p.scheduled_at, p.retry_count
    )
    SELECT 
        u.id AS post_id,
        u.user_id AS post_user_id,
        u.content AS post_content,
        u.media_url AS post_media_url,
        u.media_type AS post_media_type,
        u.media_asset_urn AS post_media_asset_urn,
        u.scheduled_at AS post_scheduled_at,
        u.retry_count AS post_retry_count,
        prof.encrypted_access_token AS user_encrypted_token,
        prof.linkedin_member_id AS user_linkedin_member_id
    FROM updated u
    JOIN public.profiles prof ON prof.id = u.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 10. SUPABASE REALTIME REPLICATION
-- Broadcasts live post state changes (pending -> processing -> published)
-- directly to connected mobile clients.
-- =============================================================================
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
