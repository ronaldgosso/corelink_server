import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { decrypt } from '../utils/crypto.js';
import { PostService } from './post.service.js';

export class LinkedInService {
  /**
   * Initializes and uploads an image to LinkedIn REST API
   */
  static async uploadImageToLinkedIn({ accessToken, personId, buffer, mimeType = 'image/jpeg' }) {
    if (!accessToken) {
      throw new Error('LinkedIn access token is required for image upload.');
    }
    if (!personId) {
      throw new Error('LinkedIn person ID is required.');
    }

    const author = personId.startsWith('urn:li:') ? personId : `urn:li:person:${personId}`;
    const apiVersion = config.linkedin.apiVersion || '202609';

    // Step 1: Initialize Image Upload
    const initResponse = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: author,
        },
      }),
    });

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      throw new Error(`LinkedIn Image Init Failed (${initResponse.status}): ${errText}`);
    }

    const initData = await initResponse.json();
    const uploadUrl = initData.value?.uploadUrl;
    const imageUrn = initData.value?.image;

    if (!uploadUrl || !imageUrn) {
      throw new Error('LinkedIn image initialization did not return uploadUrl or image URN.');
    }

    // Step 2: Upload Binary Payload to signed CDN URL
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'image/jpeg',
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`LinkedIn Image CDN Upload Failed (${uploadResponse.status}): ${errText}`);
    }

    return {
      mediaAssetUrn: imageUrn,
      mediaType: 'image',
    };
  }

  /**
   * Initializes, uploads, and finalizes a video to LinkedIn REST API
   */
  static async uploadVideoToLinkedIn({ accessToken, personId, buffer, mimeType = 'video/mp4', fileSizeBytes = null }) {
    if (!accessToken) {
      throw new Error('LinkedIn access token is required for video upload.');
    }
    if (!personId) {
      throw new Error('LinkedIn person ID is required.');
    }

    const author = personId.startsWith('urn:li:') ? personId : `urn:li:person:${personId}`;
    const apiVersion = config.linkedin.apiVersion || '202609';
    const totalBytes = fileSizeBytes || (buffer ? buffer.length : 0);

    if (totalBytes < 75 * 1024) {
      throw new Error('LinkedIn video size must be at least 75 KB.');
    }
    if (totalBytes > 200 * 1024 * 1024) {
      throw new Error('LinkedIn video size exceeds the 200 MB maximum limit.');
    }

    // Step 1: Initialize Video Upload
    const initResponse = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: author,
          fileSizeBytes: totalBytes,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    });

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      throw new Error(`LinkedIn Video Init Failed (${initResponse.status}): ${errText}`);
    }

    const initData = await initResponse.json();
    const uploadInstructions = initData.value?.uploadInstructions;
    const videoUrn = initData.value?.video;
    const uploadToken = initData.value?.uploadToken || '';

    if (!uploadInstructions || !uploadInstructions.length || !videoUrn) {
      throw new Error('LinkedIn video initialization did not return uploadInstructions or video URN.');
    }

    const uploadUrl = uploadInstructions[0].uploadUrl;

    // Step 2: Upload Binary Payload to signed CDN URL
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: buffer,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`LinkedIn Video CDN Upload Failed (${uploadResponse.status}): ${errText}`);
    }

    const etag = uploadResponse.headers.get('etag') || uploadResponse.headers.get('ETag') || null;

    // Step 3: Finalize Video Upload
    const finalizePayload = {
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken: uploadToken,
        uploadedPartIds: etag ? [etag] : [],
      },
    };

    const finalizeResponse = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(finalizePayload),
    });

    if (!finalizeResponse.ok) {
      const errText = await finalizeResponse.text();
      throw new Error(`LinkedIn Video Finalize Failed (${finalizeResponse.status}): ${errText}`);
    }

    return {
      mediaAssetUrn: videoUrn,
      mediaType: 'video',
    };
  }

  /**
   * Publishes post content to the LinkedIn REST Posts API
   */
  static async publishPostToLinkedIn({ accessToken, personId, commentary, mediaAssetUrn = null, mediaType = 'none' }) {
    if (!accessToken) {
      throw new Error('LinkedIn access token is required for publishing.');
    }

    if (!personId) {
      throw new Error('LinkedIn person ID is required for author URN.');
    }

    const author = personId.startsWith('urn:li:') ? personId : `urn:li:person:${personId}`;
    const apiVersion = config.linkedin.apiVersion || '202609';

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
  /**
   * Permanently deletes a post from LinkedIn REST API
   */
  static async deletePostFromLinkedIn({ accessToken, postUrn }) {
    if (!accessToken) {
      throw new Error('LinkedIn access token is required for deleting posts.');
    }
    if (!postUrn) {
      throw new Error('LinkedIn post URN is required.');
    }

    const apiVersion = config.linkedin.apiVersion || '202609';
    const encodedUrn = encodeURIComponent(postUrn);
    const response = await fetch(`https://api.linkedin.com/rest/posts/${encodedUrn}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    if (!response.ok && response.status !== 204 && response.status !== 404) {
      const errText = await response.text();
      throw new Error(`LinkedIn Delete Post Failed (${response.status}): ${errText}`);
    }

    return { success: true, postUrn };
  }

  /**
   * Fetches author's recent posts directly from LinkedIn REST API
   */
  static async fetchAuthorPostsFromLinkedIn({ accessToken, personId, count = 50 }) {
    if (!accessToken) {
      throw new Error('LinkedIn access token is required.');
    }
    if (!personId) {
      throw new Error('LinkedIn person ID is required.');
    }

    const author = personId.startsWith('urn:li:') ? personId : `urn:li:person:${personId}`;
    const apiVersion = config.linkedin.apiVersion || '202609';
    const encodedAuthor = encodeURIComponent(author);

    const url = `https://api.linkedin.com/rest/posts?author=${encodedAuthor}&q=author&count=${count}&sortBy=CREATED`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LinkedIn Fetch Posts Failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const elements = data.elements || [];

    return elements.map((item) => {
      let commentaryText = '';
      if (typeof item.commentary === 'string') {
        commentaryText = item.commentary;
      } else if (item.commentary && typeof item.commentary.text === 'string') {
        commentaryText = item.commentary.text;
      }

      let mediaAssetUrn = null;
      let mediaType = 'none';
      if (item.content?.media?.id) {
        mediaAssetUrn = item.content.media.id;
        mediaType = mediaAssetUrn.includes('video') ? 'video' : 'image';
      }

      const publishedAt = item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString();

      return {
        linkedinPostUrn: item.id,
        content: commentaryText,
        mediaAssetUrn,
        mediaType,
        publishedAt,
      };
    });
  }

  /**
   * Securely decrypts and returns the active LinkedIn access token for a user profile
   */
  static async getUserAccessToken(userId) {
    if (!userId) {
      throw new Error('User ID is required to retrieve LinkedIn credentials.');
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, encrypted_access_token, linkedin_member_id, token_expires_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new Error('User profile not found in database.');
    }

    if (!profile.encrypted_access_token || profile.encrypted_access_token === 'DISCONNECTED') {
      throw new Error('LinkedIn account is disconnected or missing access token.');
    }

    let accessToken;
    try {
      accessToken = decrypt(profile.encrypted_access_token);
    } catch (err) {
      throw new Error(`Failed to decrypt LinkedIn credentials: ${err.message}`);
    }

    return {
      accessToken,
      personId: profile.linkedin_member_id,
      tokenExpiresAt: profile.token_expires_at,
    };
  }

  /**
   * Fetches real-time social metrics (likes, comments, reactions, shares) for a published post
   */
  static async getPostSocialMetrics({ accessToken, postUrn }) {
    if (!accessToken) {
      throw new Error('Access token is required to fetch post social metrics.');
    }
    if (!postUrn) {
      return {
        likes: 0,
        comments: 0,
        shares: 0,
        impressions: 0,
        engagementRate: 0,
        reactionBreakdown: {},
        isAvailable: false,
      };
    }

    const apiVersion = config.linkedin.apiVersion || '202609';
    const encodedUrn = encodeURIComponent(postUrn);
    let likes = 0;
    let comments = 0;
    let shares = 0;
    let impressions = 0;
    const reactionBreakdown = {};

    // 1. Fetch Social Metadata (Reactions + Comments)
    try {
      const metaResponse = await fetch(`https://api.linkedin.com/rest/socialMetadata/${encodedUrn}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': apiVersion,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });

      if (metaResponse.ok) {
        const metaData = await metaResponse.json();
        const reactionSummaries = metaData.reactionSummaries || {};

        for (const [reactionType, summary] of Object.entries(reactionSummaries)) {
          const count = summary.count || 0;
          reactionBreakdown[reactionType] = count;
          likes += count;
        }

        comments = metaData.commentsSummary?.aggregatedTotalComments || metaData.commentsSummary?.totalFirstLevelComments || 0;
      } else {
        const errText = await metaResponse.text();
        console.warn(`[LINKEDIN SOCIAL METADATA] Warning (${metaResponse.status}): ${errText}`);
      }
    } catch (err) {
      console.warn(`[LINKEDIN SOCIAL METADATA ERROR]: ${err.message}`);
    }

    // 2. Attempt Member / Org Share Statistics (Impressions + Reshares)
    try {
      const statsUrl = `https://api.linkedin.com/rest/memberShareStatistics?q=shares&shares=List(${encodedUrn})`;
      const statsResponse = await fetch(statsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': apiVersion,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        const element = statsData.elements?.[0]?.totalShareStatistics;
        if (element) {
          impressions = element.uniqueImpressionsCount || element.impressionCount || 0;
          shares = element.shareCount || 0;
        }
      }
    } catch {
      // Gracefully silent on memberShareStatistics if restricted by partner scopes
    }

    // Calculate Engagement Rate: ((likes + comments + shares) / (impressions || totalInteractions || 1)) * 100
    const totalInteractions = likes + comments + shares;
    const denominator = impressions > 0 ? impressions : Math.max(totalInteractions, 1);
    const rawRate = (totalInteractions / denominator) * 100;
    const engagementRate = Math.min(Math.round(rawRate * 100) / 100, 100);

    return {
      likes,
      comments,
      shares,
      impressions,
      engagementRate,
      reactionBreakdown,
      isAvailable: true,
    };
  }
}
