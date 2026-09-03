import { Router } from 'express';
import { handleGeneratePost, handleOptimizeHook } from '../controllers/ai.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Protected: Generate draft using Mistral AI
router.post('/', requireAuth, handleGeneratePost);

// Protected: Optimize viral hooks
router.post('/optimize-hook', requireAuth, handleOptimizeHook);

export default router;
