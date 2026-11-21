'use strict';

const Shop = require('../models/Shop');
const Barber = require('../models/Barber');
const { AppError } = require('../helpers/AppError');
const userService = require('./user');
const upcomingService = require('./upcoming');
const { fitsInWorkingHours } = require('../helpers/schedule');

async function getOrThrow(shopId) {
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');
  return shop;
}

/** برای مسیرهای عمومی: آرایشگاه غیرفعال مثل آرایشگاه ناموجود است. */
async function getActiveOrThrow(shopId) {
  const shop = await getOrThrow(shopId);
  if (!shop.isActive) throw AppError.notFound('آرایشگاه یافت نشد');
  return shop;
}

/**
 * آرایشگاه جدید + مالکش را می‌سازد. مالک یک آرایشگر با isOwner=true است (او خودش هم نوبت می‌گیرد).
 * اگر موبایل مالک کاربر نداشت، ساخته می‌شود.
 * تراکنش نداریم (سند طراحی: Replica Set لازم نیست)؛ پس اگر ساخت آرایشگر شکست خورد، آرایشگاه را پاک می‌کنیم.
 */
async function create({ name, slug, city, address, phone, ownerMobile, ownerName }) {
  const { user: owner, isNew: ownerIsNew } = await userService.findOrCreateByMobile(ownerMobile);
  if (await Barber.exists({ userId: owner._id, isActive: true })) {
    throw AppError.conflict('این کاربر هم‌اکنون در یک آرایشگاه آرایشگر است');
  }
  if (!owner.name) {
    owner.name = ownerName;
    await owner.save();
  }

  const shop = await Shop.create({ name, slug, city, address, phone });
  try {
    const barber = await Barber.create({ userId: owner._id, shopId: shop._id, isOwner: true, displayName: ownerName });
    return { shop, barber, owner, ownerIsNew };
  } catch (err) {
    await Shop.deleteOne({ _id: shop._id });
    throw err;
  }
}

/** فهرست آرایشگاه‌های فعال (عمومی). */
async function list({ city, page, limit }) {
  const filter = { isActive: true };
  if (city) filter.city = city;

  const [items, total] = await Promise.all([
    Shop.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('name slug city address phone'),
    Shop.countDocuments(filter),
  ]);
  return { items, total };
}

/** تغییرات (مثل { name: '...', 'settings.showPricesToGuests': false }) را روی سند اعمال و ذخیره می‌کند. */
async function update(shop, changes) {
  shop.set(changes);
  await shop.save();
  return shop;
}

/** ساعت کاری جدید فقط وقتی پذیرفته می‌شود که همه‌ی نوبت‌های آینده‌ی آرایشگاه هنوز داخل آن جا شوند (۵.۵ سند). */
async function setWorkingHours(shop, workingHours) {
  const upcoming = await upcomingService.find({ shopId: shop._id });
  const outside = upcoming.filter(
    (a) => !fitsInWorkingHours({ dayKey: a.dayKey, start: a.bookedStart, end: a.bookedEnd }, workingHours, shop.settings.holidays),
  );
  if (outside.length > 0) throw upcomingService.blocked(outside, 'خارج از ساعت کاری جدید');

  shop.settings.workingHours = workingHours;
  await shop.save();
  return shop;
}

/** روز تعطیل اضافه می‌کند؛ یک‌مرحله‌ای (atomic) تا دو درخواست هم‌زمان تکراری نسازند. */
async function addHoliday(shopId, { date, note }) {
  await upcomingService.assertNone({ shopId, dayKey: date }, 'نوبت در روز تعطیل');
  const shop = await Shop.findOneAndUpdate(
    { _id: shopId, 'settings.holidays.date': { $ne: date } },
    { $push: { 'settings.holidays': { date, note } } },
    { new: true, runValidators: true },
  );
  if (shop) return shop;
  await getOrThrow(shopId); // اگر آرایشگاه اصلاً نبود → ۴۰۴
  throw AppError.conflict('این روز قبلاً به‌عنوان تعطیل ثبت شده است');
}

async function removeHoliday(shopId, date) {
  const shop = await Shop.findOneAndUpdate(
    { _id: shopId, 'settings.holidays.date': date },
    { $pull: { 'settings.holidays': { date } } },
    { new: true },
  );
  if (shop) return shop;
  await getOrThrow(shopId);
  throw AppError.notFound('این روز در تعطیلات ثبت نشده است');
}

module.exports = { getOrThrow, getActiveOrThrow, create, list, update, setWorkingHours, addHoliday, removeHoliday };
