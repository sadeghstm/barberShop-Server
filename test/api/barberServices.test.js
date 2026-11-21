'use strict';

const assert = require('node:assert/strict');
const { newClient, loginAs, setupShop, createService, addBarber } = require('./helpers');
const { BarberService, ServiceCatalog, Barber, AuditLog } = require('../../src/models');

const URL = (shopId, barberId, serviceId = '') => `/api/shops/${shopId}/barbers/${barberId}/services${serviceId && `/${serviceId}`}`;
const body = { price: 150000, durationMinutes: 30 };

/** آرایشگاه + مالک + یک آرایشگر عادی + یک خدمت کاتالوگ */
async function setup() {
  const shop = await setupShop();
  const barber = await addBarber(shop.owner, shop.shopId);
  const serviceId = await createService(shop.admin, 'اصلاح سر');
  const ownerBarberId = String((await Barber.findOne({ shopId: shop.shopId, isOwner: true }))._id);
  return { ...shop, barber: barber.client, barberId: barber.barberId, ownerBarberId, serviceId };
}

describe('PUT /api/shops/:shopId/barbers/:barberId/services/:serviceId', () => {
  it('مالک برای آرایشگر قیمت و مدت می‌گذارد؛ در فهرست عمومی می‌آید', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    const res = await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    assert.deepEqual(res.body.service, { serviceId, price: 150000, durationMinutes: 30, isActive: true });

    const list = await newClient().get(URL(shopId, barberId)).expect(200);
    assert.deepEqual(list.body.items, [{ serviceId, title: 'اصلاح سر', durationMinutes: 30, price: 150000 }]);
  });

  it('مالک برای خودش هم می‌تواند', async () => {
    const { owner, shopId, ownerBarberId, serviceId } = await setup();
    await owner.put(URL(shopId, ownerBarberId, serviceId)).send(body).expect(200);
    assert.equal(await BarberService.countDocuments({ isActive: true }), 1);
  });

  it('تغییر بعدی همان سند را به‌روز می‌کند (تکراری نمی‌سازد) و لاگ قبل/بعد دارد', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    await owner.put(URL(shopId, barberId, serviceId)).send({ price: 180000, durationMinutes: 45 }).expect(200);

    assert.equal(await BarberService.countDocuments(), 1);
    const logs = await AuditLog.find({ action: 'barberService.set' }).sort({ at: 1 });
    assert.equal(logs[0].before, null);
    assert.equal(logs[1].before.price, 150000);
    assert.equal(logs[1].after.price, 180000);
    assert.equal(logs[1].actor.role, 'shopOwner');
  });

  it('ادمین در شرایط خاص می‌تواند (و در لاگ ثبت می‌شود)', async () => {
    const { admin, shopId, barberId, serviceId } = await setup();
    await admin.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    const log = await AuditLog.findOne({ action: 'barberService.set' });
    assert.equal(log.actor.role, 'admin');
  });

  it('آرایشگر عادی (حتی برای خودش)، مالک آرایشگاه دیگر، مشتری و مهمان نمی‌توانند (۴۰۳/۴۰۱)', async () => {
    const { admin, owner, barber, shopId, barberId, serviceId } = await setup();
    const colleague = await addBarber(owner, shopId, '09120000005', 'همکار');
    const { owner: otherOwner } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });

    const url = URL(shopId, barberId, serviceId);
    await barber.put(url).send(body).expect(403); // خودش
    await colleague.client.put(url).send(body).expect(403);
    await otherOwner.put(url).send(body).expect(403);
    await (await loginAs('09120000010')).put(url).send(body).expect(403);
    await newClient().put(url).send(body).expect(401);
    assert.equal(await BarberService.countDocuments(), 0);
  });

  it('ورودی نامعتبر: ۴۲۲ با نام فیلد', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    const url = URL(shopId, barberId, serviceId);
    const bad = async (payload, field) => {
      const res = await owner.put(url).send(payload).expect(422);
      assert.ok(JSON.stringify(res.body).includes(field), `${field} در پاسخ نیست`);
    };
    await bad({ durationMinutes: 30 }, 'price');
    await bad({ price: -1, durationMinutes: 30 }, 'price');
    await bad({ price: 1.5, durationMinutes: 30 }, 'price');
    await bad({ price: 1000 }, 'durationMinutes');
    await bad({ price: 1000, durationMinutes: 7 }, 'durationMinutes');
    await bad({ price: 1000, durationMinutes: 0 }, 'durationMinutes');
    await bad({ price: 1000, durationMinutes: 485 }, 'durationMinutes');
    await owner.put(URL(shopId, barberId, 'abc')).send(body).expect(422);
    assert.equal(await BarberService.countDocuments(), 0);
  });

  it('قیمت صفر مجاز است', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send({ price: 0, durationMinutes: 5 }).expect(200);
  });

  it('خدمت ناموجود ۴۰۴؛ خدمتی که در حال حذف/آرشیو است ۴۰۹', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, '64b7f0c2a1b2c3d4e5f60718')).send(body).expect(404);
    for (const status of ['removing', 'archived']) {
      await ServiceCatalog.updateOne({ _id: serviceId }, { status });
      await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(409);
    }
    assert.equal(await BarberService.countDocuments(), 0);
  });

  it('آرایشگر غیرفعال‌شده: حتی مالک ۴۰۴ می‌گیرد', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    await owner.patch(`/api/shops/${shopId}/barbers/${barberId}`).send({ isActive: false }).expect(200);
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(404);
  });

  it('سه درخواست هم‌زمان اولین‌بار: فقط یک سند ساخته می‌شود و ۵۰۰ نمی‌دهد', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    const results = await Promise.all([1, 2, 3].map(() => owner.put(URL(shopId, barberId, serviceId)).send(body)));
    for (const r of results) assert.ok([200, 409].includes(r.status), `status ${r.status}`);
    assert.ok(results.some((r) => r.status === 200));
    assert.equal(await BarberService.countDocuments(), 1);
  });
});

describe('PATCH .../services/:serviceId (غیرفعال/فعال‌سازی)', () => {
  it('غیرفعال می‌شود، قیمت می‌ماند، از فهرست عمومی می‌رود و دوباره فعال می‌شود', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);

    const res = await owner.patch(URL(shopId, barberId, serviceId)).send({ isActive: false }).expect(200);
    assert.deepEqual(res.body.service, { serviceId, price: 150000, durationMinutes: 30, isActive: false });
    assert.equal((await newClient().get(URL(shopId, barberId))).body.items.length, 0);

    const manage = await owner.get(URL(shopId, barberId, 'manage')).expect(200);
    assert.deepEqual(manage.body.items[0], {
      serviceId, title: 'اصلاح سر', description: '', configured: true, isActive: false, price: 150000, durationMinutes: 30,
    });

    await owner.patch(URL(shopId, barberId, serviceId)).send({ isActive: true }).expect(200);
    assert.equal((await newClient().get(URL(shopId, barberId))).body.items.length, 1);
  });

  it('تکراری: ۲۰۰ بدون لاگ تکراری؛ تنظیم‌نشده ۴۰۴؛ isActive نامعتبر ۴۲۲؛ ادمین می‌تواند', async () => {
    const { admin, owner, shopId, barberId, serviceId } = await setup();
    await owner.patch(URL(shopId, barberId, serviceId)).send({ isActive: false }).expect(404);

    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    await owner.patch(URL(shopId, barberId, serviceId)).send({ isActive: 'no' }).expect(422);
    await owner.patch(URL(shopId, barberId, serviceId)).send({}).expect(422);
    await owner.patch(URL(shopId, barberId, serviceId)).send({ isActive: false }).expect(200);
    await admin.patch(URL(shopId, barberId, serviceId)).send({ isActive: false }).expect(200);
    assert.equal(await AuditLog.countDocuments({ action: 'barberService.deactivate' }), 1);
  });

  it('آرایشگر عادی و دیگران ۴۰۳/۴۰۱', async () => {
    const { owner, barber, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    await barber.patch(URL(shopId, barberId, serviceId)).send({ isActive: false }).expect(403);
    await newClient().patch(URL(shopId, barberId, serviceId)).send({ isActive: false }).expect(401);
    assert.equal((await BarberService.findOne()).isActive, true);
  });
});

describe('DELETE /api/shops/:shopId/barbers/:barberId/services/:serviceId', () => {
  it('خدمت کامل از فهرست آرایشگر حذف می‌شود (۲۰۴) و لاگ دارد؛ دوباره ۴۰۴', async () => {
    const { owner, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);

    await owner.delete(URL(shopId, barberId, serviceId)).expect(204);
    assert.equal(await BarberService.countDocuments(), 0);
    assert.equal((await newClient().get(URL(shopId, barberId))).body.items.length, 0);
    const log = await AuditLog.findOne({ action: 'barberService.remove' });
    assert.equal(log.before.price, 150000);

    await owner.delete(URL(shopId, barberId, serviceId)).expect(404);
  });

  it('ادمین می‌تواند؛ آرایشگر عادی، مالک آرایشگاه دیگر و مهمان نمی‌توانند', async () => {
    const { admin, owner, barber, shopId, barberId, serviceId } = await setup();
    const { owner: otherOwner } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);

    await barber.delete(URL(shopId, barberId, serviceId)).expect(403);
    await otherOwner.delete(URL(shopId, barberId, serviceId)).expect(403);
    await newClient().delete(URL(shopId, barberId, serviceId)).expect(401);
    assert.equal(await BarberService.countDocuments(), 1);

    await admin.delete(URL(shopId, barberId, serviceId)).expect(204);
    assert.equal(await BarberService.countDocuments(), 0);
  });
});

describe('GET .../services/manage', () => {
  it('کل کاتالوگ فعال با تنظیمات؛ خدمت در حال حذف نیست؛ فقط مالک و ادمین', async () => {
    const { admin, owner, barber, shopId, barberId, serviceId } = await setup();
    const beard = await createService(admin, 'اصلاح ریش');
    const hidden = await createService(admin, 'خدمت در حال حذف');
    await ServiceCatalog.updateOne({ _id: hidden }, { status: 'removing' });
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);

    const res = await owner.get(URL(shopId, barberId, 'manage')).expect(200);
    const byId = Object.fromEntries(res.body.items.map((i) => [i.serviceId, i]));
    assert.equal(res.body.items.length, 2);
    assert.equal(byId[serviceId].configured, true);
    assert.equal(byId[serviceId].price, 150000);
    assert.deepEqual([byId[beard].configured, byId[beard].isActive, byId[beard].price], [false, false, null]);

    await admin.get(URL(shopId, barberId, 'manage')).expect(200);
    await barber.get(URL(shopId, barberId, 'manage')).expect(403);
    await newClient().get(URL(shopId, barberId, 'manage')).expect(401);
    await (await loginAs('09120000010')).get(URL(shopId, barberId, 'manage')).expect(403);
  });
});

describe('فهرست‌های عمومی', () => {
  it('خدمتی که ادمین در حال حذفش است، یا آرایشگر غیرفعال، قابل رزرو نشان داده نمی‌شود', async () => {
    const { owner, barber, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);

    await ServiceCatalog.updateOne({ _id: serviceId }, { status: 'removing' });
    assert.equal((await newClient().get(URL(shopId, barberId))).body.items.length, 0);
    assert.equal((await newClient().get(`/api/shops/${shopId}/services`)).body.items.length, 0);

    await ServiceCatalog.updateOne({ _id: serviceId }, { status: 'active' });
    assert.equal((await newClient().get(`/api/shops/${shopId}/services`)).body.items.length, 1);
    await owner.patch(`/api/shops/${shopId}/barbers/${barberId}`).send({ isActive: false }).expect(200);
    assert.equal((await newClient().get(`/api/shops/${shopId}/services`)).body.items.length, 0);
    await newClient().get(URL(shopId, barberId)).expect(404);
  });

  it('آرایشگاه غیرفعال، شناسه نامعتبر و آرایشگرِ آرایشگاه دیگر', async () => {
    const { owner, admin, shopId, barberId } = await setup();
    const { shopId: shopB } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });

    await newClient().get(URL(shopB, barberId)).expect(404); // این آرایشگر عضو آرایشگاه B نیست
    await newClient().get(URL('abc', barberId)).expect(422);
    await newClient().get('/api/shops/64b7f0c2a1b2c3d4e5f60718/services').expect(404);

    await admin.patch(`/api/shops/${shopId}`).send({ isActive: false }).expect(200);
    await newClient().get(`/api/shops/${shopId}/services`).expect(404);
    await newClient().get(URL(shopId, barberId)).expect(404);
  });

  it('نمای آرایشگاه: هر خدمت با آرایشگرانش (مرتب بر اساس عنوان)', async () => {
    const { admin, owner, barber, shopId, barberId, ownerBarberId, serviceId } = await setup();
    const beard = await createService(admin, 'اصلاح ریش');
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    await owner.put(URL(shopId, ownerBarberId, serviceId)).send({ price: 200000, durationMinutes: 40 }).expect(200);
    await owner.put(URL(shopId, ownerBarberId, beard)).send({ price: 80000, durationMinutes: 15 }).expect(200);

    const res = await newClient().get(`/api/shops/${shopId}/services`).expect(200);
    assert.deepEqual(res.body.items.map((i) => i.title), ['اصلاح ریش', 'اصلاح سر']);
    const head = res.body.items.find((i) => i.serviceId === serviceId);
    assert.deepEqual(head.barbers.map((b) => b.displayName).sort(), ['رضا آرایشگر', 'علی مالک']);
    assert.equal(res.body.items.find((i) => i.serviceId === beard).barbers.length, 1);
  });
});

describe('نمایش قیمت (showPricesToGuests)', () => {
  const hasPrice = (res) => JSON.stringify(res.body).includes('"price"');

  it('پیش‌فرض: مهمان هم قیمت را می‌بیند', async () => {
    const { owner, barber, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    assert.equal(hasPrice(await newClient().get(URL(shopId, barberId))), true);
    assert.equal(hasPrice(await newClient().get(`/api/shops/${shopId}/services`)), true);
  });

  it('وقتی مالک بسته است: در خود API برای مهمان قیمت نیست (کلید price اصلاً نمی‌آید) ولی مدت هست', async () => {
    const { owner, barber, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    await owner.patch(`/api/shops/${shopId}`).send({ showPricesToGuests: false }).expect(200);

    const perBarber = await newClient().get(URL(shopId, barberId)).expect(200);
    const perShop = await newClient().get(`/api/shops/${shopId}/services`).expect(200);
    assert.equal(hasPrice(perBarber), false);
    assert.equal(hasPrice(perShop), false);
    assert.equal(perBarber.body.items[0].durationMinutes, 30);
    assert.equal(perShop.body.items[0].barbers[0].durationMinutes, 30);
  });

  it('کاربر واردشده (هر نقشی) قیمت را می‌بیند؛ کوکی جعلی مهمان حساب می‌شود', async () => {
    const { owner, barber, shopId, barberId, serviceId } = await setup();
    await owner.put(URL(shopId, barberId, serviceId)).send(body).expect(200);
    await owner.patch(`/api/shops/${shopId}`).send({ showPricesToGuests: false }).expect(200);

    const customer = await loginAs('09120000010');
    assert.equal((await customer.get(URL(shopId, barberId))).body.items[0].price, 150000);
    assert.equal((await owner.get(`/api/shops/${shopId}/services`)).body.items[0].barbers[0].price, 150000);
    assert.equal(hasPrice(await newClient().get(URL(shopId, barberId)).set('Cookie', 'token=fake')), false);
  });
});
