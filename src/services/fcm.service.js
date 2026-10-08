import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

class FcmService {
  constructor() {
    this.isConfigured = false;
    this.app = null;
    this.init();
  }

  /**
   * Initializes Firebase Admin SDK gracefully
   */
  init() {
    try {
      if (admin.apps.length > 0) {
        this.app = admin.apps[0];
        this.isConfigured = true;
        console.log('[FCM] Firebase Admin already initialized');
        return;
      }

      let credential = null;

      // 1. Check for inline JSON credentials
      if (config.firebase.serviceAccountJson) {
        try {
          const serviceAccount = JSON.parse(config.firebase.serviceAccountJson);
          credential = admin.credential.cert(serviceAccount);
        } catch (parseErr) {
          console.warn('[FCM] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', parseErr.message);
        }
      }

      // 2. Check for service account file path
      if (!credential && config.firebase.serviceAccountKeyPath) {
        const resolvedPath = path.resolve(process.cwd(), config.firebase.serviceAccountKeyPath);
        if (fs.existsSync(resolvedPath)) {
          const raw = fs.readFileSync(resolvedPath, 'utf8');
          const serviceAccount = JSON.parse(raw);
          credential = admin.credential.cert(serviceAccount);
        } else {
          console.warn(`[FCM] Service account file not found at: ${resolvedPath}`);
        }
      }

      // 3. Fallback to GOOGLE_APPLICATION_CREDENTIALS if set in env
      if (!credential && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = admin.credential.applicationDefault();
      }

      if (credential) {
        this.app = admin.initializeApp({
          credential,
          projectId: config.firebase.projectId || undefined,
        });
        this.isConfigured = true;
        console.log('[FCM] Firebase Admin initialized successfully');
      } else {
        this.isConfigured = false;
        console.log(
          '[FCM] Firebase credentials not found. Push notifications will run in standby mode until service account is configured.'
        );
      }
    } catch (err) {
      this.isConfigured = false;
      console.error('[FCM] Initialization error:', err.message);
    }
  }

  /**
   * Registers or updates a device push token for a user
   */
  async registerToken({ userId, token, platform = 'android', deviceName = null }) {
    if (!userId || !token) {
      throw new Error('userId and token are required for device registration');
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('device_tokens')
        .upsert(
          {
            user_id: userId,
            token,
            platform,
            device_name: deviceName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id, token' }
        )
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (err) {
      console.error('[FCM] Error registering device token in DB:', err.message);
      throw err;
    }
  }

  /**
   * Unregisters a device token (e.g., on logout)
   */
  async unregisterToken({ userId, token }) {
    if (!token) {
      return { success: true };
    }

    try {
      let query = supabaseAdmin.from('device_tokens').delete().eq('token', token);
      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { error } = await query;
      if (error) {
        throw error;
      }

      return { success: true };
    } catch (err) {
      console.error('[FCM] Error unregistering device token:', err.message);
      throw err;
    }
  }

  /**
   * Fetches active device tokens for a user
   */
  async getUserTokens(userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('device_tokens')
        .select('token')
        .eq('user_id', userId);

      if (error || !data) {
        return [];
      }

      return data.map((d) => d.token).filter(Boolean);
    } catch (err) {
      console.error('[FCM] Error fetching user tokens:', err.message);
      return [];
    }
  }

  /**
   * Sends push notification when a scheduled post is published
   */
  async sendPostPublishedNotification({ post, results = {}, userId }) {
    const targetUserId = userId || post.user_id;
    if (!targetUserId) {
      return { sent: 0, reason: 'No user ID available' };
    }

    const tokens = await this.getUserTokens(targetUserId);
    if (!tokens || tokens.length === 0) {
      return { sent: 0, reason: 'No device tokens registered for user' };
    }

    if (!this.isConfigured) {
      console.log(
        `[FCM] Standby mode: Notification would be sent to ${tokens.length} device(s) for post ${post.id}`
      );
      return {
        sent: 0,
        simulated: true,
        devicesCount: tokens.length,
        message: 'FCM in standby mode (credentials not yet provided)',
      };
    }

    // Determine platform results
    const liOk = results?.linkedin?.success || false;
    const devtoOk = results?.devto?.success || false;
    const isBoth = (liOk && devtoOk) || (post.platforms && post.platforms.includes('linkedin') && post.platforms.includes('devto'));
    const isDevToOnly = devtoOk && !liOk;

    // Resolve subject name
    const cleanSnippet = (post.content || '')
      .replace(/[#*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const snippetExcerpt = cleanSnippet.length > 50 ? `${cleanSnippet.substring(0, 50)}...` : cleanSnippet;

    const articleTitle = post.devto_title || post.devtoTitle;
    const hasArticleTitle = articleTitle && articleTitle.trim().length > 0;

    let title = 'CoreLink Post Published Live!';
    let body = `"${snippetExcerpt}" is now live on LinkedIn.`;

    if (isBoth) {
      title = 'Published Live to LinkedIn & DEV.to!';
      const displaySubject = hasArticleTitle ? articleTitle.trim() : snippetExcerpt;
      body = `"${displaySubject}" is now live on LinkedIn & DEV.to.`;
    } else if (isDevToOnly) {
      title = 'Published Live to DEV.to!';
      const displaySubject = hasArticleTitle ? articleTitle.trim() : snippetExcerpt;
      body = `"${displaySubject}" is now live on DEV.to.`;
    } else {
      title = 'Published Live to LinkedIn!';
      body = `"${snippetExcerpt}" is now live on LinkedIn.`;
    }

    try {
      const multicastPayload = {
        tokens,
        notification: {
          title,
          body,
        },
        data: {
          type: 'POST_PUBLISHED',
          postId: String(post.id || ''),
          platforms: JSON.stringify(post.platforms || ['linkedin']),
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'corelink_schedule_channel',
            icon: '@mipmap/ic_launcher',
            color: '#0077B5',
            sound: 'default',
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(multicastPayload);
      console.log(
        `[FCM] Dispatched push: ${response.successCount} succeeded, ${response.failureCount} failed out of ${tokens.length} devices`
      );

      // Clean up stale or invalid tokens
      if (response.failureCount > 0) {
        const deadTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error) {
            const code = resp.error.code;
            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              deadTokens.push(tokens[idx]);
            }
          }
        });

        if (deadTokens.length > 0) {
          await supabaseAdmin.from('device_tokens').delete().in('token', deadTokens);
          console.log(`[FCM] Cleaned up ${deadTokens.length} expired device token(s)`);
        }
      }

      return {
        sent: response.successCount,
        failed: response.failureCount,
        total: tokens.length,
      };
    } catch (sendErr) {
      console.error('[FCM] Error sending multicast message:', sendErr.message);
      return { sent: 0, error: sendErr.message };
    }
  }
}

export const fcmService = new FcmService();
export default fcmService;
