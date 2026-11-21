'use strict';

const { logger } = require('../helpers/logger');

/**
 * کار دوره‌ای: هر intervalMs ثانیه task را اجرا می‌کند. تابع توقف را برمی‌گرداند (برای خاموشی تمیز).
 * اگر اجرای قبلی هنوز تمام نشده، اجرای تازه شروع نمی‌شود. خطا فقط لاگ می‌شود و کار دوره‌ای ادامه دارد.
 * task عددی (تعداد کار انجام‌شده) برمی‌گرداند که اگر مثبت بود لاگ می‌شود.
 */
function every(name, intervalMs, task) {
  let running = false;

  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const count = await task();
      if (count > 0) logger.info({ job: name, count }, 'job done');
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}

module.exports = { every };
