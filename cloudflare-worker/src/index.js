/**
 * Dispatches a batch publishing request to the Corelink Server backend
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {'cron' | 'manual_http'} triggerSource - Source of the trigger
 * @param {string} [cronPattern='* /10 * * * *'] - Cron schedule pattern
 * @returns {Promise<object>} Execution report
 */
async function dispatchPublishingJob(env, triggerSource, cronPattern = '*/10 * * * *', options = {}) {
  const startTime = Date.now();
  const batchSize = parseInt(options.batchSize || env.BATCH_SIZE || '10', 10);
  const target = options.target || 'auto'; // 'auto', 'devto', 'linkedin', 'both'
  const maxRetries = parseInt(env.MAX_RETRIES || '2', 10);
  const timeoutMs = parseInt(env.TIMEOUT_MS || '15000', 10);
  const targetUrl = `${env.BACKEND_API_URL.replace(/\/$/, '')}/api/publish`;

  const report = {
    timestamp: new Date().toISOString(),
    cronPattern: triggerSource === 'cron' ? cronPattern : `manual_http (${triggerSource})`,
    target,
    durationMs: 0,
    success: false,
  };

  if (!env.CRON_SECRET) {
    report.error = 'Missing CRON_SECRET environment binding. Set via `wrangler secret put CRON_SECRET`.';
    console.error(`[CRON ERROR] ${report.error}`);
    report.durationMs = Date.now() - startTime;
    return report;
  }

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`[CRON DISPATCH] (${triggerSource}) Attempt ${attempt}/${maxRetries + 1} -> ${targetUrl} [target=${target}]`);

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.CRON_SECRET}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Corelink-Cloudflare-Cron-Worker/1.0',
          'X-Trigger-Source': triggerSource,
        },
        body: JSON.stringify({ batchSize, target }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      report.httpStatus = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend returned HTTP ${response.status}: ${errorText}`);
      }

      const jsonResponse = await response.json();
      report.success = true;
      report.responsePayload = jsonResponse;
      report.durationMs = Date.now() - startTime;

      const totalClaimed = jsonResponse.totalClaimed ?? jsonResponse.processed ?? 0;
      const succeeded = jsonResponse.succeeded ?? 0;
      const liCount = jsonResponse.linkedinDispatched ?? 0;
      const devtoCount = jsonResponse.devtoDispatched ?? 0;

      console.log(
        `[CRON SUCCESS] Processed ${totalClaimed} posts (Succeeded: ${succeeded}, LinkedIn: ${liCount}, DEV.to: ${devtoCount}) in ${report.durationMs}ms.`
      );
      return report;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      console.warn(`[CRON WARNING] Attempt ${attempt} failed: ${err.message}`);

      // If attempt failed, pause before next retry
      if (attempt <= maxRetries) {
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }
  }

  report.success = false;
  report.error = lastError ? lastError.message : 'Unknown execution failure';
  report.durationMs = Date.now() - startTime;
  console.error(`[CRON FAILURE] All ${maxRetries + 1} attempts failed: ${report.error}`);
  return report;
}

export default {
  /**
   * 1. Cloudflare Scheduled Cron Handler
   * Triggered automatically by Cloudflare Worker Cron (e.g. every 10 minutes)
   */
  async scheduled(event, env, ctx) {
    console.log(`[CRON TRIGGERED] Event at ${new Date(event.scheduledTime).toISOString()} (Cron: ${event.cron})`);

    // Use ctx.waitUntil to ensure asynchronous execution finishes cleanly within Worker limits
    ctx.waitUntil(dispatchPublishingJob(env, 'cron', event.cron));
  },

  /**
   * 2. HTTP Request Handler
   * Allows manual triggering, health checks, and inspecting worker configuration
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers for API accessibility
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route: GET / or GET /health
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify(
          {
            service: 'Corelink Cloudflare Cron Worker',
            status: 'operational',
            environment: env.ENVIRONMENT || 'production',
            backendUrl: env.BACKEND_API_URL,
            cronSchedule: '*/10 * * * * (every 10 minutes)',
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Route: POST /trigger (Manual Dispatch for Testing)
    if (url.pathname === '/trigger' && request.method === 'POST') {
      // Check optional authorization for manual trigger
      const authHeader = request.headers.get('Authorization');
      if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
        return new Response(
          JSON.stringify({ success: false, message: 'Unauthorized: Invalid or missing Bearer CRON_SECRET' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      let triggerOptions = {};
      try {
        triggerOptions = await request.json();
      } catch (_) {
        // Query param fallback
        const qTarget = url.searchParams.get('target');
        const qBatch = url.searchParams.get('batchSize') || url.searchParams.get('batch_limit');
        if (qTarget) triggerOptions.target = qTarget;
        if (qBatch) triggerOptions.batchSize = qBatch;
      }

      const report = await dispatchPublishingJob(env, 'manual_http', 'manual', triggerOptions);
      return new Response(JSON.stringify(report, null, 2), {
        status: report.success ? 200 : 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 404 Route
    return new Response(
      JSON.stringify({ success: false, message: `Route not found: ${request.method} ${url.pathname}` }),
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  },
};
