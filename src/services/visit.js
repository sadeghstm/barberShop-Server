'use strict';

const Appointment = require('../models/Appointment');
const User = require('../models/User');
const settingsService = require('./settings');
const appointmentService = require('./appointment');
const dayPlan = require('./dayPlan');
const auditService = require('./audit');
const { withLock } = require('./lock');
const { AppError } = require('../helpers/AppError');
const { nextStatus } = require('../helpers/appointmentFlow');
const { computeFreeStarts, toDayKey } = require('../helpers/schedule');
const { SYSTEM_ACTOR, ROLES } = require('../constants/roles');
const { APPOINTMENT_STATUS: S, APPOINTMENT_SOURCE, BLOCKING_STATUSES } = require('../constants/enums');

const MINUTE = 60 * 1000;

// ---------------------------------------------------------------------------
// دسترسی: خود آرایشگرِ نوبت یا مالک همان آرایشگاه
// ---------------------------------------------------------------------------

function assertCanManageBarber(actor, shopId, barberId) {
  const inShop = actor.shopId && String(actor.shopId) === String(shopId);
  const isOwner = inShop && actor.roles?.includes(ROLES.SHOP_OWNER);
  const isSelf = inShop && actor.barberId && String(actor.barberId) === String(barberId);
  if (!isOwner && !isSelf) throw AppError.forbidden();
}

async function loadForStaff(actor, shopId, appointmentId) {
  const appointment = await Appointment.findOne({ _id: appointmentId, shopId });
  if (!appointment) throw AppError.notFound('نوبت یافت نشد');
  assertCanManageBarber(actor, shopId, appointment.barberId);
  return appointment;
}

// ---------------------------------------------------------------------------
// حاضر شد / شروع / پایان / عدم حضور
// ---------------------------------------------------------------------------

/**
 * یک کار روی نوبت را انجام می‌دهد: بررسی مجاز بودن، تغییر وضعیت (شرطی، تا دو درخواست هم‌زمان خراب نکنند)،
 * و محاسبه‌ی مجدد زمان‌های همان روز.
 * action: 'arrive' | 'start' | 'complete' | 'noShow'
 * extra (فقط complete): { finalPrice?, paidInPerson? }
 * خروجی: { appointment, before: { status }, plan }
 */
async function perform({ actor, shopId, appointmentId, action, extra = {}, now = new Date() }) {
  const appointment = await loadForStaff(actor, shopId, appointmentId);
  const to = nextStatus(action, appointment.status);

  const changes = { status: to };
  if (action === 'arrive') changes.arrivedAt = now;
  if (action === 'start') {
    changes.startedAt = now;
    changes.arrivedAt = appointment.arrivedAt ?? now;
    const busyWith = await Appointment.exists({ barberId: appointment.barberId, status: S.IN_PROGRESS });
    if (busyWith) throw AppError.conflict('این آرایشگر هنوز خدمت قبلی را تمام نکرده است', undefined, 'BARBER_BUSY');
  }
  if (action === 'complete') {
    const finalPrice = extra.finalPrice ?? appointment.priceSnapshot;
    changes.finishedAt = now;
    changes.finalPrice = finalPrice;
    changes.paidInPerson = extra.paidInPerson ?? Math.max(0, finalPrice - appointment.depositAmount);
  }
  if (action === 'noShow') {
    const settings = await settingsService.get();
    const allowedAt = appointment.estimatedStart.getTime() + settings.noShowGraceMinutes * MINUTE;
    if (now.getTime() < allowedAt) {
      throw AppError.conflict('هنوز مهلت حاضر شدن مشتری تمام نشده است', undefined, 'TOO_EARLY');
    }
  }

  const updated = await Appointment.findOneAndUpdate({ _id: appointment._id, status: appointment.status }, changes, { new: true });
  if (!updated) throw AppError.conflict('وضعیت نوبت همین الان تغییر کرد؛ دوباره تلاش کنید', undefined, 'INVALID_TRANSITION');

  const plan = ['start', 'complete', 'noShow'].includes(action)
    ? await dayPlan.recalculateDay({ barberId: updated.barberId, dayKey: updated.dayKey, actor, now })
    : null;
  return { appointment: updated, before: { status: appointment.status }, plan };
}

/** آرایشگر تصمیم عدم حضور خودکار را نگه می‌دارد (یا برمی‌دارد) — ۵.۳ سند. فقط برای نوبت تاییدشده. */
async function setNoShowHold({ actor, shopId, appointmentId, hold }) {
  const appointment = await loadForStaff(actor, shopId, appointmentId);
  if (appointment.status !== S.CONFIRMED) {
    throw AppError.conflict('فقط برای نوبت تاییدشده ممکن است', { from: appointment.status }, 'INVALID_TRANSITION');
  }
  const updated = await Appointment.findOneAndUpdate({ _id: appointment._id, status: S.CONFIRMED }, { noShowHold: hold }, { new: true });
  if (!updated) throw AppError.conflict('وضعیت نوبت همین الان تغییر کرد', undefined, 'INVALID_TRANSITION');
  return { appointment: updated, before: { noShowHold: appointment.noShowHold } };
}

// ---------------------------------------------------------------------------
// عدم حضور خودکار (کار دوره‌ای)
// ---------------------------------------------------------------------------

/**
 * نوبت تاییدشده‌ای که تا noShowGraceMinutes بعد از «زمان پیش‌بینی‌شده‌ی فعلی» حاضر نشده، «عدم حضور» می‌شود.
 * اگر آرایشگر تصمیم را نگه داشته (noShowHold) تا شروع نوبت فعال بعدی همان آرایشگر صبر می‌شود (۵.۳ سند).
 * خروجی: تعداد نوبت‌هایی که عدم حضور شدند
 */
async function autoNoShow(now = new Date(), limit = 200) {
  const settings = await settingsService.get();
  const cutoff = new Date(now.getTime() - settings.noShowGraceMinutes * MINUTE);
  const candidates = await Appointment.find({ status: S.CONFIRMED, estimatedStart: { $lte: cutoff } }).limit(limit);
  const system = { role: SYSTEM_ACTOR };
  let count = 0;

  for (const a of candidates) {
    if (a.noShowHold) {
      const next = await Appointment.findOne({
        barberId: a.barberId,
        dayKey: a.dayKey,
        status: { $in: [S.CONFIRMED, S.ARRIVED, S.IN_PROGRESS] },
        bookedStart: { $gt: a.bookedStart },
      }).sort({ bookedStart: 1 });
      if (!next || next.estimatedStart > now) continue; // نفر بعدی هنوز نرسیده؛ تصمیم آرایشگر محترم است
    }

    const updated = await Appointment.findOneAndUpdate({ _id: a._id, status: S.CONFIRMED }, { status: S.NO_SHOW }, { new: true });
    if (!updated) continue;
    count += 1;
    await auditService.record({
      actor: system,
      action: 'appointment.noShow',
      entityType: 'appointments',
      entityId: a._id,
      before: { status: S.CONFIRMED },
      after: { status: S.NO_SHOW },
      meta: { auto: true, held: a.noShowHold },
    });
    await dayPlan.recalculateDay({ barberId: a.barberId, dayKey: a.dayKey, actor: system, now });
  }
  return count;
}

// ---------------------------------------------------------------------------
// مشتری حضوری
// ---------------------------------------------------------------------------

/**
 * مشتری حضوری در اولین جای خالیِ کافی، از الان به بعد در برنامه‌ی همین آرایشگر قرار می‌گیرد (۵.۴ سند).
 * جای نوبتِ سوخته (عدم حضور) برای او آزاد است ولی هیچ نوبت تاییدشده‌ای را عقب نمی‌اندازد.
 * بلافاصله «حاضر شده» است؛ زمان رزرو = زمان قرارگرفتن در برنامه. بیعانه ندارد.
 * خروجی: { appointment }
 */
async function walkIn({ actor, shop, barber, serviceId, name, mobile, now = new Date() }) {
  assertCanManageBarber(actor, shop._id, barber._id);
  const offer = await appointmentService.getOfferOrThrow(barber, serviceId);
  const settings = await settingsService.get();
  const dayKey = toDayKey(now);

  const appointment = await withLock(`lock:booking:${barber._id}:${dayKey}`, async () => {
    const busy = await appointmentService.busyOf(barber._id, dayKey, BLOCKING_STATUSES);
    const params = appointmentService.scheduleParams({ shop, busy, dayKey, durationMinutes: offer.durationMinutes, settings, now });
    const [first] = computeFreeStarts({ ...params, minLeadMinutes: 0 });
    if (!first) throw AppError.conflict('امروز جای خالی کافی برای این خدمت نیست', undefined, 'NO_FREE_TIME');

    try {
      return await Appointment.create({
        shopId: shop._id,
        barberId: barber._id,
        serviceId,
        customerId: null,
        walkInName: name,
        walkInMobile: mobile ?? null,
        source: APPOINTMENT_SOURCE.WALK_IN,
        status: S.ARRIVED,
        arrivedAt: now,
        dayKey,
        bookedStart: first.start,
        bookedEnd: first.end,
        estimatedStart: first.start,
        estimatedEnd: first.end,
        priceSnapshot: offer.price,
        durationSnapshot: offer.durationMinutes,
        depositAmount: 0,
      });
    } catch (err) {
      throw appointmentService.translateDuplicate(err);
    }
  });
  return { appointment };
}

// ---------------------------------------------------------------------------
// تابلوی روز آرایشگر
// ---------------------------------------------------------------------------

/** همه‌ی نوبت‌های یک آرایشگر در یک روز (به‌جز منقضی‌ها)، با نام و موبایل مشتری. فقط خود آرایشگر یا مالک. */
async function getDay({ actor, shop, barber, dayKey, now = new Date() }) {
  assertCanManageBarber(actor, shop._id, barber._id);
  const rows = await Appointment.find({ barberId: barber._id, dayKey, status: { $ne: S.EXPIRED } }).sort({ bookedStart: 1 });
  const visible = rows.filter((a) => !(a.status === S.HELD && a.heldUntil <= now));

  const customerIds = [...new Set(visible.filter((a) => a.customerId).map((a) => String(a.customerId)))];
  const users = customerIds.length > 0 ? await User.find({ _id: { $in: customerIds } }).select('name mobile') : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const named = await appointmentService.withNames(visible);

  return named.map((item) => ({ ...item, customer: userById.get(String(item.appointment.customerId)) ?? null }));
}

module.exports = { perform, setNoShowHold, autoNoShow, walkIn, getDay };
