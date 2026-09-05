import app from './src/app.js';
import { config } from './src/config/env.js';
import { schedulerService } from './src/services/scheduler.service.js';

const server = app.listen(config.port, () => {
  console.log(`🚀 Corelink Server is running on port ${config.port} in ${config.nodeEnv} mode`);
  console.log(`👉 Health check: http://localhost:${config.port}${config.apiPrefix}/health`);

  // Start background post scheduler (runs every 30s)
  schedulerService.start(30000);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  schedulerService.stop();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Forcing shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

