'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { ROLES } = require('../../constants/roles');

const { Schema } = mongoose;

// موبایل ایران به شکل نرمال‌شده 09123456789 (نرمال‌سازی ورودی با سرویس احراز هویت، گام ۳)
const MOBILE_PATTERN = /^09\d{9}$/;
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferralCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) code += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
  return code;
}

/**
 * یک موبایل = یک کاربر، با چند نقش ممکن (بخش ۴). تعلق به آرایشگاه در `barbers` است نه اینجا.
 */
const userSchema = new Schema(
  {
    mobile: { type: String, required: true, match: MOBILE_PATTERN, immutable: true },
    name: { type: String, trim: true, maxlength: 80, default: '' },
    roles: {
      type: [{ type: String, enum: Object.values(ROLES) }],
      default: [ROLES.CUSTOMER],
      validate: { validator: (v) => v.length > 0, message: 'roles must not be empty' },
    },
    isActive: { type: Boolean, default: true },
    referralCode: { type: String, default: () => generateReferralCode(), immutable: true },
    // فقط یک معرف؛ بعد از ثبت قابل تغییر نیست (۵.۷)
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  },
  { collection: 'users', timestamps: true, versionKey: false },
);

userSchema.index({ mobile: 1 }, { unique: true });
userSchema.index({ referralCode: 1 }, { unique: true });
userSchema.index({ referredBy: 1 }, { sparse: true });

// خودمعرفی ممنوع (۵.۷)
userSchema.path('referredBy').validate(function noSelfReferral(value) {
  return !value || !this._id || !value.equals(this._id);
}, 'referredBy cannot be the user itself');

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
module.exports.MOBILE_PATTERN = MOBILE_PATTERN;
module.exports.generateReferralCode = generateReferralCode;
