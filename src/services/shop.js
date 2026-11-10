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

async function listShops({ city, q, page = 1, limit = 20 }) {
  const query = { isActive: true };
  if (city) query.city = city;
  if (q) query.name = { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [rows, total] = await Promise.all([
    Shop.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Shop.countDocuments(query),
  ]);
  return { rows, total };
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

/** تنظیمات آرایشگاه را به آبجکت ساده تبدیل می‌کند (نested path مونگو یا آبجکت ساده در تست). */
function settingsSnapshot(shop) {
  const settings = shop?.settings;
  if (!settings) return {};
  if (typeof settings.toObject === 'function') return settings.toObject();
  return { ...settings };
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

  // غیرفعال‌کردن آرایشگاه با نوبت آینده مسدود است (همان قاعده چرخه حذف، ۵.۵)
  if (data.isActive === false && shop.isActive) {
    const future = await countFutureAppointments(shop._id);
    if (future > 0) {
      throw AppError.conflict('این آرایشگاه نوبت آینده دارد؛ ابتدا نوبت‌ها را لغو یا جابه‌جا کنید', {
        futureAppointments: future,
      });
    }
  }

  const allowed = ['name', 'city', 'address', 'phone', 'isActive'];
  for (const key of allowed) {
    if (data[key] !== undefined) shop[key] = data[key];
  }
  // ادغام تنظیمات تا PATCH جزئی (مثلاً فقط نمایش قیمت) ساعت کاری را پاک نکند
  if (data.settings !== undefined) {
    if (typeof data.settings !== 'object' || data.settings === null) {
      throw AppError.validation('settings باید آبجکت باشد');
    }
    const next = { ...settingsSnapshot(shop), ...data.settings };
    shop.settings = next;
  }
  if (data.showPricesToGuests !== undefined) shop.settings.showPricesToGuests = Boolean(data.showPricesToGuests);

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

/** تعداد نوبت‌های آینده یک آرایشگاه (مشترک بین غیرفعال‌سازی و انتقال مالکیت). */
async function countFutureAppointments(shopId, serviceId) {
  const Appointment = require('../models/Appointment');
  const query = {
    shopId,
    status: { $in: ['held', 'confirmed', 'arrived', 'inProgress'] },
    bookedEnd: { $gt: new Date() },
  };
  if (serviceId) query.serviceId = serviceId;
  return Appointment.countDocuments(query);
}

/** غیرفعال‌سازی آرایشگاه توسط ادمین (بدون حذف سخت). */
async function deactivateShop({ shopId, actor, reason }) {
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  if (!shop.isActive) throw AppError.conflict('این آرایشگاه قبلاً غیرفعال شده است');
  const future = await countFutureAppointments(shop._id);
  if (future > 0) {
    throw AppError.conflict('این آرایشگاه نوبت آینده دارد؛ ابتدا نوبت‌ها را لغو یا جابه‌جا کنید', {
      futureAppointments: future,
    });
  }
  const before = shop.toObject();
  shop.isActive = false;
  await shop.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'shop.deactivate',
    entityType: 'shops',
    entityId: shop._id,
    before,
    after: shop,
    meta: { reason: reason ?? null },
  });
  return shop;
}

async function activateShop({ shopId, actor }) {
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  if (shop.isActive) throw AppError.conflict('این آرایشگاه فعال است');
  const before = shop.toObject();
  shop.isActive = true;
  await shop.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'shop.activate',
    entityType: 'shops',
    entityId: shop._id,
    before,
    after: shop,
  });
  return shop;
}

/**
 * انتقال مالکیت آرایشگاه (فقط سوپر ادمین).
 * مالک قدیم آرایشگر می‌ماند ولی isOwner از او برداشته می‌شود؛ مالک جدید سند Barber فعال می‌گیرد.
 */
async function transferOwnership({ shopId, actor, newOwnerUserId }) {
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  const newOwner = await User.findById(newOwnerUserId);
  if (!newOwner || !newOwner.isActive) throw AppError.notFound('کاربر مالک جدید یافت نشد');
  if (String(shop.ownerId) === String(newOwner._id)) throw AppError.conflict('این کاربر مالک فعلی آرایشگاه است');

  const ownsAnother = await Shop.findOne({ ownerId: newOwner._id, isActive: true, _id: { $ne: shop._id } });
  if (ownsAnother) throw AppError.conflict('این کاربر مالک آرایشگاه دیگری است');

  const elsewhere = await Barber.findOne({ userId: newOwner._id, isActive: true });
  if (elsewhere && String(elsewhere.shopId) !== String(shop._id)) {
    throw AppError.conflict('کاربر مالک جدید، آرایشگر فعال آرایشگاه دیگری است');
  }

  const before = shop.toObject();
  const oldOwnerBarber = await Barber.findOne({ userId: shop.ownerId, shopId: shop._id, isOwner: true });
  if (oldOwnerBarber) {
    oldOwnerBarber.isOwner = false;
    await oldOwnerBarber.save();
  }

  let newOwnerBarber = await Barber.findOne({ userId: newOwner._id, shopId: shop._id });
  if (newOwnerBarber) {
    newOwnerBarber.isOwner = true;
    newOwnerBarber.isActive = true;
    await newOwnerBarber.save();
  } else {
    newOwnerBarber = await Barber.create({
      userId: newOwner._id,
      shopId: shop._id,
      isOwner: true,
      displayName: newOwner.name ?? '',
    });
  }

  shop.ownerId = newOwner._id;
  await shop.save();

  await auditService.record({
    actor: { userId: actor.userId, role: actor.role },
    action: 'shop.transferOwnership',
    entityType: 'shops',
    entityId: shop._id,
    before,
    after: shop,
    meta: { newOwnerId: newOwner._id, newOwnerBarberId: newOwnerBarber._id },
  });
  return { shop, barber: newOwnerBarber };
}

/** فهرست همه آرایشگاه‌ها برای پنل ادمین (شامل غیرفعال‌ها). */
async function listAllShops({ city, isActive, page = 1, limit = 50 }) {
  const query = {};
  if (city) query.city = city;
  if (isActive !== undefined) query.isActive = isActive;
  const [rows, total] = await Promise.all([
    Shop.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Shop.countDocuments(query),
  ]);
  return { rows, total, page, limit };
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

  // اول با ساعت کاری پیشنهادی بررسی می‌کنیم؛ اگر تداخل داشت، سند دست‌نخورده می‌ماند
  const candidate = {
    _id: shop._id,
    settings: { ...settingsSnapshot(shop), workingHours },
  };
  const conflicts = await findFutureAppointmentsOutsideHours(candidate);
  if (conflicts.length > 0) {
    throw AppError.conflict('با این ساعت کاری، نوبت‌های موجود خارج از ساعت کاری می‌افتند', {
      conflictingAppointmentIds: conflicts.map((a) => a._id),
    });
  }

  shop.settings.workingHours = workingHours;
  await shop.validate();
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
async function findFutureAppointmentsOutsideHours(shop) {
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
  const nextHolidays = [...previous, { date, note: note ?? '' }];

  const candidate = { _id: shop._id, settings: { ...settingsSnapshot(shop), holidays: nextHolidays } };
  const conflicts = await findFutureAppointmentsOutsideHours(candidate);
  if (conflicts.length > 0) {
    throw AppError.conflict('در این روز نوبت ثبت‌شده وجود دارد؛ ابتدا آن‌ها را جابه‌جا یا لغو کنید', {
      conflictingAppointmentIds: conflicts.map((a) => a._id),
    });
  }

  shop.settings.holidays.push({ date, note: note ?? '' });
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
  deactivateShop,
  activateShop,
  transferOwnership,
  listAllShops,
  countFutureAppointments,
  listBarbers,
  setWorkingHours,
  addHoliday,
  removeHoliday,
  findFutureAppointmentsOutsideHours,
  assertShopAccess,
};
