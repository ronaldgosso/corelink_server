import { supabaseAdmin } from '../config/supabase.js';

export class PostService {
  /**
   * Creates a new scheduled post in Supabase
   */
  static async createPost({ userId, content, scheduledAt, mediaUrl = null, mediaType = 'none', status = 'pending' }) {
    if (!content || content.trim().length === 0) {
      throw new Error('Post content is required.');
    }

    if (!scheduledAt) {
      throw new Error('Scheduled date/time is required.');
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error('Invalid scheduled_at date format. Must be a valid ISO-8601 string.');
    }

    const { data: post, error } = await supabaseAdmin
      .from('posts')
      .insert({
        user_id: userId,
        content: content.trim(),
        scheduled_at: scheduledDate.toISOString(),
        media_url: mediaUrl,
        media_type: mediaType || 'none',
        status: status || 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      console.error('Supabase post insert error:', error);
      throw new Error(`Failed to create post: ${error.message}`);
    }

    return this.formatPost(post);
  }

  /**
   * Retrieves all posts for a user with optional status filtering
   */
  static async getPosts({ userId, status }) {
    let query = supabaseAdmin
      .from('posts')
      .select('*')
      .eq('user_id', userId)
      .order('scheduled_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status.toLowerCase());
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('Supabase get posts error:', error);
      throw new Error(`Failed to fetch posts: ${error.message}`);
    }

    return (posts || []).map((p) => this.formatPost(p));
  }

  /**
   * Retrieves a single post by ID ensuring user ownership
   */
  static async getPostById({ userId, postId }) {
    const { data: post, error } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('id', postId)
      .eq('user_id', userId)
      .single();

    if (error || !post) {
      throw new Error('Post not found or access denied.');
    }

    return this.formatPost(post);
  }

  /**
   * Updates an existing post
   */
  static async updatePost({ userId, postId, content, scheduledAt, status, mediaUrl, mediaType }) {
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (content !== undefined) updatePayload.content = content.trim();
    if (scheduledAt !== undefined) {
      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        throw new Error('Invalid scheduled_at date format.');
      }
      updatePayload.scheduled_at = scheduledDate.toISOString();
    }
    if (status !== undefined) updatePayload.status = status;
    if (mediaUrl !== undefined) updatePayload.media_url = mediaUrl;
    if (mediaType !== undefined) updatePayload.media_type = mediaType;

    const { data: updatedPost, error } = await supabaseAdmin
      .from('posts')
      .update(updatePayload)
      .eq('id', postId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      console.error('Supabase update post error:', error);
      throw new Error(`Failed to update post: ${error.message}`);
    }

    return this.formatPost(updatedPost);
  }

  /**
   * Deletes a scheduled post
   */
  static async deletePost({ userId, postId }) {
    const { error } = await supabaseAdmin
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase delete post error:', error);
      throw new Error(`Failed to delete post: ${error.message}`);
    }

    return { success: true, message: 'Post deleted successfully.' };
  }

  /**
   * Aggregates post metrics & stats for mobile dashboard
   */
  static async getPostStats({ userId }) {
    const { data: posts, error } = await supabaseAdmin
      .from('posts')
      .select('status')
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase get stats error:', error);
      throw new Error(`Failed to fetch stats: ${error.message}`);
    }

    const all = posts || [];
    const stats = {
      total: all.length,
      pending: all.filter((p) => p.status === 'pending').length,
      published: all.filter((p) => p.status === 'published').length,
      failed: all.filter((p) => p.status === 'failed').length,
      draft: all.filter((p) => p.status === 'draft').length,
      processing: all.filter((p) => p.status === 'processing').length,
    };

    return stats;
  }

  /**
   * Formats raw Supabase post record for API consistency
   */
  static formatPost(post) {
    if (!post) return null;
    return {
      id: post.id,
      userId: post.user_id,
      user_id: post.user_id,
      content: post.content,
      mediaUrl: post.media_url,
      media_url: post.media_url,
      mediaType: post.media_type,
      media_type: post.media_type,
      mediaAssetUrn: post.media_asset_urn,
      scheduledAt: post.scheduled_at,
      scheduled_at: post.scheduled_at,
      publishedAt: post.published_at,
      published_at: post.published_at,
      status: post.status,
      linkedinPostUrn: post.linkedin_post_urn,
      errorLog: post.error_log,
      retryCount: post.retry_count,
      createdAt: post.created_at,
      updatedAt: post.updated_at,
    };
  }
}
