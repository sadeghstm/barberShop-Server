'use strict';

// حالت production: پیام و stack خطای ناشناخته نباید به کلاینت برسد.
// در فایل جدا چون config یک‌بار هنگام بارگذاری خوانده می‌شود.
Object.assign(process.env, {
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://127.0.0.1:27017/x',
  REDIS_URL: 'redis://127.0.0.1:6379',
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../src/middlewares/errorHandler');
const { createFakeRes, createFakeReq, mockLogger } = require('./helpers/fakes');

mockLogger();

test('خطای ناشناخته در production: بدون نشت پیام و stack', () => {
  const res = createFakeRes();
  errorHandler(new Error('secret db password leaked'), createFakeReq({ id: 'req-12345678' }), res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, 'خطای داخلی سرور');
  assert.equal(JSON.stringify(res.body).includes('secret'), false);
  assert.equal('stack' in res.body.error, false);
});
