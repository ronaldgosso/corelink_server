import { PostService } from '../services/post.service.js';

export const handleCreatePost = async (req, res) => {
  try {
    const { content, scheduled_at, scheduledAt, media_url, mediaUrl, media_type, mediaType, status } = req.body;
    const finalScheduledAt = scheduled_at || scheduledAt;
    const finalMediaUrl = media_url !== undefined ? media_url : mediaUrl;
    const finalMediaType = media_type || mediaType || 'none';

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

    const post = await PostService.createPost({
      userId: req.user.id,
      content,
      scheduledAt: finalScheduledAt,
      mediaUrl: finalMediaUrl,
      mediaType: finalMediaType,
      status: status || 'pending',
    });

    return res.status(201).json({
      success: true,
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
    const posts = await PostService.getPosts({
      userId: req.user.id,
      status,
    });

    return res.status(200).json({
      success: true,
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
    const post = await PostService.getPostById({
      userId: req.user.id,
      postId: id,
    });

    return res.status(200).json({
      success: true,
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
    const { content, scheduled_at, scheduledAt, status, media_url, mediaUrl, media_type, mediaType } = req.body;
    const finalScheduledAt = scheduled_at || scheduledAt;
    const finalMediaUrl = media_url !== undefined ? media_url : mediaUrl;
    const finalMediaType = media_type || mediaType;

    const updatedPost = await PostService.updatePost({
      userId: req.user.id,
      postId: id,
      content,
      scheduledAt: finalScheduledAt,
      status,
      mediaUrl: finalMediaUrl,
      mediaType: finalMediaType,
    });

    return res.status(200).json({
      success: true,
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
    const result = await PostService.deletePost({
      userId: req.user.id,
      postId: id,
    });

    return res.status(200).json({
      success: true,
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

export const handleGetPostStats = async (req, res) => {
  try {
    const stats = await PostService.getPostStats({
      userId: req.user.id,
    });

    return res.status(200).json({
      success: true,
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
