'use strict';

const BarberService = require('../models/BarberService');
const ServiceCatalog = require('../models/ServiceCatalog');
const Barber = require('../models/Barber');
const { CATALOG_STATUS } = require('../constants/enums');
const { AppError } = require('../helpers/AppError');
const upcomingService = require('./upcoming');

const DUPLICATE_KEY = 11000;

/**
 * خدماتی که الان قابل رزرو است: آرایشگر فعال + خدمت فعال در کاتالوگ + فعال‌شده توسط آرایشگر.
 * (خدمتی که ادمین در حال حذفش است برای نوبت جدید بسته است: ۵.۵ سند)
 * shopId الزامی است؛ barberId اختیاری (برای یک آرایشگر خاص).
 * خروجی: فهرست تخت { serviceId, title, barberId, barberName, price, durationMinutes }
 */
async function listOffers({ shopId, barberId }) {
  const filter = { shopId, isActive: true };
  if (barberId) filter.barberId = barberId;

  const offers = await BarberService.find(filter);
  if (offers.length === 0) return [];

  const [services, barbers] = await Promise.all([
    ServiceCatalog.find({ _id: { $in: offers.map((o) => o.serviceId) }, status: CATALOG_STATUS.ACTIVE }),
    Barber.find({ _id: { $in: offers.map((o) => o.barberId) }, shopId, isActive: true }),
  ]);
  const serviceById = new Map(services.map((s) => [String(s._id), s]));
  const barberById = new Map(barbers.map((b) => [String(b._id), b]));

  return offers
    .filter((o) => serviceById.has(String(o.serviceId)) && barberById.has(String(o.barberId)))
    .map((o) => ({
      serviceId: o.serviceId,
      title: serviceById.get(String(o.serviceId)).title,
      barberId: o.barberId,
      barberName: barberById.get(String(o.barberId)).displayName,
      price: o.price,
      durationMinutes: o.durationMinutes,
    }));
}

/** برای صفحه مدیریت (مالک/ادمین): همه خدمات فعال کاتالوگ، با تنظیمات این آرایشگر (یا نتنظیم‌شده). */
async function listManage(barberId) {
  const [catalog, mine] = await Promise.all([
    ServiceCatalog.find({ status: CATALOG_STATUS.ACTIVE }).sort({ title: 1 }),
    BarberService.find({ barberId }),
  ]);
  const mineByService = new Map(mine.map((m) => [String(m.serviceId), m]));

  return catalog.map((service) => {
    const own = mineByService.get(String(service._id));
    return {
      serviceId: service._id,
      title: service.title,
      description: service.description,
      configured: Boolean(own),
      isActive: own ? own.isActive : false,
      price: own ? own.price : null,
      durationMinutes: own ? own.durationMinutes : null,
    };
  });
}

/**
 * این آرایشگر این خدمت را با این قیمت و مدت ارائه می‌دهد (ساخت یا به‌روزرسانی، و فعال).
 * قیمت و مدت جدید فقط روی نوبت‌های جدید اثر دارد؛ نوبت‌های قبلی snapshot خودشان را دارند (۵.۱.۷).
 * خروجی: { doc, before } — before برای auditLogs (null اگر تازه ساخته شد)
 */
async function offer(barber, serviceId, { price, durationMinutes }) {
  const service = await ServiceCatalog.findById(serviceId);
  if (!service) throw AppError.notFound('خدمت یافت نشد');
  if (service.status !== CATALOG_STATUS.ACTIVE) throw AppError.conflict('این خدمت دیگر در کاتالوگ فعال نیست');

  const doc =
    (await BarberService.findOne({ barberId: barber._id, serviceId })) ??
    new BarberService({ barberId: barber._id, shopId: barber.shopId, serviceId });
  const before = doc.isNew ? null : doc.toObject();

  doc.price = price;
  doc.durationMinutes = durationMinutes;
  doc.isActive = true;
  try {
    await doc.save();
  } catch (err) {
    // دو درخواست هم‌زمان اولین‌بار هر دو ساختن را امتحان کردند؛ دومی دوباره تلاش کند
    if (err.code === DUPLICATE_KEY) throw AppError.conflict('درخواست هم‌زمان دیگری در حال ثبت است؛ دوباره تلاش کنید');
    throw err;
  }
  return { doc, before };
}

/**
 * فعال یا غیرفعال کردن یک خدمت آرایشگر (قیمت و مدت می‌ماند). پیش‌تر تنظیم‌نشده → ۴۰۴.
 * خروجی: { doc, before, changed } — اگر وضعیت از قبل همین بود changed=false
 */
async function setActive(barber, serviceId, isActive) {
  const doc = await BarberService.findOne({ barberId: barber._id, serviceId });
  if (!doc) throw AppError.notFound('این خدمت برای این آرایشگر تنظیم نشده است');
  if (doc.isActive === isActive) return { doc, before: null, changed: false };

  if (!isActive) await upcomingService.assertNone({ barberId: barber._id, serviceId }, 'غیرفعال‌کردن خدمت');
  const before = doc.toObject();
  doc.isActive = isActive;
  await doc.save();
  return { doc, before, changed: true };
}

/**
 * حذف کامل تنظیم این خدمت برای این آرایشگر. نوبت‌های قبلی snapshot خودشان را دارند و آسیب نمی‌بینند.
 * پیش‌تر تنظیم‌نشده → ۴۰۴. خروجی: { before }
 */
async function remove(barber, serviceId) {
  const doc = await BarberService.findOne({ barberId: barber._id, serviceId });
  if (!doc) throw AppError.notFound('این خدمت برای این آرایشگر تنظیم نشده است');

  await upcomingService.assertNone({ barberId: barber._id, serviceId }, 'حذف خدمت');
  const before = doc.toObject();
  await doc.deleteOne();
  return { before };
}

module.exports = { listOffers, listManage, offer, setActive, remove };
