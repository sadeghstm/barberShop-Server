'use strict';

// توجه: به MongoDB و Redis واقعی نیاز دارد (npm test api).
const assert = require('node:assert/strict');
const { newClient, loginAs, setupShop, createService, addBarber } = require('./helpers');
const { ServiceRequest, ServiceCatalog, AuditLog } = require('../../src/models');

describe('درخواست خدمت جدید', () => {
  async function setup() {
    const shop = await setupShop();
    const barber = await addBarber(shop.owner, shop.shopId);
    return { ...shop, barber: barber.client };
  }

  it('آرایشگر درخواست می‌دهد، ادمین تایید می‌کند؛ خدمت در کاتالوگ عمومی می‌آید و لاگ ثبت می‌شود', async () => {
    const { admin, barber } = await setup();
    const created = await barber.post('/api/service-requests').send({ title: 'اصلاح ابرو', description: 'با نخ' }).expect(201);
    assert.equal(created.body.request.status, 'pending');

    const pending = await admin.get('/api/service-requests').expect(200);
    assert.equal(pending.body.items.length, 1);
    assert.equal(pending.body.items[0].barberName, 'رضا آرایشگر');

    const approved = await admin.post(`/api/service-requests/${created.body.request.id}/approve`).send({}).expect(200);
    assert.equal(approved.body.created, true);

    const list = await newClient().get('/api/services').expect(200);
    assert.deepEqual(list.body.items.map((s) => s.title), ['اصلاح ابرو']);
    const service = await ServiceCatalog.findById(approved.body.service.id);
    assert.equal(service.isDefault, false);
    for (const action of ['serviceRequest.create', 'serviceRequest.approve', 'service.create']) {
      assert.ok(await AuditLog.findOne({ action }), action);
    }

    const mine = await barber.get('/api/service-requests/mine').expect(200);
    assert.equal(mine.body.items[0].status, 'approved');
    assert.equal(mine.body.items[0].serviceId, approved.body.service.id);
  });

  it('رد با دلیل الزامی است و دلیل به آرایشگر نشان داده می‌شود', async () => {
    const { admin, barber } = await setup();
    const { body } = await barber.post('/api/service-requests').send({ title: 'خدمت عجیب' }).expect(201);
    await admin.post(`/api/service-requests/${body.request.id}/reject`).send({}).expect(422);
    await admin.post(`/api/service-requests/${body.request.id}/reject`).send({ reason: 'خارج از حوزه' }).expect(200);
    await admin.post(`/api/service-requests/${body.request.id}/approve`).send({}).expect(409); // قبلاً تصمیم گرفته شده

    const mine = await barber.get('/api/service-requests/mine').expect(200);
    assert.equal(mine.body.items[0].rejectReason, 'خارج از حوزه');
    assert.equal(await ServiceCatalog.countDocuments(), 0);
  });

  it('عنوان موجود ۴۰۹؛ ادغام با خدمت موجود', async () => {
    const { admin, barber } = await setup();
    const existing = await createService(admin, 'اصلاح سر');
    await barber.post('/api/service-requests').send({ title: 'اصلاح سر' }).expect(409);

    const { body } = await barber.post('/api/service-requests').send({ title: 'کوتاهی مو' }).expect(201);
    const merged = await admin.post(`/api/service-requests/${body.request.id}/approve`).send({ mergeInto: existing }).expect(200);
    assert.equal(merged.body.created, false);
    assert.equal(merged.body.service.id, existing);
    assert.equal(await ServiceCatalog.countDocuments(), 1);
  });

  it('دسترسی: مشتری و مهمان نمی‌توانند درخواست بدهند؛ آرایشگر و مشتری نمی‌توانند تصمیم بگیرند', async () => {
    const { owner, barber } = await setup();
    await newClient().post('/api/service-requests').send({ title: 'الف ب' }).expect(401);
    await (await loginAs('09120000010')).post('/api/service-requests').send({ title: 'الف ب' }).expect(403);
    await owner.post('/api/service-requests').send({ title: 'الف ب' }).expect(201); // مالک هم آرایشگر است

    const id = (await ServiceRequest.findOne())._id;
    await barber.get('/api/service-requests').expect(403);
    await barber.post(`/api/service-requests/${id}/approve`).send({}).expect(403);
    await barber.post(`/api/service-requests/${id}/reject`).send({ reason: 'xxx' }).expect(403);
  });

  it('ورودی نامعتبر ۴۲۲؛ status نامعتبر ۴۲۲؛ درخواست ناموجود ۴۰۴', async () => {
    const { admin, barber } = await setup();
    await barber.post('/api/service-requests').send({ title: 'x' }).expect(422);
    await barber.post('/api/service-requests').send({}).expect(422);
    await admin.get('/api/service-requests?status=bad').expect(422);
    await admin.post('/api/service-requests/64b7f0c2a1b2c3d4e5f60718/approve').send({}).expect(404);
    await admin.post('/api/service-requests/abc/reject').send({ reason: 'xxx' }).expect(422);
  });
});
