'use strict';

// توجه: این تست‌ها به MongoDB و Redis واقعی نیاز دارند (npm test api).
const assert = require('node:assert/strict');
const { newClient, loginAs, setupShop, createService, addBarber } = require('./helpers');
const { Appointment, Payment, AuditLog } = require('../../src/models');
const { addDays, toDayKey, tehranDate } = require('../../src/helpers/schedule');

const allWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ start: '00:00', end: '23:55' }] }));
const CUSTOMER = '09120000010';

/** آرایشگاه تمام شبانه‌روز باز (تا تست‌ها به ساعت اجرا وابسته نباشند)، یک آرایشگر عادی با خدمت ۳۰ دقیقه‌ای ۱۵۰٬۰۰۰ تومانی */
async function setup() {
  const shop = await setupShop();
  await shop.owner.put(`/api/shops/${shop.shopId}/working-hours`).send({ days: allWeek }).expect(200);
  const barber = await addBarber(shop.owner, shop.shopId);
  const serviceId = await createService(shop.admin, 'اصلاح سر');
  await shop.owner
    .put(`/api/shops/${shop.shopId}/barbers/${barber.barberId}/services/${serviceId}`)
    .send({ price: 150000, durationMinutes: 30 })
    .expect(200);
  const dayKey = addDays(toDayKey(new Date()), 2);
  const start = (hhmm) => tehranDate(dayKey, hhmm).toISOString();
  return { ...shop, barber, barberId: barber.barberId, serviceId, dayKey, start };
}

const book = (client, w, hhmm, extra = {}) =>
  client.post('/api/appointments').send({ shopId: w.shopId, barberId: w.barberId, serviceId: w.serviceId, start: w.start(hhmm), ...extra });

describe('GET .../availability', () => {
  it('عمومی است؛ زمان‌های آزاد را با مدت خدمت برمی‌گرداند', async () => {
    const w = await setup();
    const res = await newClient()
      .get(`/api/shops/${w.shopId}/barbers/${w.barberId}/availability?serviceId=${w.serviceId}&date=${w.dayKey}`)
      .expect(200);
    assert.equal(res.body.durationMinutes, 30);
    assert.equal(res.body.items[0].time, '00:00');
    assert.equal(res.body.items.at(-1).time, '23:25');
  });

  it('ورودی نامعتبر ۴۲۲؛ بیش از ۶۰ روز ۴۲۲؛ خدمت ارائه‌نشده ۴۰۴', async () => {
    const w = await setup();
    const base = `/api/shops/${w.shopId}/barbers/${w.barberId}/availability`;
    await newClient().get(`${base}?serviceId=${w.serviceId}`).expect(422);
    await newClient().get(`${base}?serviceId=abc&date=${w.dayKey}`).expect(422);
    await newClient().get(`${base}?serviceId=${w.serviceId}&date=${addDays(w.dayKey, 70)}`).expect(422);
    await newClient().get(`${base}?serviceId=64b7f0c2a1b2c3d4e5f60718&date=${w.dayKey}`).expect(404);
  });
});

describe('POST /api/appointments و پرداخت', () => {
  it('مسیر کامل: نگه‌داشتن موقت ← پرداخت ← تایید؛ زمان از لیست آزاد می‌رود', async () => {
    const w = await setup();
    const customer = await loginAs(CUSTOMER);
    const held = await book(customer, w, '10:00').expect(201);
    assert.equal(held.body.appointment.status, 'held');
    assert.equal(held.body.appointment.depositAmount, 22500);
    assert.ok(held.body.appointment.heldUntil);

    const url = `/api/shops/${w.shopId}/barbers/${w.barberId}/availability?serviceId=${w.serviceId}&date=${w.dayKey}`;
    assert.ok(!(await newClient().get(url)).body.items.some((i) => i.time === '10:00'));

    const paid = await customer.post(`/api/appointments/${held.body.appointment.id}/pay`).send({}).expect(200);
    assert.equal(paid.body.appointment.status, 'confirmed');
    assert.equal(paid.body.payment.status, 'succeeded');
    assert.equal(await Payment.countDocuments(), 1);
    assert.ok(await AuditLog.findOne({ action: 'appointment.hold' }));
    assert.ok(await AuditLog.findOne({ action: 'appointment.confirm' }));

    const mine = await customer.get('/api/appointments').expect(200);
    assert.equal(mine.body.items.length, 1);
    assert.equal(mine.body.items[0].serviceTitle, 'اصلاح سر');
  });

  it('پرداخت ناموفق: ۴۰۲، نوبت منقضی و زمان دوباره آزاد', async () => {
    const w = await setup();
    const customer = await loginAs(CUSTOMER);
    const held = await book(customer, w, '10:00').expect(201);
    await customer.post(`/api/appointments/${held.body.appointment.id}/pay`).send({ outcome: 'failure' }).expect(402);
    assert.equal((await Appointment.findById(held.body.appointment.id)).status, 'expired');
    await book(await loginAs('09120000011'), w, '10:00').expect(201);
  });

  it('هم‌زمان ۵ مشتری برای یک زمان: دقیقاً یک ۲۰۱', async () => {
    const w = await setup();
    const clients = await Promise.all([1, 2, 3, 4, 5].map((i) => loginAs(`0912000002${i}`)));
    const results = await Promise.all(clients.map((c) => book(c, w, '10:00')));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    for (const r of results.filter((x) => x.status !== 201)) assert.equal(r.status, 409);
    assert.equal(await Appointment.countDocuments(), 1);
  });

  it('خطاها: بدون ورود ۴۰۱؛ آرایشگر از خودش ۴۰۳؛ زمان غیرشبکه ۴۰۹؛ ورودی نامعتبر ۴۲۲؛ نوبت دیگران ۴۰۴', async () => {
    const w = await setup();
    await book(newClient(), w, '10:00').expect(401);
    await book(w.barber.client, w, '10:00').expect(403);

    const customer = await loginAs(CUSTOMER);
    await customer.post('/api/appointments').send({ shopId: w.shopId, barberId: w.barberId, serviceId: w.serviceId, start: '2026-11-10T10:00:00' }).expect(422);
    await book(customer, w, '10:00', { start: new Date(tehranDate(w.dayKey, '10:00').getTime() + 60000).toISOString() }).expect(409);

    const held = await book(customer, w, '10:30').expect(201);
    await book(customer, w, '11:00').expect(409); // موقت فعال دیگر
    await (await loginAs('09120000011')).post(`/api/appointments/${held.body.appointment.id}/pay`).send({}).expect(404);
    await (await loginAs('09120000011')).get(`/api/appointments/${held.body.appointment.id}`).expect(404);
  });
});

describe('مسدودسازی تغییرات با نوبت آینده', () => {
  async function confirmed(w) {
    const customer = await loginAs(CUSTOMER);
    const held = await book(customer, w, '10:00').expect(201);
    await customer.post(`/api/appointments/${held.body.appointment.id}/pay`).send({}).expect(200);
  }

  it('ساعت کاری، تعطیلی، غیرفعال‌کردن آرایشگر و خدمت ← ۴۰۹ HAS_UPCOMING_APPOINTMENTS', async () => {
    const w = await setup();
    await confirmed(w);
    const blocked = (res) => assert.equal(res.body.error?.code ?? res.body.code, 'HAS_UPCOMING_APPOINTMENTS');

    blocked(await w.owner.put(`/api/shops/${w.shopId}/working-hours`).send({ days: [] }).expect(409));
    blocked(await w.owner.post(`/api/shops/${w.shopId}/holidays`).send({ date: w.dayKey }).expect(409));
    blocked(await w.owner.patch(`/api/shops/${w.shopId}/barbers/${w.barberId}`).send({ isActive: false }).expect(409));
    const url = `/api/shops/${w.shopId}/barbers/${w.barberId}/services/${w.serviceId}`;
    blocked(await w.owner.patch(url).send({ isActive: false }).expect(409));
    blocked(await w.owner.delete(url).expect(409));
  });
});

describe('کارهای روز آرایشگر', () => {
  async function confirmedAppointment(w, hhmm = '10:00') {
    const customer = await loginAs(CUSTOMER);
    const held = await book(customer, w, hhmm).expect(201);
    await customer.post(`/api/appointments/${held.body.appointment.id}/pay`).send({}).expect(200);
    return held.body.appointment.id;
  }
  const act = (w, id, name) => `/api/shops/${w.shopId}/appointments/${id}/${name}`;

  it('حاضر ← شروع ← پایان؛ برنامه‌ی روز و لاگ‌ها', async () => {
    const w = await setup();
    const id = await confirmedAppointment(w);
    const barber = w.barber.client;

    await barber.post(act(w, id, 'arrive')).expect(200);
    await barber.post(act(w, id, 'start')).expect(200);
    const done = await barber.post(act(w, id, 'complete')).send({ finalPrice: 160000 }).expect(200);
    assert.equal(done.body.appointment.status, 'completed');
    assert.equal(done.body.appointment.finalPrice, 160000);

    const day = await barber.get(`/api/shops/${w.shopId}/barbers/${w.barberId}/schedule?date=${w.dayKey}`).expect(200);
    assert.equal(day.body.items.length, 1);
    assert.equal(day.body.items[0].customer.mobile, CUSTOMER);
    for (const a of ['arrive', 'start', 'complete']) assert.ok(await AuditLog.findOne({ action: `appointment.${a}` }), a);
  });

  it('مشتری، همکار و مهمان نمی‌توانند؛ مالک می‌تواند؛ گذار نامعتبر ۴۰۹', async () => {
    const w = await setup();
    const id = await confirmedAppointment(w);
    const colleague = await addBarber(w.owner, w.shopId, '09120000005', 'همکار');

    await newClient().post(act(w, id, 'arrive')).expect(401);
    await (await loginAs(CUSTOMER)).post(act(w, id, 'arrive')).expect(403);
    await colleague.client.post(act(w, id, 'arrive')).expect(403);
    await w.owner.post(act(w, id, 'arrive')).expect(200);
    await w.owner.post(act(w, id, 'arrive')).expect(409);
    await w.owner.post(act(w, id, 'complete')).expect(409);
  });

  it('مشتری حضوری: ۲۰۱، در برنامه‌ی روز دیده می‌شود؛ ورودی نامعتبر ۴۲۲', async () => {
    const w = await setup();
    const url = `/api/shops/${w.shopId}/barbers/${w.barberId}/walk-ins`;
    await w.barber.client.post(url).send({ name: 'x', serviceId: w.serviceId }).expect(422);
    await w.barber.client.post(url).send({ name: 'آقای حضوری', serviceId: w.serviceId, mobile: '12' }).expect(422);
    const res = await w.barber.client.post(url).send({ name: 'آقای حضوری', serviceId: w.serviceId, mobile: '۰۹۱۲۰۰۰۰۰۹۹' }).expect(201);
    assert.equal(res.body.appointment.status, 'arrived');
    assert.equal(res.body.appointment.source, 'walkIn');
  });
});
