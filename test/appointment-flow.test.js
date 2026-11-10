'use strict';

// جریان اصلی نوبت‌دهی (بخش ۵.۱، ۵.۲، ۵.۶) با مدل‌های سبک در حافظه:
// رزرو موقت → جلوگیری از هم‌پوشانی و موقت دوم → پرداخت شبیه‌سازی‌شده → لغو با بازگشت بیعانه.
// هیچ اتصالی به مونگو/ردیس لازم نیست.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRedis, stubModule, mockLogger } = require('./helpers/fakes');
const { dayKeyTimeToDate, toDayKey, addMinutes } = require('../src/helpers/time');

const { oid, fakeModel } = require('./helpers/fakeModels');
const redis = createFakeRedis();
mockLogger();

const models = {
  Appointment: fakeModel(),
  Payment: fakeModel({ defaults: { status: 'pending' } }),
  Refund: fakeModel(),
  Wallet: fakeModel({ defaults: { balance: 0 } }),
  WalletTransaction: fakeModel(),
  AuditLog: fakeModel(),
  Settings: fakeModel(),
  Barber: fakeModel({ defaults: { isActive: true } }),
  ServiceCatalog: fakeModel({ defaults: { status: 'active' } }),
  BarberService: fakeModel(),
  Shop: fakeModel(),
  User: fakeModel(),
};

for (const [name, model] of Object.entries(models)) stubModule(`models/${name}`, model);
stubModule('db/redis', { redis, connectRedis: async () => {}, closeRedis: async () => {} });
stubModule('services/audit', { record: async () => ({}) });

const settingsService = require('../src/services/settings');
const appointmentService = require('../src/services/appointment');
const catalogService = require('../src/services/catalog');

// ---- چیدمان ثابت: یک آرایشگاه ۲۴ ساعته، یک آرایشگر، یک خدمت ۳۰ دقیقه‌ای ۲۰۰ هزار تومانی ----
const shopId = oid();
const barberId = oid();
const barberUserId = oid();
const serviceId = oid();
const customerId = oid();

let startDate;
let dayKey;

function seed() {
  const now = new Date();
  // فردا ۱۰:۰۰ تهران: همیشه در آینده است و از نیمه‌شب عبور نمی‌کند
  dayKey = toDayKey(addMinutes(now, 24 * 60));
  startDate = dayKeyTimeToDate(dayKey, '10:00');

  models.Shop.rows.length = 0;
  models.Shop.rows.push(
    models.Shop.hydrate({
      _id: shopId,
      name: 'آرایشگاه تست',
      isActive: true,
      settings: {
        showPricesToGuests: true,
        workingHours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          intervals: [{ start: '08:00', end: '22:00' }],
        })),
        holidays: [],
      },
    }),
  );

  models.Barber.rows.length = 0;
  models.Barber.rows.push(models.Barber.hydrate({ _id: barberId, userId: barberUserId, shopId, isActive: true }));

  models.ServiceCatalog.rows.length = 0;
  models.ServiceCatalog.rows.push(models.ServiceCatalog.hydrate({ _id: serviceId, title: 'اصلاح مو', status: 'active' }));

  models.BarberService.rows.length = 0;
  models.BarberService.rows.push(
    models.BarberService.hydrate({ barberId, shopId, serviceId, price: 200000, durationMinutes: 30, isActive: true }),
  );

  models.Appointment.rows.length = 0;
  models.Payment.rows.length = 0;
  models.Refund.rows.length = 0;
  models.Wallet.rows.length = 0;
  models.WalletTransaction.rows.length = 0;
  models.Settings.rows.length = 0;
  models.Settings.rows.push(models.Settings.hydrate({ key: 'global', ...settingsService.DEFAULTS }));

  models.User.rows.length = 0;
  models.User.rows.push(models.User.hydrate({ _id: customerId, mobile: '09121234567', referredBy: null }));
  models.User.rows.push(models.User.hydrate({ _id: barberUserId, mobile: '09120000000', referredBy: null }));
}

beforeEach(() => {
  redis.store.clear();
  seed();
});

test('زمان‌های آزاد فردا با قیمت و مدت خدمت برمی‌گردد', async () => {
  const result = await appointmentService.getAvailability({
    shopId,
    barberId,
    serviceId,
    dayKey,
  });
  assert.equal(result.durationMinutes, 30);
  assert.equal(result.price, 200000);
  assert.equal(result.slots[0].toISOString(), dayKeyTimeToDate(dayKey, '08:00').toISOString());
  assert.equal(result.slots.length, (14 * 60) / 5 - 6 + 1); // 08:00 تا 21:30
});

test('رزرو: نوبت موقت با بیعانه ۱۵٪ ساخته می‌شود و اسلات اشغال می‌شود', async () => {
  const held = await appointmentService.createHold({
    shopId,
    barberId,
    serviceId,
    customerId,
    bookedStart: startDate,
  });
  assert.equal(held.status, 'held');
  assert.equal(held.depositAmount, 30000); // ۱۵٪ از ۲۰۰٫۰۰۰
  assert.ok(held.heldUntil instanceof Date);
  const holdMinutes = (held.heldUntil - new Date()) / 60000;
  assert.ok(holdMinutes > 9 && holdMinutes <= 10);

  const availability = await appointmentService.getAvailability({ shopId, barberId, serviceId, dayKey });
  assert.ok(!availability.slots.some((s) => s.getTime() === startDate.getTime()));
});

test('رزرو: بازه هم‌پوشان رد می‌شود و نوبتی ساخته نمی‌شود', async () => {
  await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });

  const otherCustomer = oid();
  models.User.rows.push(models.User.hydrate({ _id: otherCustomer, mobile: '09121111111', referredBy: null }));

  await assert.rejects(
    () =>
      appointmentService.createHold({
        shopId,
        barberId,
        serviceId,
        customerId: otherCustomer,
        bookedStart: addMinutes(startDate, 10),
      }),
    (err) => err.statusCode === 409,
  );
  assert.equal(models.Appointment.rows.length, 1);
});

test('رزرو: هر مشتری هم‌زمان فقط یک موقت فعال دارد', async () => {
  await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  await assert.rejects(
    () =>
      appointmentService.createHold({
        shopId,
        barberId,
        serviceId,
        customerId,
        bookedStart: addMinutes(startDate, 60),
      }),
    (err) => err.statusCode === 409,
  );
});

test('رزرو: کمتر از ۱۵ دقیقه بعد از الان و خارج ساعت کاری رد می‌شود', async () => {
  const now = new Date();
  const soonDayKey = toDayKey(now);
  const soon = dayKeyTimeToDate(soonDayKey, '00:00');
  await assert.rejects(
    () => appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: soon }),
    (err) => err.statusCode === 422,
  );

  const outside = dayKeyTimeToDate(dayKey, '23:40'); // ۲۴ ساعته نیستیم: بعد از ۲۲:۰۰
  await assert.rejects(
    () => appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: outside }),
    (err) => err.statusCode === 422,
  );
});

test('آرایشگر نمی‌تواند از خودش نوبت بگیرد', async () => {
  await assert.rejects(
    () =>
      appointmentService.createHold({
        shopId,
        barberId,
        serviceId,
        customerId: barberUserId,
        bookedStart: startDate,
      }),
    (err) => err.statusCode === 403,
  );
});

test('پرداخت شبیه‌سازی‌شده: نوبت تایید می‌شود و پرداخت ثبت می‌گردد', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  const { appointment, payment } = await appointmentService.confirmWithPayment({
    appointmentId: held._id,
    customerId,
    useWallet: true,
  });

  assert.equal(appointment.status, 'confirmed');
  assert.equal(appointment.heldUntil, null);
  assert.equal(payment.amount, 30000);
  assert.equal(payment.walletAmount, 0);
  assert.equal(payment.gatewayAmount, 30000);
  assert.equal(payment.status, 'succeeded');
});

test('پرداخت نوبت منقضی‌شده رد می‌شود و نوبت expired می‌ماند', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  held.heldUntil = addMinutes(new Date(), -1);

  await assert.rejects(
    () => appointmentService.confirmWithPayment({ appointmentId: held._id, customerId }),
    (err) => err.statusCode === 409,
  );
  assert.equal(models.Appointment.rows[0].status, 'expired');
});

test('لغو بیش از ۲ ساعت قبل، بیعانه را به کیف پول برمی‌گرداند', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  await appointmentService.confirmWithPayment({ appointmentId: held._id, customerId });

  const cancelled = await appointmentService.cancelByCustomer({ appointmentId: held._id, customerId });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(models.Refund.rows.length, 1);
  assert.equal(models.Refund.rows[0].amount, 30000);
  assert.equal(models.Refund.rows[0].destination, 'wallet');

  const wallet = models.Wallet.rows.find((w) => String(w.userId) === String(customerId));
  assert.equal(wallet.balance, 30000);
});

test('گذر وضعیت: تکمیل بدون «حاضر شد» ممکن نیست', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  await appointmentService.confirmWithPayment({ appointmentId: held._id, customerId });

  const actor = { userId: barberUserId, role: 'barber', roles: ['barber'], shopId, barberId };
  await assert.rejects(
    () => appointmentService.markCompleted({ appointmentId: held._id, actor, finalPrice: 200000, paidInPerson: 200000 }),
    (err) => err.statusCode === 409,
  );

  await appointmentService.markArrived({ appointmentId: held._id, actor });
  await appointmentService.markStarted({ appointmentId: held._id, actor });
  const completed = await appointmentService.markCompleted({
    appointmentId: held._id,
    actor,
    finalPrice: 220000,
    paidInPerson: 220000,
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.finalPrice, 220000);
});

test('انقضای موقت‌های گذشته', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  held.heldUntil = addMinutes(new Date(), -1);
  const expired = await appointmentService.expireHolds();
  assert.equal(expired, 1);
  assert.equal(models.Appointment.rows[0].status, 'expired');
});

test('مشتری حضوری در اولین جای خالی ثبت و مستقیم «حاضر شد» می‌شود', async () => {
  // نوبت آنلاین ۱۰:۰۰ را اشغال می‌کنیم؛ مشتری حضوری باید جای دیگری بگیرد
  await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  await appointmentService.confirmWithPayment({ appointmentId: models.Appointment.rows[0]._id, customerId });

  const walkIn = await appointmentService.createWalkIn({
    shopId,
    barberId,
    serviceId,
    actor: { userId: barberUserId, role: 'barber', roles: ['barber'], shopId, barberId },
    walkInName: 'مشتری حضوری',
  });

  assert.equal(walkIn.status, 'arrived');
  assert.equal(walkIn.source, 'walkIn');
  // با نوبت تاییدشده تداخل ندارد
  const booked = models.Appointment.rows.find((a) => a.source === 'online');
  const overlap = walkIn.bookedStart < booked.bookedEnd && booked.bookedStart < walkIn.bookedEnd;
  assert.equal(overlap, false);
});

test('پرداخت ناموفق: نوبت منقضی می‌شود و بازه دوباره آزاد است', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  const result = await appointmentService.confirmWithPayment({
    appointmentId: held._id,
    customerId,
    simulateFailure: true,
  });
  assert.equal(result.failed, true);
  assert.equal(result.payment.status, 'failed');
  assert.equal(models.Appointment.rows[0].status, 'expired');

  const availability = await appointmentService.getAvailability({ shopId, barberId, serviceId, dayKey });
  assert.ok(availability.slots.some((slot) => slot.getTime() === startDate.getTime()));
});

test('دو رزرو هم‌زمان روی یک بازه: فقط یکی موفق می‌شود (قفل ردیس)', async () => {
  const secondCustomer = oid();
  models.User.rows.push(models.User.hydrate({ _id: secondCustomer, mobile: '09122222222', referredBy: null }));

  const results = await Promise.allSettled([
    appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate }),
    appointmentService.createHold({ shopId, barberId, serviceId, customerId: secondCustomer, bookedStart: startDate }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(models.Appointment.rows.length, 1);
  assert.ok(rejected[0].reason.statusCode === 409);
});

test('برگشت «تکمیل شده» توسط ادمین: پورسانت معرفی خنثی می‌شود', async () => {
  const referrerId = oid();
  models.User.rows.push(models.User.hydrate({ _id: referrerId, mobile: '09123333333', referredBy: null }));
  const customer = models.User.rows.find((u) => String(u._id) === String(customerId));
  customer.referredBy = referrerId;
  models.Settings.rows[0].referralCommissionPercent = 20;

  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  await appointmentService.confirmWithPayment({ appointmentId: held._id, customerId });

  const actor = { userId: barberUserId, role: 'barber', roles: ['barber'], shopId, barberId };
  await appointmentService.markArrived({ appointmentId: held._id, actor });
  await appointmentService.markStarted({ appointmentId: held._id, actor });
  await appointmentService.markCompleted({ appointmentId: held._id, actor, finalPrice: 200000, paidInPerson: 0 });

  const referrerWallet = models.Wallet.rows.find((w) => String(w.userId) === String(referrerId));
  assert.equal(referrerWallet.balance, 40000); // ۲۰٪ از ۲۰۰٫۰۰۰

  const admin = { userId: oid(), role: 'admin', roles: ['admin'] };
  const reverted = await appointmentService.revertCompletion({
    appointmentId: held._id,
    actor: admin,
    reason: 'اشتباه در ثبت مبلغ',
  });
  assert.equal(reverted.status, 'confirmed');
  assert.equal(reverted.finalPrice, null);
  assert.equal(referrerWallet.balance, 0);

  const reversal = models.WalletTransaction.rows.find((t) => t.type === 'commissionReversal');
  assert.ok(reversal);
  assert.equal(reversal.amount, -40000);
});

test('غیرفعال‌کردن خدمت آرایشگر با نوبت آینده مسدود است', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  await appointmentService.confirmWithPayment({ appointmentId: held._id, customerId });

  const owner = { userId: barberUserId, role: 'shopOwner', roles: ['shopOwner'], shopId };
  await assert.rejects(
    () => catalogService.deactivateBarberService({ actor: owner, shopId, barberId, serviceId }),
    (err) => err.statusCode === 409,
  );
  // خدمت همچنان فعال است
  const bs = models.BarberService.rows[0];
  assert.equal(bs.isActive, true);
});

test('تغییر قیمت/مدت خدمت روی نوبت‌های موجود اثر ندارد (snapshot)', async () => {
  const held = await appointmentService.createHold({ shopId, barberId, serviceId, customerId, bookedStart: startDate });
  const owner = { userId: barberUserId, role: 'shopOwner', roles: ['shopOwner'], shopId };
  await catalogService.upsertBarberService({
    actor: owner,
    shopId,
    barberId,
    serviceId,
    price: 500000,
    durationMinutes: 60,
    isActive: true,
  });
  assert.equal(held.priceSnapshot, 200000);
  assert.equal(held.durationSnapshot, 30);
});
