'use strict';

// پیامک از طریق صف ردیس با کلید یکتا (بخش ۵.۹): پیام تکراری دوبار صف نمی‌شود و شکست پیامک نوبت را لغو نمی‌کند.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeRedis, stubModule, mockLogger } = require('./helpers/fakes');

const redis = createFakeRedis();
stubModule('db/redis', { redis, connectRedis: async () => {}, closeRedis: async () => {} });
mockLogger();

const smsQueue = require('../src/services/smsQueue');

beforeEach(() => {
  redis.store.clear();
  redis.now = 0;
});

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

test('پردازش صف: هر پیام یک‌بار برداشته می‌شود', async () => {
  await smsQueue.enqueueSms({ mobile: '09121234567', event: 'appointment.reminder', data: { time: '12:00' }, idempotencyKey: 'sms:reminder:a1' });
  const item = await smsQueue.processNextSms();
  assert.equal(item.event, 'appointment.reminder');
  assert.equal(item.mobile, '09121234567');
  assert.equal(await smsQueue.processNextSms(), null);
});
