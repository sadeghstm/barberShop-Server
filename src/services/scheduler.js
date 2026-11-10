'use strict';

// کارهای دوره‌ای (بخش ۵.۱ و ۵.۳): انقضای نگه‌داشتن موقت، عدم حضور خودکار، ارسال صف پیامک.
// در یک پروسه ساده اجرا می‌شود؛ اگر چند نمونه از سرور بالا بیاید، عملیات به‌خاطر idempotency
// (وضعیت نوبت و کلید یکتای پیامک) دوبار اثر نمی‌گذارد.

const { logger } = require('../helpers/logger');
const appointmentService = require('./appointment');
const smsQueue = require('./smsQueue');

const TICK_MS = 30_000;
let timer = null;
let running = false;

async function tick() {
  if (running) return; // تیک قبلی هنوز تمام نشده
  running = true;
  try {
    const expired = await appointmentService.expireHolds();
    if (expired > 0) logger.info({ expired }, 'holds expired');

    const noShows = await appointmentService.markNoShows();
    if (noShows > 0) logger.info({ noShows }, 'appointments marked as noShow');

    // یادآوری یک ساعت قبل (کلید یکتای پیامک جلوی تکرار را می‌گیرد)
    const reminders = await appointmentService.sendDueReminders();
    if (reminders > 0) logger.info({ reminders }, 'reminder sms queued');

    // حداکثر ۲۰ پیام در هر تیک تا صف گرسنه نشود
    for (let i = 0; i < 20; i += 1) {
      const item = await smsQueue.processNextSms();
      if (!item) break;
    }
  } catch (err) {
    logger.error({ err }, 'scheduler tick failed');
  } finally {
    running = false;
  }
}

function start({ intervalMs = TICK_MS } = {}) {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  logger.info({ intervalMs }, 'scheduler started');
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('scheduler stopped');
}

module.exports = { start, stop, tick };
