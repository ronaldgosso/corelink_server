import { AnalyticsService } from '../services/analytics.service.js';

/**
 * GET /api/analytics/posts/:id
 * Retrieves post performance metrics & timeline history (cached in Redis)
 */
export const handleGetPostAnalytics = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const postId = req.params.id;
    const forceSync = req.query.force === 'true';

    const result = await AnalyticsService.getPostAnalytics({
      userId,
      postId,
      forceSync,
    });

    return res.status(200).json({
      success: true,
      source: result.source,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/analytics/posts/:id/sync
 * Forces an immediate live sync of post metrics with LinkedIn API
 */
export const handleForceSyncPostAnalytics = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const postId = req.params.id;

    const result = await AnalyticsService.getPostAnalytics({
      userId,
      postId,
      forceSync: true,
    });

    return res.status(200).json({
      success: true,
      source: result.source,
      message: 'Post metrics successfully synchronized with LinkedIn',
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/analytics/overview
 * Profile-wide aggregated engagement stats, top posts, and 14-day timeline
 */
export const handleGetAnalyticsOverview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const forceSync = req.query.force === 'true';

    const result = await AnalyticsService.getUserAnalyticsOverview({
      userId,
      forceSync,
    });

    return res.status(200).json({
      success: true,
      source: result.source,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/analytics/sync-all
 * Forces a refresh of all recent published posts for the authenticated user
 */
export const handleSyncAllPostsAnalytics = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const summary = await AnalyticsService.syncAllUserPublishedPosts({
      userId,
    });

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      message: 'Bulk analytics synchronization completed',
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/analytics/cron-sync
 * Cloudflare Worker / Cron Dispatcher endpoint for background metrics refresh
 */
export const handleCronSyncAnalytics = async (req, res, next) => {
  try {
    const batchLimit = parseInt(req.query.batch_limit || req.body?.batch_limit || '20', 10);

    const summary = await AnalyticsService.syncPublishedPostsMetricsCron({
      batchLimit,
    });

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      timestamp: new Date().toISOString(),
      ...summary,
    });
  } catch (error) {
    next(error);
  }
};
