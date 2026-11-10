'use strict';

// قواعد مسدودسازی آرایشگاه (۵.۵ و ۵.۷): تغییر ساعت کاری/تعطیلی، غیرفعال‌سازی آرایشگاه و
// انتقال مالکیت نباید نوبت‌های موجود را بی‌اعتبار کند.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { oid, fakeModel } = require('./helpers/fakeModels');
const { stubModule, mockLogger } = require('./helpers/fakes');
const { dayKeyTimeToDate, toDayKey, addMinutes, weekdayOfDayKey } = require('../src/helpers/time');

mockLogger();

const models = {
  Shop: fakeModel(),
  Barber: fakeModel({ defaults: { isActive: true } }),
  User: fakeModel({ defaults: { isActive: true } }),
  Appointment: fakeModel(),
  AuditLog: fakeModel(),
};
for (const [name, model] of Object.entries(models)) stubModule(`models/${name}`, model);
stubModule('services/audit', { record: async () => ({}) });

const shopService = require('../src/services/shop');

const ownerId = oid();
const shopId = oid();
const barberId = oid();
let dayKey;

function seedShop({ holidays = [] } = {}) {
  dayKey = toDayKey(addMinutes(new Date(), 24 * 60));
  models.Shop.rows.length = 0;
  models.Shop.rows.push(
    models.Shop.hydrate({
      _id: shopId,
      name: 'آرایشگاه',
      slug: 'shop-x',
      ownerId,
      isActive: true,
      settings: {
        showPricesToGuests: true,
        workingHours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          intervals: weekday === 6 ? [] : [{ start: '09:00', end: '21:00' }],
        })),
        holidays,
      },
    }),
  );
  models.Barber.rows.length = 0;
  models.Barber.rows.push(models.Barber.hydrate({ _id: barberId, userId: ownerId, shopId, isOwner: true, isActive: true }));
  models.Appointment.rows.length = 0;
  models.Appointment.rows.push(
    models.Appointment.hydrate({
      shopId,
      barberId,
      serviceId: oid(),
      status: 'confirmed',
      dayKey,
      bookedStart: dayKeyTimeToDate(dayKey, '10:00'),
      bookedEnd: dayKeyTimeToDate(dayKey, '10:30'),
    }),
  );
}

const actor = { userId: ownerId, role: 'shopOwner', roles: ['shopOwner'], shopId };

beforeEach(() => {
  models.User.rows.length = 0;
  seedShop();
});

test('تغییر ساعت کاری که نوبت موجود را بیرون می‌گذارد رد می‌شود', async () => {
  await assert.rejects(
    () =>
      shopService.setWorkingHours({
        shopId,
        actor,
        workingHours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          intervals: [{ start: '11:00', end: '20:00' }],
        })),
      }),
    (err) => err.statusCode === 409,
  );
});

test('ساعت کاری سازگار ذخیره می‌شود', async () => {
  const shop = await shopService.setWorkingHours({
    shopId,
    actor,
    workingHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      intervals: [{ start: '09:00', end: '22:00' }],
    })),
  });
  assert.equal(shop.settings.workingHours[weekdayOfDayKey(dayKey)].intervals[0].end, '22:00');
});

test('تعطیل‌کردن روزی که نوبت دارد رد می‌شود؛ روز خالی تعطیل می‌شود', async () => {
  await assert.rejects(() => shopService.addHoliday({ shopId, actor, date: dayKey }), (err) => err.statusCode === 409);

  const otherDay = toDayKey(addMinutes(new Date(), 5 * 24 * 60));
  const shop = await shopService.addHoliday({ shopId, actor, date: otherDay, note: 'تعطیل کاری' });
  assert.ok(shop.settings.holidays.some((h) => h.date === otherDay));

  const afterRemove = await shopService.removeHoliday({ shopId, actor, date: otherDay });
  assert.ok(!afterRemove.settings.holidays.some((h) => h.date === otherDay));
});

test('غیرفعال‌کردن آرایشگاه با نوبت آینده مسدود است', async () => {
  await assert.rejects(
    () => shopService.updateShop({ shopId, actor, data: { isActive: false } }),
    (err) => err.statusCode === 409,
  );
  await assert.rejects(() => shopService.deactivateShop({ shopId, actor, reason: 'تست' }), (err) => err.statusCode === 409);
});

test('انتقال مالکیت: مالک قدیم isOwner را از دست می‌دهد و مالک جدید سند فعال می‌گیرد', async () => {
  const newOwnerId = oid();
  models.User.rows.push(models.User.hydrate({ _id: newOwnerId, mobile: '09129999999', isActive: true }));

  const result = await shopService.transferOwnership({
    shopId,
    actor: { userId: oid(), role: 'superAdmin', roles: ['superAdmin'] },
    newOwnerUserId: newOwnerId,
  });

  assert.equal(String(result.shop.ownerId), String(newOwnerId));
  assert.equal(String(result.barber.userId), String(newOwnerId));
  assert.equal(result.barber.isOwner, true);

  const oldOwnerBarber = models.Barber.rows.find((b) => String(b.userId) === String(ownerId));
  assert.equal(oldOwnerBarber.isOwner, false);
});

test('انتقال مالکیت به کاربری که مالک آرایشگاه دیگری است رد می‌شود', async () => {
  const newOwnerId = oid();
  models.User.rows.push(models.User.hydrate({ _id: newOwnerId, mobile: '09128888888', isActive: true }));
  models.Shop.rows.push(
    models.Shop.hydrate({ _id: oid(), name: 'دیگری', slug: 'other-shop', ownerId: newOwnerId, isActive: true, settings: {} }),
  );
  await assert.rejects(
    () =>
      shopService.transferOwnership({
        shopId,
        actor: { userId: oid(), role: 'superAdmin', roles: ['superAdmin'] },
        newOwnerUserId: newOwnerId,
      }),
    (err) => err.statusCode === 409,
  );
});
