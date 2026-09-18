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

// CORS configuration - supports React web apps (localhost & production)
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  })
);

// HTTP request logging
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));

// Body parser (50mb limit to support image & video uploads)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
