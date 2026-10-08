import { Router } from 'express';
import healthRoutes from './health.route.js';
import authRoutes from './auth.route.js';
import aiRoutes from './ai.route.js';
import postRoutes from './post.route.js';
import publishRoutes from './publish.route.js';
import mediaRoutes from './media.route.js';
import analyticsRoutes from './analytics.routes.js';
import devtoRoutes from './devto.route.js';
import notificationRoutes from './notification.route.js';

const router = Router();

// Mount individual route modules
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/generate', aiRoutes);
router.use('/posts', postRoutes);
router.use('/publish', publishRoutes);
router.use('/media', mediaRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/devto', devtoRoutes);
router.use('/notifications', notificationRoutes);

export default router;

