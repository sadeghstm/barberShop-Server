'use strict';

const assert = require('node:assert/strict');
const { nextStatus, ACTIONS } = require('../../src/helpers/appointmentFlow');

describe('ماشین وضعیت کارهای آرایشگر', () => {
  it('مسیرهای مجاز', () => {
    assert.equal(nextStatus('arrive', 'confirmed'), 'arrived');
    assert.equal(nextStatus('start', 'arrived'), 'inProgress');
    assert.equal(nextStatus('start', 'confirmed'), 'inProgress'); // حضور هم‌زمان ثبت می‌شود
    assert.equal(nextStatus('complete', 'inProgress'), 'completed');
    assert.equal(nextStatus('noShow', 'confirmed'), 'noShow');
  });

  it('هر وضعیت دیگر ۴۰۹ INVALID_TRANSITION است', () => {
    const statuses = ['held', 'confirmed', 'arrived', 'inProgress', 'completed', 'expired', 'cancelled', 'noShow'];
    for (const [action, rule] of Object.entries(ACTIONS)) {
      for (const from of statuses.filter((s) => !rule.from.includes(s))) {
        assert.throws(() => nextStatus(action, from), (e) => e.statusCode === 409 && e.code === 'INVALID_TRANSITION', `${action} از ${from}`);
      }
    }
  });

  it('عدم حضور فقط از «تایید شده»؛ تکمیل فقط از «در حال انجام»؛ حاضر شدن دوباره نه', () => {
    assert.throws(() => nextStatus('noShow', 'arrived'), /INVALID|ممکن نیست/);
    assert.throws(() => nextStatus('complete', 'arrived'), /ممکن نیست/);
    assert.throws(() => nextStatus('arrive', 'arrived'), /ممکن نیست/);
  });

  it('کار ناشناخته TypeError', () => {
    assert.throws(() => nextStatus('fly', 'confirmed'), TypeError);
  });
});
