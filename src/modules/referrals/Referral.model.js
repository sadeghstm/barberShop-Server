'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/** پیوند معرف ← معرفی‌شده؛ هر معرفی‌شده فقط یک معرف دارد (۵.۷). خودمعرفی ممنوع. */
const referralSchema = new Schema(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    refereeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    code: { type: String, required: true, immutable: true },
  },
  { collection: 'referrals', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

referralSchema.pre('validate', function noSelf() {
  if (this.referrerId && this.refereeId && this.referrerId.equals(this.refereeId)) {
    this.invalidate('refereeId', 'self-referral is not allowed');
  }
});

referralSchema.index({ refereeId: 1 }, { unique: true });
referralSchema.index({ referrerId: 1, createdAt: -1 });

module.exports = mongoose.models.Referral || mongoose.model('Referral', referralSchema);
