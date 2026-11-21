'use strict';

const { AppError } = require('../helpers/AppError');
const v = require('../helpers/validate');
const { SERVICE_REQUEST_STATUSES } = require('../constants/enums');
const requestService = require('../services/serviceRequest');

const toItem = (r, extra = {}) => ({
  id: r._id,
  title: r.title,
  description: r.description,
  status: r.status,
  rejectReason: r.rejectReason,
  serviceId: r.serviceId,
  createdAt: r.createdAt,
  decidedAt: r.decidedAt,
  ...extra,
});

/** POST /api/service-requests  { title, description? } — آرایشگر یا مالک */
exports.create = async (req, res) => {
  const title = v.string(req.body?.title, 'title', { min: 2, max: 80 });
  const description = v.string(req.body?.description, 'description', { min: 0, max: 500, optional: true }) ?? '';

  const request = await requestService.create(req.auth, { title, description });
  await req.audit({ action: 'serviceRequest.create', entityType: 'serviceRequests', entityId: request._id, after: request });
  res.status(201).json({ request: toItem(request) });
};

/** GET /api/service-requests/mine — درخواست‌های خود کاربر */
exports.listMine = async (req, res) => {
  const requests = await requestService.listMine(req.auth);
  res.json({ items: requests.map((r) => toItem(r)) });
};

/** GET /api/service-requests?status=pending|approved|rejected|all&page=&limit= — فقط ادمین (پیش‌فرض: در انتظار) */
exports.list = async (req, res) => {
  const status = req.query.status ?? 'pending';
  if (status !== 'all' && !SERVICE_REQUEST_STATUSES.includes(status)) {
    throw AppError.validation('status نامعتبر است', [{ field: 'status', message: `یکی از: ${[...SERVICE_REQUEST_STATUSES, 'all'].join('، ')}` }]);
  }
  const page = v.integer(req.query.page, { fallback: 1, max: 100000 });
  const limit = v.integer(req.query.limit, { fallback: 20, max: 50 });

  const { items, total } = await requestService.listAll({ status, page, limit });
  res.json({
    items: items.map(({ request, barberName, shopName }) => toItem(request, { barberName, shopName })),
    page,
    limit,
    total,
  });
};

/** POST /api/service-requests/:id/approve  { mergeInto? } — فقط ادمین */
exports.approve = async (req, res) => {
  const requestId = v.objectId(req.params.id, 'id');
  const mergeInto = req.body?.mergeInto === undefined ? undefined : v.objectId(req.body.mergeInto, 'mergeInto');

  const before = await requestService.getOrThrow(requestId);
  const { request, service, created } = await requestService.approve(requestId, req.auth, { mergeInto });

  await req.audit({
    action: 'serviceRequest.approve',
    entityType: 'serviceRequests',
    entityId: request._id,
    before: { status: before.status },
    after: { status: request.status, serviceId: service._id },
    meta: { merged: !created },
  });
  if (created) {
    await req.audit({ action: 'service.create', entityType: 'serviceCatalog', entityId: service._id, after: service, meta: { requestId: request._id } });
  }
  res.json({ request: toItem(request), service: { id: service._id, title: service.title }, created });
};

/** POST /api/service-requests/:id/reject  { reason } — فقط ادمین؛ دلیل الزامی است */
exports.reject = async (req, res) => {
  const requestId = v.objectId(req.params.id, 'id');
  const reason = v.string(req.body?.reason, 'reason', { min: 3, max: 300 });

  const request = await requestService.reject(requestId, req.auth, reason);
  await req.audit({
    action: 'serviceRequest.reject',
    entityType: 'serviceRequests',
    entityId: request._id,
    before: { status: 'pending' },
    after: { status: request.status, rejectReason: reason },
  });
  res.json({ request: toItem(request) });
};
