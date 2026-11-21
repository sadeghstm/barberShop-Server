'use strict';

const v = require('../helpers/validate');
const shopService = require('../services/shop');
const barberService = require('../services/barber');
const offerService = require('../services/barberService');

/**
 * قیمت برای مهمان فقط وقتی نمایش داده می‌شود که آرایشگاه اجازه داده باشد (۵.۸ سند).
 * این‌جا در خود API حذف می‌شود (کلید price اصلاً در پاسخ نیست)، نه فقط در رابط کاربری.
 */
const canSeePrices = (shop, auth) => shop.settings.showPricesToGuests || Boolean(auth);
const withPrice = (data, price, visible) => (visible ? { ...data, price } : data);

/** GET /api/shops/:shopId/services — عمومی: هر خدمت با آرایشگرانی که آن را ارائه می‌دهند */
exports.listForShop = async (req, res) => {
  const shop = await shopService.getActiveOrThrow(v.objectId(req.params.shopId, 'shopId'));
  const visible = canSeePrices(shop, req.auth);

  const offers = await offerService.listOffers({ shopId: shop._id });

  const byService = new Map();
  for (const offer of offers) {
    const key = String(offer.serviceId);
    if (!byService.has(key)) byService.set(key, { serviceId: offer.serviceId, title: offer.title, barbers: [] });
    byService.get(key).barbers.push(
      withPrice({ barberId: offer.barberId, displayName: offer.barberName, durationMinutes: offer.durationMinutes }, offer.price, visible),
    );
  }
  const items = [...byService.values()].sort((a, b) => a.title.localeCompare(b.title, 'fa'));
  res.json({ items });
};

/** GET /api/shops/:shopId/barbers/:barberId/services — عمومی: خدمات قابل رزرو این آرایشگر */
exports.listForBarber = async (req, res) => {
  const shop = await shopService.getActiveOrThrow(v.objectId(req.params.shopId, 'shopId'));
  const barber = await barberService.getActiveInShopOrThrow(shop._id, v.objectId(req.params.barberId, 'barberId'));
  const visible = canSeePrices(shop, req.auth);

  const offers = await offerService.listOffers({ shopId: shop._id, barberId: barber._id });
  const items = offers
    .map((o) => withPrice({ serviceId: o.serviceId, title: o.title, durationMinutes: o.durationMinutes }, o.price, visible))
    .sort((a, b) => a.title.localeCompare(b.title, 'fa'));
  res.json({ items });
};

/** GET /api/shops/:shopId/barbers/:barberId/services/manage — مالک یا ادمین: کل کاتالوگ با تنظیمات */
exports.manage = async (req, res) => {
  const barber = await barberService.getActiveInShopOrThrow(
    v.objectId(req.params.shopId, 'shopId'),
    v.objectId(req.params.barberId, 'barberId'),
  );
  res.json({ items: await offerService.listManage(barber._id) });
};

const serviceBody = (doc) => ({
  service: { serviceId: doc.serviceId, price: doc.price, durationMinutes: doc.durationMinutes, isActive: doc.isActive },
});

/**
 * PUT /api/shops/:shopId/barbers/:barberId/services/:serviceId  { price, durationMinutes }
 * فقط مالک (یا ادمین): این آرایشگر این خدمت را با این قیمت (تومان) و مدت (مضرب ۵ دقیقه) ارائه می‌دهد.
 */
exports.offer = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  const barberId = v.objectId(req.params.barberId, 'barberId');
  const serviceId = v.objectId(req.params.serviceId, 'serviceId');
  const price = v.int(req.body?.price, 'price', { min: 0, max: 100000000 });
  const durationMinutes = v.int(req.body?.durationMinutes, 'durationMinutes', { min: 5, max: 480, multipleOf: 5 });

  const barber = await barberService.getActiveInShopOrThrow(shopId, barberId);
  const { doc, before } = await offerService.offer(barber, serviceId, { price, durationMinutes });

  await req.audit({
    action: 'barberService.set',
    entityType: 'barberServices',
    entityId: doc._id,
    before,
    after: doc,
    meta: { shopId, barberId, serviceId },
  });
  res.json(serviceBody(doc));
};

/** PATCH .../services/:serviceId  { isActive } — غیرفعال/فعال‌سازی (فقط مالک یا ادمین) */
exports.setActive = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  const barberId = v.objectId(req.params.barberId, 'barberId');
  const serviceId = v.objectId(req.params.serviceId, 'serviceId');
  const isActive = v.boolean(req.body?.isActive, 'isActive');

  const barber = await barberService.getActiveInShopOrThrow(shopId, barberId);
  const { doc, before, changed } = await offerService.setActive(barber, serviceId, isActive);

  if (changed) {
    await req.audit({
      action: isActive ? 'barberService.activate' : 'barberService.deactivate',
      entityType: 'barberServices',
      entityId: doc._id,
      before,
      after: doc,
      meta: { shopId, barberId, serviceId },
    });
  }
  res.json(serviceBody(doc));
};

/** DELETE .../services/:serviceId — حذف خدمت از فهرست این آرایشگر (فقط مالک یا ادمین) */
exports.remove = async (req, res) => {
  const shopId = v.objectId(req.params.shopId, 'shopId');
  const barberId = v.objectId(req.params.barberId, 'barberId');
  const serviceId = v.objectId(req.params.serviceId, 'serviceId');

  const barber = await barberService.getActiveInShopOrThrow(shopId, barberId);
  const { before } = await offerService.remove(barber, serviceId);

  await req.audit({
    action: 'barberService.remove',
    entityType: 'barberServices',
    entityId: before._id,
    before,
    meta: { shopId, barberId, serviceId },
  });
  res.status(204).end();
};
