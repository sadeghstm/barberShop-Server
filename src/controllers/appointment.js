'use strict';

const v = require('../helpers/validate');
const { AppError } = require('../helpers/AppError');
const { toTehranTime } = require('../helpers/schedule');
const { APPOINTMENT_STATUS: STATUS } = require('../constants/enums');
const shopService = require('../services/shop');
const barberService = require('../services/barber');
const appointmentService = require('../services/appointment');

const OUTCOMES = ['success', 'failure'];

/** موقتِ مهلت‌گذشته که هنوز پاکسازی نشده، به مشتری «منقضی» نشان داده می‌شود. */
function view({ appointment: a, shopName, barberName, serviceTitle }, now = new Date()) {
  const expiredHold = a.status === STATUS.HELD && a.heldUntil <= now;
  return {
    id: a._id,
    status: expiredHold ? STATUS.EXPIRED : a.status,
    shopId: a.shopId,
    shopName,
    barberId: a.barberId,
    barberName,
    serviceId: a.serviceId,
    serviceTitle,
    dayKey: a.dayKey,
    start: a.bookedStart,
    end: a.bookedEnd,
    time: toTehranTime(a.bookedStart),
    estimatedStart: a.estimatedStart,
    price: a.priceSnapshot,
    durationMinutes: a.durationSnapshot,
    depositAmount: a.depositAmount,
    heldUntil: a.status === STATUS.HELD ? a.heldUntil : null,
  };
}

const viewOne = async (appointment) => view((await appointmentService.withNames([appointment]))[0]);

/**
 * GET /api/shops/:shopId/barbers/:barberId/availability?serviceId=...&date=YYYY-MM-DD — عمومی
 * زمان‌های شروعِ قابل رزرو (به ترتیب). start زمان دقیق (UTC) و time ساعت تهران است.
 */
exports.availability = async (req, res) => {
  const shop = await shopService.getActiveOrThrow(v.objectId(req.params.shopId, 'shopId'));
  const barber = await barberService.getActiveInShopOrThrow(shop._id, v.objectId(req.params.barberId, 'barberId'));
  const serviceId = v.objectId(req.query.serviceId, 'serviceId');
  const dayKey = v.dayKey(req.query.date, 'date');

  const { durationMinutes, items } = await appointmentService.getAvailability({ shop, barber, serviceId, dayKey });
  res.json({ date: dayKey, durationMinutes, items: items.map((s) => ({ start: s.start, time: s.time })) });
};

/**
 * POST /api/appointments  { shopId, barberId, serviceId, start }
 * start همان start زمان‌های آزاد است. نوبت «موقت» ساخته می‌شود و تا heldUntil وقت پرداخت هست.
 */
exports.hold = async (req, res) => {
  const shop = await shopService.getActiveOrThrow(v.objectId(req.body?.shopId, 'shopId'));
  const barber = await barberService.getActiveInShopOrThrow(shop._id, v.objectId(req.body?.barberId, 'barberId'));
  const serviceId = v.objectId(req.body?.serviceId, 'serviceId');
  const start = v.datetime(req.body?.start, 'start');

  const { appointment, created } = await appointmentService.hold({ customer: req.auth, shop, barber, serviceId, start });

  if (created) {
    await req.audit({
      action: 'appointment.hold',
      entityType: 'appointments',
      entityId: appointment._id,
      before: null,
      after: appointment,
      meta: { shopId: shop._id, barberId: barber._id, serviceId },
    });
  }
  res.status(created ? 201 : 200).json({ appointment: await viewOne(appointment) });
};

/**
 * POST /api/appointments/:id/pay  { outcome?: 'success' | 'failure' }
 * پرداخت شبیه‌سازی‌شده؛ outcome نتیجه‌ی درگاه را مشخص می‌کند (پیش‌فرض success).
 */
exports.pay = async (req, res) => {
  const appointmentId = v.objectId(req.params.id, 'id');
  const outcome = v.oneOf(req.body?.outcome ?? 'success', 'outcome', OUTCOMES);

  const { result, appointment, payment } = await appointmentService.pay({ customer: req.auth, appointmentId, outcome });
  if (result === 'declined') throw AppError.paymentFailed('پرداخت ناموفق بود؛ نوبت آزاد شد و می‌توانید دوباره زمان بگیرید');

  if (result === 'confirmed') {
    await req.audit({
      action: 'appointment.confirm',
      entityType: 'appointments',
      entityId: appointment._id,
      before: { status: STATUS.HELD },
      after: { status: appointment.status },
      meta: { paymentId: payment._id, amount: payment.amount },
    });
  }
  res.json({
    appointment: await viewOne(appointment),
    payment: { id: payment._id, amount: payment.amount, status: payment.status },
  });
};

/** GET /api/appointments?page=&limit= — نوبت‌های خود مشتری، جدیدترین اول */
exports.listMine = async (req, res) => {
  const page = v.integer(req.query.page, { fallback: 1, max: 100000 });
  const limit = v.integer(req.query.limit, { fallback: 20, max: 50 });

  const { items, total } = await appointmentService.listMine(req.auth.userId, { page, limit });
  const now = new Date();
  res.json({ items: items.map((item) => view(item, now)), page, limit, total });
};

/** GET /api/appointments/:id — فقط نوبت خود مشتری */
exports.getOne = async (req, res) => {
  const item = await appointmentService.getMine(req.auth.userId, v.objectId(req.params.id, 'id'));
  res.json({ appointment: view(item) });
};
