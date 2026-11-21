'use strict';

// تنظیمات مشترک mocha. فایل‌های هر دسته را scripts/test.js مشخص می‌کند.
module.exports = {
  timeout: 10000,
  exit: true, // بعد از تمام شدن تست‌ها فرایند بسته شود (اتصال‌های باز مانع نشوند)
};
