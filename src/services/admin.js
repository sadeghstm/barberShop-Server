'use strict';

// کارهای ادمین/سوپر ادمین (بخش ۴ و ۵.۶ سند): تنظیمات سراسری، بازگشت وجه، کاربران، لاگ‌ها.

const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const AuditLog = require('../models/AuditLog');
const { PAYMENT_STATUS, REFUND_STATUS, REFUND_DESTINATION, WALLET_TX_TYPE, APPOINTMENT_STATUS } = require('../constants/enums');
const { ROLES } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const auditService = require('./audit');
const walletService = require('./wallet');
const settingsService = require('./settings');

async function listPayments({ page = 1, limit = 20, status }) {
  const query = {};
  if (status) query.status = status;
  return Payment.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
}

async function listRefunds({ page = 1, limit = 20 }) {
  return Refund.find({}).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
}

/**
 * بازگشت وجه دستی توسط ادمین (۵.۶).
 * مقصد کیف پول: فوراً به کیف پول اضافه می‌شود. مقصد بانک: شبیه‌سازی و فقط ثبت.
 * idempotencyKey از سمت کلاینت یا به‌طور پیش‌فرض از شناسه پرداخت ساخته می‌شود.
 */
async function refundPayment({ actor, paymentId, amount, destination = REFUND_DESTINATION.WALLET, reason, idempotencyKey }) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw AppError.notFound('پرداخت یافت نشد');
  if (payment.status !== PAYMENT_STATUS.SUCCEEDED) throw AppError.conflict('فقط پرداخت موفق قابل بازگشت است');
  if (!Number.isInteger(amount) || amount <= 0) throw AppError.validation('مبلغ بازگشت باید عدد صحیح مثبت باشد');
  if (amount > payment.amount) throw AppError.validation('مبلغ بازگشت بیشتر از مبلغ پرداخت است');
  if (!reason) throw AppError.validation('دلیل بازگشت وجه الزامی است');

  const alreadyRefunded = await Refund.find({ paymentId: payment._id, status: REFUND_STATUS.DONE }).lean();
  const sum = alreadyRefunded.reduce((acc, r) => acc + r.amount, 0);
  if (sum + amount > payment.amount) throw AppError.conflict('مجموع بازگشت‌ها از مبلغ پرداخت بیشتر می‌شود');

  const key = idempotencyKey ?? `refund:admin:${payment._id}:${sum + amount}`;
  const existing = await Refund.findOne({ idempotencyKey: key });
  if (existing) return existing;

  const refund = await Refund.create({
    paymentId: payment._id,
    appointmentId: payment.appointmentId,
    customerId: payment.customerId,
    amount,
    destination,
    status: destination === REFUND_DESTINATION.WALLET ? REFUND_STATUS.DONE : REFUND_STATUS.PENDING,
    reason,
    createdBy: actor.userId,
    idempotencyKey: key,
  });

  if (destination === REFUND_DESTINATION.WALLET) {
    await walletService.applyTransaction({
      userId: payment.customerId,
      type: WALLET_TX_TYPE.DEPOSIT_REFUND,
      amount,
      idempotencyKey: `wallet-refund:${refund._id}`,
      refType: 'refunds',
      refId: refund._id,
    });
  }

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'payment.refund',
    entityType: 'refunds',
    entityId: refund._id,
    after: refund,
    meta: { paymentId: payment._id, amount, destination },
  });
  return refund;
}

/** تنظیمات سراسری — خواندن برای همه، نوشتن فقط سوپر ادمین. */
async function getSettings() {
  return settingsService.getGlobalSettings();
}

async function updateSettings({ actor, patch }) {
  const before = (await settingsService.getGlobalSettings()).toObject();
  const doc = await settingsService.updateGlobalSettings(patch);
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'settings.update',
    entityType: 'settings',
    entityId: doc._id,
    before,
    after: doc,
  });
  return doc;
}

/** تغییر نقش کاربران توسط سوپر ادمین (فقط نقش‌های سراسری: admin/customer/superAdmin). */
async function setUserRoles({ actor, userId, roles }) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد');
  const allowed = [ROLES.ADMIN, ROLES.CUSTOMER, ROLES.SUPER_ADMIN];
  if (!Array.isArray(roles) || roles.length === 0) throw AppError.validation('حداقل یک نقش لازم است');
  if (roles.some((r) => !allowed.includes(r))) {
    throw AppError.validation('فقط نقش‌های سراسری قابل تخصیص هستند (shopOwner/barber از روی آرایشگاه محاسبه می‌شوند)');
  }
  const before = user.toObject();
  user.roles = [...new Set(roles)];
  await user.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'user.setRoles',
    entityType: 'users',
    entityId: user._id,
    before,
    after: user,
  });
  return user;
}

async function listUsers({ q, page = 1, limit = 20 }) {
  const query = {};
  if (q) query.mobile = { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  return User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
}

async function listAuditLogs({ entityType, entityId, action, actorId, page = 1, limit = 50 }) {
  const query = {};
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (action) query.action = action;
  if (actorId) query['actor.userId'] = actorId;
  return AuditLog.find(query).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean();
}

/** خلاصه داشبورد ادمین پلتفرم. */
async function getDashboardStats() {
  const [appointments, completed, cancelled, noShow, usersCount, payments] = await Promise.all([
    Appointment.countDocuments({}),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.COMPLETED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.CANCELLED }),
    Appointment.countDocuments({ status: APPOINTMENT_STATUS.NO_SHOW }),
    User.countDocuments({ isActive: true }),
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.SUCCEEDED } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);
  const totalRevenue = payments[0]?.total ?? 0;
  return {
    usersCount,
    appointments,
    completed,
    cancelled,
    noShow,
    depositsTotal: totalRevenue,
  };
}

/** ساخت ادمین با شماره موبایل (سوپر ادمین). کاربر اگر نباشد ساخته می‌شود. */
async function createAdmin({ actor, mobile }) {
  const { normalizeMobile } = require('../helpers/mobile');
  const normalized = normalizeMobile(mobile);
  if (!normalized) throw AppError.validation('شماره موبایل معتبر نیست');

  let user = await User.findOne({ mobile: normalized });
  const before = user ? user.toObject() : null;
  if (!user) {
    user = await User.create({ mobile: normalized, roles: [ROLES.ADMIN, ROLES.CUSTOMER] });
  } else if (!user.roles.includes(ROLES.ADMIN)) {
    user.roles = [...new Set([...user.roles, ROLES.ADMIN])];
    await user.save();
  }

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'user.createAdmin',
    entityType: 'users',
    entityId: user._id,
    before,
    after: user,
  });
  return user;
}

/** فعال/غیرفعال کردن کاربر (ادمین). کاربر غیرفعال نمی‌تواند وارد شود. */
async function setUserActive({ actor, userId, isActive }) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد');
  if (Boolean(user.isActive) === Boolean(isActive)) return user; // بدون تغییر
  const before = user.toObject();
  user.isActive = Boolean(isActive);
  await user.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: isActive ? 'user.activate' : 'user.deactivate',
    entityType: 'users',
    entityId: user._id,
    before,
    after: user,
  });
  return user;
}

/**
 * آمار ساده روزانه (فاز ۳): به ازای هر dayKey تهران تعداد نوبت‌ها به تفکیک وضعیت،
 * مبلغ نهایی خدمات تکمیل‌شده و بیعانه‌های موفق.
 */
async function getDailyStats({ from, to }) {
  const match = {};
  if (from || to) {
    match.dayKey = {};
    if (from) match.dayKey.$gte = from;
    if (to) match.dayKey.$lte = to;
  }

  const rows = await Appointment.aggregate([
    { $match: match },
    {
      $group: {
        _id: { dayKey: '$dayKey', status: '$status' },
        count: { $sum: 1 },
        finalTotal: { $sum: { $ifNull: ['$finalPrice', 0] } },
        depositTotal: { $sum: { $ifNull: ['$depositAmount', 0] } },
      },
    },
    { $sort: { '_id.dayKey': 1 } },
  ]);

  const byDay = new Map();
  for (const row of rows) {
    const dayKey = row._id.dayKey;
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, {
        dayKey,
        total: 0,
        statuses: {},
        completedRevenue: 0,
        deposits: 0,
      });
    }
    const day = byDay.get(dayKey);
    day.total += row.count;
    day.statuses[row._id.status] = row.count;
    if (row._id.status === APPOINTMENT_STATUS.COMPLETED) day.completedRevenue += row.finalTotal;
    if (row._id.status === APPOINTMENT_STATUS.COMPLETED || row._id.status === APPOINTMENT_STATUS.CONFIRMED) {
      day.deposits += row.depositTotal;
    }
  }

  return [...byDay.values()];
}

/** نوبت‌های کل پلتفرم با فیلتر (پنل ادمین). */
async function listAppointments({ from, to, status, shopId, barberId, customerId, page = 1, limit = 50 }) {
  const query = {};
  if (status) query.status = status;
  if (shopId) query.shopId = shopId;
  if (barberId) query.barberId = barberId;
  if (customerId) query.customerId = customerId;
  if (from || to) {
    query.dayKey = {};
    if (from) query.dayKey.$gte = from;
    if (to) query.dayKey.$lte = to;
  }
  const [rows, total] = await Promise.all([
    Appointment.find(query)
      .sort({ bookedStart: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Appointment.countDocuments(query),
  ]);
  return { rows, total, page, limit };
}

/** درخواست‌های لغو در انتظار تصمیم مشتری (برای پیگیری ادمین). */
async function listPendingCancelRequests({ page = 1, limit = 50 }) {
  const query = { 'cancelRequest.status': 'pending' };
  const [rows, total] = await Promise.all([
    Appointment.find(query)
      .sort({ 'cancelRequest.requestedAt': 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Appointment.countDocuments(query),
  ]);
  return { rows, total, page, limit };
}

/** دفتر کل کیف پول یک کاربر (برای پشتیبانی). */
async function getUserWalletLedger(userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد');
  const wallet = await walletService.getOrCreateWallet(userId);
  const transactions = await WalletTransaction.find({ userId }).sort({ createdAt: -1 }).limit(100).lean();
  return { userId, balance: wallet.balance, transactions };
}

module.exports = {
  listPayments,
  setUserActive,
  createAdmin,
  getDailyStats,
  listAppointments,
  listPendingCancelRequests,
  listRefunds,
  refundPayment,
  getSettings,
  updateSettings,
  setUserRoles,
  listUsers,
  listAuditLogs,
  getDashboardStats,
  getUserWalletLedger,
};
