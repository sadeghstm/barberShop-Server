'use strict';

// زمان‌ها UTC ذخیره می‌شوند و dayKey/ساعت به وقت تهران است (بخش ۲ سند).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  toDayKey,
  weekdayOfDayKey,
  hhmmToMinutes,
  minutesToHhmm,
  dayKeyTimeToDate,
  tehranMinutesOfDay,
  addMinutes,
  overlaps,
} = require('../src/helpers/time');

test('toDayKey مرز نیمه‌شب تهران را درست حساب می‌کند', () => {
  // ۲۰:۳۰ UTC = ۰۰:۰۰ روز بعد به وقت تهران (UTC+3:30)
  assert.equal(toDayKey(new Date('2026-11-10T20:29:00Z')), '2026-11-10');
  assert.equal(toDayKey(new Date('2026-11-10T20:30:00Z')), '2026-11-11');
  // ۰۰:۰۰ تهران = ۲۰:۳۰ UTC روز قبل
  assert.equal(toDayKey(new Date('2026-11-10T00:00:00Z')), '2026-11-10');
});

test('weekdayOfDayKey با هفته ایرانی (شنبه=۰) هم‌خوان است', () => {
  // 2026-11-10 سه‌شنبه است → شنبه=0 پس سه‌شنبه=3
  assert.equal(weekdayOfDayKey('2026-11-10'), 3);
  assert.equal(weekdayOfDayKey('2026-11-14'), 0); // شنبه
  assert.equal(weekdayOfDayKey('2026-11-13'), 6); // جمعه
});

test('تبدیل HH:mm به دقیقه و برگشت', () => {
  assert.equal(hhmmToMinutes('09:30'), 570);
  assert.equal(hhmmToMinutes('00:00'), 0);
  assert.equal(hhmmToMinutes('24:00'), null);
  assert.equal(hhmmToMinutes('9:30'), null);
  assert.equal(minutesToHhmm(570), '09:30');
  assert.equal(minutesToHhmm(0), '00:00');
});

test('dayKeyTimeToDate ساعت تهران را به UTC درست تبدیل می‌کند', () => {
  const d = dayKeyTimeToDate('2026-11-10', '09:00');
  assert.equal(d.toISOString(), '2026-11-10T05:30:00.000Z');
  assert.equal(tehranMinutesOfDay(d), 9 * 60);
  assert.equal(toDayKey(d), '2026-11-10');

  const midnight = dayKeyTimeToDate('2026-11-10', '00:00');
  assert.equal(midnight.toISOString(), '2026-11-09T20:30:00.000Z');
  assert.equal(dayKeyTimeToDate('2026-11-10', '99:99'), null);
});

test('addMinutes و overlaps مرزها را درست می‌بینند', () => {
  const a = new Date('2026-11-10T05:30:00Z');
  assert.equal(addMinutes(a, 30).toISOString(), '2026-11-10T06:00:00.000Z');

  const s = new Date('2026-11-10T05:30:00Z');
  const e = new Date('2026-11-10T06:00:00Z');
  // مرز مشترک هم‌پوشانی نیست
  assert.equal(overlaps(s, e, e, addMinutes(e, 30)), false);
  assert.equal(overlaps(s, e, addMinutes(s, 15), addMinutes(e, 15)), true);
  assert.equal(overlaps(s, e, addMinutes(s, -60), s), false);
});
