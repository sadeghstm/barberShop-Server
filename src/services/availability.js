'use strict';

// تابع محاسبه زمان آزاد (بخش ۵.۱ سند) — تابع خالص، بدون وابستگی به دیتابیس/ردیس.
// ورودی‌ها:
// - shop: سند آرایشگاه (workingHours, holidays)
// - dayKey: روز مورد نظر به وقت تهران
// - durationMinutes: مدت خدمت
// - appointments: نوبت‌های همان آرایشگر و همان روز (با bookedStart/bookedEnd و status)
// - now: لحظه فعلی (برای حداقل فاصله رزرو)
// - minLeadMinutes: حداقل فاصله تا «الان» (تنظیم سراسری، پیش‌فرض ۱۵)
// خروجی: آرایه‌ای از Date (شروع‌های آزاد روی شبکه ۵ دقیقه‌ای)

const { GRID_MINUTES } = require('../constants/time');
const { BLOCKING_STATUSES, ONLINE_BLOCKING_STATUSES } = require('../constants/enums');
const {
  weekdayOfDayKey,
  dayKeyTimeToDate,
  addMinutes,
  overlaps,
  tehranMinutesOfDay,
} = require('../helpers/time');

/**
 * آیا یک نوبت در محاسبه اشغال محسوب می‌شود؟
 * - پیش‌فرض برای رزرو آنلاین: ONLINE_BLOCKING_STATUSES (شامل noShow) — بازه نوبت سوخته
 *   برای آنلاین بسته می‌ماند و فقط مشتری حضوری می‌تواند آن را بگیرد (۵.۳).
 * - برای مشتری حضوری: BLOCKING_STATUSES (بدون noShow).
 * - held منقضی‌شده (heldUntil گذشته) در هر دو حالت اشغال نیست.
 */
function isBlocking(appointment, now, statuses = ONLINE_BLOCKING_STATUSES) {
  if (!statuses.includes(appointment.status)) return false;
  if (appointment.status === 'held' && appointment.heldUntil && new Date(appointment.heldUntil) <= now) {
    return false;
  }
  return true;
}

/** بازه‌های کاری یک روز را به [startDate, endDate) تبدیل می‌کند. */
function workingIntervalsForDay(shop, dayKey) {
  const weekday = weekdayOfDayKey(dayKey);
  const day = (shop.settings?.workingHours ?? []).find((d) => d.weekday === weekday);
  if (!day || !day.intervals || day.intervals.length === 0) return [];
  const isHoliday = (shop.settings?.holidays ?? []).some((h) => h.date === dayKey);
  if (isHoliday) return [];
  return day.intervals
    .map((interval) => {
      const start = dayKeyTimeToDate(dayKey, interval.start);
      const end = dayKeyTimeToDate(dayKey, interval.end);
      if (!start || !end || end <= start) return null;
      return { start, end };
    })
    .filter(Boolean);
}

/**
 * زمان‌های آزاد برای یک آرایشگر در یک روز.
 * - شروع‌ها روی شبکه ۵ دقیقه‌ای هستند.
 * - نوبت باید کامل داخل یک بازه کاری جا شود.
 * - نوبت آنلاین باید حداقل minLeadMinutes بعد از الان شروع شود.
 * - با هیچ نوبت مسدودکننده‌ای هم‌پوشانی ندارد.
 */
function computeFreeSlots({
  shop,
  dayKey,
  durationMinutes,
  appointments = [],
  now = new Date(),
  minLeadMinutes = 15,
  blockingStatuses = ONLINE_BLOCKING_STATUSES,
}) {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return [];
  const intervals = workingIntervalsForDay(shop, dayKey);
  if (intervals.length === 0) return [];

  const blocking = appointments
    .filter((a) => isBlocking(a, now, blockingStatuses))
    .map((a) => ({ start: new Date(a.bookedStart), end: new Date(a.bookedEnd) }));

  const earliestStart = addMinutes(now, minLeadMinutes);
  const slots = [];

  for (const interval of intervals) {
    // اولین شروع روی شبکه ۵ دقیقه‌ای که >= max(interval.start, earliestStart) باشد
    let candidate = new Date(Math.max(interval.start.getTime(), earliestStart.getTime()));
    // گرد به بالا روی شبکه ۵ دقیقه‌ای (بر اساس دقیقه تهران)
    const mod = tehranMinutesOfDay(candidate) % GRID_MINUTES;
    if (mod !== 0) candidate = addMinutes(candidate, GRID_MINUTES - mod);

    while (true) {
      const candidateEnd = addMinutes(candidate, durationMinutes);
      if (candidateEnd > interval.end) break;
      const conflict = blocking.some((b) => overlaps(candidate, candidateEnd, b.start, b.end));
      if (!conflict) slots.push(new Date(candidate));
      candidate = addMinutes(candidate, GRID_MINUTES);
    }
  }

  return slots;
}

/**
 * اولین جای خالی از «الان» به بعد که مدتش کافی باشد (برای مشتری حضوری، بخش ۵.۴).
 * می‌تواند جای نوبت سوخته (noShow) باشد — پس noShow در این حالت مسدودکننده نیست.
 * appointments باید شامل نوبت‌های همان روز باشد؛ اگر روز عوض شد، فراخواننده روز بعد را هم بررسی می‌کند.
 */
function findFirstWalkInSlot({ shop, dayKey, durationMinutes, appointments = [], now = new Date() }) {
  const slots = computeFreeSlots({
    shop,
    dayKey,
    durationMinutes,
    appointments,
    now,
    minLeadMinutes: 0,
    blockingStatuses: BLOCKING_STATUSES, // جای نوبت سوخته برای مشتری حضوری آزاد است
  });
  return slots.length > 0 ? slots[0] : null;
}

module.exports = { computeFreeSlots, findFirstWalkInSlot, isBlocking, workingIntervalsForDay };
