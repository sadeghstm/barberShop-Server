'use strict';

// معرفی دوستان (بخش ۵.۷): هر کاربر یک کد معرف دارد، هر کاربر فقط یک معرف می‌تواند داشته باشد
// و بعد از ثبت قابل تغییر نیست. پورسانت در لحظه «تکمیل شده» به کیف پول معرف اضافه می‌شود.

const User = require('../models/User');
const Referral = require('../models/Referral');
const WalletTransaction = require('../models/WalletTransaction');
const { config } = require('../config');
const { WALLET_TX_TYPE } = require('../constants/enums');
const { AppError } = require('../helpers/AppError');
const auditService = require('./audit');
const walletService = require('./wallet');

/** اطلاعات معرفی من: کد، تعداد دعوت‌شده و مجموع پورسانت. */
async function getMyReferralInfo(userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد');

  const invitedCount = await User.countDocuments({ referredBy: userId });
  const commissions = await WalletTransaction.find({
    userId,
    type: WALLET_TX_TYPE.COMMISSION,
  }).lean();
  const totalCommission = commissions.reduce((sum, tx) => sum + (tx.amount > 0 ? tx.amount : 0), 0);

  const base = (config.appBaseUrl || '').replace(/\/$/, '');
  return {
    referralCode: user.referralCode,
    referralLink: base ? `${base}/register?ref=${user.referralCode}` : null,
    invitedCount,
    totalCommission,
    commissionHistory: commissions
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20)
      .map((tx) => ({ amount: tx.amount, refId: tx.refId, createdAt: tx.createdAt })),
  };
}

/** ثبت کد معرف (فقط یک‌بار و فقط قبل از داشتن معرف). */
async function applyReferralCode({ userId, code }) {
  const normalized = String(code ?? '').trim().toUpperCase();
  if (!normalized) throw AppError.validation('کد معرف الزامی است');

  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد');
  if (user.referredBy) throw AppError.conflict('شما قبلاً کد معرف ثبت کرده‌اید');

  const referrer = await User.findOne({ referralCode: normalized });
  if (!referrer) throw AppError.notFound('کد معرف معتبر نیست');
  if (String(referrer._id) === String(user._id)) throw AppError.validation('نمی‌توانید کد خودتان را وارد کنید');

  user.referredBy = referrer._id;
  await user.save();

  // ثبت پیوند معرفی (refereeId یکتاست، پس یک کاربر فقط یک معرف دارد)
  const existingReferral = await Referral.findOne({ refereeId: user._id });
  if (!existingReferral) {
    await Referral.create({ referrerId: referrer._id, refereeId: user._id, code: normalized });
  }

  await auditService.record({
    actor: { userId: user._id, role: 'customer' },
    action: 'user.applyReferral',
    entityType: 'users',
    entityId: user._id,
    after: { referredBy: referrer._id },
  });
  return { referredBy: referrer._id, referralCode: referrer.referralCode };
}

/** موجودی کیف پول من (برای نمایش در پروفایل). */
async function getMyWallet(userId) {
  const balance = await walletService.getBalance(userId);
  const transactions = await WalletTransaction.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
  return {
    balance,
    transactions: transactions.map((t) => ({
      id: t._id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      refType: t.refType,
      refId: t.refId,
      createdAt: t.createdAt,
    })),
  };
}

module.exports = { getMyReferralInfo, applyReferralCode, getMyWallet };
