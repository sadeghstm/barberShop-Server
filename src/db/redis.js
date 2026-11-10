'use strict';

const Redis = require('ioredis');
const { config } = require('../config');
const { logger } = require('../helpers/logger');

const STARTUP_TIMEOUT_MS = 10000;

// یک کلاینت مشترک برای کل برنامه:  const { redis } = require('../db/redis')
const redis = new Redis(config.redisUrl, {
  lazyConnect: true, // تا وقتی connectRedis() صدا نزنیم وصل نمی‌شود
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => logger.error({ err }, 'redis error'));
redis.on('reconnecting', () => logger.warn('redis reconnecting'));
redis.on('ready', () => logger.info('redis ready'));

/**
 * اگر در شروع برنامه تا ۱۰ ثانیه وصل نشد خطا می‌دهد (وگرنه ioredis بی‌نهایت تلاش می‌کند
 * و برنامه بی‌صدا معلق می‌ماند). بعد از اتصال، قطع‌وصل‌های موقت خودکار بازیابی می‌شوند.
 */
async function connectRedis() {
  let timer;
  try {
    await Promise.race([
      redis.connect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis connect timeout')), STARTUP_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    redis.disconnect();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function pingRedis() {
  return (await redis.ping()) === 'PONG';
}

async function closeRedis() {
  if (redis.status === 'end') return;
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

module.exports = { redis, connectRedis, pingRedis, closeRedis };
