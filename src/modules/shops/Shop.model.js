'use strict';

const mongoose = require('mongoose');
const { DAY_KEY_PATTERN, HHMM_PATTERN } = require('../../constants/time');
const { LICENSE_STATUSES, LICENSE_STATUS } = require('../../constants/enums');

const { Schema } = mongoose;

const intervalSchema = new Schema(
  {
    start: { type: String, required: true, match: HHMM_PATTERN }, // به وقت تهران
    end: { type: String, required: true, match: HHMM_PATTERN },
  },
  { _id: false },
);
intervalSchema.path('end').validate(function after(value) {
  return value > this.start; // رشته‌های HH:mm قابل مقایسه‌اند
}, 'end must be after start');

const workingDaySchema = new Schema(
  {
    // 0 = شنبه ... 6 = جمعه (هفته ایرانی)
    weekday: { type: Number, required: true, min: 0, max: 6 },
    intervals: { type: [intervalSchema], default: [] }, // خالی = تعطیل
  },
  { _id: false },
);

const holidaySchema = new Schema(
  {
    date: { type: String, required: true, match: DAY_KEY_PATTERN }, // dayKey تهران
    note: { type: String, trim: true, maxlength: 120, default: '' },
  },
  { _id: false },
);

const shopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9][a-z0-9-]{1,60}$/ },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    city: { type: String, trim: true, maxlength: 60, default: '' },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    isActive: { type: Boolean, default: true },
    settings: {
      // ۵.۸: false یعنی قیمت فقط برای کاربر واردشده (اعمال در API)
      showPricesToGuests: { type: Boolean, default: true },
      workingHours: {
        type: [workingDaySchema],
        default: [],
        validate: {
          validator: (days) => new Set(days.map((d) => d.weekday)).size === days.length,
          message: 'duplicate weekday in workingHours',
        },
      },
      holidays: { type: [holidaySchema], default: [] },
    },
    // برای استعلام پروانه کسب در آینده؛ فعلاً خالی و غیرفعال (بخش ۴)
    license: {
      number: { type: String, default: null },
      status: { type: String, enum: LICENSE_STATUSES, default: LICENSE_STATUS.DISABLED },
      verifiedAt: { type: Date, default: null },
    },
  },
  { collection: 'shops', timestamps: true, versionKey: false },
);

shopSchema.index({ slug: 1 }, { unique: true });
shopSchema.index({ ownerId: 1 });
shopSchema.index({ isActive: 1, city: 1 });

module.exports = mongoose.models.Shop || mongoose.model('Shop', shopSchema);
