'use strict';

const visitService = require('../services/visit');
const { every } = require('./every');

/** هر ۳۰ ثانیه نوبت‌هایی که مهلت حاضر شدنشان گذشته را «عدم حضور» می‌کند (۵.۳ سند). */
function startMarkNoShowsJob({ intervalMs = 30 * 1000 } = {}) {
  return every('markNoShows', intervalMs, () => visitService.autoNoShow());
}

module.exports = { startMarkNoShowsJob };
