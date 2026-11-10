'use strict';

// نقش‌های بخش ۴ سند طراحی
const ROLES = Object.freeze({
  SUPER_ADMIN: 'superAdmin',
  ADMIN: 'admin',
  SHOP_OWNER: 'shopOwner',
  BARBER: 'barber',
  CUSTOMER: 'customer',
});

// کارهای خودکار (انقضای نگه‌داشتن موقت، عدم حضور خودکار، ...) در auditLogs با این نقش ثبت می‌شوند
const SYSTEM_ACTOR = 'system';

// نقش‌هایی که روی خود کاربر ذخیره می‌شوند. barber و shopOwner از روی جدول barbers محاسبه می‌شوند.
const GLOBAL_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CUSTOMER]);

// نقش اصلی (برای auditLogs) = اولین نقش از این فهرست که کاربر دارد
const ROLE_PRIORITY = Object.freeze([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SHOP_OWNER, ROLES.BARBER, ROLES.CUSTOMER]);

const USER_ROLES = Object.freeze(Object.values(ROLES));
const ALL_ACTOR_ROLES = Object.freeze([...USER_ROLES, SYSTEM_ACTOR]);

module.exports = { ROLES, GLOBAL_ROLES, ROLE_PRIORITY, SYSTEM_ACTOR, USER_ROLES, ALL_ACTOR_ROLES };
