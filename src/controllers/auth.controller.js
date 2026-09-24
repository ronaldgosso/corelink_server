import { AuthService } from "../services/auth.service.js";
import { config } from "../config/env.js";
import { redisService, TTL } from "../services/redis.service.js";

export const handleLinkedInExchangeJSON = async (req, res) => {
  try {
    const { code, redirectUri, redirect_uri } = req.body;
    const finalRedirectUri = redirectUri || redirect_uri;

    if (!code) {
      return res.status(400).json({
        success: false,
        error:
          'Authorization code is required in request body (e.g. { "code": "..." }).',
      });
    }

    const result = await AuthService.exchangeLinkedInCode({
      code,
      redirectUri: finalRedirectUri,
    });

    return res.status(200).json({
      success: true,
      source: "SUPABASE",
      message: "LinkedIn authentication successful",
      token: result.token,
      profile: result.profile,
      user: result.profile,
    });
  } catch (error) {
    console.error("LinkedIn exchange error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "LinkedIn authentication failed",
    });
  }
};

export const handleMobileLinkedInDeepLinkCallback = async (req, res) => {
  const clientId = config.linkedin.clientId || "77wtiyb9nrkwzr";
  const retryAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=https%3A%2F%2Fcorelink-server.vercel.app%2Fapi%2Fauth%2Flinkedin%2Fcallback&scope=openid%20profile%20email%20w_member_social`;

  try {
    const { code, error, error_description } = req.query;

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
            <p>${error_description || error || "You cancelled the LinkedIn authorization request."}</p>
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
    const host = req.get("host") || "corelink-server.vercel.app";
    const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
    const redirectUri = isLocal
      ? `http://${host}/api/auth/linkedin/callback`
      : `https://${host}/api/auth/linkedin/callback`;

    const result = await AuthService.exchangeLinkedInCode({
      code,
      redirectUri,
    });

    const deepLinkUrl = `corelink://auth?token=${encodeURIComponent(result.token)}`;

    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>CoreLink - Authentication Successful</title>
        <style>
          body { background: #0B0F1A; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #131B2E; border: 1px solid rgba(0, 196, 255, 0.2); border-radius: 20px; padding: 36px 24px; text-align: center; max-width: 440px; box-shadow: 0 10px 40px rgba(0, 196, 255, 0.1); }
          .icon { width: 64px; height: 64px; background: linear-gradient(135deg, #00C4FF 0%, #7928CA 100%); border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 20px; }
          h2 { color: #FFFFFF; font-size: 22px; margin: 0 0 8px 0; }
          p { color: #8C9BAE; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0; }
          .btn { display: inline-block; width: 100%; box-sizing: border-box; background: #00C4FF; color: #0B0F1A; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 20px; border-radius: 12px; margin-bottom: 12px; }
        </style>
        <script>
          window.onload = function() {
            window.location.href = "${deepLinkUrl}";
          };
        </script>
      </head>
      <body>
        <div class="card">
          <div class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
          <h2>Welcome, ${result.profile.name}!</h2>
          <p>Your LinkedIn account is securely connected. Redirecting you to the CoreLink mobile app...</p>
          <a href="${deepLinkUrl}" class="btn">Open CoreLink App</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("LinkedIn callback error:", error);
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
          <p>${error.message.includes("expired") || error.message.includes("code") ? "The authorization code has expired or was already used. Please start a fresh login session." : error.message}</p>
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
        source: "REDIS",
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
      source: "SUPABASE",
      profile,
      user: profile,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to retrieve profile",
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
      source: "SUPABASE",
      message: "LinkedIn account disconnected successfully",
      ...result,
    });
  } catch (error) {
    console.error("Disconnect error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to disconnect account",
    });
  }
};
