import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env.js';
import apiRouter from './routes/index.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';

const app = express();

// Trust reverse proxies (Vercel / Cloudflare) to ensure req.protocol is https
app.set('trust proxy', 1);

// Security HTTP headers
app.use(helmet());

// Parse CORS allowed origins from config (comma-separated string or '*')
const parseCorsOrigins = (corsConfig) => {
  if (!corsConfig || corsConfig === '*') {
    return '*';
  }
  const origins = corsConfig
    .split(',')
    .map((origin) => origin.replace(/['"]/g, '').trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : '*';
};

const allowedOrigins = parseCorsOrigins(config.corsOrigin);

// CORS configuration - supports React web apps (localhost & production)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // If configured to allow all origins, reflect incoming origin for credentials compatibility
      if (allowedOrigins === '*') {
        return callback(null, true);
      }

      // Check if incoming origin matches any allowed origin
      if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Origin not allowed
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'x-timezone-offset',
      'X-Timezone-Offset',
      'x-client-platform',
      'X-Client-Platform',
    ],
    exposedHeaders: ['x-timezone-offset', 'X-Timezone-Offset'],
  })
);

// Favicon handler (avoids 404 / 500 on browser icon requests)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// HTTP request logging
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));

// Body parser (50mb limit to support image & video uploads)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static public assets (brand logo, favicon)
app.use(express.static('public'));

// Root welcome route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Corelink Server API',
    docs: '/api/health',
  });
});

// API Routes
app.use(config.apiPrefix, apiRouter);

// 404 handler
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

export default app;
