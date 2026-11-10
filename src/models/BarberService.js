'use strict';

const mongoose = require('mongoose');
const { GRID_MINUTES } = require('../constants/time');

const { Schema } = mongoose;

// null یعنی «هنوز تعیین نشده» (۵.۵)؛ پس اعتبارسنجی عددی باید null را بپذیرد
const isInt = { validator: (v) => v == null || Number.isInteger(v), message: '{PATH} must be an integer' };

/**
 * فعال‌سازی یک خدمت توسط آرایشگر، با قیمت و مدت خودش (۵.۵). تا قبل از تعیین هر دو، رزرو‌پذیر نیست:
 * isActive فقط وقتی true می‌شود که price و durationMinutes مقدار داشته باشند.
 * قیمت: عدد صحیح به تومان. مدت: مضرب ۵ دقیقه (هم‌خوان با شبکه ۵ دقیقه‌ای رزرو).
 * shopId برای محدودسازی دسترسی به آرایشگاه (بخش ۴) تکرار شده است.
 */
const barberServiceSchema = new Schema(
  {
    barberId: { type: Schema.Types.ObjectId, ref: 'Barber', required: true, immutable: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'ServiceCatalog', required: true, immutable: true },
    price: { type: Number, default: null, min: 0, validate: isInt },
    durationMinutes: {
      type: Number,
      default: null,
      min: GRID_MINUTES,
      max: 480,
      validate: [isInt, { validator: (v) => v == null || v % GRID_MINUTES === 0, message: 'durationMinutes must be a multiple of 5' }],
    },
    isActive: {
      type: Boolean,
      default: false,
      // فعال‌سازی فقط وقتی قیمت و مدت تعیین شده باشد (قاعده در سطح فیلد تا validateSync هم آن را ببیند)
      validate: {
        validator(value) {
          return !value || (this.price != null && this.durationMinutes != null);
        },
        message: 'price and durationMinutes must be set before activating a service',
      },
    },
  },
  { collection: 'barberServices', timestamps: true, versionKey: false },
);

barberServiceSchema.index({ barberId: 1, serviceId: 1 }, { unique: true });
barberServiceSchema.index({ shopId: 1, serviceId: 1, isActive: 1 });
barberServiceSchema.index({ serviceId: 1, isActive: 1 });

module.exports = mongoose.models.BarberService || mongoose.model('BarberService', barberServiceSchema);
