'use strict';

const assert = require('node:assert/strict');
const { createWorld } = require('../helpers/bookingWorld');

const code = (c) => (e) => e.code === c;

describe('درخواست خدمت جدید (سرویس)', () => {
  const world = createWorld();
  const { models } = world;
  let svc;

  const barber = { userId: 'u1', role: 'barber', roles: ['barber'], shopId: 'shop1', barberId: 'barber1' };
  const admin = { userId: 'admin1', role: 'admin', roles: ['admin'] };

  before(() => {
    svc = require('../../src/services/serviceRequest');
  });
  after(() => world.restore());
  beforeEach(() => world.reset());

  const make = (title = 'اصلاح ابرو', extra = {}) => svc.create({ ...barber, ...extra }, { title, description: 'توضیح' });

  describe('create', () => {
    it('درخواست در انتظار با مشخصات آرایشگر ثبت می‌شود', async () => {
      const r = await make();
      assert.deepEqual([r.status, r.title, r.shopId, r.barberId, r.requestedBy], ['pending', 'اصلاح ابرو', 'shop1', 'barber1', 'u1']);
    });

    it('عنوان موجود در کاتالوگ (حتی با ی/ک عربی و فاصله) ← ALREADY_IN_CATALOG با شناسه‌ی خدمت', async () => {
      await assert.rejects(make('اصلاح   سر'), (e) => e.code === 'ALREADY_IN_CATALOG' && String(e.details.serviceId) === 'svc1');
      await assert.rejects(make('اصلاح سر'), code('ALREADY_IN_CATALOG'));
      assert.equal(await models.ServiceRequest.countDocuments(), 0);
    });

    it('درخواست مشابه در انتظار ← DUPLICATE_REQUEST؛ دیگری می‌تواند', async () => {
      await make('اصلاح ابرو');
      await assert.rejects(make(' اصلاح  ابرو '), code('DUPLICATE_REQUEST'));
      await make('اصلاح ابرو', { barberId: 'barber2', userId: 'u2' });
    });

    it('حداکثر ۵ درخواست در انتظار', async () => {
      for (let i = 1; i <= 5; i += 1) await make(`خدمت ${i}`);
      await assert.rejects(make('خدمت ۶'), code('TOO_MANY_PENDING'));
    });

    it('بعد از تصمیم، دوباره می‌شود درخواست داد', async () => {
      const r = await make('اصلاح ابرو');
      await svc.reject(r._id, admin, 'تکراری است');
      await make('اصلاح ابرو');
    });
  });

  describe('approve', () => {
    it('خدمت جدید در کاتالوگ ساخته می‌شود و به درخواست وصل است (isDefault=false)', async () => {
      const r = await make();
      const out = await svc.approve(r._id, admin);
      assert.equal(out.created, true);
      assert.deepEqual([out.request.status, out.request.decidedBy], ['approved', 'admin1']);
      assert.equal(out.request.serviceId, out.service._id);
      assert.deepEqual([out.service.title, out.service.isDefault, out.service.status, out.service.createdFromRequestId], ['اصلاح ابرو', false, 'active', r._id]);
      assert.equal(await models.ServiceCatalog.countDocuments(), 2);
    });

    it('عنوان تکراری (بعد از ثبت درخواست به کاتالوگ آمده) ← DUPLICATE_TITLE و درخواست «در انتظار» می‌ماند', async () => {
      const r = await make('اصلاح ابرو');
      await models.ServiceCatalog.create({ title: 'اصلاح ابرو' });
      await assert.rejects(svc.approve(r._id, admin), code('DUPLICATE_TITLE'));
      assert.deepEqual([r.status, r.decidedBy], ['pending', null]);
    });

    it('ادغام: به خدمت موجود وصل می‌شود و خدمت جدید نمی‌سازد', async () => {
      const r = await make('اصلاح موی سر');
      const out = await svc.approve(r._id, admin, { mergeInto: 'svc1' });
      assert.equal(out.created, false);
      assert.equal(out.request.serviceId, 'svc1');
      assert.equal(await models.ServiceCatalog.countDocuments(), 1);
    });

    it('ادغام با خدمت ناموجود ۴۰۴؛ غیرفعال ۴۰۹؛ درخواست دست‌نخورده', async () => {
      const r = await make();
      await assert.rejects(svc.approve(r._id, admin, { mergeInto: 'nope' }), (e) => e.statusCode === 404);
      await models.ServiceCatalog.findOneAndUpdate({ _id: 'svc1' }, { status: 'removing' });
      await assert.rejects(svc.approve(r._id, admin, { mergeInto: 'svc1' }), code('TARGET_NOT_ACTIVE'));
      assert.equal(r.status, 'pending');
    });

    it('تصمیم دوباره ALREADY_DECIDED؛ هم‌زمان دو تایید: یکی موفق و فقط یک خدمت ساخته می‌شود', async () => {
      const r = await make();
      const results = await Promise.allSettled([svc.approve(r._id, admin), svc.approve(r._id, admin)]);
      assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(await models.ServiceCatalog.countDocuments(), 2);
      await assert.rejects(svc.reject(r._id, admin, 'دیرهنگام'), code('ALREADY_DECIDED'));
    });

    it('درخواست ناموجود ۴۰۴', async () => {
      await assert.rejects(svc.approve('nope', admin), (e) => e.statusCode === 404);
    });
  });

  describe('reject و فهرست‌ها', () => {
    it('رد با دلیل ذخیره می‌شود', async () => {
      const r = await make();
      const out = await svc.reject(r._id, admin, 'خارج از حوزه');
      assert.deepEqual([out.status, out.rejectReason], ['rejected', 'خارج از حوزه']);
    });

    it('فهرست ادمین: فقط در انتظار، قدیمی‌ترین اول، با نام آرایشگر و آرایشگاه؛ all همه را می‌آورد', async () => {
      const a = await make('الف');
      await make('ب');
      await svc.reject(a._id, admin, 'نه');
      const pending = await svc.listAll({ status: 'pending', page: 1, limit: 10 });
      assert.deepEqual(pending.items.map((i) => i.request.title), ['ب']);
      assert.deepEqual([pending.items[0].barberName, pending.items[0].shopName], ['رضا', 'آرایشگاه تست']);
      assert.equal((await svc.listAll({ status: 'all', page: 1, limit: 10 })).total, 2);
      assert.equal((await svc.listAll({ status: 'all', page: 2, limit: 1 })).items.length, 1);
    });

    it('فهرست خود کاربر فقط درخواست‌های خودش', async () => {
      await make('الف');
      await make('ب', { userId: 'u2', barberId: 'barber2' });
      assert.deepEqual((await svc.listMine(barber)).map((r) => r.title), ['الف']);
    });
  });
});
