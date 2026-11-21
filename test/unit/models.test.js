'use strict';

// این تست‌ها به mongoose نیاز دارند (بدون اتصال به دیتابیس؛ فقط validateSync و تعریف ایندکس‌ها).
// اگر mongoose نصب نباشد skip می‌شوند.
const assert = require('node:assert/strict');

let mongoose;
try {
  mongoose = require('mongoose');
} catch {
  /* skip */
}
const itM = mongoose ? it : it.skip; // بدون mongoose نصب‌شده skip می‌شود

const oid = () => new mongoose.Types.ObjectId();
const errorPaths = (doc) => Object.keys(doc.validateSync()?.errors ?? {});

describe('مدل‌ها (اعتبارسنجی بدون دیتابیس)', () => {
  itM('همه مدل‌ها بارگذاری می‌شوند و ایندکس تکراری ندارند', () => {
    const models = require('../../src/models');
    for (const [name, Model] of Object.entries(models)) {
      const keys = Model.schema.indexes().map(([fields]) => JSON.stringify(fields));
      assert.equal(new Set(keys).size, keys.length, `${name}: duplicate index key pattern`);
    }
  });

  itM('نام کالکشن‌ها مطابق سند است', () => {
    const { AuditLog, Barber, ServiceCatalog } = require('../../src/models');
    assert.equal(AuditLog.collection.name, 'auditLogs');
    assert.equal(Barber.collection.name, 'barbers');
    assert.equal(ServiceCatalog.collection.name, 'serviceCatalog');
  });

  itM('User: موبایل نامعتبر، نقش پیش‌فرض و کد معرفی', () => {
    const { User } = require('../../src/models');
    assert.deepEqual(errorPaths(new User({ mobile: '12345' })), ['mobile']);
    const u = new User({ mobile: '09121234567' });
    assert.equal(u.validateSync(), undefined);
    assert.deepEqual([...u.roles], ['customer']);
    assert.match(u.referralCode, /^[A-Z2-9]{8}$/);
  });

  itM('User: خودمعرفی ممنوع', () => {
    const { User } = require('../../src/models');
    const _id = oid();
    assert.ok(errorPaths(new User({ _id, mobile: '09121234567', referredBy: _id })).includes('referredBy'));
  });

  itM('Shop: ساعت کاری نامعتبر و روز تکراری رد می‌شود', () => {
    const { Shop } = require('../../src/models');
    const base = { name: 'آرایشگاه تست', slug: 'test-shop' };
    assert.equal(new Shop(base).validateSync(), undefined);
    const badInterval = new Shop({ ...base, settings: { workingHours: [{ weekday: 0, intervals: [{ start: '18:00', end: '09:00' }] }] } });
    assert.ok(errorPaths(badInterval).length > 0);
    const dup = new Shop({ ...base, settings: { workingHours: [{ weekday: 1 }, { weekday: 1 }] } });
    assert.ok(errorPaths(dup).includes('settings.workingHours'));
  });

  itM('BarberService: فعال‌سازی بدون قیمت/مدت رد می‌شود؛ مدت باید مضرب ۵ باشد', () => {
    const { BarberService } = require('../../src/models');
    const base = { barberId: oid(), shopId: oid(), serviceId: oid() };
    assert.equal(new BarberService(base).validateSync(), undefined);
    assert.ok(errorPaths(new BarberService({ ...base, isActive: true })).includes('isActive'));
    assert.equal(new BarberService({ ...base, isActive: true, price: 200000, durationMinutes: 30 }).validateSync(), undefined);
    assert.ok(errorPaths(new BarberService({ ...base, price: 1, durationMinutes: 32 })).includes('durationMinutes'));
  });

  itM('ServiceCatalog: titleKey یکتا‌ساز ی/ک و فاصله را نرمال می‌کند', () => {
    const { ServiceCatalog } = require('../../src/models');
    const a = new ServiceCatalog({ title: 'اصلاح  سر' });
    const b = new ServiceCatalog({ title: 'اصلاح سر' });
    a.validateSync();
    b.validateSync();
    assert.equal(a.titleKey, b.titleKey);
  });

  itM('ServiceCatalog: با تغییر عنوان، titleKey هم عوض می‌شود (وگرنه یکتایی دور زده می‌شد)', () => {
    const { ServiceCatalog } = require('../../src/models');
    const doc = ServiceCatalog.hydrate({ _id: oid(), title: 'اصلاح سر', titleKey: 'اصلاح سر' });
    doc.title = 'اصلاح   ريش';
    doc.validateSync();
    assert.equal(doc.titleKey, 'اصلاح ریش');
  });

  itM('ServiceRequest: رد کردن بدون دلیل ممکن نیست', () => {
    const { ServiceRequest } = require('../../src/models');
    const base = { shopId: oid(), barberId: oid(), requestedBy: oid(), title: 'رنگ مو' };
    assert.equal(new ServiceRequest(base).validateSync(), undefined);
    assert.ok(errorPaths(new ServiceRequest({ ...base, status: 'rejected' })).includes('rejectReason'));
  });

  const appointmentBase = () => {
    const start = new Date('2026-11-10T06:00:00Z');
    return {
      shopId: oid(),
      barberId: oid(),
      serviceId: oid(),
      customerId: oid(),
      source: 'online',
      status: 'confirmed',
      dayKey: '2026-11-10',
      bookedStart: start,
      bookedEnd: new Date(start.getTime() + 30 * 60000),
      estimatedStart: start,
      estimatedEnd: new Date(start.getTime() + 30 * 60000),
      priceSnapshot: 200000,
      durationSnapshot: 30,
      depositAmount: 30000,
    };
  };

  itM('Appointment: نوبت معتبر', () => {
    const { Appointment } = require('../../src/models');
    assert.equal(new Appointment(appointmentBase()).validateSync(), undefined);
  });

  itM('Appointment: پایان قبل از شروع، و بیعانه بیشتر از قیمت رد می‌شود', () => {
    const { Appointment } = require('../../src/models');
    const b = appointmentBase();
    assert.ok(errorPaths(new Appointment({ ...b, bookedEnd: b.bookedStart })).includes('bookedEnd'));
    assert.ok(errorPaths(new Appointment({ ...b, depositAmount: 300000 })).includes('depositAmount'));
  });

  itM('Appointment: موقت بدون heldUntil و آنلاین بدون مشتری رد می‌شود', () => {
    const { Appointment } = require('../../src/models');
    const b = appointmentBase();
    assert.ok(errorPaths(new Appointment({ ...b, status: 'held' })).includes('heldUntil'));
    assert.equal(new Appointment({ ...b, status: 'held', heldUntil: new Date() }).validateSync(), undefined);
    assert.ok(errorPaths(new Appointment({ ...b, customerId: undefined })).includes('customerId'));
  });

  itM('Appointment: مشتری حضوری — نام یا حساب، نه هر دو؛ بدون موقت', () => {
    const { Appointment } = require('../../src/models');
    const b = { ...appointmentBase(), source: 'walkIn', status: 'arrived', depositAmount: 0 };
    assert.equal(new Appointment({ ...b, customerId: undefined, walkInName: 'رضا' }).validateSync(), undefined);
    assert.ok(errorPaths(new Appointment({ ...b, customerId: undefined })).includes('walkInName'));
    assert.ok(errorPaths(new Appointment({ ...b, walkInName: 'رضا' })).includes('walkInName'));
  });

  itM('Appointment: ایندکس‌های سد کمکی تعریف شده‌اند', () => {
    const { Appointment } = require('../../src/models');
    const named = Object.fromEntries(Appointment.schema.indexes().map(([f, o]) => [o.name, { f, o }]));
    assert.equal(named.one_hold_per_customer.o.unique, true);
    assert.equal(named.unique_active_start_per_barber.o.unique, true);
    assert.deepEqual(named.unique_active_start_per_barber.o.partialFilterExpression.status.$in, ['confirmed', 'arrived', 'inProgress']);
  });

  itM('Payment: مجموع کیف پول و درگاه باید برابر مبلغ باشد', () => {
    const { Payment } = require('../../src/models');
    const base = { appointmentId: oid(), customerId: oid(), amount: 30000, idempotencyKey: 'pay:1' };
    assert.ok(errorPaths(new Payment({ ...base, walletAmount: 10000 })).includes('amount'));
    assert.equal(new Payment({ ...base, walletAmount: 10000, gatewayAmount: 20000 }).validateSync(), undefined);
  });

  itM('WalletTransaction: قواعد حساب کاربر/پلتفرم و مبلغ صفر', () => {
    const { WalletTransaction } = require('../../src/models');
    const base = { type: 'commission', amount: 5000, idempotencyKey: 'commission:1' };
    assert.ok(errorPaths(new WalletTransaction(base)).includes('userId'));
    assert.equal(new WalletTransaction({ ...base, userId: oid() }).validateSync(), undefined);
    assert.equal(new WalletTransaction({ ...base, amount: -5000, account: 'platform' }).validateSync(), undefined);
    assert.ok(errorPaths(new WalletTransaction({ ...base, amount: 0, userId: oid() })).includes('amount'));
  });

  itM('Wallet: موجودی منفی رد می‌شود', () => {
    const { Wallet } = require('../../src/models');
    assert.ok(errorPaths(new Wallet({ userId: oid(), balance: -1 })).includes('balance'));
  });

  itM('Referral: خودمعرفی رد می‌شود', () => {
    const { Referral } = require('../../src/models');
    const id = oid();
    assert.ok(errorPaths(new Referral({ referrerId: id, refereeId: id, code: 'ABCDEFGH' })).includes('refereeId'));
  });

  itM('Survey: حداقل یک لیبل و بدون تکرار', () => {
    const { Survey } = require('../../src/models');
    const base = { appointmentId: oid(), customerId: oid(), shopId: oid(), barberId: oid() };
    assert.ok(errorPaths(new Survey({ ...base, labels: [] })).includes('labels'));
    assert.ok(errorPaths(new Survey({ ...base, labels: ['clean', 'clean'] })).includes('labels'));
    assert.equal(new Survey({ ...base, labels: ['clean', 'polite'] }).validateSync(), undefined);
  });

  itM('Settings: پیش‌فرض‌ها مطابق سند طراحی', () => {
    const { Settings } = require('../../src/models');
    const s = new Settings();
    assert.equal(s.depositPercent, 15);
    assert.equal(s.noShowGraceMinutes, 5);
    assert.equal(s.minBookingLeadMinutes, 15);
    assert.equal(s.holdMinutes, 10);
    assert.equal(s.cancelRefundHoursBefore, 2);
  });
});
