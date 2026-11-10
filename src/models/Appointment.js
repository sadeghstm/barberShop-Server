'use strict';

const mongoose = require('mongoose');
const { DAY_KEY_PATTERN } = require('../constants/time');
const {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS,
  APPOINTMENT_SOURCES,
  APPOINTMENT_SOURCE,
  CANCEL_REQUEST_STATUSES,
} = require('../constants/enums');

const { Schema } = mongoose;

// null یعنی «تعیین نشده» است (مثل finalPrice تا قبل از تکمیل)؛ پس null پذیرفته می‌شود
const isInt = { validator: (v) => v == null || Number.isInteger(v), message: '{PATH} must be an integer' };
const money = (extra = {}) => ({ type: Number, min: 0, validate: isInt, ...extra });
const ref = (to, extra = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });

/**
 * نوبت (بخش ۶). همه زمان‌ها UTC.
 * - bookedStart/bookedEnd: زمان رزرو؛ هرگز تغییر نمی‌کند (۵.۴).
 * - estimatedStart/estimatedEnd: زمان پیش‌بینی‌شده؛ با تاخیر محاسبه مجدد می‌شود. اولیه = زمان رزرو.
 * - priceSnapshot/durationSnapshot: هنگام ثبت ذخیره می‌شوند و بعداً تغییر نمی‌کنند (۵.۱.۷).
 * - dayKey: روز نوبت به وقت تهران (برای محاسبه مجدد «همان آرایشگر و همان روز»).
 * - مشتری حضوری بدون حساب: customerId خالی و walkInName پر.
 */
const appointmentSchema = new Schema(
  {
    shopId: ref('Shop', { required: true, immutable: true }),
    barberId: ref('Barber', { required: true, immutable: true }),
    serviceId: ref('ServiceCatalog', { required: true, immutable: true }),
    customerId: ref('User', {
      default: null,
      immutable: true,
      validate: {
        validator(value) {
          return this.source !== APPOINTMENT_SOURCE.ONLINE || Boolean(value);
        },
        message: 'online appointment requires customerId',
      },
    }),
    walkInName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
      immutable: true,
      validate: {
        validator(value) {
          if (this.source !== APPOINTMENT_SOURCE.WALK_IN) return true;
          // یکی از «حساب مشتری» یا «نام مشتری حضوری» لازم است، نه هر دو
          return Boolean(value) !== Boolean(this.customerId);
        },
        message: 'walk-in requires exactly one of customerId or walkInName',
      },
    },
    walkInMobile: { type: String, trim: true, match: /^09\d{9}$/, default: null, immutable: true },
    source: { type: String, enum: APPOINTMENT_SOURCES, required: true, immutable: true },
    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      required: true,
      validate: {
        validator(value) {
          // مشتری حضوری مستقیم «حاضر شد» ثبت می‌شود، پس هرگز موقت نیست
          return !(this.source === APPOINTMENT_SOURCE.WALK_IN && value === APPOINTMENT_STATUS.HELD);
        },
        message: 'walk-in cannot be held',
      },
    },

    dayKey: { type: String, required: true, match: DAY_KEY_PATTERN, immutable: true },
    bookedStart: { type: Date, required: true, immutable: true },
    bookedEnd: {
      type: Date,
      required: true,
      immutable: true,
      validate: {
        validator(value) {
          return !this.bookedStart || !value || new Date(value) > new Date(this.bookedStart);
        },
        message: 'bookedEnd must be after bookedStart',
      },
    },
    estimatedStart: { type: Date, required: true },
    estimatedEnd: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return !this.estimatedStart || !value || new Date(value) > new Date(this.estimatedStart);
        },
        message: 'estimatedEnd must be after estimatedStart',
      },
    },

    priceSnapshot: money({ required: true, immutable: true }),
    durationSnapshot: { type: Number, required: true, min: 5, validate: isInt, immutable: true },
    depositAmount: money({
      default: 0,
      immutable: true,
      validate: {
        validator(value) {
          return value == null || this.priceSnapshot == null || value <= this.priceSnapshot;
        },
        message: 'deposit cannot exceed price',
      },
    }),

    heldUntil: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          return this.status !== APPOINTMENT_STATUS.HELD || Boolean(value);
        },
        message: 'heldUntil is required for held appointments',
      },
    },
    arrivedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    // آرایشگر تصمیم عدم حضور را نگه داشته است (۵.۳)
    noShowHold: { type: Boolean, default: false },
    finalPrice: money({ default: null }),
    paidInPerson: money({ default: null }),

    // درخواست لغو توسط آرایشگر/مالک؛ فقط با موافقت مشتری اجرا می‌شود (۵.۲)
    cancelRequest: {
      requestedBy: ref('User', { default: null }),
      requestedAt: { type: Date, default: null },
      status: { type: String, enum: CANCEL_REQUEST_STATUSES, default: null },
      decidedAt: { type: Date, default: null },
    },
    cancelledBy: ref('User', { default: null }),
    cancelledAt: { type: Date, default: null },
  },
  { collection: 'appointments', timestamps: true, versionKey: false },
);

// بازه‌های هم‌پوشان یک آرایشگر (بررسی اصلی هم‌پوشانی در سرویس رزرو داخل قفل ردیس انجام می‌شود، گام ۷)
appointmentSchema.index({ barberId: 1, bookedStart: 1, bookedEnd: 1 });
// برنامه روز آرایشگر و محاسبه مجدد زمان‌ها
appointmentSchema.index({ barberId: 1, dayKey: 1, estimatedStart: 1 });
// «نوبت‌های من» برای مشتری
appointmentSchema.index({ customerId: 1, bookedStart: -1 }, { sparse: true });
// پاکسازی موقت‌های منقضی
appointmentSchema.index({ heldUntil: 1 }, { partialFilterExpression: { status: APPOINTMENT_STATUS.HELD } });
// عدم حضور خودکار: نوبت‌های تاییدشده‌ای که هنوز حاضر نشده‌اند
appointmentSchema.index({ estimatedStart: 1 }, { partialFilterExpression: { status: APPOINTMENT_STATUS.CONFIRMED }, name: 'confirmed_by_estimatedStart' });
// پنل آرایشگاه
appointmentSchema.index({ shopId: 1, status: 1, bookedStart: -1 });

/*
 * سدهای کمکی یکتا (جلوی تداخل را فقط کامل نمی‌گیرند؛ قفل + بررسی هم‌پوشانی اصلی است):
 * 1) هر مشتری هم‌زمان یک موقت فعال دارد (۵.۱.۵). نکته: موقت منقضی‌نشده‌ی پاکسازی‌نشده هم مانع است،
 *    پس سرویس رزرو باید قبل از ساخت موقت جدید، موقت قدیمی همان مشتری را (اگر heldUntil گذشته) منقضی کند.
 * 2) دو نوبت تاییدشده/حاضر/در حال انجام با شروع یکسان برای یک آرایشگر ممکن نیست. (held عمداً نیست
 *    تا موقت منقضی‌نشده‌ی پاکسازی‌نشده جلوی رزرو دوباره را نگیرد.) نیازمند MongoDB ≥ 6 برای $in.
 */
appointmentSchema.index(
  { customerId: 1 },
  { unique: true, partialFilterExpression: { status: APPOINTMENT_STATUS.HELD, customerId: { $type: 'objectId' } }, name: 'one_hold_per_customer' },
);
appointmentSchema.index(
  { barberId: 1, bookedStart: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.ARRIVED, APPOINTMENT_STATUS.IN_PROGRESS] },
    },
    name: 'unique_active_start_per_barber',
  },
);

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
