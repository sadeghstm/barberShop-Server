'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRes, createFakeReq, mockLogger, createFakeRedis, stubModule } = require('./helpers/fakes');

// ردیس و مدل‌ها ساختگی‌اند؛ فقط منطق خود برنامه تست می‌شود
const redis = createFakeRedis();
stubModule('db/redis.js', { redis });

const users = new Map(); // mobile -> doc
const barbers = [];
let nextId = 1;
const User = {
  findOne: async ({ mobile }) => users.get(mobile) ?? null,
  findById: async (id) => [...users.values()].find((u) => u._id === id) ?? null,
  create: async ({ mobile }) => {
    const user = { _id: `u${nextId++}`, mobile, name: '', roles: ['customer'], isActive: true };
    users.set(mobile, user);
    return user;
  },
};
const Barber = { findOne: async ({ userId }) => barbers.find((b) => b.userId === userId && b.isActive) ?? null };
stubModule('models/User.js', User);
stubModule('models/Barber.js', Barber);

mockLogger();
const otp = require('../src/services/otp');
const session = require('../src/services/session');
const authController = require('../src/controllers/auth');
const { authenticate, requireRole, requireShopAccess } = require('../src/middlewares/auth');
const { AppError } = require('../src/helpers/AppError');

const MOBILE = '09121234567';
const audits = [];
const reqWith = (body, extra = {}) => createFakeReq({ body, audit: async (e) => audits.push(e), cookies: {}, ...extra });

test.beforeEach(() => {
  redis.store.clear();
  redis.now = 0;
  users.clear();
  barbers.length = 0;
  audits.length = 0;
});

// --- OTP ---

test('send-otp: کد ساخته می‌شود و فاصله ۶۰ ثانیه‌ای بین درخواست‌ها رعایت می‌شود', async () => {
  const res = createFakeRes();
  await authController.sendOtp(reqWith({ mobile: '۰۹۱۲۱۲۳۴۵۶۷' }), res);
  assert.equal(res.body.expiresInSeconds, 120);

  await assert.rejects(otp.send(MOBILE), (e) => e.statusCode === 429);
  redis.now = 61;
  await otp.send(MOBILE); // بعد از ۶۰ ثانیه دوباره مجاز است
});

test('send-otp: موبایل نامعتبر ۴۲۲ می‌دهد', async () => {
  await assert.rejects(authController.sendOtp(reqWith({ mobile: '123' }), createFakeRes()), (e) => e.statusCode === 422);
});

test('کد خام در ردیس ذخیره نمی‌شود', async () => {
  await otp.send(MOBILE);
  const stored = await redis.get(`otp:code:${MOBILE}`);
  assert.notEqual(stored, '12345');
  assert.match(stored, /^[0-9a-f]{64}$/);
});

test('verify: کد درست یک‌بار مصرف است', async () => {
  await otp.send(MOBILE);
  await otp.verify(MOBILE, '12345');
  await assert.rejects(otp.verify(MOBILE, '12345'), (e) => e.code === 'BAD_REQUEST');
});

test('verify: کد منقضی‌شده بعد از ۱۲۰ ثانیه رد می‌شود', async () => {
  await otp.send(MOBILE);
  redis.now = 121;
  await assert.rejects(otp.verify(MOBILE, '12345'), (e) => /منقضی/.test(e.message));
});

test('verify: بعد از ۵ حدس نادرست حتی کد درست هم رد می‌شود', async () => {
  await otp.send(MOBILE);
  for (let i = 0; i < 5; i += 1) await assert.rejects(otp.verify(MOBILE, '00000'), (e) => e.statusCode === 400);
  await assert.rejects(otp.verify(MOBILE, '12345'), (e) => e.statusCode === 429);
});

// --- ورود ---

test('verify: کاربر جدید ساخته، ثبت در auditLogs، و کوکی httpOnly گذاشته می‌شود', async () => {
  await otp.send(MOBILE);
  const res = createFakeRes();
  await authController.verify(reqWith({ mobile: MOBILE, code: '۱۲۳۴۵' }), res);

  assert.equal(res.body.isNew, true);
  assert.equal(res.cookies.token.options.httpOnly, true);
  assert.equal(res.cookies.token.options.sameSite, 'lax');
  assert.equal(audits[0].action, 'user.register');
  assert.equal(audits[0].actor.role, 'customer');
});

test('verify: ورود دوم کاربر را دوباره نمی‌سازد', async () => {
  for (let i = 0; i < 2; i += 1) {
    redis.now += 100;
    await otp.send(MOBILE);
    const res = createFakeRes();
    await authController.verify(reqWith({ mobile: MOBILE, code: '12345' }), res);
    assert.equal(res.body.isNew, i === 0);
  }
  assert.equal(users.size, 1);
  assert.equal(audits.length, 1);
});

test('verify: کد با فرمت نادرست ۴۲۲ و کاربر غیرفعال ۴۰۳', async () => {
  await assert.rejects(authController.verify(reqWith({ mobile: MOBILE, code: '12' }), createFakeRes()), (e) => e.statusCode === 422);

  await otp.send(MOBILE);
  await User.create({ mobile: MOBILE });
  users.get(MOBILE).isActive = false;
  await assert.rejects(authController.verify(reqWith({ mobile: MOBILE, code: '12345' }), createFakeRes()), (e) => e.statusCode === 403);
});

// --- نشست و middleware ---

async function login(mobile = MOBILE) {
  redis.now += 100;
  await otp.send(mobile);
  const res = createFakeRes();
  await authController.verify(reqWith({ mobile, code: '12345' }), res);
  return res.cookies.token.value;
}

test('نشست: توکن هش‌شده ذخیره می‌شود و با logout از بین می‌رود', async () => {
  const token = await login();
  assert.equal([...redis.store.keys()].some((k) => k.includes(token)), false);

  const res = createFakeRes();
  await authController.logout(reqWith({}, { cookies: { token } }), res);
  assert.equal(await session.getUserId(token), null);
  assert.deepEqual(res.clearedCookies, ['token']);
});

test('authenticate: بدون کوکی یا با توکن اشتباه ۴۰۱', async () => {
  await assert.rejects(authenticate(reqWith({}), {}, () => {}), (e) => e.statusCode === 401);
  await assert.rejects(authenticate(reqWith({}, { cookies: { token: 'fake' } }), {}, () => {}), (e) => e.statusCode === 401);
});

test('authenticate: req.auth برای مشتری و برای مالک درست پر می‌شود', async () => {
  const token = await login();
  const req = reqWith({}, { cookies: { token } });
  await authenticate(req, {}, () => {});
  assert.equal(req.auth.role, 'customer');
  assert.equal(req.auth.shopId, null);

  barbers.push({ _id: 'b1', userId: users.get(MOBILE)._id, shopId: 's1', isOwner: true, isActive: true });
  const req2 = reqWith({}, { cookies: { token } });
  await authenticate(req2, {}, () => {});
  assert.equal(req2.auth.role, 'shopOwner');
  assert.equal(req2.auth.shopId, 's1');
  assert.ok(req2.auth.roles.includes('barber'));
});

test('authenticate: کاربر غیرفعال‌شده بعد از ورود هم رد می‌شود', async () => {
  const token = await login();
  users.get(MOBILE).isActive = false;
  await assert.rejects(authenticate(reqWith({}, { cookies: { token } }), {}, () => {}), (e) => e.statusCode === 401);
});

test('requireRole: فقط نقش مجاز رد می‌شود', () => {
  const guard = requireRole('admin', 'superAdmin');
  let passed = false;
  guard({ auth: { roles: ['admin', 'customer'] } }, {}, () => (passed = true));
  assert.equal(passed, true);
  assert.throws(() => guard({ auth: { roles: ['barber', 'customer'] } }, {}, () => {}), (e) => e instanceof AppError && e.statusCode === 403);
});

test('requireShopAccess: ادمین همه‌جا، مالک/آرایشگر فقط آرایشگاه خودش', () => {
  const guard = requireShopAccess();
  const run = (auth, shopId) => {
    let passed = false;
    guard({ auth, params: { shopId } }, {}, () => (passed = true));
    return passed;
  };
  assert.equal(run({ roles: ['admin'], shopId: null }, 's9'), true);
  assert.equal(run({ roles: ['barber'], shopId: 's1' }, 's1'), true);
  assert.throws(() => run({ roles: ['shopOwner', 'barber'], shopId: 's1' }, 's2'), (e) => e.statusCode === 403);
  assert.throws(() => run({ roles: ['customer'], shopId: null }, 's1'), (e) => e.statusCode === 403);
});
