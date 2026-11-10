'use strict';

const { ROLES, GLOBAL_ROLES, ROLE_PRIORITY } = require('../constants/roles');

/**
 * نقش‌های واقعی کاربر:
 * - superAdmin / admin / customer از خود کاربر می‌آیند.
 * - barber و shopOwner فقط از روی عضویت فعال در آرایشگاه (جدول barbers) محاسبه می‌شوند،
 *   تا هیچ‌وقت با داده‌ی کاربر ناهماهنگ نشوند.
 */
function resolveRoles(user, barber) {
  const roles = new Set(user.roles.filter((role) => GLOBAL_ROLES.includes(role)));
  if (barber) {
    roles.add(ROLES.BARBER);
    if (barber.isOwner) roles.add(ROLES.SHOP_OWNER);
  }
  return [...roles];
}

/** نقش اصلی برای ثبت در auditLogs */
function primaryRole(roles) {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? ROLES.CUSTOMER;
}

module.exports = { resolveRoles, primaryRole };
