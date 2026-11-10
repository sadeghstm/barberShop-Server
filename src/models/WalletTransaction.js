'use strict';

const mongoose = require('mongoose');
const { WALLET_TX_TYPES, WALLET_ACCOUNTS, WALLET_ACCOUNT } = require('../constants/enums');

const { Schema } = mongoose;

/**
 * دفتر کل (فقط افزودنی). amount علامت‌دار است: مثبت = افزایش، منفی = کاهش.
 * account='platform' برای حساب صاحب پلتفرم (پورسانت از آن کسر می‌شود، بدون محدودیت موجودی)؛ در آن حالت userId خالی است.
 * idempotencyKey یکتا، مثلاً commission:{appointmentId} و commission-reversal:{appointmentId} (۵.۷).
 */
const walletTransactionSchema = new Schema(
  {
    account: { type: String, enum: WALLET_ACCOUNTS, default: WALLET_ACCOUNT.USER, immutable: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true,
      // حساب کاربری باید userId داشته باشد؛ حساب پلتفرم نباید (۵.۷)
      validate: {
        validator(value) {
          return this.account === WALLET_ACCOUNT.PLATFORM ? !value : Boolean(value);
        },
        message: 'userId is required for user account and forbidden for platform account',
      },
    },
    type: { type: String, enum: WALLET_TX_TYPES, required: true, immutable: true },
    amount: {
      type: Number,
      required: true,
      immutable: true,
      validate: [
        { validator: Number.isInteger, message: 'amount must be an integer' },
        { validator: (v) => v !== 0, message: 'amount must not be zero' },
      ],
    },
    balanceAfter: { type: Number, default: null, immutable: true }, // برای حساب کاربر پر می‌شود
    refType: { type: String, default: null, immutable: true }, // مثل appointments / refunds
    refId: { type: Schema.Types.ObjectId, default: null, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { collection: 'walletTransactions', versionKey: false },
);

walletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ refType: 1, refId: 1 });

module.exports = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);
