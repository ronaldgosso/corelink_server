import { Router } from 'express';
import {
  handleGetPostAnalytics,
  handleForceSyncPostAnalytics,
  handleGetAnalyticsOverview,
  handleSyncAllPostsAnalytics,
  handleCronSyncAnalytics,
} from '../controllers/analytics.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireCronSecret } from '../middlewares/cron.middleware.js';

const router = Router();

// Background Cron Worker Endpoint (Requires Bearer CRON_SECRET)
router.post('/cron-sync', requireCronSecret, handleCronSyncAnalytics);

// Protected User Analytics Endpoints (Requires User JWT)
router.use(requireAuth);

router.get('/overview', handleGetAnalyticsOverview);
router.post('/sync-all', handleSyncAllPostsAnalytics);
router.get('/posts/:id', handleGetPostAnalytics);
router.post('/posts/:id/sync', handleForceSyncPostAnalytics);

export default router;
