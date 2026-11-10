'use strict';

/** یک خط لاگ برای هر درخواست، بعد از اتمام پاسخ. مسیرهای ignorePaths (مثل /health) لاگ نمی‌شوند. */
function createRequestLogger({ logger, ignorePaths = ['/health', '/health/ready'] }) {
  return function requestLogger(req, res, next) {
    if (ignorePaths.includes(req.path)) return next();

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 10) / 10;
      const level = res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](
        { method: req.method, url: req.originalUrl, status: res.statusCode, durationMs },
        'request',
      );
    });
    next();
  };
}

module.exports = { createRequestLogger };
