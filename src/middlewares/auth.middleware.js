import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * JWT Authentication Middleware
 * Validates the Bearer token and attaches user profile to req.user
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing or malformed Bearer token',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.security.jwtSecret);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid token payload',
      });
    }

    // Attach basic claims from token immediately
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      linkedinMemberId: decoded.linkedinMemberId,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Session token has expired',
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid authentication token',
    });
  }
};

/**
 * Optional Authentication Middleware
 * Attaches user profile if valid Bearer token is provided, otherwise continues
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, config.security.jwtSecret);
      if (decoded && decoded.userId) {
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          name: decoded.name,
          linkedinMemberId: decoded.linkedinMemberId,
        };
      }
    }
  } catch {
    // Silently continue for optional auth
  }
  next();
};

