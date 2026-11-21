'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { config } = require('../../src/config');
const { User } = require('../../src/models');

/** کلاینت جدید با کوکی مستقل (مثل یک مرورگر). */
const newClient = () => request.agent(app);

/** با OTP ثابت وارد می‌شود و کلاینتی با کوکی نشست برمی‌گرداند. */
async function loginAs(mobile) {
  const client = newClient();
  await client.post('/api/auth/send-otp').send({ mobile }).expect(200);
  await client.post('/api/auth/verify').send({ mobile, code: config.devOtpCode }).expect(200);
  return client;
}

/** کاربری با نقش‌های دلخواه می‌سازد (اگر نبود) و واردش می‌کند. */
async function loginWithRoles(mobile, roles) {
  if (!(await User.exists({ mobile }))) await User.create({ mobile, roles });
  return loginAs(mobile);
}

/**
 * یک ادمین یک آرایشگاه (با مالکش) می‌سازد. خروجی: کلاینت واردشده‌ی ادمین و مالک و شناسه آرایشگاه.
 * اگر در یک تست دو آرایشگاه لازم است، دومی را با slug و ownerMobile دیگر بسازید.
 */
async function setupShop({ slug = 'shop-one', ownerMobile = '09120000002', admin } = {}) {
  const adminClient = admin ?? (await loginWithRoles('09120000001', ['admin', 'customer']));
  const res = await adminClient
    .post('/api/shops')
    .send({ name: 'آرایشگاه نمونه', slug, city: 'تهران', ownerMobile, ownerName: 'علی مالک' })
    .expect(201);
  const owner = await loginAs(ownerMobile);
  return { admin: adminClient, owner, shopId: res.body.shop.id };
}

/** خدمتی در کاتالوگ سراسری می‌سازد (توسط ادمین) و شناسه‌اش را برمی‌گرداند. */
async function createService(admin, title = 'اصلاح سر') {
  const res = await admin.post('/api/services').send({ title }).expect(201);
  return res.body.service.id;
}

/** آرایشگری (غیر از مالک) به آرایشگاه اضافه می‌کند و واردش می‌کند. خروجی: { client, barberId }. */
async function addBarber(owner, shopId, mobile = '09120000004', displayName = 'رضا آرایشگر') {
  const res = await owner.post(`/api/shops/${shopId}/barbers`).send({ mobile, displayName }).expect(201);
  return { client: await loginAs(mobile), barberId: res.body.barber.id };
}

module.exports = { app, newClient, loginAs, loginWithRoles, setupShop, createService, addBarber };
