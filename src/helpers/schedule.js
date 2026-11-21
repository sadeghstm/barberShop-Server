'use strict';

/**
 * محاسبه زمان آزاد آرایشگر — فقط توابع خالص: نه دیتابیس، نه ساعت سیستم (now را صدا زننده می‌دهد).
 * به همین دلیل بدون هیچ ابزاری قابل تست است.
 *
 * مفاهیم:
 *  - dayKey: روز به وقت تهران، به شکل 'YYYY-MM-DD' (میلادی)
 *  - weekday: ۰ = شنبه ... ۶ = جمعه
 *  - زمان‌ها در حافظه Date (UTC) هستند؛ فقط هنگام ساختن از «HH:mm» یا نمایش، به وقت تهران تبدیل می‌شوند.
 */

const { DAY_KEY_PATTERN, GRID_MINUTES, TEHRAN_OFFSET_MINUTES } = require('../constants/time');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → { year, month, day }؛ برای روز ناموجود (مثل 2026-02-30) خطا می‌دهد. */
function parseDayKey(dayKey) {
  if (typeof dayKey !== 'string' || !DAY_KEY_PATTERN.test(dayKey)) throw new TypeError(`dayKey نامعتبر: ${dayKey}`);
  const [year, month, day] = dayKey.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new TypeError(`dayKey نامعتبر: ${dayKey}`);
  }
  return { year, month, day };
}

/** یک لحظه (Date) → dayKey به وقت تهران */
function toDayKey(date) {
  const shifted = new Date(date.getTime() + TEHRAN_OFFSET_MINUTES * MINUTE);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** یک لحظه (Date) → 'HH:mm' به وقت تهران */
function toTehranTime(date) {
  const shifted = new Date(date.getTime() + TEHRAN_OFFSET_MINUTES * MINUTE);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** روز هفته: ۰ = شنبه ... ۶ = جمعه */
function weekdayOf(dayKey) {
  const { year, month, day } = parseDayKey(dayKey);
  const sundayBased = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // ۰ = یکشنبه
  return (sundayBased + 1) % 7;
}

/** dayKey + چند روز (می‌تواند منفی باشد) */
function addDays(dayKey, days) {
  const { year, month, day } = parseDayKey(dayKey);
  return toDayKey(new Date(Date.UTC(year, month - 1, day) + days * DAY - TEHRAN_OFFSET_MINUTES * MINUTE + 12 * 60 * MINUTE));
}

/** ('2026-11-10', '09:30') → لحظه‌ی Date (UTC) معادل ۰۹:۳۰ تهران */
function tehranDate(dayKey, hhmm) {
  const { year, month, day } = parseDayKey(dayKey);
  const minutes = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  return new Date(Date.UTC(year, month - 1, day) + minutes * MINUTE - TEHRAN_OFFSET_MINUTES * MINUTE);
}

/** دو بازه‌ی نیم‌باز [start, end) هم‌پوشانی دارند؟ (پایان یکی = شروع دیگری هم‌پوشانی نیست) */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** بازه‌های کاری آن روز به‌صورت Date؛ روز تعطیل یا بدون ساعت کاری → [] */
function workingIntervalsOf(dayKey, workingHours, holidays) {
  const isHoliday = (holidays ?? []).some((h) => (typeof h === 'string' ? h : h.date) === dayKey);
  if (isHoliday) return [];

  const day = (workingHours ?? []).find((d) => d.weekday === weekdayOf(dayKey));
  if (!day) return [];
  return day.intervals.map((i) => ({ start: tehranDate(dayKey, i.start), end: tehranDate(dayKey, i.end) }));
}

/** آیا بازه‌ی [start, end) کاملاً داخل یکی از بازه‌های کاری همان روز است؟ (تعطیلی = نه) */
function fitsInWorkingHours({ dayKey, start, end }, workingHours, holidays) {
  return workingIntervalsOf(dayKey, workingHours, holidays).some((i) => start >= i.start && end <= i.end);
}

/**
 * نوبت‌هایی که این آرایشگر را اشغال کرده‌اند، آماده‌ی مقایسه.
 * «موقت»ِ منقضی‌شده (heldUntil گذشته) نادیده گرفته می‌شود (۵.۱.۶ سند)، حتی اگر پاکسازی هنوز نرسیده باشد.
 */
function activeBusy(busy, now) {
  return (busy ?? []).filter((b) => !b.heldUntil || b.heldUntil > now);
}

function assertParams({ dayKey, durationMinutes, now, minLeadMinutes, stepMinutes }) {
  parseDayKey(dayKey);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes % GRID_MINUTES !== 0) {
    throw new TypeError(`durationMinutes باید مضرب ${GRID_MINUTES} و مثبت باشد`);
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now باید Date معتبر باشد');
  if (!Number.isInteger(minLeadMinutes) || minLeadMinutes < 0) throw new TypeError('minLeadMinutes نامعتبر');
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0 || stepMinutes % GRID_MINUTES !== 0) {
    throw new TypeError(`stepMinutes باید مضرب ${GRID_MINUTES} و مثبت باشد`);
  }
}

/**
 * ورودی (همه الزامی مگر ذکر شده):
 *  dayKey, durationMinutes, now (Date), minLeadMinutes
 *  workingHours: همان فرمت shop.settings.workingHours
 *  holidays: فهرست { date } یا رشته‌ی dayKey
 *  busy: [{ start: Date, end: Date, heldUntil?: Date }] نوبت‌های اشغال‌کننده‌ی همین آرایشگر در همین روز
 *  stepMinutes (اختیاری): فاصله‌ی زمان‌های پیشنهادی؛ پیش‌فرض ۵ دقیقه
 */
function prepare(params) {
  const { dayKey, workingHours, holidays, busy, now, durationMinutes, minLeadMinutes, stepMinutes = GRID_MINUTES } = params;
  assertParams({ dayKey, durationMinutes, now, minLeadMinutes, stepMinutes });

  const intervals = workingIntervalsOf(dayKey, workingHours, holidays);
  const blockers = activeBusy(busy, now);
  const earliest = new Date(now.getTime() + minLeadMinutes * MINUTE);
  const length = durationMinutes * MINUTE;

  /** آیا نوبتی با این شروع جا می‌شود؟ (همه قواعد در همین یک تابع) */
  const fitsAt = (start) => {
    if (start < earliest) return false;
    const end = new Date(start.getTime() + length);
    const insideWorkingHours = intervals.some((i) => start >= i.start && end <= i.end);
    if (!insideWorkingHours) return false;
    return !blockers.some((b) => overlaps(start, end, b.start, b.end));
  };

  return { intervals, length, stepMinutes, fitsAt };
}

/**
 * همه‌ی زمان‌های شروعِ ممکن در آن روز، به ترتیب زمان.
 * خروجی: [{ start: Date, end: Date, time: 'HH:mm' }]
 */
function computeFreeStarts(params) {
  const { intervals, length, stepMinutes, fitsAt } = prepare(params);
  const result = [];

  for (const interval of intervals) {
    for (let t = interval.start.getTime(); t + length <= interval.end.getTime(); t += stepMinutes * MINUTE) {
      const start = new Date(t);
      if (fitsAt(start)) result.push({ start, end: new Date(t + length), time: toTehranTime(start) });
    }
  }
  return result;
}

/**
 * آیا همین زمان شروع برای این نوبت آزاد است؟ (بررسی نهایی داخل قفل، قبل از ثبت)
 * شروع باید روی شبکه‌ی ۵ دقیقه‌ای باشد و در همان dayKey بیفتد.
 */
function isStartFree(params, start) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return false;
  if (toDayKey(start) !== params.dayKey) return false;
  const minutesFromEpoch = start.getTime() / MINUTE;
  if (!Number.isInteger(minutesFromEpoch) || (minutesFromEpoch + TEHRAN_OFFSET_MINUTES) % GRID_MINUTES !== 0) return false;
  return prepare(params).fitsAt(start);
}

module.exports = {
  parseDayKey,
  toDayKey,
  toTehranTime,
  weekdayOf,
  addDays,
  tehranDate,
  overlaps,
  workingIntervalsOf,
  fitsInWorkingHours,
  computeFreeStarts,
  isStartFree,
};
