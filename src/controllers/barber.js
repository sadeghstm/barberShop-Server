'use strict';

const { AppError } = require('../helpers/AppError');
const { normalizeMobile } = require('../helpers/mobile');
const v = require('../helpers/validate');
const shopService = require('../services/shop');
const barberService = require('../services/barber');

/** GET /api/shops/:shopId/barbers — عمومی؛ آرایشگران فعال بدون موبایل */
exports.listPublic = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  await shopService.getActiveOrThrow(shopId);

  const barbers = await barberService.listPublic(shopId);
  res.json({ items: barbers.map((b) => ({ id: b._id, displayName: b.displayName, isOwner: b.isOwner })) });
};

/** GET /api/shops/:shopId/staff — مالک/ادمین؛ همه آرایشگران با موبایل و وضعیت */
exports.listStaff = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  await shopService.getOrThrow(shopId);

  const barbers = await barberService.listStaff(shopId);
  res.json({
    items: barbers.map((b) => ({
      id: b._id,
      displayName: b.displayName,
      isOwner: b.isOwner,
      isActive: b.isActive,
      mobile: b.userId?.mobile ?? null,
    })),
  });
};

/** POST /api/shops/:shopId/barbers  { mobile, displayName } */
exports.add = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  const mobile = normalizeMobile(req.body?.mobile);
  if (!mobile) throw AppError.validation('شماره موبایل معتبر نیست', [{ field: 'mobile', message: 'نامعتبر' }]);
  const displayName = v.string(req.body?.displayName, 'displayName', { min: 2, max: 80 });

  await shopService.getOrThrow(shopId);
  const { barber, user, isNew } = await barberService.add(shopId, { mobile, displayName });

  if (isNew) await req.audit({ action: 'user.register', entityType: 'users', entityId: user._id, after: user });
  await req.audit({ action: 'barber.add', entityType: 'barbers', entityId: barber._id, after: barber, meta: { shopId } });

  res.status(201).json({ barber: { id: barber._id, displayName: barber.displayName, isOwner: barber.isOwner, isActive: barber.isActive, mobile } });
};

/** PATCH /api/shops/:shopId/barbers/:barberId  { displayName?, isActive? } */
exports.update = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  const barberId = v.objectId(req.params.barberId, 'barberId');
  const body = req.body ?? {};

  const changes = {};
  const displayName = v.string(body.displayName, 'displayName', { min: 2, max: 80, optional: true });
  if (displayName !== undefined) changes.displayName = displayName;
  const isActive = v.boolean(body.isActive, 'isActive', { optional: true });
  if (isActive !== undefined) changes.isActive = isActive;
  if (Object.keys(changes).length === 0) throw AppError.validation('هیچ فیلد قابل‌تغییری ارسال نشده است');

  const barber = await barberService.getInShopOrThrow(shopId, barberId);
  const before = barber.toObject();
  await barberService.update(barber, changes);

  await req.audit({ action: 'barber.update', entityType: 'barbers', entityId: barber._id, before, after: barber, meta: { shopId } });
  res.json({ barber: { id: barber._id, displayName: barber.displayName, isOwner: barber.isOwner, isActive: barber.isActive } });
};
