import { Router } from 'express';
import healthRoutes from './health.route.js';
import authRoutes from './auth.route.js';
import aiRoutes from './ai.route.js';
import postRoutes from './post.route.js';
import publishRoutes from './publish.route.js';

const router = Router();

// Mount individual route modules
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/generate', aiRoutes);
router.use('/posts', postRoutes);
router.use('/publish', publishRoutes);

export default router;
