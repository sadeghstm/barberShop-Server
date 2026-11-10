'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NODE_ENVS = ['development', 'test', 'production'];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];

const DEV_DEFAULTS = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/barbershop',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

/**
 * تابع خالص: env را می‌گیرد و پیکربندی معتبر و freeze‌شده برمی‌گرداند.
 * همه خطاها یک‌جا گزارش می‌شوند تا مجبور نشوید یکی‌یکی رفعشان کنید.
 */
function loadConfig(env = process.env) {
  const errors = [];

  const nodeEnv = env.NODE_ENV || 'development';
  if (!NODE_ENVS.includes(nodeEnv)) {
    errors.push(`NODE_ENV must be one of: ${NODE_ENVS.join(', ')}`);
  }
  const isProd = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const int = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${name} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return n;
  };

  const connectionString = (name) => {
    const raw = env[name];
    if (raw) return raw;
    if (isProd) {
      errors.push(`${name} is required in production`);
      return undefined;
    }
    return DEV_DEFAULTS[name];
  };

  const logLevel = env.LOG_LEVEL || (isTest ? 'silent' : isProd ? 'info' : 'debug');
  if (!LOG_LEVELS.includes(logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  const config = {
    env: nodeEnv,
    isProd,
    isTest,
    port: int('PORT', 3000, { min: 0, max: 65535 }),
    mongoUri: connectionString('MONGO_URI'),
    redisUrl: connectionString('REDIS_URL'),
    logLevel,
    bodyLimit: env.BODY_LIMIT || '100kb',
    trustProxy: int('TRUST_PROXY', 0, { max: 10 }),
    shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10000, { min: 1000 }),
    corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173', // آدرس فرانت‌اند (Vue)
    sessionTtlDays: int('SESSION_TTL_DAYS', 7, { min: 1, max: 90 }),
    // کد ثابت OTP فقط در development/test (گام ۳ سند)؛ در production همیشه تصادفی است
    devOtpCode: isProd ? undefined : env.DEV_OTP_CODE || '12345',
  };

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }
  return Object.freeze(config);
}

// .env (اگر بود) خوانده می‌شود؛ متغیرهای محیطِ از پیش تنظیم‌شده را بازنویسی نمی‌کند
const envFile = path.resolve(__dirname, '../.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// در بقیه برنامه فقط:  const { config } = require('./config')
module.exports = { config: loadConfig(process.env), loadConfig };
