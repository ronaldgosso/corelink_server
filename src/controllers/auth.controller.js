import { AuthService } from '../services/auth.service.js';

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

export const handleLinkedInCallback = async (req, res) => {
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
            p { color: #8C9BAE; font-size: 14px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Authentication Failed</h2>
            <p>${error_description || error || 'You cancelled the LinkedIn authorization request.'}</p>
          </div>
        </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send('Authorization code missing in query parameters.');
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
          .token-box { background: #0B0F1A; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; font-size: 11px; word-break: break-all; color: #8C9BAE; margin-top: 16px; user-select: all; }
        </style>
        <script>
          window.onload = function() {
            window.location.href = "${deepLinkUrl}";
          };
        </script>
      </head>
      <body>
        <div class="card">
          <div class="icon">⚡</div>
          <h2>Welcome, ${result.profile.name}!</h2>
          <p>Your LinkedIn account is securely connected. Redirecting you to the CoreLink mobile app...</p>
          <a href="${deepLinkUrl}" class="btn">Open CoreLink App</a>
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
          body { background: #0B0F1A; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #131B2E; padding: 30px; border-radius: 16px; text-align: center; max-width: 400px; border: 1px solid rgba(255,77,77,0.3); }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="color: #FF4D4D;">Connection Failed</h2>
          <p style="color: #8C9BAE;">${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
};

export const handleGetMe = async (req, res) => {
  try {
    const profile = await AuthService.getProfile(req.user.id);
    return res.status(200).json({
      success: true,
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
    return res.status(200).json({
      success: true,
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
