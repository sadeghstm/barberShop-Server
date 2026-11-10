'use strict';

const { ALL_ACTOR_ROLES } = require('../constants/roles');

// کلیدهای حساس هرگز وارد snapshot نمی‌شوند
const SENSITIVE_KEY = /^(pass(word|wd)?|otp(code)?|.*token|.*secret|api_?key)$/i;

function redact(node) {
  if (Array.isArray(node)) return node.map(redact);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(value);
    }
    return out;
  }
  return node;
}

/** سند mongoose یا هر مقدار دلخواه را به JSON ساده تبدیل می‌کند (ObjectId و Date → رشته) و کلیدهای حساس را پنهان می‌کند. */
function toSnapshot(value) {
  if (value === undefined || value === null) return null;
  const plain = typeof value.toObject === 'function' ? value.toObject() : value;
  const json = JSON.stringify(plain);
  return json === undefined ? null : redact(JSON.parse(json));
}

/** ورودی خام را به سندی که در auditLogs ذخیره می‌شود تبدیل و اعتبارسنجی می‌کند. */
function buildEntry(entry) {
  const { actor, action, entityType, entityId = null, before, after, meta, requestId, ip } = entry ?? {};

  if (!actor || !ALL_ACTOR_ROLES.includes(actor.role)) {
    throw new TypeError('audit: actor.role is missing or invalid');
  }
  if (typeof action !== 'string' || action.trim() === '') {
    throw new TypeError('audit: action is required');
  }
  if (typeof entityType !== 'string' || entityType.trim() === '') {
    throw new TypeError('audit: entityType is required');
  }

  return {
    actor: { userId: actor.userId ?? null, role: actor.role, shopId: actor.shopId ?? null },
    action: action.trim(),
    entityType: entityType.trim(),
    entityId: entityId ?? null,
    before: toSnapshot(before),
    after: toSnapshot(after),
    meta: toSnapshot(meta),
    requestId: requestId ?? null,
    ip: ip ?? null,
  };
}

module.exports = { buildEntry, toSnapshot };
