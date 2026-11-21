'use strict';

const assert = require('node:assert/strict');
const { buildEntry, toSnapshot } = require('../../src/helpers/auditEntry');
const { ROLES, SYSTEM_ACTOR } = require('../../src/constants/roles');

const valid = () => ({
  actor: { userId: 'u1', role: ROLES.BARBER, shopId: 's1' },
  action: 'appointment.start',
  entityType: 'appointments',
  entityId: 'a1',
  before: { status: 'arrived' },
  after: { status: 'inProgress' },
});

describe('auditEntry (ساخت سند لاگ)', () => {
  it('ورودی معتبر به سند کامل تبدیل می‌شود', () => {
    const doc = buildEntry({ ...valid(), requestId: 'r1', ip: '1.2.3.4' });
    assert.equal(doc.actor.role, 'barber');
    assert.equal(doc.entityType, 'appointments');
    assert.deepEqual(doc.before, { status: 'arrived' });
    assert.equal(doc.requestId, 'r1');
    assert.equal(doc.meta, null);
  });

  it('کار خودکار با نقش system و بدون userId مجاز است', () => {
    const doc = buildEntry({ ...valid(), actor: { role: SYSTEM_ACTOR } });
    assert.equal(doc.actor.userId, null);
  });

  it('actor نامعتبر/ناموجود، action یا entityType خالی رد می‌شود', () => {
    assert.throws(() => buildEntry({ ...valid(), actor: undefined }), TypeError);
    assert.throws(() => buildEntry({ ...valid(), actor: { role: 'hacker' } }), TypeError);
    assert.throws(() => buildEntry({ ...valid(), action: '  ' }), TypeError);
    assert.throws(() => buildEntry({ ...valid(), entityType: undefined }), TypeError);
    assert.throws(() => buildEntry(undefined), TypeError);
  });

  it('snapshot: toObject، Date و کلیدهای حساس', () => {
    const snap = toSnapshot({
      toObject: () => ({
        price: 100,
        at: new Date('2026-11-05T00:00:00Z'),
        otp: '123456',
        nested: { accessToken: 'abc', ok: 1 },
        list: [{ password: 'p' }],
      }),
    });
    assert.equal(snap.at, '2026-11-05T00:00:00.000Z');
    assert.equal(snap.otp, '[REDACTED]');
    assert.equal(snap.nested.accessToken, '[REDACTED]');
    assert.equal(snap.nested.ok, 1);
    assert.equal(snap.list[0].password, '[REDACTED]');
    assert.equal(snap.price, 100);
  });

  it('snapshot برای undefined/null/تابع برابر null است', () => {
    assert.equal(toSnapshot(undefined), null);
    assert.equal(toSnapshot(null), null);
    assert.equal(toSnapshot(() => {}), null);
  });
});
