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

/** به‌روزرسانی نام نمایشی کاربر (فقط نام؛ موبایل قابل تغییر نیست). */
async function updateProfile({ userId, name }) {
  const User = require('../models/User');
  const { AppError } = require('../helpers/AppError');
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد');
  if (name !== undefined) {
    const trimmed = String(name ?? '').trim();
    if (trimmed.length > 80) throw AppError.validation('نام حداکثر ۸۰ کاراکتر است');
    user.name = trimmed;
  }
  await user.save();
  return user;
}

module.exports = { findOrCreateByMobile, updateProfile };
