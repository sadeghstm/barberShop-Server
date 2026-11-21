'use strict';

const assert = require('node:assert/strict');
const v = require('../../src/helpers/validate');

const throwsField = (fn, field) =>
  assert.throws(fn, (e) => e.statusCode === 422 && e.details[0].field === field);

describe('validate', () => {
  describe('string', () => {
    it('متن را trim می‌کند', () => {
      assert.equal(v.string('  سلام ', 'name', { min: 2 }), 'سلام');
    });
    it('نبودن، نوع اشتباه و طول نامعتبر خطای ۴۲۲ با نام فیلد می‌دهد', () => {
      throwsField(() => v.string(undefined, 'name'), 'name');
      throwsField(() => v.string(12, 'name'), 'name');
      throwsField(() => v.string('a', 'name', { min: 2 }), 'name');
      throwsField(() => v.string('x'.repeat(11), 'name', { max: 10 }), 'name');
    });
    it('فیلد اختیاری: ارسال‌نشده → undefined؛ رشته خالی با min:0 مجاز', () => {
      assert.equal(v.string(undefined, 'a', { optional: true }), undefined);
      assert.equal(v.string('', 'a', { min: 0, optional: true }), '');
    });
  });

  it('boolean', () => {
    assert.equal(v.boolean(false, 'x'), false);
    assert.equal(v.boolean(undefined, 'x', { optional: true }), undefined);
    throwsField(() => v.boolean('true', 'x'), 'x');
    throwsField(() => v.boolean(undefined, 'x'), 'x');
  });

  it('int: فقط عدد صحیح JSON، با بازه و مضرب', () => {
    assert.equal(v.int(30, 'duration', { min: 5, max: 480, multipleOf: 5 }), 30);
    assert.equal(v.int(0, 'price'), 0);
    assert.equal(v.int(undefined, 'x', { optional: true }), undefined);
    for (const bad of ['30', 30.5, null, undefined, NaN, Infinity]) throwsField(() => v.int(bad, 'duration'), 'duration');
    throwsField(() => v.int(4, 'duration', { min: 5 }), 'duration');
    throwsField(() => v.int(481, 'duration', { max: 480 }), 'duration');
    throwsField(() => v.int(32, 'duration', { multipleOf: 5 }), 'duration');
    throwsField(() => v.int(-1, 'price'), 'price');
  });

  it('objectId', () => {
    assert.equal(v.objectId('64b7f0c2a1b2c3d4e5f60718', 'id'), '64b7f0c2a1b2c3d4e5f60718');
    for (const bad of ['', 'abc', 123, null, '64b7f0c2a1b2c3d4e5f6071g']) throwsField(() => v.objectId(bad, 'id'), 'id');
  });

  it('slug: فقط حروف کوچک انگلیسی، عدد و خط تیره', () => {
    assert.equal(v.slug(' My-Shop1 ', 'slug'), 'my-shop1');
    for (const bad of ['a', 'سلام', 'a b', '-ab', 'a_b']) throwsField(() => v.slug(bad, 'slug'), 'slug');
  });

  it('dayKey: تاریخ واقعی می‌خواهد (۳۱ نوامبر و ۲۹ فوریه غیرکبیسه نامعتبرند)', () => {
    assert.equal(v.dayKey('2026-11-20', 'date'), '2026-11-20');
    assert.equal(v.dayKey('2028-02-29', 'date'), '2028-02-29'); // سال کبیسه
    for (const bad of ['2026-11-31', '2026-13-01', '2027-02-29', '26-11-20', 'abc', '2026/11/20']) {
      throwsField(() => v.dayKey(bad, 'date'), 'date');
    }
  });

  it('integer: نامعتبر → fallback و محدود به بازه', () => {
    assert.equal(v.integer('3', { fallback: 1 }), 3);
    assert.equal(v.integer(undefined, { fallback: 1 }), 1);
    assert.equal(v.integer('abc', { fallback: 1 }), 1);
    assert.equal(v.integer('1.5', { fallback: 1 }), 1);
    assert.equal(v.integer('999', { fallback: 20, max: 50 }), 50);
    assert.equal(v.integer('-4', { fallback: 1 }), 1);
  });

  describe('oneOf', () => {
    it('مقدار مجاز برمی‌گردد؛ غیر مجاز و نبودن ۴۲۲', () => {
      assert.equal(v.oneOf('success', 'outcome', ['success', 'failure']), 'success');
      assert.throws(() => v.oneOf('x', 'outcome', ['success']), (e) => e.statusCode === 422 && e.details[0].field === 'outcome');
      assert.throws(() => v.oneOf(undefined, 'outcome', ['success']), (e) => e.statusCode === 422);
      assert.equal(v.oneOf(undefined, 'outcome', ['success'], { optional: true }), undefined);
    });
  });

  describe('datetime', () => {
    it('ISO با منطقه زمانی را به Date تبدیل می‌کند', () => {
      assert.equal(v.datetime('2026-11-10T06:30:00.000Z', 'start').toISOString(), '2026-11-10T06:30:00.000Z');
      assert.equal(v.datetime('2026-11-10T10:00:00+03:30', 'start').toISOString(), '2026-11-10T06:30:00.000Z');
      assert.equal(v.datetime('2026-11-10T06:30Z', 'start').getTime(), Date.parse('2026-11-10T06:30:00Z'));
    });

    it('بدون منطقه زمانی، روز ناموجود و غیرمتن ۴۲۲', () => {
      for (const bad of ['2026-11-10T06:30:00', '2026-11-10', '2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z', 'x', '', 123, null, undefined, {}]) {
        assert.throws(() => v.datetime(bad, 'start'), (e) => e.statusCode === 422 && e.details[0].field === 'start', String(bad));
      }
    });
  });
});
