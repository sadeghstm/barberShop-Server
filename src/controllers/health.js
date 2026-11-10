'use strict';

const { runHealthChecks } = require('../helpers/health');
const { pingMongo } = require('../db/mongo');
const { pingRedis } = require('../db/redis');

/** GET /health — فرایند زنده است (وابستگی‌ها بررسی نمی‌شوند) */
exports.live = (req, res) => {
  res.json({ status: 'ok' });
};

/** GET /health/ready — مونگو و ردیس سالم‌اند؛ اگر یکی down باشد ۵۰۳ */
exports.ready = async (req, res) => {
  const { healthy, checks } = await runHealthChecks({ mongo: pingMongo, redis: pingRedis });
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
};
