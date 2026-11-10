'use strict';

const mongoose = require('mongoose');
const { REFUND_DESTINATIONS, REFUND_DESTINATION, REFUND_STATUSES, REFUND_STATUS } = require('../constants/enums');

const { Schema } = mongoose;

/** بازگشت وجه؛ موجودیت جدا از پرداخت، ثبت توسط ادمین یا سیاست لغو (۵.۶). مقصد bank فعلاً mock است. */
const refundSchema = new Schema(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, immutable: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true, immutable: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    amount: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'amount must be an integer' }, immutable: true },
    destination: { type: String, enum: REFUND_DESTINATIONS, default: REFUND_DESTINATION.WALLET, immutable: true },
    status: { type: String, enum: REFUND_STATUSES, default: REFUND_STATUS.PENDING },
    reason: { type: String, trim: true, maxlength: 300, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null = سیاست خودکار
    idempotencyKey: { type: String, required: true, immutable: true },
  },
  { collection: 'refunds', timestamps: true, versionKey: false },
);

refundSchema.index({ idempotencyKey: 1 }, { unique: true });
refundSchema.index({ paymentId: 1 });
refundSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.models.Refund || mongoose.model('Refund', refundSchema);
