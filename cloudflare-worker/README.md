# Corelink Cloudflare Cron Worker (JavaScript)

A lightweight, zero-idle-cost **Cloudflare Worker (JavaScript ES Module)** configured with a **Cron Trigger (`*/10 * * * *`)** that periodically queries and dispatches scheduled LinkedIn posts to the `corelink_server` backend (`/api/publish`).

---

## 📑 Features
- **Cron Engine (`*/10 * * * *`)**: Executes every 10 minutes on Cloudflare's global edge network.
- **Ultra-low CPU (<10ms)**: Hands off heavy lifting (token decryption & LinkedIn REST publishing) asynchronously to Vercel.
- **Pure JavaScript (ES Modules)**: Lightweight setup with zero compilation or build steps.
- **Resilience**: Built-in exponential backoff retries and request timeout handling (`AbortController`).
- **Manual HTTP Triggering**: Endpoint `POST /trigger` allows instant queue processing for testing and debugging.
- **Health Check**: `GET /health` returns operational status and configuration summary.

---

## 📁 Directory Layout

```text
cloudflare-worker/
├── package.json       # Dependencies (Wrangler)
├── wrangler.toml      # Cron triggers, backend URLs, and environment variables
└── src/
    └── index.js       # Pure JavaScript cron handler & HTTP fetch router
```

---

## 🛠️ Setup & Deployment

### 1. Install Dependencies
```bash
cd cloudflare-worker
npm install
```

### 2. Configure Secrets (`CRON_SECRET`)
Set the shared secret used to authenticate calls to the Corelink backend server:

```bash
npx wrangler secret put CRON_SECRET
```
*When prompted, paste the exact same `CRON_SECRET` value configured in your backend `.env` / Infisical.*

---

### 3. Test Locally
Run the Worker locally in development mode:

```bash
npm run dev
```

#### Trigger a Test Cron Event Locally:
In another terminal, send a test scheduled event:
```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

#### Test the Manual HTTP Trigger:
```bash
curl -X POST "http://localhost:8787/trigger" \
  -H "Authorization: Bearer your_cron_secret"
```

---

### 4. Deploy to Cloudflare
Deploy the Worker and activate the Cron Trigger:

```bash
npm run deploy
```

Once deployed, Cloudflare will automatically execute the Worker every 10 minutes.

---

### 5. Stream Live Logs
View real-time execution logs from the edge:

```bash
npm run tail
```

---

## ⚙️ Configuration Options (`wrangler.toml`)

You can modify behavior directly in [`wrangler.toml`](file:///c:/Users/Neptune/Documents/Projects/corelink_server/cloudflare-worker/wrangler.toml):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `crons` | Schedule array in cron format | `["*/10 * * * *"]` (Every 10 min) |
| `BACKEND_API_URL` | Live URL of `corelink_server` | `"https://corelink-server.vercel.app"` |
| `BATCH_SIZE` | Max posts to claim per cron execution | `"10"` |
| `MAX_RETRIES` | Retry attempts on network failures | `"2"` |
| `TIMEOUT_MS` | Max wait time before aborting | `"15000"` (15 seconds) |
| `ENVIRONMENT` | Deployment environment label | `"production"` |

### Example: Changing to Every 5 Minutes
In `wrangler.toml`, simply change:
```toml
[triggers]
crons = ["*/5 * * * *"]
```
Then run `npm run deploy`.
