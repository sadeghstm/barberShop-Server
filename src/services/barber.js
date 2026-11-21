'use strict';

const Barber = require('../models/Barber');
const { AppError } = require('../helpers/AppError');
const userService = require('./user');
const upcomingService = require('./upcoming');

/** آرایشگران فعال یک آرایشگاه (عمومی؛ بدون موبایل). */
async function listPublic(shopId) {
  return Barber.find({ shopId, isActive: true }).sort({ isOwner: -1, createdAt: 1 }).select('displayName isOwner');
}

/** همه آرایشگران یک آرایشگاه با موبایل (برای مالک و ادمین). */
async function listStaff(shopId) {
  return Barber.find({ shopId }).sort({ isOwner: -1, createdAt: 1 }).populate('userId', 'mobile name');
}

/** آرایشگر جدید به آرایشگاه اضافه می‌کند (کاربر با این موبایل اگر نبود ساخته می‌شود). */
async function add(shopId, { mobile, displayName }) {
  const { user, isNew } = await userService.findOrCreateByMobile(mobile);

  const current = await Barber.findOne({ userId: user._id, isActive: true });
  if (current) {
    const sameShop = String(current.shopId) === String(shopId);
    throw AppError.conflict(sameShop ? 'این کاربر قبلاً در همین آرایشگاه ثبت شده است' : 'این کاربر در آرایشگاه دیگری آرایشگر است');
  }

  const barber = await Barber.create({ userId: user._id, shopId, displayName });
  return { barber, user, isNew };
}

/** فقط آرایشگرِ همین آرایشگاه پیدا می‌شود (محدودسازی به آرایشگاه)، وگرنه ۴۰۴. */
async function getInShopOrThrow(shopId, barberId) {
  const barber = await Barber.findOne({ _id: barberId, shopId });
  if (!barber) throw AppError.notFound('آرایشگر یافت نشد');
  return barber;
}

/** مثل بالا ولی آرایشگر باید فعال باشد (برای تنظیم خدمات و نمایش عمومی). */
async function getActiveInShopOrThrow(shopId, barberId) {
  const barber = await Barber.findOne({ _id: barberId, shopId, isActive: true });
  if (!barber) throw AppError.notFound('آرایشگر یافت نشد');
  return barber;
}

/** changes: { displayName?, isActive? } */
async function update(barber, changes) {
  if (changes.isActive === false && barber.isOwner) {
    throw AppError.conflict('مالک آرایشگاه را نمی‌توان غیرفعال کرد');
  }
  if (changes.isActive === true && !barber.isActive) {
    const elsewhere = await Barber.exists({ userId: barber.userId, isActive: true, _id: { $ne: barber._id } });
    if (elsewhere) throw AppError.conflict('این کاربر در آرایشگاه دیگری آرایشگر فعال است');
  }
  if (changes.isActive === false && barber.isActive) {
    await upcomingService.assertNone({ barberId: barber._id }, 'غیرفعال‌کردن آرایشگر');
  }

  barber.set(changes);
  await barber.save();
  return barber;
}

module.exports = { listPublic, listStaff, add, getInShopOrThrow, getActiveInShopOrThrow, update };
