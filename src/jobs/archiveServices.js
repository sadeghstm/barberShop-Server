'use strict';

const catalogService = require('../services/catalog');
const { every } = require('./every');

/** هر دقیقه خدمت‌های «در حال حذف» که نوبتشان تمام شده را «آرشیو» می‌کند (۵.۵ سند). */
function startArchiveServicesJob({ intervalMs = 60 * 1000 } = {}) {
  return every('archiveServices', intervalMs, () => catalogService.archiveFinished());
}

module.exports = { startArchiveServicesJob };
