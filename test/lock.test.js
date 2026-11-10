'use strict';

// قفل کوتاه ردیس «آرایشگر + روز» (بخش ۵.۱): فقط یک رزرو هم‌زمان، آزادسازی حتی وقتی خطا رخ دهد.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRedis, stubModule } = require('./helpers/fakes');

const redis = createFakeRedis();
stubModule('db/redis', { redis, connectRedis: async () => {}, closeRedis: async () => {} });

const { acquireBookingLock, withBookingLock, lockKey } = require('../src/services/lock');

test('قفل دوم برای همان آرایشگر و روز رد می‌شود، ولی روز دیگر آزاد است', async () => {
  const release = await acquireBookingLock('barber-1', '2026-11-10');
  await assert.rejects(() => acquireBookingLock('barber-1', '2026-11-10'), (err) => err.statusCode === 409);

  const other = await acquireBookingLock('barber-1', '2026-11-11');
  await other();

  await release();
  const again = await acquireBookingLock('barber-1', '2026-11-10');
  await again();
});

test('آزادسازی با توکن اشتباه قفل دیگری را باز نمی‌کند', async () => {
  const release = await acquireBookingLock('barber-2', '2026-11-10');
  // قفل با TTL (۱۰ ثانیه) منقضی می‌شود و دیگری آن را می‌گیرد
  redis.now += 11;
  const second = await acquireBookingLock('barber-2', '2026-11-10');
  await release(); // نباید قفل دوم را آزاد کند
  assert.ok(redis.store.get(lockKey('barber-2', '2026-11-10')));
  await second();
});

test('withBookingLock قفل را حتی با خطا آزاد می‌کند', async () => {
  await assert.rejects(
    withBookingLock('barber-3', '2026-11-10', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(redis.store.get(lockKey('barber-3', '2026-11-10')), undefined);
  // و دوباره قابل گرفتن است
  await withBookingLock('barber-3', '2026-11-10', async () => {});
});

test('withBookingLock مقدار برگشتی تابع را رد می‌کند', async () => {
  const value = await withBookingLock('barber-4', '2026-11-10', async () => 42);
  assert.equal(value, 42);
});
