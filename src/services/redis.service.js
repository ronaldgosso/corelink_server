import { Redis as UpstashRedis } from '@upstash/redis';
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
    this.type = 'none'; // 'upstash' | 'ioredis' | 'none'
    this.client = null;
    this.hasWarned = false;
    this._init();
  }

  _init() {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || config.redis?.upstashUrl;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || config.redis?.upstashToken;
    const redisUrl = process.env.REDIS_URL || config.redis?.url;

    // 1. Prefer native Upstash REST client (ideal for Vercel serverless / Edge functions)
    if (upstashUrl && upstashToken) {
      try {
        this.client = new UpstashRedis({
          url: upstashUrl,
          token: upstashToken,
        });
        this.type = 'upstash';
        console.log('[REDIS] Initialized native Upstash REST client.');
        return;
      } catch (err) {
        console.warn(`[UPSTASH WARNING] Initialization error: ${err.message}`);
      }
    }

    // 2. Fall back to standard Redis / ioredis connection string
    if (redisUrl) {
      try {
        this.client = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          enableOfflineQueue: false,
          tls: redisUrl.startsWith('rediss://') ? {} : undefined,
          retryStrategy(times) {
            if (times > 3) return null;
            return Math.min(times * 500, 2000);
          },
        });

        this.client.on('connect', () => {
          this.type = 'ioredis';
          console.log('[REDIS] Connected to Redis instance via TCP/TLS.');
        });

        this.client.on('error', (err) => {
          if (!this.hasWarned) {
            console.warn(`[REDIS WARNING] Connection error (${err.message}). Bypassing cache.`);
            this.hasWarned = true;
          }
        });
        return;
      } catch (err) {
        console.warn(`[REDIS INIT WARNING] Failed to initialize ioredis: ${err.message}`);
      }
    }

    if (!this.hasWarned) {
      console.log('[REDIS] No Upstash or REDIS_URL configured. Caching layer is operating in bypass mode.');
      this.hasWarned = true;
    }
  }

  isAvailable() {
    if (this.type === 'upstash') return Boolean(this.client);
    if (this.type === 'ioredis') return Boolean(this.client && this.client.status === 'ready');
    return false;
  }

  getStatus() {
    if (this.type === 'upstash') return 'connected (Upstash REST)';
    if (this.type === 'ioredis') return 'connected (TCP/TLS)';
    return 'unconfigured';
  }

  async get(key) {
    if (!this.isAvailable()) return null;
    try {
      if (this.type === 'upstash') {
        const data = await this.client.get(key);
        if (!data) return null;
        return typeof data === 'string' ? JSON.parse(data) : data;
      } else {
        const data = await this.client.get(key);
        if (!data) return null;
        return JSON.parse(data);
      }
    } catch {
      return null;
    }
  }

  async set(key, value, ttlSeconds = TTL.POSTS_LIST) {
    if (!this.isAvailable()) return false;
    try {
      if (this.type === 'upstash') {
        if (ttlSeconds && ttlSeconds > 0) {
          await this.client.set(key, value, { ex: ttlSeconds });
        } else {
          await this.client.set(key, value);
        }
        return true;
      } else {
        const serialized = JSON.stringify(value);
        if (ttlSeconds && ttlSeconds > 0) {
          await this.client.set(key, serialized, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, serialized);
        }
        return true;
      }
    } catch {
      return false;
    }
  }

  async del(key) {
    if (!this.isAvailable()) return false;
    try {
      await this.client.del(key);
      return true;
    } catch {
      return false;
    }
  }

  async delPattern(pattern) {
    if (!this.isAvailable()) return false;
    try {
      if (this.type === 'upstash') {
        let cursor = 0;
        do {
          const [nextCursor, keys] = await this.client.scan(cursor, { match: pattern, count: 50 });
          cursor = nextCursor;
          if (keys && keys.length > 0) {
            await this.client.del(...keys);
          }
        } while (cursor !== 0 && cursor !== '0');
        return true;
      } else {
        const stream = this.client.scanStream({ match: pattern, count: 50 });
        stream.on('data', async (keys) => {
          if (keys.length > 0) {
            const pipeline = this.client.pipeline();
            keys.forEach((k) => pipeline.del(k));
            await pipeline.exec();
          }
        });
        return true;
      }
    } catch {
      return false;
    }
  }
}

export const redisService = new RedisService();
