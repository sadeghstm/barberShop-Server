'use strict';

const crypto = require('node:crypto');
const Appointment = require('../models/Appointment');
const Payment = require('../models/Payment');
const BarberService = require('../models/BarberService');
const ServiceCatalog = require('../models/ServiceCatalog');
const Barber = require('../models/Barber');
const Shop = require('../models/Shop');
const settingsService = require('./settings');
const auditService = require('./audit');
const { withLock } = require('./lock');
const { AppError } = require('../helpers/AppError');
const { SYSTEM_ACTOR } = require('../constants/roles');
const { MAX_BOOKING_DAYS_AHEAD } = require('../constants/time');
const { computeFreeStarts, isStartFree, toDayKey, addDays } = require('../helpers/schedule');
const {
  APPOINTMENT_STATUS: STATUS,
  APPOINTMENT_SOURCE,
  ONLINE_BLOCKING_STATUSES,
  CATALOG_STATUS,
  PAYMENT_STATUS,
} = require('../constants/enums');

const DUPLICATE_KEY = 11000;
const MINUTE = 60 * 1000;
const ACTIVE_STATUSES = [STATUS.CONFIRMED, STATUS.ARRIVED, STATUS.IN_PROGRESS];

const depositKey = (appointmentId) => `deposit:${appointmentId}`;

// ---------------------------------------------------------------------------
// کمک‌ها
// ---------------------------------------------------------------------------

/** آرایشگر این خدمت را الان ارائه می‌دهد؟ (خدمت در کاتالوگ فعال + فعال‌شده توسط آرایشگر) */
async function getOfferOrThrow(barber, serviceId) {
  const [offer, service] = await Promise.all([
    BarberService.findOne({ barberId: barber._id, serviceId, isActive: true }),
    ServiceCatalog.findOne({ _id: serviceId, status: CATALOG_STATUS.ACTIVE }),
  ]);
  if (!offer || !service) throw AppError.notFound('این آرایشگر این خدمت را ارائه نمی‌دهد');
  return offer;
}

/** روز باید در بازه‌ی مجاز رزرو باشد (تا ۶۰ روز جلوتر؛ روز گذشته فقط خالی برمی‌گردد نه خطا). */
function assertInsideWindow(dayKey, now, field) {
  if (dayKey > addDays(toDayKey(now), MAX_BOOKING_DAYS_AHEAD)) {
    throw AppError.validation(`فقط تا ${MAX_BOOKING_DAYS_AHEAD} روز آینده می‌شود نوبت گرفت`, [
      { field, message: `${field} بیش از ${MAX_BOOKING_DAYS_AHEAD} روز جلوتر است` },
    ]);
  }
}

/**
 * بازه‌های اشغال‌شده‌ی آن آرایشگر در آن روز، برای تابع زمان آزاد.
 * اگر تاخیر پیش‌بینی شده باشد (estimatedEnd دیرتر از bookedEnd) تا همان‌جا اشغال حساب می‌شود.
 * heldUntil فقط برای موقت‌ها پر می‌شود تا موقتِ منقضی‌شده نادیده گرفته شود، نه نوبت تاییدشده.
 */
async function busyOf(barberId, dayKey, statuses = ONLINE_BLOCKING_STATUSES) {
  const rows = await Appointment.find({ barberId, dayKey, status: { $in: statuses } })
    .select('status bookedStart bookedEnd estimatedEnd heldUntil')
    .lean();
  return rows.map((r) => ({
    start: r.bookedStart,
    end: r.estimatedEnd > r.bookedEnd ? r.estimatedEnd : r.bookedEnd,
    heldUntil: r.status === STATUS.HELD ? r.heldUntil : null,
  }));
}

function scheduleParams({ shop, busy, dayKey, durationMinutes, settings, now }) {
  return {
    dayKey,
    workingHours: shop.settings.workingHours,
    holidays: shop.settings.holidays,
    busy,
    durationMinutes,
    now,
    minLeadMinutes: settings.minBookingLeadMinutes,
  };
}

function translateDuplicate(err) {
  if (err.code !== DUPLICATE_KEY) return err;
  if (String(err.message).includes('one_hold_per_customer')) {
    return AppError.conflict('شما یک نوبت موقت در انتظار پرداخت دارید', undefined, 'ACTIVE_HOLD_EXISTS');
  }
  return AppError.conflict('این زمان دیگر آزاد نیست', undefined, 'SLOT_UNAVAILABLE');
}

/** یک نوبت موقت را (اگر هنوز موقت است) منقضی می‌کند و در لاگ می‌نویسد. true = این فراخوانی منقضی‌اش کرد. */
async function expireOne(appointmentId, actor, reason, now) {
  const before = await Appointment.findOneAndUpdate(
    { _id: appointmentId, status: STATUS.HELD },
    { status: STATUS.EXPIRED },
    { new: false },
  );
  if (!before) return false;
  await auditService.record({
    actor,
    action: 'appointment.expire',
    entityType: 'appointments',
    entityId: before._id,
    before: { status: STATUS.HELD, heldUntil: before.heldUntil },
    after: { status: STATUS.EXPIRED },
    meta: { reason, at: now },
  });
  return true;
}

// ---------------------------------------------------------------------------
// زمان‌های آزاد
// ---------------------------------------------------------------------------

/** زمان‌های شروع ممکن برای این آرایشگر، این خدمت و این روز. خروجی: { durationMinutes, items: [{ start, end, time }] } */
async function getAvailability({ shop, barber, serviceId, dayKey, now = new Date() }) {
  const offer = await getOfferOrThrow(barber, serviceId);
  assertInsideWindow(dayKey, now, 'date');

  const [settings, busy] = await Promise.all([settingsService.get(), busyOf(barber._id, dayKey)]);
  const items = computeFreeStarts(scheduleParams({ shop, busy, dayKey, durationMinutes: offer.durationMinutes, settings, now }));
  return { durationMinutes: offer.durationMinutes, items };
}

// ---------------------------------------------------------------------------
// نگه‌داشتن موقت
// ---------------------------------------------------------------------------

/**
 * مشتری یک زمان را ۱۰ دقیقه (holdMinutes) نگه می‌دارد تا پرداخت کند.
 * مراحل: بررسی‌های ساده ← قفل کوتاه (آرایشگر + روز) ← بررسی نهایی زمان آزاد ← ثبت نوبت «موقت».
 * خروجی: { appointment, created } — اگر مشتری همین نوبت موقت را قبلاً گرفته بود created=false و همان برمی‌گردد.
 */
async function hold({ customer, shop, barber, serviceId, start, now = new Date() }) {
  if (String(barber.userId) === String(customer.userId)) {
    throw AppError.forbidden('آرایشگر نمی‌تواند از خودش نوبت بگیرد');
  }
  const offer = await getOfferOrThrow(barber, serviceId);
  const settings = await settingsService.get();
  const dayKey = toDayKey(start);
  assertInsideWindow(dayKey, now, 'start');

  // موقتِ قدیمیِ همین مشتری که مهلتش گذشته، جلوی ساخت جدید را نگیرد (ایندکس one_hold_per_customer)
  const stale = await Appointment.find({ customerId: customer.userId, status: STATUS.HELD, heldUntil: { $lte: now } }).select('_id');
  for (const old of stale) await expireOne(old._id, customer, 'holdTimeout', now);

  const active = await Appointment.findOne({ customerId: customer.userId, status: STATUS.HELD });
  if (active) {
    const same =
      String(active.barberId) === String(barber._id) &&
      String(active.serviceId) === String(serviceId) &&
      active.bookedStart.getTime() === start.getTime();
    if (same) return { appointment: active, created: false };
    throw AppError.conflict('شما یک نوبت موقت در انتظار پرداخت دارید؛ ابتدا آن را پرداخت کنید یا تا پایان مهلتش صبر کنید', undefined, 'ACTIVE_HOLD_EXISTS');
  }

  const end = new Date(start.getTime() + offer.durationMinutes * MINUTE);

  const appointment = await withLock(`lock:booking:${barber._id}:${dayKey}`, async () => {
    // بررسی نهایی داخل قفل: ممکن است بین نمایش زمان‌ها و الان کسی گرفته باشد
    const busy = await busyOf(barber._id, dayKey);
    const params = scheduleParams({ shop, busy, dayKey, durationMinutes: offer.durationMinutes, settings, now });
    if (!isStartFree(params, start)) {
      throw AppError.conflict('این زمان دیگر آزاد نیست؛ زمان دیگری انتخاب کنید', undefined, 'SLOT_UNAVAILABLE');
    }

    // مشتری هم‌زمان در دو جا نباشد (نوبت‌های تاییدشده‌ی متعدد مجاز است به شرط نداشتن هم‌پوشانی)
    const overlapping = await Appointment.exists({
      customerId: customer.userId,
      status: { $in: ACTIVE_STATUSES },
      bookedStart: { $lt: end },
      bookedEnd: { $gt: start },
    });
    if (overlapping) throw AppError.conflict('در این بازه نوبت دیگری دارید', undefined, 'CUSTOMER_OVERLAP');

    try {
      return await Appointment.create({
        shopId: shop._id,
        barberId: barber._id,
        serviceId,
        customerId: customer.userId,
        source: APPOINTMENT_SOURCE.ONLINE,
        status: STATUS.HELD,
        dayKey,
        bookedStart: start,
        bookedEnd: end,
        estimatedStart: start,
        estimatedEnd: end,
        priceSnapshot: offer.price,
        durationSnapshot: offer.durationMinutes,
        depositAmount: Math.round((offer.price * settings.depositPercent) / 100),
        heldUntil: new Date(now.getTime() + settings.holdMinutes * MINUTE),
      });
    } catch (err) {
      throw translateDuplicate(err);
    }
  });

  return { appointment, created: true };
}

// ---------------------------------------------------------------------------
// پرداخت (شبیه‌سازی‌شده) و تایید خودکار
// ---------------------------------------------------------------------------

/**
 * پرداخت بیعانه‌ی یک نوبت موقت. درگاه واقعی نداریم؛ outcome ('success' | 'failure') نتیجه‌ی درگاه را شبیه‌سازی می‌کند.
 *  - موفق ← نوبت «تایید شده»
 *  - ناموفق ← پرداخت «ناموفق» و نوبت «منقضی» (بازه آزاد می‌شود)
 * تکرار درخواست امن است: کلید یکتای پرداخت `deposit:{appointmentId}` است.
 * خروجی: { result: 'confirmed' | 'alreadyConfirmed' | 'declined', appointment, payment }
 */
async function pay({ customer, appointmentId, outcome, now = new Date() }) {
  const appointment = await Appointment.findOne({ _id: appointmentId, customerId: customer.userId });
  if (!appointment) throw AppError.notFound('نوبت یافت نشد');

  if (appointment.status === STATUS.CONFIRMED) {
    const payment = await Payment.findOne({ idempotencyKey: depositKey(appointment._id) });
    return { result: 'alreadyConfirmed', appointment, payment };
  }
  if (appointment.status === STATUS.EXPIRED) {
    throw AppError.conflict('مهلت پرداخت این نوبت تمام شده است', undefined, 'HOLD_EXPIRED');
  }
  if (appointment.status !== STATUS.HELD) {
    throw AppError.conflict('این نوبت قابل پرداخت نیست', undefined, 'NOT_PAYABLE');
  }
  if (appointment.heldUntil <= now) {
    await expireOne(appointment._id, customer, 'holdTimeout', now);
    throw AppError.conflict('مهلت پرداخت این نوبت تمام شده است', undefined, 'HOLD_EXPIRED');
  }

  const key = depositKey(appointment._id);
  let payment = await Payment.findOne({ idempotencyKey: key });
  if (!payment) {
    try {
      payment = await Payment.create({
        appointmentId: appointment._id,
        customerId: customer.userId,
        amount: appointment.depositAmount,
        walletAmount: 0, // کیف پول در فاز ۳
        gatewayAmount: appointment.depositAmount,
        providerRef: `mock-${crypto.randomUUID()}`,
        idempotencyKey: key,
      });
    } catch (err) {
      if (err.code === DUPLICATE_KEY) throw AppError.conflict('پرداخت این نوبت در حال انجام است', undefined, 'PAYMENT_IN_PROGRESS');
      throw err;
    }
  }

  // بیعانه‌ی صفر نیازی به درگاه ندارد و همیشه موفق است
  const gatewayApproved = appointment.depositAmount === 0 || outcome === 'success';
  const succeeded = payment.status === PAYMENT_STATUS.SUCCEEDED || (payment.status === PAYMENT_STATUS.PENDING && gatewayApproved);

  if (!succeeded) {
    if (payment.status === PAYMENT_STATUS.PENDING) await markFailed(payment, 'gateway_declined');
    const expired = await expireOne(appointment._id, customer, 'paymentFailed', now);
    return { result: 'declined', appointment: expired ? await Appointment.findById(appointment._id) : appointment, payment };
  }

  // تایید فقط اگر هنوز موقت و مهلت‌دار است (شرط داخل خود به‌روزرسانی، پس بین بررسی و تایید خالی نمی‌ماند)
  let confirmed;
  try {
    confirmed = await Appointment.findOneAndUpdate(
      { _id: appointment._id, status: STATUS.HELD, heldUntil: { $gt: now } },
      { status: STATUS.CONFIRMED, heldUntil: null },
      { new: true },
    );
  } catch (err) {
    if (err.code === DUPLICATE_KEY) {
      await markFailed(payment, 'slot_taken');
      await expireOne(appointment._id, customer, 'slotTaken', now);
      throw AppError.conflict('این زمان دیگر آزاد نیست', undefined, 'SLOT_UNAVAILABLE');
    }
    throw err;
  }
  if (!confirmed) {
    // پرداخت درست همین لحظه‌ی آخر رسید ولی مهلت تمام شده بود (با درگاه واقعی اینجا باید بازگشت وجه ثبت شود: بک‌لاگ)
    if (payment.status === PAYMENT_STATUS.PENDING) await markFailed(payment, 'hold_expired');
    throw AppError.conflict('مهلت پرداخت این نوبت تمام شده است', undefined, 'HOLD_EXPIRED');
  }

  if (payment.status === PAYMENT_STATUS.PENDING) {
    payment.status = PAYMENT_STATUS.SUCCEEDED;
    payment.paidAt = now;
    await payment.save();
  }
  return { result: 'confirmed', appointment: confirmed, payment };
}

async function markFailed(payment, reason) {
  payment.status = PAYMENT_STATUS.FAILED;
  payment.failureReason = reason;
  await payment.save();
}

// ---------------------------------------------------------------------------
// پاکسازی موقت‌های منقضی
// ---------------------------------------------------------------------------

/**
 * همه‌ی موقت‌هایی که مهلتشان گذشته را «منقضی» می‌کند. کار دوره‌ای (jobs/expireHolds.js) این را صدا می‌زند.
 * منقضی‌نکردنشان خطری ندارد (در محاسبه‌ی زمان آزاد نادیده گرفته می‌شوند)؛ این فقط وضعیت را مرتب می‌کند.
 * خروجی: تعداد منقضی‌شده‌ها
 */
async function expireStale(now = new Date(), limit = 200) {
  const stale = await Appointment.find({ status: STATUS.HELD, heldUntil: { $lte: now } }).select('_id').limit(limit);
  let count = 0;
  for (const { _id } of stale) {
    if (await expireOne(_id, { role: SYSTEM_ACTOR }, 'holdTimeout', now)) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// نوبت‌های من
// ---------------------------------------------------------------------------

/** نام آرایشگاه، آرایشگر و خدمت را کنار نوبت‌ها می‌گذارد. خروجی: [{ appointment, shopName, barberName, serviceTitle }] */
async function withNames(appointments) {
  const ids = (field) => [...new Set(appointments.map((a) => String(a[field])))];
  const [shops, barbers, services] = await Promise.all([
    Shop.find({ _id: { $in: ids('shopId') } }).select('name'),
    Barber.find({ _id: { $in: ids('barberId') } }).select('displayName'),
    ServiceCatalog.find({ _id: { $in: ids('serviceId') } }).select('title'),
  ]);
  const shopById = new Map(shops.map((s) => [String(s._id), s.name]));
  const barberById = new Map(barbers.map((b) => [String(b._id), b.displayName]));
  const serviceById = new Map(services.map((s) => [String(s._id), s.title]));

  return appointments.map((appointment) => ({
    appointment,
    shopName: shopById.get(String(appointment.shopId)) ?? '',
    barberName: barberById.get(String(appointment.barberId)) ?? '',
    serviceTitle: serviceById.get(String(appointment.serviceId)) ?? '',
  }));
}

async function listMine(customerId, { page, limit }) {
  const filter = { customerId };
  const [rows, total] = await Promise.all([
    Appointment.find(filter).sort({ bookedStart: -1 }).skip((page - 1) * limit).limit(limit),
    Appointment.countDocuments(filter),
  ]);
  return { items: await withNames(rows), total };
}

async function getMine(customerId, appointmentId) {
  const appointment = await Appointment.findOne({ _id: appointmentId, customerId });
  if (!appointment) throw AppError.notFound('نوبت یافت نشد');
  return (await withNames([appointment]))[0];
}

module.exports = { getAvailability, hold, pay, expireStale, listMine, getMine, withNames, getOfferOrThrow, busyOf, scheduleParams, translateDuplicate };
