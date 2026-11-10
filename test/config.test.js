'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('مقادیر پیش‌فرض development', () => {
  const c = loadConfig({});
  assert.equal(c.env, 'development');
  assert.equal(c.port, 3000);
  assert.equal(c.logLevel, 'debug');
  assert.match(c.mongoUri, /^mongodb:\/\//);
  assert.match(c.redisUrl, /^redis:\/\//);
});

test('در محیط test لاگ silent است', () => {
  assert.equal(loadConfig({ NODE_ENV: 'test' }).logLevel, 'silent');
});

test('production بدون MONGO_URI و REDIS_URL خطا می‌دهد', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /MONGO_URI[\s\S]*REDIS_URL/);
});

test('production با آدرس‌های صریح معتبر است', () => {
  const c = loadConfig({ NODE_ENV: 'production', MONGO_URI: 'mongodb://db/x', REDIS_URL: 'redis://r' });
  assert.equal(c.isProd, true);
  assert.equal(c.logLevel, 'info');
});

test('همه خطاها یک‌جا گزارش می‌شوند', () => {
  assert.throws(
    () => loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud' }),
    (e) => /PORT/.test(e.message) && /LOG_LEVEL/.test(e.message),
  );
});

test('PORT خارج از بازه رد می‌شود', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
});

test('خروجی freeze شده است', () => {
  assert.equal(Object.isFrozen(loadConfig({})), true);
});
