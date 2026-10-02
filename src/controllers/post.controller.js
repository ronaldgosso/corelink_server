import { PostService } from '../services/post.service.js';
import { redisService, TTL } from '../services/redis.service.js';
import { createPostSchema, updatePostSchema, validateBody } from '../validators/post.validator.js';

// Helper to keep error responses consistent across all endpoints
const handleError = (res, error, fallbackMessage = 'Internal server error', statusCode = 500) => {
  console.error(`[Error] ${fallbackMessage}:`, error);
  return res.status(statusCode).json({
    success: false,
    message: error.message || fallbackMessage,
    data: null,
  });
};

export const handleCreatePost = [
  validateBody(createPostSchema),
  async (req, res) => {
    try {
      console.log("🚀 POST /api/posts HIT THE CONTROLLER!"); 
      
      const { 
        content, 
        scheduled_at, 
        scheduledAt, 
        media_url, 
        mediaUrl, 
        media_type, 
        mediaType, 
        media_asset_urn, 
        mediaAssetUrn, 
        status, 
        timezone_offset 
      } = req.validatedData;
      
      const finalScheduledAt = scheduled_at || scheduledAt;
      const finalMediaUrl = media_url !== undefined ? media_url : mediaUrl;
      const finalMediaType = media_type || mediaType || 'none';
      const finalMediaAssetUrn = media_asset_urn || mediaAssetUrn || null;
      const tzOffset = timezone_offset || req.headers['x-timezone-offset'];

      const post = await PostService.createPost({
        userId: req.user.id,
        content,
        scheduledAt: finalScheduledAt,
        timezoneOffset: tzOffset,
        mediaUrl: finalMediaUrl,
        mediaType: finalMediaType,
        mediaAssetUrn: finalMediaAssetUrn,
        status: status || 'pending',
      });

      // Invalidate cache
      await redisService.delPattern(`cache:posts:${req.user.id}:*`);
      await redisService.del(`cache:stats:${req.user.id}`);

      return res.status(201).json({
        success: true,
        message: 'Post created and scheduled successfully',
        data: post, // CLEAN: Only 'data', no 'source' or 'post' key
      });
    } catch (error) {
      return handleError(res, error, 'Failed to create post');
    }
  }
];

export const handleGetPosts = async (req, res) => {
  try {
    const { status } = req.query;
    const cacheKey = `cache:posts:${req.user.id}:${status || 'all'}`;

    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, message: 'Posts retrieved from cache', data: cached });
    }

    const posts = await PostService.getPosts({ userId: req.user.id, status });
    await redisService.set(cacheKey, posts, TTL.POSTS_LIST);

    return res.status(200).json({ success: true, message: 'Posts retrieved successfully', data: posts });
  } catch (error) {
    return handleError(res, error, 'Failed to retrieve posts');
  }
};

export const handleGetPostById = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `cache:post:${req.user.id}:${id}`;

    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, message: 'Post retrieved from cache', data: cached });
    }

    const post = await PostService.getPostById({ userId: req.user.id, postId: id });
    await redisService.set(cacheKey, post, TTL.POST_DETAIL);

    return res.status(200).json({ success: true, message: 'Post retrieved successfully', data: post });
  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 500;
    return handleError(res, error, 'Failed to retrieve post', statusCode);
  }
};

export const handleUpdatePost = [
  validateBody(updatePostSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { 
        content, 
        scheduled_at, 
        scheduledAt, 
        status, 
        media_url, 
        mediaUrl, 
        media_type, 
        mediaType, 
        media_asset_urn, 
        mediaAssetUrn 
      } = req.validatedData;
      
      const finalScheduledAt = scheduled_at || scheduledAt;
      const finalMediaUrl = media_url !== undefined ? media_url : mediaUrl;
      const finalMediaType = media_type || mediaType;
      const finalMediaAssetUrn = media_asset_urn !== undefined ? media_asset_urn : mediaAssetUrn;

      const updatedPost = await PostService.updatePost({
        userId: req.user.id,
        postId: id,
        content,
        scheduledAt: finalScheduledAt,
        status,
        mediaUrl: finalMediaUrl,
        mediaType: finalMediaType,
        mediaAssetUrn: finalMediaAssetUrn,
      });

      // Invalidate cache
      await redisService.del(`cache:post:${req.user.id}:${id}`);
      await redisService.delPattern(`cache:posts:${req.user.id}:*`);
      await redisService.del(`cache:stats:${req.user.id}`);

      return res.status(200).json({ success: true, message: 'Post updated successfully', data: updatedPost });
    } catch (error) {
      return handleError(res, error, 'Failed to update post');
    }
  }
];

export const handleDeletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteFromLinkedIn = req.query.deleteFromLinkedIn === 'true' || req.body?.deleteFromLinkedIn === true;

    const result = await PostService.deletePost({ userId: req.user.id, postId: id, deleteFromLinkedIn });

    // Invalidate cache
    await redisService.del(`cache:post:${req.user.id}:${id}`);
    await redisService.delPattern(`cache:posts:${req.user.id}:*`);
    await redisService.del(`cache:stats:${req.user.id}`);

    return res.status(200).json({ success: true, message: 'Post deleted successfully', data: result });
  } catch (error) {
    return handleError(res, error, 'Failed to delete post');
  }
};

export const handleSyncLinkedInPosts = async (req, res) => {
  try {
    const result = await PostService.syncLinkedInPosts({ userId: req.user.id });

    // Invalidate cache
    await redisService.delPattern(`cache:posts:${req.user.id}:*`);
    await redisService.del(`cache:stats:${req.user.id}`);

    return res.status(200).json({ success: true, message: 'LinkedIn posts synced successfully', data: result });
  } catch (error) {
    return handleError(res, error, 'Failed to synchronize LinkedIn posts');
  }
};

export const handleGetPostStats = async (req, res) => {
  try {
    const cacheKey = `cache:stats:${req.user.id}`;

    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, message: 'Stats retrieved from cache', data: cached });
    }

    const stats = await PostService.getPostStats({ userId: req.user.id });
    await redisService.set(cacheKey, stats, TTL.POST_STATS);

    return res.status(200).json({ success: true, message: 'Stats retrieved successfully', data: stats });
  } catch (error) {
    return handleError(res, error, 'Failed to retrieve stats');
  }
};