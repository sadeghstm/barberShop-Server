'use strict';

const assert = require('node:assert/strict');
const { newClient, loginAs, loginWithRoles, createService } = require('./helpers');
const { ServiceCatalog, AuditLog } = require('../../src/models');

const adminClient = () => loginWithRoles('09120000001', ['admin', 'customer']);

describe('POST /api/services', () => {
  it('ادمین خدمت می‌سازد؛ در فهرست عمومی دیده می‌شود و لاگ ثبت می‌شود', async () => {
    const admin = await adminClient();
    const res = await admin.post('/api/services').send({ title: '  اصلاح سر ', description: 'کوتاه‌کردن مو' }).expect(201);
    assert.equal(res.body.service.title, 'اصلاح سر');
    assert.equal(res.body.service.status, 'active');

    const list = await newClient().get('/api/services').expect(200);
    assert.deepEqual(list.body.items.map((s) => s.title), ['اصلاح سر']);
    assert.equal('status' in list.body.items[0], false); // وضعیت داخلی برای عموم نیست

    const log = await AuditLog.findOne({ action: 'service.create' });
    assert.equal(log.actor.role, 'admin');
    assert.equal(String(log.entityId), res.body.service.id);
  });

  it('فقط ادمین (۴۰۱ / ۴۰۳)', async () => {
    await newClient().post('/api/services').send({ title: 'اصلاح سر' }).expect(401);
    await (await loginAs('09120000010')).post('/api/services').send({ title: 'اصلاح سر' }).expect(403);
    assert.equal(await ServiceCatalog.countDocuments(), 0);
  });

  it('عنوان تکراری ۴۰۹ — حتی با فاصله اضافه یا ی/ک عربی', async () => {
    const admin = await adminClient();
    await createService(admin, 'اصلاح ریش');
    for (const title of ['اصلاح ریش', 'اصلاح   ریش', ' اصلاح ریش ', 'اصلاح ريش']) {
      const res = await admin.post('/api/services').send({ title }).expect(409);
      assert.equal(res.body.error.code, 'CONFLICT');
    }
    assert.equal(await ServiceCatalog.countDocuments(), 1);
  });

  it('ورودی نامعتبر: ۴۲۲', async () => {
    const admin = await adminClient();
    await admin.post('/api/services').send({}).expect(422);
    await admin.post('/api/services').send({ title: 'ا' }).expect(422);
    await admin.post('/api/services').send({ title: 'اصلاح', description: 'x'.repeat(501) }).expect(422);
  });
});

describe('PATCH /api/services/:serviceId', () => {
  it('عنوان و توضیح را تغییر می‌دهد و قبل/بعد در لاگ است', async () => {
    const admin = await adminClient();
    const id = await createService(admin, 'اصلاح سر');
    await admin.patch(`/api/services/${id}`).send({ title: 'اصلاح موی سر', description: 'توضیح' }).expect(200);

    const saved = await ServiceCatalog.findById(id);
    assert.equal(saved.title, 'اصلاح موی سر');
    assert.equal(saved.titleKey, 'اصلاح موی سر');
    const log = await AuditLog.findOne({ action: 'service.update' });
    assert.equal(log.before.title, 'اصلاح سر');
    assert.equal(log.after.title, 'اصلاح موی سر');
  });

  it('تغییر نام به عنوان خدمت دیگر ۴۰۹ (یکتایی با تغییر نام دور زده نمی‌شود)', async () => {
    const admin = await adminClient();
    await createService(admin, 'اصلاح ریش');
    const id = await createService(admin, 'اصلاح سر');
    await admin.patch(`/api/services/${id}`).send({ title: 'اصلاح  ريش' }).expect(409);
    assert.equal((await ServiceCatalog.findById(id)).title, 'اصلاح سر');
    // و بعد از تغییر نام، عنوان قبلی دوباره آزاد است
    await admin.patch(`/api/services/${id}`).send({ title: 'اصلاح موی سر' }).expect(200);
    await admin.post('/api/services').send({ title: 'اصلاح سر' }).expect(201);
  });

  it('بدنه خالی ۴۲۲، شناسه نامعتبر ۴۲۲، ناموجود ۴۰۴، غیرادمین ۴۰۳', async () => {
    const admin = await adminClient();
    const id = await createService(admin);
    await admin.patch(`/api/services/${id}`).send({}).expect(422);
    await admin.patch('/api/services/abc').send({ title: 'اصلاح سر ۲' }).expect(422);
    await admin.patch('/api/services/64b7f0c2a1b2c3d4e5f60718').send({ title: 'اصلاح سر ۲' }).expect(404);
    await (await loginAs('09120000010')).patch(`/api/services/${id}`).send({ title: 'اصلاح سر ۲' }).expect(403);
  });

  it('وضعیت (status) از این مسیر قابل تغییر نیست', async () => {
    const admin = await adminClient();
    const id = await createService(admin);
    await admin.patch(`/api/services/${id}`).send({ status: 'archived' }).expect(422); // فیلد قابل‌تغییری نیست
    assert.equal((await ServiceCatalog.findById(id)).status, 'active');
  });
});

describe('GET /api/services — وضعیت‌ها', () => {
  it('عموم فقط فعال‌ها را می‌بیند، حتی اگر status بفرستد', async () => {
    const admin = await adminClient();
    await createService(admin, 'خدمت فعال');
    const removingId = await createService(admin, 'خدمت در حال حذف');
    await ServiceCatalog.updateOne({ _id: removingId }, { status: 'removing' });

    const guest = await newClient().get('/api/services').query({ status: 'all' }).expect(200);
    assert.deepEqual(guest.body.items.map((s) => s.title), ['خدمت فعال']);
    const customer = await loginAs('09120000010');
    assert.equal((await customer.get('/api/services').query({ status: 'all' })).body.items.length, 1);
  });

  it('ادمین با ?status می‌تواند همه وضعیت‌ها را ببیند؛ مقدار نامعتبر ۴۲۲', async () => {
    const admin = await adminClient();
    await createService(admin, 'خدمت فعال');
    const removingId = await createService(admin, 'خدمت در حال حذف');
    await ServiceCatalog.updateOne({ _id: removingId }, { status: 'removing' });

    assert.equal((await admin.get('/api/services')).body.items.length, 1);
    const removing = await admin.get('/api/services').query({ status: 'removing' }).expect(200);
    assert.deepEqual(removing.body.items.map((s) => [s.title, s.status]), [['خدمت در حال حذف', 'removing']]);
    assert.equal((await admin.get('/api/services').query({ status: 'all' })).body.items.length, 2);
    await admin.get('/api/services').query({ status: 'bogus' }).expect(422);
  });
});

describe('حذف خدمت از کاتالوگ (POST /api/services/:id/removal و restore)', () => {
  it('بدون نوبت آینده فوراً آرشیو می‌شود؛ از فهرست عمومی می‌رود و با restore برمی‌گردد', async () => {
    const admin = await adminClient();
    const id = await createService(admin, 'اصلاح ریش');

    await admin.post(`/api/services/${id}/removal`).send({ confirmTitle: 'اشتباه' }).expect(422);
    await admin.post(`/api/services/${id}/removal`).send({}).expect(422);
    const res = await admin.post(`/api/services/${id}/removal`).send({ confirmTitle: 'اصلاح ریش' }).expect(200);
    assert.equal(res.body.service.status, 'archived');
    assert.equal(res.body.pending, false);
    assert.deepEqual((await newClient().get('/api/services')).body.items, []);
    assert.ok(await AuditLog.findOne({ action: 'service.removalRequest' }));
    assert.ok(await AuditLog.findOne({ action: 'service.archive' }));

    await admin.post(`/api/services/${id}/removal`).send({ confirmTitle: 'اصلاح ریش' }).expect(409);
    const back = await admin.post(`/api/services/${id}/restore`).expect(200);
    assert.equal(back.body.service.status, 'active');
    await admin.post(`/api/services/${id}/restore`).expect(409);
    assert.equal((await newClient().get('/api/services')).body.items.length, 1);
  });

  it('فقط ادمین؛ شناسه نامعتبر ۴۲۲؛ ناموجود ۴۰۴', async () => {
    const admin = await adminClient();
    const id = await createService(admin, 'اصلاح ریش');
    await newClient().post(`/api/services/${id}/removal`).send({ confirmTitle: 'اصلاح ریش' }).expect(401);
    await (await loginAs('09120000010')).post(`/api/services/${id}/removal`).send({ confirmTitle: 'اصلاح ریش' }).expect(403);
    await (await loginAs('09120000010')).post(`/api/services/${id}/restore`).expect(403);
    await admin.post('/api/services/abc/removal').send({ confirmTitle: 'x' }).expect(422);
    await admin.post('/api/services/64b7f0c2a1b2c3d4e5f60718/removal').send({ confirmTitle: 'x' }).expect(404);
    assert.equal((await ServiceCatalog.findById(id)).status, 'active');
  });
});
