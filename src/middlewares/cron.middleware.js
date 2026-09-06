import { config } from '../config/env.js';

/**
 * Validates CRON_SECRET Bearer token dispatched by Cloudflare Worker
 */
export const requireCronSecret = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = config.security.cronSecret;

  if (!expectedSecret) {
    console.error('[CRON SECURITY ERROR] CRON_SECRET is not configured on the server.');
    return res.status(500).json({
      success: false,
      error: 'Server misconfiguration: CRON_SECRET is required.',
    });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing or malformed Cron Bearer token.',
    });
  }

  const token = authHeader.split(' ')[1];
  if (token !== expectedSecret) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid Cron secret key.',
    });
  }

  next();
};
