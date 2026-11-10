'use strict';

const auditService = require('../services/audit');

/**
 * req.audit(entry) را اضافه می‌کند؛ actor و requestId و ip را خودش از درخواست پر می‌کند.
 * استفاده در کنترلرها:
 *   await req.audit({ action: 'appointment.cancel', entityType: 'appointments', entityId, before, after });
 *
 * قرارداد با احراز هویت (گام ۳): آن middleware باید req.auth = { userId, role, shopId } بگذارد.
 * تا آن موقع می‌توان actor را صریح داد: req.audit({ actor: {...}, ... })
 */
function attachAudit(req, res, next) {
  req.audit = (entry) =>
    auditService.record({
      ...entry,
      actor: entry.actor ?? req.auth,
      requestId: entry.requestId ?? req.id,
      ip: entry.ip ?? req.ip,
    });
  next();
}

module.exports = attachAudit;
