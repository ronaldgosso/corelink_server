-- =============================================================================
-- Migration: 20261007000000_devto_support.sql
-- Description: Adds DEV.to integration support, multi-platform publishing columns,
--              and DEV.to article tracking to public.posts and public.profiles.
-- =============================================================================

-- 1. Extend posts table with multi-platform and DEV.to metadata columns
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT ARRAY['linkedin']::TEXT[] NOT NULL,
ADD COLUMN IF NOT EXISTS devto_article_id INT,
ADD COLUMN IF NOT EXISTS devto_url TEXT,
ADD COLUMN IF NOT EXISTS devto_published_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS devto_title TEXT,
ADD COLUMN IF NOT EXISTS devto_tags TEXT[],
ADD COLUMN IF NOT EXISTS devto_canonical_url TEXT;

-- 2. Extend profiles table with encrypted DEV.to API key storage
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS encrypted_devto_api_key TEXT;

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_posts_devto_article_id 
    ON public.posts(devto_article_id);

CREATE INDEX IF NOT EXISTS idx_posts_platforms 
    ON public.posts USING GIN(platforms);

-- 4. Comments for Schema Documentation
COMMENT ON COLUMN public.posts.platforms IS 'Array of target publishing destinations: linkedin, devto';
COMMENT ON COLUMN public.posts.devto_article_id IS 'Unique article identifier returned by DEV.to API';
COMMENT ON COLUMN public.posts.devto_url IS 'Canonical public URL of article published on DEV.to';
COMMENT ON COLUMN public.posts.devto_published_at IS 'Timestamp of article publication on DEV.to';
COMMENT ON COLUMN public.profiles.encrypted_devto_api_key IS 'AES-256 encrypted DEV.to API key for user profile';
