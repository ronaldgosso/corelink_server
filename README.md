# Corelink Server

> **Production-grade centralized backend gateway for the LinkedIn AI Post Scheduler MVP.**  
> Powers automated AI post creation, scheduled publishing, OAuth token encryption, and Supabase integration.

---

##  System Architecture

<img width="1536" height="1024" alt="ChatGPT Image Sep 6, 2026, 12_49_23 PM" src="https://github.com/user-attachments/assets/4721a2c2-a0ee-4bcb-b571-803567d7ebcd" />


---

## Tech Stack Matrix

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend Gateway** | Node.js (ES Modules), Express 5 | Centralized API, validation, security, and orchestrator |
| **Hosting & Compute** | Vercel Serverless Functions | Zero-idle cost, auto-scaling execution |
| **Database & Auth** | Supabase (PostgreSQL + RLS) | Relational storage for users, encrypted tokens, and posts |
| **AI Engine** | CoreLink AI Engine | High-converting LinkedIn post generation & hook optimization |
| **Background Cron** | Cloudflare Workers (`*/10 * * * *`) | Serverless scheduled trigger querying due posts (<10ms CPU) |
| **Social API** | LinkedIn REST API (`/rest/posts`) | OAuth 2.0 OpenID Connect & post publishing |
| **Secret Management**| Infisical CLI | Team secret synchronization and zero-plaintext runtime injection |

---

##  Documentation Directory

| Document | Purpose |
| :--- | :--- |
|  [**PROJECT_DOCUMENTATION.md**](file:///c:/Users/Neptune/Documents/Projects/corelink_server/PROJECT_DOCUMENTATION.md) | **Master Project Specification**: Full mobile app, backend, web dashboard, architecture, UI/UX design tokens & layman guide. |
|  [**BACKEND_API_GUIDE.md**](file:///c:/Users/Neptune/Documents/Projects/corelink_server/BACKEND_API_GUIDE.md) | Full Backend API guide, **Supabase SQL DDL, RLS policies, indexes**, and Cloudflare Worker script. |
|  [**supabase/README.md**](file:///c:/Users/Neptune/Documents/Projects/corelink_server/supabase/README.md) | Supabase PostgreSQL schema, RLS policies, atomic claim function, and performance indexes. |
| <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> [**cloudflare-worker/README.md**](file:///c:/Users/Neptune/Documents/Projects/corelink_server/cloudflare-worker/README.md) | Cloudflare Worker Cron Trigger engine setup, Wrangler CLI configuration, and edge deployment. |
|  [**INFISICAL.md**](file:///c:/Users/Neptune/Documents/Projects/corelink_server/INFISICAL.md) | Guide to syncing & sharing `.env` variables across the team with Infisical CLI. |
|  [**VERCEL.md**](file:///c:/Users/Neptune/Documents/Projects/corelink_server/VERCEL.md) | Serverless Express deployment on Vercel, live URLs, logs, and cron configurations. |
|  [**LINKEDIN_API_GUIDE.md**](file:///c:/Users/Neptune/Documents/Projects/corelink_server/LINKEDIN_API_GUIDE.md) | Official LinkedIn REST & OAuth 2.0 endpoints, scopes, media upload flows (images, videos, PDFs). |


---

## Getting Started (Local Development)

### 1. Prerequisites
- **Node.js:** `v20+`
- **Infisical CLI:** (Recommended for secret management)

### 2. Quick Setup with Infisical
```bash
# 1. Install dependencies
npm install

# 2. Authenticate Infisical
infisical login

# 3. Link the repository
infisical init

# 4. Run the development server with injected secrets
npm run infisical:dev
```

### 3. Alternative: Standard Setup with `.env`
```bash
cp .env.example .env
# Fill in your variables in .env
npm run dev
```

---

##  API Collections (Postman & Hoppscotch)

Two pre-built, production-ready collections formatted in **Postman v2.1.0 Schema** (compatible with Postman and Hoppscotch):

### 1. Centralized Backend API (Corelink Gateway)
* **Collection:** [`postman/Corelink_Backend_API_Collection.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_API_Collection.json)
* **Environment:** [`postman/Corelink_Backend_Environment.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/Corelink_Backend_Environment.json)
* **Endpoints:** `/api/auth/linkedin`, `/api/auth/me`, `/api/generate`, `/api/posts` (CRUD), `/api/publish` (Cron dispatcher).

### 2. Direct LinkedIn REST & OAuth Collection
* **Collection:** [`postman/LinkedIn_API_Collection.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/LinkedIn_API_Collection.json)
* **Environment:** [`postman/LinkedIn_Environment.json`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/postman/LinkedIn_Environment.json)
* **Endpoints:** Direct calls to `https://www.linkedin.com/oauth/v2` and `https://api.linkedin.com/rest/posts`.

---

##  Live Deployments

* **Production URL:** [https://corelink-server.vercel.app](https://corelink-server.vercel.app)
* **Health Endpoint:** [https://corelink-server.vercel.app/api/health](https://corelink-server.vercel.app/api/health)
* **Vercel Dashboard:** [Project Overview](https://vercel.com/dashboard)
