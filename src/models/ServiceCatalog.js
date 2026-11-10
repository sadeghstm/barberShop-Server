'use strict';

const mongoose = require('mongoose');
const { CATALOG_STATUSES, CATALOG_STATUS } = require('../constants/enums');

const { Schema } = mongoose;

/** حذف حرف‌های اضافه برای یکتایی عنوان (فاصله‌های تکراری، ی/ک عربی، حروف بزرگ). */
function normalizeTitle(title) {
  return String(title ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * کاتالوگ سراسری خدمات. چرخه حذف (۵.۵): active → removing (برای نوبت جدید بسته) → archived. حذف سخت نداریم.
 * قیمت و مدت اینجا نیست؛ هر آرایشگر در barberServices خودش تعیین می‌کند.
 */
const serviceCatalogSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    titleKey: { type: String, required: true, immutable: true }, // normalizeTitle(title)، برای یکتایی
    description: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: CATALOG_STATUSES, default: CATALOG_STATUS.ACTIVE },
    isDefault: { type: Boolean, default: false }, // از پیش تعریف‌شده (seed) در برابر ساخته‌شده با درخواست آرایشگر
    createdFromRequestId: { type: Schema.Types.ObjectId, ref: 'ServiceRequest', default: null },
    removalRequestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    removalRequestedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { collection: 'serviceCatalog', timestamps: true, versionKey: false },
);

serviceCatalogSchema.pre('validate', function setKey() {
  if (this.isNew) this.titleKey = normalizeTitle(this.title);
});

serviceCatalogSchema.index({ titleKey: 1 }, { unique: true });
serviceCatalogSchema.index({ status: 1 });

module.exports = mongoose.models.ServiceCatalog || mongoose.model('ServiceCatalog', serviceCatalogSchema);
module.exports.normalizeTitle = normalizeTitle;
