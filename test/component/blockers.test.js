'use strict';

const assert = require('node:assert/strict');
const { createWorld, DAY, at } = require('../helpers/bookingWorld');

describe('مسدودسازی تغییرات وقتی نوبت آینده هست (۵.۵ سند)', () => {
  const world = createWorld();
  const { models } = world;
  let shopService;
  let barberService;
  let offerService;
  let upcoming;
  let ctx;

  before(() => {
    shopService = require('../../src/services/shop');
    barberService = require('../../src/services/barber');
    offerService = require('../../src/services/barberService');
    upcoming = require('../../src/services/upcoming');
  });
  after(() => world.restore());
  beforeEach(async () => {
    ctx = await world.reset();
  });

  let step = 0; // هر نوبت آینده شروع متفاوتی دارد (ایندکس یکتای شروع)
  const seed = (data = {}) =>
    models.Appointment.create({
      shopId: 'shop1', barberId: 'barber1', serviceId: 'svc1', customerId: 'c1', source: 'online', status: 'confirmed',
      dayKey: DAY, bookedStart: at('09:00'), bookedEnd: at('09:30'), estimatedStart: at('09:00'), estimatedEnd: at('09:30'), heldUntil: null,
      ...data,
    });
  const upcomingSeed = (data = {}) => {
    const start = new Date(Date.now() + 3600000 + (step += 1) * 3600000); // upcoming از ساعت واقعی استفاده می‌کند
    return seed({ bookedStart: start, bookedEnd: new Date(start.getTime() + 1800000), ...data });
  };
  const blockedBy = (e) => e.statusCode === 409 && e.code === 'HAS_UPCOMING_APPOINTMENTS';

  describe('upcoming.find', () => {
    it('تاییدشده/حاضر/در حال انجام و موقتِ فعال را می‌شمارد؛ گذشته، منقضی، لغوشده و موقتِ مهلت‌گذشته را نه', async () => {
      await upcomingSeed({ status: 'confirmed' });
      await upcomingSeed({ status: 'arrived', customerId: 'c2' });
      await upcomingSeed({ status: 'inProgress', customerId: 'c3' });
      await upcomingSeed({ status: 'held', heldUntil: new Date(Date.now() + 60000), customerId: 'c4' });
      await upcomingSeed({ status: 'held', heldUntil: new Date(Date.now() - 60000), customerId: 'c5' });
      await upcomingSeed({ status: 'cancelled', customerId: 'c6' });
      await upcomingSeed({ status: 'expired', customerId: 'c7' });
      await upcomingSeed({ status: 'completed', customerId: 'c8' });
      await seed({ bookedStart: new Date(Date.now() - 7200000), bookedEnd: new Date(Date.now() - 3600000) }); // گذشته
      assert.equal((await upcoming.find({ shopId: 'shop1' })).length, 4);
      assert.equal((await upcoming.find({ shopId: 'other' })).length, 0);
    });

    it('assertNone: خطای ۴۰۹ با تعداد و تاریخ‌ها', async () => {
      await upcomingSeed();
      await assert.rejects(upcoming.assertNone({ barberId: 'barber1' }, 'تست'), (e) => {
        assert.ok(blockedBy(e));
        assert.equal(e.details.count, 1);
        assert.deepEqual(e.details.dates, [DAY]);
        return true;
      });
      await upcoming.assertNone({ barberId: 'nobody' }, 'تست');
    });
  });

  describe('ساعت کاری', () => {
    const hours = (start, end) => [{ weekday: 3, intervals: [{ start, end }] }];

    it('بدون نوبت آینده تغییر می‌کند', async () => {
      await shopService.setWorkingHours(ctx.shop, hours('10:00', '11:00'));
      assert.equal(ctx.shop.settings.workingHours[0].intervals[0].start, '10:00');
    });

    it('نوبتی که از ساعت جدید بیرون می‌زند ← مسدود؛ نوبتی که داخل می‌ماند ← مجاز', async () => {
      const day = '2030-01-01';
      const { weekdayOf, tehranDate } = require('../../src/helpers/schedule');
      const weekday = weekdayOf(day);
      await seed({ dayKey: day, bookedStart: tehranDate(day, '09:00'), bookedEnd: tehranDate(day, '09:30') });

      const wh = (start, end) => [{ weekday, intervals: [{ start, end }] }];
      await assert.rejects(shopService.setWorkingHours(ctx.shop, wh('10:00', '12:00')), blockedBy); // بعد از نوبت شروع می‌شود
      await assert.rejects(shopService.setWorkingHours(ctx.shop, []), blockedBy); // روز تعطیل می‌شود
      await assert.rejects(shopService.setWorkingHours(ctx.shop, wh('09:00', '09:20')), blockedBy); // کوتاه‌تر از نوبت
      await shopService.setWorkingHours(ctx.shop, wh('09:00', '09:30')); // دقیقاً جا می‌شود
      await shopService.setWorkingHours(ctx.shop, wh('08:00', '12:00'));
    });

    it('روزی که تعطیل شده و نوبت دارد ← مسدود', async () => {
      const day = '2030-01-01';
      const { weekdayOf, tehranDate } = require('../../src/helpers/schedule');
      ctx.shop.settings.workingHours = [{ weekday: weekdayOf(day), intervals: [{ start: '08:00', end: '12:00' }] }];
      ctx.shop.settings.holidays = [{ date: day }];
      await seed({ dayKey: day, bookedStart: tehranDate(day, '09:00'), bookedEnd: tehranDate(day, '09:30') });
      await assert.rejects(shopService.setWorkingHours(ctx.shop, ctx.shop.settings.workingHours), blockedBy);
    });
  });

  describe('تعطیلی', () => {
    it('روزی که نوبت دارد ← مسدود (آرایشگاه عوض نمی‌شود)', async () => {
      const day = '2030-01-01';
      const { tehranDate } = require('../../src/helpers/schedule');
      await seed({ dayKey: day, bookedStart: tehranDate(day, '09:00'), bookedEnd: tehranDate(day, '09:30') });
      await assert.rejects(shopService.addHoliday('shop1', { date: day, note: '' }), blockedBy);
      assert.equal(ctx.shop.settings.holidays.length, 0);
    });
  });

  describe('غیرفعال‌کردن آرایشگر', () => {
    it('با نوبت آینده ← مسدود؛ بدون آن ← مجاز؛ فعال‌کردن/تغییر نام مسدود نمی‌شود', async () => {
      await upcomingSeed();
      await assert.rejects(barberService.update(ctx.barber, { isActive: false }), blockedBy);
      assert.equal(ctx.barber.isActive, true);
      await barberService.update(ctx.barber, { displayName: 'نام تازه' });

      models.Appointment.reset();
      await barberService.update(ctx.barber, { isActive: false });
      assert.equal(ctx.barber.isActive, false);
    });
  });

  describe('خدمات آرایشگر', () => {
    it('غیرفعال‌سازی و حذف با نوبت آینده‌ی همان خدمت ← مسدود؛ خدمت دیگر ← مجاز', async () => {
      await upcomingSeed({ serviceId: 'svc1' });
      await assert.rejects(offerService.setActive(ctx.barber, 'svc1', false), blockedBy);
      await assert.rejects(offerService.remove(ctx.barber, 'svc1'), blockedBy);
      assert.equal((await models.BarberService.findOne({ serviceId: 'svc1' })).isActive, true);

      await models.BarberService.create({ barberId: 'barber1', shopId: 'shop1', serviceId: 'svc2', price: 1, durationMinutes: 5, isActive: true });
      await offerService.setActive(ctx.barber, 'svc2', false);
      await offerService.remove(ctx.barber, 'svc2');
      assert.equal(await models.BarberService.countDocuments({ serviceId: 'svc2' }), 0);
    });

    it('فعال‌سازی با نوبت آینده مسدود نیست؛ ۴۰۴ برای تنظیم‌نشده', async () => {
      await upcomingSeed();
      await models.BarberService.findOneAndUpdate({ serviceId: 'svc1' }, { isActive: false });
      const out = await offerService.setActive(ctx.barber, 'svc1', true);
      assert.equal(out.changed, true);
      await assert.rejects(offerService.setActive(ctx.barber, 'nope', true), (e) => e.statusCode === 404);
    });
  });
});
