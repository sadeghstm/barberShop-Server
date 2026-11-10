'use strict';

// هسته نوبت‌دهی (بخش ۵ سند): رزرو با قفل ردیس + بررسی هم‌پوشانی، ماشین وضعیت،
// مشتری حضوری، عدم حضور خودکار، محاسبه مجدد زمان پیش‌بینی‌شده.

const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const Barber = require('../models/Barber');
const Shop = require('../models/Shop');
const BarberService = require('../models/BarberService');
const ServiceCatalog = require('../models/ServiceCatalog');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const {
  APPOINTMENT_STATUS,
  APPOINTMENT_SOURCE,
  ONLINE_BLOCKING_STATUSES,
  BLOCKING_STATUSES,
  PAYMENT_STATUS,
  CATALOG_STATUS,
  REFUND_STATUS,
  REFUND_DESTINATION,
  WALLET_TX_TYPE,
} = require('../constants/enums');
const { ROLES, SYSTEM_ACTOR } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const { toDayKey, addMinutes, overlaps, tehranMinutesOfDay, minutesToHhmm } = require('../helpers/time');
const { GRID_MINUTES } = require('../constants/time');
const { getGlobalSettings } = require('./settings');
const { withBookingLock } = require('./lock');
const { computeFreeSlots, findFirstWalkInSlot } = require('./availability');
const walletService = require('./wallet');
const { enqueueSms } = require('./smsQueue');
const auditService = require('./audit');

function assertObjectId(id, field) {
  if (!id || !mongoose.isValidObjectId(id)) {
    throw AppError.validation(`شناسه ${field} معتبر نیست`);
  }
}

async function getShopOrFail(shopId) {
  assertObjectId(shopId, 'آرایشگاه');
  const shop = await Shop.findById(shopId);
  if (!shop || !shop.isActive) throw AppError.notFound('آرایشگاه یافت نشد');
  return shop;
}

async function getActiveBarberOrFail(barberId, shopId) {
  assertObjectId(barberId, 'آرایشگر');
  const barber = await Barber.findById(barberId);
  if (!barber || !barber.isActive || String(barber.shopId) !== String(shopId)) {
    throw AppError.notFound('آرایشگر در این آرایشگاه یافت نشد');
  }
  return barber;
}

async function getActiveBarberServiceOrFail(barberId, serviceId) {
  const bs = await BarberService.findOne({ barberId, serviceId, isActive: true });
  if (!bs || bs.price == null || bs.durationMinutes == null) {
    throw AppError.validation('این خدمت برای این آرایشگر فعال نیست');
  }
  const catalog = await ServiceCatalog.findById(serviceId);
  if (!catalog || catalog.status !== CATALOG_STATUS.ACTIVE) {
    throw AppError.validation('این خدمت قابل رزرو نیست');
  }
  return bs;
}

/** نوبت‌های مسدودکننده یک آرایشگر در یک روز (held منقضی کنار گذاشته می‌شود). */
async function blockingAppointmentsForDay(barberId, dayKey, now, statuses = ONLINE_BLOCKING_STATUSES) {
  // dayKey به وقت تهران ذخیره می‌شود، پس نیازی به بازه زمانی روی bookedStart نیست
  const all = await Appointment.find({
    barberId,
    dayKey,
    status: { $in: statuses },
  }).lean();
  return all.filter((a) => {
    if (a.status === 'held' && a.heldUntil && new Date(a.heldUntil) <= now) return false;
    return true;
  });
}

function checkOverlap(newStart, newEnd, blocking) {
  return blocking.some((a) => overlaps(newStart, newEnd, new Date(a.bookedStart), new Date(a.bookedEnd)));
}

/**
 * زمان‌های آزاد برای رزرو آنلاین (بخش ۵.۱).
 * GET /api/shops/:shopId/barbers/:barberId/availability?serviceId=...&dayKey=YYYY-MM-DD
 */
async function getAvailability({ shopId, barberId, serviceId, dayKey }) {
  const shop = await getShopOrFail(shopId);
  await getActiveBarberOrFail(barberId, shopId);
  const bs = await getActiveBarberServiceOrFail(barberId, serviceId);
  const settings = await getGlobalSettings();
  const now = new Date();
  if (dayKey < toDayKey(now)) {
    return { slots: [], durationMinutes: bs.durationMinutes, price: bs.price };
  }
  // حداکثر ۹۰ روز جلوتر؛ بیشتر از آن برای برنامه‌ریزی معنا ندارد
  if (dayKey > toDayKey(addMinutes(now, 90 * 24 * 60))) {
    throw AppError.validation('روز درخواستی بیش از ۹۰ روز جلوتر است');
  }
  const appointments = await blockingAppointmentsForDay(barberId, dayKey, now);
  const slots = computeFreeSlots({
    shop,
    dayKey,
    durationMinutes: bs.durationMinutes,
    appointments,
    now,
    minLeadMinutes: settings.minBookingLeadMinutes,
  });
  return { slots, durationMinutes: bs.durationMinutes, price: bs.price };
}

/**
 * رزرو آنلاین: ساخت نوبت «موقت» با قفل ردیس (بخش ۵.۱).
 * داخل قفل: بررسی هم‌پوشانی در مونگو → ثبت موقت با heldUntil → آزاد کردن قفل.
 * پرداخت در گام بعد (payments) تاییدش می‌کند.
 */
async function createHold({ shopId, barberId, serviceId, customerId, bookedStart }) {
  const shop = await getShopOrFail(shopId);
  const barber = await getActiveBarberOrFail(barberId, shopId);
  const bs = await getActiveBarberServiceOrFail(barberId, serviceId);
  const settings = await getGlobalSettings();
  const now = new Date();

  const start = new Date(bookedStart);
  if (Number.isNaN(start.getTime())) throw AppError.validation('زمان شروع معتبر نیست');
  const end = addMinutes(start, bs.durationMinutes);
  const dayKey = toDayKey(start);
  if (toDayKey(end) !== dayKey) {
    throw AppError.validation('نوبت نباید از پایان روز عبور کند');
  }
  if (start < addMinutes(now, settings.minBookingLeadMinutes)) {
    throw AppError.validation(`نوبت باید حداقل ${settings.minBookingLeadMinutes} دقیقه بعد از الان باشد`);
  }
  // زمان شروع روی شبکه ۵ دقیقه‌ای و بدون ثانیه/میلی‌ثانیه (۵.۱)
  if (tehranMinutesOfDay(start) % GRID_MINUTES !== 0 || start.getSeconds() !== 0 || start.getMilliseconds() !== 0) {
    throw AppError.validation('زمان شروع باید روی مضارب ۵ دقیقه باشد');
  }

  // آرایشگر/مالک نمی‌تواند در آرایشگاه خودش از خودش نوبت بگیرد (۵.۱)
  if (String(barber.userId) === String(customerId)) {
    throw AppError.forbidden('آرایشگر نمی‌تواند از خودش نوبت بگیرد');
  }

  // هر مشتری هم‌زمان فقط یک نگه‌داشتن فعال دارد (۵.۱) — موقت منقضی را اول منقضی می‌کنیم
  await Appointment.updateMany(
    { customerId, status: APPOINTMENT_STATUS.HELD, heldUntil: { $lte: now } },
    { $set: { status: APPOINTMENT_STATUS.EXPIRED } },
  );
  const existingHold = await Appointment.findOne({ customerId, status: APPOINTMENT_STATUS.HELD });
  if (existingHold) {
    throw AppError.conflict('شما یک نگه‌داشتن فعال دارید؛ اول آن را پرداخت یا لغو کنید');
  }

  return withBookingLock(barberId, dayKey, async () => {
    const blocking = await blockingAppointmentsForDay(barberId, dayKey, new Date());
    if (checkOverlap(start, end, blocking)) {
      throw AppError.conflict('این بازه زمانی آزاد نیست');
    }
    // بررسی ساعت کاری: بازه باید داخل یک بازه کاری باشد
    const { workingIntervalsForDay } = require('./availability');
    const intervals = workingIntervalsForDay(shop, dayKey);
    const insideWorkingHours = intervals.some((iv) => start >= iv.start && end <= iv.end);
    if (!insideWorkingHours) {
      throw AppError.validation('این زمان خارج از ساعت کاری آرایشگاه است');
    }

    const heldUntil = addMinutes(new Date(), settings.holdMinutes);
    const depositAmount = Math.round((bs.price * settings.depositPercent) / 100);
    const appointment = await Appointment.create({
      shopId,
      barberId,
      serviceId,
      customerId,
      source: APPOINTMENT_SOURCE.ONLINE,
      status: APPOINTMENT_STATUS.HELD,
      dayKey,
      bookedStart: start,
      bookedEnd: end,
      estimatedStart: start,
      estimatedEnd: end,
      priceSnapshot: bs.price,
      durationSnapshot: bs.durationMinutes,
      depositAmount,
      heldUntil,
    });
    await auditService.record({
      actor: { userId: customerId, role: ROLES.CUSTOMER, shopId },
      action: 'appointment.hold',
      entityType: 'appointments',
      entityId: appointment._id,
      after: appointment,
      meta: { heldUntil: heldUntil.toISOString(), depositAmount },
    });
    return appointment;
  });
}

/**
 * پرداخت شبیه‌سازی‌شده (بخش ۵.۶): موفق → «تایید شده» خودکار.
 * کیف پول می‌تواند بیعانه را کامل یا بخشی پوشش دهد.
 */
async function confirmWithPayment({ appointmentId, customerId, idempotencyKey, useWallet = true, simulateFailure = false }) {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw AppError.notFound('نوبت یافت نشد');
  if (String(appointment.customerId) !== String(customerId)) throw AppError.forbidden();

  const key = idempotencyKey ?? `pay:${appointment._id}`;
  // ایدمپوتنسی: همان کلید پرداخت دوباره اثر نمی‌گذارد و همان نتیجه برگردانده می‌شود (۵.۶)
  const existingPayment = await Payment.findOne({ idempotencyKey: key });
  if (existingPayment) {
    if (String(existingPayment.appointmentId) !== String(appointment._id)) {
      throw AppError.conflict('این کلید پرداخت برای نوبت دیگری استفاده شده است');
    }
    return { appointment, payment: existingPayment, duplicated: true };
  }

  if (appointment.status !== APPOINTMENT_STATUS.HELD) {
    throw AppError.conflict('این نوبت در وضعیت قابل پرداخت نیست');
  }
  if (appointment.heldUntil && new Date(appointment.heldUntil) <= new Date()) {
    appointment.status = APPOINTMENT_STATUS.EXPIRED;
    await appointment.save();
    throw AppError.conflict('نگه‌داشتن این نوبت منقضی شده است');
  }

  // درگاه شبیه‌سازی‌شده: می‌توان شکست را هم تست کرد؛ پرداخت ناموفق ⇒ نوبت منقضی و بازه آزاد (۵.۱)
  if (simulateFailure) {
    const failedPayment = await Payment.create({
      appointmentId: appointment._id,
      customerId,
      amount: appointment.depositAmount,
      walletAmount: 0,
      gatewayAmount: appointment.depositAmount,
      idempotencyKey: key,
      status: PAYMENT_STATUS.FAILED,
      failureReason: 'پرداخت شبیه‌سازی‌شده ناموفق بود',
    });
    const before = appointment.toObject();
    appointment.status = APPOINTMENT_STATUS.EXPIRED;
    appointment.heldUntil = null;
    await appointment.save();
    await auditService.record({
      actor: { userId: customerId, role: ROLES.CUSTOMER, shopId: appointment.shopId },
      action: 'appointment.paymentFailed',
      entityType: 'appointments',
      entityId: appointment._id,
      before,
      after: appointment,
      meta: { paymentId: failedPayment._id },
    });
    return { appointment, payment: failedPayment, failed: true };
  }

  const deposit = appointment.depositAmount;
  let walletAmount = 0;
  if (useWallet && deposit > 0) {
    const balance = await walletService.getBalance(customerId);
    walletAmount = Math.min(balance, deposit);
  }
  const gatewayAmount = deposit - walletAmount;

  const payment = await Payment.create({
    appointmentId: appointment._id,
    customerId,
    amount: deposit,
    walletAmount,
    gatewayAmount,
    idempotencyKey: key,
    status: PAYMENT_STATUS.SUCCEEDED,
    providerRef: `mock-${Date.now()}`,
    paidAt: new Date(),
  });

  if (walletAmount > 0) {
    await walletService.applyTransaction({
      userId: customerId,
      type: WALLET_TX_TYPE.SPEND,
      amount: -walletAmount,
      idempotencyKey: `spend:${payment._id}`,
      refType: 'payments',
      refId: payment._id,
    });
  }

  const before = appointment.toObject();
  appointment.status = APPOINTMENT_STATUS.CONFIRMED;
  appointment.heldUntil = null;
  await appointment.save();

  await auditService.record({
    actor: { userId: customerId, role: ROLES.CUSTOMER, shopId: appointment.shopId },
    action: 'appointment.confirm',
    entityType: 'appointments',
    entityId: appointment._id,
    before,
    after: appointment,
    meta: { paymentId: payment._id, walletAmount, gatewayAmount },
  });

  const customer = await require('../models/User').findById(customerId);
  await enqueueSms({
    mobile: customer?.mobile,
    event: 'appointment.confirmed',
    data: {
      code: String(appointment._id).slice(-6),
      time: minutesToHhmm(tehranMinutesOfDay(appointment.bookedStart)),
    },
    idempotencyKey: `sms:confirmed:${appointment._id}`,
  });

  return { appointment, payment, duplicated: false };
}

/** ماشین وضعیت (بخش ۵.۲): فقط گذرهای مجاز و توسط نقش مجاز. */
const TRANSITIONS = {
  [APPOINTMENT_STATUS.HELD]: [APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.EXPIRED, APPOINTMENT_STATUS.CANCELLED],
  [APPOINTMENT_STATUS.CONFIRMED]: [APPOINTMENT_STATUS.ARRIVED, APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.NO_SHOW],
  [APPOINTMENT_STATUS.ARRIVED]: [APPOINTMENT_STATUS.IN_PROGRESS, APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.NO_SHOW],
  [APPOINTMENT_STATUS.IN_PROGRESS]: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.CANCELLED],
  [APPOINTMENT_STATUS.COMPLETED]: [],
  [APPOINTMENT_STATUS.EXPIRED]: [],
  [APPOINTMENT_STATUS.CANCELLED]: [],
  [APPOINTMENT_STATUS.NO_SHOW]: [],
};

function assertTransition(from, to) {
  if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) {
    throw AppError.conflict(`گذر از «${from}» به «${to}» مجاز نیست`);
  }
}

/**
 * محاسبه مجدد زمان پیش‌بینی‌شده (بخش ۵.۴):
 * estimatedStart بعدی = بیشینه (زمان رزرو، پایان واقعی/پیش‌بینی‌شده قبلی).
 * فقط نوبت‌های همان آرایشگر و همان روز. اگر تغییر بیش از آستانه باشد، پیامک می‌رود.
 */
async function recalculateEstimated({ barberId, dayKey, actor }) {
  const settings = await getGlobalSettings();
  const appointments = await Appointment.find({
    barberId,
    dayKey,
    status: { $in: ['confirmed', 'arrived', 'inProgress'] },
  }).sort({ bookedStart: 1 });

  const shop = appointments.length > 0 ? await Shop.findById(appointments[0].shopId) : null;
  const { workingIntervalsForDay } = require('./availability');
  const workingEnds = shop ? workingIntervalsForDay(shop, dayKey).map((iv) => iv.end) : [];
  const lastWorkingEnd = workingEnds.length > 0 ? new Date(Math.max(...workingEnds.map((d) => d.getTime()))) : null;
  let warnedOvertime = false;

  let prevEnd = null;
  for (const appt of appointments) {
    const bookedStart = new Date(appt.bookedStart);
    const durationMs = new Date(appt.bookedEnd) - bookedStart;
    let newEstimatedStart = bookedStart;
    if (prevEnd && prevEnd > newEstimatedStart) newEstimatedStart = new Date(prevEnd);
    const newEstimatedEnd = new Date(newEstimatedStart.getTime() + durationMs);

    const oldStart = new Date(appt.estimatedStart);
    const diffMinutes = Math.abs((newEstimatedStart - oldStart) / 60000);
    if (diffMinutes > 0) {
      const before = appt.toObject();
      appt.estimatedStart = newEstimatedStart;
      appt.estimatedEnd = newEstimatedEnd;
      await appt.save();
      if (diffMinutes >= settings.delayNotifyThresholdMinutes && appt.customerId) {
        const user = await require('../models/User').findById(appt.customerId);
        await enqueueSms({
          mobile: user?.mobile,
          event: 'appointment.delayed',
          data: { time: minutesToHhmm(tehranMinutesOfDay(newEstimatedStart)) },
          idempotencyKey: `sms:delayed:${appt._id}:${newEstimatedStart.toISOString()}`,
        });
      }
      await auditService.record({
        actor: actor ?? { role: SYSTEM_ACTOR },
        action: 'appointment.recalculate',
        entityType: 'appointments',
        entityId: appt._id,
        before,
        after: appt,
        meta: { diffMinutes },
      });
    }

    // اگر زمان پیش‌بینی‌شده از ساعت کاری بگذرد، مالک هشدار می‌گیرد (۵.۴)
    if (shop && lastWorkingEnd && newEstimatedEnd > lastWorkingEnd && !warnedOvertime) {
      warnedOvertime = true;
      const owner = await require('../models/User').findById(shop.ownerId);
      await enqueueSms({
        mobile: owner?.mobile,
        event: 'shop.overtime',
        data: {
          text: `هشدار: زمان پیش‌بینی‌شده نوبت‌های امروز از ساعت کاری (${minutesToHhmm(
            tehranMinutesOfDay(lastWorkingEnd),
          )}) عبور کرده است.`,
        },
        idempotencyKey: `sms:overtime:${barberId}:${dayKey}:${lastWorkingEnd.toISOString()}:${newEstimatedEnd.toISOString()}`,
      });
      await auditService.record({
        actor: { role: SYSTEM_ACTOR },
        action: 'shop.overtimeWarning',
        entityType: 'shops',
        entityId: shop._id,
        meta: {
          barberId,
          dayKey,
          workingEnd: lastWorkingEnd.toISOString(),
          estimatedEnd: newEstimatedEnd.toISOString(),
        },
      });
    }
    prevEnd = new Date(appt.estimatedEnd);
  }
}

/** «حاضر شد» توسط آرایشگر/مالک (۵.۲). */
async function markArrived({ appointmentId, actor }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  assertBarberAccess(appt, actor);
  assertTransition(appt.status, APPOINTMENT_STATUS.ARRIVED);
  const before = appt.toObject();
  appt.status = APPOINTMENT_STATUS.ARRIVED;
  appt.arrivedAt = new Date();
  await appt.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId },
    action: 'appointment.arrive',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
  });
  return appt;
}

/** «شروع خدمت» — اگر حضور ثبت نشده باشد، هم‌زمان ثبت می‌شود (۵.۲). */
async function markStarted({ appointmentId, actor }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  assertBarberAccess(appt, actor);
  if (appt.status === APPOINTMENT_STATUS.CONFIRMED) {
    appt.arrivedAt = new Date();
  }
  assertTransition(appt.status, APPOINTMENT_STATUS.IN_PROGRESS);
  const before = appt.toObject();
  appt.status = APPOINTMENT_STATUS.IN_PROGRESS;
  appt.startedAt = new Date();
  await appt.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId },
    action: 'appointment.start',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
  });
  await recalculateEstimated({ barberId: appt.barberId, dayKey: appt.dayKey, actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId } });
  return appt;
}

/** «تکمیل خدمت» با مبلغ نهایی و پرداخت حضوری (۵.۶). پورسانت معرفی در همین لحظه اعمال می‌شود (۵.۷). */
async function markCompleted({ appointmentId, actor, finalPrice, paidInPerson = 0 }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  assertBarberAccess(appt, actor);
  assertTransition(appt.status, APPOINTMENT_STATUS.COMPLETED);
  if (!Number.isInteger(finalPrice) || finalPrice < 0) throw AppError.validation('مبلغ نهایی باید عدد صحیح باشد');
  if (!Number.isInteger(paidInPerson) || paidInPerson < 0) throw AppError.validation('پرداخت حضوری باید عدد صحیح باشد');

  const before = appt.toObject();
  appt.status = APPOINTMENT_STATUS.COMPLETED;
  appt.finishedAt = new Date();
  appt.finalPrice = finalPrice;
  appt.paidInPerson = paidInPerson;
  await appt.save();

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId },
    action: 'appointment.complete',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
    meta: { finalPrice, paidInPerson },
  });

  // پورسانت معرفی روی مبلغ نهایی (۵.۷)
  if (appt.customerId) {
    const settings = await getGlobalSettings();
    if (settings.referralCommissionPercent > 0) {
      const customer = await require('../models/User').findById(appt.customerId);
      if (customer?.referredBy) {
        const commission = Math.round((finalPrice * settings.referralCommissionPercent) / 100);
        await walletService.creditCommission({ referrerId: customer.referredBy, amount: commission, appointmentId: appt._id });
      }
    }
  }

  if (appt.customerId) {
    const customer = await require('../models/User').findById(appt.customerId);
    await enqueueSms({
      mobile: customer?.mobile,
      event: 'appointment.completed',
      idempotencyKey: `sms:completed:${appt._id}`,
    });
  }

  await recalculateEstimated({ barberId: appt.barberId, dayKey: appt.dayKey, actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId } });
  return appt;
}

/** لغو توسط مشتری (۵.۶): بیش از ۲ ساعت قبل → بازگشت بیعانه به کیف پول. */
async function cancelByCustomer({ appointmentId, customerId }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  if (String(appt.customerId) !== String(customerId)) throw AppError.forbidden();
  assertTransition(appt.status, APPOINTMENT_STATUS.CANCELLED);
  const settings = await getGlobalSettings();
  const before = appt.toObject();
  appt.status = APPOINTMENT_STATUS.CANCELLED;
  appt.cancelledBy = customerId;
  appt.cancelledAt = new Date();
  await appt.save();

  // سیاست بازگشت بیعانه
  const hoursBefore = (new Date(appt.bookedStart) - new Date()) / 3600000;
  const payment = await Payment.findOne({ appointmentId: appt._id, status: PAYMENT_STATUS.SUCCEEDED });
  if (payment && payment.amount > 0 && hoursBefore >= settings.cancelRefundHoursBefore) {
    const refund = await Refund.create({
      paymentId: payment._id,
      appointmentId: appt._id,
      customerId,
      amount: payment.amount,
      destination: REFUND_DESTINATION.WALLET,
      status: REFUND_STATUS.DONE,
      reason: 'لغو توسط مشتری',
      idempotencyKey: `refund:cancel:${appt._id}`,
    });
    await walletService.applyTransaction({
      userId: customerId,
      type: WALLET_TX_TYPE.DEPOSIT_REFUND,
      amount: refund.amount,
      idempotencyKey: `wallet-refund:${refund._id}`,
      refType: 'refunds',
      refId: refund._id,
    });
  }

  await auditService.record({
    actor: { userId: customerId, role: ROLES.CUSTOMER, shopId: appt.shopId },
    action: 'appointment.cancel',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
  });
  await recalculateEstimated({ barberId: appt.barberId, dayKey: appt.dayKey });
  return appt;
}

/** درخواست لغو توسط آرایشگر/مالک — فقط با موافقت مشتری اجرا می‌شود (۵.۲). */
async function requestCancelByBarber({ appointmentId, actor }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  assertBarberAccess(appt, actor);
  if (![APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.ARRIVED].includes(appt.status)) {
    throw AppError.conflict('در این وضعیت نمی‌توان درخواست لغو داد');
  }
  if (appt.cancelRequest?.status === 'pending') throw AppError.conflict('درخواست لغو قبلی هنوز تصمیم‌گیری نشده است');
  const before = appt.toObject();
  appt.cancelRequest = { requestedBy: actor.userId, requestedAt: new Date(), status: 'pending', decidedAt: null };
  await appt.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId },
    action: 'appointment.cancelRequest',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
  });
  if (appt.customerId) {
    const customer = await require('../models/User').findById(appt.customerId);
    await enqueueSms({
      mobile: customer?.mobile,
      event: 'appointment.cancelRequested',
      idempotencyKey: `sms:cancel-request:${appt._id}:${appt.cancelRequest.requestedAt.toISOString()}`,
    });
  }
  return appt;
}

/** تصمیم مشتری روی درخواست لغو آرایشگر: موافقت → لغو با بازگشت کامل به کیف پول. */
async function decideCancelRequest({ appointmentId, customerId, accept }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  if (String(appt.customerId) !== String(customerId)) throw AppError.forbidden();
  if (appt.cancelRequest?.status !== 'pending') throw AppError.conflict('درخواست لغو فعالی وجود ندارد');
  const before = appt.toObject();
  appt.cancelRequest.status = accept ? 'accepted' : 'rejected';
  appt.cancelRequest.decidedAt = new Date();
  if (accept) {
    appt.status = APPOINTMENT_STATUS.CANCELLED;
    appt.cancelledBy = appt.cancelRequest.requestedBy;
    appt.cancelledAt = new Date();
    const payment = await Payment.findOne({ appointmentId: appt._id, status: PAYMENT_STATUS.SUCCEEDED });
    if (payment && payment.amount > 0) {
      const refund = await Refund.create({
        paymentId: payment._id,
        appointmentId: appt._id,
        customerId,
        amount: payment.amount,
        destination: REFUND_DESTINATION.WALLET,
        status: REFUND_STATUS.DONE,
        reason: 'لغو به درخواست آرایشگاه با موافقت مشتری',
        idempotencyKey: `refund:barber-cancel:${appt._id}`,
      });
      await walletService.applyTransaction({
        userId: customerId,
        type: WALLET_TX_TYPE.DEPOSIT_REFUND,
        amount: refund.amount,
        idempotencyKey: `wallet-refund:${refund._id}`,
        refType: 'refunds',
        refId: refund._id,
      });
    }
  }
  await appt.save();
  await auditService.record({
    actor: { userId: customerId, role: ROLES.CUSTOMER, shopId: appt.shopId },
    action: accept ? 'appointment.cancelRequest.accept' : 'appointment.cancelRequest.reject',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
  });
  if (appt.customerId) {
    const customer = await require('../models/User').findById(appt.customerId);
    await enqueueSms({
      mobile: customer?.mobile,
      event: accept ? 'appointment.cancelRequestAccepted' : 'appointment.cancelRequestRejected',
      idempotencyKey: `sms:cancel-decision:${appt._id}`,
    });
  }
  if (accept) await recalculateEstimated({ barberId: appt.barberId, dayKey: appt.dayKey });
  return appt;
}

/**
 * مشتری حضوری (بخش ۵.۴): در اولین جای خالی کافی از الان به بعد.
 * جای نوبت سوخته هم می‌تواند باشد. هرگز نوبت تاییدشده آنلاین را عقب نمی‌اندازد.
 */
async function createWalkIn({ shopId, barberId, serviceId, actor, walkInName, walkInMobile, customerId }) {
  const shop = await getShopOrFail(shopId);
  await getActiveBarberOrFail(barberId, shopId);
  const bs = await getActiveBarberServiceOrFail(barberId, serviceId);
  const now = new Date();

  // اگر مشتری حساب‌دار انتخاب شد، باید فعال باشد
  if (customerId) {
    assertObjectId(customerId, 'مشتری');
    const customer = await require('../models/User').findById(customerId);
    if (!customer || !customer.isActive) throw AppError.notFound('مشتری یافت نشد');
  }

  // حداکثر ۷ روز جلو را بررسی می‌کنیم
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addMinutes(now, offset * 24 * 60);
    const dayKey = toDayKey(day);
    // برای مشتری حضوری، نوبت سوخته (noShow) مسدودکننده نیست
    const appointments = await blockingAppointmentsForDay(barberId, dayKey, now, BLOCKING_STATUSES);
    const slot = findFirstWalkInSlot({ shop, dayKey, durationMinutes: bs.durationMinutes, appointments, now });
    if (!slot) continue;
    const end = addMinutes(slot, bs.durationMinutes);
    // داخل قفل دوباره بررسی می‌کنیم (رقابت با رزرو آنلاین)
    return withBookingLock(barberId, dayKey, async () => {
      const fresh = await blockingAppointmentsForDay(barberId, dayKey, new Date(), BLOCKING_STATUSES);
      if (checkOverlap(slot, end, fresh)) {
        throw AppError.conflict('این بازه آزاد نیست؛ دوباره تلاش کنید');
      }
      const appointment = await Appointment.create({
        shopId,
        barberId,
        serviceId,
        customerId: customerId ?? null,
        walkInName: customerId ? null : walkInName,
        walkInMobile: walkInMobile ?? null,
        source: APPOINTMENT_SOURCE.WALK_IN,
        status: APPOINTMENT_STATUS.ARRIVED,
        dayKey,
        bookedStart: slot,
        bookedEnd: end,
        estimatedStart: slot,
        estimatedEnd: end,
        priceSnapshot: bs.price,
        durationSnapshot: bs.durationMinutes,
        depositAmount: 0,
        arrivedAt: new Date(),
      });
      await auditService.record({
        actor: { userId: actor.userId, role: actor.role, shopId },
        action: 'appointment.walkIn',
        entityType: 'appointments',
        entityId: appointment._id,
        after: appointment,
      });
      return appointment;
    });
  }
  throw AppError.conflict('جای خالی برای مشتری حضوری در ۷ روز آینده نیست');
}

/** عدم حضور خودکار (۵.۳): ۵ دقیقه بعد از زمان پیش‌بینی‌شده فعلی، مگر noShowHold. */
async function markNoShows({ now = new Date() } = {}) {
  const settings = await getGlobalSettings();
  // همه نوبت‌های تاییدشده‌ای که از مهلت گذشته‌اند؛ نگه‌داشتن تصمیم جداگانه بررسی می‌شود
  const candidates = await Appointment.find({
    status: APPOINTMENT_STATUS.CONFIRMED,
    estimatedStart: { $lte: addMinutes(now, -settings.noShowGraceMinutes) },
  });

  let count = 0;
  for (const appt of candidates) {
    if (appt.noShowHold) {
      // مهلت نگه‌داشتن تصمیم «تا شروع نوبت بعدی همان آرایشگر» است (۵.۳)
      const next = await Appointment.findOne({
        barberId: appt.barberId,
        dayKey: appt.dayKey,
        bookedStart: { $gt: appt.bookedStart },
      }).sort({ bookedStart: 1 });
      const nextStarted =
        next &&
        (['arrived', 'inProgress', 'completed'].includes(next.status) || new Date(next.bookedStart) <= now);
      if (!nextStarted) continue; // هنوز مهلت دارد
    }

    const before = appt.toObject();
    appt.status = APPOINTMENT_STATUS.NO_SHOW;
    appt.noShowHold = false;
    await appt.save();
    await auditService.record({
      actor: { role: SYSTEM_ACTOR },
      action: 'appointment.noShow',
      entityType: 'appointments',
      entityId: appt._id,
      before,
      after: appt,
      meta: { auto: true, holdExpired: Boolean(before.noShowHold) },
    });
    if (appt.customerId) {
      const user = await require('../models/User').findById(appt.customerId);
      await enqueueSms({
        mobile: user?.mobile,
        event: 'appointment.noShow',
        idempotencyKey: `sms:noshow:${appt._id}`,
      });
    }
    count += 1;
  }
  return count;
}

/** یادآوری پیامکی یک ساعت قبل از نوبت تاییدشده (۵.۹) — کلید یکتا جلوی ارسال تکراری را می‌گیرد. */
async function sendDueReminders({ now = new Date() } = {}) {
  const upcoming = await Appointment.find({
    status: APPOINTMENT_STATUS.CONFIRMED,
    bookedStart: { $gte: now, $lte: addMinutes(now, 60) },
  }).lean();
  let sent = 0;
  for (const appt of upcoming) {
    if (!appt.customerId) continue;
    const user = await require('../models/User').findById(appt.customerId);
    if (!user?.mobile) continue;
    const result = await enqueueSms({
      mobile: user.mobile,
      event: 'appointment.reminder',
      data: { time: minutesToHhmm(tehranMinutesOfDay(appt.bookedStart)) },
      idempotencyKey: `sms:reminder:${appt._id}`,
    });
    if (result.queued) sent += 1;
  }
  return sent;
}

/** نگه‌داشتن/آزاد کردن تصمیم عدم حضور توسط آرایشگر (۵.۳). */
async function setNoShowHold({ appointmentId, actor, hold }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  assertBarberAccess(appt, actor);
  if (appt.status !== APPOINTMENT_STATUS.CONFIRMED) throw AppError.conflict('فقط نوبت تاییدشده قابل نگه‌داشتن است');
  const before = appt.toObject();
  appt.noShowHold = Boolean(hold);
  await appt.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId },
    action: hold ? 'appointment.noShowHold' : 'appointment.noShowRelease',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
  });
  return appt;
}

/** پاکسازی موقت‌های منقضی (۵.۱). */
async function expireHolds({ now = new Date() } = {}) {
  const result = await Appointment.updateMany(
    { status: APPOINTMENT_STATUS.HELD, heldUntil: { $lte: now } },
    { $set: { status: APPOINTMENT_STATUS.EXPIRED } },
  );
  return result.modifiedCount ?? 0;
}

function assertBarberAccess(appointment, actor) {
  const isStaff = actor.roles?.includes(ROLES.SUPER_ADMIN) || actor.roles?.includes(ROLES.ADMIN);
  if (isStaff) return;
  const isOwnShop = actor.shopId && String(actor.shopId) === String(appointment.shopId);
  if (!isOwnShop) throw AppError.forbidden('این نوبت متعلق به آرایشگاه شما نیست');
}

/**
 * لغو اجباری توسط ادمین (۵.۵: اگر مشتری به درخواست لغو پاسخ نداد، ادمین تصمیم می‌گیرد).
 * بازگشت کامل بیعانه به کیف پول انجام می‌شود.
 */
async function forceCancelByAdmin({ appointmentId, actor, reason }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  assertTransition(appt.status, APPOINTMENT_STATUS.CANCELLED);
  if (!reason || String(reason).trim().length < 3) throw AppError.validation('دلیل لغو الزامی است');

  const before = appt.toObject();
  appt.status = APPOINTMENT_STATUS.CANCELLED;
  appt.cancelledBy = actor.userId;
  appt.cancelledAt = new Date();
  if (appt.cancelRequest?.status === 'pending') {
    appt.cancelRequest.status = 'accepted';
    appt.cancelRequest.decidedAt = new Date();
  }
  await appt.save();

  const payment = await Payment.findOne({ appointmentId: appt._id, status: PAYMENT_STATUS.SUCCEEDED });
  if (payment && payment.amount > 0) {
    let refund = await Refund.findOne({ idempotencyKey: `refund:admin-cancel:${appt._id}` });
    if (!refund) {
      refund = await Refund.create({
        paymentId: payment._id,
        appointmentId: appt._id,
        customerId: appt.customerId,
        amount: payment.amount,
        destination: REFUND_DESTINATION.WALLET,
        status: REFUND_STATUS.DONE,
        reason: `لغو توسط ادمین: ${reason}`,
        createdBy: actor.userId,
        idempotencyKey: `refund:admin-cancel:${appt._id}`,
      });
      if (appt.customerId) {
        await walletService.applyTransaction({
          userId: appt.customerId,
          type: WALLET_TX_TYPE.DEPOSIT_REFUND,
          amount: refund.amount,
          idempotencyKey: `wallet-refund:${refund._id}`,
          refType: 'refunds',
          refId: refund._id,
        });
      }
    }
  }

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'appointment.adminCancel',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
    meta: { reason },
  });

  if (appt.customerId) {
    const customer = await require('../models/User').findById(appt.customerId);
    await enqueueSms({
      mobile: customer?.mobile,
      event: 'appointment.cancelledByShop',
      idempotencyKey: `sms:admin-cancel:${appt._id}`,
    });
  }
  await recalculateEstimated({ barberId: appt.barberId, dayKey: appt.dayKey });
  return appt;
}

/**
 * برگرداندن «تکمیل شده» (۵.۲): فقط ادمین/سوپر ادمین، با ثبت دلیل و خنثی‌سازی پورسانت معرفی.
 * نوبت به «تایید شده» برمی‌گردد تا آرایشگر بتواند دوباره آن را ببندد.
 */
async function revertCompletion({ appointmentId, actor, reason }) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt) throw AppError.notFound('نوبت یافت نشد');
  if (appt.status !== APPOINTMENT_STATUS.COMPLETED) throw AppError.conflict('فقط نوبت تکمیل‌شده قابل برگشت است');
  if (!reason || String(reason).trim().length < 3) throw AppError.validation('دلیل برگشت الزامی است');

  const before = appt.toObject();
  const commission = await walletService.reverseCommissionForAppointment({ appointmentId: appt._id });

  appt.status = APPOINTMENT_STATUS.CONFIRMED;
  appt.finishedAt = null;
  appt.finalPrice = null;
  appt.paidInPerson = null;
  await appt.save();

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'appointment.revertCompletion',
    entityType: 'appointments',
    entityId: appt._id,
    before,
    after: appt,
    meta: { reason, commissionReversed: Boolean(commission), commissionId: commission?._id ?? null },
  });
  await recalculateEstimated({ barberId: appt.barberId, dayKey: appt.dayKey, actor: { userId: actor.userId, role: actor.role, shopId: appt.shopId } });
  return appt;
}

/**
 * فهرست نوبت‌های یک آرایشگاه برای پنل مالک/ادمین.
 * from/to روی dayKey (تهران) اعمال می‌شوند؛ dayKey رشته است، پس مقایسه رشته‌ای درست کار می‌کند.
 */
async function listShopAppointments({ shopId, from, to, status, barberId, page = 1, limit = 50 }) {
  const query = { shopId };
  if (status) query.status = status;
  if (barberId) query.barberId = barberId;
  if (from || to) {
    query.dayKey = {};
    if (from) query.dayKey.$gte = from;
    if (to) query.dayKey.$lte = to;
  }
  const [rows, total] = await Promise.all([
    Appointment.find(query)
      .sort({ bookedStart: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Appointment.countDocuments(query),
  ]);
  return { rows, total, page, limit };
}

/** برنامه روز آرایشگر (تابلوی روز). */
async function getDayBoard({ barberId, dayKey, actor }) {
  const barber = await Barber.findById(barberId);
  if (!barber) throw AppError.notFound('آرایشگر یافت نشد');
  const isStaff = actor.roles?.includes(ROLES.SUPER_ADMIN) || actor.roles?.includes(ROLES.ADMIN);
  if (!isStaff && String(actor.shopId) !== String(barber.shopId)) throw AppError.forbidden();
  return Appointment.find({ barberId, dayKey }).sort({ bookedStart: 1 }).lean();
}

/** نوبت‌های من (مشتری). */
async function getMyAppointments({ customerId, status, page = 1, limit = 20 }) {
  const query = { customerId };
  if (status) query.status = status;
  return Appointment.find(query).sort({ bookedStart: -1 }).skip((page - 1) * limit).limit(limit).lean();
}

module.exports = {
  getAvailability,
  createHold,
  confirmWithPayment,
  markArrived,
  markStarted,
  markCompleted,
  cancelByCustomer,
  requestCancelByBarber,
  decideCancelRequest,
  createWalkIn,
  markNoShows,
  revertCompletion,
  forceCancelByAdmin,
  listShopAppointments,
  sendDueReminders,
  setNoShowHold,
  expireHolds,
  recalculateEstimated,
  getDayBoard,
  getMyAppointments,
  TRANSITIONS,
};
