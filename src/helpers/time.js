'use strict';

// زمان‌ها در دیتابیس UTC (Date) ذخیره می‌شوند و نمایش شمسی/تهران است (بخش ۲ سند).
// این فایل تنها نقطه تبدیل «UTC ↔ تهران» است تا بقیه برنامه فقط با dayKey و Date کار کند.
// dayKey: رشته «YYYY-MM-DD» به وقت تهران — «همان روز» بدون محاسبه منطقه زمانی پرس‌وجو می‌شود.
// weekday: 0 = شنبه ... 6 = جمعه (هفته ایرانی) — مطابق مدل Shop.

const TEHRAN_TZ = 'Asia/Tehran';

const pad2 = (n) => String(n).padStart(2, '0');

/** اجزای تقویم تهران برای یک Date (UTC). */
function tehranParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** dayKey تهران برای یک Date: «YYYY-MM-DD» */
function toDayKey(date) {
  const { year, month, day } = tehranParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * weekday ایرانی (0=شنبه ... 6=جمعه) برای dayKey.
 * dayKey را به ظهر UTC همان روز تبدیل می‌کنیم تا اختلاف منطقه زمانی اثر نگذارد.
 */
function weekdayOfDayKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // getUTCDay: 0=یکشنبه ... 6=شنبه → تبدیل به شنبه=0
  const jsDay = utcNoon.getUTCDay();
  return (jsDay + 1) % 7;
}

/** «HH:mm» (تهران) را به دقیقه از ابتدای روز تبدیل می‌کند. نامعتبر → null */
function hhmmToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** دقیقه از ابتدای روز (تهران) را به «HH:mm» تبدیل می‌کند. */
function minutesToHhmm(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * یک «HH:mm» تهران روی dayKey را به Date (UTC) تبدیل می‌کند.
 * با دو مرحله offset محاسبه می‌شود تا DST تهران (که دیگر اعمال نمی‌شود) هم درست باشد.
 */
function dayKeyTimeToDate(dayKey, hhmm) {
  const minutes = hhmmToMinutes(hhmm);
  if (minutes === null) return null;
  const [y, m, d] = dayKey.split('-').map(Number);
  // حدس اول: UTC
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  // offset تهران در آن لحظه
  const offsetMs = tehranOffsetMs(guess);
  guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs + minutes * 60000);
  // یک بار دیگر برای دقت (DST)
  const offset2 = tehranOffsetMs(guess);
  if (offset2 !== offsetMs) {
    guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offset2 + minutes * 60000);
  }
  return guess;
}

/** offset تهران نسبت به UTC در یک لحظه (میلی‌ثانیه). */
function tehranOffsetMs(date) {
  const { year, month, day, hour, minute, second } = tehranParts(date);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

/** دقیقه از ابتدای روز تهران برای یک Date. */
function tehranMinutesOfDay(date) {
  const { hour, minute } = tehranParts(date);
  return hour * 60 + minute;
}

/** افزودن دقیقه به Date */
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

/** آیا دو بازه [s1,e1) و [s2,e2) هم‌پوشانی دارند؟ (مرز مشترک = هم‌پوشانی نیست) */
function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

module.exports = {
  TEHRAN_TZ,
  tehranParts,
  toDayKey,
  weekdayOfDayKey,
  hhmmToMinutes,
  minutesToHhmm,
  dayKeyTimeToDate,
  tehranOffsetMs,
  tehranMinutesOfDay,
  addMinutes,
  overlaps,
};
