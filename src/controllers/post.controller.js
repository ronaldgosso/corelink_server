import { PostService } from '../services/post.service.js';
import { redisService, TTL } from '../services/redis.service.js';

export const handleCreatePost = async (req, res) => {
  try {
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
    } = req.body;
    const finalScheduledAt = scheduled_at || scheduledAt;
    const finalMediaUrl = media_url !== undefined ? media_url : mediaUrl;
    const finalMediaType = media_type || mediaType || 'none';
    const finalMediaAssetUrn = media_asset_urn || mediaAssetUrn || null;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required in request body (e.g. { "content": "..." }).',
      });
    }

    if (!finalScheduledAt) {
      return res.status(400).json({
        success: false,
        error: 'scheduled_at is required in request body (e.g. { "scheduled_at": "2026-09-04T10:00:00Z" }).',
      });
    }

    const tzOffset = req.headers['x-timezone-offset'] || req.body.timezone_offset;
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

    // Invalidate cached post lists & stats for this user
    await redisService.delPattern(`cache:posts:${req.user.id}:*`);
    await redisService.del(`cache:stats:${req.user.id}`);

    return res.status(201).json({
      success: true,
      source: 'SUPABASE',
      message: 'Post created and scheduled successfully',
      post,
      data: post,
    });
  } catch (error) {
    console.error('Create post error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create post',
    });
  }
};

export const handleGetPosts = async (req, res) => {
  try {
    const { status } = req.query;
    const cacheKey = `cache:posts:${req.user.id}:${status || 'all'}`;

    // 1. Try reading from Redis cache
    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        source: 'REDIS',
        posts: cached,
        data: cached,
        count: cached.length,
      });
    }

    // 2. Fetch from Supabase DB on cache miss
    const posts = await PostService.getPosts({
      userId: req.user.id,
      status,
    });

    // 3. Store in Redis cache with explicit TTL (180 seconds / 3 minutes)
    await redisService.set(cacheKey, posts, TTL.POSTS_LIST);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      posts,
      data: posts,
      count: posts.length,
    });
  } catch (error) {
    console.error('Get posts error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve posts',
    });
  }
};

export const handleGetPostById = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `cache:post:${req.user.id}:${id}`;

    // 1. Try reading single post from Redis cache
    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        source: 'REDIS',
        post: cached,
        data: cached,
      });
    }

    // 2. Fetch from Supabase DB on cache miss
    const post = await PostService.getPostById({
      userId: req.user.id,
      postId: id,
    });

    // 3. Store in Redis cache with explicit TTL (600 seconds / 10 minutes)
    await redisService.set(cacheKey, post, TTL.POST_DETAIL);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      post,
      data: post,
    });
  } catch (error) {
    console.error('Get single post error:', error);
    return res.status(error.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: error.message || 'Failed to retrieve post',
    });
  }
};

export const handleUpdatePost = async (req, res) => {
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
      mediaAssetUrn,
    } = req.body;
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

    // Invalidate cached post and listings
    await redisService.del(`cache:post:${req.user.id}:${id}`);
    await redisService.delPattern(`cache:posts:${req.user.id}:*`);
    await redisService.del(`cache:stats:${req.user.id}`);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      message: 'Post updated successfully',
      post: updatedPost,
      data: updatedPost,
    });
  } catch (error) {
    console.error('Update post error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update post',
    });
  }
};

export const handleDeletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteFromLinkedIn = req.query.deleteFromLinkedIn === 'true' || req.body?.deleteFromLinkedIn === true;

    const result = await PostService.deletePost({
      userId: req.user.id,
      postId: id,
      deleteFromLinkedIn,
    });

    // Invalidate cached post and listings
    await redisService.del(`cache:post:${req.user.id}:${id}`);
    await redisService.delPattern(`cache:posts:${req.user.id}:*`);
    await redisService.del(`cache:stats:${req.user.id}`);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      ...result,
    });
  } catch (error) {
    console.error('Delete post error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete post',
    });
  }
};

export const handleSyncLinkedInPosts = async (req, res) => {
  try {
    const result = await PostService.syncLinkedInPosts({
      userId: req.user.id,
    });

    // Invalidate cached post listings & stats since fresh LinkedIn posts were imported
    await redisService.delPattern(`cache:posts:${req.user.id}:*`);
    await redisService.del(`cache:stats:${req.user.id}`);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      ...result,
    });
  } catch (error) {
    console.error('Sync LinkedIn posts error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to synchronize LinkedIn posts',
    });
  }
};

export const handleGetPostStats = async (req, res) => {
  try {
    const cacheKey = `cache:stats:${req.user.id}`;

    // 1. Try reading stats from Redis cache
    const cached = await redisService.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        source: 'REDIS',
        stats: cached,
        data: cached,
      });
    }

    // 2. Fetch from Supabase DB on cache miss
    const stats = await PostService.getPostStats({
      userId: req.user.id,
    });

    // 3. Store in Redis cache with explicit TTL (300 seconds / 5 minutes)
    await redisService.set(cacheKey, stats, TTL.POST_STATS);

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      stats,
      data: stats,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve stats',
    });
  }
};
