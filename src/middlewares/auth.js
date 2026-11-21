'use strict';

const { ROLES } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const { resolveRoles, primaryRole, isPlatformStaff } = require('../helpers/roles');
const sessionService = require('../services/session');
const User = require('../models/User');
const Barber = require('../models/Barber');

const COOKIE_NAME = 'token';

/** کاربر واردشده را از روی کوکی می‌سازد: { userId, mobile, name, role, roles, shopId, barberId }؛ بدون ورود معتبر → null */
async function loadAuth(req) {
  const userId = await sessionService.getUserId(req.cookies?.[COOKIE_NAME]);
  if (!userId) return null;

  const [user, barber] = await Promise.all([
    User.findById(userId),
    Barber.findOne({ userId, isActive: true }),
  ]);
  if (!user || !user.isActive) return null;

  const roles = resolveRoles(user, barber);
  return {
    userId: user._id,
    mobile: user.mobile,
    name: user.name,
    role: primaryRole(roles), // نقش اصلی (برای auditLogs)
    roles,
    shopId: barber ? barber.shopId : null, // فقط برای آرایشگر و مالک
    barberId: barber ? barber._id : null,
  };
}

/** ورود الزامی است؛ نتیجه در req.auth */
async function authenticate(req, res, next) {
  const auth = await loadAuth(req);
  if (!auth) throw AppError.unauthorized();
  req.auth = auth;
  next();
}

/** ورود اختیاری است (مسیرهای عمومی که برای کاربر واردشده چیز بیشتری نشان می‌دهند، مثل قیمت). req.auth یا هست یا نیست. */
async function optionalAuthenticate(req, res, next) {
  const auth = await loadAuth(req);
  if (auth) req.auth = auth;
  next();
}

/**
 * فقط کاربری که حداقل یکی از این نقش‌ها را دارد رد می‌شود.
 *   router.post('/', authenticate, requireRole(ROLES.ADMIN), controller.create)
 */
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.auth.roles.some((role) => allowed.includes(role))) throw AppError.forbidden();
    next();
  };
}

/**
 * محدودسازی به آرایشگاه (بخش ۴ سند): ادمین‌ها به همه آرایشگاه‌ها دسترسی دارند،
 * مالک و آرایشگر فقط به آرایشگاه خودشان. شناسه آرایشگاه از پارامتر مسیر می‌آید.
 *   router.get('/:shopId/barbers', authenticate, requireRole(ROLES.SHOP_OWNER), requireShopAccess(), ...)
 */
function requireShopAccess(paramName = 'shopId') {
  return (req, res, next) => {
    const isMemberOfShop = req.auth.shopId && String(req.auth.shopId) === req.params[paramName];
    if (!isPlatformStaff(req.auth.roles) && !isMemberOfShop) throw AppError.forbidden();
    next();
  };
}

module.exports = { COOKIE_NAME, authenticate, optionalAuthenticate, requireRole, requireShopAccess };
