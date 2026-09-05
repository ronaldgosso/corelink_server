import { Router } from 'express';
import { handleCronPublishQueue, getScheduleWindow } from '../controllers/publish.controller.js';
import { requireCronSecret } from '../middlewares/cron.middleware.js';

const router = Router();

// Public: Cloudflare Worker synchronization & next schedule window info
router.get('/schedule-window', getScheduleWindow);

// Protected: Cloudflare Worker Cron Dispatcher (Requires Bearer CRON_SECRET)
router.post('/', requireCronSecret, handleCronPublishQueue);

export default router;
