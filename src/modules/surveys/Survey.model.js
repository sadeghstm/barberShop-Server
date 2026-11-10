'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/** نظرسنجی بعد از تکمیل خدمت: لیبل‌هایی از SurveyLabel (key) + توضیح اختیاری؛ برای هر نوبت یک‌بار (۵.۸). */
const surveySchema = new Schema(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true, immutable: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true },
    barberId: { type: Schema.Types.ObjectId, ref: 'Barber', required: true, immutable: true },
    labels: {
      type: [{ type: String, trim: true, lowercase: true }],
      immutable: true,
      validate: [
        { validator: (v) => v.length > 0, message: 'at least one label is required' },
        { validator: (v) => v.length <= 10, message: 'at most 10 labels' },
        { validator: (v) => new Set(v).size === v.length, message: 'duplicate labels' },
      ],
    },
    comment: { type: String, trim: true, maxlength: 500, default: '', immutable: true },
  },
  { collection: 'surveys', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

surveySchema.index({ appointmentId: 1 }, { unique: true });
surveySchema.index({ barberId: 1, createdAt: -1 });
surveySchema.index({ shopId: 1, createdAt: -1 });

module.exports = mongoose.models.Survey || mongoose.model('Survey', surveySchema);
