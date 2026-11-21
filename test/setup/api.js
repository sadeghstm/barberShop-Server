'use strict';

// قبل و بعد از تست‌های API: اتصال به مونگو/ردیس تست و پاک‌سازی بین تست‌ها.
const { config } = require('../../src/config');
const models = require('../../src/models');
const { connectMongo, disconnectMongo } = require('../../src/db/mongo');
const { redis, connectRedis, closeRedis } = require('../../src/db/redis');

// جلوگیری از پاک شدن دیتابیس واقعی
function assertSafeTestDatabases() {
  const mongoDb = new URL(config.mongoUri).pathname.replace('/', '');
  const redisDb = Number(new URL(config.redisUrl).pathname.replace('/', '') || 0);
  if (!mongoDb.endsWith('test')) {
    throw new Error(`MONGO_URI باید به یک دیتابیس تست اشاره کند (نام باید به test ختم شود)، الان: "${mongoDb}". فایل .env.test را بسازید.`);
  }
  if (redisDb === 0) {
    throw new Error('REDIS_URL باید شماره دیتابیس غیر از صفر داشته باشد (مثلاً redis://127.0.0.1:6379/1). فایل .env.test را بسازید.');
  }
}

exports.mochaHooks = {
  async beforeAll() {
    assertSafeTestDatabases();
    await connectMongo();
    await connectRedis();
    // ایندکس‌ها (مثل یکتا بودن موبایل) ساخته شده باشند
    await Promise.all(Object.values(models).map((Model) => Model.init()));
  },

  async beforeEach() {
    // collection خام: auditLogs از طریق مدل قابل پاک شدن نیست (فقط‌افزودنی)
    await Promise.all(Object.values(models).map((Model) => Model.collection.deleteMany({})));
    await redis.flushdb();
  },

  async afterAll() {
    await disconnectMongo();
    await closeRedis();
    
  },
};
