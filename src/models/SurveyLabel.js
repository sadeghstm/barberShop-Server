'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/** فهرست ثابت سراسری لیبل‌های نظرسنجی، مدیریت با ادمین (۵.۸). حذف سخت نداریم؛ isActive=false. */
const surveyLabelSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9_-]{2,40}$/, immutable: true },
    title: { type: String, required: true, trim: true, maxlength: 60 },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { collection: 'surveyLabels', timestamps: true, versionKey: false },
);

surveyLabelSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.models.SurveyLabel || mongoose.model('SurveyLabel', surveyLabelSchema);
