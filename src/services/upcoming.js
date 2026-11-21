'use strict';

const Appointment = require('../models/Appointment');
const { APPOINTMENT_STATUS } = require('../constants/enums');
const { AppError } = require('../helpers/AppError');

const MAX_LISTED = 500;

/**
 * «نوبت آینده»: هنوز تمام نشده (پایانش بعد از الان است) و یا تاییدشده/حاضر/در حال انجام است،
 * یا موقتِ منقضی‌نشده (چون ممکن است هر لحظه تایید شود).
 * scope مثل { shopId } یا { barberId, serviceId } است.
 */
function filterFor(scope, now) {
  return {
    ...scope,
    bookedEnd: { $gt: now },
    $or: [
      { status: { $in: [APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.ARRIVED, APPOINTMENT_STATUS.IN_PROGRESS] } },
      { status: APPOINTMENT_STATUS.HELD, heldUntil: { $gt: now } },
    ],
  };
}

/** فهرست سبک برای بررسی تداخل: [{ dayKey, bookedStart, bookedEnd }] */
async function find(scope, now = new Date()) {
  return Appointment.find(filterFor(scope, now)).select('dayKey bookedStart bookedEnd').sort({ bookedStart: 1 }).limit(MAX_LISTED).lean();
}

/** فقط وجود نوبت آینده را می‌پرسد (ارزان‌تر از find) */
async function exists(scope, now = new Date()) {
  return Boolean(await Appointment.exists(filterFor(scope, now)));
}

/** اگر نوبت آینده‌ای در این محدوده هست، ۴۰۹ با تعداد و تاریخ‌ها (۵.۵ سند: تا لغو با موافقت مشتری مسدود است). */
async function assertNone(scope, reason, now = new Date()) {
  const items = await find(scope, now);
  if (items.length > 0) throw blocked(items, reason);
}

function blocked(items, reason) {
  const dates = [...new Set(items.map((a) => a.dayKey))].slice(0, 10);
  return AppError.conflict(
    `${items.length} نوبت آینده با این تغییر تداخل دارد (${reason})؛ ابتدا باید نوبت‌ها با موافقت مشتری لغو شوند`,
    { count: items.length, dates },
    'HAS_UPCOMING_APPOINTMENTS',
  );
}

module.exports = { find, exists, assertNone, blocked };
