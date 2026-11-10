'use strict';

const adminService = require('../services/admin');
const appointmentService = require('../services/appointment');
const settingsService = require('../services/settings');
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
