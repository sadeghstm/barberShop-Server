'use strict';

// توجه: به MongoDB و Redis واقعی نیاز دارد (npm test api).
// بررسی نهایی ۵.۸: وقتی مالک قیمت را برای مهمان بسته، هیچ مسیر عمومی نباید قیمت را نشان بدهد.
const assert = require('node:assert/strict');
const { newClient, setupShop, createService, addBarber } = require('./helpers');
const { addDays, toDayKey } = require('../../src/helpers/schedule');

const PRICE_KEYS = /"(price|finalPrice|priceSnapshot|depositAmount|paidInPerson)"/;
const allWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ start: '09:00', end: '21:00' }] }));

describe('نمایش قیمت در همه‌ی مسیرهای عمومی (۵.۸)', () => {
  it('با showPricesToGuests=false هیچ GET عمومی قیمت ندارد؛ با true فقط دو مسیر خدمات قیمت دارند', async () => {
    const w = await setupShop();
    await w.owner.put(`/api/shops/${w.shopId}/working-hours`).send({ days: allWeek }).expect(200);
    const barber = await addBarber(w.owner, w.shopId);
    const serviceId = await createService(w.admin, 'اصلاح سر');
    await w.owner.put(`/api/shops/${w.shopId}/barbers/${barber.barberId}/services/${serviceId}`).send({ price: 150000, durationMinutes: 30 }).expect(200);
    const date = addDays(toDayKey(new Date()), 1);

    const publicGets = [
      '/api/shops',
      `/api/shops/${w.shopId}`,
      `/api/shops/${w.shopId}/barbers`,
      `/api/shops/${w.shopId}/services`,
      `/api/shops/${w.shopId}/barbers/${barber.barberId}/services`,
      `/api/shops/${w.shopId}/barbers/${barber.barberId}/availability?serviceId=${serviceId}&date=${date}`,
      '/api/services',
    ];
    const pricedWhenOpen = new Set([publicGets[3], publicGets[4]]);

    // پیش‌فرض (قیمت برای همه): فقط دو مسیر خدمات قیمت دارند
    for (const url of publicGets) {
      const res = await newClient().get(url).expect(200);
      assert.equal(PRICE_KEYS.test(JSON.stringify(res.body)), pricedWhenOpen.has(url), url);
    }

    // بسته برای مهمان: هیچ‌کدام
    await w.owner.patch(`/api/shops/${w.shopId}`).send({ showPricesToGuests: false }).expect(200);
    for (const url of publicGets) {
      const res = await newClient().get(url).expect(200);
      assert.equal(PRICE_KEYS.test(JSON.stringify(res.body)), false, `قیمت در ${url} نشت کرد`);
    }

    // کوکی جعلی مهمان حساب می‌شود
    const fake = await newClient().get(publicGets[3]).set('Cookie', 'token=fake').expect(200);
    assert.equal(PRICE_KEYS.test(JSON.stringify(fake.body)), false);
  });
});
