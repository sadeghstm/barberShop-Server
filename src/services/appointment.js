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
  PAYMENT_STATUS,
  REFUND_STATUS,
  REFUND_DESTINATION,
  WALLET_TX_TYPE,
} = require('../constants/enums');
const { ROLES, SYSTEM_ACTOR } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const { toDayKey, addMinutes, overlaps, tehranMinutesOfDay, minutesToHhmm } = require('../helpers/time');
const { getGlobalSettings } = require('./settings');
const { withBookingLock } = require('./lock');
const { computeFreeSlots, findFirstWalkInSlot } = require('./availability');
const walletService = require('./wallet');
const { enqueueSms } = require('./smsQueue');
const auditService = require('./audit');
const { logger } = require('../helpers/logger');

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
  if (!catalog || catalog.status !== 'active') {
    throw AppError.validation('این خدمت قابل رزرو نیست');
  }
  return bs;
}

/** نوبت‌های مسدودکننده یک آرایشگر در یک روز (held منقضی کنار گذاشته می‌شود). */
async function blockingAppointmentsForDay(barberId, dayKey, now) {
  // dayKey به وقت تهران ذخیره می‌شود، پس نیازی به بازه زمانی روی bookedStart نیست
  const all = await Appointment.find({
    barberId,
    dayKey,
    status: { $in: ONLINE_BLOCKING_STATUSES },
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
    throw AppError.validation('نوبت باید حداقل ۱۵ دقیقه بعد از الان باشد');
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
    return appointment;
  });
}

/**
 * پرداخت شبیه‌سازی‌شده (بخش ۵.۶): موفق → «تایید شده» خودکار.
 * کیف پول می‌تواند بیعانه را کامل یا بخشی پوشش دهد.
 */
async function confirmWithPayment({ appointmentId, customerId, idempotencyKey, useWallet = true }) {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw AppError.notFound('نوبت یافت نشد');
  if (String(appointment.customerId) !== String(customerId)) throw AppError.forbidden();
  if (appointment.status !== APPOINTMENT_STATUS.HELD) {
    throw AppError.conflict('این نوبت در وضعیت قابل پرداخت نیست');
  }
  if (appointment.heldUntil && new Date(appointment.heldUntil) <= new Date()) {
    appointment.status = APPOINTMENT_STATUS.EXPIRED;
    await appointment.save();
    throw AppError.conflict('نگه‌داشتن این نوبت منقضی شده است');
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
    idempotencyKey: idempotencyKey ?? `pay:${appointment._id}`,
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

  await enqueueSms({
    mobile: (await require('../models/User').findById(customerId))?.mobile,
    event: 'appointment.confirmed',
    data: { code: String(appointment._id).slice(-6), time: appointment.bookedStart.toISOString() },
    idempotencyKey: `sms:confirmed:${appointment._id}`,
  });

  return { appointment, payment };
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
          data: { time: newEstimatedStart.toISOString() },
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

  // حداکثر ۷ روز جلو را بررسی می‌کنیم
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addMinutes(now, offset * 24 * 60);
    const dayKey = toDayKey(day);
    const appointments = await blockingAppointmentsForDay(barberId, dayKey, now);
    const slot = findFirstWalkInSlot({ shop, dayKey, durationMinutes: bs.durationMinutes, appointments, now });
    if (!slot) continue;
    const end = addMinutes(slot, bs.durationMinutes);
    // داخل قفل دوباره بررسی می‌کنیم (رقابت با رزرو آنلاین)
    return withBookingLock(barberId, dayKey, async () => {
      const fresh = await blockingAppointmentsForDay(barberId, dayKey, new Date());
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
  const candidates = await Appointment.find({
    status: APPOINTMENT_STATUS.CONFIRMED,
    noShowHold: { $ne: true },
    estimatedStart: { $lte: addMinutes(now, -settings.noShowGraceMinutes) },
  });
  let count = 0;
  for (const appt of candidates) {
    const before = appt.toObject();
    appt.status = APPOINTMENT_STATUS.NO_SHOW;
    await appt.save();
    await auditService.record({
      actor: { role: SYSTEM_ACTOR },
      action: 'appointment.noShow',
      entityType: 'appointments',
      entityId: appt._id,
      before,
      after: appt,
      meta: { auto: true },
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
  sendDueReminders,
  setNoShowHold,
  expireHolds,
  recalculateEstimated,
  getDayBoard,
  getMyAppointments,
  TRANSITIONS,
};
