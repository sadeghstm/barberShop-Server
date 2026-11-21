'use strict';

const crypto = require('node:crypto');
const { redis } = require('../db/redis');
const { logger } = require('../helpers/logger');
const { AppError } = require('../helpers/AppError');

// کلید را فقط اگر هنوز مال خودمان است پاک کن (اگر قفل منقضی شده و دیگری گرفته، به آن دست نزن)
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * work را زیر یک قفل کوتاه اجرا می‌کند؛ هر کلید فقط یک اجراکننده دارد.
 *   await withLock(`lock:booking:${barberId}:${dayKey}`, async () => { ... })
 *
 * - ttlMs: اگر کار گیر کرد، قفل خودش بعد از این مدت آزاد می‌شود (قفل برای همیشه نمی‌ماند).
 * - waitMs: تا چه مدت برای گرفتن قفل صبر کنیم؛ بعدش ۴۲۹.
 * قفل به‌تنهایی کافی نیست (اگر work از ttl طولانی‌تر شود): سدهای یکتا روی ایندکس نوبت‌ها پشتیبان‌اند.
 */
async function withLock(key, work, { ttlMs = 5000, waitMs = 3000, retryMs = 40 } = {}) {
  const token = crypto.randomUUID();
  const deadline = Date.now() + waitMs;

  while ((await redis.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') {
    if (Date.now() >= deadline) throw AppError.tooManyRequests('درخواست هم‌زمان زیاد است؛ چند لحظه بعد دوباره تلاش کنید');
    await sleep(retryMs);
  }

  try {
    return await work();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token).catch((err) => logger.warn({ err, key }, 'lock release failed'));
  }
}

module.exports = { withLock };
