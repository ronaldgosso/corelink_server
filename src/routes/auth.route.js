import { Router } from "express";
import {
  handleLinkedInExchange,
  handleLinkedInCallback,
  handleGetLinkedInAuthUrl,
  handleLinkedInLoginRedirect,
  handleDevLogin,
  handleGetMe,
  handleDisconnect,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// Public: React Web App helper to get LinkedIn OAuth authorization URL
router.get('/linkedin/url', handleGetLinkedInAuthUrl);

// Public: React Web App direct 302 redirect to LinkedIn OAuth login
router.get('/linkedin/login', handleLinkedInLoginRedirect);

// Public: Developer test login for local web development
router.post('/dev-login', handleDevLogin);

// Public: Browser OAuth redirect callback from LinkedIn (supports Web & Mobile)
router.get('/linkedin/callback', handleLinkedInCallback);
router.get('/callback', handleLinkedInCallback);

// Public: Direct code exchange (mobile app POST & React SPA POST)
router.post('/linkedin', handleLinkedInExchange);

// Protected: Get current authenticated profile
router.get("/me", requireAuth, handleGetMe);

// Protected: Disconnect LinkedIn session
router.post("/disconnect", requireAuth, handleDisconnect);

export default router;
