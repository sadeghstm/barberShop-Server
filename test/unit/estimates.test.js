'use strict';

const assert = require('node:assert/strict');
const { computeEstimateChanges, shiftMinutes } = require('../../src/helpers/estimates');
const { tehranDate } = require('../../src/helpers/schedule');

const DAY = '2026-11-10';
const at = (hhmm) => tehranDate(DAY, hhmm);
let seq = 0;

/** نوبت ۳۰ دقیقه‌ای؛ زمان پیش‌بینی‌شده‌ی اولیه = زمان رزرو */
const appt = (hhmm, extra = {}) => {
  const start = at(hhmm);
  return {
    _id: `a${++seq}`, status: 'confirmed', bookedStart: start, durationSnapshot: 30,
    estimatedStart: start, estimatedEnd: new Date(start.getTime() + 30 * 60000),
    startedAt: null, finishedAt: null, heldUntil: null, createdAt: new Date(seq), ...extra,
  };
};
const result = (list, now) => Object.fromEntries(
  computeEstimateChanges(list, now).map((c) => [c.id, [c.after.start, c.after.end].map((d) => d.toISOString().slice(11, 16))]),
);
// ۰۹:۰۰ تهران = ۰۵:۳۰ UTC
const utc = (hhmmTehran) => at(hhmmTehran).toISOString().slice(11, 16);

describe('محاسبه‌ی مجدد زمان پیش‌بینی‌شده', () => {
  it('بدون تاخیر: هیچ تغییری نیست', () => {
    const list = [appt('09:00'), appt('09:30'), appt('10:30')];
    assert.deepEqual(computeEstimateChanges(list, at('08:00')), []);
  });

  it('نوبت اول دیر تمام شد: بعدی‌های چسبیده عقب می‌روند، فاصله‌دار جذب می‌شود', () => {
    const first = appt('09:00', { status: 'completed', startedAt: at('09:05'), finishedAt: at('09:50') }); // ۲۰ دقیقه تاخیر
    const second = appt('09:30'); // چسبیده
    const third = appt('10:00'); // بعد از پایان دوم (۱۰:۲۰)؟ دوم ۰۹:۵۰..۱۰:۲۰ پس سوم ۱۰:۲۰
    const fourth = appt('11:00'); // فاصله‌دار: دست نمی‌خورد
    const out = result([first, second, third, fourth], at('09:50'));
    assert.deepEqual(out[second._id], [utc('09:50'), utc('10:20')]);
    assert.deepEqual(out[third._id], [utc('10:20'), utc('10:50')]);
    assert.equal(out[fourth._id], undefined);
  });

  it('هیچ‌وقت جلوتر از زمان رزرو نمی‌آید؛ تاخیر جبران‌شده به زمان رزرو برمی‌گردد', () => {
    const early = appt('09:00', { status: 'completed', finishedAt: at('09:10') }); // زودتر تمام شد
    const next = appt('09:30', { estimatedStart: at('09:50'), estimatedEnd: at('10:20') }); // قبلاً عقب رفته بود
    const out = result([early, next], at('09:10'));
    assert.deepEqual(out[next._id], [utc('09:30'), utc('10:00')]); // نه ۰۹:۱۰
  });

  it('در حال انجام که از مدت گذشته: تا «الان» ادامه دارد و بعدی‌ها منتظرند', () => {
    const running = appt('09:00', { status: 'inProgress', startedAt: at('09:00') }); // ۳۰ دقیقه‌ای
    const next = appt('09:30');
    const out = result([running, next], at('09:45'));
    assert.deepEqual(out[running._id], [utc('09:00'), utc('09:45')]);
    assert.deepEqual(out[next._id], [utc('09:45'), utc('10:15')]);
  });

  it('در حال انجام با شروع دیرهنگام: پایان = شروع واقعی + مدت', () => {
    const running = appt('09:00', { status: 'inProgress', startedAt: at('09:15') });
    const next = appt('09:30');
    const out = result([running, next], at('09:20'));
    assert.deepEqual(out[running._id], [utc('09:15'), utc('09:45')]);
    assert.deepEqual(out[next._id], [utc('09:45'), utc('10:15')]);
  });

  it('عدم حضور، لغو و منقضی در زنجیره نیستند: بعدی‌ها را عقب نمی‌اندازند', () => {
    const list = [
      appt('09:00', { status: 'noShow', estimatedEnd: at('11:00') }),
      appt('09:30', { status: 'cancelled' }),
      appt('10:00', { status: 'expired' }),
      appt('10:30'),
    ];
    assert.deepEqual(computeEstimateChanges(list, at('10:00')), []);
  });

  it('موقتِ فعال در زنجیره است، موقتِ مهلت‌گذشته نه', () => {
    const live = appt('09:30', { status: 'held', heldUntil: at('09:45') });
    const dead = appt('10:00', { status: 'held', heldUntil: at('08:00') });
    const first = appt('09:00', { status: 'completed', finishedAt: at('09:45') });
    const out = result([first, live, dead], at('09:40'));
    assert.deepEqual(out[live._id], [utc('09:45'), utc('10:15')]);
    assert.equal(out[dead._id], undefined);
  });

  it('ترتیب ورودی مهم نیست؛ هم‌زمانی با createdAt مرتب می‌شود', () => {
    const a = appt('09:00', { status: 'completed', finishedAt: at('09:40') });
    const b = appt('09:30');
    const out1 = result([b, a], at('09:40'));
    const out2 = result([a, b], at('09:40'));
    assert.deepEqual(out1, out2);
    assert.deepEqual(out1[b._id], [utc('09:40'), utc('10:10')]);
  });

  it('ورودی را تغییر نمی‌دهد و shiftMinutes جابه‌جایی را برمی‌گرداند', () => {
    const first = appt('09:00', { status: 'completed', finishedAt: at('09:45') });
    const second = appt('09:30');
    const snapshot = JSON.stringify([first, second]);
    const [change] = computeEstimateChanges([first, second], at('09:45'));
    assert.equal(JSON.stringify([first, second]), snapshot);
    assert.equal(shiftMinutes(change), 15);
  });
});
