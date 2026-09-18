import { AuthService } from '../services/auth.service.js';
import { config } from '../config/env.js';
import { redisService, TTL } from '../services/redis.service.js';

export const handleLinkedInExchange = async (req, res) => {
  try {
    const { code, redirectUri, redirect_uri } = req.body;
    const finalRedirectUri = redirectUri || redirect_uri;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required in request body (e.g. { "code": "..." }).',
      });
    }

    const result = await AuthService.exchangeLinkedInCode({
      code,
      redirectUri: finalRedirectUri,
    });

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      message: 'LinkedIn authentication successful',
      token: result.token,
      profile: result.profile,
      user: result.profile,
    });
  } catch (error) {
    console.error('LinkedIn exchange error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'LinkedIn authentication failed',
    });
  }
};

/**
 * Helper to construct the LinkedIn OAuth 2.0 Authorization URL
 */
export const buildLinkedInAuthUrl = ({ clientId, redirectUri, state, scope }) => {
  const finalClientId = clientId || config.linkedin.clientId || '77wtiyb9nrkwzr';
  const finalScope = scope || 'openid profile email w_member_social';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: finalClientId,
    redirect_uri: redirectUri,
    scope: finalScope,
  });
  if (state) params.set('state', typeof state === 'object' ? JSON.stringify(state) : state);
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
};

/**
 * GET /api/auth/linkedin/url
 * Returns preconfigured LinkedIn OAuth 2.0 authorization URL for React web apps
 */
export const handleGetLinkedInAuthUrl = (req, res) => {
  const host = req.get('host') || 'corelink-server.vercel.app';
  const protocol = req.protocol || (host.includes('localhost') ? 'http' : 'https');
  const defaultCallback = `${protocol}://${host}/api/auth/linkedin/callback`;

  const { redirect_uri, redirectUri, return_to, returnTo, state, scope } = req.query;
  const targetCallback = redirect_uri || redirectUri || defaultCallback;

  let statePayload = state || '';
  if (return_to || returnTo) {
    statePayload = JSON.stringify({
      return_to: return_to || returnTo,
      custom_state: state || null,
    });
  }

  const url = buildLinkedInAuthUrl({
    clientId: config.linkedin.clientId,
    redirectUri: targetCallback,
    state: statePayload,
    scope,
  });

  return res.status(200).json({
    success: true,
    url,
    redirectUri: targetCallback,
  });
};

/**
 * GET /api/auth/linkedin/login
 * Directly initiates LinkedIn OAuth and redirects browser to LinkedIn auth screen
 */
export const handleLinkedInLoginRedirect = (req, res) => {
  const host = req.get('host') || 'corelink-server.vercel.app';
  const protocol = req.protocol || (host.includes('localhost') ? 'http' : 'https');
  const defaultCallback = `${protocol}://${host}/api/auth/linkedin/callback`;

  const { redirect_uri, redirectUri, return_to, returnTo, state, scope } = req.query;
  const targetCallback = redirect_uri || redirectUri || defaultCallback;

  let statePayload = state || '';
  if (return_to || returnTo) {
    statePayload = JSON.stringify({
      return_to: return_to || returnTo,
      custom_state: state || null,
    });
  }

  const url = buildLinkedInAuthUrl({
    clientId: config.linkedin.clientId,
    redirectUri: targetCallback,
    state: statePayload,
    scope,
  });

  return res.redirect(url);
};

/**
 * POST /api/auth/dev-login
 * Developer utility to generate an authenticated session token for React web testing
 */
export const handleDevLogin = async (req, res) => {
  try {
    const { email, name, userId } = req.body || {};
    const result = await AuthService.devLogin({ email, name, userId });

    return res.status(200).json({
      success: true,
      source: 'DEV_SESSION',
      message: 'Developer test session generated successfully',
      token: result.token,
      profile: result.profile,
      user: result.profile,
    });
  } catch (error) {
    console.error('Dev login error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate developer session',
    });
  }
};

export const handleLinkedInCallback = async (req, res) => {
  const clientId = config.linkedin.clientId || '77wtiyb9nrkwzr';
  const retryAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=https%3A%2F%2Fcorelink-server.vercel.app%2Fapi%2Fauth%2Flinkedin%2Fcallback&scope=openid%20profile%20email%20w_member_social`;

  try {
    const { code, error, error_description, state } = req.query;

    if (error) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>CoreLink - Authentication Error</title>
          <style>
            body { background: #0B0F1A; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
            .card { background: #131B2E; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; text-align: center; max-width: 400px; }
            h2 { color: #FF4D4D; margin-top: 0; }
            p { color: #8C9BAE; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
            .btn { display: inline-block; width: 100%; box-sizing: border-box; background: #00C4FF; color: #0B0F1A; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 20px; border-radius: 12px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Authentication Cancelled</h2>
            <p>${error_description || error || 'You cancelled the LinkedIn authorization request.'}</p>
            <a href="${retryAuthUrl}" class="btn">Try Signing In Again</a>
          </div>
        </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>CoreLink - Missing Code</title>
          <style>
            body { background: #0B0F1A; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
            .card { background: #131B2E; padding: 32px; border-radius: 16px; text-align: center; max-width: 400px; }
            .btn { display: inline-block; background: #00C4FF; color: #0B0F1A; font-weight: 700; text-decoration: none; padding: 12px 20px; border-radius: 10px; margin-top: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>No Authorization Code</h2>
            <p style="color: #8C9BAE;">Authorization code was not received.</p>
            <a href="${retryAuthUrl}" class="btn">Start Fresh Login</a>
          </div>
        </body>
        </html>
      `);
    }

    // Determine canonical redirect URI matching what was sent in the auth URL
    const host = req.get('host') || 'corelink-server.vercel.app';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const redirectUri = isLocal
      ? `http://${host}/api/auth/linkedin/callback`
      : `https://${host}/api/auth/linkedin/callback`;

    const result = await AuthService.exchangeLinkedInCode({
      code,
      redirectUri,
    });

    // Check if state requested a web return URL (e.g. React app on localhost:5173 or production domain)
    let returnToUrl = null;
    if (state) {
      try {
        const parsedState = JSON.parse(state);
        if (parsedState?.return_to) {
          returnToUrl = parsedState.return_to;
        }
      } catch {
        if (state.startsWith('http://') || state.startsWith('https://')) {
          returnToUrl = state;
        }
      }
    }

    if (returnToUrl) {
      const separator = returnToUrl.includes('?') ? '&' : '?';
      return res.redirect(`${returnToUrl}${separator}token=${encodeURIComponent(result.token)}&user_id=${encodeURIComponent(result.profile.id)}`);
    }

    const deepLinkUrl = `corelink://auth?token=${encodeURIComponent(result.token)}`;

    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>CoreLink - Authentication Successful</title>
        <style>
          body { background: #0B0F1A; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #131B2E; border: 1px solid rgba(0, 196, 255, 0.25); border-radius: 20px; padding: 36px 28px; text-align: center; max-width: 480px; width: 100%; box-shadow: 0 10px 40px rgba(0, 196, 255, 0.12); }
          .icon { width: 64px; height: 64px; background: linear-gradient(135deg, #00C4FF 0%, #7928CA 100%); border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 20px; color: #fff; }
          h2 { color: #FFFFFF; font-size: 22px; margin: 0 0 8px 0; }
          p { color: #8C9BAE; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0; }
          .btn { display: inline-block; width: 100%; box-sizing: border-box; background: #00C4FF; color: #0B0F1A; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 20px; border-radius: 12px; margin-bottom: 12px; transition: opacity 0.2s; border: none; cursor: pointer; }
          .btn:hover { opacity: 0.9; }
          .btn-secondary { background: rgba(255, 255, 255, 0.08); color: #fff; border: 1px solid rgba(255, 255, 255, 0.15); }
          .dev-box { margin-top: 20px; text-align: left; background: #090D16; border-radius: 12px; padding: 14px; border: 1px solid rgba(255,255,255,0.06); font-family: monospace; font-size: 12px; }
          .token-text { word-break: break-all; color: #00C4FF; margin-top: 6px; user-select: all; }
        </style>
        <script>
          // If launched inside a popup by a React web app, transmit credentials to parent window
          if (window.opener) {
            try {
              window.opener.postMessage({
                type: 'CORELINK_AUTH_SUCCESS',
                token: "${result.token}",
                profile: ${JSON.stringify(result.profile)}
              }, '*');
              setTimeout(function() {
                window.close();
              }, 1200);
            } catch (err) {
              console.warn('postMessage error:', err);
            }
          }

          // Also trigger mobile deep link
          window.location.href = "${deepLinkUrl}";

          function copyToken() {
            navigator.clipboard.writeText("${result.token}").then(function() {
              alert('CoreLink JWT Token copied to clipboard!');
            });
          }
        </script>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>Welcome, ${result.profile.name}!</h2>
          <p>Your LinkedIn account is securely connected. Redirecting you to CoreLink...</p>
          <a href="${deepLinkUrl}" class="btn">Open CoreLink Mobile App</a>
          <button onclick="copyToken()" class="btn btn-secondary">Copy JWT Token (For Web / Dev)</button>
          <div class="dev-box">
            <div style="color: #8C9BAE; font-size: 11px;">JWT SESSION TOKEN (30-DAY TTL):</div>
            <div class="token-text">${result.token.substring(0, 48)}...</div>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('LinkedIn callback error:', error);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>CoreLink - Error</title>
        <style>
          body { background: #0B0F1A; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #131B2E; padding: 32px; border-radius: 18px; text-align: center; max-width: 420px; border: 1px solid rgba(255,77,77,0.3); }
          h2 { color: #FF4D4D; margin-top: 0; }
          p { color: #8C9BAE; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
          .btn { display: inline-block; width: 100%; box-sizing: border-box; background: #00C4FF; color: #0B0F1A; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 20px; border-radius: 12px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Connection Expired</h2>
          <p>${error.message.includes('expired') || error.message.includes('code') ? 'The authorization code has expired or was already used. Please start a fresh login session.' : error.message}</p>
          <a href="${retryAuthUrl}" class="btn">Start Fresh LinkedIn Login</a>
        </div>
      </body>
      </html>
    `);
  }
};

export const handleGetMe = async (req, res) => {
  try {
    const cacheKey = `cache:user:${req.user.id}`;

    // 1. Try reading from Redis cache
    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        source: 'REDIS',
        profile: cached,
        user: cached,
      });
    }

    // 2. Fetch from Supabase DB on cache miss
    const profile = await AuthService.getProfile(req.user.id);

    // 3. Store in Redis cache with explicit TTL (900 seconds / 15 minutes)
    await redisService.set(cacheKey, profile, TTL.USER_PROFILE);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      profile,
      user: profile,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve profile',
    });
  }
};

export const handleDisconnect = async (req, res) => {
  try {
    const result = await AuthService.disconnect(req.user.id);

    // Invalidate user cache and related data
    await redisService.del(`cache:user:${req.user.id}`);
    await redisService.delPattern(`cache:posts:${req.user.id}:*`);
    await redisService.del(`cache:stats:${req.user.id}`);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      message: 'LinkedIn account disconnected successfully',
      ...result,
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to disconnect account',
    });
  }
};
