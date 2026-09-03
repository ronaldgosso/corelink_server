import { Router } from 'express';
import { handleCronPublishQueue } from '../controllers/publish.controller.js';
import { requireCronSecret } from '../middlewares/cron.middleware.js';

const router = Router();

// Protected: Cloudflare Worker Cron Dispatcher (Requires Bearer CRON_SECRET)
router.post('/', requireCronSecret, handleCronPublishQueue);

export default router;
