'use strict';

const crypto = require('node:crypto');
const { redis } = require('../db/redis');
const { logger } = require('../helpers/logger');
const smsService = require('./sms');

// پیامک فقط از طریق صف ردیس با کلید یکتا برای هر پیام (بخش ۵.۹ سند).
// شکست ارسال نوبت را لغو نمی‌کند. در development فقط لاگ می‌شود (سرویس پیامک بعداً معرفی می‌شود).

const QUEUE_KEY = 'sms:queue';
const SENT_KEY_PREFIX = 'sms:sent:';
const MAX_ATTEMPTS = 3; // تلاش دوباره برای پیامکی که ارسالش شکست خورده است

/** متن پیامک برای هر رویداد. */
function buildMessage(event, data = {}) {
  switch (event) {
    case 'appointment.confirmed':
      return `نوبت شما تایید شد. کد پیگیری: ${data.code ?? ''} — زمان: ${data.time ?? ''}`;
    case 'appointment.reminder':
      return `یادآوری: نوبت شما امروز ساعت ${data.time ?? ''} است.`;
    case 'appointment.delayed':
      return `زمان پیش‌بینی‌شده نوبت شما تغییر کرد: ${data.time ?? ''}`;
    case 'appointment.cancelledByShop':
      return `متاسفانه نوبت شما توسط آرایشگاه لغو شد.`;
    case 'appointment.cancelRequested':
      return `آرایشگاه درخواست لغو نوبت شما را ثبت کرده است؛ لطفاً در پنل خود پاسخ دهید.`;
    case 'appointment.cancelRequestAccepted':
      return `نوبت شما به درخواست آرایشگاه لغو شد و بیعانه به کیف پول شما برگشت.`;
    case 'appointment.cancelRequestRejected':
      return `درخواست لغو آرایشگاه رد شد؛ نوبت شما به قوت خود باقی است.`;
    case 'appointment.completed':
      return `از حضور شما متشکریم؛ لطفاً تجربه خود را در نظرسنجی ثبت کنید.`;
    case 'appointment.cancelled':
      return `نوبت شما لغو شد.`;
    case 'appointment.noShow':
      return `نوبت شما به دلیل عدم حضور لغو شد.`;
    default:
      return data.text ?? '';
  }
}

/**
 * پیامک را در صف می‌گذارد. idempotencyKey یکتا است تا پیام تکراری دوبار ارسال نشود.
 * در development فقط لاگ می‌شود و «ارسال‌شده» محسوب می‌شود.
 */
async function enqueueSms({ mobile, event, data = {}, idempotencyKey }) {
  if (!mobile) return { queued: false, reason: 'no-mobile' };
  const key = idempotencyKey ?? `${event}:${mobile}:${crypto.randomUUID()}`;
  const sentKey = `${SENT_KEY_PREFIX}${key}`;
  const already = await redis.get(sentKey);
  if (already) return { queued: false, reason: 'duplicate' };

  const message = buildMessage(event, data);
  const payload = JSON.stringify({ mobile, event, message, idempotencyKey: key, queuedAt: new Date().toISOString() });

  await redis.set(sentKey, '1', 'EX', 7 * 24 * 60 * 60);
  await redis.rpush(QUEUE_KEY, payload);
  logger.debug({ mobile, event }, 'sms queued');
  return { queued: true };
}

/**
 * پردازش یک پیام از صف. شکست ارسال، نوبت را لغو نمی‌کند؛ پیام تا ۳ بار دوباره تلاش می‌شود
 * و بعد دور ریخته می‌شود (idempotencyKey همچنان از ارسال تکراری جلوگیری می‌کند).
 */
async function processNextSms() {
  const payload = await redis.lpop(QUEUE_KEY);
  if (!payload) return null;

  let item;
  try {
    item = JSON.parse(payload);
  } catch (err) {
    logger.error({ err }, 'sms queue: invalid payload');
    return null;
  }

  try {
    await smsService.send(item.mobile, item.message);
    logger.debug({ mobile: item.mobile, event: item.event }, 'sms processed');
    return item;
  } catch (err) {
    const attempts = (item.attempts ?? 0) + 1;
    if (attempts < MAX_ATTEMPTS) {
      logger.warn({ err, attempts, event: item.event }, 'sms send failed, retrying');
      await redis.rpush(QUEUE_KEY, JSON.stringify({ ...item, attempts }));
    } else {
      logger.error({ err, attempts, event: item.event }, 'sms dropped after retries');
    }
    return { ...item, failed: true, attempts };
  }
}

module.exports = { enqueueSms, processNextSms, buildMessage, QUEUE_KEY };
