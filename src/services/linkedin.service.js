import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { decrypt } from '../utils/crypto.js';
import { PostService } from './post.service.js';

export class LinkedInService {
  /**
   * Publishes post content to LinkedIn REST API v202401
   */
  static async publishPostToLinkedIn({ accessToken, personId, commentary, mediaAssetUrn = null, mediaType = 'none' }) {
    if (!accessToken) {
      throw new Error('LinkedIn access token is required for publishing.');
    }

    if (!personId) {
      throw new Error('LinkedIn person ID is required for author URN.');
    }

    const author = personId.startsWith('urn:li:') ? personId : `urn:li:person:${personId}`;
    const apiVersion = config.linkedin.apiVersion || '202401';

    const payload = {
      author,
      commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    // If media asset is provided (image, video, document)
    if (mediaAssetUrn && mediaType !== 'none') {
      if (mediaType === 'image') {
        payload.content = {
          media: {
            id: mediaAssetUrn,
          },
        };
      } else if (mediaType === 'video') {
        payload.content = {
          media: {
            id: mediaAssetUrn,
          },
        };
      }
    }

    const response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      const msg = errorData.message || errorData.error || errorText || 'LinkedIn post publishing failed';
      throw new Error(`LinkedIn REST API Error (${response.status}): ${msg}`);
    }

    // LinkedIn returns post URN in `x-restli-id` response header
    const postUrn = response.headers.get('x-restli-id') || response.headers.get('x-linkedin-id') || null;
    let responseBody = null;
    try {
      const text = await response.text();
      if (text) responseBody = JSON.parse(text);
    } catch {
      // Empty response body on 201 is standard for LinkedIn REST posts
    }

    return {
      postUrn: postUrn || responseBody?.id || 'urn:li:share:published',
      responseBody,
    };
  }

  /**
   * Publishes a single scheduled post immediately (bypass cron)
   */
  static async publishPostNow({ userId, postId }) {
    // 1. Fetch post
    const post = await PostService.getPostById({ userId, postId });

    // 2. Fetch user profile with encrypted token
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('Author profile not found in database.');
    }

    if (!profile.encrypted_access_token || profile.encrypted_access_token === 'DISCONNECTED') {
      throw new Error('LinkedIn account is disconnected or missing access token.');
    }

    // 3. Decrypt user access token
    let accessToken;
    try {
      accessToken = decrypt(profile.encrypted_access_token);
    } catch (err) {
      throw new Error(`Failed to decrypt LinkedIn access token: ${err.message}`);
    }

    // 4. Mark status as processing
    await supabaseAdmin
      .from('posts')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', postId);

    try {
      // 5. Send to LinkedIn
      const publishResult = await this.publishPostToLinkedIn({
        accessToken,
        personId: profile.linkedin_member_id,
        commentary: post.content,
        mediaAssetUrn: post.mediaAssetUrn,
        mediaType: post.mediaType,
      });

      // 6. Update post as published in Supabase
      const { data: publishedPost, error: updateError } = await supabaseAdmin
        .from('posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          linkedin_post_urn: publishResult.postUrn,
          error_log: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', postId)
        .select('*')
        .single();

      if (updateError) {
        console.error('Failed to update published post state in database:', updateError);
      }

      return PostService.formatPost(publishedPost || { ...post, status: 'published' });
    } catch (err) {
      // Record failure state
      await supabaseAdmin
        .from('posts')
        .update({
          status: 'failed',
          error_log: err.message,
          retry_count: (post.retryCount || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', postId);

      throw err;
    }
  }

  /**
   * Batch processes overdue scheduled posts (Cloudflare Worker Cron Runner)
   */
  static async processCronPublishingQueue({ batchLimit = 10 }) {
    const results = {
      totalClaimed: 0,
      succeeded: 0,
      failed: 0,
      details: [],
    };

    // 1. Try atomic claiming stored procedure if present, else fallback to standard select
    let claimedPosts = [];

    try {
      const { data: spResult, error: spError } = await supabaseAdmin
        .rpc('claim_due_posts', { batch_limit: batchLimit });

      if (!spError && Array.isArray(spResult) && spResult.length > 0) {
        claimedPosts = spResult.map((r) => ({
          id: r.post_id,
          userId: r.post_user_id,
          content: r.post_content,
          mediaUrl: r.post_media_url,
          mediaType: r.post_media_type,
          mediaAssetUrn: r.post_media_asset_urn,
          encryptedToken: r.user_encrypted_token,
          linkedinMemberId: r.user_linkedin_member_id,
          retryCount: r.post_retry_count || 0,
        }));
      }
    } catch (err) {
      console.warn('Stored procedure claim_due_posts fallback:', err.message);
    }

    // Fallback: standard query if stored procedure not installed yet
    if (claimedPosts.length === 0) {
      const now = new Date().toISOString();
      const { data: duePosts, error: dueError } = await supabaseAdmin
        .from('posts')
        .select('*, profiles:user_id(*)')
        .eq('status', 'pending')
        .lte('scheduled_at', now)
        .order('scheduled_at', { ascending: true })
        .limit(batchLimit);

      if (!dueError && duePosts && duePosts.length > 0) {
        for (const p of duePosts) {
          // Claim post
          await supabaseAdmin
            .from('posts')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('id', p.id);

          claimedPosts.push({
            id: p.id,
            userId: p.user_id,
            content: p.content,
            mediaUrl: p.media_url,
            mediaType: p.media_type,
            mediaAssetUrn: p.media_asset_urn,
            encryptedToken: p.profiles?.encrypted_access_token,
            linkedinMemberId: p.profiles?.linkedin_member_id,
            retryCount: p.retry_count || 0,
          });
        }
      }
    }

    results.totalClaimed = claimedPosts.length;

    // 2. Publish each claimed post
    for (const post of claimedPosts) {
      try {
        if (!post.encryptedToken || post.encryptedToken === 'DISCONNECTED') {
          throw new Error('User has disconnected LinkedIn account.');
        }

        const accessToken = decrypt(post.encryptedToken);

        const publishResult = await this.publishPostToLinkedIn({
          accessToken,
          personId: post.linkedinMemberId,
          commentary: post.content,
          mediaAssetUrn: post.mediaAssetUrn,
          mediaType: post.mediaType,
        });

        await supabaseAdmin
          .from('posts')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            linkedin_post_urn: publishResult.postUrn,
            error_log: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', post.id);

        results.succeeded += 1;
        results.details.push({
          postId: post.id,
          status: 'published',
          postUrn: publishResult.postUrn,
        });
      } catch (err) {
        console.error(`Error publishing scheduled post ${post.id}:`, err.message);
        const retryCount = (post.retryCount || 0) + 1;
        const newStatus = retryCount >= 3 ? 'failed' : 'pending'; // Retry up to 3 times before permanent failure

        await supabaseAdmin
          .from('posts')
          .update({
            status: newStatus,
            error_log: err.message,
            retry_count: retryCount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', post.id);

        results.failed += 1;
        results.details.push({
          postId: post.id,
          status: newStatus,
          error: err.message,
        });
      }
    }

    return results;
  }
}
