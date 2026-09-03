import { AIService } from '../services/ai.service.js';

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

    const hooks = await AIService.optimizeHooks({ content });

    return res.status(200).json({
      success: true,
      hooks,
    });
  } catch (error) {
    console.error('AI hook optimization error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to optimize opening hook',
    });
  }
};
