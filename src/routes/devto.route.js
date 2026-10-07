import { Router } from 'express';
import {
  handleCreateDevToArticle,
  handleGetDevToArticles,
  handleGetDevToArticleById,
  handleUpdateDevToArticle,
  handleGetDevToProfile,
  handleCrossPostToDevTo,
} from '../controllers/devto.controller.js';
import { requireAuth, optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Verify DEV.to API key & profile
router.get('/me', optionalAuth, handleGetDevToProfile);

// List user articles on DEV.to
router.get('/articles', optionalAuth, handleGetDevToArticles);

// Create / Publish an article directly to DEV.to
router.post('/articles', optionalAuth, handleCreateDevToArticle);
router.post('/publish', optionalAuth, handleCreateDevToArticle);

// Get single DEV.to article by ID
router.get('/articles/:id', optionalAuth, handleGetDevToArticleById);

// Update existing DEV.to article
router.put('/articles/:id', optionalAuth, handleUpdateDevToArticle);

// Cross-post an existing CoreLink post to DEV.to (requires Corelink authentication)
router.post('/crosspost/:id', requireAuth, handleCrossPostToDevTo);

export default router;
