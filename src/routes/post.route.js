import { Router } from 'express';
import {
  handleCreatePost,
  handleGetPosts,
  handleGetPostById,
  handleUpdatePost,
  handleDeletePost,
  handleSyncLinkedInPosts,
  handleGetPostStats,
} from '../controllers/post.controller.js';
import {
  handleGetPostAnalytics,
  handleForceSyncPostAnalytics,
} from '../controllers/analytics.controller.js';
import { handlePublishPostNow, getScheduleWindow } from '../controllers/publish.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// All posts endpoints require user authentication
router.use(requireAuth);

// Summary statistics & Schedule window (must be before /:id route)
router.get('/stats', handleGetPostStats);
router.get('/schedule-window', getScheduleWindow);

// List posts & Create post
router.get('/', handleGetPosts);
router.post('/', handleCreatePost);

// Immediate publish to LinkedIn
router.post('/:id/publish-now', handlePublishPostNow);

// Single post operations
router.get('/:id', handleGetPostById);
router.put('/:id', handleUpdatePost);
router.delete('/:id', handleDeletePost);

// Post Analytics (sub-resource)
router.get('/:id/analytics', handleGetPostAnalytics);
router.post('/:id/analytics/sync', handleForceSyncPostAnalytics);

// Sync recent published posts from LinkedIn
router.post('/sync-linkedin', handleSyncLinkedInPosts);

export default router;

