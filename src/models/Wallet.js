'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/** کیف پول هر کاربر. balance فقط از طریق تراکنش‌های walletTransactions (گام فاز ۳) تغییر می‌کند؛ منفی نمی‌شود. */
const walletSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    balance: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'balance must be an integer' } },
  },
  { collection: 'wallets', timestamps: true, versionKey: false },
);

walletSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
