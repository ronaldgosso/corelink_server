import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Corelink Server is healthy and running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
