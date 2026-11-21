'use strict';

const assert = require('node:assert/strict');
const { createFakeRedis, isolateModules, mockLogger } = require('../helpers/fakes');

describe('قفل ردیس (withLock)', () => {
  let restore;
  let withLock;
  let redis;

  before(() => {
    mockLogger();
    redis = createFakeRedis();
    restore = isolateModules({ 'db/redis': { redis } });
    ({ withLock } = require('../../src/services/lock'));
  });
  after(() => restore());
  beforeEach(() => redis.store.clear());

  it('نتیجه‌ی کار را برمی‌گرداند و قفل را آزاد می‌کند', async () => {
    assert.equal(await withLock('k', async () => 42), 42);
    assert.equal(redis.store.size, 0);
  });

  it('خطای کار را پرتاب می‌کند ولی باز هم قفل آزاد می‌شود', async () => {
    await assert.rejects(withLock('k', async () => { throw new Error('boom'); }), /boom/);
    assert.equal(redis.store.size, 0);
  });

  it('دو کار هم‌کلید پشت‌سرهم اجرا می‌شوند (هم‌پوشانی ندارند)', async () => {
    let inside = 0;
    let maxInside = 0;
    const job = () => withLock('k', async () => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, 15));
      inside -= 1;
    });
    await Promise.all([job(), job(), job()]);
    assert.equal(maxInside, 1);
  });

  it('کلیدهای متفاوت هم‌زمان اجرا می‌شوند', async () => {
    let inside = 0;
    let maxInside = 0;
    const job = (key) => withLock(key, async () => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, 15));
      inside -= 1;
    });
    await Promise.all([job('a'), job('b')]);
    assert.equal(maxInside, 2);
  });

  it('اگر قفل منقضی و به دیگری داده شد، آزادسازی ما به قفل او دست نمی‌زند', async () => {
    await withLock('k', async () => {
      redis.store.set('k', { value: 'other-owner', expiresAt: null }); // شبیه‌سازی انقضا و گرفتن توسط دیگری
    });
    assert.equal(redis.store.get('k').value, 'other-owner');
  });

  it('اگر قفل آزاد نشود بعد از waitMs ← ۴۲۹ و کار اجرا نمی‌شود', async () => {
    await redis.set('k', 'x', 'PX', 5000, 'NX');
    let ran = false;
    await assert.rejects(withLock('k', async () => { ran = true; }, { waitMs: 50, retryMs: 10 }), (e) => e.statusCode === 429);
    assert.equal(ran, false);
  });

  it('شکست آزادسازی (ردیس قطع) نتیجه را خراب نمی‌کند', async () => {
    const original = redis.eval;
    redis.eval = async () => { throw new Error('redis down'); };
    try {
      assert.equal(await withLock('k', async () => 'ok'), 'ok');
    } finally {
      redis.eval = original;
    }
  });
});
