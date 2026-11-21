'use strict';

const assert = require('node:assert/strict');
const { normalizeWorkingHours } = require('../../src/helpers/workingHours');

const day = (weekday, ...pairs) => ({ weekday, intervals: pairs.map(([start, end]) => ({ start, end })) });
const rejects = (input) => assert.throws(() => normalizeWorkingHours(input), (e) => e.statusCode === 422);

describe('normalizeWorkingHours', () => {
  it('روزها و بازه‌ها مرتب می‌شوند', () => {
    const out = normalizeWorkingHours([day(3, ['16:00', '21:00'], ['09:00', '13:00']), day(0, ['10:00', '12:00'])]);
    assert.deepEqual(out, [
      day(0, ['10:00', '12:00']),
      day(3, ['09:00', '13:00'], ['16:00', '21:00']),
    ]);
  });

  it('روز بدون بازه (تعطیل) حذف می‌شود و فهرست خالی مجاز است', () => {
    assert.deepEqual(normalizeWorkingHours([day(6)]), []);
    assert.deepEqual(normalizeWorkingHours([]), []);
  });

  it('بازه‌های مجاور (پایان = شروع بعدی) مجاز است', () => {
    assert.equal(normalizeWorkingHours([day(1, ['09:00', '12:00'], ['12:00', '15:00'])])[0].intervals.length, 2);
  });

  it('ورودی نامعتبر رد می‌شود', () => {
    rejects(undefined);
    rejects('x');
    rejects([day(7, ['09:00', '10:00'])]); // روز هفته نامعتبر
    rejects([day(1.5, ['09:00', '10:00'])]);
    rejects([day(1, ['09:00', '10:00']), day(1, ['11:00', '12:00'])]); // روز تکراری
    rejects([day(1, ['10:00', '09:00'])]); // شروع بعد از پایان
    rejects([day(1, ['09:00', '09:00'])]);
    rejects([day(1, ['9:00', '10:00'])]); // فرمت
    rejects([day(1, ['24:00', '25:00'])]);
    rejects([day(1, ['09:03', '10:00'])]); // مضرب ۵ نیست
    rejects([day(1, ['09:00', '12:00'], ['11:00', '14:00'])]); // هم‌پوشانی
    rejects([day(1, ['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00'], ['14:00', '15:00'], ['16:00', '17:00'])]); // بیش از ۴ بازه
    rejects(Array.from({ length: 8 }, (_, i) => day(i % 7)));
  });
});
