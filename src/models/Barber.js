'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * کاربر + آرایشگاه. مالک هم یک سند Barber با isOwner=true دارد (او آرایشگر هم هست).
 * قید «هر کاربر فقط در یک آرایشگاه آرایشگر فعال است» و «هر آرایشگاه یک مالک فعال» با ایندکس یکتای جزئی
 * (partial) اعمال می‌شود؛ حذف آرایشگر = isActive:false (حذف سخت نداریم تا نوبت‌های قدیمی معتبر بمانند).
 */
const barberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true },
    isOwner: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    displayName: { type: String, trim: true, maxlength: 80, default: '' },
  },
  { collection: 'barbers', timestamps: true, versionKey: false },
);

barberSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
barberSchema.index({ shopId: 1 }, { unique: true, partialFilterExpression: { isOwner: true, isActive: true }, name: 'one_active_owner_per_shop' });
barberSchema.index({ shopId: 1, isActive: 1 });

module.exports = mongoose.models.Barber || mongoose.model('Barber', barberSchema);
