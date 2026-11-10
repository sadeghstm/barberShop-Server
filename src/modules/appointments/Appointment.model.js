'use strict';

const mongoose = require('mongoose');
const { DAY_KEY_PATTERN } = require('../../constants/time');
const {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS,
  APPOINTMENT_SOURCES,
  APPOINTMENT_SOURCE,
  CANCEL_REQUEST_STATUSES,
} = require('../../constants/enums');

const { Schema } = mongoose;

const isInt = { validator: Number.isInteger, message: '{PATH} must be an integer' };
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
    customerId: ref('User', { default: null, immutable: true }),
    walkInName: { type: String, trim: true, maxlength: 80, default: null, immutable: true },
    walkInMobile: { type: String, trim: true, match: /^09\d{9}$/, default: null, immutable: true },
    source: { type: String, enum: APPOINTMENT_SOURCES, required: true, immutable: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, required: true },

    dayKey: { type: String, required: true, match: DAY_KEY_PATTERN, immutable: true },
    bookedStart: { type: Date, required: true, immutable: true },
    bookedEnd: { type: Date, required: true, immutable: true },
    estimatedStart: { type: Date, required: true },
    estimatedEnd: { type: Date, required: true },

    priceSnapshot: money({ required: true, immutable: true }),
    durationSnapshot: { type: Number, required: true, min: 5, validate: isInt, immutable: true },
    depositAmount: money({ default: 0, immutable: true }),

    heldUntil: { type: Date, default: null },
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

appointmentSchema.pre('validate', function crossFieldChecks() {
  if (this.bookedEnd <= this.bookedStart) this.invalidate('bookedEnd', 'bookedEnd must be after bookedStart');
  if (this.estimatedEnd <= this.estimatedStart) this.invalidate('estimatedEnd', 'estimatedEnd must be after estimatedStart');

  if (this.source === APPOINTMENT_SOURCE.ONLINE && !this.customerId) {
    this.invalidate('customerId', 'online appointment requires customerId');
  }
  if (this.source === APPOINTMENT_SOURCE.WALK_IN) {
    if (!this.customerId && !this.walkInName) this.invalidate('walkInName', 'walk-in requires customerId or walkInName');
    if (this.customerId && this.walkInName) this.invalidate('walkInName', 'walkInName and customerId are mutually exclusive');
    if (this.status === APPOINTMENT_STATUS.HELD) this.invalidate('status', 'walk-in cannot be held');
  }
  if (this.status === APPOINTMENT_STATUS.HELD && !this.heldUntil) {
    this.invalidate('heldUntil', 'heldUntil is required for held appointments');
  }
  if (this.depositAmount > this.priceSnapshot) this.invalidate('depositAmount', 'deposit cannot exceed price');
});

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
