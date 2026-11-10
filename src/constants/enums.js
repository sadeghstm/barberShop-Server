'use strict';

const freeze = (o) => Object.freeze(o);
const values = (o) => Object.freeze(Object.values(o));

// وضعیت‌های نوبت (بخش ۵.۲ سند)
const APPOINTMENT_STATUS = freeze({
  HELD: 'held', // «موقت»
  CONFIRMED: 'confirmed',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  NO_SHOW: 'noShow',
});

// بازه‌ای که برای آرایشگر اشغال است. held منقضی‌شده را فراخواننده با heldUntil کنار می‌گذارد.
const BLOCKING_STATUSES = freeze([
  APPOINTMENT_STATUS.HELD,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.ARRIVED,
  APPOINTMENT_STATUS.IN_PROGRESS,
]);

// noShow برای رزرو آنلاین بسته می‌ماند ولی برای مشتری حضوری آزاد است (بخش ۵.۳)
const ONLINE_BLOCKING_STATUSES = freeze([...BLOCKING_STATUSES, APPOINTMENT_STATUS.NO_SHOW]);

const APPOINTMENT_SOURCE = freeze({ ONLINE: 'online', WALK_IN: 'walkIn' });

const CANCEL_REQUEST_STATUS = freeze({ PENDING: 'pending', ACCEPTED: 'accepted', REJECTED: 'rejected' });

const CATALOG_STATUS = freeze({ ACTIVE: 'active', REMOVING: 'removing', ARCHIVED: 'archived' });

const SERVICE_REQUEST_STATUS = freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });

const PAYMENT_STATUS = freeze({ PENDING: 'pending', SUCCEEDED: 'succeeded', FAILED: 'failed' });
const PAYMENT_PROVIDER = freeze({ MOCK: 'mock' });

const REFUND_DESTINATION = freeze({ WALLET: 'wallet', BANK: 'bank' }); // bank فعلاً mock
const REFUND_STATUS = freeze({ PENDING: 'pending', DONE: 'done', FAILED: 'failed' });

const WALLET_TX_TYPE = freeze({
  DEPOSIT_REFUND: 'depositRefund',
  COMMISSION: 'commission',
  COMMISSION_REVERSAL: 'commissionReversal',
  SPEND: 'spend',
  ADJUSTMENT: 'adjustment',
});
const WALLET_ACCOUNT = freeze({ USER: 'user', PLATFORM: 'platform' });

const LICENSE_STATUS = freeze({ DISABLED: 'disabled' }); // استعلام پروانه در بک‌لاگ است

module.exports = {
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUSES: values(APPOINTMENT_STATUS),
  BLOCKING_STATUSES,
  ONLINE_BLOCKING_STATUSES,
  APPOINTMENT_SOURCE,
  APPOINTMENT_SOURCES: values(APPOINTMENT_SOURCE),
  CANCEL_REQUEST_STATUS,
  CANCEL_REQUEST_STATUSES: values(CANCEL_REQUEST_STATUS),
  CATALOG_STATUS,
  CATALOG_STATUSES: values(CATALOG_STATUS),
  SERVICE_REQUEST_STATUS,
  SERVICE_REQUEST_STATUSES: values(SERVICE_REQUEST_STATUS),
  PAYMENT_STATUS,
  PAYMENT_STATUSES: values(PAYMENT_STATUS),
  PAYMENT_PROVIDER,
  PAYMENT_PROVIDERS: values(PAYMENT_PROVIDER),
  REFUND_DESTINATION,
  REFUND_DESTINATIONS: values(REFUND_DESTINATION),
  REFUND_STATUS,
  REFUND_STATUSES: values(REFUND_STATUS),
  WALLET_TX_TYPE,
  WALLET_TX_TYPES: values(WALLET_TX_TYPE),
  WALLET_ACCOUNT,
  WALLET_ACCOUNTS: values(WALLET_ACCOUNT),
  LICENSE_STATUS,
  LICENSE_STATUSES: values(LICENSE_STATUS),
};
