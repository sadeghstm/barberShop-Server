'use strict';

const ServiceCatalog = require('../models/ServiceCatalog');
const { AppError } = require('../helpers/AppError');
const auditService = require('./audit');
const upcomingService = require('./upcoming');
const { SYSTEM_ACTOR } = require('../constants/roles');
const { CATALOG_STATUS: STATUS } = require('../constants/enums');

const DUPLICATE_KEY = 11000;

// عنوان‌ها بعد از نرمال‌سازی (فاصله اضافه، ی/ک عربی، حروف بزرگ) یکتا هستند
const duplicateTitle = () => AppError.conflict('خدمتی با این عنوان قبلاً در کاتالوگ هست');

/** status: active | removing | archived | all */
async function list(status) {
  const filter = status === 'all' ? {} : { status };
  return ServiceCatalog.find(filter).sort({ title: 1 });
}

async function getOrThrow(serviceId) {
  const service = await ServiceCatalog.findById(serviceId);
  if (!service) throw AppError.notFound('خدمت یافت نشد');
  return service;
}

/** خدمت جدید در کاتالوگ سراسری (ساخته‌شده توسط ادمین → isDefault) */
async function create({ title, description }) {
  try {
    return await ServiceCatalog.create({ title, description, isDefault: true });
  } catch (err) {
    if (err.code === DUPLICATE_KEY) throw duplicateTitle();
    throw err;
  }
}

/** ویرایش عنوان/توضیح. وضعیت (حذف/آرشیو) در فاز ۲ جدا مدیریت می‌شود. */
async function update(service, changes) {
  service.set(changes);
  try {
    await service.save();
  } catch (err) {
    if (err.code === DUPLICATE_KEY) throw duplicateTitle();
    throw err;
  }
  return service;
}

// ---------------------------------------------------------------------------
// چرخه‌ی حذف (۵.۵ سند): active ← removing ← archived. حذف سخت نداریم.
//  - removing: فوراً برای نوبت جدید بسته؛ نوبت‌های تاییدشده و در حال انجام محترم‌اند
//  - archived: بعد از پایان آخرین نوبت آن خدمت (خودکار)
// ---------------------------------------------------------------------------

/** اگر هیچ نوبت آینده‌ای با این خدمت نمانده، «در حال حذف» را «آرشیو» می‌کند. خروجی: سند آرشیوشده یا null */
async function archiveIfFinished(serviceId, actor, now = new Date()) {
  if (await upcomingService.exists({ serviceId }, now)) return null;
  const archived = await ServiceCatalog.findOneAndUpdate(
    { _id: serviceId, status: STATUS.REMOVING },
    { status: STATUS.ARCHIVED, archivedAt: now },
    { new: true },
  );
  if (archived) {
    await auditService.record({
      actor,
      action: 'service.archive',
      entityType: 'serviceCatalog',
      entityId: archived._id,
      before: { status: STATUS.REMOVING },
      after: { status: STATUS.ARCHIVED },
    });
  }
  return archived;
}

/**
 * ادمین حذف را شروع می‌کند. تایید صریح: confirmTitle باید دقیقاً عنوان خدمت باشد.
 * خروجی: { service, pending } — pending=true یعنی هنوز نوبت آینده هست و آرشیو بعداً خودکار انجام می‌شود
 */
async function requestRemoval(serviceId, admin, confirmTitle, now = new Date()) {
  const service = await getOrThrow(serviceId);
  if (service.status !== STATUS.ACTIVE) {
    throw AppError.conflict(service.status === STATUS.REMOVING ? 'این خدمت در حال حذف است' : 'این خدمت آرشیو شده است', undefined, 'NOT_ACTIVE');
  }
  if (ServiceCatalog.normalizeTitle(confirmTitle) !== ServiceCatalog.normalizeTitle(service.title)) {
    throw AppError.validation('برای تایید حذف، عنوان خدمت را دقیقاً وارد کنید', [
      { field: 'confirmTitle', message: 'confirmTitle با عنوان خدمت یکی نیست' },
    ]);
  }

  const removing = await ServiceCatalog.findOneAndUpdate(
    { _id: serviceId, status: STATUS.ACTIVE },
    { status: STATUS.REMOVING, removalRequestedBy: admin.userId, removalRequestedAt: now },
    { new: true },
  );
  if (!removing) throw AppError.conflict('وضعیت خدمت همین الان تغییر کرد؛ دوباره تلاش کنید', undefined, 'NOT_ACTIVE');

  const archived = await archiveIfFinished(serviceId, admin, now);
  return { service: archived ?? removing, pending: !archived, before: { status: STATUS.ACTIVE } };
}

/** منصرف‌شدن از حذف، یا بازگرداندن خدمت آرشیوشده: removing | archived ← active. */
async function restore(serviceId, now = new Date()) {
  const service = await getOrThrow(serviceId);
  const previous = service.status;
  if (previous === STATUS.ACTIVE) throw AppError.conflict('این خدمت از قبل فعال است', undefined, 'ALREADY_ACTIVE');

  const restored = await ServiceCatalog.findOneAndUpdate(
    { _id: serviceId, status: { $in: [STATUS.REMOVING, STATUS.ARCHIVED] } },
    { status: STATUS.ACTIVE, removalRequestedBy: null, removalRequestedAt: null, archivedAt: null },
    { new: true },
  );
  if (!restored) throw AppError.conflict('وضعیت خدمت همین الان تغییر کرد؛ دوباره تلاش کنید', undefined, 'NOT_RESTORABLE');
  return { service: restored, before: { status: previous } };
}

/** کار دوره‌ای: همه‌ی «در حال حذف»هایی که نوبتشان تمام شده آرشیو می‌شوند. خروجی: تعداد */
async function archiveFinished(now = new Date()) {
  const removing = await ServiceCatalog.find({ status: STATUS.REMOVING }).select('_id');
  let count = 0;
  for (const { _id } of removing) {
    if (await archiveIfFinished(_id, { role: SYSTEM_ACTOR }, now)) count += 1;
  }
  return count;
}

module.exports = { list, getOrThrow, create, update, requestRemoval, restore, archiveFinished };
