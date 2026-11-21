'use strict';

const assert = require('node:assert/strict');
const { newClient, loginAs, setupShop } = require('./helpers');
const { AuditLog } = require('../../src/models');

const days = [
  { weekday: 0, intervals: [{ start: '09:00', end: '13:00' }, { start: '16:00', end: '21:00' }] },
  { weekday: 1, intervals: [{ start: '09:00', end: '21:00' }] },
];

describe('PUT /api/shops/:shopId/working-hours', () => {
  it('مالک ساعت کاری را تنظیم می‌کند و در جزئیات عمومی دیده می‌شود', async () => {
    const { owner, shopId } = await setupShop();
    await owner.put(`/api/shops/${shopId}/working-hours`).send({ days }).expect(200);

    const shop = (await newClient().get(`/api/shops/${shopId}`).expect(200)).body.shop;
    assert.equal(shop.workingHours.length, 2);
    assert.equal(shop.workingHours[0].intervals[1].start, '16:00');
    assert.ok(await AuditLog.findOne({ action: 'shop.workingHours.update' }));
  });

  it('کل ساعت کاری جایگزین می‌شود (روزی که نیامده تعطیل است)', async () => {
    const { owner, shopId } = await setupShop();
    await owner.put(`/api/shops/${shopId}/working-hours`).send({ days }).expect(200);
    const res = await owner.put(`/api/shops/${shopId}/working-hours`).send({ days: [days[1]] }).expect(200);
    assert.equal(res.body.workingHours.length, 1);
  });

  it('ساعت نامعتبر یا هم‌پوشان: ۴۲۲ و چیزی ذخیره نمی‌شود', async () => {
    const { owner, shopId } = await setupShop();
    const overlapping = [{ weekday: 0, intervals: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }] }];
    await owner.put(`/api/shops/${shopId}/working-hours`).send({ days: overlapping }).expect(422);
    await owner.put(`/api/shops/${shopId}/working-hours`).send({}).expect(422);
    const shop = (await newClient().get(`/api/shops/${shopId}`)).body.shop;
    assert.equal(shop.workingHours.length, 0);
  });

  it('فقط مالک همان آرایشگاه یا ادمین', async () => {
    const { admin, shopId } = await setupShop();
    const { owner: otherOwner } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });
    await otherOwner.put(`/api/shops/${shopId}/working-hours`).send({ days }).expect(403);
    await (await loginAs('09120000010')).put(`/api/shops/${shopId}/working-hours`).send({ days }).expect(403);
    await admin.put(`/api/shops/${shopId}/working-hours`).send({ days }).expect(200);
  });
});

describe('تعطیلی‌ها', () => {
  it('افزودن، نمایش و حذف', async () => {
    const { owner, shopId } = await setupShop();

    const added = await owner.post(`/api/shops/${shopId}/holidays`).send({ date: '2026-11-20', note: 'تعطیل رسمی' }).expect(201);
    assert.deepEqual(added.body.holidays.map((h) => h.date), ['2026-11-20']);

    const shop = (await newClient().get(`/api/shops/${shopId}`)).body.shop;
    assert.equal(shop.holidays[0].note, 'تعطیل رسمی');

    const removed = await owner.delete(`/api/shops/${shopId}/holidays/2026-11-20`).expect(200);
    assert.deepEqual(removed.body.holidays, []);
    assert.ok(await AuditLog.findOne({ action: 'shop.holiday.remove' }));
  });

  it('روز تکراری ۴۰۹؛ حذف روزِ ثبت‌نشده ۴۰۴؛ تاریخ نامعتبر ۴۲۲', async () => {
    const { owner, shopId } = await setupShop();
    await owner.post(`/api/shops/${shopId}/holidays`).send({ date: '2026-11-20' }).expect(201);
    await owner.post(`/api/shops/${shopId}/holidays`).send({ date: '2026-11-20' }).expect(409);
    await owner.delete(`/api/shops/${shopId}/holidays/2026-12-01`).expect(404);
    await owner.post(`/api/shops/${shopId}/holidays`).send({ date: '2026-02-30' }).expect(422);
    await owner.post(`/api/shops/${shopId}/holidays`).send({}).expect(422);
    await owner.delete(`/api/shops/${shopId}/holidays/abc`).expect(422);
  });

  it('دو درخواست هم‌زمان برای یک روز فقط یک ثبت می‌سازد', async () => {
    const { owner, shopId } = await setupShop();
    const results = await Promise.all(
      [1, 2, 3].map(() => owner.post(`/api/shops/${shopId}/holidays`).send({ date: '2026-12-25' })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
  });

  it('مالک آرایشگاه دیگر اجازه ندارد', async () => {
    const { admin, shopId } = await setupShop();
    const { owner: other } = await setupShop({ admin, slug: 'shop-two', ownerMobile: '09120000003' });
    await other.post(`/api/shops/${shopId}/holidays`).send({ date: '2026-11-20' }).expect(403);
  });
});
