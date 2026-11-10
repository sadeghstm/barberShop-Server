'use strict';

// مدیریت آرایشگران یک آرایشگاه (بخش ۴ سند): مالک با شماره موبایل آرایشگر را اضافه می‌کند.
// حذف آرایشگر = isActive:false (حذف سخت نداریم تا نوبت‌های قدیمی معتبر بمانند).

const Barber = require('../models/Barber');
const User = require('../models/User');
const Shop = require('../models/Shop');
const { ROLES, ROLE_PRIORITY } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const { normalizeMobile } = require('../helpers/mobile');
const auditService = require('./audit');

function assertShopAccess(shopId, actor) {
  const isStaff = actor.roles?.includes(ROLES.SUPER_ADMIN) || actor.roles?.includes(ROLES.ADMIN);
  if (isStaff) return;
  if (String(actor.shopId) !== String(shopId)) throw AppError.forbidden('این آرایشگاه متعلق به شما نیست');
}

/** افزودن آرایشگر به آرایشگاه با شماره موبایل. کاربر اگر نبود ساخته می‌شود. */
async function addBarber({ actor, shopId, mobile, displayName }) {
  assertShopAccess(shopId, actor);
  const shop = await Shop.findById(shopId);
  if (!shop) throw AppError.notFound('آرایشگاه یافت نشد');

  const normalized = normalizeMobile(mobile);
  if (!normalized) throw AppError.validation('شماره موبایل معتبر نیست');

  let user = await User.findOne({ mobile: normalized });
  if (!user) {
    user = await User.create({ mobile: normalized, name: displayName ?? '' });
  }
  if (!user.isActive) throw AppError.conflict('حساب این کاربر غیرفعال است');

  // قید «هر کاربر فقط در یک آرایشگاه آرایشگر فعال است»
  const existing = await Barber.findOne({ userId: user._id, isActive: true });
  if (existing) {
    if (String(existing.shopId) === String(shopId)) throw AppError.conflict('این کاربر قبلاً آرایشگر همین آرایشگاه است');
    throw AppError.conflict('این کاربر آرایشگر فعال آرایشگاه دیگری است');
  }

  // اگر سند غیرفعال قبلی برای همین آرایشگاه هست، دوباره فعال می‌شود
  let barber = await Barber.findOne({ userId: user._id, shopId });
  const before = barber ? barber.toObject() : null;
  if (barber) {
    barber.isActive = true;
    if (displayName) barber.displayName = displayName;
    await barber.save();
  } else {
    barber = await Barber.create({ userId: user._id, shopId, displayName: displayName ?? user.name ?? '' });
  }

  // نقش‌های سراسری کاربر دست‌نخورده می‌ماند؛ نقش barber از روی سند Barber محاسبه می‌شود
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: before ? 'barber.reactivate' : 'barber.add',
    entityType: 'barbers',
    entityId: barber._id,
    before,
    after: barber,
  });
  return barber;
}

async function removeBarber({ actor, shopId, barberId }) {
  assertShopAccess(shopId, actor);
  const barber = await Barber.findOne({ _id: barberId, shopId });
  if (!barber) throw AppError.notFound('آرایشگر یافت نشد');
  if (barber.isOwner) throw AppError.conflict('مالک آرایشگاه قابل حذف نیست');
  if (!barber.isActive) throw AppError.conflict('این آرایشگر قبلاً غیرفعال شده است');

  // نوبت‌های آینده نباید گم شوند
  const Appointment = require('../models/Appointment');
  const future = await Appointment.countDocuments({
    barberId: barber._id,
    status: { $in: ['held', 'confirmed', 'arrived', 'inProgress'] },
    bookedEnd: { $gt: new Date() },
  });
  if (future > 0) throw AppError.conflict('این آرایشگر نوبت آینده دارد؛ ابتدا نوبت‌ها را جابه‌جا یا لغو کنید');

  const before = barber.toObject();
  barber.isActive = false;
  await barber.save();
  await auditService.record({
    actor: { userId: actor.userId, role: actor.role, shopId },
    action: 'barber.remove',
    entityType: 'barbers',
    entityId: barber._id,
    before,
    after: barber,
  });
  return barber;
}

/** فهرست آرایشگران + نقش مؤثر و وضعیت. */
async function listShopBarbers(shopId) {
  const barbers = await Barber.find({ shopId }).lean();
  const users = await User.find({ _id: { $in: barbers.map((b) => b.userId) } }).lean();
  const map = new Map(users.map((u) => [String(u._id), u]));
  return barbers.map((b) => {
    const user = map.get(String(b.userId));
    return {
      id: b._id,
      userId: b.userId,
      isOwner: b.isOwner,
      isActive: b.isActive,
      displayName: b.displayName || user?.name || '',
      mobile: user?.mobile ?? null,
      role: b.isOwner ? ROLES.SHOP_OWNER : ROLES.BARBER,
    };
  });
}

/** پروفایل آرایشگر خودم (برای پنل آرایشگر). */
async function getMyBarberProfile(actor) {
  if (!actor.barberId) throw AppError.forbidden('شما آرایشگر نیستید');
  const barber = await Barber.findById(actor.barberId).lean();
  if (!barber) throw AppError.notFound('پروفایل آرایشگر یافت نشد');
  return barber;
}

module.exports = { addBarber, removeBarber, listShopBarbers, getMyBarberProfile, assertShopAccess, ROLE_PRIORITY };
