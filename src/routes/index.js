import { Router } from 'express';
import healthRoutes from './health.route.js';

const router = Router();

// Mount individual route modules
router.use('/health', healthRoutes);

export default router;
