'use strict';

// نظرسنجی (بخش ۵.۸): بعد از «تکمیل شده»، برای هر نوبت فقط یک‌بار.
// لیبل‌ها از فهرست ثابت SurveyLabel انتخاب می‌شوند (کلید).

const Survey = require('../models/Survey');
const SurveyLabel = require('../models/SurveyLabel');
const Appointment = require('../models/Appointment');
const { APPOINTMENT_STATUS } = require('../constants/enums');
const { AppError } = require('../helpers/AppError');
const auditService = require('./audit');

async function listLabels({ includeInactive = false } = {}) {
  const query = includeInactive ? {} : { isActive: true };
  return SurveyLabel.find(query).sort({ order: 1, title: 1 }).lean();
}

async function upsertLabel({ actor, key, title, order = 0, isActive = true }) {
  if (!key || !title) throw AppError.validation('کلید و عنوان لیبل الزامی است');
  const before = await SurveyLabel.findOne({ key }).lean();
  const doc = await SurveyLabel.findOneAndUpdate(
    { key },
    { $set: { title, order, isActive } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: before ? 'surveyLabel.update' : 'surveyLabel.create',
    entityType: 'surveyLabels',
    entityId: doc._id,
    before,
    after: doc,
  });
  return doc;
}

/** ثبت نظرسنجی توسط مشتری برای نوبت تکمیل‌شده. */
async function createSurvey({ customerId, appointmentId, labels, comment }) {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw AppError.notFound('نوبت یافت نشد');
  if (String(appointment.customerId) !== String(customerId)) throw AppError.forbidden();
  if (appointment.status !== APPOINTMENT_STATUS.COMPLETED) {
    throw AppError.conflict('نظرسنجی فقط برای نوبت تکمیل‌شده ثبت می‌شود');
  }
  if (!Array.isArray(labels) || labels.length === 0) throw AppError.validation('حداقل یک لیبل انتخاب کنید');

  const normalized = [...new Set(labels.map((l) => String(l).trim().toLowerCase()))];
  const active = await SurveyLabel.find({ key: { $in: normalized }, isActive: true }).lean();
  if (active.length !== normalized.length) {
    throw AppError.validation('برخی لیبل‌های انتخابی معتبر نیستند', {
      invalidLabels: normalized.filter((l) => !active.some((a) => a.key === l)),
    });
  }

  const existing = await Survey.findOne({ appointmentId });
  if (existing) throw AppError.conflict('برای این نوبت قبلاً نظرسنجی ثبت شده است');

  const survey = await Survey.create({
    appointmentId,
    customerId,
    shopId: appointment.shopId,
    barberId: appointment.barberId,
    labels: normalized,
    comment: comment ?? '',
  });

  await auditService.record({
    actor: { userId: customerId, role: 'customer', shopId: appointment.shopId },
    action: 'survey.create',
    entityType: 'surveys',
    entityId: survey._id,
    after: survey,
  });
  return survey;
}

/** آمار نظرسنجی یک آرایشگر یا آرایشگاه: تعداد، توزیع لیبل‌ها، میانگین شمارش لیبل. */
async function getSurveyStats({ barberId, shopId }) {
  const match = {};
  if (barberId) match.barberId = barberId;
  if (shopId) match.shopId = shopId;

  const [agg] = await Survey.aggregate([
    { $match: match },
    { $unwind: '$labels' },
    { $group: { _id: '$labels', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const total = await Survey.countDocuments(match);
  const distributionRaw = await Survey.aggregate([
    { $match: match },
    { $unwind: '$labels' },
    { $group: { _id: '$labels', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const labels = await SurveyLabel.find({ key: { $in: distributionRaw.map((d) => d._id) } }).lean();
  const labelMap = new Map(labels.map((l) => [l.key, l.title]));
  const distribution = distributionRaw.map((d) => ({
    key: d._id,
    title: labelMap.get(d._id) ?? d._id,
    count: d.count,
    percent: total > 0 ? Math.round((d.count / total) * 100) : 0,
  }));

  const recent = await Survey.find(match).sort({ createdAt: -1 }).limit(10).lean();

  return {
    total,
    topLabel: agg ?? null,
    distribution,
    recent: recent.map((s) => ({
      id: s._id,
      labels: s.labels,
      comment: s.comment,
      createdAt: s.createdAt,
    })),
  };
}

module.exports = { listLabels, upsertLabel, createSurvey, getSurveyStats };
