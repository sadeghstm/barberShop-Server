'use strict';

// تابع محاسبه زمان آزاد (بخش ۵.۱): تابع خالص، شبکه ۵ دقیقه‌ای، حداقل ۱۵ دقیقه فاصله،
// ساعت کاری/تعطیلی و نوبت‌های مسدودکننده (held منقضی مسدودکننده نیست).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeFreeSlots, findFirstWalkInSlot, isBlocking } = require('../src/services/availability');
const { ONLINE_BLOCKING_STATUSES, BLOCKING_STATUSES } = require('../src/constants/enums');
const { dayKeyTimeToDate, addMinutes, weekdayOfDayKey } = require('../src/helpers/time');

const DAY_KEY = '2026-11-10'; // سه‌شنبه → weekday 3

function makeShop({ intervals = [{ start: '09:00', end: '12:00' }], holidays = [] } = {}) {
  return { settings: { workingHours: [{ weekday: weekdayOfDayKey(DAY_KEY), intervals }], holidays } };
}

const at = (hhmm) => dayKeyTimeToDate(DAY_KEY, hhmm);
const times = (slots) => slots.map((s) => new Date(s).toISOString());

test('بدون نوبت: شروع‌های شبکه ۵ دقیقه‌ای تا جایی که خدمت جا شود', () => {
  const slots = computeFreeSlots({
    shop: makeShop(),
    dayKey: DAY_KEY,
    durationMinutes: 30,
    now: new Date('2026-11-01T00:00:00Z'),
    minLeadMinutes: 0,
  });
  // 09:00 تا 11:30 (آخرین شروع) → 31 اسلات
  assert.equal(slots.length, 31);
  assert.equal(slots[0].toISOString(), at('09:00').toISOString());
  assert.equal(slots.at(-1).toISOString(), at('11:30').toISOString());
});

test('حداقل فاصله رزرو آنلاین رعایت می‌شود', () => {
  const now = at('09:07');
  const slots = computeFreeSlots({
    shop: makeShop(),
    dayKey: DAY_KEY,
    durationMinutes: 30,
    now,
    minLeadMinutes: 15,
  });
  // 09:07 + 15 = 09:22 → اولین اسلات روی شبکه ۵ دقیقه‌ای: 09:25
  assert.equal(slots[0].toISOString(), at('09:25').toISOString());
});

test('نوبت مسدودکننده، بازه‌اش را حذف می‌کند و بقیه آزاد می‌مانند', () => {
  const appointments = [
    { status: 'confirmed', bookedStart: at('09:30'), bookedEnd: at('10:00') },
  ];
  const slots = computeFreeSlots({
    shop: makeShop(),
    dayKey: DAY_KEY,
    durationMinutes: 30,
    appointments,
    now: new Date('2026-11-01T00:00:00Z'),
    minLeadMinutes: 0,
  });
  const iso = times(slots);
  assert.ok(!iso.includes(at('09:30').toISOString()));
  assert.ok(!iso.includes(at('09:05').toISOString())); // 09:05+30 = 09:35 overlaps
  assert.ok(iso.includes(at('09:00').toISOString())); // 09:00-09:30 مرز مشترک، آزاد
  assert.ok(iso.includes(at('10:00').toISOString()));
});

test('held منقضی‌شده مسدودکننده نیست ولی held فعال هست', () => {
  const now = at('09:00');
  const expired = { status: 'held', heldUntil: addMinutes(now, -1), bookedStart: at('09:30'), bookedEnd: at('10:00') };
  const active = { status: 'held', heldUntil: addMinutes(now, 30), bookedStart: at('09:30'), bookedEnd: at('10:00') };

  assert.equal(isBlocking(expired, now), false);
  assert.equal(isBlocking(active, now), true);

  const iso = times(
    computeFreeSlots({
      shop: makeShop(),
      dayKey: DAY_KEY,
      durationMinutes: 30,
      appointments: [expired],
      now,
      minLeadMinutes: 0,
    }),
  );
  assert.ok(iso.includes(at('09:30').toISOString()));
});

test('status های cancelled/expired اشغال نمی‌کنند', () => {
  for (const status of ['cancelled', 'expired']) {
    assert.equal(isBlocking({ status, bookedStart: at('09:00'), bookedEnd: at('10:00') }, new Date()), false);
  }
});

test('نوبت سوخته (noShow) برای رزرو آنلاین بسته است ولی برای مشتری حضوری باز', () => {
  const now = at('09:00');
  const burned = { status: 'noShow', bookedStart: at('09:30'), bookedEnd: at('10:00') };
  assert.equal(isBlocking(burned, now), true); // پیش‌فرض = آنلاین
  assert.equal(isBlocking(burned, now, BLOCKING_STATUSES), false);

  const onlineSlots = times(
    computeFreeSlots({ shop: makeShop(), dayKey: DAY_KEY, durationMinutes: 30, appointments: [burned], now, minLeadMinutes: 0 }),
  );
  assert.ok(!onlineSlots.includes(at('09:30').toISOString()));
  assert.ok(onlineSlots.includes(at('10:00').toISOString()));

  const walkInSlot = findFirstWalkInSlot({
    shop: makeShop(),
    dayKey: DAY_KEY,
    durationMinutes: 30,
    appointments: [burned],
    now,
  });
  assert.equal(walkInSlot.toISOString(), at('09:00').toISOString());
});

test('انواع وضعیت‌های مسدودکننده: آنلاین شامل noShow و حضوری بدون آن', () => {
  assert.ok(ONLINE_BLOCKING_STATUSES.includes('noShow'));
  assert.ok(!BLOCKING_STATUSES.includes('noShow'));
  for (const status of ['held', 'confirmed', 'arrived', 'inProgress']) {
    assert.ok(BLOCKING_STATUSES.includes(status));
  }
});

test('تعطیلی و روز بدون ساعت کاری هیچ اسلاتی ندارد', () => {
  assert.deepEqual(
    computeFreeSlots({
      shop: makeShop({ holidays: [{ date: DAY_KEY, note: 'تعطیل' }] }),
      dayKey: DAY_KEY,
      durationMinutes: 30,
      now: new Date('2026-11-01T00:00:00Z'),
      minLeadMinutes: 0,
    }),
    [],
  );

  const closedWeekday = {
    settings: { workingHours: [{ weekday: (weekdayOfDayKey(DAY_KEY) + 1) % 7, intervals: [{ start: '09:00', end: '12:00' }] }], holidays: [] },
  };
  assert.deepEqual(
    computeFreeSlots({
      shop: closedWeekday,
      dayKey: DAY_KEY,
      durationMinutes: 30,
      now: new Date('2026-11-01T00:00:00Z'),
      minLeadMinutes: 0,
    }),
    [],
  );
});

test('چند بازه کاری (صبح/عصر) و پر شدن کامل یک بازه', () => {
  const shop = makeShop({
    intervals: [
      { start: '09:00', end: '10:00' },
      { start: '17:00', end: '18:00' },
    ],
  });
  const appointments = [
    { status: 'confirmed', bookedStart: at('09:00'), bookedEnd: at('09:30') },
    { status: 'arrived', bookedStart: at('09:30'), bookedEnd: at('10:00') },
  ];
  const iso = times(
    computeFreeSlots({
      shop,
      dayKey: DAY_KEY,
      durationMinutes: 60,
      appointments,
      now: new Date('2026-11-01T00:00:00Z'),
      minLeadMinutes: 0,
    }),
  );
  // بازه صبح کاملاً پر است؛ فقط شروع 17:00 در بازه عصر می‌ماند
  assert.deepEqual(iso, [at('17:00').toISOString()]);
});

test('مشتری حضوری می‌تواند جای نوبت سوخته (noShow) را بگیرد', () => {
  const now = at('09:00');
  const noShow = { status: 'noShow', bookedStart: at('09:00'), bookedEnd: at('09:30') };
  const slot = findFirstWalkInSlot({
    shop: makeShop(),
    dayKey: DAY_KEY,
    durationMinutes: 30,
    appointments: [noShow],
    now,
  });
  assert.ok(slot);
  assert.equal(slot.toISOString(), at('09:00').toISOString());
});

test('خدمت با مدت نامعتبر اسلاتی ندارد', () => {
  for (const duration of [0, -5, 1.5, null]) {
    assert.deepEqual(
      computeFreeSlots({
        shop: makeShop(),
        dayKey: DAY_KEY,
        durationMinutes: duration,
        now: new Date('2026-11-01T00:00:00Z'),
        minLeadMinutes: 0,
      }),
      [],
    );
  }
});
