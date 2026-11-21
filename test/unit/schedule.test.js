'use strict';

const assert = require('node:assert/strict');
const {
  parseDayKey, toDayKey, toTehranTime, weekdayOf, addDays, tehranDate, overlaps,
  workingIntervalsOf, fitsInWorkingHours, computeFreeStarts, isStartFree,
} = require('../../src/helpers/schedule');

// ۱۹ آبان ۱۴۰۵ = 2026-11-10 (سه‌شنبه → weekday 3)
const DAY = '2026-11-10';
const at = (hhmm, day = DAY) => tehranDate(day, hhmm);
const hours = [{ weekday: 3, intervals: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '15:00' }] }];
const times = (list) => list.map((x) => x.time);

/** پارامترهای پایه: «الان» ۰۸:۰۰ همان روز، بدون نوبت، مدت ۳۰ دقیقه */
const base = (extra = {}) => ({
  dayKey: DAY,
  workingHours: hours,
  holidays: [],
  busy: [],
  durationMinutes: 30,
  now: at('08:00'),
  minLeadMinutes: 15,
  ...extra,
});

describe('تبدیل زمان (وقت تهران)', () => {
  it('toDayKey: مرز نیمه‌شب تهران (۲۰:۳۰ UTC)', () => {
    assert.equal(toDayKey(new Date('2026-11-09T20:29:59Z')), '2026-11-09');
    assert.equal(toDayKey(new Date('2026-11-09T20:30:00Z')), '2026-11-10');
    assert.equal(toDayKey(new Date('2026-12-31T20:30:00Z')), '2027-01-01');
  });

  it('tehranDate و toTehranTime معکوس هم‌اند', () => {
    assert.equal(tehranDate(DAY, '00:00').toISOString(), '2026-11-09T20:30:00.000Z');
    assert.equal(tehranDate(DAY, '09:30').toISOString(), '2026-11-10T06:00:00.000Z');
    assert.equal(toTehranTime(tehranDate(DAY, '23:55')), '23:55');
    assert.equal(toDayKey(tehranDate(DAY, '23:55')), DAY);
    assert.equal(toDayKey(tehranDate(DAY, '00:00')), DAY);
  });

  it('weekdayOf: ۰ شنبه ... ۶ جمعه', () => {
    assert.equal(weekdayOf('2026-11-07'), 0); // شنبه
    assert.equal(weekdayOf('2026-11-08'), 1); // یکشنبه
    assert.equal(weekdayOf(DAY), 3); // سه‌شنبه
    assert.equal(weekdayOf('2026-11-13'), 6); // جمعه
  });

  it('addDays: مرز ماه و سال و سال کبیسه', () => {
    assert.equal(addDays(DAY, 1), '2026-11-11');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
    assert.equal(addDays(DAY, 0), DAY);
    assert.equal(addDays(DAY, 60), '2027-01-09');
  });

  it('parseDayKey: روز ناموجود و قالب غلط خطا می‌دهد', () => {
    assert.deepEqual(parseDayKey(DAY), { year: 2026, month: 11, day: 10 });
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '', null, undefined, 20261110]) {
      assert.throws(() => parseDayKey(bad), TypeError, String(bad));
    }
  });

  it('overlaps: پایان یکی = شروع دیگری هم‌پوشانی نیست', () => {
    assert.equal(overlaps(at('09:00'), at('09:30'), at('09:30'), at('10:00')), false);
    assert.equal(overlaps(at('09:00'), at('09:30'), at('09:29'), at('10:00')), true);
    assert.equal(overlaps(at('09:00'), at('11:00'), at('09:30'), at('10:00')), true); // شامل
    assert.equal(overlaps(at('09:30'), at('10:00'), at('09:00'), at('11:00')), true);
  });
});

describe('workingIntervalsOf', () => {
  it('بازه‌های آن روز هفته؛ روز بدون ساعت کاری یا تعطیل خالی است', () => {
    const list = workingIntervalsOf(DAY, hours, []);
    assert.deepEqual(list.map((i) => [toTehranTime(i.start), toTehranTime(i.end)]), [['09:00', '12:00'], ['14:00', '15:00']]);
    assert.deepEqual(workingIntervalsOf('2026-11-11', hours, []), []); // چهارشنبه
    assert.deepEqual(workingIntervalsOf(DAY, hours, [{ date: DAY }]), []); // تعطیلی (شیء)
    assert.deepEqual(workingIntervalsOf(DAY, hours, [DAY]), []); // تعطیلی (رشته)
    assert.equal(workingIntervalsOf(DAY, hours, [{ date: '2026-11-11' }]).length, 2);
    assert.deepEqual(workingIntervalsOf(DAY, [], []), []);
    assert.deepEqual(workingIntervalsOf(DAY, undefined, undefined), []);
  });
});

describe('computeFreeStarts', () => {
  it('روز خالی: هر ۵ دقیقه تا جایی که نوبت ۳۰ دقیقه‌ای جا شود', () => {
    const list = computeFreeStarts(base());
    const t = times(list);
    assert.equal(t[0], '09:00');
    assert.ok(t.includes('11:30')); // آخرین شروع بازه‌ی اول (۱۱:۳۰ تا ۱۲:۰۰)
    assert.ok(!t.includes('11:35'));
    assert.ok(t.includes('14:30'));
    assert.ok(!t.includes('14:35'));
    assert.equal(t.length, 31 + 7); // ۹:۰۰..۱۱:۳۰ = ۳۱ و ۱۴:۰۰..۱۴:۳۰ = ۷
    assert.deepEqual(list[0].end, at('09:30'));
  });

  it('خروجی مرتب است و هر زمان شروع روی شبکه‌ی ۵ دقیقه‌ای', () => {
    const list = computeFreeStarts(base({ durationMinutes: 45 }));
    for (let i = 1; i < list.length; i += 1) assert.ok(list[i].start > list[i - 1].start);
    for (const slot of list) assert.equal(Number(slot.time.slice(3)) % 5, 0);
  });

  it('مدت بلندتر از هر بازه‌ی کاری: هیچ', () => {
    assert.deepEqual(computeFreeStarts(base({ durationMinutes: 185 })), []);
  });

  it('مدت دقیقاً برابر بازه: فقط یک شروع', () => {
    assert.deepEqual(times(computeFreeStarts(base({ durationMinutes: 180 }))), ['09:00']);
  });

  it('نوبت اشغال‌کننده: زمان‌های هم‌پوشان حذف می‌شوند؛ چسبیدن قبل و بعد مجاز است', () => {
    const busy = [{ start: at('10:00'), end: at('10:30') }];
    const t = times(computeFreeStarts(base({ busy })));
    assert.ok(t.includes('09:30')); // ۹:۳۰ تا ۱۰:۰۰ دقیقاً چسبیده به نوبت
    assert.ok(!t.includes('09:35'));
    assert.ok(!t.includes('10:00'));
    assert.ok(!t.includes('10:25'));
    assert.ok(t.includes('10:30')); // درست بعد از نوبت
  });

  it('چند نوبت و فاصله‌ی کوچک‌تر از مدت: آن فاصله پیشنهاد نمی‌شود', () => {
    const busy = [
      { start: at('09:00'), end: at('09:50') },
      { start: at('10:10'), end: at('11:00') },
    ];
    const t = times(computeFreeStarts(base({ busy, durationMinutes: 30 })));
    assert.ok(!t.includes('09:50')); // فقط ۲۰ دقیقه فاصله
    assert.equal(t[0], '11:00');
    assert.deepEqual(times(computeFreeStarts(base({ busy, durationMinutes: 20 }))).slice(0, 2), ['09:50', '11:00']);
  });

  it('نوبت اشغال‌کننده‌ی بزرگ‌تر از بازه (یا خارج از ساعت کاری) خطا نمی‌دهد', () => {
    const busy = [{ start: at('06:00'), end: at('13:00') }];
    assert.deepEqual(times(computeFreeStarts(base({ busy }))).slice(0, 1), ['14:00']);
  });

  it('«موقت»ِ فعال اشغال است؛ «موقت»ِ منقضی‌شده نادیده گرفته می‌شود', () => {
    const now = at('08:00');
    const active = [{ start: at('09:00'), end: at('09:30'), heldUntil: new Date(now.getTime() + 1) }];
    const expired = [{ start: at('09:00'), end: at('09:30'), heldUntil: new Date(now.getTime()) }]; // دقیقاً الان = منقضی
    assert.equal(computeFreeStarts(base({ busy: active }))[0].time, '09:30');
    assert.equal(computeFreeStarts(base({ busy: expired }))[0].time, '09:00');
  });

  it('حداقل فاصله تا الان: شروع باید ≥ الان + ۱۵ دقیقه باشد', () => {
    const t = times(computeFreeStarts(base({ now: at('09:20') })));
    assert.equal(t[0], '09:35'); // ۰۹:۲۰ + ۱۵
    assert.deepEqual(times(computeFreeStarts(base({ now: at('09:21') })))[0], '09:40'); // گرد به شبکه‌ی بعدی
    assert.equal(times(computeFreeStarts(base({ now: at('09:20'), minLeadMinutes: 0 })))[0], '09:20');
  });

  it('الان داخل استراحت یا بعد از پایان کار: فقط زمان‌های بعدی', () => {
    assert.equal(computeFreeStarts(base({ now: at('12:30') }))[0].time, '14:00');
    assert.deepEqual(computeFreeStarts(base({ now: at('14:50') })), []);
    assert.deepEqual(computeFreeStarts(base({ now: at('23:00') })), []);
  });

  it('روز گذشته خالی؛ روز آینده کامل (الان در روز قبل)', () => {
    assert.deepEqual(computeFreeStarts(base({ now: at('10:00', '2026-11-11') })), []);
    const tomorrow = computeFreeStarts(base({ now: at('23:50', '2026-11-09') }));
    assert.equal(tomorrow[0].time, '09:00');
  });

  it('تعطیلی و روز بدون ساعت کاری: خالی', () => {
    assert.deepEqual(computeFreeStarts(base({ holidays: [{ date: DAY, note: 'x' }] })), []);
    assert.deepEqual(computeFreeStarts(base({ dayKey: '2026-11-11' })), []);
    assert.deepEqual(computeFreeStarts(base({ workingHours: [] })), []);
  });

  it('stepMinutes: شبکه‌ی درشت‌تر', () => {
    assert.deepEqual(times(computeFreeStarts(base({ durationMinutes: 60, stepMinutes: 30 }))), ['09:00', '09:30', '10:00', '10:30', '11:00', '14:00']);
  });

  it('بازه‌ی کاری تا ۲۳:۵۵ و شروع ۰۰:۰۰ درست کار می‌کند (مرز روز)', () => {
    const hrs = [{ weekday: 3, intervals: [{ start: '00:00', end: '00:20' }, { start: '23:30', end: '23:55' }] }];
    const t = times(computeFreeStarts(base({ workingHours: hrs, now: at('00:00', '2026-11-09'), durationMinutes: 20 })));
    assert.deepEqual(t, ['00:00', '23:30', '23:35']);
  });

  it('ورودی نامعتبر TypeError می‌دهد', () => {
    for (const extra of [
      { durationMinutes: 0 }, { durationMinutes: 7 }, { durationMinutes: 30.5 }, { durationMinutes: '30' },
      { now: 'x' }, { now: new Date('x') }, { minLeadMinutes: -1 }, { minLeadMinutes: 1.5 },
      { dayKey: '2026-02-30' }, { stepMinutes: 3 },
    ]) {
      assert.throws(() => computeFreeStarts(base(extra)), TypeError, JSON.stringify(extra));
    }
  });

  it('ورودی را تغییر نمی‌دهد (خالص است)', () => {
    const busy = [{ start: at('10:00'), end: at('10:30') }];
    const snapshot = JSON.stringify({ hours, busy });
    computeFreeStarts(base({ busy }));
    assert.equal(JSON.stringify({ hours, busy }), snapshot);
  });
});

describe('isStartFree', () => {
  it('هر زمانی که computeFreeStarts می‌دهد true است و بقیه false', () => {
    const busy = [{ start: at('10:00'), end: at('10:30') }];
    const params = base({ busy });
    const free = new Set(computeFreeStarts(params).map((s) => s.start.getTime()));
    for (let t = at('00:00').getTime(); t < at('00:00').getTime() + 24 * 3600000; t += 5 * 60000) {
      assert.equal(isStartFree(params, new Date(t)), free.has(t), toTehranTime(new Date(t)));
    }
  });

  it('شروع خارج از شبکه‌ی ۵ دقیقه‌ای، یا روز دیگر، یا Date نامعتبر: false', () => {
    const params = base();
    assert.equal(isStartFree(params, new Date(at('09:00').getTime() + 1000)), false);
    assert.equal(isStartFree(params, new Date(at('09:00').getTime() + 60000)), false);
    assert.equal(isStartFree(params, at('09:00', '2026-11-17')), false); // هفته‌ی بعد، همان روز هفته
    assert.equal(isStartFree(params, new Date('x')), false);
    assert.equal(isStartFree(params, null), false);
    assert.equal(isStartFree(params, at('09:00')), true);
  });

  it('نوبتی که از پایان ساعت کاری بیرون می‌زند false است', () => {
    assert.equal(isStartFree(base(), at('11:45')), false);
    assert.equal(isStartFree(base(), at('11:30')), true);
  });
});

describe('fitsInWorkingHours', () => {
  const slot = (a, b, dayKey = DAY) => ({ dayKey, start: at(a, dayKey), end: at(b, dayKey) });

  it('کاملاً داخل یک بازه: بله؛ مرز دقیق: بله؛ بیرون‌زدن یا پل زدن روی استراحت: نه', () => {
    assert.equal(fitsInWorkingHours(slot('09:00', '09:30'), hours, []), true);
    assert.equal(fitsInWorkingHours(slot('11:30', '12:00'), hours, []), true);
    assert.equal(fitsInWorkingHours(slot('11:45', '12:15'), hours, []), false);
    assert.equal(fitsInWorkingHours(slot('08:45', '09:15'), hours, []), false);
    assert.equal(fitsInWorkingHours(slot('11:30', '14:30'), hours, []), false); // از وسط استراحت
    assert.equal(fitsInWorkingHours(slot('14:00', '15:00'), hours, []), true);
  });

  it('تعطیلی، روز بدون ساعت کاری و ساعت کاری خالی: نه', () => {
    assert.equal(fitsInWorkingHours(slot('09:00', '09:30'), hours, [{ date: DAY }]), false);
    assert.equal(fitsInWorkingHours(slot('09:00', '09:30', '2026-11-11'), hours, []), false);
    assert.equal(fitsInWorkingHours(slot('09:00', '09:30'), [], []), false);
  });
});
