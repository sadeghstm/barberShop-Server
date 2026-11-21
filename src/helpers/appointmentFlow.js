'use strict';

const { AppError } = require('./AppError');
const { APPOINTMENT_STATUS: S } = require('../constants/enums');

/**
 * ماشین وضعیت کارهای روزِ آرایشگر (۵.۲ سند). هر کار: از کدام وضعیت‌ها، به کدام وضعیت.
 *   «شروع خدمت» اگر حضور ثبت نشده باشد، حضور را هم همزمان ثبت می‌کند.
 * (لغو و درخواست لغو در فاز ۲؛ منقضی‌شدن موقت در سرویس رزرو.)
 */
const ACTIONS = Object.freeze({
  arrive: { from: [S.CONFIRMED], to: S.ARRIVED },
  start: { from: [S.CONFIRMED, S.ARRIVED], to: S.IN_PROGRESS },
  complete: { from: [S.IN_PROGRESS], to: S.COMPLETED },
  noShow: { from: [S.CONFIRMED], to: S.NO_SHOW },
});

const PERSIAN = Object.freeze({
  [S.HELD]: 'موقت',
  [S.CONFIRMED]: 'تایید شده',
  [S.ARRIVED]: 'حاضر شده',
  [S.IN_PROGRESS]: 'در حال انجام',
  [S.COMPLETED]: 'تکمیل شده',
  [S.EXPIRED]: 'منقضی',
  [S.CANCELLED]: 'لغو شده',
  [S.NO_SHOW]: 'عدم حضور',
});

/** وضعیت بعدی را برمی‌گرداند یا ۴۰۹ INVALID_TRANSITION. */
function nextStatus(action, from) {
  const rule = ACTIONS[action];
  if (!rule) throw new TypeError(`کار ناشناخته: ${action}`);
  if (!rule.from.includes(from)) {
    throw AppError.conflict(`از وضعیت «${PERSIAN[from] ?? from}» این کار ممکن نیست`, { from, action }, 'INVALID_TRANSITION');
  }
  return rule.to;
}

module.exports = { ACTIONS, PERSIAN, nextStatus };
