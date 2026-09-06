# Corelink Backend API & Supabase Gateway Guide

This document describes the centralized **Backend for Frontend (BFF)** API architecture of `corelink_server`. All mobile application requests, database interactions with Supabase, AI generations, and LinkedIn publishing are routed through this single server layer.

---

## Table of Contents
1. [Centralized Architecture Overview](#centralized-architecture-overview)
2. [Supabase Database Schema & DDL](#supabase-database-schema--ddl)
3. [Postman & Hoppscotch Collections](#postman--hoppscotch-collections)
4. [API Endpoints Reference](#api-endpoints-reference)
   - [1. Authentication & Profiles (`/api/auth`)](#1-authentication--profiles-apiauth)
   - [2. AI Post Generation (`/api/generate`)](#2-ai-post-generation-apigenerate)
   - [3. Posts & Scheduling CRUD (`/api/posts`)](#3-posts--scheduling-crud-apiposts)
   - [4. Publishing Pipeline & Cron (`/api/publish`)](#4-publishing-pipeline--cron-apipublish)
5. [Cloudflare Worker Cron Trigger Configuration](#cloudflare-worker-cron-trigger-configuration)
6. [Security, Encryption & Token Lifecycle](#security-encryption--token-lifecycle)

---

## 1. Centralized Architecture Overview

By routing all actions through `corelink_server`, any schema updates, business rules, validation logic, or provider switches (e.g. Supabase, Mistral, LinkedIn) are made in **one centralized place** without modifying or redeploying client mobile apps.

```
┌─────────────────────────────────────────────────────────┐
│                    Mobile Client App                    │
└────────────────────────────┬────────────────────────────┘
                             │ (All requests hit /api/*)
                             ▼
┌─────────────────────────────────────────────────────────┐
│              corelink_server (Central Gateway)          │
│                                                         │
│  • Validation & Auth Middleware                         │
│  • AES-256 Token Encryption/Decryption                  │
│  • Mistral AI Prompt Engineering                        │
│  • Business Logic & Idempotent Post Claiming            │
└───┬────────────────────────┬────────────────────────┬───┘
    │                        │                        │
    ▼                        ▼                        ▼
┌─────────────────┐  ┌───────────────┐  ┌──────────────────┐
│    Supabase     │  │  Mistral AI   │  │   LinkedIn REST  │
│ (PostgreSQL/RLS)│  │ (mistral-small│  │     (Posts API)  │
└─────────────────┘  └───────────────┘  └──────────────────┘
```

---

## 2. Supabase Database Schema & DDL

Execute the following SQL in your **Supabase SQL Editor**:

```sql
-- 1. Profiles Table (Linked to auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_member_id TEXT UNIQUE NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Posts Table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT CHECK (status IN ('pending', 'processing', 'published', 'failed', 'draft')) DEFAULT 'pending',
  linkedin_post_urn TEXT,
  error_log TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Partial Index for High-Performance Polling (<5ms queries)
CREATE INDEX idx_posts_poll ON posts (status, scheduled_at) WHERE status = 'pending';

-- 4. Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (Users can only access their own data)
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view own posts" ON posts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own posts" ON posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts" ON posts FOR DELETE USING (auth.uid() = user_id);
```

---

## 3. Postman & Hoppscotch Collections

### Files
* **Collection:** [`postman/Corelink_Backend_API_Collection.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_API_Collection.json)
* **Environment:** [`postman/Corelink_Backend_Environment.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_Environment.json)

### Importing
1. **Postman**: Click **Import** -> Select both JSON files -> Select **Corelink Backend API - Environment**.
2. **Hoppscotch**: Import Collection (v2.1) + Import Environment -> Set active.

---

## 4. API Endpoints Reference

### 1. Authentication & Profiles (`/api/auth`)

#### `POST /api/auth/linkedin`
Exchanges the LinkedIn authorization `code`, encrypts the token with AES-256, upserts the Supabase profile, and returns a client session token.
* **Body:**
  ```json
  {
    "code": "AQU...",
    "redirectUri": "http://localhost:5000/api/auth/linkedin/callback"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "user": {
      "id": "uuid-1234",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "linkedinMemberId": "782bbdua"
    }
  }
  ```

#### `GET /api/auth/me`
* **Headers:** `Authorization: Bearer <auth_token>`
* **Response (200 OK):** Returns profile details and LinkedIn connection expiration timestamp.

---

### 2. AI Post Generation (`/api/generate`)

#### `POST /api/generate`
Generates an algorithmic-friendly LinkedIn post using Mistral AI (`mistral-small`).
* **Headers:** `Authorization: Bearer <auth_token>`
* **Body:**
  ```json
  {
    "topic": "Why serverless crons beat traditional cron jobs",
    "tone": "insightful",
    "targetAudience": "Developers & CTOs",
    "includeHashtags": true
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "draft": {
      "hook": "Traditional cron jobs on single servers are a single point of failure.",
      "content": "Traditional cron jobs on single servers are a single point of failure.\n\nHere is how edge crons fix this...\n\n#DevOps #Serverless #Cloud",
      "hashtags": ["#DevOps", "#Serverless", "#Cloud"]
    }
  }
  ```

---

### 3. Posts & Scheduling CRUD (`/api/posts`)

All endpoints require `Authorization: Bearer <auth_token>`.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/posts` | Create scheduled post or draft (`scheduledAt`, `content`, `mediaUrl`, `mediaType`, `mediaAssetUrn`) |
| `GET` | `/api/posts` | List posts (`?status=pending&page=1&limit=20&sortBy=scheduled_at`) |
| `GET` | `/api/posts/:id` | Get post details by UUID |
| `PUT` | `/api/posts/:id` | Update post content, reschedule time, or media attachments |
| `DELETE`| `/api/posts/:id` | Delete post / cancel schedule |
| `GET` | `/api/posts/stats`| Get post counts (pending, published, failed) |

---

### 4. Media Upload API (`/api/media`)

All endpoints require `Authorization: Bearer <auth_token>`.

#### `POST /api/media/upload`
Uploads and registers an image or video directly with LinkedIn's 3-step REST upload protocol (`/rest/images` or `/rest/videos`).

* **Request Body (JSON):**
  ```json
  {
    "fileBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "mediaType": "image",
    "mimeType": "image/png",
    "fileName": "diagram.png"
  }
  ```
* **Validation & Constraints:**
  - **Images (`image`)**: Max 10 MB. Supported: `PNG`, `JPEG`, `GIF`, `WebP`.
  - **Videos (`video`)**: 75 KB to 200 MB. Duration: 3s to 10 mins. Supported: `MP4`, `MOV`, `WebM`.
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Image uploaded and registered with LinkedIn successfully",
    "mediaAssetUrn": "urn:li:image:D4E10AQF3J5k7...",
    "mediaType": "image",
    "fileSizeBytes": 154200,
    "fileName": "diagram.png"
  }
  ```

---

### 6. LinkedIn Analytics & Engagement Metrics (`/api/analytics`)

All analytics endpoints feature Upstash Redis caching (`TTL.POST_STATS`: 300s) and explicitly indicate data origin via `"source": "REDIS" | "SUPABASE"`.

#### `GET /api/analytics/overview`
Creator profile-wide aggregated engagement stats, top 5 performing posts, and 14-day engagement timeline.
* **Headers:** `Authorization: Bearer <USER_JWT>`
* **Response (200 OK - Redis Cache Hit):**
  ```json
  {
    "success": true,
    "source": "REDIS",
    "data": {
      "userId": "uuid-here",
      "totalPublished": 12,
      "totals": {
        "likes": 420,
        "comments": 68,
        "shares": 24,
        "impressions": 14850,
        "interactions": 512,
        "averageEngagementRate": 3.45
      },
      "topPosts": [ ... ],
      "timeline": [ ... ],
      "generatedAt": "2026-09-06T11:45:00.000Z"
    }
  }
  ```

#### `GET /api/analytics/posts/:id` (Alias: `GET /api/posts/:id/analytics`)
Retrieves real-time likes, comments, shares, impressions, and reaction breakdowns for a specific post.
* **Query Params:** `?force=true` (optional, bypasses cache and syncs live with LinkedIn)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "source": "REDIS",
    "data": {
      "postId": "post-uuid",
      "userId": "user-uuid",
      "status": "published",
      "isPublished": true,
      "linkedinPostUrn": "urn:li:share:71234567890",
      "metrics": {
        "likes": 38,
        "comments": 5,
        "shares": 2,
        "impressions": 1120,
        "engagementRate": 4.02,
        "reactionBreakdown": {
          "LIKE": 30,
          "PRAISE": 5,
          "EMPATHY": 3
        }
      },
      "metricsLastSyncedAt": "2026-09-06T11:30:00.000Z",
      "history": [ ... ]
    }
  }
  ```

#### `POST /api/analytics/posts/:id/sync` (Alias: `POST /api/posts/:id/analytics/sync`)
Explicitly triggers a live fetch against LinkedIn REST Social Metadata API, writes the latest metrics and history snapshot to Supabase, updates Redis, and returns fresh data.

#### `POST /api/analytics/sync-all`
Iterates over all posts published by the user in the last 14 days and synchronizes their engagement metrics.

#### `POST /api/analytics/cron-sync`
Background cron worker endpoint (Requires `Authorization: Bearer <CRON_SECRET>`) that automatically refreshes stale post metrics across all creator accounts every 6 hours.

---

## 7. Upstash Redis Caching Layer

To guarantee sub-5ms response times on Vercel Serverless without cold-start TCP limits, `corelink_server` integrates native `@upstash/redis` (REST API) with graceful fallback to `ioredis` (TCP) and bypass mode:

* **TTLs:**
  * `USER_PROFILE`: 900s (15 min)
  * `POSTS_LIST`: 180s (3 min)
  * `POST_DETAIL`: 600s (10 min)
  * `POST_STATS`: 300s (5 min)
  * `AI_QUOTA_ACTIVE`: 60s (1 min)
  * `SCHEDULE_WINDOW`: 30s
* **Response Contract:**
  Every cached endpoint includes `"source": "REDIS"` when served from Upstash memory, or `"source": "SUPABASE"` / `"source": "SYSTEM"`.

---

## 8. Database Migrations & DDL Updates

The complete SQL migrations are stored under `supabase/migrations/`:
* `20240902000000_initial_schema.sql`: Initial `profiles`, `posts`, and `ai_generation_logs` schema.
* `20260906000000_post_analytics.sql`: Adds analytics columns to `posts` (`likes_count`, `comments_count`, `shares_count`, `impressions_count`, `engagement_rate`, `metrics_last_synced_at`) and creates `post_analytics_history` with Row Level Security (RLS) policies.

