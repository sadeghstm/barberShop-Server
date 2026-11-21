'use strict';

const assert = require('node:assert/strict');
const { newClient } = require('./helpers');

describe('GET /health', () => {
  it('پاسخ ok می‌دهد و X-Request-Id می‌گذارد', async () => {
    const res = await newClient().get('/health').expect(200);
    assert.deepEqual(res.body, { status: 'ok' });
    assert.ok(res.headers['x-request-id']);
  });

  it('GET /health/ready وقتی مونگو و ردیس وصل‌اند ۲۰۰ می‌دهد', async () => {
    const res = await newClient().get('/health/ready').expect(200);
    assert.deepEqual(res.body, { status: 'ok', checks: { mongo: 'up', redis: 'up' } });
  });

  it('مسیر ناموجود ۴۰۴ با قالب خطای استاندارد می‌دهد', async () => {
    const res = await newClient().get('/ready').expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.ok(res.body.error.requestId);
  });
});
