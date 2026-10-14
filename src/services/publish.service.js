import { LinkedInService } from './linkedin.service.js';
import { DevToService } from './devto.service.js';
import { PostService } from './post.service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { decrypt } from '../utils/crypto.js';
import { redisService } from './redis.service.js';
import { fcmService } from './fcm.service.js';

export class PublishService {
  /**
   * Publishes a post to LinkedIn, DEV.to, or both based on target / configuration
   * @param {object} params
   * @param {string} params.userId - User UUID
   * @param {string} params.postId - Post UUID
   * @param {'auto' | 'both' | 'all' | 'linkedin' | 'devto'} [params.target='auto'] - Target destination
   * @param {object} [params.overrides={}] - Optional Dev.to title, tags, canonical_url overrides
   * @param {string} [params.devtoApiKey=null] - Optional Dev.to API key passed directly
   * @param {object} [params.req=null] - Optional Express request for header resolution
   */
  static async publishPost({
    userId,
    postId,
    target = 'auto',
    overrides = {},
    devtoApiKey = null,
    req = null,
  }) {
    // 1. Fetch post
    const post = await PostService.getPostById({ userId, postId });
    if (!post) {
      throw new Error('Post not found in database.');
    }

    // 2. Fetch author profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('Author profile not found in database.');
    }

    // 3. Resolve target platforms
    const requestedTarget = String(target || 'auto').toLowerCase();
    const shouldTargetLinkedIn =
      requestedTarget === 'both' ||
      requestedTarget === 'all' ||
      requestedTarget === 'linkedin' ||
      (requestedTarget === 'auto' &&
        (!post.platforms ||
          post.platforms.length === 0 ||
          post.platforms.includes('linkedin') ||
          post.platforms.includes('all') ||
          post.platforms.includes('both')));

    const shouldTargetDevTo =
      requestedTarget === 'both' ||
      requestedTarget === 'all' ||
      requestedTarget === 'devto' ||
      (requestedTarget === 'auto' &&
        post.platforms &&
        (post.platforms.includes('devto') ||
          post.platforms.includes('all') ||
          post.platforms.includes('both')));

    if (!shouldTargetLinkedIn && !shouldTargetDevTo) {
      throw new Error(
        `No valid target platform selected for post. Target was '${target}', post platforms: [${(post.platforms || []).join(', ')}]`
      );
    }

    // 4. Mark status as processing in database
    await supabaseAdmin
      .from('posts')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', postId);

    const results = {
      linkedin: null,
      devto: null,
    };
    const errors = [];

    // 5. Execute LinkedIn Publishing if targeted
    if (shouldTargetLinkedIn) {
      try {
        if (!profile.encrypted_access_token || profile.encrypted_access_token === 'DISCONNECTED') {
          throw new Error('LinkedIn account is disconnected or missing access token.');
        }

        const accessToken = decrypt(profile.encrypted_access_token);
        const liResult = await LinkedInService.publishPostToLinkedIn({
          accessToken,
          personId: profile.linkedin_member_id,
          commentary: post.content,
          mediaAssetUrn: post.mediaAssetUrn,
          mediaType: post.mediaType,
        });

        results.linkedin = {
          success: true,
          postUrn: liResult.postUrn,
        };
      } catch (liErr) {
        console.error('[PublishService] LinkedIn publication failed:', liErr);
        errors.push(`LinkedIn: ${liErr.message}`);
        results.linkedin = {
          success: false,
          error: liErr.message,
        };
      }
    }

    // 6. Execute DEV.to Publishing if targeted
    if (shouldTargetDevTo) {
      try {
        const resolvedKey = DevToService.resolveApiKey({
          apiKey: devtoApiKey,
          req,
          userProfile: profile,
        });

        if (!resolvedKey) {
          throw new Error(
            'DEV.to API key is required. Please pass your DEV.to API key in App Settings.'
          );
        }

        const devToResult = await DevToService.publishPostToDevTo({
          post,
          apiKey: resolvedKey,
          overrides,
        });

        results.devto = {
          success: true,
          articleId: devToResult.id,
          url: devToResult.url,
          publishedAt: devToResult.publishedAt,
        };
      } catch (devToErr) {
        console.error('[PublishService] DEV.to publication failed:', devToErr);
        errors.push(`DEV.to: ${devToErr.message}`);
        results.devto = {
          success: false,
          error: devToErr.message,
        };
      }
    }

    // 7. Evaluate overall outcome
    const anySucceeded =
      (results.linkedin && results.linkedin.success) ||
      (results.devto && results.devto.success);
    const anyFailed =
      (shouldTargetLinkedIn && !results.linkedin?.success) ||
      (shouldTargetDevTo && !results.devto?.success);

    const finalStatus = anySucceeded ? 'published' : 'failed';
    const nowIso = new Date().toISOString();

    const updatePayload = {
      status: finalStatus,
      updated_at: nowIso,
      error_log: errors.length > 0 ? errors.join(' | ') : null,
    };

    if (anySucceeded) {
      updatePayload.published_at = nowIso;
    }

    if (results.linkedin?.success) {
      updatePayload.linkedin_post_urn = results.linkedin.postUrn;
    }

    // If DEV.to columns exist in the database, update them
    if (results.devto?.success) {
      updatePayload.devto_article_id = results.devto.articleId;
      updatePayload.devto_url = results.devto.url;
      updatePayload.devto_published_at = results.devto.publishedAt || nowIso;
    }

    // Safely update Supabase record
    let updatedPostRecord = null;
    try {
      const { data, error } = await supabaseAdmin
        .from('posts')
        .update(updatePayload)
        .eq('id', postId)
        .select('*')
        .single();

      if (!error && data) {
        updatedPostRecord = data;
      } else if (error && error.message.includes('column')) {
        // If devto columns are not yet migrated in Supabase, strip them and update standard columns
        delete updatePayload.devto_article_id;
        delete updatePayload.devto_url;
        delete updatePayload.devto_published_at;
        const fallbackRes = await supabaseAdmin
          .from('posts')
          .update(updatePayload)
          .eq('id', postId)
          .select('*')
          .single();
        updatedPostRecord = fallbackRes.data;
      }
    } catch (dbErr) {
      console.warn('[PublishService] Notice on post status update:', dbErr.message);
    }

    // 8. Invalidate Redis caches
    await redisService.del(`cache:post:${userId}:${postId}`);
    await redisService.delPattern(`cache:posts:${userId}:*`);
    await redisService.del(`cache:stats:${userId}`);

    if (!anySucceeded && errors.length > 0) {
      throw new Error(`Publishing failed: ${errors.join('; ')}`);
    }

    return {
      success: anySucceeded,
      partialFailure: anyFailed && anySucceeded,
      targets: [
        ...(shouldTargetLinkedIn ? ['linkedin'] : []),
        ...(shouldTargetDevTo ? ['devto'] : []),
      ],
      results,
      post: PostService.formatPost(updatedPostRecord || { ...post, ...updatePayload }),
    };
  }

  /**
   * Publishes exclusively to LinkedIn
   */
  static async publishLinkedInOnly({ userId, postId }) {
    return this.publishPost({
      userId,
      postId,
      target: 'linkedin',
    });
  }

  /**
   * Publishes exclusively to DEV.to
   */
  static async publishDevToOnly({
    userId,
    postId,
    overrides = {},
    devtoApiKey = null,
    req = null,
  }) {
    return this.publishPost({
      userId,
      postId,
      target: 'devto',
      overrides,
      devtoApiKey,
      req,
    });
  }

  /**
   * Publishes simultaneously to both LinkedIn and DEV.to
   */
  static async publishBoth({
    userId,
    postId,
    overrides = {},
    devtoApiKey = null,
    req = null,
  }) {
    return this.publishPost({
      userId,
      postId,
      target: 'both',
      overrides,
      devtoApiKey,
      req,
    });
  }

  /**
   * Batch processes scheduled posts due across LinkedIn & DEV.to
   */
  static async processCronPublishingQueue({ batchLimit = 10, target = 'auto' } = {}) {
    const results = {
      totalClaimed: 0,
      succeeded: 0,
      failed: 0,
      partialFailed: 0,
      linkedinDispatched: 0,
      devtoDispatched: 0,
      details: [],
    };

    // 1. Fetch due posts
    let duePosts = [];
    try {
      const { data, error } = await supabaseAdmin
        .from('posts')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(batchLimit);

      if (!error && Array.isArray(data)) {
        duePosts = data;
      }
    } catch (fetchErr) {
      console.error('[PublishService] Cron queue fetch error:', fetchErr.message);
    }

    results.totalClaimed = duePosts.length;
    if (duePosts.length === 0) {
      return results;
    }

    // 2. Process each due post
    for (const post of duePosts) {
      try {
        const pubResult = await this.publishPost({
          userId: post.user_id,
          postId: post.id,
          target,
        });

        if (pubResult.success) {
          results.succeeded++;
          if (pubResult.partialFailure) {
            results.partialFailed++;
          }

          // Trigger FCM push notification to user's registered devices
          try {
            await fcmService.sendPostPublishedNotification({
              post: pubResult.post || post,
              results: pubResult.results,
              userId: post.user_id,
            });
          } catch (fcmErr) {
            console.warn('[PublishService] FCM dispatch warning:', fcmErr.message);
          }
        } else {
          results.failed++;
        }

        if (pubResult.results?.linkedin?.success) {
          results.linkedinDispatched++;
        }
        if (pubResult.results?.devto?.success) {
          results.devtoDispatched++;
        }

        results.details.push({
          postId: post.id,
          success: pubResult.success,
          partialFailure: pubResult.partialFailure,
          targets: pubResult.targets,
          results: pubResult.results,
        });
      } catch (err) {
        results.failed++;
        results.details.push({
          postId: post.id,
          success: false,
          error: err.message,
        });
      }
    }

    return results;
  }
}
