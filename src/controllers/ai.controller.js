import { AIService } from '../services/ai.service.js';
import { getDailyAiUsage } from '../middlewares/aiRateLimiter.js';

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
    const quota = await getDailyAiUsage({ userId, timezoneOffset: tzOffset });

    return res.status(200).json({
      success: true,
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

    return res.status(200).json({
      success: true,
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

    return res.status(200).json({
      success: true,
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
