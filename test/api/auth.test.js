'use strict';

const assert = require('node:assert/strict');
const { newClient, loginAs } = require('./helpers');
const { config } = require('../../src/config');
const { User, AuditLog } = require('../../src/models');

const MOBILE = '09121234567';

describe('POST /api/auth/send-otp', () => {
  it('شماره معتبر: کد ارسال می‌شود (فارسی هم پذیرفته می‌شود)', async () => {
    const res = await newClient().post('/api/auth/send-otp').send({ mobile: '۰۹۱۲۱۲۳۴۵۶۷' }).expect(200);
    assert.equal(res.body.expiresInSeconds, 120);
  });

  it('شماره نامعتبر: ۴۲۲', async () => {
    const res = await newClient().post('/api/auth/send-otp').send({ mobile: '123' }).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('بدون بدنه: ۴۲۲ (نه ۵۰۰)', async () => {
    await newClient().post('/api/auth/send-otp').expect(422);
  });

  it('درخواست دوم در کمتر از ۶۰ ثانیه: ۴۲۹', async () => {
    const client = newClient();
    await client.post('/api/auth/send-otp').send({ mobile: MOBILE }).expect(200);
    const res = await client.post('/api/auth/send-otp').send({ mobile: MOBILE }).expect(429);
    assert.equal(res.body.error.code, 'TOO_MANY_REQUESTS');
  });

  it('JSON خراب: ۴۰۰', async () => {
    await newClient().post('/api/auth/send-otp').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
});

describe('POST /api/auth/verify', () => {
  it('کد درست: کاربر ساخته می‌شود، کوکی httpOnly می‌آید و ثبت‌نام در auditLogs است', async () => {
    const client = newClient();
    await client.post('/api/auth/send-otp').send({ mobile: MOBILE }).expect(200);
    const res = await client.post('/api/auth/verify').send({ mobile: MOBILE, code: config.devOtpCode }).expect(200);

    assert.equal(res.body.isNew, true);
    assert.equal(res.body.user.mobile, MOBILE);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('token='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    assert.equal(await User.countDocuments({ mobile: MOBILE }), 1);
    const log = await AuditLog.findOne({ action: 'user.register' });
    assert.equal(log.actor.role, 'customer');
    assert.equal(String(log.entityId), res.body.user.id);
  });

  it('کد نادرست: ۴۰۰ و کاربر ساخته نمی‌شود', async () => {
    const client = newClient();
    await client.post('/api/auth/send-otp').send({ mobile: MOBILE }).expect(200);
    await client.post('/api/auth/verify').send({ mobile: MOBILE, code: '00000' }).expect(400);
    assert.equal(await User.countDocuments(), 0);
  });

  it('کد یک‌بار مصرف است', async () => {
    const client = newClient();
    await client.post('/api/auth/send-otp').send({ mobile: MOBILE }).expect(200);
    await client.post('/api/auth/verify').send({ mobile: MOBILE, code: config.devOtpCode }).expect(200);
    await client.post('/api/auth/verify').send({ mobile: MOBILE, code: config.devOtpCode }).expect(400);
  });

  it('بدون درخواست کد قبلی: ۴۰۰', async () => {
    await newClient().post('/api/auth/verify').send({ mobile: MOBILE, code: config.devOtpCode }).expect(400);
  });

  it('کد با فرمت نادرست: ۴۲۲', async () => {
    await newClient().post('/api/auth/verify').send({ mobile: MOBILE, code: '12' }).expect(422);
  });

  it('بعد از ۵ حدس نادرست: ۴۲۹ حتی با کد درست', async () => {
    const client = newClient();
    await client.post('/api/auth/send-otp').send({ mobile: MOBILE }).expect(200);
    for (let i = 0; i < 5; i += 1) await client.post('/api/auth/verify').send({ mobile: MOBILE, code: '00000' }).expect(400);
    await client.post('/api/auth/verify').send({ mobile: MOBILE, code: config.devOtpCode }).expect(429);
  });

  it('کاربر غیرفعال: ۴۰۳', async () => {
    await User.create({ mobile: MOBILE, isActive: false });
    const client = newClient();
    await client.post('/api/auth/send-otp').send({ mobile: MOBILE }).expect(200);
    await client.post('/api/auth/verify').send({ mobile: MOBILE, code: config.devOtpCode }).expect(403);
  });
});

describe('GET /api/auth/me و logout', () => {
  it('بدون ورود: ۴۰۱', async () => {
    const res = await newClient().get('/api/auth/me').expect(401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('بعد از ورود: اطلاعات کاربر و نقش', async () => {
    const client = await loginAs(MOBILE);
    const res = await client.get('/api/auth/me').expect(200);
    assert.equal(res.body.user.mobile, MOBILE);
    assert.equal(res.body.user.role, 'customer');
    assert.deepEqual(res.body.user.roles, ['customer']);
    assert.equal(res.body.user.shopId, null);
    assert.equal(res.body.user.barberId, null);
  });

  it('بعد از logout نشست از بین رفته است', async () => {
    const client = await loginAs(MOBILE);
    await client.post('/api/auth/logout').expect(200);
    await client.get('/api/auth/me').expect(401);
  });

  it('کوکی جعلی: ۴۰۱', async () => {
    await newClient().get('/api/auth/me').set('Cookie', 'token=fake').expect(401);
  });
});
