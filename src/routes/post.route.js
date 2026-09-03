import { Router } from 'express';
import {
  handleCreatePost,
  handleGetPosts,
  handleGetPostById,
  handleUpdatePost,
  handleDeletePost,
  handleGetPostStats,
} from '../controllers/post.controller.js';
import { handlePublishPostNow } from '../controllers/publish.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// All posts endpoints require user authentication
router.use(requireAuth);

// Summary statistics (must be before /:id route)
router.get('/stats', handleGetPostStats);

// List posts & Create post
router.get('/', handleGetPosts);
router.post('/', handleCreatePost);

// Immediate publish to LinkedIn
router.post('/:id/publish-now', handlePublishPostNow);

// Single post operations
router.get('/:id', handleGetPostById);
router.put('/:id', handleUpdatePost);
router.delete('/:id', handleDeletePost);

export default router;
