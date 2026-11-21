'use strict';

const { AppError } = require('../helpers/AppError');
const { isPlatformStaff } = require('../helpers/roles');
const { normalizeMobile } = require('../helpers/mobile');
const { normalizeWorkingHours } = require('../helpers/workingHours');
const v = require('../helpers/validate');
const shopService = require('../services/shop');

/** آنچه به عموم نشان داده می‌شود (بدون اطلاعات داخلی مثل پروانه) */
function toPublic(shop) {
  return {
    id: shop._id,
    name: shop.name,
    slug: shop.slug,
    city: shop.city,
    address: shop.address,
    phone: shop.phone,
    showPricesToGuests: shop.settings.showPricesToGuests,
    workingHours: shop.settings.workingHours,
    holidays: shop.settings.holidays,
  };
}

/** GET /api/shops?city=&page=&limit= — عمومی */
exports.list = async (req, res) => {
  const page = v.integer(req.query.page, { fallback: 1, max: 100000 });
  const limit = v.integer(req.query.limit, { fallback: 20, max: 50 });
  const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';

  const { items, total } = await shopService.list({ city, page, limit });
  res.json({
    items: items.map((s) => ({ id: s._id, name: s.name, slug: s.slug, city: s.city, address: s.address, phone: s.phone })),
    page,
    limit,
    total,
  });
};

/** GET /api/shops/:shopId — عمومی؛ آرایشگاه غیرفعال دیده نمی‌شود */
exports.getOne = async (req, res) => {
  const shop = await shopService.getActiveOrThrow(v.objectId(req.params.shopId, 'shopId'));
  res.json({ shop: toPublic(shop) });
};

/** POST /api/shops — فقط ادمین؛ آرایشگاه را با مالکش می‌سازد */
exports.create = async (req, res) => {
  const body = req.body ?? {};
  const ownerMobile = normalizeMobile(body.ownerMobile);
  if (!ownerMobile) throw AppError.validation('شماره موبایل مالک معتبر نیست', [{ field: 'ownerMobile', message: 'نامعتبر' }]);

  const data = {
    name: v.string(body.name, 'name', { min: 2, max: 100 }),
    slug: v.slug(body.slug, 'slug'),
    city: v.string(body.city, 'city', { min: 0, max: 60, optional: true }) ?? '',
    address: v.string(body.address, 'address', { min: 0, max: 300, optional: true }) ?? '',
    phone: v.string(body.phone, 'phone', { min: 0, max: 20, optional: true }) ?? '',
    ownerMobile,
    ownerName: v.string(body.ownerName, 'ownerName', { min: 2, max: 80 }),
  };

  const { shop, barber, owner, ownerIsNew } = await shopService.create(data);

  if (ownerIsNew) {
    await req.audit({ action: 'user.register', entityType: 'users', entityId: owner._id, after: owner });
  }
  await req.audit({ action: 'shop.create', entityType: 'shops', entityId: shop._id, after: shop });
  await req.audit({ action: 'barber.add', entityType: 'barbers', entityId: barber._id, after: barber, meta: { shopId: shop._id, isOwner: true } });

  res.status(201).json({ shop: toPublic(shop) });
};

/** PATCH /api/shops/:shopId — مالک همان آرایشگاه یا ادمین. slug و isActive فقط ادمین. */
exports.update = async (req, res) => {
  const body = req.body ?? {};
  const changes = {};

  const text = {
    name: { min: 2, max: 100 },
    city: { min: 0, max: 60 },
    address: { min: 0, max: 300 },
    phone: { min: 0, max: 20 },
  };
  for (const [field, rule] of Object.entries(text)) {
    const value = v.string(body[field], field, { ...rule, optional: true });
    if (value !== undefined) changes[field] = value;
  }
  const showPrices = v.boolean(body.showPricesToGuests, 'showPricesToGuests', { optional: true });
  if (showPrices !== undefined) changes['settings.showPricesToGuests'] = showPrices;

  if (body.slug !== undefined || body.isActive !== undefined) {
    if (!isPlatformStaff(req.auth.roles)) throw AppError.forbidden('فقط ادمین می‌تواند slug یا وضعیت آرایشگاه را تغییر دهد');
    if (body.slug !== undefined) changes.slug = v.slug(body.slug, 'slug');
    if (body.isActive !== undefined) changes.isActive = v.boolean(body.isActive, 'isActive');
  }
  if (Object.keys(changes).length === 0) throw AppError.validation('هیچ فیلد قابل‌تغییری ارسال نشده است');

  const shop = await shopService.getOrThrow(v.objectId(req.params.shopId, 'shopId'));
  const before = shop.toObject();
  await shopService.update(shop, changes);

  await req.audit({ action: 'shop.update', entityType: 'shops', entityId: shop._id, before, after: shop });
  res.json({ shop: toPublic(shop) });
};

/** PUT /api/shops/:shopId/working-hours — کل ساعت کاری هفتگی را جایگزین می‌کند */
exports.setWorkingHours = async (req, res) => {
  const workingHours = normalizeWorkingHours(req.body?.days);

  const shop = await shopService.getOrThrow(v.objectId(req.params.shopId, 'shopId'));
  const before = shop.settings.workingHours.toObject();
  await shopService.setWorkingHours(shop, workingHours);

  await req.audit({ action: 'shop.workingHours.update', entityType: 'shops', entityId: shop._id, before, after: workingHours });
  res.json({ workingHours: shop.settings.workingHours });
};

/** POST /api/shops/:shopId/holidays  { date: '2026-11-20', note? } */
exports.addHoliday = async (req, res) => {
  const date = v.dayKey(req.body?.date, 'date');
  const note = v.string(req.body?.note, 'note', { min: 0, max: 120, optional: true }) ?? '';

  const shop = await shopService.addHoliday(v.objectId(req.params.shopId, 'shopId'), { date, note });

  await req.audit({ action: 'shop.holiday.add', entityType: 'shops', entityId: shop._id, after: { date, note } });
  res.status(201).json({ holidays: shop.settings.holidays });
};

/** DELETE /api/shops/:shopId/holidays/:date */
exports.removeHoliday = async (req, res) => {
  const date = v.dayKey(req.params.date, 'date');

  const shop = await shopService.removeHoliday(v.objectId(req.params.shopId, 'shopId'), date);

  await req.audit({ action: 'shop.holiday.remove', entityType: 'shops', entityId: shop._id, before: { date } });
  res.json({ holidays: shop.settings.holidays });
};
