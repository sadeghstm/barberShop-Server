'use strict';

const assert = require('node:assert/strict');
const { newClient, loginAs, loginWithRoles, setupShop } = require('./helpers');
const { Shop, Barber, AuditLog } = require('../../src/models');

describe('POST /api/shops', () => {
  it('ادمین آرایشگاه را با مالکش می‌سازد؛ مالک هم آرایشگر است و لاگ ثبت می‌شود', async () => {
    const { owner, shopId } = await setupShop();

    const barber = await Barber.findOne({ shopId });
    assert.equal(barber.isOwner, true);
    assert.equal(barber.displayName, 'علی مالک');

    const me = await owner.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.role, 'shopOwner');
    assert.equal(me.body.user.shopId, shopId);
    assert.ok(me.body.user.roles.includes('barber'));

    const actions = (await AuditLog.find({ entityType: { $in: ['shops', 'barbers'] } })).map((l) => l.action);
    assert.ok(actions.includes('shop.create') && actions.includes('barber.add'));
  });

  it('مشتری، آرایشگر و کاربر واردنشده اجازه ندارند', async () => {
    const body = { name: 'x یک', slug: 'x-one', ownerMobile: '09120000009', ownerName: 'مالک' };
    await newClient().post('/api/shops').send(body).expect(401);
    const customer = await loginAs('09120000010');
    await customer.post('/api/shops').send(body).expect(403);
    const { owner } = await setupShop();
    await owner.post('/api/shops').send(body).expect(403);
  });

  it('slug تکراری: ۴۰۹', async () => {
    const { admin } = await setupShop();
    await admin
      .post('/api/shops')
      .send({ name: 'دوم', slug: 'shop-one', ownerMobile: '09120000003', ownerName: 'مالک دوم' })
      .expect(409);
  });

  it('مالکی که در آرایشگاه دیگری آرایشگر است: ۴۰۹ و آرایشگاه نیمه‌کاره نمی‌ماند', async () => {
    const { admin } = await setupShop();
    await admin
      .post('/api/shops')
      .send({ name: 'دوم', slug: 'shop-two', ownerMobile: '09120000002', ownerName: 'علی مالک' })
      .expect(409);
    assert.equal(await Shop.countDocuments(), 1);
  });

  it('ورودی نامعتبر: ۴۲۲ با نام فیلد', async () => {
    const admin = await loginWithRoles('09120000001', ['admin', 'customer']);
    const ok = { name: 'آرایشگاه', slug: 'good-slug', ownerMobile: '09120000002', ownerName: 'مالک' };

    for (const [field, value] of [['slug', 'Bad Slug'], ['ownerMobile', '123'], ['name', 'ا'], ['ownerName', undefined]]) {
      const res = await admin.post('/api/shops').send({ ...ok, [field]: value }).expect(422);
      assert.equal(res.body.error.details[0].field, field);
    }
    assert.equal(await Shop.countDocuments(), 0);
  });
});

describe('GET /api/shops', () => {
  it('فهرست و جزئیات عمومی است و اطلاعات داخلی را نشان نمی‌دهد', async () => {
    const { shopId } = await setupShop();

    const list = await newClient().get('/api/shops').expect(200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].id, shopId);

    const one = await newClient().get(`/api/shops/${shopId}`).expect(200);
    assert.equal(one.body.shop.name, 'آرایشگاه نمونه');
    assert.equal('license' in one.body.shop, false);
  });

  it('فیلتر شهر و صفحه‌بندی', async () => {
    const { admin } = await setupShop();
    await admin
      .post('/api/shops')
      .send({ name: 'آرایشگاه اصفهان', slug: 'isfahan-shop', city: 'اصفهان', ownerMobile: '09120000003', ownerName: 'مالک' })
      .expect(201);

    const res = await newClient().get('/api/shops').query({ city: 'اصفهان' }).expect(200);
    assert.equal(res.body.total, 1);
    const paged = await newClient().get('/api/shops').query({ limit: 1, page: 2 }).expect(200);
    assert.equal(paged.body.items.length, 1);
    assert.equal(paged.body.total, 2);
  });

  it('آرایشگاه غیرفعال در فهرست و جزئیات نیست؛ شناسه نامعتبر ۴۲۲ و ناموجود ۴۰۴', async () => {
    const { admin, shopId } = await setupShop();
    await admin.patch(`/api/shops/${shopId}`).send({ isActive: false }).expect(200);

    await newClient().get(`/api/shops/${shopId}`).expect(404);
    assert.equal((await newClient().get('/api/shops')).body.total, 0);
    await newClient().get('/api/shops/abc').expect(422);
    await newClient().get('/api/shops/64b7f0c2a1b2c3d4e5f60718').expect(404);
  });
});

describe('PATCH /api/shops/:shopId', () => {
  it('مالک مشخصات و نمایش قیمت را تغییر می‌دهد و قبل/بعد در لاگ ثبت می‌شود', async () => {
    const { owner, shopId } = await setupShop();
    const res = await owner
      .patch(`/api/shops/${shopId}`)
      .send({ name: 'نام جدید', address: 'خیابان آزادی', showPricesToGuests: false })
      .expect(200);
    assert.equal(res.body.shop.name, 'نام جدید');
    assert.equal(res.body.shop.showPricesToGuests, false);

    const log = await AuditLog.findOne({ action: 'shop.update' });
    assert.equal(log.before.name, 'آرایشگاه نمونه');
    assert.equal(log.after.name, 'نام جدید');
    assert.equal(log.actor.role, 'shopOwner');
  });

  it('مالک slug و isActive را نمی‌تواند تغییر دهد (۴۰۳)، ادمین می‌تواند', async () => {
    const { admin, owner, shopId } = await setupShop();
    await owner.patch(`/api/shops/${shopId}`).send({ slug: 'new-slug' }).expect(403);
    await owner.patch(`/api/shops/${shopId}`).send({ isActive: false }).expect(403);
    await admin.patch(`/api/shops/${shopId}`).send({ slug: 'new-slug' }).expect(200);
  });

  it('مالک آرایشگاه دیگر، آرایشگر عادی و مشتری: ۴۰۳', async () => {
    const { admin, owner: ownerA, shopId: shopA } = await setupShop();
    const { owner: ownerB, shopId: shopB } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });

    await ownerB.patch(`/api/shops/${shopA}`).send({ name: 'هک شد' }).expect(403);
    await ownerA.patch(`/api/shops/${shopB}`).send({ name: 'هک شد' }).expect(403);

    const added = await ownerA.post(`/api/shops/${shopA}/barbers`).send({ mobile: '09120000004', displayName: 'رضا' }).expect(201);
    assert.ok(added.body.barber.id);
    const barber = await loginAs('09120000004');
    await barber.patch(`/api/shops/${shopA}`).send({ name: 'x دو' }).expect(403);

    const customer = await loginAs('09120000005');
    await customer.patch(`/api/shops/${shopA}`).send({ name: 'x دو' }).expect(403);
    await newClient().patch(`/api/shops/${shopA}`).send({ name: 'x دو' }).expect(401);
    assert.equal((await Shop.findById(shopA)).name, 'آرایشگاه نمونه');
  });

  it('بدنه خالی یا نامعتبر: ۴۲۲', async () => {
    const { owner, shopId } = await setupShop();
    await owner.patch(`/api/shops/${shopId}`).send({}).expect(422);
    await owner.patch(`/api/shops/${shopId}`).send({ showPricesToGuests: 'نه' }).expect(422);
  });
});
