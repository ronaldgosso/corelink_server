# Corelink Backend API & Supabase Gateway Guide

This document describes the centralized **Backend for Frontend (BFF)** API architecture of `corelink_server`. All mobile application requests, database interactions with Supabase, AI generations, and LinkedIn publishing are routed through this single server layer.

---

## 📑 Table of Contents
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

### 📥 Files
* **Collection:** [`postman/Corelink_Backend_API_Collection.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_API_Collection.json)
* **Environment:** [`postman/Corelink_Backend_Environment.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_Environment.json)

### Importing
1. **Postman**: Click **Import** ➔ Select both JSON files ➔ Select **Corelink Backend API - Environment**.
2. **Hoppscotch**: Import Collection (v2.1) + Import Environment ➔ Set active.

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
| `POST` | `/api/posts` | Create scheduled post or draft (`scheduledAt`, `content`, `mediaUrl`) |
| `GET` | `/api/posts` | List posts (`?status=pending&page=1&limit=20&sortBy=scheduled_at`) |
| `GET` | `/api/posts/:id` | Get post details by UUID |
| `PUT` | `/api/posts/:id` | Update post content or reschedule time |
| `DELETE`| `/api/posts/:id` | Delete post / cancel schedule |
| `GET` | `/api/posts/stats`| Get post counts (pending, published, failed) |

---

### 4. Publishing Pipeline & Cron (`/api/publish`)

#### `POST /api/publish` (Cron Worker Dispatcher)
Triggered by Cloudflare Worker every 10 minutes.
* **Headers:** `Authorization: Bearer <CRON_SECRET>`
* **Execution:**
  1. Queries Supabase for `scheduled_at <= NOW()` and `status = 'pending'`.
  2. Atomically sets status to `processing`.
  3. Decrypts AES-256 LinkedIn access token.
  4. Publishes to LinkedIn REST API (`/rest/posts`).
  5. Sets status to `published` (or `failed` with error details in `error_log`).

#### `POST /api/posts/:id/publish-now`
Allows instant publication of an existing draft/scheduled post.

---

## 5. Cloudflare Worker Cron Trigger Configuration

Your Cloudflare Worker script (`cloudflare-worker/src/index.js`) runs on `*/10 * * * *` and dispatches to `corelink_server`:

```javascript
export default {
  async scheduled(event, env, ctx) {
    const response = await fetch(`${env.BACKEND_API_URL}/api/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CRON_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ batchSize: 10 })
    });
    console.log(`Cron execution dispatched. Status: ${response.status}`);
  }
};
```

---

## 6. Security, Encryption & Token Lifecycle

1. **AES-256-GCM Token Encryption**:
   - Access tokens are encrypted using a 32-byte master key (`ENCRYPTION_KEY`) before saving into Supabase.
   - Plaintext tokens never leave the server memory.
2. **Race Condition Elimination**:
   - The publishing engine claims rows with atomic SQL:
     `UPDATE posts SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *;`
   - This ensures multiple parallel cron invocations never double-publish a post.
