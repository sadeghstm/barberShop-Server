'use strict';

// شکل پاسخ‌ها: زمان UTC + dayKey و ساعت تهران (تبدیل شمسی در کلاینت) و پنهان‌سازی قیمت برای مهمان.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timeView, appointmentView, priceView } = require('../src/helpers/serialize');

test('timeView هم ISO و هم روز/ساعت تهران را می‌دهد', () => {
  const view = timeView(new Date('2026-11-10T06:00:00Z'));
  assert.deepEqual(view, { iso: '2026-11-10T06:00:00.000Z', dayKey: '2026-11-10', time: '09:30' });
  assert.equal(timeView(null), null);
  assert.equal(timeView('not-a-date'), null);
});

test('appointmentView فیلدهای عمومی نوبت را برمی‌گرداند', () => {
  const view = appointmentView({
    _id: 'a1',
    shopId: 's1',
    barberId: 'b1',
    serviceId: 'c1',
    customerId: 'u1',
    source: 'online',
    status: 'confirmed',
    dayKey: '2026-11-10',
    bookedStart: new Date('2026-11-10T06:00:00Z'),
    bookedEnd: new Date('2026-11-10T06:30:00Z'),
    estimatedStart: new Date('2026-11-10T06:00:00Z'),
    estimatedEnd: new Date('2026-11-10T06:30:00Z'),
    priceSnapshot: 200000,
    durationSnapshot: 30,
    depositAmount: 30000,
  });
  assert.equal(view.id, 'a1');
  assert.equal(view.status, 'confirmed');
  assert.equal(view.bookedStart.time, '09:30');
  assert.equal(view.depositAmount, 30000);
  assert.equal(view.heldUntil, null);
  assert.equal(view.cancelRequest, null);
});

test('قیمت برای مهمان پنهان می‌شود اگر آرایشگاه این را خواسته باشد', () => {
  const hidden = { settings: { showPricesToGuests: false } };
  const open = { settings: { showPricesToGuests: true } };
  assert.equal(priceView(100000, { shop: hidden, authenticated: false }), null);
  assert.equal(priceView(100000, { shop: hidden, authenticated: true }), 100000);
  assert.equal(priceView(100000, { shop: open, authenticated: false }), 100000);
});
