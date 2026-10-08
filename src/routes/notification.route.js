import { Router } from 'express';
import {
  handleRegisterDeviceToken,
  handleUnregisterDeviceToken,
  handleGetNotificationStatus,
} from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Push notification endpoints require authentication
router.use(requireAuth);

router.post('/register-token', handleRegisterDeviceToken);
router.post('/unregister-token', handleUnregisterDeviceToken);
router.get('/status', handleGetNotificationStatus);

export default router;
