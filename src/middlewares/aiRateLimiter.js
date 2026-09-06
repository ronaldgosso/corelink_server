import { supabaseAdmin } from '../config/supabase.js';

export const DAILY_AI_LIMIT = 10;

/**
 * Calculates user's local midnight and next reset midnight in UTC.
 * @param {number} tzOffsetMinutes - Timezone offset in minutes ahead of UTC (e.g. +180 for UTC+3)
 */
export const getUserLocalMidnightUtc = (tzOffsetMinutes = 0) => {
  const offset = parseInt(tzOffsetMinutes, 10) || 0;
  const now = new Date();

  // Project current UTC time into user's local day
  const localTime = new Date(now.getTime() + offset * 60 * 1000);

  // User's local midnight for today in UTC coordinate terms
  const localMidnight = new Date(
    Date.UTC(
      localTime.getUTCFullYear(),
      localTime.getUTCMonth(),
      localTime.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );

  // True UTC timestamp of the start of the user's current local day
  const userMidnightUtc = new Date(localMidnight.getTime() - offset * 60 * 1000);

  // Next local midnight (when the quota resets)
  const nextUserMidnightUtc = new Date(userMidnightUtc.getTime() + 24 * 60 * 60 * 1000);

  const msUntilReset = Math.max(0, nextUserMidnightUtc.getTime() - now.getTime());

  return {
    userMidnightUtc,
    nextUserMidnightUtc,
    resetsInSeconds: Math.ceil(msUntilReset / 1000),
  };
};

/**
 * Retrieves the user's AI calls count for their current local day.
 */
export const getDailyAiUsage = async ({ userId, timezoneOffset = 0 }) => {
  const { userMidnightUtc, nextUserMidnightUtc, resetsInSeconds } = getUserLocalMidnightUtc(timezoneOffset);

  const { count, error } = await supabaseAdmin
    .from('ai_generation_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', userMidnightUtc.toISOString());

  if (error) {
    console.warn('Error counting daily AI usage from Supabase:', error.message);
  }

  const used = count || 0;
  const remaining = Math.max(0, DAILY_AI_LIMIT - used);

  return {
    limit: DAILY_AI_LIMIT,
    used,
    remaining,
    resets_at: nextUserMidnightUtc.toISOString(),
    resets_in_seconds: resetsInSeconds,
  };
};

/**
 * Express middleware enforcing the 10 calls/day rate limit resetting at local midnight.
 */
export const checkAiRateLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for AI operations.',
      });
    }

    const tzOffset = req.headers['x-timezone-offset'] || req.body?.timezone_offset || 0;
    const usage = await getDailyAiUsage({ userId, timezoneOffset: tzOffset });

    // Set standard rate limit headers
    res.setHeader('X-RateLimit-Limit', String(usage.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, usage.remaining - 1)));
    res.setHeader('X-RateLimit-Reset', usage.resets_at);

    if (usage.used >= usage.limit) {
      return res.status(429).json({
        success: false,
        error: `Daily AI limit reached (${usage.used}/${usage.limit} calls). Your quota resets at midnight local time.`,
        code: 'RATE_LIMIT_EXCEEDED',
        quota: {
          ...usage,
          remaining: 0,
        },
      });
    }

    // Attach quota info to req for the controller to include in response
    req.aiQuota = {
      ...usage,
      used: usage.used + 1,
      remaining: Math.max(0, usage.remaining - 1),
    };

    next();
  } catch (err) {
    console.error('AI Rate limiter error:', err);
    // Fail open or proceed if there is an internal error checking quota so users aren't blocked
    next();
  }
};
