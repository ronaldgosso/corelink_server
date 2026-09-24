import { Router } from "express";
import {
  handleLinkedInExchangeJSON,
  handleMobileLinkedInDeepLinkCallback,
  handleGetMe,
  handleDisconnect,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

// NOTE: LinkedIn auth has two separate completion paths by design:
// one for the web app (JSON response, POST) and one for the mobile
// app (HTML page + custom URL scheme redirect, GET). Do not merge
// these or point the web frontend's redirect_uri at the GET route.

// Public: Code exchange for clients that handle the redirect themselves
// (web SPA - call this directly with { code, redirectUri })
router.post("/linkedin", handleLinkedInExchangeJSON);

// Public: Browser OAuth redirect callback - MOBILE APP ONLY.
// Success redirects via a corelink:// deep link; do not point the
// web app's redirect_uri here.
router.get("/linkedin/callback", handleMobileLinkedInDeepLinkCallback);
router.get("/callback", handleMobileLinkedInDeepLinkCallback);

// Protected: Get current authenticated profile
router.get("/me", requireAuth, handleGetMe);

// Protected: Disconnect LinkedIn session
router.post("/disconnect", requireAuth, handleDisconnect);

export default router;
