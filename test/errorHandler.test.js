'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../src/helpers/AppError');
const { errorHandler, notFoundHandler, normalizeError } = require('../src/middlewares/errorHandler');
const { createFakeRes, createFakeReq, mockLogger } = require('./helpers/fakes');

const logger = mockLogger();

function run(err, { res = createFakeRes() } = {}) {
  logger.calls.length = 0;
  const handler = errorHandler;
  const req = createFakeReq({ id: 'req-12345678' });
  let nextArg;
  handler(err, req, res, (e) => {
    nextArg = e;
  });
  return { res, nextArg };
}

test('AppError با status و code خودش پاسخ داده می‌شود', () => {
  const { res } = run(AppError.forbidden());
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal(res.body.error.requestId, 'req-12345678');
  assert.equal(logger.calls[0].level, 'warn');
});

test('details فقط وقتی هست در پاسخ می‌آید', () => {
  const { res } = run(AppError.conflict('تداخل', { overlap: true }));
  assert.deepEqual(res.body.error.details, { overlap: true });
  const { res: res2 } = run(AppError.notFound());
  assert.equal('details' in res2.body.error, false);
});

test('خطای ناشناخته: ۵۰۰ عمومی با لاگ error', () => {
  const { res } = run(new Error('boom'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, 'خطای داخلی سرور');
  assert.equal(logger.calls[0].level, 'error');
});

test('در development برای خطای ناشناخته stack اصلی می‌آید', () => {
  const { res } = run(new Error('boom'));
  assert.match(res.body.error.stack, /boom/);
});

test('چیزی که Error نیست (throw "x") هم ۵۰۰ می‌شود', () => {
  const { res } = run('just a string');
  assert.equal(res.statusCode, 500);
});

test('ValidationError مونگوس → ۴۲۲ با details', () => {
  const err = Object.assign(new Error('v'), {
    name: 'ValidationError',
    errors: { mobile: { message: 'شماره نامعتبر' } },
  });
  const { res } = run(err);
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.body.error.details, [{ field: 'mobile', message: 'شماره نامعتبر' }]);
});

test('CastError → ۴۰۰', () => {
  const { res } = run(Object.assign(new Error('c'), { name: 'CastError', path: '_id' }));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /_id/);
});

test('کلید تکراری (11000) → ۴۰۹', () => {
  const { res } = run(Object.assign(new Error('dup'), { code: 11000, keyPattern: { mobile: 1 } }));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body.error.details, { fields: ['mobile'] });
});

test('JSON خراب و بدنه بزرگ', () => {
  assert.equal(normalizeError(Object.assign(new Error('x'), { type: 'entity.parse.failed' })).statusCode, 400);
  assert.equal(normalizeError(Object.assign(new Error('x'), { type: 'entity.too.large' })).statusCode, 413);
});

test('اگر پاسخ قبلاً شروع شده باشد خطا به next داده می‌شود', () => {
  const res = createFakeRes();
  res.headersSent = true;
  const boom = new Error('late');
  const { nextArg } = run(boom, { res });
  assert.equal(nextArg, boom);
  assert.equal(res.body, undefined);
});

test('notFoundHandler یک AppError ۴۰۴ به next می‌دهد', () => {
  let got;
  notFoundHandler(createFakeReq({ method: 'POST', path: '/nope' }), createFakeRes(), (e) => {
    got = e;
  });
  assert.equal(got.statusCode, 404);
  assert.equal(got.code, 'NOT_FOUND');
});
