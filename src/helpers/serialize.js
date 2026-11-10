'use strict';

// شکل‌دهی پاسخ‌ها برای فرانت (بخش ۲ سند): زمان‌ها UTC می‌مانند ولی رشته تهران (HH:mm) هم
// برگردانده می‌شود تا کلاینت بدون محاسبه منطقه زمانی برچسب بزند. تبدیل شمسی در کلاینت انجام می‌شود.

const { toDayKey, tehranMinutesOfDay, minutesToHhmm } = require('./time');

/** یک Date را به شکل { iso, dayKey, time } برمی‌گرداند (time به وقت تهران). */
function timeView(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return { iso: d.toISOString(), dayKey: toDayKey(d), time: minutesToHhmm(tehranMinutesOfDay(d)) };
}

/** نوبت را به شکل امن برای کلاینت درمی‌آورد. */
function appointmentView(appointment) {
  if (!appointment) return null;
  const a = typeof appointment.toObject === 'function' ? appointment.toObject() : appointment;
  return {
    id: a._id,
    shopId: a.shopId,
    barberId: a.barberId,
    serviceId: a.serviceId,
    customerId: a.customerId ?? null,
    walkInName: a.walkInName ?? null,
    source: a.source,
    status: a.status,
    dayKey: a.dayKey,
    bookedStart: timeView(a.bookedStart),
    bookedEnd: timeView(a.bookedEnd),
    estimatedStart: timeView(a.estimatedStart),
    estimatedEnd: timeView(a.estimatedEnd),
    priceSnapshot: a.priceSnapshot,
    durationSnapshot: a.durationSnapshot,
    depositAmount: a.depositAmount,
    finalPrice: a.finalPrice ?? null,
    paidInPerson: a.paidInPerson ?? null,
    heldUntil: a.heldUntil ? new Date(a.heldUntil).toISOString() : null,
    noShowHold: Boolean(a.noShowHold),
    cancelRequest: a.cancelRequest?.status
      ? {
          status: a.cancelRequest.status,
          requestedAt: a.cancelRequest.requestedAt ? new Date(a.cancelRequest.requestedAt).toISOString() : null,
          decidedAt: a.cancelRequest.decidedAt ? new Date(a.cancelRequest.decidedAt).toISOString() : null,
        }
      : null,
    arrivedAt: a.arrivedAt ? new Date(a.arrivedAt).toISOString() : null,
    startedAt: a.startedAt ? new Date(a.startedAt).toISOString() : null,
    finishedAt: a.finishedAt ? new Date(a.finishedAt).toISOString() : null,
    createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : null,
  };
}

/** قیمت را بر اساس تنظیم آرایشگاه و وضعیت ورود پنهان می‌کند (۵.۸). */
function priceView(price, { shop, authenticated }) {
  const visible = shop?.settings?.showPricesToGuests !== false || Boolean(authenticated);
  return visible ? price : null;
}

module.exports = { timeView, appointmentView, priceView };
