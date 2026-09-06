import { supabaseAdmin } from '../config/supabase.js';
import { redisService, TTL } from './redis.service.js';
import { LinkedInService } from './linkedin.service.js';

export class AnalyticsService {
  /**
   * Retrieves full analytics breakdown for a single post with Upstash Redis caching
   */
  static async getPostAnalytics({ userId, postId, forceSync = false }) {
    if (!userId) throw new Error('User ID is required.');
    if (!postId) throw new Error('Post ID is required.');

    const cacheKey = `cache:stats:post:${userId}:${postId}`;

    // 1. Check Redis Cache
    if (!forceSync) {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return { data: cached, source: 'REDIS' };
      }
    }

    // 2. Fetch post from Supabase
    const { data: post, error: postError } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('id', postId)
      .eq('user_id', userId)
      .single();

    if (postError || !post) {
      throw new Error('Post not found or does not belong to the user.');
    }

    // If post is draft or pending or missing linkedin_post_urn
    if (post.status !== 'published' || !post.linkedin_post_urn) {
      const emptyPayload = {
        postId: post.id,
        userId: post.user_id,
        status: post.status,
        isPublished: false,
        linkedinPostUrn: post.linkedin_post_urn || null,
        metrics: {
          likes: post.likes_count || 0,
          comments: post.comments_count || 0,
          shares: post.shares_count || 0,
          impressions: post.impressions_count || 0,
          engagementRate: Number(post.engagement_rate || 0),
          reactionBreakdown: {},
        },
        metricsLastSyncedAt: post.metrics_last_synced_at || null,
        history: [],
      };

      await redisService.set(cacheKey, emptyPayload, TTL.POST_STATS);
      return { data: emptyPayload, source: 'SUPABASE' };
    }

    // 3. Determine if live sync with LinkedIn is required
    const isStale = !post.metrics_last_synced_at ||
      new Date(post.metrics_last_synced_at).getTime() < Date.now() - 3 * 3600 * 1000; // 3 hours

    let currentMetrics = {
      likes: post.likes_count || 0,
      comments: post.comments_count || 0,
      shares: post.shares_count || 0,
      impressions: post.impressions_count || 0,
      engagementRate: Number(post.engagement_rate || 0),
      reactionBreakdown: {},
    };

    let syncedAt = post.metrics_last_synced_at;

    if (forceSync || isStale) {
      try {
        const { accessToken } = await LinkedInService.getUserAccessToken(userId);
        const liveMetrics = await LinkedInService.getPostSocialMetrics({
          accessToken,
          postUrn: post.linkedin_post_urn,
        });

        if (liveMetrics && liveMetrics.isAvailable) {
          currentMetrics = {
            likes: liveMetrics.likes,
            comments: liveMetrics.comments,
            shares: liveMetrics.shares,
            impressions: liveMetrics.impressions,
            engagementRate: liveMetrics.engagementRate,
            reactionBreakdown: liveMetrics.reactionBreakdown || {},
          };
          syncedAt = new Date().toISOString();

          // Update post row
          await supabaseAdmin
            .from('posts')
            .update({
              likes_count: currentMetrics.likes,
              comments_count: currentMetrics.comments,
              shares_count: currentMetrics.shares,
              impressions_count: currentMetrics.impressions,
              engagement_rate: currentMetrics.engagementRate,
              metrics_last_synced_at: syncedAt,
              updated_at: syncedAt,
            })
            .eq('id', postId);

          // Append historical data point
          try {
            await supabaseAdmin
              .from('post_analytics_history')
              .insert({
                post_id: postId,
                user_id: userId,
                likes: currentMetrics.likes,
                comments: currentMetrics.comments,
                shares: currentMetrics.shares,
                impressions: currentMetrics.impressions,
                recorded_at: syncedAt,
              });
          } catch (histErr) {
            console.warn('[ANALYTICS_HISTORY] Non-fatal history insert error:', histErr.message);
          }
        }
      } catch (syncErr) {
        console.warn(`[ANALYTICS_SYNC_WARN] Failed live metrics sync for post ${postId}: ${syncErr.message}`);
      }
    }

    // 4. Retrieve historical trend points
    let history = [];
    try {
      const { data: histData } = await supabaseAdmin
        .from('post_analytics_history')
        .select('id, likes, comments, shares, impressions, recorded_at')
        .eq('post_id', postId)
        .order('recorded_at', { ascending: true })
        .limit(20);

      if (histData && Array.isArray(histData)) {
        history = histData.map((h) => ({
          id: h.id,
          likes: h.likes,
          comments: h.comments,
          shares: h.shares,
          impressions: h.impressions,
          recordedAt: h.recorded_at,
        }));
      }
    } catch {
      history = [];
    }

    const payload = {
      postId: post.id,
      userId: post.user_id,
      status: post.status,
      isPublished: true,
      linkedinPostUrn: post.linkedin_post_urn,
      contentSnippet: post.content ? post.content.substring(0, 100) : '',
      metrics: currentMetrics,
      metricsLastSyncedAt: syncedAt,
      history,
    };

    // Cache in Redis (TTL: 300 seconds)
    await redisService.set(cacheKey, payload, TTL.POST_STATS);

    return { data: payload, source: 'SUPABASE' };
  }

  /**
   * Generates profile-wide aggregate KPIs & top performing posts
   */
  static async getUserAnalyticsOverview({ userId, forceSync = false }) {
    if (!userId) throw new Error('User ID is required.');

    const cacheKey = `cache:stats:overview:${userId}`;

    if (!forceSync) {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return { data: cached, source: 'REDIS' };
      }
    }

    // 1. Fetch published posts for user
    const { data: posts, error } = await supabaseAdmin
      .from('posts')
      .select('id, content, media_type, published_at, likes_count, comments_count, shares_count, impressions_count, engagement_rate, linkedin_post_urn, metrics_last_synced_at')
      .eq('user_id', userId)
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error) {
      console.error('Failed to query user posts for analytics overview:', error);
      throw new Error(`Failed to query analytics overview: ${error.message}`);
    }

    const publishedList = posts || [];
    const totalPublished = publishedList.length;

    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalImpressions = 0;
    let sumEngagementRate = 0;

    const formattedPosts = publishedList.map((p) => {
      const likes = p.likes_count || 0;
      const comments = p.comments_count || 0;
      const shares = p.shares_count || 0;
      const impressions = p.impressions_count || 0;
      const rate = Number(p.engagement_rate || 0);

      totalLikes += likes;
      totalComments += comments;
      totalShares += shares;
      totalImpressions += impressions;
      sumEngagementRate += rate;

      return {
        id: p.id,
        contentSnippet: p.content ? p.content.substring(0, 80) : '',
        mediaType: p.media_type,
        publishedAt: p.published_at,
        linkedinPostUrn: p.linkedin_post_urn,
        likes,
        comments,
        shares,
        impressions,
        engagementRate: rate,
        totalInteractions: likes + comments + shares,
        metricsLastSyncedAt: p.metrics_last_synced_at,
      };
    });

    const averageEngagementRate = totalPublished > 0
      ? Number((sumEngagementRate / totalPublished).toFixed(2))
      : 0;

    // Top 5 posts by engagement interactions
    const topPosts = [...formattedPosts]
      .sort((a, b) => b.totalInteractions - a.totalInteractions)
      .slice(0, 5);

    // 2. Fetch timeline history for the last 14 days
    let timeline = [];
    try {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const { data: histData } = await supabaseAdmin
        .from('post_analytics_history')
        .select('likes, comments, shares, impressions, recorded_at')
        .eq('user_id', userId)
        .gte('recorded_at', fourteenDaysAgo)
        .order('recorded_at', { ascending: true });

      if (histData && Array.isArray(histData)) {
        // Group by day (YYYY-MM-DD)
        const dailyMap = new Map();
        for (const record of histData) {
          const day = record.recorded_at.split('T')[0];
          const existing = dailyMap.get(day) || { date: day, likes: 0, comments: 0, shares: 0, impressions: 0 };
          existing.likes += record.likes;
          existing.comments += record.comments;
          existing.shares += record.shares;
          existing.impressions += record.impressions;
          dailyMap.set(day, existing);
        }
        timeline = Array.from(dailyMap.values());
      }
    } catch {
      timeline = [];
    }

    const payload = {
      userId,
      totalPublished,
      totals: {
        likes: totalLikes,
        comments: totalComments,
        shares: totalShares,
        impressions: totalImpressions,
        interactions: totalLikes + totalComments + totalShares,
        averageEngagementRate,
      },
      topPosts,
      timeline,
      generatedAt: new Date().toISOString(),
    };

    // Cache in Redis for 5 minutes
    await redisService.set(cacheKey, payload, TTL.POST_STATS);

    return { data: payload, source: 'SUPABASE' };
  }

  /**
   * Forces a live sync of all posts published by user in the last 14 days
   */
  static async syncAllUserPublishedPosts({ userId }) {
    if (!userId) throw new Error('User ID is required.');

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const { data: posts, error } = await supabaseAdmin
      .from('posts')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'published')
      .gte('created_at', fourteenDaysAgo);

    if (error) throw new Error(`Failed to list posts for bulk sync: ${error.message}`);

    const syncList = posts || [];
    let synced = 0;
    let failed = 0;

    for (const p of syncList) {
      try {
        await this.getPostAnalytics({ userId, postId: p.id, forceSync: true });
        synced += 1;
      } catch (err) {
        console.warn(`Bulk sync error for post ${p.id}:`, err.message);
        failed += 1;
      }
    }

    // Invalidate profile overview cache
    await redisService.del(`cache:stats:overview:${userId}`);

    return {
      totalFound: syncList.length,
      synced,
      failed,
    };
  }

  /**
   * Cron worker task: background sync for stale published posts across all users
   */
  static async syncPublishedPostsMetricsCron({ batchLimit = 20 }) {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

    // Select posts that haven't been synced in > 6 hours or have never been synced
    const { data: stalePosts, error } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, linkedin_post_urn, metrics_last_synced_at')
      .eq('status', 'published')
      .not('linkedin_post_urn', 'is', null)
      .gte('created_at', fourteenDaysAgo)
      .or(`metrics_last_synced_at.is.null,metrics_last_synced_at.lte.${sixHoursAgo}`)
      .order('metrics_last_synced_at', { ascending: true, nullsFirst: true })
      .limit(batchLimit);

    if (error) {
      console.error('[CRON_ANALYTICS_ERROR] Error fetching stale posts:', error.message);
      return { totalClaimed: 0, synced: 0, failed: 0, errors: [error.message] };
    }

    const postsToSync = stalePosts || [];
    const results = {
      totalClaimed: postsToSync.length,
      synced: 0,
      failed: 0,
      details: [],
    };

    for (const post of postsToSync) {
      try {
        await this.getPostAnalytics({
          userId: post.user_id,
          postId: post.id,
          forceSync: true,
        });

        results.synced += 1;
        results.details.push({ postId: post.id, status: 'synced' });
      } catch (err) {
        results.failed += 1;
        results.details.push({ postId: post.id, status: 'error', error: err.message });
      }
    }

    return results;
  }
}
