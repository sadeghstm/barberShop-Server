'use strict';

// کیف پول و دفتر کل (۵.۶ و ۵.۷): موجودی اتمیک، بدون منفی‌شدن، تراکنش‌های idempotent،
// پورسانت معرف و خنثی‌سازی آن.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { oid, fakeModel } = require('./helpers/fakeModels');
const { stubModule } = require('./helpers/fakes');

const models = {
  Wallet: fakeModel({ defaults: { balance: 0 } }),
  WalletTransaction: fakeModel(),
};
for (const [name, model] of Object.entries(models)) stubModule(`models/${name}`, model);

const walletService = require('../src/services/wallet');

const userId = oid();

beforeEach(() => {
  models.Wallet.rows.length = 0;
  models.WalletTransaction.rows.length = 0;
});

test('افزایش موجودی و ثبت balanceAfter', async () => {
  const { transaction, duplicated } = await walletService.applyTransaction({
    userId,
    type: 'depositRefund',
    amount: 30000,
    idempotencyKey: 'refund:1',
  });
  assert.equal(duplicated, false);
  assert.equal(transaction.balanceAfter, 30000);
  assert.equal(await walletService.getBalance(userId), 30000);
});

test('همان idempotencyKey دوبار اثر نمی‌گذارد', async () => {
  await walletService.applyTransaction({ userId, type: 'depositRefund', amount: 30000, idempotencyKey: 'refund:1' });
  const second = await walletService.applyTransaction({
    userId,
    type: 'depositRefund',
    amount: 30000,
    idempotencyKey: 'refund:1',
  });
  assert.equal(second.duplicated, true);
  assert.equal(await walletService.getBalance(userId), 30000);
  assert.equal(models.WalletTransaction.rows.length, 1);
});

test('موجودی منفی نمی‌شود و تراکنش ثبت نمی‌گردد', async () => {
  await walletService.applyTransaction({ userId, type: 'depositRefund', amount: 10000, idempotencyKey: 'in:1' });
  await assert.rejects(
    () => walletService.applyTransaction({ userId, type: 'spend', amount: -15000, idempotencyKey: 'spend:1' }),
    (err) => err.statusCode === 409,
  );
  assert.equal(await walletService.getBalance(userId), 10000);
  assert.equal(models.WalletTransaction.rows.length, 1);
});

test('مبلغ صفر یا اعشاری رد می‌شود', async () => {
  for (const amount of [0, 1.5, null]) {
    await assert.rejects(
      () => walletService.applyTransaction({ userId, type: 'adjustment', amount, idempotencyKey: `bad:${amount}` }),
      (err) => err.statusCode === 422,
    );
  }
});

test('پورسانت معرف: افزایش کیف پول معرف + کسر از حساب پلتفرم', async () => {
  const appointmentId = oid();
  const referrerId = oid();
  await walletService.creditCommission({ referrerId, amount: 40000, appointmentId });

  assert.equal(await walletService.getBalance(referrerId), 40000);
  const platform = models.WalletTransaction.rows.find((t) => t.account === 'platform');
  assert.equal(platform.amount, -40000);
  assert.equal(platform.idempotencyKey, `commission-platform:${appointmentId}`);

  // فراخوانی دوباره (مثلاً job تکراری) موجودی را دوباره زیاد نمی‌کند
  await walletService.creditCommission({ referrerId, amount: 40000, appointmentId });
  assert.equal(await walletService.getBalance(referrerId), 40000);
});

test('برگشت پورسانت با مبلغ همان تراکنش اصلی و به‌صورت idempotent', async () => {
  const appointmentId = oid();
  const referrerId = oid();
  await walletService.creditCommission({ referrerId, amount: 40000, appointmentId });

  await walletService.reverseCommissionForAppointment({ appointmentId });
  assert.equal(await walletService.getBalance(referrerId), 0);

  const reversal = models.WalletTransaction.rows.find((t) => t.type === 'commissionReversal' && t.account === 'user');
  assert.equal(reversal.amount, -40000);

  await walletService.reverseCommissionForAppointment({ appointmentId });
  assert.equal(await walletService.getBalance(referrerId), 0);
  assert.equal(
    models.WalletTransaction.rows.filter((t) => t.idempotencyKey === `commission-reversal:${appointmentId}`).length,
    1,
  );
});

test('برگشت پورسانت برای نوبت بدون پورسانت کاری نمی‌کند', async () => {
  const result = await walletService.reverseCommissionForAppointment({ appointmentId: oid() });
  assert.equal(result, null);
  assert.equal(models.WalletTransaction.rows.length, 0);
});
