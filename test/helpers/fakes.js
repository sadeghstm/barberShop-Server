'use strict';

const { EventEmitter } = require('node:events');

function createFakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headersSent = false;
  res.headers = {};
  res.body = undefined;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    res.headersSent = true;
    return res;
  };
  res.cookies = {};
  res.cookie = (name, value, options) => {
    res.cookies[name] = { value, options };
  };
  res.clearCookie = (name) => {
    delete res.cookies[name];
    res.clearedCookies = [...(res.clearedCookies ?? []), name];
  };
  res.setHeader = (key, value) => {
    res.headers[key.toLowerCase()] = value;
  };
  return res;
}

function createFakeReq({ headers = {}, ...rest } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method: 'GET', path: '/x', originalUrl: '/x', get: (name) => lower[name.toLowerCase()], ...rest };
}

/**
 * متدهای لاگر مشترک برنامه را با نسخه‌ای عوض می‌کند که فقط ثبت می‌کند (چیزی چاپ نمی‌شود).
 * هر فایل تست در فرایند جدا اجرا می‌شود، پس نیازی به برگرداندن نیست.
 * logger.calls: [{ level, args }]؛ با logger.calls.length = 0 خالی می‌شود.
 */
function mockLogger() {
  const { logger } = require('../../src/helpers/logger');
  logger.calls = [];
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (...args) => logger.calls.push({ level, args });
  }
  return logger;
}

/**
 * ردیس ساختگی در حافظه (فقط دستورهای مورد نیاز برنامه). زمان با fake.now قابل جلو بردن است.
 */
function createFakeRedis() {
  const store = new Map(); // key -> { value, expiresAt }
  const fake = {
    now: 0, // ثانیه
    store,
    _live(key) {
      const e = store.get(key);
      if (e && e.expiresAt !== null && e.expiresAt <= fake.now) store.delete(key);
      return store.get(key);
    },
    async set(key, value, ...opts) {
      let ex = null;
      let nx = false;
      for (let i = 0; i < opts.length; i += 1) {
        if (opts[i] === 'EX') ex = opts[(i += 1)];
        if (opts[i] === 'NX') nx = true;
      }
      if (nx && fake._live(key)) return null;
      store.set(key, { value: String(value), expiresAt: ex === null ? null : fake.now + ex });
      return 'OK';
    },
    async get(key) {
      return fake._live(key)?.value ?? null;
    },
    async del(...keys) {
      return keys.filter((k) => store.delete(k)).length;
    },
    async incr(key) {
      const e = fake._live(key);
      const next = Number(e?.value ?? 0) + 1;
      store.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
      return next;
    },
    async expire(key, seconds) {
      const e = fake._live(key);
      if (e) e.expiresAt = fake.now + seconds;
    },
    async ttl(key) {
      const e = fake._live(key);
      if (!e) return -2;
      return e.expiresAt === null ? -1 : e.expiresAt - fake.now;
    },
  };
  return fake;
}

/**
 * ماژول واقعی (مثل db/redis یا models/User) را با نمونه ساختگی عوض می‌کند، بدون اینکه بسته‌ی اصلی
 * (ioredis / mongoose) لازم باشد. باید قبل از require شدن ماژول‌هایی که از آن استفاده می‌کنند صدا زده شود.
 */
function stubModule(pathFromSrc, exports) {
  const file = require.resolve(require('node:path').join(__dirname, '../../src', pathFromSrc));
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}

module.exports = { createFakeRes, createFakeReq, mockLogger, createFakeRedis, stubModule };
