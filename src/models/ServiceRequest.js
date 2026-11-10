'use strict';

const mongoose = require('mongoose');
const { SERVICE_REQUEST_STATUSES, SERVICE_REQUEST_STATUS } = require('../constants/enums');

const { Schema } = mongoose;

/** درخواست خدمت جدید توسط آرایشگر؛ ادمین تایید یا (با دلیل) رد می‌کند (۵.۵). فقط عنوان و توضیح. */
const serviceRequestSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true },
    barberId: { type: Schema.Types.ObjectId, ref: 'Barber', required: true, immutable: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: SERVICE_REQUEST_STATUSES, default: SERVICE_REQUEST_STATUS.PENDING },
    rejectReason: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
      validate: {
        validator(value) {
          return this.status !== SERVICE_REQUEST_STATUS.REJECTED || Boolean(value);
        },
        message: 'rejectReason is required when rejecting',
      },
    },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    serviceId: { type: Schema.Types.ObjectId, ref: 'ServiceCatalog', default: null }, // بعد از تایید/ادغام
  },
  { collection: 'serviceRequests', timestamps: true, versionKey: false },
);

serviceRequestSchema.index({ status: 1, createdAt: 1 });
serviceRequestSchema.index({ barberId: 1, createdAt: -1 });

module.exports = mongoose.models.ServiceRequest || mongoose.model('ServiceRequest', serviceRequestSchema);
