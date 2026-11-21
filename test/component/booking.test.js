'use strict';

const assert = require('node:assert/strict');
const { createWorld, DAY, NOW, at } = require('../helpers/bookingWorld');
const { tehranDate } = require('../../src/helpers/schedule');

const MIN = 60000;
const code = (c) => (e) => e.code === c;

describe('سرویس رزرو (با مدل‌های درون‌حافظه)', () => {
  let world;
  let svc;
  let ctx; // { shop, barber, serviceId }
  const { models } = (world = createWorld());

  before(() => {
    svc = require('../../src/services/appointment');
  });
  after(() => world.restore());
  beforeEach(async () => {
    ctx = await world.reset();
  });

  const hold = (customerId, hhmm, extra = {}) =>
    svc.hold({ customer: world.customer(customerId), shop: ctx.shop, barber: ctx.barber, serviceId: 'svc1', start: at(hhmm), now: NOW, ...extra });
  const pay = (customerId, appointmentId, outcome = 'success', now = NOW) =>
    svc.pay({ customer: world.customer(customerId), appointmentId, outcome, now });
  const times = async (extra = {}) =>
    (await svc.getAvailability({ shop: ctx.shop, barber: ctx.barber, serviceId: 'svc1', dayKey: DAY, now: NOW, ...extra })).items.map((i) => i.time);
  const seed = (data) =>
    models.Appointment.create({
      shopId: 'shop1', barberId: 'barber1', serviceId: 'svc1', customerId: 'x', source: 'online', dayKey: DAY,
      priceSnapshot: 1, durationSnapshot: 30, depositAmount: 0, status: 'confirmed',
      bookedStart: at('09:00'), bookedEnd: at('09:30'), estimatedStart: at('09:00'), estimatedEnd: at('09:30'), ...data,
    });

  describe('getAvailability', () => {
    it('روز خالی: ۹:۰۰ تا ۱۱:۳۰ هر ۵ دقیقه', async () => {
      const t = await times();
      assert.equal(t.length, 31);
      assert.deepEqual([t[0], t.at(-1)], ['09:00', '11:30']);
    });

    it('موقتِ فعال و تاییدشده و عدم‌حضور اشغال‌اند؛ منقضی، لغوشده و آرایشگر دیگر نه', async () => {
      await seed({ status: 'held', heldUntil: new Date(NOW.getTime() + MIN), customerId: 'a' });
      assert.ok(!(await times()).includes('09:00'));
      models.Appointment.reset();

      await seed({ status: 'held', heldUntil: new Date(NOW.getTime() - MIN) });
      await seed({ status: 'cancelled', bookedStart: at('10:00'), bookedEnd: at('10:30') });
      await seed({ status: 'expired', bookedStart: at('10:30'), bookedEnd: at('11:00') });
      await seed({ status: 'confirmed', barberId: 'other' });
      assert.equal((await times()).length, 31);

      models.Appointment.reset();
      await seed({ status: 'confirmed', heldUntil: new Date(0) }); // تاییدشده با heldUntil قدیمی هم اشغال است
      assert.ok(!(await times()).includes('09:00'));
      models.Appointment.reset();
      await seed({ status: 'noShow' });
      assert.ok(!(await times()).includes('09:00'));
    });

    it('تاخیر پیش‌بینی‌شده تا پایان تخمینی اشغال می‌کند', async () => {
      await seed({ estimatedStart: at('09:10'), estimatedEnd: at('09:40') });
      const t = await times();
      assert.ok(!t.includes('09:35'));
      assert.ok(t.includes('09:40'));
    });

    it('خدمت ارائه‌نشده یا حذف‌شده ۴۰۴؛ بیش از ۶۰ روز ۴۲۲؛ روز گذشته خالی', async () => {
      await models.BarberService.findOneAndUpdate({ serviceId: 'svc1' }, { isActive: false });
      await assert.rejects(times(), (e) => e.statusCode === 404);
      await models.BarberService.findOneAndUpdate({ serviceId: 'svc1' }, { isActive: true });
      await models.ServiceCatalog.findOneAndUpdate({ _id: 'svc1' }, { status: 'removing' });
      await assert.rejects(times(), (e) => e.statusCode === 404);
      await models.ServiceCatalog.findOneAndUpdate({ _id: 'svc1' }, { status: 'active' });

      await assert.rejects(times({ dayKey: '2027-01-10' }), (e) => e.statusCode === 422); // روز ۶۱
      await times({ dayKey: '2027-01-09' }); // روز ۶۰ خطا نمی‌دهد
      assert.deepEqual(await times({ dayKey: '2026-11-03' }), []);
    });
  });

  describe('hold', () => {
    it('نوبت موقت با snapshot قیمت و مدت، بیعانه ۱۵٪ و مهلت ۱۰ دقیقه', async () => {
      const { appointment: a, created } = await hold('c1', '09:00');
      assert.equal(created, true);
      assert.equal(a.status, 'held');
      assert.equal(a.dayKey, DAY);
      assert.equal(a.priceSnapshot, 150000);
      assert.equal(a.durationSnapshot, 30);
      assert.equal(a.depositAmount, 22500);
      assert.equal(a.heldUntil.getTime(), NOW.getTime() + 10 * MIN);
      assert.deepEqual([a.bookedStart, a.bookedEnd, a.estimatedStart, a.estimatedEnd], [at('09:00'), at('09:30'), at('09:00'), at('09:30')]);
      assert.ok(!(await times()).includes('09:15'));
    });

    it('گرد کردن بیعانه', async () => {
      await models.BarberService.findOneAndUpdate({ serviceId: 'svc1' }, { price: 100001 });
      assert.equal((await hold('c1', '09:00')).appointment.depositAmount, 15000);
    });

    it('آرایشگر از خودش نمی‌تواند نوبت بگیرد', async () => {
      await assert.rejects(hold('u-barber', '09:00'), (e) => e.statusCode === 403);
    });

    it('زمان گرفته‌شده؛ چسبیدن قبل و بعد مجاز؛ هم‌پوشانی نه', async () => {
      await hold('c1', '10:00');
      await assert.rejects(hold('c2', '10:00'), code('SLOT_UNAVAILABLE'));
      await assert.rejects(hold('c2', '10:15'), code('SLOT_UNAVAILABLE'));
      await assert.rejects(hold('c2', '09:45'), code('SLOT_UNAVAILABLE'));
      await hold('c2', '09:30');
      await hold('c3', '10:30');
    });

    it('زمان نامعتبر: خارج ساعت کاری، خارج شبکه ۵ دقیقه، گذشته، کمتر از ۱۵ دقیقه بعد، روز تعطیل', async () => {
      await assert.rejects(hold('c1', '08:30'), code('SLOT_UNAVAILABLE'));
      await assert.rejects(hold('c1', '11:45'), code('SLOT_UNAVAILABLE'));
      await assert.rejects(hold('c1', '09:00', { start: new Date(at('09:00').getTime() + 60000) }), code('SLOT_UNAVAILABLE'));
      await assert.rejects(hold('c1', '09:00', { now: at('08:50') }), code('SLOT_UNAVAILABLE')); // ۱۰ دقیقه مانده
      await hold('c1', '09:00', { now: at('08:45') }); // دقیقاً ۱۵ دقیقه
      ctx.shop.settings.holidays.push({ date: DAY });
      await assert.rejects(hold('c2', '10:00'), code('SLOT_UNAVAILABLE'));
      await assert.rejects(hold('c2', '09:00', { start: tehranDate('2027-02-01', '09:00') }), (e) => e.statusCode === 422);
    });

    it('هر مشتری یک موقت فعال: دیگری ۴۰۹؛ همان دوباره ← همان نوبت (created=false)', async () => {
      const first = await hold('c1', '09:00');
      await assert.rejects(hold('c1', '10:00'), code('ACTIVE_HOLD_EXISTS'));
      const again = await hold('c1', '09:00');
      assert.equal(again.created, false);
      assert.equal(again.appointment._id, first.appointment._id);
      assert.equal(await models.Appointment.countDocuments(), 1);
    });

    it('موقتِ مهلت‌گذشته‌ی خود مشتری منقضی می‌شود (با لاگ) و مشتری می‌تواند دوباره بگیرد', async () => {
      const old = (await hold('c1', '09:00')).appointment;
      const later = new Date(NOW.getTime() + 11 * MIN);
      const { appointment } = await hold('c1', '10:00', { now: later });
      assert.equal(old.status, 'expired');
      assert.equal(appointment.status, 'held');
      const log = models.AuditLog.rows().find((l) => l.action === 'appointment.expire');
      assert.equal(log.meta.reason, 'holdTimeout');
    });

    it('موقتِ منقضیِ پاکسازی‌نشده‌ی دیگران جلوی رزرو را نمی‌گیرد', async () => {
      await hold('c1', '09:00');
      const later = new Date(NOW.getTime() + 11 * MIN);
      const { appointment } = await hold('c2', '09:00', { now: later, start: at('09:00') });
      assert.equal(appointment.status, 'held');
    });

    it('نوبت تاییدشده‌ی هم‌پوشان مشتری نزد آرایشگر دیگر ← CUSTOMER_OVERLAP؛ بدون هم‌پوشانی مجاز', async () => {
      await seed({ customerId: 'c1', barberId: 'other', bookedStart: at('10:00'), bookedEnd: at('10:30') });
      await assert.rejects(hold('c1', '10:15'), code('CUSTOMER_OVERLAP'));
      await hold('c1', '10:30');
    });

    it('رقابت: ۱۰ مشتری هم‌زمان برای یک زمان ← دقیقاً یک موفق؛ قفل آزاد می‌شود', async () => {
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => hold(`c${i}`, '10:00')));
      const ok = results.filter((r) => r.status === 'fulfilled');
      assert.equal(ok.length, 1);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        assert.ok(['SLOT_UNAVAILABLE', 'ACTIVE_HOLD_EXISTS'].includes(r.reason.code), r.reason.code);
      }
      assert.equal(await models.Appointment.countDocuments(), 1);
      assert.equal(world.redis.store.size, 0);
    });

    it('رقابت: زمان‌های هم‌پوشان هم‌زمان (۹:۰۰ و ۹:۱۵ و ۹:۲۵) ← فقط یکی', async () => {
      const results = await Promise.allSettled([hold('c1', '09:00'), hold('c2', '09:15'), hold('c3', '09:25')]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    });

    it('رقابت: زمان‌های بدون هم‌پوشانی هم‌زمان ← همه موفق', async () => {
      const results = await Promise.allSettled([hold('c1', '09:00'), hold('c2', '09:30'), hold('c3', '10:00')]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
    });

    it('اگر قفل را دیگری نگه دارد و رها نکند ← ۴۲۹ بعد از انتظار', async () => {
      await world.redis.set(`lock:booking:barber1:${DAY}`, 'someone-else', 'PX', 5000, 'NX');
      const lock = require('../../src/services/lock');
      await assert.rejects(lock.withLock(`lock:booking:barber1:${DAY}`, async () => 1, { waitMs: 60, retryMs: 10 }), (e) => e.statusCode === 429);
    });
  });

  describe('pay', () => {
    it('موفق: نوبت تایید می‌شود، heldUntil پاک، پرداخت succeeded', async () => {
      const { appointment } = await hold('c1', '09:00');
      const out = await pay('c1', appointment._id);
      assert.equal(out.result, 'confirmed');
      assert.equal(out.appointment.status, 'confirmed');
      assert.equal(out.appointment.heldUntil, null);
      assert.deepEqual([out.payment.status, out.payment.amount, out.payment.gatewayAmount, out.payment.walletAmount], ['succeeded', 22500, 22500, 0]);
      assert.equal(out.payment.idempotencyKey, `deposit:${appointment._id}`);
      assert.ok(!(await times()).includes('09:00')); // هنوز اشغال است
    });

    it('تکرار پرداخت: همان نتیجه، پرداخت دوم ساخته نمی‌شود', async () => {
      const { appointment } = await hold('c1', '09:00');
      const first = await pay('c1', appointment._id);
      const again = await pay('c1', appointment._id);
      assert.equal(again.result, 'alreadyConfirmed');
      assert.equal(again.payment._id, first.payment._id);
      assert.equal(await models.Payment.countDocuments(), 1);
    });

    it('ناموفق: پرداخت failed، نوبت منقضی، بازه آزاد و مشتری می‌تواند دوباره بگیرد', async () => {
      const { appointment } = await hold('c1', '09:00');
      const out = await pay('c1', appointment._id, 'failure');
      assert.equal(out.result, 'declined');
      assert.equal(out.payment.status, 'failed');
      assert.equal(out.payment.failureReason, 'gateway_declined');
      assert.equal((await models.Appointment.findById(appointment._id)).status, 'expired');
      assert.ok((await times()).includes('09:00'));
      await hold('c1', '09:00');
      await assert.rejects(pay('c1', appointment._id), code('HOLD_EXPIRED'));
    });

    it('مهلت گذشته ← HOLD_EXPIRED و نوبت منقضی؛ دیگران ← ۴۰۴', async () => {
      const { appointment } = await hold('c1', '09:00');
      await assert.rejects(pay('c2', appointment._id), (e) => e.statusCode === 404);
      await assert.rejects(pay('c1', appointment._id, 'success', new Date(NOW.getTime() + 10 * MIN)), code('HOLD_EXPIRED'));
      assert.equal((await models.Appointment.findById(appointment._id)).status, 'expired');
      assert.equal(await models.Payment.countDocuments(), 0);
    });

    it('نوبت لغوشده ← NOT_PAYABLE', async () => {
      const a = await seed({ status: 'cancelled', customerId: 'c1' });
      await assert.rejects(pay('c1', a._id), code('NOT_PAYABLE'));
    });

    it('بیعانه صفر بدون درگاه موفق است (حتی با outcome=failure)', async () => {
      await models.Settings.create({ key: 'global', depositPercent: 0, holdMinutes: 10, minBookingLeadMinutes: 15 });
      const { appointment } = await hold('c1', '09:00');
      assert.equal(appointment.depositAmount, 0);
      assert.equal((await pay('c1', appointment._id, 'failure')).result, 'confirmed');
    });

    it('سد کمکی: اگر قفل از دست رفته و نوبت تاییدشده‌ی هم‌شروع هست ← SLOT_UNAVAILABLE و پرداخت failed', async () => {
      const { appointment } = await hold('c1', '09:00');
      await seed({ customerId: 'c9', status: 'confirmed' }); // شبیه‌سازی عبور از قفل
      await assert.rejects(pay('c1', appointment._id), code('SLOT_UNAVAILABLE'));
      assert.equal((await models.Payment.findOne({})).status, 'failed');
      assert.equal((await models.Appointment.findById(appointment._id)).status, 'expired');
    });
  });

  describe('expireStale', () => {
    it('فقط موقت‌های مهلت‌گذشته منقضی می‌شوند، با لاگ سیستمی؛ بار دوم صفر', async () => {
      const a = (await hold('c1', '09:00')).appointment;
      const b = (await hold('c2', '10:00')).appointment;
      const c = (await hold('c3', '11:00')).appointment;
      b.heldUntil = new Date(NOW.getTime() + 60 * MIN);
      c.heldUntil = new Date(NOW.getTime() + 60 * MIN);
      const confirmed = await seed({ bookedStart: at('09:30'), bookedEnd: at('10:00'), heldUntil: null });

      const later = new Date(NOW.getTime() + 11 * MIN);
      assert.equal(await svc.expireStale(later), 1);
      assert.deepEqual([a.status, b.status, c.status, confirmed.status], ['expired', 'held', 'held', 'confirmed']);
      const log = models.AuditLog.rows().at(-1);
      assert.deepEqual([log.action, log.actor.role], ['appointment.expire', 'system']);
      assert.equal(await svc.expireStale(later), 0);
    });
  });

  describe('listMine / getMine', () => {
    it('فقط نوبت‌های خود مشتری، جدیدترین اول، با نام‌ها و صفحه‌بندی', async () => {
      await seed({ customerId: 'c1', bookedStart: at('09:00'), bookedEnd: at('09:30') });
      await seed({ customerId: 'c1', bookedStart: at('10:00'), bookedEnd: at('10:30') });
      await seed({ customerId: 'c2', bookedStart: at('11:00'), bookedEnd: at('11:30') });

      const { items, total } = await svc.listMine('c1', { page: 1, limit: 1 });
      assert.equal(total, 2);
      assert.equal(items.length, 1);
      assert.deepEqual(items[0].appointment.bookedStart, at('10:00'));
      assert.deepEqual([items[0].shopName, items[0].barberName, items[0].serviceTitle], ['آرایشگاه تست', 'رضا', 'اصلاح سر']);
      assert.equal((await svc.listMine('c1', { page: 2, limit: 1 })).items.length, 1);
    });

    it('getMine: نوبت دیگران ← ۴۰۴', async () => {
      const a = await seed({ customerId: 'c1' });
      assert.equal((await svc.getMine('c1', a._id)).appointment._id, a._id);
      await assert.rejects(svc.getMine('c2', a._id), (e) => e.statusCode === 404);
    });
  });
});
