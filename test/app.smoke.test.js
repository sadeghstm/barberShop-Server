'use strict';

// دود تست HTTP بدون دیتابیس: مسیرهای عمومی و خطاهای قبل از لایه داده.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mockLogger } = require('./helpers/fakes');

mockLogger();
const app = require('../src/app');

async function withServer(fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('مسیر ناشناخته ۴۰۴ استاندارد برمی‌گرداند', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.requestId);
  });
});

test('مسیر محافظت‌شده بدون کوکی ۴۰۱ می‌دهد', async () => {
  await withServer(async (base) => {
    for (const path of ['/api/auth/me', '/api/appointments/mine', '/api/admin/settings', '/api/me/wallet']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 401, path);
      const body = await res.json();
      assert.equal(body.error.code, 'UNAUTHORIZED');
    }
  });
});

test('اعتبارسنجی ورودی قبل از هر کار دیگری اجرا می‌شود', async () => {
  await withServer(async (base) => {
    const badMobile = await fetch(`${base}/api/auth/send-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile: '123' }),
    });
    assert.equal(badMobile.status, 422);
    assert.equal((await badMobile.json()).error.code, 'VALIDATION_ERROR');

    const badJson = await fetch(`${base}/api/auth/send-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    assert.equal(badJson.status, 400);
  });
});

test('مسیرهای کلیدی هر بخش ثبت شده‌اند', () => {
  const routesOf = (modulePath) => {
    const router = require(modulePath);
    return router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  };

  const shops = routesOf('../src/routes/shops');
  assert.ok(shops.includes('GET /:shopId/booking-board'));
  assert.ok(shops.includes('POST /:shopId/walk-ins'));
  assert.ok(shops.includes('GET /:shopId/barbers/:barberId/availability'));
  assert.ok(shops.includes('PUT /:shopId/working-hours'));

  const appointments = routesOf('../src/routes/appointments');
  for (const expected of [
    'POST /hold',
    'POST /:id/pay',
    'POST /:id/arrived',
    'POST /:id/start',
    'POST /:id/complete',
    'POST /:id/survey',
  ]) {
    assert.ok(appointments.includes(expected), expected);
  }

  const admin = routesOf('../src/routes/admin');
  assert.ok(admin.includes('PUT /settings'));
  assert.ok(admin.includes('POST /payments/:paymentId/refund'));
  assert.ok(admin.includes('POST /appointments/:id/revert'));

  const services = routesOf('../src/routes/services');
  assert.ok(services.includes('GET /'));
  assert.ok(services.includes('POST /requests/:requestId/decide'));
});
