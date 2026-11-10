'use strict';

/**
 * قرارداد با مرحله احراز هویت (گام ۳): middleware احراز هویت باید این را روی درخواست بگذارد:
 *   req.auth = { userId, role, shopId }
 * تا آن مرحله، فراخواننده می‌تواند actor را صریح بدهد: req.audit({ actor: {...}, ... }).
 */
function actorFromRequest(req) {
  const auth = req.auth;
  if (!auth) return undefined;
  return { userId: auth.userId, role: auth.role, shopId: auth.shopId };
}

/**
 * req.audit(entry) را اضافه می‌کند؛ actor و requestId و ip را خودش از درخواست پر می‌کند.
 * استفاده در کنترلرها:
 *   await req.audit({ action: 'appointment.cancel', entityType: 'appointments', entityId, before, after });
 */
function createAuditMiddleware({ auditService }) {
  return function attachAudit(req, res, next) {
    req.audit = (entry) =>
      auditService.record({
        ...entry,
        actor: entry.actor ?? actorFromRequest(req),
        requestId: entry.requestId ?? req.id,
        ip: entry.ip ?? req.ip,
      });
    next();
  };
}

module.exports = { createAuditMiddleware, actorFromRequest };
