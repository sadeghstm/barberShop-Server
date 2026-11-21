'use strict';

const assert = require('node:assert/strict');
const { createWorld } = require('../helpers/bookingWorld');

const code = (c) => (e) => e.code === c;

describe('چرخه‌ی حذف خدمت از کاتالوگ', () => {
  const world = createWorld();
  const { models } = world;
  let svc;
  let step = 0;

  const admin = { userId: 'admin1', role: 'admin', roles: ['admin'] };
  const HOUR = 3600000;

  before(() => {
    svc = require('../../src/services/catalog');
  });
  after(() => world.restore());
  beforeEach(async () => {
    await world.reset();
    step = 0;
  });

  // نوبت آینده برای svc1 (استفاده از ساعت واقعی چون upcoming از «الان» می‌پرسد)
  const upcoming = (extra = {}) => {
    const start = new Date(Date.now() + (step += 1) * HOUR);
    return models.Appointment.create({
      shopId: 'shop1', barberId: 'barber1', serviceId: 'svc1', customerId: `c${step}`, source: 'online', status: 'confirmed',
      dayKey: '2030-01-01', bookedStart: start, bookedEnd: new Date(start.getTime() + 1800000),
      estimatedStart: start, estimatedEnd: new Date(start.getTime() + 1800000), heldUntil: null, ...extra,
    });
  };

  describe('requestRemoval', () => {
    it('بدون نوبت آینده: فوراً آرشیو می‌شود (pending=false) و لاگ دارد', async () => {
      const out = await svc.requestRemoval('svc1', admin, 'اصلاح سر');
      assert.deepEqual([out.service.status, out.pending], ['archived', false]);
      assert.ok(out.service.archivedAt);
      assert.deepEqual(models.AuditLog.rows().map((l) => l.action), ['service.archive']);
    });

    it('با نوبت آینده: «در حال حذف» می‌ماند (pending=true) و ثبت درخواست‌دهنده', async () => {
      await upcoming();
      const out = await svc.requestRemoval('svc1', admin, 'اصلاح سر');
      assert.deepEqual([out.service.status, out.pending, out.service.removalRequestedBy], ['removing', true, 'admin1']);
      assert.equal(out.service.archivedAt ?? null, null);
    });

    it('تایید صریح: عنوان اشتباه ۴۲۲ و چیزی تغییر نمی‌کند؛ عنوان با ی/ک عربی و فاصله قبول است', async () => {
      await assert.rejects(svc.requestRemoval('svc1', admin, 'اصلاح'), (e) => e.statusCode === 422 && e.details[0].field === 'confirmTitle');
      assert.equal((await models.ServiceCatalog.findById('svc1')).status, 'active');
      await upcoming();
      await svc.requestRemoval('svc1', admin, '  اصلاح   سر ');
      assert.equal((await models.ServiceCatalog.findById('svc1')).status, 'removing');
    });

    it('خدمت ناموجود ۴۰۴؛ غیرفعال ← NOT_ACTIVE', async () => {
      await assert.rejects(svc.requestRemoval('nope', admin, 'x'), (e) => e.statusCode === 404);
      await upcoming();
      await svc.requestRemoval('svc1', admin, 'اصلاح سر');
      await assert.rejects(svc.requestRemoval('svc1', admin, 'اصلاح سر'), code('NOT_ACTIVE'));
    });

    it('خدمت در حال حذف از رزرو و فهرست فروش بسته است، ولی نوبت‌های قبلی دست‌نخورده‌اند', async () => {
      const a = await upcoming();
      await svc.requestRemoval('svc1', admin, 'اصلاح سر');
      const offers = require('../../src/services/barberService');
      assert.deepEqual(await offers.listOffers({ shopId: 'shop1' }), []);
      assert.equal(a.status, 'confirmed');
      const appointment = require('../../src/services/appointment');
      await assert.rejects(
        appointment.getAvailability({ shop: await models.Shop.findById('shop1'), barber: await models.Barber.findById('barber1'), serviceId: 'svc1', dayKey: '2026-11-20' }),
        (e) => e.statusCode === 404,
      );
    });
  });

  describe('archiveFinished (کار دوره‌ای)', () => {
    it('تا وقتی نوبتی مانده آرشیو نمی‌شود؛ بعد از تمام‌شدن همه، آرشیو با لاگ سیستمی', async () => {
      const a = await upcoming();
      const b = await upcoming({ status: 'inProgress' });
      await svc.requestRemoval('svc1', admin, 'اصلاح سر');
      assert.equal(await svc.archiveFinished(), 0);

      a.status = 'completed';
      assert.equal(await svc.archiveFinished(), 0); // هنوز b
      b.status = 'completed';
      assert.equal(await svc.archiveFinished(), 1);
      assert.equal((await models.ServiceCatalog.findById('svc1')).status, 'archived');
      const log = models.AuditLog.rows().at(-1);
      assert.deepEqual([log.action, log.actor.role], ['service.archive', 'system']);
      assert.equal(await svc.archiveFinished(), 0);
    });

    it('نوبت لغوشده، منقضی، عدم‌حضور و موقتِ مهلت‌گذشته مانع نیستند؛ موقتِ فعال مانع است', async () => {
      await upcoming({ status: 'cancelled' });
      await upcoming({ status: 'expired' });
      await upcoming({ status: 'noShow' });
      await upcoming({ status: 'held', heldUntil: new Date(Date.now() - 1000) });
      const live = await upcoming({ status: 'held', heldUntil: new Date(Date.now() + 60000) });
      await models.ServiceCatalog.findOneAndUpdate({ _id: 'svc1' }, { status: 'removing' });
      assert.equal(await svc.archiveFinished(), 0);
      live.status = 'expired';
      assert.equal(await svc.archiveFinished(), 1);
    });

    it('نوبت آینده‌ی خدمت دیگر مانع نیست', async () => {
      await models.ServiceCatalog.create({ _id: 'svc2', title: 'اصلاح ریش' });
      await upcoming({ serviceId: 'svc2' });
      await svc.requestRemoval('svc1', admin, 'اصلاح سر');
      assert.equal((await models.ServiceCatalog.findById('svc1')).status, 'archived');
    });
  });

  describe('restore', () => {
    it('انصراف از حذف و بازگرداندن آرشیوشده: دوباره فعال و فیلدهای حذف پاک', async () => {
      await upcoming();
      await svc.requestRemoval('svc1', admin, 'اصلاح سر');
      const back = await svc.restore('svc1');
      assert.deepEqual([back.service.status, back.service.removalRequestedBy, back.before.status], ['active', null, 'removing']);

      await models.ServiceCatalog.findOneAndUpdate({ _id: 'svc1' }, { status: 'archived', archivedAt: new Date() });
      const again = await svc.restore('svc1');
      assert.deepEqual([again.service.status, again.service.archivedAt], ['active', null]);
    });

    it('خدمت فعال ← ALREADY_ACTIVE؛ ناموجود ۴۰۴', async () => {
      await assert.rejects(svc.restore('svc1'), code('ALREADY_ACTIVE'));
      await assert.rejects(svc.restore('nope'), (e) => e.statusCode === 404);
    });
  });
});
