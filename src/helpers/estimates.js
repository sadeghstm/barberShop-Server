'use strict';

const { APPOINTMENT_STATUS: S } = require('../constants/enums');

const MINUTE = 60 * 1000;
const time = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * محاسبه‌ی مجدد زمان پیش‌بینی‌شده‌ی نوبت‌های یک آرایشگر در یک روز (۵.۴ سند). تابع خالص است.
 *
 * قاعده: estimatedStart = بیشینه (زمان رزرو، پایان واقعی/پیش‌بینی‌شده‌ی نوبت قبلی). زمان رزرو هرگز تغییر نمی‌کند
 * و estimatedStart هیچ‌وقت جلوتر از آن نمی‌آید. اگر تاخیر جبران شود، زمان‌ها به زمان رزرو برمی‌گردند.
 *  - تکمیل‌شده: پایانش همان finishedAt (واقعی) است
 *  - در حال انجام: از startedAt شروع شده و تا max(startedAt + مدت، الان) ادامه دارد
 *  - حاضرشده / تاییدشده / موقتِ فعال: طبق قاعده‌ی بالا
 *  - عدم حضور، لغو، منقضی: در زنجیره نیستند (جایشان آزاد نمی‌شود برای آنلاین، ولی دیگران را عقب نمی‌اندازند)
 *
 * ورودی: [{ _id, status, bookedStart, durationSnapshot, estimatedStart, estimatedEnd, startedAt, finishedAt, heldUntil, createdAt }]
 * خروجی: فقط نوبت‌های تغییرکرده: [{ id, status, before: { start, end }, after: { start, end } }]
 */
function computeEstimateChanges(appointments, now) {
  const chain = appointments
    .filter((a) => {
      if (a.status === S.HELD) return a.heldUntil && time(a.heldUntil) > now.getTime();
      return [S.CONFIRMED, S.ARRIVED, S.IN_PROGRESS, S.COMPLETED].includes(a.status);
    })
    .sort((a, b) => time(a.bookedStart) - time(b.bookedStart) || time(a.createdAt ?? 0) - time(b.createdAt ?? 0));

  const changes = [];
  let cursor = null; // پایان نوبت قبلی (ms)

  for (const a of chain) {
    const length = a.durationSnapshot * MINUTE;
    let start;
    let end;

    if (a.status === S.COMPLETED) {
      start = time(a.estimatedStart);
      end = a.finishedAt ? time(a.finishedAt) : time(a.estimatedEnd);
      cursor = end;
      continue; // نوبت تمام‌شده را تغییر نمی‌دهیم
    }
    if (a.status === S.IN_PROGRESS) {
      start = time(a.startedAt ?? a.estimatedStart);
      end = Math.max(start + length, now.getTime());
    } else {
      start = Math.max(time(a.bookedStart), cursor ?? 0);
      end = start + length;
    }
    cursor = end;

    if (start !== time(a.estimatedStart) || end !== time(a.estimatedEnd)) {
      changes.push({
        id: a._id,
        status: a.status,
        before: { start: new Date(time(a.estimatedStart)), end: new Date(time(a.estimatedEnd)) },
        after: { start: new Date(start), end: new Date(end) },
      });
    }
  }
  return changes;
}

/** تغییر چند دقیقه‌ای زمان شروع (مثبت = دیرتر) */
const shiftMinutes = (change) => Math.round((change.after.start.getTime() - change.before.start.getTime()) / MINUTE);

module.exports = { computeEstimateChanges, shiftMinutes };
