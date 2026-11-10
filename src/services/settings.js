'use strict';

const Settings = require('../models/Settings');

const DEFAULTS = Object.freeze({
  key: 'global',
  depositPercent: 15, // ۵.۶
  noShowGraceMinutes: 5, // ۵.۳
  minBookingLeadMinutes: 15, // ۵.۱
  holdMinutes: 10, // ۵.۱
  delayNotifyThresholdMinutes: 10, // ۵.۴
  cancelRefundHoursBefore: 2, // ۵.۶
  referralCommissionPercent: 0, // ۵.۷ — سوپر ادمین تعیین می‌کند
});

/** تنظیمات سراسری را برمی‌گرداند؛ اگر سندی نبود با پیش‌فرض‌های سند ساخته می‌شود. */
async function getGlobalSettings() {
  let doc = await Settings.findOne({ key: 'global' });
  if (!doc) {
    doc = await Settings.create({ ...DEFAULTS });
  }
  return doc;
}

/** فقط فیلدهای مجاز را به‌روز می‌کند (فراخواننده باید نقش سوپر ادمین را بررسی کرده باشد). */
async function updateGlobalSettings(patch) {
  const allowed = Object.keys(DEFAULTS).filter((k) => k !== 'key');
  const $set = {};
  for (const key of allowed) {
    if (patch && patch[key] !== undefined) $set[key] = patch[key];
  }
  const doc = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $set },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc;
}

module.exports = { getGlobalSettings, updateGlobalSettings, DEFAULTS };
