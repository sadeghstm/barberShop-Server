'use strict';

const appointmentService = require('../services/appointment');
const surveyService = require('../services/survey');
const shopService = require('../services/shop');
const { appointmentView, priceView, timeView } = require('../helpers/serialize');
const { DAY_KEY_PATTERN } = require('../constants/time');
const { AppError } = require('../helpers/AppError');
const { ROLES } = require('../constants/roles');

function requireDayKey(value) {
  if (!DAY_KEY_PATTERN.test(String(value ?? ''))) throw AppError.validation('dayKey باید به شکل YYYY-MM-DD باشد');
  return value;
}

/**
 * GET /api/shops/:shopId/barbers/:barberId/availability?serviceId=&dayKey=
 * زمان‌های آزاد روی شبکه ۵ دقیقه‌ای (بخش ۵.۱).
 */
exports.availability = async (req, res) => {
  const dayKey = requireDayKey(req.query.dayKey);
  const result = await appointmentService.getAvailability({
    shopId: req.params.shopId,
    barberId: req.params.barberId,
    serviceId: req.query.serviceId,
    dayKey,
  });
  const shop = await shopService.getShopById(req.params.shopId);

  const slots = result.slots.map((start) => {
    const view = timeView(start);
    return { start: view.iso, time: view.time, dayKey };
  });

  res.json({
    dayKey,
    durationMinutes: result.durationMinutes,
    price: priceView(result.price, { shop, authenticated: Boolean(req.auth) }),
    slots,
  });
};

/** POST /api/appointments/hold { shopId, barberId, serviceId, start } — ساخت نوبت موقت */
exports.createHold = async (req, res) => {
  const appointment = await appointmentService.createHold({
    shopId: req.body?.shopId,
    barberId: req.body?.barberId,
    serviceId: req.body?.serviceId,
    customerId: req.auth.userId,
    bookedStart: req.body?.start,
  });
  res.status(201).json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/pay { idempotencyKey, useWallet } — پرداخت شبیه‌سازی‌شده بیعانه */
exports.pay = async (req, res) => {
  const { appointment, payment } = await appointmentService.confirmWithPayment({
    appointmentId: req.params.id,
    customerId: req.auth.userId,
    idempotencyKey: req.body?.idempotencyKey,
    useWallet: req.body?.useWallet !== false,
    simulateFailure: req.body?.simulateFailure === true,
  });
  res.json({
    appointment: appointmentView(appointment),
    payment: {
      id: payment._id,
      amount: payment.amount,
      walletAmount: payment.walletAmount,
      gatewayAmount: payment.gatewayAmount,
      status: payment.status,
    },
  });
};

/** GET /api/appointments/mine?status=&page=&limit= */
exports.mine = async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const rows = await appointmentService.getMyAppointments({
    customerId: req.auth.userId,
    status: req.query.status,
    page,
    limit,
  });
  res.json({ appointments: rows.map(appointmentView), page, limit });
};

/** GET /api/appointments/:id — جزئیات (صاحب نوبت یا کارکنان آرایشگاه) */
exports.getOne = async (req, res) => {
  const Appointment = require('../models/Appointment');
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) throw AppError.notFound('نوبت یافت نشد');
  const isOwner = String(appointment.customerId) === String(req.auth.userId);
  const staffRoles = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SHOP_OWNER, ROLES.BARBER];
  const isStaff = req.auth.roles.some((r) => staffRoles.includes(r)) && String(req.auth.shopId) === String(appointment.shopId);
  const isPlatform = req.auth.roles.includes(ROLES.SUPER_ADMIN) || req.auth.roles.includes(ROLES.ADMIN);
  if (!isOwner && !isStaff && !isPlatform) throw AppError.forbidden();
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/cancel — مشتری */
exports.cancel = async (req, res) => {
  const appointment = await appointmentService.cancelByCustomer({
    appointmentId: req.params.id,
    customerId: req.auth.userId,
  });
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/cancel-request — آرایشگر/مالک درخواست لغو می‌دهد */
exports.requestCancel = async (req, res) => {
  const appointment = await appointmentService.requestCancelByBarber({
    appointmentId: req.params.id,
    actor: req.auth,
  });
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/cancel-request/decide { accept } — مشتری تصمیم می‌گیرد */
exports.decideCancelRequest = async (req, res) => {
  const appointment = await appointmentService.decideCancelRequest({
    appointmentId: req.params.id,
    customerId: req.auth.userId,
    accept: Boolean(req.body?.accept),
  });
  res.json({ appointment: appointmentView(appointment) });
};

/** GET /api/barbers/:barberId/board?dayKey= — تابلوی روز آرایشگر */
exports.board = async (req, res) => {
  const dayKey = requireDayKey(req.query.dayKey);
  const rows = await appointmentService.getDayBoard({
    barberId: req.params.barberId,
    dayKey,
    actor: req.auth,
  });
  res.json({ dayKey, appointments: rows.map(appointmentView) });
};

/** POST /api/appointments/:id/arrived — «حاضر شد» */
exports.arrived = async (req, res) => {
  const appointment = await appointmentService.markArrived({ appointmentId: req.params.id, actor: req.auth });
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/start — «شروع خدمت» */
exports.start = async (req, res) => {
  const appointment = await appointmentService.markStarted({ appointmentId: req.params.id, actor: req.auth });
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/complete { finalPrice, paidInPerson } — «تکمیل خدمت» */
exports.complete = async (req, res) => {
  const appointment = await appointmentService.markCompleted({
    appointmentId: req.params.id,
    actor: req.auth,
    finalPrice: req.body?.finalPrice,
    paidInPerson: req.body?.paidInPerson,
  });
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/no-show-hold { hold } */
exports.noShowHold = async (req, res) => {
  const appointment = await appointmentService.setNoShowHold({
    appointmentId: req.params.id,
    actor: req.auth,
    hold: req.body?.hold !== false,
  });
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/shops/:shopId/walk-ins { barberId, serviceId, walkInName, walkInMobile } */
exports.createWalkIn = async (req, res) => {
  const appointment = await appointmentService.createWalkIn({
    shopId: req.params.shopId,
    barberId: req.body?.barberId,
    serviceId: req.body?.serviceId,
    actor: req.auth,
    walkInName: req.body?.walkInName,
    walkInMobile: req.body?.walkInMobile,
    customerId: req.body?.customerId,
  });
  res.status(201).json({ appointment: appointmentView(appointment) });
};

/** POST /api/appointments/:id/survey { labels, comment } */
exports.createSurvey = async (req, res) => {
  const survey = await surveyService.createSurvey({
    customerId: req.auth.userId,
    appointmentId: req.params.id,
    labels: req.body?.labels,
    comment: req.body?.comment,
  });
  res.status(201).json({ survey });
};

/** GET /api/barbers/:barberId/survey-stats */
exports.barberSurveyStats = async (req, res) => {
  const stats = await surveyService.getSurveyStats({ barberId: req.params.barberId });
  res.json({ stats });
};
