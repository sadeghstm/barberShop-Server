'use strict';

// زمان‌بند دوره‌ای: اجرای هر سه کار در هر تیک و برداشتن پیام‌ها از صف،
// و مقاوم‌بودن در برابر خطای یک کار (تیک بعدی ادامه می‌دهد).

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stubModule, mockLogger } = require('./helpers/fakes');

const calls = { expire: 0, noShow: 0, reminder: 0, sms: 0 };
let failExpire = false;

stubModule('services/appointment', {
  expireHolds: async () => {
    calls.expire += 1;
    if (failExpire) throw new Error('db down');
    return 1;
  },
  markNoShows: async () => {
    calls.noShow += 1;
    return 1;
  },
  sendDueReminders: async () => {
    calls.reminder += 1;
    return 1;
  },
});
stubModule('services/catalog', {
  archiveFinishedRemovals: async () => 0,
});
stubModule('services/smsQueue', {
  processNextSms: async () => {
    calls.sms += 1;
    return calls.sms <= 2 ? { mobile: '09120000000' } : null; // دو پیام در صف
  },
});

mockLogger();
const scheduler = require('../src/services/scheduler');

beforeEach(() => {
  calls.expire = 0;
  calls.noShow = 0;
  calls.reminder = 0;
  calls.sms = 0;
  failExpire = false;
  scheduler.stop();
});

test('هر تیک همه کارها را انجام می‌دهد و صف پیامک را تا ته خالی می‌کند', async () => {
  await scheduler.tick();
  assert.equal(calls.expire, 1);
  assert.equal(calls.noShow, 1);
  assert.equal(calls.reminder, 1);
  assert.equal(calls.sms, 3); // دو پیام + یک null
});

test('خطای یک کار تیک را متوقف نمی‌کند و تیک قبلی مانع تیک بعدی نمی‌شود', async () => {
  failExpire = true;
  await scheduler.tick();
  // بعد از خطا، بقیه کارها اجرا نمی‌شوند ولی قفل اجرا آزاد می‌شود
  failExpire = false;
  await scheduler.tick();
  assert.equal(calls.expire, 2);
});

test('start/stop بدون خطا و idempotent است', () => {
  scheduler.start({ intervalMs: 60_000 });
  scheduler.start({ intervalMs: 60_000 });
  scheduler.stop();
  scheduler.stop();
});
