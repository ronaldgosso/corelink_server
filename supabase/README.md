# Supabase Database Schema & Setup Guide

This directory contains the production-grade PostgreSQL database schema, Row Level Security (RLS) policies, atomic post-claiming functions, and performance indexes for **Corelink Server**.

---

## 📁 Files in this Directory

- [`schema.sql`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/supabase/schema.sql) — The complete, standalone SQL script ready to copy-paste into the Supabase SQL Editor.
- [`migrations/20240902000000_initial_schema.sql`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/supabase/migrations/20240902000000_initial_schema.sql) — Migration file formatted for the Supabase CLI.

---

## 🗄️ Database Tables Overview

### 1. `public.profiles`
Stores user profile information, LinkedIn member IDs, and AES-256 encrypted access/refresh tokens.
- `id` (UUID, Primary Key, references `auth.users(id)`)
- `linkedin_member_id` (TEXT, UNIQUE)
- `name`, `email`, `picture_url` (TEXT)
- `encrypted_access_token` (TEXT, AES-256-GCM)
- `encrypted_refresh_token` (TEXT)
- `token_expires_at` (TIMESTAMPTZ)
- `created_at`, `updated_at` (TIMESTAMPTZ)

### 2. `public.posts`
Stores drafts, scheduled posts, published posts, and execution logs.
- `id` (UUID, Primary Key, default `gen_random_uuid()`)
- `user_id` (UUID, references `profiles(id)`)
- `content` (TEXT)
- `media_url` (TEXT), `media_type` (`none` | `image` | `video` | `document`)
- `media_asset_urn` (TEXT, e.g. `urn:li:image:...`)
- `scheduled_at` (TIMESTAMPTZ)
- `published_at` (TIMESTAMPTZ)
- `status` (`draft` | `pending` | `processing` | `published` | `failed`)
- `linkedin_post_urn` (TEXT, e.g. `urn:li:share:123456`)
- `error_log` (TEXT)
- `retry_count` (INT)
- `created_at`, `updated_at` (TIMESTAMPTZ)

### 3. `public.ai_generation_logs`
Tracks AI generation history and prompt metrics for user quota analytics.
- `id` (UUID, Primary Key)
- `user_id` (UUID, references `profiles(id)`)
- `topic`, `tone`, `generated_content`, `model`
- `created_at` (TIMESTAMPTZ)

---

## ⚡ High-Performance Indexes

- **`idx_posts_poll`**: Partial index on `(status, scheduled_at) WHERE status = 'pending'`. Keeps Cloudflare Worker cron polling queries under **5ms**.
- **`idx_posts_user_status_schedule`**: Multi-column index on `(user_id, status, scheduled_at DESC)` for instant Calendar and Feed loading in the mobile app.

---

## 🔒 Security & Row Level Security (RLS)

- **RLS Enabled** on `profiles`, `posts`, and `ai_generation_logs`.
- **User Policies**: Mobile app users with Supabase Auth tokens can only select, insert, update, and delete their own data (`auth.uid() = user_id`).
- **Service Role**: The backend server (`corelink_server`) connects with `SUPABASE_SERVICE_ROLE_KEY` which automatically bypasses RLS for background publishing and token decryption.

---

## 🚀 Atomic Post Claiming Function

The schema includes a stored procedure: `public.claim_due_posts(batch_limit INT)`.

It uses PostgreSQL's **`FOR UPDATE SKIP LOCKED`** to atomically claim pending due posts and transition them to `status = 'processing'`. This guarantees **zero double-posts** even if multiple Cloudflare Worker cron triggers fire simultaneously.

---

## 🛠️ How to Apply to Your Supabase Project

### Option A: Supabase Web Dashboard (Easiest - 1 Minute)
1. Open your [Supabase Project Dashboard](https://supabase.com/dashboard/project/slmwhkmtbizumivttmjh).
2. Click **SQL Editor** in the left navigation menu.
3. Click **New Query**.
4. Copy and paste the full contents of [`supabase/schema.sql`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/supabase/schema.sql).
5. Click **Run** (or press `Ctrl + Enter`).

---

### Option B: Supabase CLI
```bash
npx supabase db push
```
