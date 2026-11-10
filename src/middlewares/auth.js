'use strict';

const { ROLES } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const { resolveRoles, primaryRole } = require('../helpers/roles');
const sessionService = require('../services/session');
const User = require('../models/User');
const Barber = require('../models/Barber');

const COOKIE_NAME = 'token';

/**
 * کاربر واردشده را از روی کوکی پیدا می‌کند و می‌گذارد:
 *   req.auth = { userId, mobile, name, role, roles, shopId, barberId }
 * role نقش اصلی است (برای auditLogs). shopId/barberId فقط برای آرایشگر و مالک پر است.
 */
async function authenticate(req, res, next) {
  const userId = await sessionService.getUserId(req.cookies?.[COOKIE_NAME]);
  if (!userId) throw AppError.unauthorized();

  const [user, barber] = await Promise.all([
    User.findById(userId),
    Barber.findOne({ userId, isActive: true }),
  ]);
  if (!user || !user.isActive) throw AppError.unauthorized();

  const roles = resolveRoles(user, barber);
  req.auth = {
    userId: user._id,
    mobile: user.mobile,
    name: user.name,
    role: primaryRole(roles),
    roles,
    shopId: barber ? barber.shopId : null,
    barberId: barber ? barber._id : null,
  };
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
    const isPlatformStaff = req.auth.roles.includes(ROLES.SUPER_ADMIN) || req.auth.roles.includes(ROLES.ADMIN);
    const isMemberOfShop = req.auth.shopId && String(req.auth.shopId) === req.params[paramName];
    if (!isPlatformStaff && !isMemberOfShop) throw AppError.forbidden();
    next();
  };
}

module.exports = { COOKIE_NAME, authenticate, requireRole, requireShopAccess };
