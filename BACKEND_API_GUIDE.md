# Corelink Backend API & Supabase Gateway Guide

This document describes the centralized **Backend for Frontend (BFF)** API architecture of `corelink_server`. All web and mobile requests, database interactions with Supabase, AI generations, and LinkedIn publishing are routed through this single server layer.

---

## Table of Contents

1. [Centralized Architecture Overview](#centralized-architecture-overview)
2. [React Web Frontend Integration](#react-web-frontend-integration)
3. [Supabase Database Schema & DDL](#supabase-database-schema--ddl)
4. [Postman & Hoppscotch Collections](#postman--hoppscotch-collections)
5. [API Endpoints Reference](#api-endpoints-reference)
   - [1. Authentication & Profiles (`/api/auth`)](#1-authentication--profiles-apiauth)
   - [2. AI Post Generation (`/api/generate`)](#2-ai-post-generation-apigenerate)
   - [3. Posts & Scheduling CRUD (`/api/posts`)](#3-posts--scheduling-crud-apiposts)
   - [4. Publishing Pipeline & Cron (`/api/publish`)](#4-publishing-pipeline--cron-apipublish)
   - [5. DEV.to Community Articles (`/api/devto`)](#5-devto-community-articles-apidevto)
6. [Multi-Platform Publishing (LinkedIn & DEV.to)](#multi-platform-publishing-linkedin--devto)
7. [Upstash Redis Caching Layer](#upstash-redis-caching-layer)
8. [Database Migrations & DDL Updates](#database-migrations--ddl-updates)

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
│  • CoreLink AI Prompt Engineering                        │
│  • Business Logic & Idempotent Post Claiming            │
└───┬────────────────────────┬────────────────────────┬───┘
    │                        │                        │
    ▼                        ▼                        ▼
┌─────────────────┐  ┌───────────────┐  ┌──────────────────┐
│    Supabase     │  │  CoreLink AI  │  │   LinkedIn REST  │
│ (PostgreSQL/RLS)│  │    (Engine)   │  │     (Posts API)  │
└─────────────────┘  └───────────────┘  └──────────────────┘
```

---

## 2. React Web Frontend Integration

This section is the frontend contract for the React web application. The React app should call Corelink only through this API; it should never call Supabase, Mistral, LinkedIn, Redis, or the cron endpoints directly.

### Base URL

Use an environment variable so local and deployed builds use the same client code:

```env
# Vite
VITE_API_URL=http://localhost:5000/api

# Create React App uses REACT_APP_API_URL instead
# REACT_APP_API_URL=http://localhost:5000/api
```

Production API URL:

```text
https://corelink-server.vercel.app/api
```

The backend allows cross-origin requests according to `CORS_ORIGIN`. The frontend origin must be included there in the deployed environment.

### Authentication flow for React

The browser callback currently finishes with a mobile deep link (`corelink://auth?...`). For a React web app, use this flow:

1. Send the user to the LinkedIn authorization URL configured for the web app.
2. Receive LinkedIn's `code` on a React route that you control.
3. POST that code to `/auth/linkedin` with the same `redirectUri` used in the LinkedIn authorization request.
4. Store the returned Corelink JWT and use it for protected API requests.
5. Load `/auth/me` after login to hydrate the authenticated user.

```js
const API_URL = import.meta.env.VITE_API_URL;

export async function exchangeLinkedInCode(code) {
  const response = await fetch(`${API_URL}/auth/linkedin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      redirectUri: `${window.location.origin}/auth/callback`,
    }),
  });

  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(body.error || body.message || "LinkedIn login failed");
  }

  localStorage.setItem("corelink_token", body.token);
  return body.profile || body.user;
}
```

Do not send the LinkedIn client secret from React. Do not use the Supabase access token as the Corelink token. The token returned by `/auth/linkedin` is a Corelink JWT and must be sent as `Authorization: Bearer <token>`.

For a temporary mobile-compatible flow, the frontend may open `/auth/linkedin/callback` directly, but that endpoint returns HTML and redirects to `corelink://auth`; it is not the recommended React web callback.

### Shared API client

Use one request helper so every protected request gets the bearer token and every error is handled consistently. The API can return an error in either `error` or `message`.

```js
const API_URL = import.meta.env.VITE_API_URL;

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("corelink_token");
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));

  if (response.status === 401) {
    localStorage.removeItem("corelink_token");
    // Redirect to the login route in the React app.
  }
  if (!response.ok || body.success === false) {
    throw new Error(body.error || body.message || "Request failed");
  }
  return body;
}
```

### Common React requests

```js
// Current user
const { profile, user } = await apiRequest("/auth/me");

// Generate a post. The daily limit is 10 requests per user.
const generated = await apiRequest("/generate", {
  method: "POST",
  body: JSON.stringify({
    topic: "Why serverless crons beat traditional cron jobs",
    tone: "insightful",
    hookLength: "medium",
    includeHashtags: true,
  }),
});
const draft = generated.data;

// Check the AI quota before enabling the generate button.
const { quota } = await apiRequest("/generate/quota");

// Create a draft or scheduled post. scheduledAt is required even for drafts.
const { post } = await apiRequest("/posts", {
  method: "POST",
  body: JSON.stringify({
    content: draft.generated_content,
    scheduledAt: new Date("2026-09-10T09:00:00.000Z").toISOString(),
    status: "draft",
  }),
});

// List posts. Currently only status is supported; pagination parameters are ignored.
const { posts } = await apiRequest("/posts?status=pending");

// Update, publish immediately, or delete a post.
await apiRequest(`/posts/${post.id}`, {
  method: "PUT",
  body: JSON.stringify({ content: "Updated content", status: "pending" }),
});
await apiRequest(`/posts/${post.id}/publish-now`, { method: "POST" });
await apiRequest(`/posts/${post.id}`, { method: "DELETE" });

// Analytics: cached by default; use force=true for a live refresh.
const overview = await apiRequest("/analytics/overview");
const metrics = await apiRequest(`/analytics/posts/${post.id}?force=true`);
```

### Media upload from a file input

The upload endpoint expects JSON containing a data URL, not `multipart/form-data`. Convert the selected file with `FileReader`, then send the result. The current Express JSON body limit is 50 MB, so keep the encoded request below that limit even though LinkedIn accepts larger videos.

```js
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const fileBase64 = await readAsDataUrl(fileFromInput);
const uploaded = await apiRequest("/media/upload", {
  method: "POST",
  body: JSON.stringify({
    fileBase64,
    mediaType: fileFromInput.type.startsWith("video/") ? "video" : "image",
    mimeType: fileFromInput.type,
    fileName: fileFromInput.name,
  }),
});

// Save uploaded.mediaAssetUrn on the post when creating or updating it.
```

### Response and state-handling rules

- Treat `success: true` as a successful application response, but also check the HTTP status.
- Protected endpoint responses may include `data` plus a resource-specific key such as `profile`, `posts`, `post`, `stats`, or `quota`.
- Posts currently include both camelCase and snake_case fields. Prefer camelCase in new React code (`scheduledAt`, `mediaAssetUrn`, `linkedinPostUrn`) and normalize at the API boundary.
- A `401` means the token is missing, invalid, or expired. Clear the token and send the user through LinkedIn login again.
- A `429` from AI endpoints means the daily AI quota or rate limit has been reached; show the returned error and `quota.resets_at` when available.
- Dates are ISO strings. Convert them to the user's timezone only for display; send an ISO timestamp back to the API.
- Analytics may return `source: REDIS` or `source: SUPABASE`. This is informational and should not change the UI flow.

### Endpoints React must not call

- `POST /api/publish`: reserved for the background worker and requires `CRON_SECRET`, not a user JWT.
- `POST /api/analytics/cron-sync`: reserved for the background worker and requires `CRON_SECRET`.
- Supabase, LinkedIn REST, Mistral, and Redis APIs: credentials and provider tokens remain server-side.

## 3. Supabase Database Schema & DDL

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

## 4. Postman & Hoppscotch Collections

### Files

- **Collection:** [`postman/Corelink_Backend_API_Collection.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_API_Collection.json)
- **Environment:** [`postman/Corelink_Backend_Environment.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_Environment.json)

### Collection Folders
1. **1. Authentication & User Profile**: LinkedIn OAuth, dev login, `/auth/me`, disconnect.
2. **2. AI Post Generation (CoreLink AI Engine)**: Topic drafting, tone selection.
3. **3. Posts & Scheduling Management (Supabase CRUD)**: Post creation, multi-platform scheduling (`platforms: ["linkedin", "devto"]`), updates, deletions, stats.
4. **4. Publishing Pipeline & Cloudflare Cron Engine**: Cron batch runner, instant publish (`publish-now`, `publish-linkedin`, `publish-devto`, `publish-both`, `crosspost-devto`).
5. **5. System & Health**: Health check, Redis status.
6. **6. LinkedIn Analytics & Engagement Metrics**: Real-time sync, post analytics, time series.
7. **7. DEV.to Articles & Community Publishing**: Direct DEV.to article publishing, user article listing, article updates, and profile check using caller's `x-devto-api-key`.

### Importing

1. **Postman**: Click **Import** -> Select both JSON files -> Select **Corelink Backend API - Environment**.
2. **Environment Configuration**: Set `{{auth_token}}` after login and `{{devto_api_key}}` to authenticate DEV.to requests.
3. **Hoppscotch**: Import Collection (v2.1) + Import Environment -> Set active.

---

## 5. API Endpoints Reference

### 1. Authentication & Profiles (`/api/auth`)

#### `GET /api/auth/linkedin/url`
Generates the preconfigured LinkedIn OAuth 2.0 authorization URL for web apps (React, Next.js, Vue). Keeps client credentials and scopes centralized on the server.
* **Query Parameters:**
  * `redirect_uri` *(optional)*: OAuth callback URI (defaults to server callback).
  * `return_to` *(optional)*: React app URL to redirect to upon login completion (e.g., `http://localhost:5173/auth/callback` or `https://app.corelink.com/dashboard`).
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "url": "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=...&redirect_uri=...&scope=openid%20profile%20email%20w_member_social&state=...",
    "redirectUri": "http://localhost:5000/api/auth/linkedin/callback"
  }
  ```

#### `GET /api/auth/linkedin/login`
Direct 302 redirect to LinkedIn OAuth authorization screen. Allows a React developer to link directly:
`<a href="https://corelink-server.vercel.app/api/auth/linkedin/login?return_to=http://localhost:5173/dashboard">Login with LinkedIn</a>`.

#### `POST /api/auth/dev-login`
Developer session generator for local web application development. Generates a valid 30-day JWT session token instantly without requiring LinkedIn OAuth execution each time.
* **Body:**
  ```json
  {
    "name": "React Developer",
    "email": "developer@corelink.app"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "source": "DEV_SESSION",
    "token": "eyJhbGciOi...",
    "profile": {
      "id": "...",
      "name": "React Developer",
      "email": "developer@corelink.app",
      "connected": true
    }
  }
  ```

#### `POST /api/auth/linkedin`

Exchanges the LinkedIn authorization `code`, encrypts the token with AES-256, upserts the Supabase profile, and returns a client session token.

- **Body:**
  ```json
  {
    "code": "AQU...",
    "redirectUri": "http://localhost:3000/auth/callback"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "profile": {
      "id": "uuid-1234",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "linkedinMemberId": "782bbdua",
      "tokenExpiresAt": "2026-11-01T12:00:00.000Z"
    },
    "user": {}
  }
  ```

#### `GET /api/auth/me`

- **Headers:** `Authorization: Bearer <auth_token>`
- **Response (200 OK):** Returns profile details and LinkedIn connection expiration timestamp.

---

### 2. AI Post Generation (`/api/generate`)

#### `POST /api/generate`
Generates an algorithmic-friendly LinkedIn post using the proprietary CoreLink AI Engine.
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
- **Response (200 OK):**
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

| Method   | Endpoint           | Description                                                                                         |
| :------- | :----------------- | :-------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/posts`       | Create scheduled post or draft (`scheduledAt`, `content`, `mediaUrl`, `mediaType`, `mediaAssetUrn`) |
| `GET`    | `/api/posts`       | List posts (`?status=pending&page=1&limit=20&sortBy=scheduled_at`)                                  |
| `GET`    | `/api/posts/:id`   | Get post details by UUID                                                                            |
| `PUT`    | `/api/posts/:id`   | Update post content, reschedule time, or media attachments                                          |
| `DELETE` | `/api/posts/:id`   | Delete post / cancel schedule                                                                       |
| `GET`    | `/api/posts/stats` | Get post counts (pending, published, failed)                                                        |

---

### 4. Media Upload API (`/api/media`)

All endpoints require `Authorization: Bearer <auth_token>`.

#### `POST /api/media/upload`

Uploads and registers an image or video directly with LinkedIn's 3-step REST upload protocol (`/rest/images` or `/rest/videos`).

- **Request Body (JSON):**
  ```json
  {
    "fileBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "mediaType": "image",
    "mimeType": "image/png",
    "fileName": "diagram.png"
  }
  ```
- **Validation & Constraints:**
  - **Images (`image`)**: Max 10 MB. Supported: `PNG`, `JPEG`, `GIF`, `WebP`.
  - **Videos (`video`)**: 75 KB to 200 MB. Duration: 3s to 10 mins. Supported: `MP4`, `MOV`, `WebM`.
- **Response (200 OK):**
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

- **Headers:** `Authorization: Bearer <USER_JWT>`
- **Response (200 OK - Redis Cache Hit):**
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

- **Query Params:** `?force=true` (optional, bypasses cache and syncs live with LinkedIn)
- **Response (200 OK):**
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

## 5. DEV.to Community Articles (`/api/devto`)

CoreLink integrates with the **DEV.to (Forem API)** allowing direct article creation, drafting, updates, and cross-posting between LinkedIn and DEV.to. **Each user provides their personal DEV.to API key from the frontend via the `x-devto-api-key` header:**

| Method | Endpoint | Required Headers | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/devto/me` | `x-devto-api-key` | Validates API key and returns authenticated DEV.to profile |
| `GET` | `/api/devto/articles` | `x-devto-api-key` | List user articles (`?page=1&per_page=30&state=all\|published\|unpublished`) |
| `POST` | `/api/devto/articles` | `x-devto-api-key` | Create or publish article directly on DEV.to (`published: true\|false`) |
| `POST` | `/api/devto/publish` | `x-devto-api-key` | Alias for `/api/devto/articles` |
| `GET` | `/api/devto/articles/:id` | `x-devto-api-key` | Get single DEV.to article by ID |
| `PUT` | `/api/devto/articles/:id` | `x-devto-api-key` | Update an existing article on DEV.to |
| `POST` | `/api/devto/crosspost/:id` | `x-devto-api-key`, `Authorization: Bearer <jwt>` | Cross-post an existing CoreLink post to DEV.to |

Pre-configured requests are ready in [`postman/Corelink_Backend_API_Collection.json`](./postman/Corelink_Backend_API_Collection.json) under **Folder 7**. For complete documentation on request bodies and cross-posting workflows, see [DEVTO_API_GUIDE.md](./DEVTO_API_GUIDE.md).

---

## 6. Multi-Platform Publishing (LinkedIn & DEV.to)

Posts can be created and scheduled for **LinkedIn**, **DEV.to**, or **both**:

- **Targeting when creating post (`POST /api/posts`)**:
  - `platforms: ["linkedin"]`: Scheduled strictly for LinkedIn.
  - `platforms: ["devto"]`: Scheduled strictly for DEV.to.
  - `platforms: ["linkedin", "devto"]`: Scheduled to publish to both simultaneously.
- **Immediate Publishing Options (`/api/posts/:id/publish-*`)**:
  - `POST /api/posts/:id/publish-now`: Publishes according to post's target or query param (`?target=both|linkedin|devto`).
  - `POST /api/posts/:id/publish-linkedin`: Publishes strictly to LinkedIn.
  - `POST /api/posts/:id/publish-devto`: Publishes strictly to DEV.to.
  - `POST /api/posts/:id/publish-both`: Publishes to both platforms concurrently.

---

## 7. Upstash Redis Caching Layer

To guarantee sub-5ms response times on Vercel Serverless without cold-start TCP limits, `corelink_server` integrates native `@upstash/redis` (REST API) with graceful fallback to `ioredis` (TCP) and bypass mode:

- **TTLs:**
  - `USER_PROFILE`: 900s (15 min)
  - `POSTS_LIST`: 180s (3 min)
  - `POST_DETAIL`: 600s (10 min)
  - `POST_STATS`: 300s (5 min)
  - `AI_QUOTA_ACTIVE`: 60s (1 min)
  - `SCHEDULE_WINDOW`: 30s
- **Response Contract:**
  Every cached endpoint includes `"source": "REDIS"` when served from Upstash memory, or `"source": "SUPABASE"` / `"source": "SYSTEM"`.

---

## 8. Database Migrations & DDL Updates

The complete SQL migrations are stored under `supabase/migrations/`:

- `20240902000000_initial_schema.sql`: Initial `profiles`, `posts`, and `ai_generation_logs` schema.
- `20260906000000_post_analytics.sql`: Adds analytics columns to `posts` (`likes_count`, `comments_count`, `shares_count`, `impressions_count`, `engagement_rate`, `metrics_last_synced_at`) and creates `post_analytics_history` with Row Level Security (RLS) policies.
- `20261007000000_devto_support.sql`: Adds DEV.to integration columns to `posts` (`platforms`, `devto_article_id`, `devto_url`, `devto_published_at`, `devto_title`, `devto_tags`, `devto_canonical_url`) and `encrypted_devto_api_key` to `profiles`.
