import { PublishService } from './publish.service.js';

class SchedulerService {
  constructor() {
    this.intervalHandle = null;
    this.isProcessing = false;
    this.intervalMs = 30000; // 30 seconds
  }

  start(intervalMs = 30000) {
    if (this.intervalHandle) {
      return;
    }

    this.intervalMs = intervalMs;
    console.log(`[SCHEDULER] Background post scheduler initialized (interval: ${this.intervalMs / 1000}s)`);

    // Run initial scan 2 seconds after boot
    setTimeout(() => this.runQueue(), 2000);

    // Set recurring timer
    this.intervalHandle = setInterval(() => {
      this.runQueue();
    }, this.intervalMs);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[SCHEDULER] Background post scheduler stopped');
    }
  }

  async runQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      const summary = await PublishService.processCronPublishingQueue({
        batchLimit: 10,
      });

      if (summary && summary.totalClaimed > 0) {
        console.log(`[SCHEDULER] Processed scheduled posts: ${summary.succeeded} published, ${summary.failed} failed (${summary.totalClaimed} total claimed)`);
      }
    } catch (err) {
      console.error('[SCHEDULER] Error processing publishing queue:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }
}

export const schedulerService = new SchedulerService();
