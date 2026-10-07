import { LinkedInService } from './linkedin.service.js';
import { decrypt } from '../utils/crypto.js';
import { supabaseAdmin } from '../config/supabase.js';

export class PostService {
  /**
   * Creates a new scheduled post in Supabase
   */
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

  static normalizePlatforms(platforms, target = null) {
    if (target) {
      const t = String(target).toLowerCase();
      if (t === 'both' || t === 'all') return ['linkedin', 'devto'];
      if (t === 'devto') return ['devto'];
      if (t === 'linkedin') return ['linkedin'];
    }

    if (Array.isArray(platforms) && platforms.length > 0) {
      const cleaned = platforms.map((p) => String(p).toLowerCase().trim()).filter(Boolean);
      if (cleaned.includes('both') || cleaned.includes('all')) return ['linkedin', 'devto'];
      return [...new Set(cleaned)];
    }

    if (typeof platforms === 'string' && platforms.trim()) {
      const p = platforms.toLowerCase().trim();
      if (p === 'both' || p === 'all') return ['linkedin', 'devto'];
      if (p.includes(',')) {
        return [...new Set(p.split(',').map((x) => x.trim()).filter(Boolean))];
      }
      return [p];
    }

    return ['linkedin'];
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
    platforms = ['linkedin'],
    target = null,
    devtoTitle = null,
    devtoTags = null,
    devtoCanonicalUrl = null,
  }) {
    if (!content || content.trim().length === 0) {
      throw new Error('Post content is required.');
    }

    if (!scheduledAt) {
      throw new Error('Scheduled date/time is required.');
    }

    const scheduledDateIso = this.parseScheduledDate(scheduledAt, timezoneOffset);
    const normalizedPlatforms = this.normalizePlatforms(platforms, target);

    const insertPayload = {
      user_id: userId,
      content: content.trim(),
      scheduled_at: scheduledDateIso,
      media_url: mediaUrl,
      media_type: mediaType || 'none',
      status: status || 'pending',
      platforms: normalizedPlatforms,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (mediaAssetUrn) {
      insertPayload.media_asset_urn = mediaAssetUrn;
    }
    if (devtoTitle) {
      insertPayload.devto_title = devtoTitle;
    }
    if (devtoTags) {
      insertPayload.devto_tags = Array.isArray(devtoTags) ? devtoTags : String(devtoTags).split(',');
    }
    if (devtoCanonicalUrl) {
      insertPayload.devto_canonical_url = devtoCanonicalUrl;
    }

    let post = null;
    let { data, error } = await supabaseAdmin
      .from('posts')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error && error.message && error.message.includes('column')) {
      // Safe fallback if Dev.to columns have not yet been migrated in remote Supabase
      console.warn('[PostService] Columns not found in Supabase posts table, retrying with core schema:', error.message);
      delete insertPayload.platforms;
      delete insertPayload.devto_title;
      delete insertPayload.devto_tags;
      delete insertPayload.devto_canonical_url;

      const fallbackRes = await supabaseAdmin
        .from('posts')
        .insert(insertPayload)
        .select('*')
        .single();

      if (fallbackRes.error) {
        throw new Error(`Failed to create post: ${fallbackRes.error.message}`);
      }
      post = { ...fallbackRes.data, platforms: normalizedPlatforms };
    } else if (error) {
      console.error('Supabase post insert error:', error);
      throw new Error(`Failed to create post: ${error.message}`);
    } else {
      post = data;
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
  static async updatePost({
    userId,
    postId,
    content,
    scheduledAt,
    status,
    mediaUrl,
    mediaType,
    mediaAssetUrn,
    platforms,
    target,
    devtoTitle,
    devtoTags,
    devtoCanonicalUrl,
  }) {
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
    if (platforms !== undefined || target !== undefined) {
      updatePayload.platforms = this.normalizePlatforms(platforms, target);
    }
    if (devtoTitle !== undefined) updatePayload.devto_title = devtoTitle;
    if (devtoTags !== undefined) {
      updatePayload.devto_tags = Array.isArray(devtoTags) ? devtoTags : String(devtoTags).split(',');
    }
    if (devtoCanonicalUrl !== undefined) updatePayload.devto_canonical_url = devtoCanonicalUrl;

    let updatedPost = null;
    let { data, error } = await supabaseAdmin
      .from('posts')
      .update(updatePayload)
      .eq('id', postId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error && error.message && error.message.includes('column')) {
      console.warn('[PostService] Devto columns not in posts schema, retrying update:', error.message);
      delete updatePayload.platforms;
      delete updatePayload.devto_title;
      delete updatePayload.devto_tags;
      delete updatePayload.devto_canonical_url;

      const fallbackRes = await supabaseAdmin
        .from('posts')
        .update(updatePayload)
        .eq('id', postId)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (fallbackRes.error) {
        throw new Error(`Failed to update post: ${fallbackRes.error.message}`);
      }
      updatedPost = fallbackRes.data;
    } else if (error) {
      console.error('Supabase update post error:', error);
      throw new Error(`Failed to update post: ${error.message}`);
    } else {
      updatedPost = data;
    }

    return this.formatPost(updatedPost);
  }

  /**
   * Deletes a scheduled post
   */
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

  /**
   * Synchronizes recent posts from user's live LinkedIn account into CoreLink
   */
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
      // LinkedIn returns 403 when Developer app lacks Community Management API partner access
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

    // Fetch existing posts with linkedin_post_urn
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
    const hasDevto = Boolean(post.devto_article_id || post.devto_url || post.devtoArticleId || post.devtoUrl);
    const hasLinkedin = Boolean(post.linkedin_post_urn || post.linkedinPostUrn);
    let resolvedPlatforms = post.platforms;

    if (hasDevto && !hasLinkedin) {
      resolvedPlatforms = ['devto'];
    } else if (hasDevto && hasLinkedin) {
      resolvedPlatforms = ['linkedin', 'devto'];
    } else if (hasLinkedin && !hasDevto) {
      resolvedPlatforms = ['linkedin'];
    } else if (resolvedPlatforms && (Array.isArray(resolvedPlatforms) ? resolvedPlatforms.length > 0 : Boolean(resolvedPlatforms))) {
      resolvedPlatforms = this.normalizePlatforms(resolvedPlatforms);
    } else {
      resolvedPlatforms = ['linkedin'];
    }

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
      platforms: resolvedPlatforms,
      linkedinPostUrn: post.linkedin_post_urn,
      devtoArticleId: post.devto_article_id || null,
      devto_article_id: post.devto_article_id || null,
      devtoUrl: post.devto_url || null,
      devto_url: post.devto_url || null,
      devtoPublishedAt: post.devto_published_at || null,
      devto_published_at: post.devto_published_at || null,
      devtoTitle: post.devto_title || null,
      devto_title: post.devto_title || null,
      devtoTags: post.devto_tags || [],
      devto_tags: post.devto_tags || [],
      devtoCanonicalUrl: post.devto_canonical_url || null,
      devto_canonical_url: post.devto_canonical_url || null,
      errorLog: post.error_log,
      retryCount: post.retry_count,
      likesCount: post.likes_count || 0,
      likes_count: post.likes_count || 0,
      commentsCount: post.comments_count || 0,
      comments_count: post.comments_count || 0,
      sharesCount: post.shares_count || 0,
      shares_count: post.shares_count || 0,
      impressionsCount: post.impressions_count || 0,
      impressions_count: post.impressions_count || 0,
      engagementRate: Number(post.engagement_rate || 0),
      engagement_rate: Number(post.engagement_rate || 0),
      metricsLastSyncedAt: post.metrics_last_synced_at || null,
      metrics_last_synced_at: post.metrics_last_synced_at || null,
      createdAt: post.created_at,
      updatedAt: post.updated_at,
    };
  }
}
