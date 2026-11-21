'use strict';

const { createFakeModel } = require('./fakeModel');
const { createFakeRedis, isolateModules, mockLogger } = require('./fakes');
const { tehranDate } = require('../../src/helpers/schedule');

// ۱۹ آبان ۱۴۰۵ = سه‌شنبه (weekday 3). «الان» در تست‌ها ۰۸:۰۰ همان روز است.
const DAY = '2026-11-10';
const at = (hhmm, day = DAY) => tehranDate(day, hhmm);
const NOW = at('08:00');

// همان normalizeTitle مدل واقعی (مدل واقعی به mongoose نیاز دارد)
const normalizeTitle = (title) => String(title ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim().toLowerCase();

const ACTIVE_START_STATUSES = ['confirmed', 'arrived', 'inProgress'];

/**
 * دنیای ساختگی برای تست سرویس‌های رزرو: مدل‌های درون‌حافظه + ردیس ساختگی.
 *   const world = createWorld();           // در before
 *   world.restore();                        // در after
 *   const { shop, barber, customer } = world.reset();   // در beforeEach
 */
function createWorld() {
  mockLogger();
  const models = {
    Appointment: createFakeModel({
      defaults: () => ({ heldUntil: null, source: 'online' }),
      unique: [
        { name: 'one_hold_per_customer', fields: ['customerId'], when: (d) => d.status === 'held' && Boolean(d.customerId) },
        { name: 'unique_active_start_per_barber', fields: ['barberId', 'bookedStart'], when: (d) => ACTIVE_START_STATUSES.includes(d.status) },
      ],
    }),
    Payment: createFakeModel({
      defaults: () => ({ status: 'pending', failureReason: null, paidAt: null }),
      unique: [{ name: 'idempotencyKey_1', fields: ['idempotencyKey'] }],
    }),
    BarberService: createFakeModel(),
    ServiceCatalog: createFakeModel({
      defaults: () => ({ status: 'active', description: '', isDefault: false }),
      unique: [{ name: 'titleKey_1', fields: ['titleKey'] }],
      onCreate: (doc) => { doc.titleKey = normalizeTitle(doc.title); },
    }),
    ServiceRequest: createFakeModel({
      defaults: () => ({ status: 'pending', description: '', rejectReason: null, decidedBy: null, decidedAt: null, serviceId: null }),
    }),
    Barber: createFakeModel(),
    Shop: createFakeModel(),
    User: createFakeModel(),
    AuditLog: createFakeModel(),
    Settings: createFakeModel({
      defaults: () => ({
        depositPercent: 15,
        holdMinutes: 10,
        minBookingLeadMinutes: 15,
        noShowGraceMinutes: 5,
        delayNotifyThresholdMinutes: 10,
      }),
    }),
  };
  models.ServiceCatalog.normalizeTitle = normalizeTitle;
  const redis = createFakeRedis();

  const restore = isolateModules({
    'models/Appointment': models.Appointment,
    'models/Payment': models.Payment,
    'models/BarberService': models.BarberService,
    'models/ServiceCatalog': models.ServiceCatalog,
    'models/ServiceRequest': models.ServiceRequest,
    'models/Barber': models.Barber,
    'models/Shop': models.Shop,
    'models/AuditLog': models.AuditLog,
    'models/Settings': models.Settings,
    'models/User': models.User,
    'db/redis': { redis },
  });

  /** هر تست از صفر شروع می‌کند: یک آرایشگاه، یک آرایشگر، یک خدمت (۱۵۰٬۰۰۰ تومان، ۳۰ دقیقه) */
  async function reset() {
    for (const model of Object.values(models)) model.reset();
    redis.store.clear();

    const shop = await models.Shop.create({
      _id: 'shop1',
      name: 'آرایشگاه تست',
      isActive: true,
      settings: { workingHours: [{ weekday: 3, intervals: [{ start: '09:00', end: '12:00' }] }], holidays: [] },
    });
    const barber = await models.Barber.create({ _id: 'barber1', userId: 'u-barber', shopId: 'shop1', displayName: 'رضا', isActive: true });
    await models.ServiceCatalog.create({ _id: 'svc1', title: 'اصلاح سر', status: 'active' });
    await models.BarberService.create({ barberId: 'barber1', shopId: 'shop1', serviceId: 'svc1', price: 150000, durationMinutes: 30, isActive: true });
    return { shop, barber, serviceId: 'svc1' };
  }

  const customer = (id = 'c1') => ({ userId: id, role: 'customer', shopId: null });

  return { models, redis, restore, reset, customer };
}

module.exports = { createWorld, DAY, NOW, at };
