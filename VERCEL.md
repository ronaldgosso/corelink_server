# Vercel Deployment Guide: Express Node.js Server

This guide explains how `corelink_server` is configured, deployed, and managed as a serverless Express application on [Vercel](https://vercel.com).

---

## 📑 Table of Contents
1. [Deployment Overview](#deployment-overview)
2. [Live Endpoints](#live-endpoints)
3. [How It Works (Serverless Architecture)](#how-it-works-serverless-architecture)
4. [Deployment Methods](#deployment-methods)
   - [Method 1: Automatic Deployments via GitHub (Recommended)](#method-1-automatic-deployments-via-github-recommended)
   - [Method 2: Deploying via Vercel CLI](#method-2-deploying-via-vercel-cli)
5. [Managing Environment Variables](#managing-environment-variables)
   - [Option A: Infisical ➔ Vercel Sync (Recommended)](#option-a-infisical--vercel-sync-recommended)
   - [Option B: Vercel Web Dashboard](#option-b-vercel-web-dashboard)
   - [Option C: Vercel CLI](#option-c-vercel-cli)
6. [Serverless Considerations & Best Practices](#serverless-considerations--best-practices)
7. [Scheduled Tasks / Cron Jobs](#scheduled-tasks--cron-jobs)
8. [Monitoring & Function Logs](#monitoring--function-logs)
9. [Vercel CLI Cheat Sheet](#vercel-cli-cheat-sheet)

---

## 1. Deployment Overview

In a traditional setup, an Express server runs as a continuous, long-lived process (`node server.js`). On Vercel, the application runs as a **Serverless Function**, automatically scaling up to handle traffic and scaling down to zero when idle.

---

## 2. Live Endpoints

| Environment | URL |
| :--- | :--- |
| **Production Server** | [https://corelink-server.vercel.app](https://corelink-server.vercel.app) |
| **Health Check** | [https://corelink-server.vercel.app/api/health](https://corelink-server.vercel.app/api/health) |
| **Vercel Dashboard** | [https://vercel.com/dashboard](https://vercel.com/dashboard) |

---

## 3. How It Works (Serverless Architecture)

The Vercel deployment relies on two configuration files:

### 1. `api/index.js`
The serverless entry point that exports the Express `app` instance:
```javascript
import app from '../src/app.js';

export default app;
```

### 2. `vercel.json`
Routes all incoming HTTP traffic (`/(.*)`) to the serverless function:
```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/api/index.js"
    }
  ]
}
```

---

## 4. Deployment Methods

### Method 1: Automatic Deployments via GitHub (Recommended)

When you push code to GitHub, Vercel automatically creates a deployment:

- **Pushing to `main` or `dev`**: Triggers a **Production** deployment.
- **Opening a Pull Request**: Generates an isolated **Preview** URL for testing before merging.

```bash
git push origin dev
```

---

### Method 2: Deploying via Vercel CLI

You can also deploy directly from your local terminal using the Vercel CLI:

#### Preview Deployment
```bash
npx vercel
```
*Creates an instant preview URL to test your local changes without affecting production.*

#### Production Deployment
```bash
npx vercel --prod
```
*Deploys the changes directly to your live production domain (`https://corelink-server.vercel.app`).*

---

## 5. Managing Environment Variables

Ensure your production environment variables (such as `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `NODE_ENV`, `CORS_ORIGIN`) are configured on Vercel.

### Option A: Infisical ➔ Vercel Sync (Recommended)
You can connect Infisical directly to Vercel so any changes in Infisical automatically sync to Vercel:
1. Open your project in [Infisical Web App](https://app.infisical.com).
2. Go to **Integrations** ➔ Select **Vercel**.
3. Link your Infisical `prod` environment to your Vercel `Production` environment.

### Option B: Vercel Web Dashboard
1. Go to your [Vercel Project Settings](https://vercel.com/ronaldgossos-projects/corelink-server/settings/environment-variables).
2. Navigate to **Environment Variables**.
3. Add the required keys:
   - `NODE_ENV` = `production`
   - `CORS_ORIGIN` = `*` (or your frontend domain)
   - `API_PREFIX` = `/api`
   - `LINKEDIN_CLIENT_ID` = `your_client_id`
   - `LINKEDIN_CLIENT_SECRET` = `your_client_secret`
   - `LINKEDIN_REDIRECT_URI` = `https://corelink-server.vercel.app/api/auth/linkedin/callback`
4. Redeploy for the new variables to take effect (`npx vercel --prod` or trigger redeploy in dashboard).

### Option C: Vercel CLI
```bash
# Add a single environment variable
npx vercel env add LINKEDIN_CLIENT_ID

# Pull production environment variables locally (saves to .env.local)
npx vercel env pull .env.local
```

---

## 6. Serverless Considerations & Best Practices

1. **Stateless Operations:**
   - Serverless functions are ephemeral. Do **not** store state (such as user sessions or uploaded files) in local memory or filesystem.
   - Use external databases (e.g., PostgreSQL, MongoDB, Supabase) and external object storage (e.g., AWS S3, Cloudinary) for file uploads.

2. **Execution Timeouts:**
   - Hobby plan timeout: **10 seconds** per request.
   - Pro plan timeout: Up to **300 seconds** (configured via `vercel.json` function maxDuration).

3. **Database Connection Pooling:**
   - Always use connection pooling (e.g., Prisma Accelerate, PgBouncer, Supabase pooled connection string) to prevent exhausting database connections across scaling serverless functions.

---

## 7. Scheduled Tasks / Cron Jobs

For scheduled LinkedIn post publishing, you can configure **Vercel Cron Jobs** in `vercel.json`:

```json
{
  "version": 2,
  "crons": [
    {
      "path": "/api/scheduler/process-queue",
      "schedule": "*/15 * * * *"
    }
  ],
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/api/index.js"
    }
  ]
}
```
*Note: Secure your cron endpoints with an authorization header (`CRON_SECRET`) to ensure only Vercel can trigger them.*

---

## 8. Monitoring & Function Logs

### Live Function Logs
To inspect real-time logs and errors from your deployed server:

```bash
# Stream live logs from production
npx vercel logs https://corelink-server.vercel.app
```

Or view interactive execution logs, invocation metrics, and runtime latency directly in the **Vercel Dashboard ➔ Logs Tab**.

---

## 9. Vercel CLI Cheat Sheet

| Task | Command |
| :--- | :--- |
| **Login to Vercel** | `npx vercel login` |
| **Deploy Preview** | `npx vercel` |
| **Deploy Production** | `npx vercel --prod` |
| **Local Emulation** | `npx vercel dev` |
| **List Deployments** | `npx vercel ls` |
| **Inspect Deployment** | `npx vercel inspect <url>` |
| **View Real-time Logs** | `npx vercel logs <url>` |
| **Pull Remote Env Vars** | `npx vercel env pull .env.local` |
| **List Project Env Vars** | `npx vercel env ls` |
