import { LinkedInService } from '../services/linkedin.service.js';

export const handlePublishPostNow = async (req, res) => {
  try {
    const { id } = req.params;

    const publishedPost = await LinkedInService.publishPostNow({
      userId: req.user.id,
      postId: id,
    });

    return res.status(200).json({
      success: true,
      message: 'Post published successfully to LinkedIn',
      post: publishedPost,
      data: publishedPost,
    });
  } catch (error) {
    console.error('Publish now error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to publish post to LinkedIn',
    });
  }
};

export const handleCronPublishQueue = async (req, res) => {
  try {
    const batchLimit = parseInt(req.query.batch_limit || req.body.batch_limit || '10', 10);

    const summary = await LinkedInService.processCronPublishingQueue({
      batchLimit,
    });

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...summary,
    });
  } catch (error) {
    console.error('Cron queue runner error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process scheduled publishing queue',
    });
  }
};
