'use strict';

const Settings = require('../models/Settings');

const DUPLICATE_KEY = 11000;

/** تنظیمات سراسری (سند یکتا با key='global'). اگر هنوز ساخته نشده، با مقدارهای پیش‌فرض ساخته می‌شود. */
async function get() {
  const found = await Settings.findOne({ key: 'global' });
  if (found) return found;
  try {
    return await Settings.create({ key: 'global' });
  } catch (err) {
    if (err.code === DUPLICATE_KEY) return Settings.findOne({ key: 'global' }); // درخواست هم‌زمان دیگری ساخت
    throw err;
  }
}

module.exports = { get };
