'use strict';

const Shop = require('../models/Shop');
const Barber = require('../models/Barber');
const User = require('../models/User');
const { AppError } = require('../helpers/AppError');
const { ROLES } = require('../constants/roles');
const auditService = require('./audit');

/** ساخت آرایشگاه + سند مالک (او آرایشگر هم هست، بخش ۴). */
async function createShop({ actor, data }) {
  const { name, slug, city, address, phone, settings } = data ?? {};
  if (!name || !slug) throw AppError.validation('نام و slug آرایشگاه الزامی است');

  // هر کاربر فقط یک آرایشگاه می‌تواند داشته باشد و نباید از قبل آرایشگر فعال جایی باشد (بخش ۴)
  const owned = await Shop.findOne({ ownerId: actor.userId, isActive: true }).lean();
  if (owned) throw AppError.conflict('شما قبلاً یک آرایشگاه ثبت کرده‌اید');
  const existingBarber = await Barber.findOne({ userId: actor.userId, isActive: true }).lean();
  if (existingBarber) throw AppError.conflict('این کاربر قبلاً آرایشگر یک آرایشگاه است');

  const shop = await Shop.create({
    name,
    slug,
    ownerId: actor.userId,
    city: city ?? '',
    address: address ?? '',
    phone: phone ?? '',
    settings: settings ?? {},
  });

  // مالک هم یک سند Barber با isOwner=true دارد
  await Barber.create({ userId: actor.userId, shopId: shop._id, isOwner: true, displayName: actor.name ?? '' });

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId: shop._id },
    action: 'shop.create',
    entityType: 'shops',
    entityId: shop._id,
    after: shop,
  });
  return shop;
}

async function listShops({ city, page = 1, limit = 20 }) {
  const query = { isActive: true };
  if (city) query.city = city;
  return Shop.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
}

async function getShopBySlug(slug) {
  const shop = await Shop.findOne({ slug, isActive: true }).lean();
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  return shop;
}

async function getShopById(shopId) {
  const shop = await Shop.findById(shopId).lean();
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  return shop;
}

function assertShopAccess(shopId, actor) {
  const isStaff = actor.roles?.includes(ROLES.SUPER_ADMIN) || actor.roles?.includes(ROLES.ADMIN);
  if (isStaff) return;
  if (String(actor.shopId) !== String(shopId)) throw AppError.forbidden('این آرایشگاه متعلق به شما نیست');
}

/** به‌روزرسانی تنظیمات آرایشگاه (ساعت کاری، تعطیلی، نمایش قیمت). */
async function updateShop({ shopId, actor, data }) {
  assertShopAccess(shopId, actor);
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  const before = shop.toObject();

  const allowed = ['name', 'city', 'address', 'phone', 'isActive'];
  for (const key of allowed) {
    if (data[key] !== undefined) shop[key] = data[key];
  }
  if (data.settings !== undefined) shop.settings = data.settings;
  if (data.showPricesToGuests !== undefined) shop.settings.showPricesToGuests = data.showPricesToGuests;

  await shop.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId: shop._id },
    action: 'shop.update',
    entityType: 'shops',
    entityId: shop._id,
    before,
    after: shop,
  });
  return shop;
}

/** آرایشگران فعال یک آرایشگاه (با نام کاربر). */
async function listBarbers(shopId) {
  await getShopById(shopId);
  const barbers = await Barber.find({ shopId, isActive: true }).lean();
  const users = await User.find({ _id: { $in: barbers.map((b) => b.userId) } }).lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  return barbers.map((b) => ({
    id: b._id,
    userId: b.userId,
    isOwner: b.isOwner,
    displayName: b.displayName || userMap.get(String(b.userId))?.name || '',
    mobile: userMap.get(String(b.userId))?.mobile ?? null,
  }));
}

/**
 * ساعت کاری هفتگی را جایگزین می‌کند.
 * قاعده سند (۵.۱ و ۵.۷): تغییر ساعت کاری/تعطیلی نباید نوبت‌های موجود را بی‌اعتبار کند،
 * پس اگر با نوبت آینده‌ای تداخل داشته باشد رد می‌شود و از مالک خواسته می‌شود اول نوبت‌ها را جابه‌جا کند.
 */
async function setWorkingHours({ shopId, actor, workingHours }) {
  assertShopAccess(shopId, actor);
  if (!Array.isArray(workingHours)) throw AppError.validation('workingHours باید آرایه باشد');

  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  const before = shop.toObject();

  shop.settings.workingHours = workingHours;
  await shop.validate();

  const conflicts = await findFutureAppointmentsOutsideHours(shop, before.settings?.workingHours);
  if (conflicts.length > 0) {
    throw AppError.conflict('با این ساعت کاری، نوبت‌های موجود خارج از ساعت کاری می‌افتند', {
      conflictingAppointmentIds: conflicts.map((a) => a._id),
    });
  }

  await shop.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: 'shop.workingHours',
    entityType: 'shops',
    entityId: shop._id,
    before: { workingHours: before.settings?.workingHours ?? [] },
    after: { workingHours: shop.settings.workingHours },
  });
  return shop;
}

/** فهرست نوبت‌های آینده‌ای که با ساعت کاری جدید هم‌خوان نیستند. */
async function findFutureAppointmentsOutsideHours(shop, previousWorkingHours = []) {
  const Appointment = require('../models/Appointment');
  const { dayKeyTimeToDate, weekdayOfDayKey, toDayKey } = require('../helpers/time');
  const appointments = await Appointment.find({
    shopId: shop._id,
    status: { $in: ['held', 'confirmed', 'arrived', 'inProgress'] },
    bookedEnd: { $gt: new Date() },
  }).lean();

  const holidays = new Set((shop.settings?.holidays ?? []).map((h) => h.date));
  return appointments.filter((appt) => {
    const dayKey = appt.dayKey;
    if (holidays.has(dayKey)) return true;
    const weekday = weekdayOfDayKey(dayKey);
    const day = (shop.settings?.workingHours ?? []).find((d) => d.weekday === weekday);
    if (!day || day.intervals.length === 0) return true;
    const start = new Date(appt.bookedStart);
    const end = new Date(appt.bookedEnd);
    const inside = day.intervals.some((iv) => {
      const s = dayKeyTimeToDate(dayKey, iv.start);
      const e = dayKeyTimeToDate(dayKey, iv.end);
      return s && e && start >= s && end <= e;
    });
    return !inside;
  });
}

/** افزودن تعطیلی (روز کامل) با همان قاعده تداخل. */
async function addHoliday({ shopId, actor, date, note }) {
  assertShopAccess(shopId, actor);
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  if (shop.settings.holidays.some((h) => h.date === date)) throw AppError.conflict('این روز قبلاً تعطیل شده است');

  const before = shop.toObject();
  const previous = shop.settings.holidays.map((h) => ({ date: h.date, note: h.note }));
  shop.settings.holidays.push({ date, note: note ?? '' });
  const conflicts = await findFutureAppointmentsOutsideHours(shop);
  if (conflicts.length > 0) {
    throw AppError.conflict('در این روز نوبت ثبت‌شده وجود دارد؛ ابتدا آن‌ها را جابه‌جا یا لغو کنید', {
      conflictingAppointmentIds: conflicts.map((a) => a._id),
    });
  }

  await shop.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: 'shop.holiday.add',
    entityType: 'shops',
    entityId: shop._id,
    before: { holidays: previous },
    after: { holidays: shop.settings.holidays },
  });
  return shop;
}

async function removeHoliday({ shopId, actor, date }) {
  assertShopAccess(shopId, actor);
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  const before = shop.toObject();
  const previous = shop.settings.holidays.map((h) => ({ date: h.date, note: h.note }));
  shop.settings.holidays = shop.settings.holidays.filter((h) => h.date !== date);
  if (shop.settings.holidays.length === previous.length) throw AppError.notFound('این تعطیلی ثبت نشده است');
  await shop.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: 'shop.holiday.remove',
    entityType: 'shops',
    entityId: shop._id,
    before: { holidays: previous },
    after: { holidays: shop.settings.holidays },
  });
  return shop;
}

module.exports = {
  createShop,
  listShops,
  getShopBySlug,
  getShopById,
  updateShop,
  listBarbers,
  setWorkingHours,
  addHoliday,
  removeHoliday,
  findFutureAppointmentsOutsideHours,
  assertShopAccess,
};
