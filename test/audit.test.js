'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEntry, toSnapshot } = require('../src/helpers/auditEntry');
const { ROLES, SYSTEM_ACTOR } = require('../src/constants/roles');

const valid = () => ({
  actor: { userId: 'u1', role: ROLES.BARBER, shopId: 's1' },
  action: 'appointment.start',
  entityType: 'appointments',
  entityId: 'a1',
  before: { status: 'arrived' },
  after: { status: 'inProgress' },
});

test('ورودی معتبر به سند کامل تبدیل می‌شود', () => {
  const doc = buildEntry({ ...valid(), requestId: 'r1', ip: '1.2.3.4' });
  assert.equal(doc.actor.role, 'barber');
  assert.equal(doc.entityType, 'appointments');
  assert.deepEqual(doc.before, { status: 'arrived' });
  assert.equal(doc.requestId, 'r1');
  assert.equal(doc.meta, null);
});

test('کار خودکار با نقش system و بدون userId مجاز است', () => {
  const doc = buildEntry({ ...valid(), actor: { role: SYSTEM_ACTOR } });
  assert.equal(doc.actor.userId, null);
});

test('actor نامعتبر/ناموجود، action یا entityType خالی رد می‌شود', () => {
  assert.throws(() => buildEntry({ ...valid(), actor: undefined }), TypeError);
  assert.throws(() => buildEntry({ ...valid(), actor: { role: 'hacker' } }), TypeError);
  assert.throws(() => buildEntry({ ...valid(), action: '  ' }), TypeError);
  assert.throws(() => buildEntry({ ...valid(), entityType: undefined }), TypeError);
  assert.throws(() => buildEntry(undefined), TypeError);
});

test('snapshot: toObject، Date و کلیدهای حساس', () => {
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

test('snapshot برای undefined/null/تابع برابر null است', () => {
  assert.equal(toSnapshot(undefined), null);
  assert.equal(toSnapshot(null), null);
  assert.equal(toSnapshot(() => {}), null);
});

// سرویس و middleware به مدل مونگوس وابسته‌اند؛ بدون mongoose نصب‌شده skip می‌شوند.
let hasMongoose = true;
try {
  require.resolve('mongoose');
} catch {
  hasMongoose = false;
}
const withMongoose = { skip: hasMongoose ? false : 'mongoose is not installed' };

function loadAudit() {
  const { mockLogger } = require('./helpers/fakes');
  const logger = mockLogger();
  const AuditLog = require('../src/models/AuditLog');
  const auditService = require('../src/services/audit');
  const attachAudit = require('../src/middlewares/audit');
  return { logger, AuditLog, auditService, attachAudit };
}

test('record سند ساخته‌شده را به مدل می‌دهد', withMongoose, async (t) => {
  const { AuditLog, auditService } = loadAudit();
  const create = t.mock.method(AuditLog, 'create', async (d) => ({ _id: 'x', ...d }));
  const out = await auditService.record(valid());
  assert.equal(create.mock.callCount(), 1);
  assert.equal(create.mock.calls[0].arguments[0].action, 'appointment.start');
  assert.equal(out._id, 'x');
});

test('شکست نوشتن لاگ می‌شود و خطا دوباره پرتاب می‌شود', withMongoose, async (t) => {
  const { logger, AuditLog, auditService } = loadAudit();
  t.mock.method(AuditLog, 'create', async () => Promise.reject(new Error('db down')));
  await assert.rejects(auditService.record(valid()), /db down/);
  assert.equal(logger.calls[0].level, 'error');
});

test('record ورودی نامعتبر را قبل از رسیدن به مدل رد می‌کند', withMongoose, async (t) => {
  const { AuditLog, auditService } = loadAudit();
  const create = t.mock.method(AuditLog, 'create', async () => ({}));
  await assert.rejects(auditService.record({ action: 'x' }), TypeError);
  assert.equal(create.mock.callCount(), 0);
});

test('middleware: req.audit از req.auth و req.id و req.ip پر می‌کند', withMongoose, async (t) => {
  const { AuditLog, attachAudit } = loadAudit();
  const create = t.mock.method(AuditLog, 'create', async (d) => d);
  const req = { id: 'rid-1', ip: '9.9.9.9', auth: { userId: 'u9', role: ROLES.ADMIN, shopId: null } };
  attachAudit(req, {}, () => {});
  await req.audit({ action: 'service.approve', entityType: 'serviceRequests', entityId: 'sr1' });
  const saved = create.mock.calls[0].arguments[0];
  assert.equal(saved.actor.userId, 'u9');
  assert.equal(saved.actor.role, 'admin');
  assert.equal(saved.requestId, 'rid-1');
  assert.equal(saved.ip, '9.9.9.9');
});

test('middleware: actor صریح بر req.auth غلبه می‌کند', withMongoose, async (t) => {
  const { AuditLog, attachAudit } = loadAudit();
  const create = t.mock.method(AuditLog, 'create', async (d) => d);
  const req = { id: 'r', auth: { userId: 'u1', role: ROLES.CUSTOMER } };
  attachAudit(req, {}, () => {});
  await req.audit({ actor: { role: SYSTEM_ACTOR }, action: 'a', entityType: 'b' });
  assert.equal(create.mock.calls[0].arguments[0].actor.role, 'system');
});
