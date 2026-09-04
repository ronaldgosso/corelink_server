import { Router } from 'express';
import { handleUploadMedia } from '../controllers/media.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Upload endpoint for images and videos to LinkedIn
router.post('/upload', requireAuth, handleUploadMedia);

export default router;
