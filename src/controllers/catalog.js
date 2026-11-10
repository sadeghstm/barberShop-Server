'use strict';

const catalogService = require('../services/catalog');
const surveyService = require('../services/survey');
const shopService = require('../services/shop');
const { priceView } = require('../helpers/serialize');
const { AppError } = require('../helpers/AppError');

/** GET /api/services — کاتالوگ سراسری (عمومی) */
exports.listCatalog = async (req, res) => {
  const services = await catalogService.listCatalog({ q: req.query.q });
  res.json({ services });
};

/** POST /api/services — افزودن خدمت به کاتالوگ (ادمین) */
exports.createCatalogService = async (req, res) => {
  const service = await catalogService.createCatalogService({
    actor: req.auth,
    title: req.body?.title,
    description: req.body?.description,
    isDefault: req.body?.isDefault,
  });
  res.status(201).json({ service });
};

/** POST /api/services/:serviceId/removal — درخواست حذف (ادمین) */
exports.requestRemoval = async (req, res) => {
  // «تایید صریح» قبل از شروع چرخه حذف (۵.۵)
  if (req.body?.confirm !== true) {
    throw new AppError('برای شروع حذف خدمت، تایید صریح لازم است (confirm: true)', {
      statusCode: 422,
      code: 'CONFIRMATION_REQUIRED',
    });
  }
  const service = await catalogService.requestCatalogRemoval({ actor: req.auth, serviceId: req.params.serviceId });
  res.json({ service });
};

/** POST /api/services/:serviceId/archive — آرشیو نهایی (ادمین) */
exports.archive = async (req, res) => {
  if (req.body?.confirm !== true) {
    throw new AppError('برای آرشیو خدمت، تایید صریح لازم است (confirm: true)', {
      statusCode: 422,
      code: 'CONFIRMATION_REQUIRED',
    });
  }
  const service = await catalogService.archiveCatalogService({ actor: req.auth, serviceId: req.params.serviceId });
  res.json({ service });
};

/** GET /api/shops/:shopId/barbers/:barberId/services */
exports.listBarberServices = async (req, res) => {
  const includeInactive = req.query.all === 'true';
  if (includeInactive && !req.auth) throw new AppError('برای دیدن خدمات غیرفعال وارد شوید');
  const services = await catalogService.listBarberServices({
    barberId: req.params.barberId,
    shopId: req.params.shopId,
    onlyActive: !includeInactive,
  });
  // ۵.۸: قیمت برای مهمان در خود API حذف می‌شود، نه فقط در رابط
  const shop = await shopService.getShopById(req.params.shopId).catch(() => null);
  res.json({
    services: services.map((service) => ({
      ...service,
      price: priceView(service.price, { shop, authenticated: Boolean(req.auth) }),
    })),
  });
};

/** PUT /api/shops/:shopId/barbers/:barberId/services/:serviceId { price, durationMinutes, isActive } */
exports.upsertBarberService = async (req, res) => {
  const doc = await catalogService.upsertBarberService({
    actor: req.auth,
    shopId: req.params.shopId,
    barberId: req.params.barberId,
    serviceId: req.params.serviceId,
    price: req.body?.price,
    durationMinutes: req.body?.durationMinutes,
    isActive: req.body?.isActive ?? true,
  });
  res.json({ barberService: doc });
};

/** DELETE /api/shops/:shopId/barbers/:barberId/services/:serviceId */
exports.deactivateBarberService = async (req, res) => {
  const doc = await catalogService.deactivateBarberService({
    actor: req.auth,
    shopId: req.params.shopId,
    barberId: req.params.barberId,
    serviceId: req.params.serviceId,
  });
  res.json({ barberService: doc });
};

/** POST /api/shops/:shopId/service-requests { title, description } */
exports.createServiceRequest = async (req, res) => {
  const request = await catalogService.createServiceRequest({
    actor: req.auth,
    shopId: req.params.shopId,
    title: req.body?.title,
    description: req.body?.description,
  });
  res.status(201).json({ request });
};

/** GET /api/service-requests?status= (ادمین) */
exports.listServiceRequests = async (req, res) => {
  const requests = await catalogService.listServiceRequests({ status: req.query.status });
  res.json({ requests });
};

/** POST /api/service-requests/:requestId/decide { approve, rejectReason, mergeIntoServiceId } */
exports.decideServiceRequest = async (req, res) => {
  const request = await catalogService.decideServiceRequest({
    actor: req.auth,
    requestId: req.params.requestId,
    approve: Boolean(req.body?.approve),
    rejectReason: req.body?.rejectReason,
    mergeIntoServiceId: req.body?.mergeIntoServiceId,
  });
  res.json({ request });
};

/** GET /api/survey-labels — عمومی (برای فرم نظرسنجی) */
exports.listSurveyLabels = async (req, res) => {
  const labels = await surveyService.listLabels();
  res.json({ labels });
};

/** PUT /api/survey-labels/:key — ادمین */
exports.upsertSurveyLabel = async (req, res) => {
  const label = await surveyService.upsertLabel({
    actor: req.auth,
    key: req.params.key,
    title: req.body?.title,
    order: req.body?.order,
    isActive: req.body?.isActive ?? true,
  });
  res.json({ label });
};
