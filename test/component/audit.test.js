'use strict';

const assert = require('node:assert/strict');
const { mock } = require('node:test'); // فقط ابزار mock (mocha مستقل از آن اجرا می‌شود)
const { ROLES, SYSTEM_ACTOR } = require('../../src/constants/roles');

const valid = () => ({
  actor: { userId: 'u1', role: ROLES.BARBER, shopId: 's1' },
  action: 'appointment.start',
  entityType: 'appointments',
  entityId: 'a1',
});

// سرویس و middleware به مدل مونگوس وابسته‌اند؛ بدون mongoose نصب‌شده skip می‌شوند.
let hasMongoose = true;
try {
  require.resolve('mongoose');
} catch {
  hasMongoose = false;
}
const itM = hasMongoose ? it : it.skip;

function loadAudit() {
  const { mockLogger } = require('../helpers/fakes');
  const logger = mockLogger();
  const AuditLog = require('../../src/models/AuditLog');
  const auditService = require('../../src/services/audit');
  const attachAudit = require('../../src/middlewares/audit');
  return { logger, AuditLog, auditService, attachAudit };
}

describe('سرویس و middleware ثبت لاگ', () => {
  afterEach(() => mock.restoreAll());

  itM('record سند ساخته‌شده را به مدل می‌دهد', async () => {
    const { AuditLog, auditService } = loadAudit();
    const create = mock.method(AuditLog, 'create', async (d) => ({ _id: 'x', ...d }));
    const out = await auditService.record(valid());
    assert.equal(create.mock.callCount(), 1);
    assert.equal(create.mock.calls[0].arguments[0].action, 'appointment.start');
    assert.equal(out._id, 'x');
  });

  itM('شکست نوشتن لاگ می‌شود و خطا دوباره پرتاب می‌شود', async () => {
    const { logger, AuditLog, auditService } = loadAudit();
    mock.method(AuditLog, 'create', async () => Promise.reject(new Error('db down')));
    await assert.rejects(auditService.record(valid()), /db down/);
    assert.equal(logger.calls[0].level, 'error');
  });

  itM('record ورودی نامعتبر را قبل از رسیدن به مدل رد می‌کند', async () => {
    const { AuditLog, auditService } = loadAudit();
    const create = mock.method(AuditLog, 'create', async () => ({}));
    await assert.rejects(auditService.record({ action: 'x' }), TypeError);
    assert.equal(create.mock.callCount(), 0);
  });

  itM('middleware: req.audit از req.auth و req.id و req.ip پر می‌کند', async () => {
    const { AuditLog, attachAudit } = loadAudit();
    const create = mock.method(AuditLog, 'create', async (d) => d);
    const req = { id: 'rid-1', ip: '9.9.9.9', auth: { userId: 'u9', role: ROLES.ADMIN, shopId: null } };
    attachAudit(req, {}, () => {});
    await req.audit({ action: 'service.approve', entityType: 'serviceRequests', entityId: 'sr1' });
    const saved = create.mock.calls[0].arguments[0];
    assert.equal(saved.actor.userId, 'u9');
    assert.equal(saved.actor.role, 'admin');
    assert.equal(saved.requestId, 'rid-1');
    assert.equal(saved.ip, '9.9.9.9');
  });

  itM('middleware: actor صریح بر req.auth غلبه می‌کند', async () => {
    const { AuditLog, attachAudit } = loadAudit();
    const create = mock.method(AuditLog, 'create', async (d) => d);
    const req = { id: 'r', auth: { userId: 'u1', role: ROLES.CUSTOMER } };
    attachAudit(req, {}, () => {});
    await req.audit({ actor: { role: SYSTEM_ACTOR }, action: 'a', entityType: 'b' });
    assert.equal(create.mock.calls[0].arguments[0].actor.role, 'system');
  });
});
