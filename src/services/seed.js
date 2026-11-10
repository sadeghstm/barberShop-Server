'use strict';

// داده‌های پایه (بخش ۵.۵ و ۵.۸): کاتالوگ پیش‌فرض خدمات و لیبل‌های نظرسنجی.
// هر دو idempotent هستند: اجرای دوباره سند تکراری نمی‌سازد.

const ServiceCatalog = require('../models/ServiceCatalog');
const SurveyLabel = require('../models/SurveyLabel');

const DEFAULT_SERVICES = [
  { title: 'اصلاح مو', description: 'کوتاهی و اصلاح مو با ماشین و قیچی' },
  { title: 'اصلاح ریش', description: 'اصلاح و فرم‌دهی ریش' },
  { title: 'اصلاح سر و صورت', description: 'کوتاهی مو همراه با اصلاح ریش' },
  { title: 'اصلاح ابرو', description: 'مرتب‌سازی و فرم ابرو' },
  { title: 'شستشوی سر', description: 'شامپو و ماساژ سر' },
  { title: 'ماسک صورت', description: 'پاکسازی و ماسک صورت' },
  { title: 'رنگ مو', description: 'رنگ کردن مو' },
  { title: 'حالت‌دهی مو', description: 'براشینگ و حالت‌دهی' },
];

const DEFAULT_SURVEY_LABELS = [
  { key: 'punctual', title: 'رعایت زمان', order: 1 },
  { key: 'clean', title: 'نظافت', order: 2 },
  { key: 'skilled', title: 'مهارت آرایشگر', order: 3 },
  { key: 'friendly', title: 'برخورد خوب', order: 4 },
  { key: 'affordable', title: 'قیمت مناسب', order: 5 },
];

async function ensureDefaultCatalog() {
  let created = 0;
  for (const item of DEFAULT_SERVICES) {
    const ServiceCatalogModel = ServiceCatalog;
    const { normalizeTitle } = ServiceCatalogModel;
    const exists = await ServiceCatalogModel.findOne({ titleKey: normalizeTitle(item.title) });
    if (exists) continue;
    await ServiceCatalogModel.create({ ...item, isDefault: true });
    created += 1;
  }
  return created;
}

async function ensureDefaultSurveyLabels() {
  let created = 0;
  for (const label of DEFAULT_SURVEY_LABELS) {
    const exists = await SurveyLabel.findOne({ key: label.key });
    if (exists) continue;
    await SurveyLabel.create(label);
    created += 1;
  }
  return created;
}

module.exports = { ensureDefaultCatalog, ensureDefaultSurveyLabels, DEFAULT_SERVICES, DEFAULT_SURVEY_LABELS };
