'use strict';

const mongoose = require('mongoose');
const { PAYMENT_STATUSES, PAYMENT_STATUS, PAYMENT_PROVIDERS, PAYMENT_PROVIDER } = require('../../constants/enums');

const { Schema } = mongoose;
const isInt = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/**
 * هر پرداخت (بیعانه) یک موجودیت مستقل است (۵.۶). مبلغ = بخشی از کیف پول + بخشی از درگاه (شبیه‌سازی).
 * idempotencyKey یکتا: درخواست پرداخت تکراری دوبار ثبت نمی‌شود.
 */
const paymentSchema = new Schema(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true, immutable: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    amount: { type: Number, required: true, min: 0, validate: isInt, immutable: true },
    walletAmount: { type: Number, default: 0, min: 0, validate: isInt, immutable: true },
    gatewayAmount: { type: Number, default: 0, min: 0, validate: isInt, immutable: true },
    provider: { type: String, enum: PAYMENT_PROVIDERS, default: PAYMENT_PROVIDER.MOCK },
    providerRef: { type: String, default: null },
    status: { type: String, enum: PAYMENT_STATUSES, default: PAYMENT_STATUS.PENDING },
    idempotencyKey: { type: String, required: true, immutable: true },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { collection: 'payments', timestamps: true, versionKey: false },
);

paymentSchema.pre('validate', function amountsAddUp() {
  if (this.walletAmount + this.gatewayAmount !== this.amount) {
    this.invalidate('amount', 'walletAmount + gatewayAmount must equal amount');
  }
});

paymentSchema.index({ idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ appointmentId: 1 });
paymentSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
