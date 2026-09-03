import { Router } from 'express';
import {
  handleLinkedInExchange,
  handleLinkedInCallback,
  handleGetMe,
  handleDisconnect,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Public: Browser OAuth redirect callback from LinkedIn
router.get('/linkedin/callback', handleLinkedInCallback);
router.get('/callback', handleLinkedInCallback);

// Public: Direct code exchange (mobile app POST)
router.post('/linkedin', handleLinkedInExchange);

// Protected: Get current authenticated profile
router.get('/me', requireAuth, handleGetMe);

// Protected: Disconnect LinkedIn session
router.post('/disconnect', requireAuth, handleDisconnect);

export default router;
