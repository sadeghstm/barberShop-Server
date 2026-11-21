'use strict';

const appointmentService = require('../services/appointment');
const { every } = require('./every');

/** هر ۳۰ ثانیه موقت‌های مهلت‌گذشته را «منقضی» می‌کند. تابع توقف را برمی‌گرداند. */
function startExpireHoldsJob({ intervalMs = 30 * 1000 } = {}) {
  return every('expireHolds', intervalMs, () => appointmentService.expireStale());
}

module.exports = { startExpireHoldsJob };
