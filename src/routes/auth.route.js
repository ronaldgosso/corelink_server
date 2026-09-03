import { Router } from 'express';
import {
  handleLinkedInExchange,
  handleGetMe,
  handleDisconnect,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Public: Exchange LinkedIn OAuth Authorization Code
router.post('/linkedin', handleLinkedInExchange);

// Protected: Get current authenticated profile
router.get('/me', requireAuth, handleGetMe);

// Protected: Disconnect LinkedIn session
router.post('/disconnect', requireAuth, handleDisconnect);

export default router;
