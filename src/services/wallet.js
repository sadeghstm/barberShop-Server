'use strict';

const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const { WALLET_ACCOUNT, WALLET_TX_TYPE } = require('../constants/enums');
const { AppError } = require('../helpers/AppError');

// کیف پول (بخش ۵.۶ و ۵.۷): فقط از پورسانت و بازگشت بیعانه شارژ می‌شود، قابل خرج برای بیعانه است.
// برداشت ندارد. هر تراکنش idempotencyKey یکتا دارد تا درخواست تکراری دوبار اثر نکند.
// به‌روزرسانی موجودی اتمیک است ($inc) تا دو تراکنش هم‌زمان همدیگر را گم نکنند.

/** کیف پول کاربر را برمی‌گرداند؛ اگر نبود با موجودی صفر ساخته می‌شود. */
async function getOrCreateWallet(userId) {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    try {
      wallet = await Wallet.create({ userId, balance: 0 });
    } catch (err) {
      if (err.code === 11000) wallet = await Wallet.findOne({ userId });
      else throw err;
    }
  }
  return wallet;
}

async function getBalance(userId) {
  const wallet = await getOrCreateWallet(userId);
  return wallet.balance;
}

/**
 * یک تراکنش روی کیف پول کاربر ثبت می‌کند و موجودی را اتمیک به‌روز می‌کند.
 * amount علامت‌دار است (مثبت = افزایش). اگر idempotencyKey قبلاً ثبت شده باشد، همان تراکنش برگردانده می‌شود.
 */
async function applyTransaction({ userId, type, amount, idempotencyKey, refType = null, refId = null }) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw AppError.validation('مبلغ تراکنش کیف پول باید عدد صحیح غیرصفر باشد');
  }
  const existing = await WalletTransaction.findOne({ idempotencyKey });
  if (existing) return { transaction: existing, duplicated: true };

  await getOrCreateWallet(userId);

  // کاهش موجودی فقط اگر کافی باشد (شرط روی balance در همان به‌روزرسانی)
  const filter = amount < 0 ? { userId, balance: { $gte: -amount } } : { userId };
  const updated = await Wallet.findOneAndUpdate(filter, { $inc: { balance: amount } }, { new: true });
  if (!updated) throw AppError.conflict('موجودی کیف پول کافی نیست');

  try {
    const transaction = await WalletTransaction.create({
      account: WALLET_ACCOUNT.USER,
      userId,
      type,
      amount,
      balanceAfter: updated.balance,
      refType,
      refId,
      idempotencyKey,
    });
    return { transaction, duplicated: false };
  } catch (err) {
    // ثبت تراکنش شکست خورد: اثر تغییر موجودی برگردانده می‌شود
    await Wallet.updateOne({ userId }, { $inc: { balance: -amount } });
    if (err.code === 11000) {
      const transaction = await WalletTransaction.findOne({ idempotencyKey });
      return { transaction, duplicated: true };
    }
    throw err;
  }
}

/**
 * پورسانت معرفی (۵.۷): از حساب پلتفرم به کیف پول معرف.
 * کلید یکتا = commission:{appointmentId}
 */
async function creditCommission({ referrerId, amount, appointmentId }) {
  if (!referrerId || !amount || amount <= 0) return null;

  const { transaction, duplicated } = await applyTransaction({
    userId: referrerId,
    type: WALLET_TX_TYPE.COMMISSION,
    amount,
    idempotencyKey: `commission:${appointmentId}`,
    refType: 'appointments',
    refId: appointmentId,
  });
  if (duplicated) return transaction;

  // ثبت کسر از حساب پلتفرم در دفتر کل (بدون محدودیت موجودی در نسخه دانشگاهی)
  try {
    await WalletTransaction.create({
      account: WALLET_ACCOUNT.PLATFORM,
      type: WALLET_TX_TYPE.COMMISSION,
      amount: -amount,
      refType: 'appointments',
      refId: appointmentId,
      idempotencyKey: `commission-platform:${appointmentId}`,
    });
  } catch (err) {
    if (err.code !== 11000) throw err; // تکراری بودن یعنی قبلاً ثبت شده است
  }
  return transaction;
}

/** برگشت پورسانت (۵.۲: برگرداندن «تکمیل شده» فقط ادمین و با خنثی‌شدن پورسانت). */
async function reverseCommission({ referrerId, amount, appointmentId }) {
  if (!referrerId || !amount || amount <= 0) return null;

  const { transaction, duplicated } = await applyTransaction({
    userId: referrerId,
    type: WALLET_TX_TYPE.COMMISSION_REVERSAL,
    amount: -amount,
    idempotencyKey: `commission-reversal:${appointmentId}`,
    refType: 'appointments',
    refId: appointmentId,
  });
  if (duplicated) return transaction;

  try {
    await WalletTransaction.create({
      account: WALLET_ACCOUNT.PLATFORM,
      type: WALLET_TX_TYPE.COMMISSION_REVERSAL,
      amount,
      refType: 'appointments',
      refId: appointmentId,
      idempotencyKey: `commission-reversal-platform:${appointmentId}`,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return transaction;
}

/**
 * برگشت پورسانت یک نوبت (۵.۲): مبلغ و معرف از همان تراکنش اصلی خوانده می‌شود،
 * نه از درصد فعلی تنظیمات (درصد ممکن است بعداً عوض شده باشد).
 */
async function reverseCommissionForAppointment({ appointmentId }) {
  const commission = await WalletTransaction.findOne({ idempotencyKey: `commission:${appointmentId}` });
  if (!commission || !commission.userId || commission.amount <= 0) return null;
  return reverseCommission({
    referrerId: commission.userId,
    amount: commission.amount,
    appointmentId,
  });
}

/** مجموع پورسانت پرداخت‌شده بابت یک نوبت (برای نمایش در پنل ادمین). */
async function getCommissionForAppointment({ appointmentId }) {
  return WalletTransaction.findOne({ idempotencyKey: `commission:${appointmentId}` }).lean();
}

module.exports = {
  getOrCreateWallet,
  getBalance,
  applyTransaction,
  creditCommission,
  reverseCommission,
  reverseCommissionForAppointment,
  getCommissionForAppointment,
};
