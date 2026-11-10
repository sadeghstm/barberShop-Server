'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRoles, primaryRole } = require('../src/helpers/roles');
const { ROLES } = require('../src/constants/roles');

test('کاربر ساده فقط مشتری است', () => {
  assert.deepEqual(resolveRoles({ roles: ['customer'] }, null), ['customer']);
});

test('آرایشگر عادی: مشتری + آرایشگر', () => {
  const roles = resolveRoles({ roles: ['customer'] }, { isOwner: false });
  assert.deepEqual(roles.sort(), ['barber', 'customer']);
});

test('مالک: هم آرایشگر هم مالک است (بخش ۴ سند)', () => {
  const roles = resolveRoles({ roles: ['customer'] }, { isOwner: true });
  assert.ok(roles.includes('barber') && roles.includes('shopOwner'));
});

test('نقش barber/shopOwner ذخیره‌شده روی خود کاربر بدون عضویت نادیده گرفته می‌شود', () => {
  assert.deepEqual(resolveRoles({ roles: ['customer', 'barber', 'shopOwner'] }, null), ['customer']);
});

test('نقش اصلی بر اساس اولویت', () => {
  assert.equal(primaryRole(['customer', 'barber', 'shopOwner']), ROLES.SHOP_OWNER);
  assert.equal(primaryRole(['customer', 'admin', 'barber']), ROLES.ADMIN);
  assert.equal(primaryRole(['customer', 'superAdmin']), ROLES.SUPER_ADMIN);
  assert.equal(primaryRole([]), ROLES.CUSTOMER);
});
