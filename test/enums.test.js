'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const e = require('../src/constants/enums');

test('وضعیت‌های بلوکه‌کننده زیرمجموعه وضعیت‌های نوبت‌اند و noShow فقط برای آنلاین بلوکه است', () => {
  for (const s of e.ONLINE_BLOCKING_STATUSES) assert.ok(e.APPOINTMENT_STATUSES.includes(s));
  assert.ok(!e.BLOCKING_STATUSES.includes('noShow'));
  assert.ok(e.ONLINE_BLOCKING_STATUSES.includes('noShow'));
  assert.ok(!e.BLOCKING_STATUSES.includes('expired') && !e.BLOCKING_STATUSES.includes('cancelled'));
});

test('ثابت‌ها فریز شده‌اند', () => {
  assert.ok(Object.isFrozen(e.APPOINTMENT_STATUS));
  assert.ok(Object.isFrozen(e.BLOCKING_STATUSES));
});
