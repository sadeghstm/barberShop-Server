'use strict';

const crypto = require('node:crypto');
const { config } = require('../config');
const { redis } = require('../db/redis');

// در ردیس فقط هش توکن ذخیره می‌شود؛ حتی با دیدن ردیس نمی‌توان نشست جعل کرد
const keyOf = (token) => `session:${crypto.createHash('sha256').update(token).digest('hex')}`;

const ttlSeconds = () => config.sessionTtlDays * 24 * 60 * 60;

/** نشست جدید می‌سازد و توکن (برای کوکی) را برمی‌گرداند. */
async function create(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(keyOf(token), String(userId), 'EX', ttlSeconds());
  return token;
}

/** شناسه کاربر این توکن، یا null اگر نامعتبر/منقضی باشد. */
async function getUserId(token) {
  if (typeof token !== 'string' || token === '') return null;
  return redis.get(keyOf(token));
}

async function destroy(token) {
  if (typeof token === 'string' && token !== '') await redis.del(keyOf(token));
}

module.exports = { create, getUserId, destroy, ttlSeconds };
