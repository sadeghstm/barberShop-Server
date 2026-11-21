'use strict';

const { AppError } = require('./AppError');
const { HHMM_PATTERN, GRID_MINUTES } = require('../constants/time');

const MAX_INTERVALS_PER_DAY = 4;

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function fail(field, message) {
  throw AppError.validation(message, [{ field, message }]);
}

/**
 * ساعت کاری هفتگی را بررسی و مرتب می‌کند.
 * ورودی:  [{ weekday: 0, intervals: [{ start: '09:00', end: '13:00' }, ...] }, ...]
 * weekday: 0 = شنبه ... 6 = جمعه. روزی که نیامده یا بازه ندارد، تعطیل است.
 * قواعد: ساعت‌ها به شکل HH:mm و مضرب ۵ دقیقه؛ شروع قبل از پایان؛ بازه‌های یک روز هم‌پوشان نباشند.
 */
function normalizeWorkingHours(days) {
  if (!Array.isArray(days) || days.length > 7) fail('days', 'days باید فهرستی حداکثر ۷ روزه باشد');

  const seen = new Set();
  const result = [];

  days.forEach((day, i) => {
    const where = `days[${i}]`;
    if (!day || !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) {
      fail(`${where}.weekday`, 'weekday باید عدد صحیح ۰ (شنبه) تا ۶ (جمعه) باشد');
    }
    if (seen.has(day.weekday)) fail(`${where}.weekday`, 'یک روز هفته بیش از یک بار آمده است');
    seen.add(day.weekday);

    const raw = day.intervals ?? [];
    if (!Array.isArray(raw) || raw.length > MAX_INTERVALS_PER_DAY) {
      fail(`${where}.intervals`, `هر روز حداکثر ${MAX_INTERVALS_PER_DAY} بازه می‌تواند داشته باشد`);
    }

    const intervals = raw.map((interval, j) => {
      const field = `${where}.intervals[${j}]`;
      const { start, end } = interval ?? {};
      for (const value of [start, end]) {
        if (typeof value !== 'string' || !HHMM_PATTERN.test(value)) fail(field, 'ساعت باید به شکل HH:mm باشد');
        if (toMinutes(value) % GRID_MINUTES !== 0) fail(field, `ساعت باید مضرب ${GRID_MINUTES} دقیقه باشد`);
      }
      if (toMinutes(start) >= toMinutes(end)) fail(field, 'ساعت شروع باید قبل از پایان باشد');
      return { start, end };
    });

    intervals.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let k = 1; k < intervals.length; k += 1) {
      if (toMinutes(intervals[k].start) < toMinutes(intervals[k - 1].end)) {
        fail(`${where}.intervals`, 'بازه‌های یک روز نباید هم‌پوشانی داشته باشند');
      }
    }

    if (intervals.length > 0) result.push({ weekday: day.weekday, intervals });
  });

  return result.sort((a, b) => a.weekday - b.weekday);
}

module.exports = { normalizeWorkingHours };
