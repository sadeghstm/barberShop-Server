'use strict';

const assert = require('node:assert/strict');
const { newClient, loginAs } = require('./helpers');
const { User, AuditLog } = require('../../src/models');

describe('PATCH /api/users/me', () => {
  it('کاربر نام خودش را تنظیم می‌کند و در /me دیده می‌شود', async () => {
    const client = await loginAs('09121234567');
    const res = await client.patch('/api/users/me').send({ name: 'سینا رضایی' }).expect(200);
    assert.equal(res.body.user.name, 'سینا رضایی');

    assert.equal((await client.get('/api/auth/me')).body.user.name, 'سینا رضایی');
    assert.equal((await User.findOne({ mobile: '09121234567' })).name, 'سینا رضایی');
    assert.ok(await AuditLog.findOne({ action: 'user.update' }));
  });

  it('فقط name تغییر می‌کند، نه موبایل یا نقش', async () => {
    const client = await loginAs('09121234567');
    await client.patch('/api/users/me').send({ name: 'سینا', mobile: '09999999999', roles: ['superAdmin'] }).expect(200);
    const user = await User.findOne({ mobile: '09121234567' });
    assert.deepEqual([...user.roles], ['customer']);
    assert.equal(await User.countDocuments({ mobile: '09999999999' }), 0);
  });

  it('بدون ورود ۴۰۱؛ نام نامعتبر ۴۲۲', async () => {
    await newClient().patch('/api/users/me').send({ name: 'سینا' }).expect(401);
    const client = await loginAs('09121234567');
    await client.patch('/api/users/me').send({ name: 'س' }).expect(422);
    await client.patch('/api/users/me').send({}).expect(422);
  });
});
