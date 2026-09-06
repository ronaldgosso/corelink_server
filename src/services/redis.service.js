import Redis from 'ioredis';
import { config } from '../config/env.js';

/**
 * Explicit TTL durations (in seconds) tailored for each endpoint
 */
export const TTL = {
  USER_PROFILE: 900,     // 15 minutes: User LinkedIn OAuth profile rarely changes
  POSTS_LIST: 180,       // 3 minutes: Feeds & schedule listings
  POST_DETAIL: 600,      // 10 minutes: Single post views
  POST_STATS: 300,       // 5 minutes: Aggregate metrics & counters
  AI_QUOTA_ACTIVE: 60,   // 1 minute: Absorbs rapid screen rebuilds while fresh
  SCHEDULE_WINDOW: 30,   // 30 seconds: Near-real-time schedule window sync
};

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.hasWarned = false;
    this._init();
  }

  _init() {
    const redisUrl = process.env.REDIS_URL || config.redis?.url;

    if (!redisUrl) {
      if (!this.hasWarned) {
        console.log('[REDIS] REDIS_URL not configured. Caching layer is operating in bypass mode.');
        this.hasWarned = true;
      }
      return;
    }

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        enableOfflineQueue: false,
        retryStrategy(times) {
          if (times > 3) return null; // Stop retrying after 3 attempts to prevent log spam
          return Math.min(times * 500, 2000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('[REDIS] Connected to Redis instance successfully.');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        if (!this.hasWarned) {
          console.warn(`[REDIS WARNING] Connection error (${err.message}). Bypassing cache.`);
          this.hasWarned = true;
        }
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });
    } catch (err) {
      console.warn(`[REDIS INIT WARNING] Failed to initialize client: ${err.message}`);
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Check if Redis is actively ready to receive commands
   */
  isAvailable() {
    return Boolean(this.client && this.isConnected);
  }

  /**
   * Diagnostic status string
   */
  getStatus() {
    if (!process.env.REDIS_URL && !config.redis?.url) return 'unconfigured';
    return this.isConnected ? 'connected' : 'disconnected';
  }

  /**
   * Fetch cached JSON object
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    if (!this.isAvailable()) return null;
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err) {
      return null;
    }
  }

  /**
   * Store value as JSON with explicit TTL
   * @param {string} key
   * @param {any} value
   * @param {number} ttlSeconds
   * @returns {Promise<boolean>}
   */
  async set(key, value, ttlSeconds = TTL.POSTS_LIST) {
    if (!this.isAvailable()) return false;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Delete specific key
   * @param {string} key
   */
  async del(key) {
    if (!this.isAvailable()) return false;
    try {
      await this.client.del(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate all keys matching pattern (using non-blocking SCAN)
   * @param {string} pattern e.g. "cache:posts:USER_ID:*"
   */
  async delPattern(pattern) {
    if (!this.isAvailable()) return false;
    try {
      const stream = this.client.scanStream({
        match: pattern,
        count: 50,
      });

      stream.on('data', async (keys) => {
        if (keys.length > 0) {
          const pipeline = this.client.pipeline();
          keys.forEach((k) => pipeline.del(k));
          await pipeline.exec();
        }
      });

      return true;
    } catch {
      return false;
    }
  }
}

export const redisService = new RedisService();
