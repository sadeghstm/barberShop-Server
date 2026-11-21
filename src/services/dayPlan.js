'use strict';

const Appointment = require('../models/Appointment');
const Shop = require('../models/Shop');
const settingsService = require('./settings');
const auditService = require('./audit');
const { withLock } = require('./lock');
const { logger } = require('../helpers/logger');
const { computeEstimateChanges, shiftMinutes } = require('../helpers/estimates');
const { workingIntervalsOf } = require('../helpers/schedule');
const { APPOINTMENT_STATUS: S } = require('../constants/enums');

const CHAIN_STATUSES = [S.HELD, S.CONFIRMED, S.ARRIVED, S.IN_PROGRESS, S.COMPLETED];

/**
 * زمان پیش‌بینی‌شده‌ی نوبت‌های «همان آرایشگر و همان روز» را دوباره حساب و ذخیره می‌کند (۵.۴ سند).
 * بعد از شروع خدمت، پایان خدمت و عدم حضور صدا زده می‌شود. زیر همان قفل رزرو اجرا می‌شود.
 * actor: req.auth یا { role: 'system' }
 *
 * خروجی: { changed, notify, overflow }
 *  - changed: همه‌ی نوبت‌های تغییرکرده
 *  - notify: آن‌هایی که بیش از آستانه (delayNotifyThresholdMinutes) تغییر کرده‌اند (پیامک در فاز ۲ وصل می‌شود)
 *  - overflow: آن‌هایی که پایانشان از ساعت کاری می‌گذرد (هشدار به مالک)
 */
async function recalculateDay({ barberId, dayKey, actor, now = new Date() }) {
  return withLock(`lock:booking:${barberId}:${dayKey}`, async () => {
    const rows = await Appointment.find({ barberId, dayKey, status: { $in: CHAIN_STATUSES } });
    const changes = computeEstimateChanges(rows, now);
    if (changes.length === 0) return { changed: [], notify: [], overflow: [] };

    const settings = await settingsService.get();
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const shop = await Shop.findById(rows[0].shopId);
    const intervals = shop ? workingIntervalsOf(dayKey, shop.settings.workingHours, shop.settings.holidays) : [];

    const notify = [];
    const overflow = [];
    for (const change of changes) {
      // شرط status یعنی اگر همین لحظه وضعیت نوبت عوض شده، دست نمی‌زنیم
      await Appointment.findOneAndUpdate(
        { _id: change.id, status: change.status },
        { estimatedStart: change.after.start, estimatedEnd: change.after.end },
      );

      const shift = shiftMinutes(change);
      const tooLate = Math.abs(shift) > settings.delayNotifyThresholdMinutes;
      const row = byId.get(String(change.id));
      const interval = intervals.find((i) => row.bookedStart >= i.start && row.bookedStart < i.end);
      const beyondHours = Boolean(interval) && change.after.end > interval.end;

      if (tooLate) notify.push(change.id);
      if (beyondHours) overflow.push(change.id);

      await auditService.record({
        actor,
        action: 'appointment.estimate',
        entityType: 'appointments',
        entityId: change.id,
        before: { estimatedStart: change.before.start, estimatedEnd: change.before.end },
        after: { estimatedStart: change.after.start, estimatedEnd: change.after.end },
        meta: { shiftMinutes: shift, notify: tooLate, beyondWorkingHours: beyondHours },
      });
    }
    if (notify.length > 0) logger.info({ barberId, dayKey, count: notify.length }, 'delay notifications pending (sms queue: phase 2)');
    if (overflow.length > 0) logger.warn({ barberId, dayKey, count: overflow.length }, 'estimated end beyond working hours');

    return { changed: changes.map((c) => c.id), notify, overflow };
  });
}

module.exports = { recalculateDay };
