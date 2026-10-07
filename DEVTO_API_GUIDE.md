# DEV.to Integration & Multi-Platform Publishing Guide

This guide details the **DEV.to (Forem API)** integration in `corelink_server`. CoreLink enables posting to **LinkedIn**, **DEV.to**, or **both simultaneously**, with options to publish immediately, schedule ahead, or cross-post an existing post.

---

## Table of Contents

1. [Configuration & Authentication](#1-configuration--authentication)
2. [Targeting Options Overview](#2-targeting-options-overview)
3. [DEV.to Direct API Endpoints (`/api/devto`)](#3-devto-direct-api-endpoints-apidevto)
   - [Verify API Key & Profile (`GET /api/devto/me`)](#get-apidevtome)
   - [Create / Publish Article (`POST /api/devto/articles`)](#post-apidevtoarticles)
   - [List User Articles (`GET /api/devto/articles`)](#get-apidevtoarticles)
   - [Get Single Article (`GET /api/devto/articles/:id`)](#get-apidevtoarticlesid)
   - [Update Article (`PUT /api/devto/articles/:id`)](#put-apidevtoarticlesid)
   - [Cross-post Existing Post (`POST /api/devto/crosspost/:id`)](#post-apidevtocrosspostid)
4. [Multi-Platform Post Creation (`/api/posts`)](#4-multi-platform-post-creation-apiposts)
   - [Create Post for LinkedIn Only](#create-post-for-linkedin-only)
   - [Create Post for DEV.to Only](#create-post-for-devto-only)
   - [Create Post for Both (LinkedIn + DEV.to)](#create-post-for-both-linkedin--devto)
5. [Publishing Pipeline & Immediate Dispatch (`/api/posts/:id/publish-*`)](#5-publishing-pipeline--immediate-dispatch)
   - [Publish Now with Dynamic Target (`POST /api/posts/:id/publish-now`)](#post-apipostsidpublish-now)
   - [Publish to LinkedIn Only (`POST /api/posts/:id/publish-linkedin`)](#post-apipostsidpublish-linkedin)
   - [Publish to DEV.to Only (`POST /api/posts/:id/publish-devto`)](#post-apipostsidpublish-devto)
   - [Publish to Both Platforms (`POST /api/posts/:id/publish-both`)](#post-apipostsidpublish-both)
6. [Database Schema & Migrations](#6-database-schema--migrations)

---

## 1. Authentication & API Key Handling

Each user on DEV.to has their own unique personal API key. Therefore, **all DEV.to endpoints require the user's API key to be passed from the frontend** per request.

### Providing the DEV.to API Key from Frontend
The frontend should pass the user's API key in one of the following ways:

1. **HTTP Header (Recommended)**:
   ```http
   x-devto-api-key: your_devto_api_key_here
   ```
2. **Request Body / Query Parameter**:
   ```json
   {
     "devto_api_key": "your_devto_api_key_here"
   }
   ```
3. **Saved User Profile**:
   If the user saved their API key in their CoreLink profile settings (`encrypted_devto_api_key`), the backend resolves it automatically when `Authorization: Bearer <auth_token>` is present.

> **How users get their DEV.to API Key:**
> 1. Log in to [DEV.to](https://dev.to).
> 2. Go to **Settings** -> **Extensions**.
> 3. Scroll down to **DEV Community API Keys**.
> 4. Generate a new API key and copy it into the CoreLink frontend input.

> **Missing API Key Error Response (`400 Bad Request`):**
> ```json
> {
>   "success": false,
>   "error": "DEV.to API key is required. Please pass your DEV.to API key in App Settings."
> }
> ```

---

## 2. Targeting Options Overview

CoreLink gives you full control over how and where content is published:

| Scenario | How to execute |
| :--- | :--- |
| **Post to LinkedIn only** | Create post with `platforms: ["linkedin"]` or call `POST /api/posts/:id/publish-linkedin` |
| **Post to DEV.to only** | Create post with `platforms: ["devto"]` or call `POST /api/posts/:id/publish-devto` |
| **Post to Both simultaneously** | Create post with `platforms: ["linkedin", "devto"]` or call `POST /api/posts/:id/publish-both` |
| **Cross-post a LinkedIn post to DEV.to later** | Call `POST /api/posts/:id/crosspost-devto` (or `POST /api/devto/crosspost/:id`) |
| **Publish direct article to DEV.to** | Call `POST /api/devto/articles` |

---

## 3. DEV.to Direct API Endpoints (`/api/devto`)

### `POST /api/devto/connect`
Verifies and connects the user's DEV.to API key, encrypting and storing it in `public.profiles` (`encrypted_devto_api_key`) so that **scheduled posts publish automatically via Cloudflare Worker cron jobs** even when the user is offline.

- **Headers**:
  - `Authorization: Bearer <jwt_token>` (**Required**)
- **Request Body**:
  ```json
  {
    "apiKey": "your_devto_api_key_here"
  }
  ```

**Response `200 OK`**:
```json
{
  "success": true,
  "source": "DEV_TO",
  "connected": true,
  "profile": {
    "id": 123456,
    "username": "janedoe",
    "name": "Jane Doe"
  },
  "message": "DEV.to account connected successfully as @janedoe"
}
```

---

### `DELETE /api/devto/disconnect`
Removes the stored encrypted DEV.to API key from the user's profile.

- **Headers**:
  - `Authorization: Bearer <jwt_token>` (**Required**)

**Response `200 OK`**:
```json
{
  "success": true,
  "source": "DEV_TO",
  "connected": false,
  "message": "DEV.to account disconnected successfully."
}
```

---

### `GET /api/devto/status`
Checks if the authenticated user has a DEV.to API key connected and verified in their profile.

- **Headers**:
  - `Authorization: Bearer <jwt_token>` (**Required**)

**Response `200 OK`**:
```json
{
  "success": true,
  "source": "DEV_TO",
  "connected": true,
  "profile": { ... }
}
```

---

### `GET /api/devto/me`
Validates the user's DEV.to API key and returns authenticated DEV.to profile details.

- **Headers**:
  - `x-devto-api-key: <user_api_key>` (**Required**)
  - `Authorization: Bearer <jwt_token>` (Optional)

**Response `200 OK`**:
```json
{
  "success": true,
  "source": "DEV_TO",
  "message": "DEV.to API key verified successfully",
  "profile": {
    "id": 123456,
    "username": "your_username",
    "name": "Jane Doe",
    "summary": "Fullstack developer",
    "twitterUsername": "janedoe",
    "githubUsername": "janedoe",
    "profileImage": "https://media2.dev.to/dynamic/image/.../profile.jpg",
    "joinedAt": "2024-01-15T00:00:00Z"
  }
}
```

---

### `POST /api/devto/articles`
Publishes or drafts an article directly on DEV.to according to Forem API specifications.

- **URL Alias**: `POST /api/devto/publish`
- **Headers**:
  - `Content-Type: application/json`
  - `x-devto-api-key: <user_api_key>` (**Required**)
  - `Authorization: Bearer <jwt>` (Optional; if present, automatically saves a copy in CoreLink posts history)

**Request Body**:
```json
{
  "title": "Building Scalable Backends with Node.js and Supabase",
  "body_markdown": "# Building Scalable Backends\n\nIn this article, we explore architectural patterns for cross-platform publishing...",
  "published": true,
  "tags": ["nodejs", "supabase", "backend", "webdev"],
  "series": "Backend Mastery",
  "main_image": "https://images.unsplash.com/photo-1555066931-4365d14bab8c",
  "canonical_url": "https://myblog.com/building-scalable-backends",
  "description": "A deep dive into building modular backend architectures with Node.js and Supabase.",
  "save_to_corelink": true
}
```

> **Tag Rules for DEV.to**: Maximum 4 tags. Automatically stripped of leading `#`, converted to lowercase alphanumeric.

**Response `201 Created`**:
```json
{
  "success": true,
  "source": "DEV_TO",
  "message": "Article published successfully to DEV.to",
  "article": {
    "id": 1984201,
    "title": "Building Scalable Backends with Node.js and Supabase",
    "url": "https://dev.to/janedoe/building-scalable-backends-with-nodejs-and-supabase-4k12",
    "slug": "building-scalable-backends-with-nodejs-and-supabase-4k12",
    "path": "/janedoe/building-scalable-backends-with-nodejs-and-supabase-4k12",
    "published": true,
    "publishedAt": "2026-10-07T13:30:00Z",
    "commentsCount": 0,
    "reactionsCount": 0
  },
  "corelink_post": {
    "id": "b182cb08-0112-4fe0-a36c-95b87443194a",
    "platforms": ["devto"],
    "devtoArticleId": 1984201,
    "devtoUrl": "https://dev.to/janedoe/building-scalable-backends-with-nodejs-and-supabase-4k12",
    "status": "published"
  }
}
```

---

### `GET /api/devto/articles`
Fetches the user's articles from DEV.to.

- **Query Parameters**:
  - `page`: Page number (default `1`)
  - `per_page`: Number of articles per page (default `30`, max `1000`)
  - `state`: Filter state (`all`, `published`, `unpublished` for drafts)

**Response `200 OK`**:
```json
{
  "success": true,
  "source": "DEV_TO",
  "count": 12,
  "page": 1,
  "per_page": 30,
  "articles": [
    {
      "id": 1984201,
      "title": "Building Scalable Backends with Node.js and Supabase",
      "published": true,
      "published_at": "2026-10-07T13:30:00Z",
      "url": "https://dev.to/janedoe/building-scalable-backends-with-nodejs-and-supabase-4k12",
      "comments_count": 5,
      "public_reactions_count": 28
    }
  ]
}
```

---

### `GET /api/devto/articles/:id`
Retrieves a single DEV.to article by its ID.

---

### `PUT /api/devto/articles/:id`
Updates an existing DEV.to article.

**Request Body**:
```json
{
  "title": "Updated Article Title",
  "body_markdown": "Updated content...",
  "published": true,
  "tags": ["nodejs", "javascript"]
}
```

---

### `POST /api/devto/crosspost/:id`
Cross-posts an existing CoreLink scheduled or published post to DEV.to.

- **Headers**: `Authorization: Bearer <jwt_token>`
- **Optional Request Body**:
  ```json
  {
    "title": "Custom DEV.to Title (defaults to post heading)",
    "tags": ["webdev", "productivity"],
    "canonical_url": "https://linkedin.com/feed/update/urn:li:share:123"
  }
  ```

---

## 4. Multi-Platform Post Creation (`/api/posts`)

When creating a scheduled post via `POST /api/posts`, use the `platforms` array or `target` field:

### Create Post for LinkedIn Only
```json
{
  "content": "Excited to share insights from our latest system architecture review!",
  "scheduled_at": "2026-10-08T09:00:00Z",
  "platforms": ["linkedin"]
}
```

### Create Post for DEV.to Only
```json
{
  "content": "# Modern Server Architecture\n\nDeep dive into building multi-platform publishing engines.",
  "scheduled_at": "2026-10-08T10:00:00Z",
  "platforms": ["devto"],
  "devto_title": "Modern Server Architecture: Building Publishing Engines",
  "devto_tags": ["architecture", "nodejs", "devops"]
}
```

### Create Post for Both (LinkedIn + DEV.to)
```json
{
  "content": "# Multi-Platform Publishing with CoreLink\n\nPublishing seamlessly across professional networks and developer communities.",
  "scheduled_at": "2026-10-08T11:00:00Z",
  "platforms": ["linkedin", "devto"],
  "devto_title": "Multi-Platform Publishing with CoreLink",
  "devto_tags": ["javascript", "webdev", "productivity"]
}
```
*(Or specify `"target": "both"`)*

---

## 5. Publishing Pipeline & Immediate Dispatch

### `POST /api/posts/:id/publish-now`
Dispatches the post immediately. Accepts dynamic targeting:

- **Target Both**: `POST /api/posts/:id/publish-now?target=both` or `{ "target": "both" }`
- **Target LinkedIn**: `POST /api/posts/:id/publish-now?target=linkedin`
- **Target DEV.to**: `POST /api/posts/:id/publish-now?target=devto`
- **Target Auto (Default)**: Automatically reads `platforms` assigned to the post during creation.

**Response `200 OK` (when publishing to both)**:
```json
{
  "success": true,
  "partialFailure": false,
  "source": "SUPABASE",
  "message": "Post processed for linkedin and devto",
  "targets": ["linkedin", "devto"],
  "results": {
    "linkedin": {
      "success": true,
      "postUrn": "urn:li:share:724589218932"
    },
    "devto": {
      "success": true,
      "articleId": 1984201,
      "url": "https://dev.to/janedoe/multi-platform-publishing-4k12",
      "publishedAt": "2026-10-07T13:35:00Z"
    }
  },
  "post": {
    "id": "52857053-f725-4b10-a7d1-031e42c23bc8",
    "status": "published",
    "platforms": ["linkedin", "devto"],
    "linkedinPostUrn": "urn:li:share:724589218932",
    "devtoArticleId": 1984201,
    "devtoUrl": "https://dev.to/janedoe/multi-platform-publishing-4k12",
    "devtoPublishedAt": "2026-10-07T13:35:00Z",
    "publishedAt": "2026-10-07T13:35:00Z"
  }
}
```

---

### Dedicated Platform Dispatch Endpoints

- **`POST /api/posts/:id/publish-linkedin`**: Dispatches post strictly to LinkedIn.
- **`POST /api/posts/:id/publish-devto`**: Dispatches post strictly to DEV.to.
- **`POST /api/posts/:id/publish-both`**: Dispatches post to both LinkedIn and DEV.to simultaneously.
- **`POST /api/posts/:id/crosspost-devto`**: Cross-posts an existing post to DEV.to with optional title and tag overrides.

---

## 6. Database Schema & Migrations

The migration `supabase/migrations/20261007000000_devto_support.sql` applies the following changes:

```sql
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT ARRAY['linkedin']::TEXT[] NOT NULL,
ADD COLUMN IF NOT EXISTS devto_article_id INT,
ADD COLUMN IF NOT EXISTS devto_url TEXT,
ADD COLUMN IF NOT EXISTS devto_published_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS devto_title TEXT,
ADD COLUMN IF NOT EXISTS devto_tags TEXT[],
ADD COLUMN IF NOT EXISTS devto_canonical_url TEXT;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS encrypted_devto_api_key TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_devto_article_id 
    ON public.posts(devto_article_id);

CREATE INDEX IF NOT EXISTS idx_posts_platforms 
    ON public.posts USING GIN(platforms);
```

---

## 7. Postman & API Collections

All DEV.to and multi-platform publishing endpoints are included in the repository Postman collection:

- **Collection**: [`postman/Corelink_Backend_API_Collection.json`](./postman/Corelink_Backend_API_Collection.json)
  - Folder **`7. DEV.to Articles & Community Publishing`**:
    - `7.1 Verify DEV.to API Key & Profile`
    - `7.2 Direct Create / Publish DEV.to Article`
    - `7.3 List My DEV.to Articles`
    - `7.4 Get Single DEV.to Article by ID`
    - `7.5 Update DEV.to Article`
    - `7.6 Cross-post CoreLink Post to DEV.to`
  - Folder **`4. Publishing Pipeline & Cloudflare Cron Engine`**:
    - `4.2B Instant Publish to LinkedIn Only`
    - `4.2C Instant Publish to DEV.to Only`
    - `4.2D Instant Publish to Both (LinkedIn & DEV.to)`
    - `4.2E Cross-post Existing Post to DEV.to`
- **Environment**: [`postman/Corelink_Backend_Environment.json`](./postman/Corelink_Backend_Environment.json)
  - Configure `{{devto_api_key}}` in the Postman environment to automatically authenticate all requests.

