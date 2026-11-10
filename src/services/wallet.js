'use strict';

const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const { WALLET_ACCOUNT, WALLET_TX_TYPE } = require('../constants/enums');
const { AppError } = require('../helpers/AppError');

// کیف پول (بخش ۵.۶ و ۵.۷): فقط از پورسانت و بازگشت بیعانه شارژ می‌شود، قابل خرج برای بیعانه است.
// هر تراکنش idempotencyKey یکتا دارد تا درخواست تکراری دوبار اثر نکند.

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
 * یک تراکنش روی کیف پول کاربر ثبت می‌کند و موجودی را به‌روز می‌کند.
 * amount علامت‌دار است (مثبت = افزایش). اگر idempotencyKey قبلاً ثبت شده باشد، همان تراکنش برگردانده می‌شود.
 */
async function applyTransaction({ userId, type, amount, idempotencyKey, refType = null, refId = null }) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw AppError.validation('مبلغ تراکنش کیف پول باید عدد صحیح غیرصفر باشد');
  }
  const existing = await WalletTransaction.findOne({ idempotencyKey });
  if (existing) return { transaction: existing, duplicated: true };

  const wallet = await getOrCreateWallet(userId);
  const nextBalance = wallet.balance + amount;
  if (nextBalance < 0) {
    throw AppError.conflict('موجودی کیف پول کافی نیست');
  }

  try {
    const transaction = await WalletTransaction.create({
      account: WALLET_ACCOUNT.USER,
      userId,
      type,
      amount,
      balanceAfter: nextBalance,
      refType,
      refId,
      idempotencyKey,
    });
    wallet.balance = nextBalance;
    await wallet.save();
    return { transaction, duplicated: false };
  } catch (err) {
    if (err.code === 11000) {
      const transaction = await WalletTransaction.findOne({ idempotencyKey });
      return { transaction, duplicated: true };
    }
    throw err;
  }
}

/** پورسانت معرفی (۵.۷): از حساب پلتفرم به کیف پول معرف. */
async function creditCommission({ referrerId, amount, appointmentId }) {
  if (!referrerId || !amount || amount <= 0) return null;
  const idempotencyKey = `commission:${appointmentId}`;
  const existing = await WalletTransaction.findOne({ idempotencyKey });
  if (existing) return existing;

  const wallet = await getOrCreateWallet(referrerId);
  const nextBalance = wallet.balance + amount;
  const transaction = await WalletTransaction.create({
    account: WALLET_ACCOUNT.USER,
    userId: referrerId,
    type: WALLET_TX_TYPE.COMMISSION,
    amount,
    balanceAfter: nextBalance,
    refType: 'appointments',
    refId: appointmentId,
    idempotencyKey,
  });
  wallet.balance = nextBalance;
  await wallet.save();

  // ثبت کسر از حساب پلتفرم (دفتر کل؛ بدون محدودیت موجودی در نسخه دانشگاهی)
  await WalletTransaction.create({
    account: WALLET_ACCOUNT.PLATFORM,
    type: WALLET_TX_TYPE.COMMISSION,
    amount: -amount,
    refType: 'appointments',
    refId: appointmentId,
    idempotencyKey: `commission-platform:${appointmentId}`,
  });
  return transaction;
}

/** برگشت پورسانت (۵.۲: برگرداندن «تکمیل شده» فقط ادمین و با خنثی‌شدن پورسانت). */
async function reverseCommission({ referrerId, amount, appointmentId }) {
  if (!referrerId || !amount || amount <= 0) return null;
  const idempotencyKey = `commission-reversal:${appointmentId}`;
  const existing = await WalletTransaction.findOne({ idempotencyKey });
  if (existing) return existing;

  const wallet = await getOrCreateWallet(referrerId);
  const nextBalance = Math.max(wallet.balance - amount, 0);
  const actual = wallet.balance - nextBalance;
  if (actual > 0) {
    const transaction = await WalletTransaction.create({
      account: WALLET_ACCOUNT.USER,
      userId: referrerId,
      type: WALLET_TX_TYPE.COMMISSION_REVERSAL,
      amount: -actual,
      balanceAfter: nextBalance,
      refType: 'appointments',
      refId: appointmentId,
      idempotencyKey,
    });
    wallet.balance = nextBalance;
    await wallet.save();
    await WalletTransaction.create({
      account: WALLET_ACCOUNT.PLATFORM,
      type: WALLET_TX_TYPE.COMMISSION_REVERSAL,
      amount: actual,
      refType: 'appointments',
      refId: appointmentId,
      idempotencyKey: `commission-reversal-platform:${appointmentId}`,
    });
    return transaction;
  }
  return null;
}

module.exports = {
  getOrCreateWallet,
  getBalance,
  applyTransaction,
  creditCommission,
  reverseCommission,
};
