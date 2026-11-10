'use strict';

const { logger } = require('../helpers/logger');

// این مسیرها لاگ نمی‌شوند (هر چند ثانیه توسط مانیتورینگ صدا زده می‌شوند)
const IGNORED_PATHS = ['/health', '/health/ready'];

/** یک خط لاگ برای هر درخواست، بعد از اتمام پاسخ. */
function requestLogger(req, res, next) {
  if (IGNORED_PATHS.includes(req.path)) return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 10) / 10;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({ method: req.method, url: req.originalUrl, status: res.statusCode, durationMs }, 'request');
  });
  next();
}

module.exports = requestLogger;
