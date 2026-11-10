'use strict';

// معرفی دوستان (۵.۷): کد یکتا برای هر کاربر، فقط یک معرف، خودمعرفی ممنوع،
// ثبت پیوند در referrals و پورسانت در کیف پول معرف.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { oid, fakeModel } = require('./helpers/fakeModels');
const { stubModule, mockLogger } = require('./helpers/fakes');

mockLogger();

const models = {
  User: fakeModel(),
  Referral: fakeModel(),
  Wallet: fakeModel({ defaults: { balance: 0 } }),
  WalletTransaction: fakeModel(),
  AuditLog: fakeModel(),
};
for (const [name, model] of Object.entries(models)) stubModule(`models/${name}`, model);
stubModule('services/audit', { record: async () => ({}) });

const referralService = require('../src/services/referral');

const referrerId = oid();
const newcomerId = oid();

beforeEach(() => {
  for (const model of Object.values(models)) model.rows.length = 0;
  models.User.rows.push(
    models.User.hydrate({ _id: referrerId, mobile: '09120000001', referralCode: 'REF12345', referredBy: null, isActive: true }),
  );
  models.User.rows.push(
    models.User.hydrate({ _id: newcomerId, mobile: '09120000002', referralCode: 'NEW12345', referredBy: null, isActive: true }),
  );
});

test('ثبت کد معرف: referredBy و پیوند referrals ساخته می‌شود', async () => {
  const result = await referralService.applyReferralCode({ userId: newcomerId, code: 'ref12345' });
  assert.equal(String(result.referredBy), String(referrerId));

  const user = models.User.rows.find((u) => String(u._id) === String(newcomerId));
  assert.equal(String(user.referredBy), String(referrerId));
  assert.equal(models.Referral.rows.length, 1);
  assert.equal(models.Referral.rows[0].code, 'REF12345');
});

test('کد معرف فقط یک‌بار قابل ثبت است', async () => {
  await referralService.applyReferralCode({ userId: newcomerId, code: 'REF12345' });
  await assert.rejects(
    () => referralService.applyReferralCode({ userId: newcomerId, code: 'REF12345' }),
    (err) => err.statusCode === 409,
  );
  assert.equal(models.Referral.rows.length, 1);
});

test('خودمعرفی و کد نامعتبر رد می‌شود', async () => {
  await assert.rejects(
    () => referralService.applyReferralCode({ userId: referrerId, code: 'REF12345' }),
    (err) => err.statusCode === 422,
  );
  await assert.rejects(
    () => referralService.applyReferralCode({ userId: newcomerId, code: 'NOPE1234' }),
    (err) => err.statusCode === 404,
  );
});

test('اطلاعات معرفی: تعداد دعوت‌شده، لینک و مجموع پورسانت', async () => {
  await referralService.applyReferralCode({ userId: newcomerId, code: 'REF12345' });
  models.WalletTransaction.rows.push(
    models.WalletTransaction.hydrate({ userId: referrerId, type: 'commission', amount: 5000, refId: oid() }),
    models.WalletTransaction.hydrate({ userId: referrerId, type: 'commission', amount: 2500, refId: oid() }),
    models.WalletTransaction.hydrate({ userId: referrerId, type: 'commissionReversal', amount: -2500, refId: oid() }),
  );

  const info = await referralService.getMyReferralInfo(referrerId);
  assert.equal(info.referralCode, 'REF12345');
  assert.equal(info.invitedCount, 1);
  assert.equal(info.totalCommission, 7500); // فقط پورسانت‌های مثبت
  assert.match(info.referralLink, /ref=REF12345$/);
  assert.equal(info.commissionHistory.length, 2); // برگشت پورسانت جدا ثبت می‌شود
});

test('کیف پول من: موجودی و تراکنش‌ها', async () => {
  models.Wallet.rows.push(models.Wallet.hydrate({ userId: referrerId, balance: 7500 }));
  models.WalletTransaction.rows.push(
    models.WalletTransaction.hydrate({ userId: referrerId, type: 'commission', amount: 5000, balanceAfter: 5000 }),
  );
  const wallet = await referralService.getMyWallet(referrerId);
  assert.equal(wallet.balance, 7500);
  assert.equal(wallet.transactions.length, 1);
});
