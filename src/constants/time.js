'use strict';

// زمان‌ها در دیتابیس UTC هستند (Date). dayKey رشته «YYYY-MM-DD» به وقت تهران است تا
// «همان روز» بدون محاسبه منطقه زمانی پرس‌وجو شود. ساختن dayKey وظیفه helpers/schedule.js است.
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const GRID_MINUTES = 5;
// ایران ساعت تابستانی ندارد (از ۱۴۰۱ لغو شده)؛ تهران همیشه UTC+03:30 است.
const TEHRAN_OFFSET_MINUTES = 210;
// تا چند روز جلوتر می‌شود نوبت گرفت (تصمیم من، قابل تغییر)
const MAX_BOOKING_DAYS_AHEAD = 60;

module.exports = { DAY_KEY_PATTERN, HHMM_PATTERN, GRID_MINUTES, TEHRAN_OFFSET_MINUTES, MAX_BOOKING_DAYS_AHEAD };
