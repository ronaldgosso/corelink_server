import { AIService } from '../services/ai.service.js';
import { getDailyAiUsage } from '../middlewares/aiRateLimiter.js';
import { redisService, TTL } from '../services/redis.service.js';

export const handleGetAiQuota = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    const tzOffset = req.headers['x-timezone-offset'] || req.query.timezone_offset || 0;
    const cacheKey = `cache:ai_quota:${userId}:${tzOffset}`;

    // 1. Check Redis cache
    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        source: 'REDIS',
        quota: cached,
      });
    }

    // 2. Compute quota from Supabase DB on cache miss
    const quota = await getDailyAiUsage({ userId, timezoneOffset: tzOffset });

    // 3. Cache TTL: If remaining <= 0, cache until midnight. If remaining > 0, cache for 60s
    const ttlSeconds = quota.remaining <= 0
      ? Math.max(quota.secondsRemaining || 3600, 60)
      : TTL.AI_QUOTA_ACTIVE;

    await redisService.set(cacheKey, quota, ttlSeconds);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      quota,
    });
  } catch (error) {
    console.error('Get AI quota error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve daily AI quota',
    });
  }
};

export const handleGeneratePost = async (req, res) => {
  try {
    const { topic, tone, hook_length, hookLength, include_hashtags, includeHashtags } = req.body;
    const finalHookLength = hook_length || hookLength || 'medium';
    const finalIncludeHashtags = include_hashtags !== undefined ? include_hashtags : (includeHashtags !== undefined ? includeHashtags : true);

    if (!topic) {
      return res.status(400).json({
        success: false,
        error: 'Topic is required in request body (e.g. { "topic": "..." }).',
      });
    }

    const result = await AIService.generatePost({
      userId: req.user?.id,
      topic,
      tone: tone || 'professional',
      hookLength: finalHookLength,
      includeHashtags: finalIncludeHashtags,
    });

    // Invalidate cached AI quota so next check immediately recalculates fresh remaining count
    if (req.user?.id) {
      await redisService.delPattern(`cache:ai_quota:${req.user.id}:*`);
    }

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      data: result,
      quota: req.aiQuota || null,
    });
  } catch (error) {
    console.error('AI post generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate post draft with AI',
    });
  }
};

export const handleOptimizeHook = async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required in request body (e.g. { "content": "..." }).',
      });
    }

    const hooks = await AIService.optimizeHooks({
      userId: req.user?.id,
      content,
    });

    // Invalidate cached AI quota
    if (req.user?.id) {
      await redisService.delPattern(`cache:ai_quota:${req.user.id}:*`);
    }

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      hooks,
      quota: req.aiQuota || null,
    });
  } catch (error) {
    console.error('AI hook optimization error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to optimize opening hook',
    });
  }
};
