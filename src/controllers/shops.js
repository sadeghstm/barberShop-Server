'use strict';

const shopService = require('../services/shop');
const barberService = require('../services/barber');
const catalogService = require('../services/catalog');
const surveyService = require('../services/survey');
const appointmentService = require('../services/appointment');
const { priceView, appointmentView } = require('../helpers/serialize');
const { AppError } = require('../helpers/AppError');

/** POST /api/shops — مالک آرایشگاه جدید می‌سازد */
exports.create = async (req, res) => {
  const shop = await shopService.createShop({ actor: req.auth, data: req.body });
  res.status(201).json({ shop });
};

/** GET /api/shops?city=&page=&limit= — فهرست عمومی */
exports.list = async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const result = await shopService.listShops({ city: req.query.city, q: req.query.q, page, limit });
  res.json({ shops: result.rows, total: result.total, page, limit });
};

/** GET /api/shops/:slug — پروفایل عمومی آرایشگاه */
exports.getBySlug = async (req, res) => {
  const shop = await shopService.getShopBySlug(req.params.slug);
  res.json({ shop });
};

/** GET /api/shops/id/:shopId — جزئیات (برای پنل) */
exports.getById = async (req, res) => {
  const shop = await shopService.getShopById(req.params.shopId);
  shopService.assertShopAccess(shop._id, req.auth);
  res.json({ shop });
};

/** PATCH /api/shops/:shopId — نام، آدرس، تلفن، نمایش قیمت */
exports.update = async (req, res) => {
  const shop = await shopService.updateShop({ shopId: req.params.shopId, actor: req.auth, data: req.body });
  res.json({ shop });
};

/** PUT /api/shops/:shopId/working-hours — ساعت کاری هفتگی */
exports.setWorkingHours = async (req, res) => {
  const shop = await shopService.setWorkingHours({
    shopId: req.params.shopId,
    actor: req.auth,
    workingHours: req.body?.workingHours,
  });
  res.json({ shop });
};

/** POST /api/shops/:shopId/holidays { date, note } */
exports.addHoliday = async (req, res) => {
  const shop = await shopService.addHoliday({
    shopId: req.params.shopId,
    actor: req.auth,
    date: req.body?.date,
    note: req.body?.note,
  });
  res.status(201).json({ shop });
};

/** DELETE /api/shops/:shopId/holidays/:date */
exports.removeHoliday = async (req, res) => {
  const shop = await shopService.removeHoliday({
    shopId: req.params.shopId,
    actor: req.auth,
    date: req.params.date,
  });
  res.json({ shop });
};

/** GET /api/shops/:shopId/barbers — عمومی (صفحه رزرو) */
exports.listBarbers = async (req, res) => {
  const barbers = await barberService.listShopBarbers(req.params.shopId);
  // مسیر عمومی است: شماره موبایل آرایشگر افشا نمی‌شود
  res.json({
    barbers: barbers
      .filter((b) => b.isActive)
      .map((b) => ({ id: b.id, displayName: b.displayName, isOwner: b.isOwner })),
  });
};

/** GET /api/shops/:shopId/staff — پنل مالک (شامل غیرفعال‌ها) */
exports.listStaff = async (req, res) => {
  shopService.assertShopAccess(req.params.shopId, req.auth);
  const barbers = await barberService.listShopBarbers(req.params.shopId);
  res.json({ barbers });
};

/** POST /api/shops/:shopId/barbers { mobile, displayName } — افزودن آرایشگر */
exports.addBarber = async (req, res) => {
  const barber = await barberService.addBarber({
    actor: req.auth,
    shopId: req.params.shopId,
    mobile: req.body?.mobile,
    displayName: req.body?.displayName,
  });
  res.status(201).json({ barber });
};

/** DELETE /api/shops/:shopId/barbers/:barberId — غیرفعال‌سازی */
exports.removeBarber = async (req, res) => {
  const barber = await barberService.removeBarber({
    actor: req.auth,
    shopId: req.params.shopId,
    barberId: req.params.barberId,
  });
  res.json({ barber });
};

/**
 * GET /api/shops/:shopId/booking-board — داده یکجای صفحه رزرو:
 * آرایشگران فعال + خدمات هرکدام با قیمت/مدت (+ قیمت پنهان برای مهمان اگر تعیین شده باشد).
 */
exports.bookingBoard = async (req, res) => {
  const shop = await shopService.getShopById(req.params.shopId);
  const barbers = (await barberService.listShopBarbers(shop._id)).filter((b) => b.isActive);

  const board = await Promise.all(
    barbers.map(async (barber) => {
      const services = await catalogService.listBarberServices({
        barberId: barber.id,
        shopId: shop._id,
        onlyActive: true,
      });
      return {
        barber: { id: barber.id, displayName: barber.displayName, isOwner: barber.isOwner },
        services: services.map((s) => ({
          serviceId: s.serviceId,
          title: s.title,
          durationMinutes: s.durationMinutes,
          price: priceView(s.price, { shop, authenticated: Boolean(req.auth) }),
        })),
      };
    }),
  );

  res.json({
    shop: {
      id: shop._id,
      name: shop.name,
      slug: shop.slug,
      city: shop.city,
      address: shop.address,
      phone: shop.phone,
      workingHours: shop.settings?.workingHours ?? [],
      holidays: shop.settings?.holidays ?? [],
      showPricesToGuests: shop.settings?.showPricesToGuests !== false,
    },
    barbers: board,
  });
};

/** GET /api/shops/:shopId/survey-stats — آمار نظرسنجی آرایشگاه (پنل مالک) */
exports.surveyStats = async (req, res) => {
  shopService.assertShopAccess(req.params.shopId, req.auth);
  const stats = await surveyService.getSurveyStats({ shopId: req.params.shopId });
  res.json({ stats });
};

/** GET /api/shops/:shopId/appointments?from=&to=&status=&barberId=&page=&limit= — پنل مالک */
exports.listAppointments = async (req, res) => {
  shopService.assertShopAccess(req.params.shopId, req.auth);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const result = await appointmentService.listShopAppointments({
    shopId: req.params.shopId,
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
    barberId: req.query.barberId,
    page,
    limit,
  });
  res.json({ appointments: result.rows.map(appointmentView), total: result.total, page, limit });
};

/** GET /api/me/barber — پروفایل آرایشگر خودم */
exports.myBarberProfile = async (req, res) => {
  if (!req.auth?.barberId) throw AppError.forbidden('شما آرایشگر نیستید');
  const barber = await barberService.getMyBarberProfile(req.auth);
  res.json({ barber });
};
