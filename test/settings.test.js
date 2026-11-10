'use strict';

// پیش‌فرض‌های تنظیمات سراسری مطابق سند طراحی (بخش ۵.۱، ۵.۳، ۵.۶، ۵.۷).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS } = require('../src/services/settings');
const { TRANSITIONS } = require('../src/services/appointment');

test('پیش‌فرض‌های تنظیمات با سند هم‌خوان است', () => {
  assert.equal(DEFAULTS.depositPercent, 15);
  assert.equal(DEFAULTS.noShowGraceMinutes, 5);
  assert.equal(DEFAULTS.minBookingLeadMinutes, 15);
  assert.equal(DEFAULTS.holdMinutes, 10);
  assert.equal(DEFAULTS.delayNotifyThresholdMinutes, 10);
  assert.equal(DEFAULTS.cancelRefundHoursBefore, 2);
  assert.equal(DEFAULTS.referralCommissionPercent, 0);
  assert.ok(Object.isFrozen(DEFAULTS));
});

test('ماشین وضعیت نوبت: فقط گذرهای مجاز سند', () => {
  assert.deepEqual([...TRANSITIONS.held].sort(), ['cancelled', 'confirmed', 'expired']);
  assert.deepEqual([...TRANSITIONS.confirmed].sort(), ['arrived', 'cancelled', 'noShow']);
  assert.deepEqual([...TRANSITIONS.arrived].sort(), ['cancelled', 'inProgress', 'noShow']);
  assert.deepEqual([...TRANSITIONS.inProgress].sort(), ['cancelled', 'completed']);
  // وضعیت‌های پایانی
  for (const terminal of ['completed', 'expired', 'cancelled', 'noShow']) {
    assert.deepEqual(TRANSITIONS[terminal], []);
  }
  // «موقت» مستقیم به «حاضر شد» نمی‌رود (پرداخت تایید اول لازم است)
  assert.ok(!TRANSITIONS.held.includes('arrived'));
});
