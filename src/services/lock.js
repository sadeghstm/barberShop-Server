'use strict';

const crypto = require('node:crypto');
const { redis } = require('../db/redis');
const { AppError } = require('../helpers/AppError');

// قفل کوتاه ردیس برای رزرو (بخش ۳ب و ۵.۱ سند): فقط چند ثانیه گرفته می‌شود.
// کلید به ازای «آرایشگر + روز» است تا رزروهای روزهای دیگر هم‌زمان مسدود نشوند.
// آزادسازی با اسکریپت Lua انجام می‌شود تا فقط صاحب قفل بتواند آن را آزاد کند.

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const lockKey = (barberId, dayKey) => `lock:booking:${barberId}:${dayKey}`;

/**
 * قفل را می‌گیرد و یک تابع release برمی‌گرداند.
 * اگر قفل گرفته نشد AppError با 409 پرتاب می‌شود (فرانت می‌تواند دوباره تلاش کند).
 */
async function acquireBookingLock(barberId, dayKey, { ttlMs = 10_000 } = {}) {
  const key = lockKey(barberId, dayKey);
  const token = crypto.randomBytes(16).toString('hex');
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (!acquired) {
    throw AppError.conflict('در حال پردازش رزرو دیگری برای این آرایشگر است؛ کمی بعد دوباره تلاش کنید', {
      code: 'BOOKING_LOCKED',
    });
  }
  let released = false;
  return async function release() {
    if (released) return;
    released = true;
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch {
      // اگر ردیس قطع شد، قفل با TTL خودش منقضی می‌شود؛ خطا را قورت می‌دهیم
    }
  };
}

/** اجرای یک تابع داخل قفل رزرو (قفل همیشه آزاد می‌شود). */
async function withBookingLock(barberId, dayKey, fn, opts) {
  const release = await acquireBookingLock(barberId, dayKey, opts);
  try {
    return await fn();
  } finally {
    await release();
  }
}

module.exports = { acquireBookingLock, withBookingLock, lockKey };
