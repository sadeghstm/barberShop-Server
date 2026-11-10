'use strict';

const adminService = require('../services/admin');
const appointmentService = require('../services/appointment');
const settingsService = require('../services/settings');
const shopService = require('../services/shop');
const { appointmentView } = require('../helpers/serialize');
const { REFUND_DESTINATIONS } = require('../constants/enums');
const { AppError } = require('../helpers/AppError');

/** GET /api/admin/settings — تنظیمات سراسری */
exports.getSettings = async (req, res) => {
  const settings = await settingsService.getGlobalSettings();
  res.json({ settings });
};

/** PUT /api/admin/settings — فقط سوپر ادمین */
exports.updateSettings = async (req, res) => {
  const settings = await adminService.updateSettings({ actor: req.auth, patch: req.body });
  res.json({ settings });
};

/** GET /api/admin/payments */
exports.listPayments = async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const payments = await adminService.listPayments({ page, limit, status: req.query.status });
  res.json({ payments, page, limit });
};

/** GET /api/admin/refunds */
exports.listRefunds = async (req, res) => {
  const refunds = await adminService.listRefunds({});
  res.json({ refunds });
};

/** POST /api/admin/payments/:paymentId/refund { amount, destination, reason, idempotencyKey } */
exports.refund = async (req, res) => {
  const destination = req.body?.destination ?? 'wallet';
  if (!REFUND_DESTINATIONS.includes(destination)) throw AppError.validation('مقصد بازگشت وجه معتبر نیست');
  const refund = await adminService.refundPayment({
    actor: req.auth,
    paymentId: req.params.paymentId,
    amount: req.body?.amount,
    destination,
    reason: req.body?.reason,
    idempotencyKey: req.body?.idempotencyKey,
  });
  res.status(201).json({ refund });
};

/** GET /api/admin/users?q= */
exports.listUsers = async (req, res) => {
  const users = await adminService.listUsers({ q: req.query.q, page: Number(req.query.page) || 1, limit: 20 });
  res.json({ users });
};

/** PUT /api/admin/users/:userId/roles { roles } — سوپر ادمین */
exports.setUserRoles = async (req, res) => {
  const user = await adminService.setUserRoles({
    actor: req.auth,
    userId: req.params.userId,
    roles: req.body?.roles,
  });
  res.json({ user: { id: user._id, mobile: user.mobile, roles: user.roles } });
};

/** GET /api/admin/audit-logs?entityType=&action=&actorId= */
exports.listAuditLogs = async (req, res) => {
  const logs = await adminService.listAuditLogs({
    entityType: req.query.entityType,
    entityId: req.query.entityId,
    action: req.query.action,
    actorId: req.query.actorId,
    page: Number(req.query.page) || 1,
    limit: Math.min(Number(req.query.limit) || 50, 200),
  });
  res.json({ logs });
};

/** GET /api/admin/stats */
exports.stats = async (req, res) => {
  const stats = await adminService.getDashboardStats();
  res.json({ stats });
};

/** GET /api/admin/users/:userId/wallet */
exports.userWallet = async (req, res) => {
  const data = await adminService.getUserWalletLedger(req.params.userId);
  res.json(data);
};

/** POST /api/admin/admins { mobile } — سوپر ادمین */
exports.createAdmin = async (req, res) => {
  const user = await adminService.createAdmin({ actor: req.auth, mobile: req.body?.mobile });
  res.status(201).json({ user: { id: user._id, mobile: user.mobile, roles: user.roles } });
};

/** PUT /api/admin/users/:userId/active { isActive } */
exports.setUserActive = async (req, res) => {
  const user = await adminService.setUserActive({
    actor: req.auth,
    userId: req.params.userId,
    isActive: Boolean(req.body?.isActive),
  });
  res.json({ user: { id: user._id, mobile: user.mobile, isActive: user.isActive } });
};

/** GET /api/admin/stats/daily?from=YYYY-MM-DD&to=YYYY-MM-DD */
exports.dailyStats = async (req, res) => {
  const days = await adminService.getDailyStats({ from: req.query.from, to: req.query.to });
  res.json({ days });
};

/** GET /api/admin/appointments?status=&shopId=&barberId=&from=&to=&page=&limit= */
exports.listAppointments = async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const result = await adminService.listAppointments({
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
    shopId: req.query.shopId,
    barberId: req.query.barberId,
    customerId: req.query.customerId,
    page,
    limit,
  });
  res.json({ appointments: result.rows.map(appointmentView), total: result.total, page, limit });
};

/** GET /api/admin/cancel-requests — درخواست‌های لغو در انتظار مشتری */
exports.pendingCancelRequests = async (req, res) => {
  const result = await adminService.listPendingCancelRequests({});
  res.json({ appointments: result.rows.map(appointmentView), total: result.total });
};

/** POST /api/admin/appointments/:id/cancel { reason } — لغو اجباری ادمین با بازگشت کامل بیعانه */
exports.forceCancel = async (req, res) => {
  const appointment = await appointmentService.forceCancelByAdmin({
    appointmentId: req.params.id,
    actor: req.auth,
    reason: req.body?.reason,
  });
  res.json({ appointment: appointmentView(appointment) });
};

/** POST /api/admin/appointments/:id/revert { reason } — برگشت «تکمیل شده» با خنثی‌سازی پورسانت */
exports.revertCompletion = async (req, res) => {
  const appointment = await appointmentService.revertCompletion({
    appointmentId: req.params.id,
    actor: req.auth,
    reason: req.body?.reason,
  });
  res.json({ appointment: appointmentView(appointment) });
};

/** GET /api/admin/shops?city=&isActive=&page=&limit= */
exports.listShops = async (req, res) => {
  const isActiveParam = req.query.isActive;
  const result = await shopService.listAllShops({
    city: req.query.city,
    isActive: isActiveParam === undefined ? undefined : isActiveParam === 'true',
    page: Number(req.query.page) || 1,
    limit: Math.min(Number(req.query.limit) || 50, 200),
  });
  res.json({ shops: result.rows, total: result.total, page: result.page, limit: result.limit });
};

/** POST /api/admin/shops/:shopId/deactivate { reason } */
exports.deactivateShop = async (req, res) => {
  const shop = await shopService.deactivateShop({
    shopId: req.params.shopId,
    actor: req.auth,
    reason: req.body?.reason,
  });
  res.json({ shop });
};

/** POST /api/admin/shops/:shopId/activate */
exports.activateShop = async (req, res) => {
  const shop = await shopService.activateShop({ shopId: req.params.shopId, actor: req.auth });
  res.json({ shop });
};

/** POST /api/admin/shops/:shopId/transfer-ownership { newOwnerUserId } */
exports.transferOwnership = async (req, res) => {
  const result = await shopService.transferOwnership({
    shopId: req.params.shopId,
    actor: req.auth,
    newOwnerUserId: req.body?.newOwnerUserId,
  });
  res.json({ shop: result.shop, barber: result.barber });
};

/** POST /api/admin/jobs/expire-holds — اجرای دستی پاکسازی موقت‌ها */
exports.expireHolds = async (req, res) => {
  const count = await appointmentService.expireHolds();
  res.json({ expired: count });
};

/** POST /api/admin/jobs/no-show — اجرای دستی بررسی عدم حضور */
exports.runNoShow = async (req, res) => {
  const count = await appointmentService.markNoShows();
  res.json({ marked: count });
};
