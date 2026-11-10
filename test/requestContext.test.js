'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestContext, getContext } = require('../src/middlewares/requestContext');
const requestLogger = require('../src/middlewares/requestLogger');
const { createFakeRes, createFakeReq, mockLogger } = require('./helpers/fakes');

const logger = mockLogger();

test('بدون هدر، requestId جدید ساخته و روی req و پاسخ گذاشته می‌شود', () => {
  const req = createFakeReq();
  const res = createFakeRes();
  requestContext(req, res, () => {});
  assert.match(req.id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers['x-request-id'], req.id);
});

test('هدر معتبر x-request-id پذیرفته می‌شود', () => {
  const req = createFakeReq({ headers: { 'X-Request-Id': 'abc-12345678' } });
  requestContext(req, createFakeRes(), () => {});
  assert.equal(req.id, 'abc-12345678');
});

test('هدر ناامن یا نامعتبر نادیده گرفته می‌شود', () => {
  for (const bad of ['short', 'has space in it!', 'x'.repeat(200), 'line\nbreak-123456']) {
    const req = createFakeReq({ headers: { 'x-request-id': bad } });
    requestContext(req, createFakeRes(), () => {});
    assert.notEqual(req.id, bad);
  }
});

test('getContext داخل زنجیره async همان requestId را برمی‌گرداند و بیرون خالی است', async () => {
  assert.deepEqual(getContext(), {});
  const req = createFakeReq();
  let inside;
  await new Promise((resolve) => {
    requestContext(req, createFakeRes(), async () => {
      await new Promise((r) => setTimeout(r, 5));
      inside = getContext();
      resolve();
    });
  });
  assert.equal(inside.requestId, req.id);
});

test('requestLogger بعد از finish یک خط لاگ با سطح مناسب می‌نویسد', () => {
  logger.calls.length = 0;
  const mw = requestLogger;
  const res = createFakeRes();
  res.statusCode = 404;
  mw(createFakeReq({ method: 'GET', path: '/api/x', originalUrl: '/api/x?a=1' }), res, () => {});
  assert.equal(logger.calls.length, 0);
  res.emit('finish');
  assert.equal(logger.calls[0].level, 'warn');
  assert.equal(logger.calls[0].args[0].status, 404);
  assert.equal(logger.calls[0].args[0].url, '/api/x?a=1');
});

test('requestLogger مسیر /health را لاگ نمی‌کند', () => {
  logger.calls.length = 0;
  const res = createFakeRes();
  let nexted = false;
  requestLogger(createFakeReq({ path: '/health' }), res, () => {
    nexted = true;
  });
  res.emit('finish');
  assert.equal(nexted, true);
  assert.equal(logger.calls.length, 0);
});
