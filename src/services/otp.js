'use strict';

const crypto = require('node:crypto');
const { config } = require('../config');
const { redis } = require('../db/redis');
const { AppError } = require('../helpers/AppError');
const sms = require('./sms');

// از .env خوانده می‌شود (رشته است، پس عدد می‌شود)؛ اگر نبود مقدار پیش‌فرض
const CODE_TTL_SECONDS = Number(process.env.CODE_TTL_SECONDS) || 120; // اعتبار کد
const COOLDOWN_SECONDS = Number(process.env.COOLDOWN_SECONDS) || 60; // فاصله بین دو درخواست کد
const MAX_TRIES = Number(process.env.MAX_TRIES) || 5; // حدس‌های نادرست مجاز برای هر کد

const keys = (mobile) => ({
  code: `otp:code:${mobile}`,
  tries: `otp:tries:${mobile}`,
  cooldown: `otp:cooldown:${mobile}`,
});

// کد خام در ردیس ذخیره نمی‌شود، فقط هش آن
const hash = (code) => crypto.createHash('sha256').update(String(code)).digest();

// در development کد ثابت است (config.devOtpCode)، در production تصادفی
const generateCode = () => config.devOtpCode ?? String(crypto.randomInt(10000, 100000));

/** کد تایید را می‌سازد و پیامک می‌کند. */
async function send(mobile) {
  const k = keys(mobile);

  // NX: فقط اگر کلید نبود ساخته می‌شود؛ دو درخواست هم‌زمان هر دو عبور نمی‌کنند
  const acquired = await redis.set(k.cooldown, '1', 'EX', COOLDOWN_SECONDS, 'NX');
  if (!acquired) {
    const wait = Math.max(await redis.ttl(k.cooldown), 1);
    throw AppError.tooManyRequests(`لطفاً ${wait} ثانیه دیگر دوباره تلاش کنید`);
  }

  const code = generateCode();
  await redis.set(k.code, hash(code).toString('hex'), 'EX', CODE_TTL_SECONDS);
  await redis.del(k.tries);

  try {
    await sms.sendOtp(mobile, code);
  } catch (err) {
    await redis.del(k.code, k.cooldown); // کاربر بتواند فوراً دوباره امتحان کند
    throw new AppError('ارسال پیامک ناموفق بود', { statusCode: 502, code: 'SMS_FAILED', cause: err });
  }
  return { expiresInSeconds: CODE_TTL_SECONDS };
}

/** کد را بررسی می‌کند؛ اگر درست بود مصرف می‌شود (یک‌بار مصرف). نادرست → خطا. */
async function verify(mobile, code) {
  const k = keys(mobile);

  const tries = await redis.incr(k.tries);
  if (tries === 1) await redis.expire(k.tries, CODE_TTL_SECONDS);
  if (tries > MAX_TRIES) {
    await redis.del(k.code);
    throw AppError.tooManyRequests('تعداد تلاش‌ها زیاد بود؛ کد جدید بگیرید');
  }

  const stored = await redis.get(k.code);
  if (!stored) throw AppError.badRequest('کد منقضی شده یا درخواست نشده است');

  if (!crypto.timingSafeEqual(Buffer.from(stored, 'hex'), hash(code))) {
    throw AppError.badRequest('کد نادرست است');
  }
  await redis.del(k.code, k.tries);
}

module.exports = { send, verify, CODE_TTL_SECONDS, COOLDOWN_SECONDS, MAX_TRIES };