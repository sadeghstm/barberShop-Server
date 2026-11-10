'use strict';

const AuditLog = require('../models/AuditLog');
const { logger } = require('../helpers/logger');
const { buildEntry } = require('../helpers/auditEntry');

/**
 * یک خط در auditLogs می‌نویسد (بخش ۵.۱۰ سند طراحی).
 * entry: { actor: { userId, role, shopId }, action, entityType, entityId, before, after, meta, requestId, ip }
 * اگر نوشتن شکست بخورد خطا پرتاب می‌شود؛ اینکه عملیات اصلی ادامه یابد یا نه با فراخواننده است.
 */
async function record(entry) {
  const doc = buildEntry(entry);
  try {
    return await AuditLog.create(doc);
  } catch (err) {
    logger.error({ err, action: doc.action, entityType: doc.entityType }, 'audit write failed');
    throw err;
  }
}

module.exports = { record };
