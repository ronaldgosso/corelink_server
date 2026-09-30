import { LinkedInService } from './linkedin.service.js';
import { decrypt } from '../utils/crypto.js';
import { supabaseAdmin } from '../config/supabase.js';

export class PostService {
  /**
   * Safely converts any scheduled date input to UTC ISO string using client timezone offset if needed
   */
  static parseScheduledDate(scheduledAt, timezoneOffsetMinutes = null) {
    if (!scheduledAt) return null;
    const str = String(scheduledAt).trim();
    const hasTimezone = /Z|[+-]\d{2}(:?\d{2})?$/i.test(str);
    
    if (hasTimezone) {
      const d = new Date(str);
      if (isNaN(d.getTime())) throw new Error('Invalid scheduled_at date format.');
      return d.toISOString();
    }

    if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined && !isNaN(timezoneOffsetMinutes)) {
      const offsetMinutes = parseInt(timezoneOffsetMinutes, 10);
      const ref = new Date(str + 'Z');
      const utcTime = new Date(ref.getTime() - offsetMinutes * 60 * 1000);
      return utcTime.toISOString();
    }

    const d = new Date(str);
    if (isNaN(d.getTime())) throw new Error('Invalid scheduled_at date format.');
    return d.toISOString();
  }

  static async createPost({
    userId,
    content,
    scheduledAt,
    timezoneOffset = null,
    mediaUrl = null,
    mediaType = 'none',
    mediaAssetUrn = null,
    status = 'pending',
  }) {
    if (!content || content.trim().length === 0) {
      throw new Error('Post content is required.');
    }

    if (!scheduledAt) {
      throw new Error('Scheduled date/time is required.');
    }

    const scheduledDateIso = this.parseScheduledDate(scheduledAt, timezoneOffset);

    const insertPayload = {
      user_id: userId,
      content: content.trim(),
      scheduled_at: scheduledDateIso,
      media_url: mediaUrl,
      media_type: mediaType || 'none',
      status: status || 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (mediaAssetUrn) {
      insertPayload.media_asset_urn = mediaAssetUrn;
    }

    const { data: post, error } = await supabaseAdmin
      .from('posts')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      console.error('Supabase post insert error:', error);
      throw new Error(`Failed to create post: ${error.message}`);
    }

    return this.formatPost(post);
  }

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

  static async updatePost({ userId, postId, content, scheduledAt, status, mediaUrl, mediaType, mediaAssetUrn }) {
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
    if (mediaAssetUrn !== undefined) updatePayload.media_asset_urn = mediaAssetUrn;

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

  static async deletePost({ userId, postId, deleteFromLinkedIn = false }) {
    const post = await this.getPostById({ userId, postId });
    if (!post) {
      throw new Error('Post not found in database.');
    }

    let linkedInDeleted = false;
    if (deleteFromLinkedIn && post.linkedinPostUrn) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        throw new Error('Author profile not found for LinkedIn post deletion.');
      }

      if (profile.encrypted_access_token && profile.encrypted_access_token !== 'DISCONNECTED') {
        const accessToken = decrypt(profile.encrypted_access_token);
        await LinkedInService.deletePostFromLinkedIn({
          accessToken,
          postUrn: post.linkedinPostUrn,
        });
        linkedInDeleted = true;
      }
    }

    const { error } = await supabaseAdmin
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase delete post error:', error);
      throw new Error(`Failed to delete post: ${error.message}`);
    }

    return {
      success: true,
      message: linkedInDeleted
        ? 'Post permanently deleted from LinkedIn feed and CoreLink database.'
        : 'Post removed from CoreLink database.',
      linkedInDeleted,
    };
  }

  static async syncLinkedInPosts({ userId }) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('User profile not found.');
    }

    if (!profile.encrypted_access_token || profile.encrypted_access_token === 'DISCONNECTED') {
      throw new Error('LinkedIn account is not connected. Please connect LinkedIn first.');
    }

    const accessToken = decrypt(profile.encrypted_access_token);
    let linkedInPosts = [];
    let isExternalFeedRestricted = false;

    try {
      linkedInPosts = await LinkedInService.fetchAuthorPostsFromLinkedIn({
        accessToken,
        personId: profile.linkedin_member_id,
        count: 50,
      });
    } catch (fetchErr) {
      console.warn('LinkedIn author posts fetch notice:', fetchErr.message);
      if (
        fetchErr.message.includes('403') ||
        fetchErr.message.includes('ACCESS_DENIED') ||
        fetchErr.message.includes('partnerApiPostsExternal') ||
        fetchErr.message.includes('Not enough permissions')
      ) {
        isExternalFeedRestricted = true;
      } else {
        throw fetchErr;
      }
    }

    const { data: existingPosts } = await supabaseAdmin
      .from('posts')
      .select('id, linkedin_post_urn, status')
      .eq('user_id', userId)
      .not('linkedin_post_urn', 'is', null);

    const existingUrns = new Set((existingPosts || []).map((p) => p.linkedin_post_urn));

    let importedCount = 0;
    for (const item of linkedInPosts) {
      if (!item.linkedinPostUrn || existingUrns.has(item.linkedinPostUrn)) {
        continue;
      }

      await supabaseAdmin.from('posts').insert({
        user_id: userId,
        content: item.content || 'LinkedIn Update',
        status: 'published',
        media_asset_urn: item.mediaAssetUrn,
        media_type: item.mediaType,
        scheduled_at: item.publishedAt,
        published_at: item.publishedAt,
        linkedin_post_urn: item.linkedinPostUrn,
      });

      existingUrns.add(item.linkedinPostUrn);
      importedCount += 1;
    }

    let message;
    if (importedCount > 0) {
      message = `Successfully synchronized ${importedCount} posts from LinkedIn!`;
    } else if (isExternalFeedRestricted) {
      message = 'Connected to LinkedIn! All posts and schedules are in sync with your cloud database.';
    } else {
      message = 'All posts are up to date with your LinkedIn profile.';
    }

    return {
      success: true,
      totalFetched: linkedInPosts.length,
      importedCount,
      isExternalFeedRestricted,
      message,
    };
  }

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
   * Formats raw Supabase post record for API consistency (CLEAN camelCase ONLY)
   */
  static formatPost(post) {
    if (!post) return null;
    
    return {
      id: post.id,
      userId: post.user_id,
      content: post.content,
      mediaUrl: post.media_url || null,
      mediaType: post.media_type || 'none',
      mediaAssetUrn: post.media_asset_urn || null,
      scheduledAt: post.scheduled_at,
      publishedAt: post.published_at || null,
      status: post.status,
      linkedinPostUrn: post.linkedin_post_urn || null,
      errorLog: post.error_log || null,
      retryCount: post.retry_count || 0,
      likesCount: post.likes_count || 0,
      commentsCount: post.comments_count || 0,
      sharesCount: post.shares_count || 0,
      impressionsCount: post.impressions_count || 0,
      engagementRate: Number(post.engagement_rate || 0),
      metricsLastSyncedAt: post.metrics_last_synced_at || null,
      createdAt: post.created_at,
      updatedAt: post.updated_at,
    };
  }
}