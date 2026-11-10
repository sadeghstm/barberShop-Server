'use strict';

const User = require('../models/User');

const DUPLICATE_KEY = 11000;

/** کاربر این موبایل را برمی‌گرداند؛ اگر نبود می‌سازد (ثبت‌نام و ورود یکی است). */
async function findOrCreateByMobile(mobile) {
  const existing = await User.findOne({ mobile });
  if (existing) return { user: existing, isNew: false };

  try {
    return { user: await User.create({ mobile }), isNew: true };
  } catch (err) {
    // دو درخواست هم‌زمان برای یک شماره: دومی به کاربر ساخته‌شده می‌رسد
    if (err.code !== DUPLICATE_KEY) throw err;
    return { user: await User.findOne({ mobile }), isNew: false };
  }
}

module.exports = { findOrCreateByMobile };
