'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const int = (def, min, max) => ({
  type: Number,
  default: def,
  min,
  max,
  validate: { validator: Number.isInteger, message: '{PATH} must be an integer' },
});

/**
 * تنظیمات سراسری: فقط یک سند با key='global' (یکتا). تغییرش فقط با سوپر ادمین (گام ۳ به بعد).
 * مقدارهای پیش‌فرض از سند طراحی هستند.
 */
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'global', unique: true, immutable: true },
    depositPercent: int(15, 0, 100), // ۵.۶
    noShowGraceMinutes: int(5, 0, 120), // ۵.۳ - فقط سوپر ادمین
    minBookingLeadMinutes: int(15, 0, 1440), // ۵.۱
    holdMinutes: int(10, 1, 60), // ۵.۱
    delayNotifyThresholdMinutes: int(10, 0, 240), // ۵.۴
    cancelRefundHoursBefore: int(2, 0, 72), // ۵.۶
    referralCommissionPercent: int(0, 0, 100), // ۵.۷
  },
  { collection: 'settings', timestamps: true, versionKey: false },
);

module.exports = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);
