'use strict';

const { AppError } = require('../helpers/AppError');
const { isPlatformStaff } = require('../helpers/roles');
const v = require('../helpers/validate');
const { CATALOG_STATUSES } = require('../constants/enums');
const catalogService = require('../services/catalog');

const toItem = (service, { withStatus }) => ({
  id: service._id,
  title: service.title,
  description: service.description,
  ...(withStatus && { status: service.status, isDefault: service.isDefault }),
});

/**
 * GET /api/services — عمومی: خدمات فعال کاتالوگ.
 * ادمین می‌تواند ?status=active|removing|archived|all بدهد (پیش‌فرض active).
 */
exports.list = async (req, res) => {
  const isStaff = Boolean(req.auth) && isPlatformStaff(req.auth.roles);

  let status = 'active';
  if (isStaff && req.query.status !== undefined) {
    status = req.query.status;
    if (status !== 'all' && !CATALOG_STATUSES.includes(status)) {
      throw AppError.validation('status نامعتبر است', [{ field: 'status', message: `یکی از: ${[...CATALOG_STATUSES, 'all'].join('، ')}` }]);
    }
  }

  const services = await catalogService.list(status);
  res.json({ items: services.map((s) => toItem(s, { withStatus: isStaff })) });
};

/** POST /api/services  { title, description? } — فقط ادمین */
exports.create = async (req, res) => {
  const title = v.string(req.body?.title, 'title', { min: 2, max: 80 });
  const description = v.string(req.body?.description, 'description', { min: 0, max: 500, optional: true }) ?? '';

  const service = await catalogService.create({ title, description });

  await req.audit({ action: 'service.create', entityType: 'serviceCatalog', entityId: service._id, after: service });
  res.status(201).json({ service: toItem(service, { withStatus: true }) });
};

/** PATCH /api/services/:serviceId  { title?, description? } — فقط ادمین */
exports.update = async (req, res) => {
  const serviceId = v.objectId(req.params.serviceId, 'serviceId');

  const changes = {};
  const title = v.string(req.body?.title, 'title', { min: 2, max: 80, optional: true });
  if (title !== undefined) changes.title = title;
  const description = v.string(req.body?.description, 'description', { min: 0, max: 500, optional: true });
  if (description !== undefined) changes.description = description;
  if (Object.keys(changes).length === 0) throw AppError.validation('هیچ فیلد قابل‌تغییری ارسال نشده است');

  const service = await catalogService.getOrThrow(serviceId);
  const before = service.toObject();
  await catalogService.update(service, changes);

  await req.audit({ action: 'service.update', entityType: 'serviceCatalog', entityId: service._id, before, after: service });
  res.json({ service: toItem(service, { withStatus: true }) });
};

/**
 * POST /api/services/:serviceId/removal  { confirmTitle } — فقط ادمین
 * حذف از کاتالوگ: فوراً برای نوبت جدید بسته می‌شود؛ بعد از پایان آخرین نوبت خودکار آرشیو می‌شود.
 * تایید صریح: confirmTitle باید دقیقاً عنوان خدمت باشد.
 */
exports.requestRemoval = async (req, res) => {
  const serviceId = v.objectId(req.params.serviceId, 'serviceId');
  const confirmTitle = v.string(req.body?.confirmTitle, 'confirmTitle', { min: 1, max: 80 });

  const { service, pending, before } = await catalogService.requestRemoval(serviceId, req.auth, confirmTitle);
  await req.audit({
    action: 'service.removalRequest',
    entityType: 'serviceCatalog',
    entityId: service._id,
    before,
    after: { status: service.status },
    meta: { pendingAppointments: pending },
  });
  res.json({ service: toItem(service, { withStatus: true }), pending });
};

/** POST /api/services/:serviceId/restore — فقط ادمین؛ انصراف از حذف یا بازگرداندن خدمت آرشیوشده */
exports.restore = async (req, res) => {
  const serviceId = v.objectId(req.params.serviceId, 'serviceId');

  const { service, before } = await catalogService.restore(serviceId);
  await req.audit({ action: 'service.restore', entityType: 'serviceCatalog', entityId: service._id, before, after: { status: service.status } });
  res.json({ service: toItem(service, { withStatus: true }) });
};
