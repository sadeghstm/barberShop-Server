'use strict';

const crypto = require('node:crypto');
const { redis } = require('../db/redis');
const { logger } = require('../helpers/logger');

// پیامک فقط از طریق صف ردیس با کلید یکتا برای هر پیام (بخش ۵.۹ سند).
// شکست ارسال نوبت را لغو نمی‌کند. در development فقط لاگ می‌شود (سرویس پیامک بعداً معرفی می‌شود).

const QUEUE_KEY = 'sms:queue';
const SENT_KEY_PREFIX = 'sms:sent:';

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

/** پردازش یک پیام از صف (در production به سرویس پیامک وصل می‌شود؛ فعلاً لاگ). */
async function processNextSms() {
  const payload = await redis.lpop(QUEUE_KEY);
  if (!payload) return null;
  try {
    const item = JSON.parse(payload);
    logger.info({ mobile: item.mobile, event: item.event }, 'sms send (mock)');
    return item;
  } catch (err) {
    logger.error({ err }, 'sms queue: invalid payload');
    return null;
  }
}

module.exports = { enqueueSms, processNextSms, buildMessage, QUEUE_KEY };
