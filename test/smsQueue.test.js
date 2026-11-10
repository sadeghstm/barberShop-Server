'use strict';

// پیامک از طریق صف ردیس با کلید یکتا (بخش ۵.۹): پیام تکراری دوبار صف نمی‌شود و شکست پیامک نوبت را لغو نمی‌کند.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRedis, stubModule, mockLogger } = require('./helpers/fakes');

const redis = createFakeRedis();
stubModule('db/redis', { redis, connectRedis: async () => {}, closeRedis: async () => {} });

// سرویس پیامک ساختگی: با failTimes می‌توان شکست ارسال را شبیه‌سازی کرد
const smsState = { sent: [], failTimes: 0 };
stubModule('services/sms', {
  send: async (mobile, text) => {
    if (smsState.failTimes > 0) {
      smsState.failTimes -= 1;
      throw new Error('provider down');
    }
    smsState.sent.push({ mobile, text });
    return { mock: true };
  },
});
mockLogger();

const smsQueue = require('../src/services/smsQueue');

beforeEach(() => {
  redis.store.clear();
  redis.now = 0;
  smsState.sent.length = 0;
  smsState.failTimes = 0;
});

const queuedCount = () => {
  const raw = redis.store.get(smsQueue.QUEUE_KEY)?.value;
  return raw ? JSON.parse(raw).length : 0;
};

test('متن پیامک برای هر رویداد ساخته می‌شود', () => {
  assert.match(smsQueue.buildMessage('appointment.confirmed', { code: '123456', time: '10:30' }), /123456/);
  assert.match(smsQueue.buildMessage('appointment.reminder', { time: '10:30' }), /10:30/);
  assert.match(smsQueue.buildMessage('appointment.delayed', { time: '11:00' }), /11:00/);
  assert.match(smsQueue.buildMessage('appointment.noShow'), /عدم حضور/);
  assert.equal(smsQueue.buildMessage('custom', { text: 'سلام' }), 'سلام');
});

test('بدون موبایل چیزی در صف گذاشته نمی‌شود', async () => {
  const result = await smsQueue.enqueueSms({ mobile: null, event: 'appointment.confirmed' });
  assert.equal(result.queued, false);
  assert.equal(result.reason, 'no-mobile');
});

test('همان کلید یکتا دوبار صف نمی‌شود', async () => {
  const first = await smsQueue.enqueueSms({
    mobile: '09121234567',
    event: 'appointment.confirmed',
    data: { code: '111111', time: '10:00' },
    idempotencyKey: 'sms:confirmed:a1',
  });
  const second = await smsQueue.enqueueSms({
    mobile: '09121234567',
    event: 'appointment.confirmed',
    data: { code: '111111', time: '10:00' },
    idempotencyKey: 'sms:confirmed:a1',
  });
  assert.equal(first.queued, true);
  assert.equal(second.queued, false);
  assert.equal(second.reason, 'duplicate');
});

test('پردازش صف: هر پیام یک‌بار برداشته و ارسال می‌شود', async () => {
  await smsQueue.enqueueSms({ mobile: '09121234567', event: 'appointment.reminder', data: { time: '12:00' }, idempotencyKey: 'sms:reminder:a1' });
  const item = await smsQueue.processNextSms();
  assert.equal(item.event, 'appointment.reminder');
  assert.equal(item.mobile, '09121234567');
  assert.equal(await smsQueue.processNextSms(), null);
  assert.equal(smsState.sent.length, 1);
  assert.match(smsState.sent[0].text, /12:00/);
});

test('شکست ارسال: پیام دوباره در صف می‌ماند تا حداکثر ۳ تلاش', async () => {
  await smsQueue.enqueueSms({ mobile: '09121234567', event: 'appointment.delayed', data: { time: '13:00' }, idempotencyKey: 'sms:delayed:a1' });
  smsState.failTimes = 2;

  const first = await smsQueue.processNextSms();
  assert.equal(first.failed, true);
  assert.equal(first.attempts, 1);
  assert.equal(queuedCount(), 1);

  const second = await smsQueue.processNextSms();
  assert.equal(second.attempts, 2);
  assert.equal(queuedCount(), 1);

  // تلاش سوم موفق است (failTimes تمام شده)
  const third = await smsQueue.processNextSms();
  assert.equal(third.failed, undefined);
  assert.equal(queuedCount(), 0);
  assert.equal(smsState.sent.length, 1);
});

test('بعد از ۳ شکست، پیام دور ریخته می‌شود', async () => {
  await smsQueue.enqueueSms({ mobile: '09121234567', event: 'appointment.confirmed', data: { time: '14:00' }, idempotencyKey: 'sms:confirmed:a2' });
  smsState.failTimes = 5;

  await smsQueue.processNextSms(); // attempts 1
  await smsQueue.processNextSms(); // attempts 2
  await smsQueue.processNextSms(); // attempts 3 → drop
  assert.equal(queuedCount(), 0);
  assert.equal(await smsQueue.processNextSms(), null);
});
