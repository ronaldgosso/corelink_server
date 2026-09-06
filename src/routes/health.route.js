import { Router } from 'express';
import { redisService } from '../services/redis.service.js';

const router = Router();

router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Corelink Server is healthy and running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    source: redisService.isAvailable() ? 'REDIS' : 'SYSTEM',
    redis: redisService.getStatus(),
  });
});

export default router;
