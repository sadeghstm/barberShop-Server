'use strict';

const v = require('../helpers/validate');
const { normalizeMobile } = require('../helpers/mobile');
const { AppError } = require('../helpers/AppError');
const { toTehranTime } = require('../helpers/schedule');
const shopService = require('../services/shop');
const barberService = require('../services/barber');
const visitService = require('../services/visit');
const appointmentService = require('../services/appointment');

/** نمای آرایشگر از یک نوبت: شامل مشتری و زمان پیش‌بینی‌شده */
function staffView({ appointment: a, serviceTitle, customer }) {
  return {
    id: a._id,
    status: a.status,
    source: a.source,
    serviceId: a.serviceId,
    serviceTitle,
    customer: customer ? { name: customer.name, mobile: customer.mobile } : a.walkInName ? { name: a.walkInName, mobile: a.walkInMobile } : null,
    start: a.bookedStart,
    end: a.bookedEnd,
    time: toTehranTime(a.bookedStart),
    estimatedStart: a.estimatedStart,
    estimatedEnd: a.estimatedEnd,
    estimatedTime: toTehranTime(a.estimatedStart),
    durationMinutes: a.durationSnapshot,
    price: a.priceSnapshot,
    depositAmount: a.depositAmount,
    arrivedAt: a.arrivedAt,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    noShowHold: a.noShowHold,
    finalPrice: a.finalPrice,
    paidInPerson: a.paidInPerson,
  };
}

const one = async (appointment) => staffView((await appointmentService.withNames([appointment]))[0]);

/** GET /api/shops/:shopId/barbers/:barberId/schedule?date=YYYY-MM-DD — برنامه‌ی روز (خود آرایشگر یا مالک) */
exports.daySchedule = async (req, res) => {
  const shop = await shopService.getOrThrow(v.objectId(req.params.shopId, 'shopId'));
  const barber = await barberService.getInShopOrThrow(shop._id, v.objectId(req.params.barberId, 'barberId'));
  const dayKey = v.dayKey(req.query.date, 'date');

  const items = await visitService.getDay({ actor: req.auth, shop, barber, dayKey });
  res.json({ date: dayKey, items: items.map(staffView) });
};

/** یک کار روی نوبت + ثبت در auditLogs + پاسخ با نوبت و نتیجه‌ی محاسبه‌ی مجدد */
function action(name, auditAction, readExtra = () => ({})) {
  return async (req, res) => {
    const shopId = v.objectId(req.params.shopId, 'shopId');
    const appointmentId = v.objectId(req.params.id, 'id');
    const extra = readExtra(req.body ?? {});

    const { appointment, before, plan } = await visitService.perform({ actor: req.auth, shopId, appointmentId, action: name, extra });
    await req.audit({
      action: auditAction,
      entityType: 'appointments',
      entityId: appointment._id,
      before,
      after: { status: appointment.status },
      meta: { shopId, barberId: appointment.barberId },
    });
    res.json({
      appointment: await one(appointment),
      plan: plan && { changed: plan.changed.length, notify: plan.notify.length, overflow: plan.overflow.length },
    });
  };
}

/** POST /api/shops/:shopId/appointments/:id/arrive — مشتری رسید */
exports.arrive = action('arrive', 'appointment.arrive');
/** POST .../start — شروع خدمت (اگر حضور ثبت نشده بود، همزمان ثبت می‌شود) */
exports.start = action('start', 'appointment.start');
/** POST .../complete  { finalPrice?, paidInPerson? } — پایان خدمت */
exports.complete = action('complete', 'appointment.complete', (body) => ({
  finalPrice: v.int(body.finalPrice, 'finalPrice', { optional: true, min: 0, max: 100000000 }),
  paidInPerson: v.int(body.paidInPerson, 'paidInPerson', { optional: true, min: 0, max: 100000000 }),
}));
/** POST .../no-show — عدم حضور دستی (بعد از پایان مهلت) */
exports.noShow = action('noShow', 'appointment.noShow');

/** PATCH /api/shops/:shopId/appointments/:id/no-show-hold  { hold } — نگه‌داشتن تصمیم عدم حضور خودکار */
exports.noShowHold = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  const appointmentId = v.objectId(req.params.id, 'id');
  const hold = v.boolean(req.body?.hold, 'hold');

  const { appointment, before } = await visitService.setNoShowHold({ actor: req.auth, shopId, appointmentId, hold });
  await req.audit({
    action: 'appointment.noShowHold',
    entityType: 'appointments',
    entityId: appointment._id,
    before,
    after: { noShowHold: appointment.noShowHold },
    meta: { shopId, barberId: appointment.barberId },
  });
  res.json({ appointment: await one(appointment) });
};

/** POST /api/shops/:shopId/barbers/:barberId/walk-ins  { name, serviceId, mobile? } — مشتری حضوری */
exports.walkIn = async (req, res) => {
  const shop = await shopService.getActiveOrThrow(v.objectId(req.params.shopId, 'shopId'));
  const barber = await barberService.getActiveInShopOrThrow(shop._id, v.objectId(req.params.barberId, 'barberId'));
  const name = v.string(req.body?.name, 'name', { min: 2, max: 80 });
  const serviceId = v.objectId(req.body?.serviceId, 'serviceId');

  let mobile;
  if (req.body?.mobile !== undefined && req.body.mobile !== null && req.body.mobile !== '') {
    mobile = normalizeMobile(req.body.mobile);
    if (!mobile) throw AppError.validation('شماره موبایل نامعتبر است', [{ field: 'mobile', message: 'mobile نامعتبر است' }]);
  }

  const { appointment } = await visitService.walkIn({ actor: req.auth, shop, barber, serviceId, name, mobile });
  await req.audit({
    action: 'appointment.walkIn',
    entityType: 'appointments',
    entityId: appointment._id,
    before: null,
    after: appointment,
    meta: { shopId: shop._id, barberId: barber._id, serviceId },
  });
  res.status(201).json({ appointment: await one(appointment) });
};
