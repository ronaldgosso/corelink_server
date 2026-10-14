import { PublishService } from '../services/publish.service.js';
import { redisService, TTL } from '../services/redis.service.js';

// In-memory tracker for the most recent Cloudflare Worker / Cron dispatch
let lastWorkerRunAt = null;

export const getScheduleWindow = async (req, res) => {
  const tzOffset = req.headers['x-timezone-offset'] ? parseInt(req.headers['x-timezone-offset'], 10) : null;
  const cacheKey = `cache:schedule_window:${tzOffset !== null ? tzOffset : 'utc'}`;

  // 1. Check Redis cache
  const cached = await redisService.get(cacheKey);
  if (cached) {
    return res.status(200).json({
      ...cached,
      source: 'REDIS',
    });
  }

  const now = new Date();
  const cadenceMinutes = 10;

  // Calculate next 10-minute boundary (e.g. 20:30, 20:40, 20:50, 21:00)
  const currentMinutes = now.getUTCMinutes();
  const currentSeconds = now.getUTCSeconds();
  const remainder = currentMinutes % cadenceMinutes;

  // Minutes until next boundary
  let minutesToNext = cadenceMinutes - remainder;
  // If we are right on the boundary (within 15 seconds), push to the next window
  if (minutesToNext === cadenceMinutes && currentSeconds > 15) {
    minutesToNext = cadenceMinutes;
  }

  const nextDispatchWindow = new Date(
    now.getTime() + minutesToNext * 60 * 1000 - currentSeconds * 1000 - now.getUTCMilliseconds()
  );

  // Suggested scheduled time gives the user at least 5 minutes buffer
  let suggestedScheduledAt = new Date(nextDispatchWindow);
  if (suggestedScheduledAt.getTime() - now.getTime() < 3 * 60 * 1000) {
    suggestedScheduledAt = new Date(suggestedScheduledAt.getTime() + cadenceMinutes * 60 * 1000);
  }

  let localNextFormatted = null;
  let localSuggestedFormatted = null;

  if (tzOffset !== null && !isNaN(tzOffset)) {
    const localNext = new Date(nextDispatchWindow.getTime() + tzOffset * 60 * 1000);
    const localSugg = new Date(suggestedScheduledAt.getTime() + tzOffset * 60 * 1000);
    localNextFormatted = `${String(localNext.getUTCHours()).padStart(2, '0')}:${String(localNext.getUTCMinutes()).padStart(2, '0')}`;
    localSuggestedFormatted = `${String(localSugg.getUTCHours()).padStart(2, '0')}:${String(localSugg.getUTCMinutes()).padStart(2, '0')}`;
  }

  const result = {
    success: true,
    server_time: now.toISOString(),
    last_worker_run: lastWorkerRunAt,
    cadence_minutes: cadenceMinutes,
    next_dispatch_window: nextDispatchWindow.toISOString(),
    suggested_scheduled_at: suggestedScheduledAt.toISOString(),
    local_next_window: localNextFormatted,
    local_suggested_window: localSuggestedFormatted,
  };

  // Cache for 30 seconds
  await redisService.set(cacheKey, result, TTL.SCHEDULE_WINDOW);

  return res.status(200).json({
    ...result,
    source: 'SYSTEM',
  });
};

/**
 * Universal immediate publish handler supporting:
 * - target: 'auto' (reads post platforms)
 * - target: 'both' (publishes to LinkedIn and DEV.to)
 * - target: 'linkedin' (publishes to LinkedIn only)
 * - target: 'devto' (publishes to DEV.to only)
 */
export const handlePublishPostNow = async (req, res) => {
  try {
    const { id } = req.params;
    const target = req.query.target || req.body?.target || req.body?.platform || 'auto';
    const devtoApiKey = req.body?.devto_api_key || req.headers['x-devto-api-key'] || null;

    const overrides = {
      title: req.body?.title || req.body?.devto_title,
      tags: req.body?.tags || req.body?.devto_tags,
      canonical_url: req.body?.canonical_url || req.body?.devto_canonical_url,
      series: req.body?.series || req.body?.devto_series,
      description: req.body?.description || req.body?.devto_description,
      published: req.body?.published,
    };

    const publishResult = await PublishService.publishPost({
      userId: req.user.id,
      postId: id,
      target,
      overrides,
      devtoApiKey,
      req,
    });

    const targetDesc = publishResult.targets.join(' and ');
    return res.status(200).json({
      success: publishResult.success,
      partialFailure: publishResult.partialFailure,
      source: 'SUPABASE',
      message: `Post processed for ${targetDesc}`,
      targets: publishResult.targets,
      results: publishResult.results,
      post: publishResult.post,
      data: publishResult.post,
    });
  } catch (error) {
    console.error('Publish now error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to publish post',
    });
  }
};

/**
 * Publish specifically to LinkedIn
 */
export const handlePublishToLinkedIn = async (req, res) => {
  try {
    const { id } = req.params;
    const publishResult = await PublishService.publishLinkedInOnly({
      userId: req.user.id,
      postId: id,
    });

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      message: 'Post published successfully to LinkedIn',
      targets: ['linkedin'],
      results: publishResult.results,
      post: publishResult.post,
      data: publishResult.post,
    });
  } catch (error) {
    console.error('Publish to LinkedIn error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to publish post to LinkedIn',
    });
  }
};

/**
 * Publish specifically to DEV.to
 */
export const handlePublishToDevTo = async (req, res) => {
  try {
    const { id } = req.params;
    const devtoApiKey = req.body?.devto_api_key || req.headers['x-devto-api-key'] || null;
    const overrides = {
      title: req.body?.title || req.body?.devto_title,
      tags: req.body?.tags || req.body?.devto_tags,
      canonical_url: req.body?.canonical_url || req.body?.devto_canonical_url,
      series: req.body?.series || req.body?.devto_series,
      description: req.body?.description || req.body?.devto_description,
      published: req.body?.published,
    };

    const publishResult = await PublishService.publishDevToOnly({
      userId: req.user.id,
      postId: id,
      overrides,
      devtoApiKey,
      req,
    });

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      message: 'Post published successfully to DEV.to',
      targets: ['devto'],
      results: publishResult.results,
      post: publishResult.post,
      data: publishResult.post,
    });
  } catch (error) {
    console.error('Publish to DEV.to error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to publish post to DEV.to',
    });
  }
};

/**
 * Publish simultaneously to both LinkedIn and DEV.to
 */
export const handlePublishToBoth = async (req, res) => {
  try {
    const { id } = req.params;
    const devtoApiKey = req.body?.devto_api_key || req.headers['x-devto-api-key'] || null;
    const overrides = {
      title: req.body?.title || req.body?.devto_title,
      tags: req.body?.tags || req.body?.devto_tags,
      canonical_url: req.body?.canonical_url || req.body?.devto_canonical_url,
      series: req.body?.series || req.body?.devto_series,
      description: req.body?.description || req.body?.devto_description,
      published: req.body?.published,
    };

    const publishResult = await PublishService.publishBoth({
      userId: req.user.id,
      postId: id,
      overrides,
      devtoApiKey,
      req,
    });

    return res.status(200).json({
      success: publishResult.success,
      partialFailure: publishResult.partialFailure,
      source: 'SUPABASE',
      message: 'Post published to both LinkedIn and DEV.to',
      targets: ['linkedin', 'devto'],
      results: publishResult.results,
      post: publishResult.post,
      data: publishResult.post,
    });
  } catch (error) {
    console.error('Publish to both platforms error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to publish post to LinkedIn and DEV.to',
    });
  }
};

/**
 * Cloudflare Worker / Cron Dispatcher Runner
 */
export const handleCronPublishQueue = async (req, res) => {
  try {
    const queryLimit = req.query?.batch_limit || req.query?.batchSize;
    const bodyLimit = req.body?.batch_limit || req.body?.batchSize;
    const target = req.query?.target || req.body?.target || 'auto';
    const batchLimit = parseInt(queryLimit || bodyLimit || '10', 10);

    lastWorkerRunAt = new Date().toISOString();

    const summary = await PublishService.processCronPublishingQueue({
      batchLimit,
      target,
    });

    return res.status(200).json({
      success: true,
      source: 'SUPABASE',
      timestamp: lastWorkerRunAt,
      cadence_minutes: 10,
      ...summary,
    });
  } catch (error) {
    console.error('Cron queue runner error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process scheduled publishing queue',
    });
  }
};
