'use strict';

// زمان‌ها در دیتابیس UTC هستند (Date). dayKey رشته «YYYY-MM-DD» به وقت تهران است تا
// «همان روز» بدون محاسبه منطقه زمانی پرس‌وجو شود. ساختن dayKey وظیفه تابع زمان (گام ۶) است.
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const GRID_MINUTES = 5;

module.exports = { DAY_KEY_PATTERN, HHMM_PATTERN, GRID_MINUTES };
