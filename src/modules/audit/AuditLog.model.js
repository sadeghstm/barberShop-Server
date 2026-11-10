'use strict';

const mongoose = require('mongoose');
const { ALL_ACTOR_ROLES } = require('../../constants/roles');

const { Schema } = mongoose;

/**
 * کالکشن auditLogs — فقط افزودنی (بخش ۵.۱۰ سند طراحی).
 * فیلدها immutable هستند و عملیات update/delete از طریق mongoose مسدود است.
 * تضمین واقعی در سطح دیتابیس: در محیط واقعی کاربر مونگوی برنامه را بدون دسترسی update/delete
 * روی این کالکشن بسازید (mongoose به‌تنهایی جلوی collection.* خام را نمی‌گیرد).
 */
const auditLogSchema = new Schema(
  {
    // چه کسی، با چه نقشی. userId برای کارهای خودکار (system) خالی است.
    actor: {
      userId: { type: Schema.Types.ObjectId, default: null, immutable: true },
      role: { type: String, enum: ALL_ACTOR_ROLES, required: true, immutable: true },
      shopId: { type: Schema.Types.ObjectId, default: null, immutable: true },
    },
    // چه عملی، روی چه موجودیتی (مثلاً appointment.confirm روی appointments)
    action: { type: String, required: true, trim: true, maxlength: 100, immutable: true },
    entityType: { type: String, required: true, trim: true, maxlength: 60, immutable: true },
    entityId: { type: Schema.Types.ObjectId, default: null, immutable: true },
    // مقدار قبل و بعد؛ meta برای اطلاعات کمکی مثل دلیل رد
    before: { type: Schema.Types.Mixed, default: null, immutable: true },
    after: { type: Schema.Types.Mixed, default: null, immutable: true },
    meta: { type: Schema.Types.Mixed, default: null, immutable: true },
    requestId: { type: String, default: null, immutable: true },
    ip: { type: String, default: null, immutable: true },
    at: { type: Date, default: Date.now, required: true, immutable: true },
  },
  { collection: 'auditLogs', versionKey: false, minimize: false },
);

auditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditLogSchema.index({ 'actor.userId': 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

const BLOCKED_QUERY_OPS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
];

function blockMutation() {
  throw new Error('auditLogs is append-only: update/delete is not allowed');
}

auditLogSchema.pre(BLOCKED_QUERY_OPS, blockMutation);
auditLogSchema.pre('deleteOne', { document: true, query: false }, blockMutation);
auditLogSchema.pre('save', function blockResave() {
  if (!this.isNew) blockMutation();
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
