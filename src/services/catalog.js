'use strict';

// کاتالوگ سراسری خدمات و فعال‌سازی آن توسط آرایشگر (بخش ۵.۵ سند).
// چرخه حذف: active → removing (نوبت جدید بسته) → archived. حذف سخت نداریم.

const ServiceCatalog = require('../models/ServiceCatalog');
const BarberService = require('../models/BarberService');
const ServiceRequest = require('../models/ServiceRequest');
const Barber = require('../models/Barber');
const { CATALOG_STATUS, SERVICE_REQUEST_STATUS } = require('../constants/enums');
const { ROLES } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const auditService = require('./audit');

const { normalizeTitle } = ServiceCatalog;

async function getActiveBarberOrFail(barberId, shopId) {
  const barber = await Barber.findById(barberId);
  if (!barber || !barber.isActive || String(barber.shopId) !== String(shopId)) {
    throw AppError.notFound('آرایشگر در این آرایشگاه یافت نشد');
  }
  return barber;
}

/** آرایشگر (نه مالک) فقط می‌تواند خدمات خودش را تغییر دهد؛ مالک/ادمین همه را. */
function assertBarberScope(actor, barberId) {
  if (actor.roles?.includes(ROLES.ADMIN) || actor.roles?.includes(ROLES.SUPER_ADMIN)) return;
  // مالک آرایشگاه به همه آرایشگران همان آرایشگاه دسترسی دارد (محدودسازی با requireShopAccess)
  if (actor.roles?.includes(ROLES.SHOP_OWNER)) return;
  if (String(actor.barberId) !== String(barberId)) throw AppError.forbidden('فقط می‌توانید خدمات خودتان را تغییر دهید');
}

/** فهرست کاتالوگ قابل رزرو (active + removing برای نمایش، ولی removing قابل رزرو جدید نیست). */
async function listCatalog({ includeArchived = false, q } = {}) {
  const query = includeArchived ? {} : { status: { $ne: CATALOG_STATUS.ARCHIVED } };
  if (q) query.titleKey = { $regex: normalizeTitle(q) };
  return ServiceCatalog.find(query).sort({ isDefault: -1, title: 1 }).lean();
}

/** افزودن خدمت به کاتالوگ (ادمین/سوپر ادمین). */
async function createCatalogService({ actor, title, description, isDefault = false }) {
  if (!title || String(title).trim().length < 2) throw AppError.validation('عنوان خدمت الزامی است');
  const exists = await ServiceCatalog.findOne({ titleKey: normalizeTitle(title) });
  if (exists) throw AppError.conflict('این خدمت قبلاً در کاتالوگ ثبت شده است');
  const doc = await ServiceCatalog.create({ title, description: description ?? '', isDefault: Boolean(isDefault) });
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'catalog.create',
    entityType: 'serviceCatalog',
    entityId: doc._id,
    after: doc,
  });
  return doc;
}

/**
 * درخواست حذف خدمت از کاتالوگ: active → removing (نوبت جدید بسته می‌شود) و ادمین بعداً archive می‌کند.
 * اگر خدمت هیچ نوبت آینده‌ای نداشته باشد مستقیم archive می‌شود.
 */
async function requestCatalogRemoval({ actor, serviceId }) {
  const service = await ServiceCatalog.findById(serviceId);
  if (!service) throw AppError.notFound('خدمت یافت نشد');
  if (service.status === CATALOG_STATUS.ARCHIVED) throw AppError.conflict('این خدمت قبلاً آرشیو شده است');
  const before = service.toObject();

  const Appointment = require('../models/Appointment');
  const futureCount = await Appointment.countDocuments({
    serviceId: service._id,
    status: { $in: ['held', 'confirmed', 'arrived', 'inProgress'] },
    bookedEnd: { $gt: new Date() },
  });

  service.status = futureCount > 0 ? CATALOG_STATUS.REMOVING : CATALOG_STATUS.ARCHIVED;
  service.removalRequestedBy = actor.userId;
  service.removalRequestedAt = new Date();
  if (service.status === CATALOG_STATUS.ARCHIVED) service.archivedAt = new Date();
  await service.save();

  // غیرفعال کردن در همه آرایشگرها تا نوبت جدید گرفته نشود
  await BarberService.updateMany({ serviceId: service._id }, { $set: { isActive: false } });

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'catalog.requestRemoval',
    entityType: 'serviceCatalog',
    entityId: service._id,
    before,
    after: service,
    meta: { futureAppointments: futureCount },
  });
  return service;
}

/** آرشیو نهایی (ادمین) — فقط وقتی نوبت آینده‌ای نمانده باشد. */
async function archiveCatalogService({ actor, serviceId }) {
  const service = await ServiceCatalog.findById(serviceId);
  if (!service) throw AppError.notFound('خدمت یافت نشد');
  const Appointment = require('../models/Appointment');
  const futureCount = await Appointment.countDocuments({
    serviceId: service._id,
    status: { $in: ['held', 'confirmed', 'arrived', 'inProgress'] },
    bookedEnd: { $gt: new Date() },
  });
  if (futureCount > 0) throw AppError.conflict('این خدمت نوبت آینده دارد و قابل آرشیو نیست');
  const before = service.toObject();
  service.status = CATALOG_STATUS.ARCHIVED;
  service.archivedAt = new Date();
  await service.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'catalog.archive',
    entityType: 'serviceCatalog',
    entityId: service._id,
    before,
    after: service,
  });
  return service;
}

/**
 * آرشیو خودکار خدماتی که در وضعیت «در حال حذف» هستند و دیگر نوبت آینده‌ای ندارند (۵.۵).
 * توسط زمان‌بند دوره‌ای صدا زده می‌شود.
 */
async function archiveFinishedRemovals() {
  const removing = await ServiceCatalog.find({ status: CATALOG_STATUS.REMOVING });
  let archived = 0;
  for (const service of removing) {
    const future = await countFutureAppointmentsForService(service._id);
    if (future > 0) continue;
    const before = service.toObject();
    service.status = CATALOG_STATUS.ARCHIVED;
    service.archivedAt = new Date();
    await service.save();
    await auditService.record({
      actor: { role: 'system' },
      action: 'catalog.archive',
      entityType: 'serviceCatalog',
      entityId: service._id,
      before,
      after: service,
      meta: { auto: true },
    });
    archived += 1;
  }
  return archived;
}

/** تعداد نوبت‌های آینده کل کاتالوگ برای یک خدمت (هر آرایشگر). */
async function countFutureAppointmentsForService(serviceId) {
  const Appointment = require('../models/Appointment');
  return Appointment.countDocuments({
    serviceId,
    status: { $in: ['held', 'confirmed', 'arrived', 'inProgress'] },
    bookedEnd: { $gt: new Date() },
  });
}

/** خدمات یک آرایشگر (برای پنل و برای صفحه رزرو). */
async function listBarberServices({ barberId, shopId, onlyActive = false }) {
  await getActiveBarberOrFail(barberId, shopId);
  const query = { barberId };
  if (onlyActive) query.isActive = true;
  const rows = await BarberService.find(query).lean();
  const catalog = await ServiceCatalog.find({ _id: { $in: rows.map((r) => r.serviceId) } }).lean();
  const catalogMap = new Map(catalog.map((c) => [String(c._id), c]));
  return rows
    .map((row) => ({
      id: row._id,
      serviceId: row.serviceId,
      title: catalogMap.get(String(row.serviceId))?.title ?? '',
      description: catalogMap.get(String(row.serviceId))?.description ?? '',
      catalogStatus: catalogMap.get(String(row.serviceId))?.status ?? null,
      price: row.price,
      durationMinutes: row.durationMinutes,
      isActive: row.isActive,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'fa'));
}

/** تعداد نوبت‌های آینده یک آرایشگر برای یک خدمت (برای قواعد مسدودسازی ۵.۵). */
async function countFutureAppointments({ barberId, serviceId }) {
  const Appointment = require('../models/Appointment');
  return Appointment.countDocuments({
    barberId,
    serviceId,
    status: { $in: ['held', 'confirmed', 'arrived', 'inProgress'] },
    bookedEnd: { $gt: new Date() },
  });
}

/**
 * فعال‌سازی/به‌روزرسانی خدمت یک آرایشگر با قیمت و مدت خودش.
 * durationMinutes باید مضرب ۵ باشد (شبکه رزرو) و قیمت عدد صحیح تومان.
 */
async function upsertBarberService({ actor, barberId, shopId, serviceId, price, durationMinutes, isActive = true }) {
  await getActiveBarberOrFail(barberId, shopId);
  assertBarberScope(actor, barberId);
  const catalog = await ServiceCatalog.findById(serviceId);
  if (!catalog) throw AppError.notFound('خدمت در کاتالوگ یافت نشد');
  if (catalog.status === CATALOG_STATUS.ARCHIVED) throw AppError.conflict('این خدمت آرشیو شده و قابل فعال‌سازی نیست');
  if (catalog.status === CATALOG_STATUS.REMOVING) throw AppError.conflict('این خدمت در حال حذف است و قابل فعال‌سازی نیست');

  // غیرفعال‌کردن خدمتی که نوبت آینده دارد مسدود است (۵.۵)
  if (!isActive) {
    const future = await countFutureAppointments({ barberId, serviceId });
    if (future > 0) {
      throw AppError.conflict('این خدمت نوبت آینده دارد؛ ابتدا نوبت‌ها را با موافقت مشتری لغو کنید');
    }
  }

  if (!Number.isInteger(price) || price < 0) throw AppError.validation('قیمت باید عدد صحیح (تومان) باشد');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480 || durationMinutes % 5 !== 0) {
    throw AppError.validation('مدت خدمت باید مضرب ۵ دقیقه و بین ۵ تا ۴۸۰ باشد');
  }

  const before = await BarberService.findOne({ barberId, serviceId }).lean();
  const doc = await BarberService.findOneAndUpdate(
    { barberId, serviceId },
    { $set: { shopId, price, durationMinutes, isActive: Boolean(isActive) } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: before ? 'barberService.update' : 'barberService.create',
    entityType: 'barberServices',
    entityId: doc._id,
    before,
    after: doc,
  });
  return doc;
}

async function deactivateBarberService({ actor, barberId, shopId, serviceId }) {
  await getActiveBarberOrFail(barberId, shopId);
  assertBarberScope(actor, barberId);
  const doc = await BarberService.findOne({ barberId, serviceId });
  if (!doc) throw AppError.notFound('این خدمت برای آرایشگر ثبت نشده است');
  const future = await countFutureAppointments({ barberId, serviceId });
  if (future > 0) {
    throw AppError.conflict('این خدمت نوبت آینده دارد؛ ابتدا نوبت‌ها را با موافقت مشتری لغو کنید', {
      futureAppointments: future,
    });
  }
  const before = doc.toObject();
  doc.isActive = false;
  await doc.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: 'barberService.deactivate',
    entityType: 'barberServices',
    entityId: doc._id,
    before,
    after: doc,
  });
  return doc;
}

/** درخواست خدمت جدید توسط آرایشگر (۵.۵). */
async function createServiceRequest({ actor, shopId, title, description }) {
  if (!title || String(title).trim().length < 2) throw AppError.validation('عنوان خدمت الزامی است');
  if (!actor.barberId) throw AppError.forbidden('فقط آرایشگر می‌تواند درخواست خدمت بدهد');
  const doc = await ServiceRequest.create({
    shopId,
    barberId: actor.barberId,
    requestedBy: actor.userId,
    title,
    description: description ?? '',
  });
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: 'serviceRequest.create',
    entityType: 'serviceRequests',
    entityId: doc._id,
    after: doc,
  });
  return doc;
}

/** بررسی درخواست توسط ادمین: تایید (ساخت خدمت یا ادغام با موجود) یا رد با دلیل. */
async function decideServiceRequest({ actor, requestId, approve, rejectReason, mergeIntoServiceId }) {
  const request = await ServiceRequest.findById(requestId);
  if (!request) throw AppError.notFound('درخواست یافت نشد');
  if (request.status !== SERVICE_REQUEST_STATUS.PENDING) throw AppError.conflict('این درخواست قبلاً بررسی شده است');
  const before = request.toObject();

  if (!approve) {
    if (!rejectReason) throw AppError.validation('دلیل رد الزامی است');
    request.status = SERVICE_REQUEST_STATUS.REJECTED;
    request.rejectReason = rejectReason;
    request.decidedBy = actor.userId;
    request.decidedAt = new Date();
    await request.save();
    await auditService.record({
      actor: { userId: actor.userId, role: actor.role },
      action: 'serviceRequest.reject',
      entityType: 'serviceRequests',
      entityId: request._id,
      before,
      after: request,
      meta: { rejectReason },
    });
    return request;
  }

  let service;
  if (mergeIntoServiceId) {
    service = await ServiceCatalog.findById(mergeIntoServiceId);
    if (!service) throw AppError.notFound('خدمت مقصد یافت نشد');
  } else {
    const titleKey = normalizeTitle(request.title);
    service = await ServiceCatalog.findOne({ titleKey });
    if (!service) {
      service = await ServiceCatalog.create({
        title: request.title,
        description: request.description,
        createdFromRequestId: request._id,
      });
    }
  }

  request.status = SERVICE_REQUEST_STATUS.APPROVED;
  request.decidedBy = actor.userId;
  request.decidedAt = new Date();
  request.serviceId = service._id;
  await request.save();

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'serviceRequest.approve',
    entityType: 'serviceRequests',
    entityId: request._id,
    before,
    after: request,
    meta: { serviceId: service._id },
  });
  return request;
}

async function listServiceRequests({ status }) {
  const query = {};
  if (status) query.status = status;
  const rows = await ServiceRequest.find(query).sort({ createdAt: 1 }).lean();
  const services = await ServiceCatalog.find({ _id: { $in: rows.map((r) => r.serviceId).filter(Boolean) } }).lean();
  const map = new Map(services.map((s) => [String(s._id), s]));
  return rows.map((r) => ({
    ...r,
    service: r.serviceId ? map.get(String(r.serviceId)) ?? null : null,
  }));
}

module.exports = {
  listCatalog,
  createCatalogService,
  requestCatalogRemoval,
  archiveCatalogService,
  listBarberServices,
  upsertBarberService,
  deactivateBarberService,
  createServiceRequest,
  decideServiceRequest,
  listServiceRequests,
  getActiveBarberOrFail,
  archiveFinishedRemovals,
};
