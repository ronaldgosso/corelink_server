import { Router } from 'express';
import { handleGeneratePost, handleOptimizeHook, handleGetAiQuota } from '../controllers/ai.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { checkAiRateLimit } from '../middlewares/aiRateLimiter.js';

const router = Router();

// Protected: Get current daily AI quota & reset status
router.get('/quota', requireAuth, handleGetAiQuota);

// Protected: Generate draft using AI (Enforces 10 calls/day resetting at local midnight)
router.post('/', requireAuth, checkAiRateLimit, handleGeneratePost);

// Protected: Optimize viral hooks (Enforces 10 calls/day resetting at local midnight)
router.post('/optimize-hook', requireAuth, checkAiRateLimit, handleOptimizeHook);

export default router;
