'use strict';

const assert = require('node:assert/strict');
const { newClient, loginAs, setupShop } = require('./helpers');
const { Barber, User, AuditLog } = require('../../src/models');

const BARBER_MOBILE = '09120000004';
const addBarber = (client, shopId, mobile = BARBER_MOBILE, displayName = 'رضا آرایشگر') =>
  client.post(`/api/shops/${shopId}/barbers`).send({ mobile, displayName });

describe('POST /api/shops/:shopId/barbers', () => {
  it('مالک آرایشگر اضافه می‌کند؛ کاربر ناموجود ساخته می‌شود و بعد از ورود نقش barber دارد', async () => {
    const { owner, shopId } = await setupShop();
    const res = await addBarber(owner, shopId).expect(201);
    assert.equal(res.body.barber.isOwner, false);

    const barber = await loginAs(BARBER_MOBILE);
    const me = (await barber.get('/api/auth/me').expect(200)).body.user;
    assert.equal(me.role, 'barber');
    assert.equal(me.shopId, shopId);

    assert.ok(await AuditLog.findOne({ action: 'barber.add', 'actor.role': 'shopOwner' }));
  });

  it('کاربر موجودی که قبلاً مشتری بوده هم اضافه می‌شود', async () => {
    const { owner, shopId } = await setupShop();
    await loginAs(BARBER_MOBILE);
    await addBarber(owner, shopId).expect(201);
    assert.equal(await User.countDocuments({ mobile: BARBER_MOBILE }), 1);
  });

  it('تکراری در همان آرایشگاه یا آرایشگر آرایشگاه دیگر: ۴۰۹', async () => {
    const { admin, owner, shopId } = await setupShop();
    const { owner: ownerB, shopId: shopB } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });

    await addBarber(owner, shopId).expect(201);
    await addBarber(owner, shopId).expect(409);
    await addBarber(ownerB, shopB).expect(409);
    await addBarber(owner, shopId, '09120000003').expect(409); // مالک آرایشگاه دیگر
    assert.equal(await Barber.countDocuments({ isActive: true }), 3);
  });

  it('آرایشگر عادی و مشتری نمی‌توانند آرایشگر اضافه کنند', async () => {
    const { owner, shopId } = await setupShop();
    await addBarber(owner, shopId).expect(201);
    const barber = await loginAs(BARBER_MOBILE);
    await addBarber(barber, shopId, '09120000005').expect(403);
    await addBarber(await loginAs('09120000006'), shopId, '09120000005').expect(403);
    await addBarber(newClient(), shopId, '09120000005').expect(401);
  });

  it('ورودی نامعتبر: ۴۲۲', async () => {
    const { owner, shopId } = await setupShop();
    await owner.post(`/api/shops/${shopId}/barbers`).send({ mobile: '123', displayName: 'رضا' }).expect(422);
    await owner.post(`/api/shops/${shopId}/barbers`).send({ mobile: BARBER_MOBILE }).expect(422);
  });
});

describe('فهرست آرایشگران', () => {
  it('عمومی: فقط فعال‌ها و بدون موبایل', async () => {
    const { owner, shopId } = await setupShop();
    await addBarber(owner, shopId).expect(201);

    const res = await newClient().get(`/api/shops/${shopId}/barbers`).expect(200);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].isOwner, true); // مالک اول
    assert.equal(JSON.stringify(res.body).includes(BARBER_MOBILE), false);
  });

  it('staff: موبایل و وضعیت برای مالک و ادمین؛ نه برای دیگران', async () => {
    const { admin, owner, shopId } = await setupShop();
    await addBarber(owner, shopId).expect(201);

    const res = await owner.get(`/api/shops/${shopId}/staff`).expect(200);
    assert.deepEqual(res.body.items.map((b) => b.mobile), ['09120000002', BARBER_MOBILE]);
    await admin.get(`/api/shops/${shopId}/staff`).expect(200);
    await (await loginAs('09120000010')).get(`/api/shops/${shopId}/staff`).expect(403);
    await newClient().get(`/api/shops/${shopId}/staff`).expect(401);
  });
});

describe('PATCH /api/shops/:shopId/barbers/:barberId', () => {
  it('تغییر نام نمایشی و غیرفعال/فعال‌کردن آرایشگر؛ دسترسی او با غیرفعال‌شدن قطع می‌شود', async () => {
    const { owner, shopId } = await setupShop();
    const barberId = (await addBarber(owner, shopId).expect(201)).body.barber.id;
    const barber = await loginAs(BARBER_MOBILE);

    await owner.patch(`/api/shops/${shopId}/barbers/${barberId}`).send({ displayName: 'رضای جدید' }).expect(200);
    assert.equal((await Barber.findById(barberId)).displayName, 'رضای جدید');

    await owner.patch(`/api/shops/${shopId}/barbers/${barberId}`).send({ isActive: false }).expect(200);
    const me = (await barber.get('/api/auth/me').expect(200)).body.user;
    assert.equal(me.role, 'customer');
    assert.equal(me.shopId, null);
    assert.equal((await newClient().get(`/api/shops/${shopId}/barbers`)).body.items.length, 1);

    await owner.patch(`/api/shops/${shopId}/barbers/${barberId}`).send({ isActive: true }).expect(200);
    assert.equal((await barber.get('/api/auth/me')).body.user.role, 'barber');

    const log = await AuditLog.findOne({ action: 'barber.update', 'after.isActive': false });
    assert.equal(log.before.isActive, true);
  });

  it('مالک را نمی‌توان غیرفعال کرد: ۴۰۹', async () => {
    const { owner, shopId } = await setupShop();
    const ownerBarber = await Barber.findOne({ shopId, isOwner: true });
    await owner.patch(`/api/shops/${shopId}/barbers/${ownerBarber._id}`).send({ isActive: false }).expect(409);
  });

  it('آرایشگرِ آرایشگاه دیگر از مسیر این آرایشگاه پیدا نمی‌شود (۴۰۴) و مالک دیگر ۴۰۳ می‌گیرد', async () => {
    const { admin, owner, shopId } = await setupShop();
    const { owner: ownerB, shopId: shopB } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });
    const barberB = (await addBarber(ownerB, shopB).expect(201)).body.barber.id;

    await owner.patch(`/api/shops/${shopId}/barbers/${barberB}`).send({ isActive: false }).expect(404);
    await owner.patch(`/api/shops/${shopB}/barbers/${barberB}`).send({ isActive: false }).expect(403);
    assert.equal((await Barber.findById(barberB)).isActive, true);
  });

  it('بدنه خالی یا شناسه نامعتبر: ۴۲۲', async () => {
    const { owner, shopId } = await setupShop();
    const ownerBarber = await Barber.findOne({ shopId });
    await owner.patch(`/api/shops/${shopId}/barbers/${ownerBarber._id}`).send({}).expect(422);
    await owner.patch(`/api/shops/${shopId}/barbers/xyz`).send({ displayName: 'علی' }).expect(422);
  });
});
