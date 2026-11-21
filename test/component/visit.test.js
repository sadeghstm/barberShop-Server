'use strict';

const assert = require('node:assert/strict');
const { createWorld, DAY, at } = require('../helpers/bookingWorld');

const MIN = 60000;
const code = (c) => (e) => e.code === c;

describe('کارهای روز آرایشگر (حاضر شد، شروع، پایان، عدم حضور، حضوری)', () => {
  const world = createWorld();
  const { models } = world;
  let visit;
  let ctx;
  let seq = 0;

  const self = { userId: 'u-barber', role: 'barber', roles: ['barber', 'customer'], shopId: 'shop1', barberId: 'barber1' };
  const owner = { userId: 'u-owner', role: 'shopOwner', roles: ['shopOwner', 'barber', 'customer'], shopId: 'shop1', barberId: 'owner-barber' };
  const colleague = { userId: 'u-col', role: 'barber', roles: ['barber', 'customer'], shopId: 'shop1', barberId: 'barber-2' };
  const stranger = { userId: 'u-far', role: 'shopOwner', roles: ['shopOwner', 'barber'], shopId: 'shop2', barberId: 'far' };

  before(() => {
    visit = require('../../src/services/visit');
  });
  after(() => world.restore());
  beforeEach(async () => {
    ctx = await world.reset();
    seq = 0;
  });

  // نوبت تاییدشده‌ی ۳۰ دقیقه‌ای
  const seed = (hhmm, extra = {}) => {
    const start = at(hhmm);
    return models.Appointment.create({
      shopId: 'shop1', barberId: 'barber1', serviceId: 'svc1', customerId: `c${++seq}`, source: 'online', dayKey: DAY,
      status: 'confirmed', priceSnapshot: 150000, durationSnapshot: 30, depositAmount: 22500,
      bookedStart: start, bookedEnd: new Date(start.getTime() + 30 * MIN), estimatedStart: start, estimatedEnd: new Date(start.getTime() + 30 * MIN),
      heldUntil: null, noShowHold: false, arrivedAt: null, startedAt: null, finishedAt: null, ...extra,
    });
  };
  const run = (action, a, { actor = self, now = at('09:00'), extra } = {}) =>
    visit.perform({ actor, shopId: 'shop1', appointmentId: a._id, action, extra, now });

  describe('perform', () => {
    it('مسیر کامل: حاضر ← شروع ← پایان؛ قیمت نهایی و پرداخت حضوری پیش‌فرض', async () => {
      const a = await seed('09:00');
      assert.equal((await run('arrive', a, { now: at('08:55') })).appointment.status, 'arrived');
      assert.deepEqual(a.arrivedAt, at('08:55'));
      assert.equal((await run('start', a, { now: at('09:02') })).appointment.status, 'inProgress');
      assert.deepEqual(a.startedAt, at('09:02'));
      const done = await run('complete', a, { now: at('09:32') });
      assert.equal(done.appointment.status, 'completed');
      assert.deepEqual([a.finalPrice, a.paidInPerson, a.finishedAt], [150000, 127500, at('09:32')]);
    });

    it('پایان با مبلغ دلخواه', async () => {
      const a = await seed('09:00');
      await run('start', a);
      await run('complete', a, { extra: { finalPrice: 200000, paidInPerson: 180000 } });
      assert.deepEqual([a.finalPrice, a.paidInPerson], [200000, 180000]);
    });

    it('شروع بدون ثبت حضور، حضور را هم‌زمان ثبت می‌کند', async () => {
      const a = await seed('09:00');
      await run('start', a, { now: at('09:03') });
      assert.deepEqual([a.arrivedAt, a.startedAt], [at('09:03'), at('09:03')]);
    });

    it('گذار نامعتبر ۴۰۹؛ تکرار همان کار ۴۰۹', async () => {
      const a = await seed('09:00');
      await assert.rejects(run('complete', a), code('INVALID_TRANSITION'));
      await run('arrive', a);
      await assert.rejects(run('arrive', a), code('INVALID_TRANSITION'));
      await assert.rejects(run('noShow', a), code('INVALID_TRANSITION'));
    });

    it('دسترسی: خود آرایشگر و مالک مجازند؛ همکار ۴۰۳؛ آرایشگاه دیگر ۴۰۴ یا ۴۰۳', async () => {
      const a = await seed('09:00');
      await assert.rejects(run('arrive', a, { actor: colleague }), (e) => e.statusCode === 403);
      await assert.rejects(run('arrive', a, { actor: stranger }), (e) => e.statusCode === 403);
      await assert.rejects(visit.perform({ actor: stranger, shopId: 'shop2', appointmentId: a._id, action: 'arrive' }), (e) => e.statusCode === 404);
      await run('arrive', a, { actor: owner });
      assert.equal(a.status, 'arrived');
    });

    it('هم‌زمان دو شروع برای دو نوبت: آرایشگر یک نفر را هم‌زمان نمی‌پذیرد', async () => {
      const a = await seed('09:00');
      const b = await seed('09:30');
      await run('start', a);
      await assert.rejects(run('start', b), code('BARBER_BUSY'));
      assert.equal(b.status, 'confirmed');
    });

    it('هم‌زمان دو درخواست یکسان: یکی موفق، دیگری ۴۰۹', async () => {
      const a = await seed('09:00');
      const results = await Promise.allSettled([run('arrive', a), run('arrive', a)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    });

    it('عدم حضور دستی: قبل از پایان مهلت TOO_EARLY، بعدش موفق', async () => {
      const a = await seed('09:00');
      await assert.rejects(run('noShow', a, { now: at('09:04') }), code('TOO_EARLY'));
      await run('noShow', a, { now: at('09:05') });
      assert.equal(a.status, 'noShow');
    });

    it('مهلت عدم حضور از «زمان پیش‌بینی‌شده‌ی فعلی» حساب می‌شود، نه زمان رزرو', async () => {
      const a = await seed('09:00', { estimatedStart: at('09:20'), estimatedEnd: at('09:50') });
      await assert.rejects(run('noShow', a, { now: at('09:24') }), code('TOO_EARLY'));
      await run('noShow', a, { now: at('09:25') });
    });
  });

  describe('محاسبه‌ی مجدد بعد از شروع/پایان', () => {
    it('پایان دیرهنگام نوبت اول، بعدی‌ها را عقب می‌برد؛ زمان رزرو ثابت می‌ماند؛ لاگ و اعلان', async () => {
      const a = await seed('09:00');
      const b = await seed('09:30');
      const c = await seed('10:15');
      await run('start', a, { now: at('09:10') });
      const out = await run('complete', a, { now: at('09:55') }); // ۲۵ دقیقه تاخیر

      assert.deepEqual([b.estimatedStart, b.estimatedEnd], [at('09:55'), at('10:25')]);
      assert.deepEqual([c.estimatedStart, c.estimatedEnd], [at('10:25'), at('10:55')]);
      assert.deepEqual([b.bookedStart, c.bookedStart], [at('09:30'), at('10:15')]); // رزرو تغییر نکرده
      assert.equal(out.plan.changed.length, 2); // b و c (نوبت تمام‌شده تغییر نمی‌کند)
      assert.equal(out.plan.notify.length, 1); // b: ۹:۴۰ ← ۹:۵۵ (۱۵ دقیقه)؛ c فقط ۱۰ دقیقه جابه‌جا شد (آستانه: بیش از ۱۰)
      const log = models.AuditLog.rows().filter((l) => l.action === 'appointment.estimate' && String(l.entityId) === String(b._id)).at(-1);
      assert.equal(log.meta.shiftMinutes, 15); // نسبت به پیش‌بینی قبلی (۹:۴۰)
      assert.equal(log.meta.notify, true);
    });

    it('تاخیر کمتر از آستانه اعلان ندارد؛ ولی زمان به‌روز می‌شود', async () => {
      const a = await seed('09:00');
      const b = await seed('09:30');
      await run('start', a, { now: at('09:00') });
      const out = await run('complete', a, { now: at('09:38') });
      assert.deepEqual(b.estimatedStart, at('09:38'));
      assert.deepEqual(out.plan.notify, []);
    });

    it('اگر پایان واقعی از ساعت کاری بگذرد، overflow گزارش می‌شود', async () => {
      const a = await seed('11:00', { status: 'inProgress', startedAt: at('11:00'), arrivedAt: at('11:00') });
      const b = await seed('11:30');
      const out = await visit.perform({ actor: owner, shopId: 'shop1', appointmentId: a._id, action: 'complete', now: at('11:50') });
      assert.deepEqual(out.plan.overflow, [b._id]); // ۱۱:۵۰ تا ۱۲:۲۰ از ۱۲:۰۰ می‌گذرد
    });

    it('عدم حضور نوبت قبلی تاخیر را از بین می‌برد', async () => {
      const a = await seed('09:00', { status: 'confirmed' });
      const b = await seed('09:30', { estimatedStart: at('09:40'), estimatedEnd: at('10:10') });
      await run('noShow', a, { now: at('09:06') });
      assert.deepEqual(b.estimatedStart, at('09:30'));
    });
  });

  describe('setNoShowHold', () => {
    it('فقط برای تاییدشده؛ روشن و خاموش', async () => {
      const a = await seed('09:00');
      await visit.setNoShowHold({ actor: self, shopId: 'shop1', appointmentId: a._id, hold: true });
      assert.equal(a.noShowHold, true);
      await visit.setNoShowHold({ actor: owner, shopId: 'shop1', appointmentId: a._id, hold: false });
      assert.equal(a.noShowHold, false);
      await assert.rejects(visit.setNoShowHold({ actor: colleague, shopId: 'shop1', appointmentId: a._id, hold: true }), (e) => e.statusCode === 403);
      await run('arrive', a);
      await assert.rejects(visit.setNoShowHold({ actor: self, shopId: 'shop1', appointmentId: a._id, hold: true }), code('INVALID_TRANSITION'));
    });
  });

  describe('autoNoShow', () => {
    it('تا ۵ دقیقه بعد از زمان پیش‌بینی‌شده صبر می‌کند، بعد «عدم حضور» با لاگ سیستمی', async () => {
      const a = await seed('09:00');
      assert.equal(await visit.autoNoShow(at('09:04')), 0);
      assert.equal(await visit.autoNoShow(at('09:05')), 1);
      assert.equal(a.status, 'noShow');
      const log = models.AuditLog.rows().find((l) => l.action === 'appointment.noShow');
      assert.deepEqual([log.actor.role, log.meta.auto], ['system', true]);
      assert.equal(await visit.autoNoShow(at('09:10')), 0);
    });

    it('حاضرشده و در حال انجام و تاخیر پیش‌بینی‌شده دست نمی‌خورند', async () => {
      const arrived = await seed('09:00', { status: 'arrived' });
      const running = await seed('09:30', { status: 'inProgress' });
      const delayed = await seed('10:00', { estimatedStart: at('10:30'), estimatedEnd: at('11:00') });
      assert.equal(await visit.autoNoShow(at('10:20')), 0);
      assert.deepEqual([arrived.status, running.status, delayed.status], ['arrived', 'inProgress', 'confirmed']);
    });

    it('نگه‌داشتن تصمیم: تا رسیدن زمان نوبت بعدی صبر؛ بعدش عدم حضور', async () => {
      const a = await seed('09:00', { noShowHold: true });
      await seed('09:30');
      assert.equal(await visit.autoNoShow(at('09:20')), 0);
      assert.equal(a.status, 'confirmed');
      assert.equal(await visit.autoNoShow(at('09:30')), 1); // نوبت بعدی ۹:۳۰ فرا رسیده؛ فقط a (b هنوز در مهلت ۵ دقیقه‌ای است)
      assert.equal(a.status, 'noShow');
    });

    it('نگه‌داشتن تصمیم وقتی نوبت بعدی وجود ندارد: همچنان صبر می‌کند', async () => {
      const a = await seed('09:00', { noShowHold: true });
      assert.equal(await visit.autoNoShow(at('11:00')), 0);
      assert.equal(a.status, 'confirmed');
    });
  });

  describe('walkIn', () => {
    const walk = (extra = {}) =>
      visit.walkIn({ actor: self, shop: ctx.shop, barber: ctx.barber, serviceId: 'svc1', name: 'آقای حضوری', now: at('09:07'), ...extra });

    it('اولین جای خالی کافی از الان: روی شبکه‌ی ۵ دقیقه‌ای، «حاضر شده»، بدون بیعانه', async () => {
      const { appointment: a } = await walk();
      assert.equal(a.status, 'arrived');
      assert.equal(a.source, 'walkIn');
      assert.equal(a.customerId, null);
      assert.equal(a.walkInName, 'آقای حضوری');
      assert.deepEqual([a.bookedStart, a.bookedEnd], [at('09:10'), at('09:40')]);
      assert.deepEqual([a.priceSnapshot, a.durationSnapshot, a.depositAmount], [150000, 30, 0]);
      assert.deepEqual(a.arrivedAt, at('09:07'));
    });

    it('نوبت تاییدشده را عقب نمی‌اندازد؛ جای کافی نبود، بعد از آن می‌نشیند', async () => {
      await seed('09:15'); // ۹:۱۵ تا ۹:۴۵
      const { appointment: a } = await walk(); // از ۹:۱۰ فقط ۵ دقیقه جاست
      assert.deepEqual(a.bookedStart, at('09:45'));
    });

    it('جای نوبت سوخته (عدم حضور) برای حضوری آزاد است ولی برای آنلاین بسته می‌ماند', async () => {
      await seed('09:00', { status: 'noShow' });
      const { appointment: a } = await walk({ now: at('09:10') });
      assert.deepEqual(a.bookedStart, at('09:10'));
      const appointmentService = require('../../src/services/appointment');
      const online = await appointmentService.getAvailability({ shop: ctx.shop, barber: ctx.barber, serviceId: 'svc1', dayKey: DAY, now: at('08:00') });
      assert.ok(!online.items.some((i) => i.time === '09:00'));
    });

    it('موقتِ فعال مشتری آنلاین هم اشغال است', async () => {
      await seed('09:10', { status: 'held', heldUntil: at('09:20') });
      const { appointment: a } = await walk();
      assert.deepEqual(a.bookedStart, at('09:40'));
    });

    it('بعد از آن برای آنلاین اشغال است (بدون تداخل)', async () => {
      await walk();
      const appointmentService = require('../../src/services/appointment');
      const out = await appointmentService.getAvailability({ shop: ctx.shop, barber: ctx.barber, serviceId: 'svc1', dayKey: DAY, now: at('09:07') });
      assert.ok(!out.items.some((i) => ['09:10', '09:25'].includes(i.time)));
    });

    it('روز پر: NO_FREE_TIME؛ بیرون از ساعت کاری هم', async () => {
      await seed('09:00', { status: 'arrived' });
      await seed('09:30');
      await seed('10:00');
      await seed('10:30');
      await seed('11:00');
      await seed('11:30');
      await assert.rejects(walk(), code('NO_FREE_TIME'));
      await assert.rejects(walk({ now: at('13:00') }), code('NO_FREE_TIME'));
    });

    it('دو حضوری هم‌زمان: دو جای متفاوت', async () => {
      const [x, y] = await Promise.all([walk({ name: 'الف' }), walk({ name: 'ب' })]);
      assert.notDeepEqual(x.appointment.bookedStart, y.appointment.bookedStart);
      assert.ok(x.appointment.bookedEnd <= y.appointment.bookedStart || y.appointment.bookedEnd <= x.appointment.bookedStart);
    });

    it('فقط خود آرایشگر یا مالک؛ خدمت ارائه‌نشده ۴۰۴', async () => {
      await assert.rejects(walk({ actor: colleague }), (e) => e.statusCode === 403);
      await walk({ actor: owner });
      await assert.rejects(walk({ serviceId: 'nope' }), (e) => e.statusCode === 404);
    });
  });

  describe('getDay', () => {
    it('نوبت‌ها به ترتیب زمان با مشتری؛ منقضی و موقتِ مهلت‌گذشته نیستند؛ فقط آرایشگر یا مالک', async () => {
      await models.User.create({ _id: 'cx', name: 'مشتری', mobile: '09120000010' });
      await seed('10:00', { customerId: 'cx' });
      await seed('09:00', { customerId: 'cy' });
      await seed('11:00', { status: 'expired' });
      await seed('11:30', { status: 'held', heldUntil: at('08:00') });
      const day = await visit.getDay({ actor: self, shop: ctx.shop, barber: ctx.barber, dayKey: DAY, now: at('08:30') });
      assert.deepEqual(day.map((d) => d.appointment.bookedStart), [at('09:00'), at('10:00')]);
      assert.equal(day[1].customer.mobile, '09120000010');
      assert.equal(day[0].customer, null);
      await assert.rejects(visit.getDay({ actor: colleague, shop: ctx.shop, barber: ctx.barber, dayKey: DAY }), (e) => e.statusCode === 403);
      await visit.getDay({ actor: owner, shop: ctx.shop, barber: ctx.barber, dayKey: DAY });
    });
  });
});
