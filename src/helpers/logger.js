'use strict';

const { config } = require('../config');
const { getContext } = require('../middlewares/requestContext');

// لاگر ساده JSON-lines بدون وابستگی. رابطش (debug/info/warn/error/child) مثل pino است
// تا در صورت نیاز بعداً فقط همین فایل عوض شود.

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  const out = { type: err.name, message: err.message, stack: err.stack };
  if (err.code !== undefined) out.code = err.code;
  if (err.cause) out.cause = serializeError(err.cause);
  return out;
}

function safeStringify(record) {
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({
      level: record.level,
      time: record.time,
      msg: record.msg,
      logError: 'unserializable log payload',
    });
  }
}

/**
 * استفاده:
 *   logger.info('پیام')
 *   logger.info({ appointmentId }, 'پیام')
 *   logger.error(err, 'پیام')            // یا logger.error({ err }, 'پیام')
 *
 * getContext: هر بار فراخوانی می‌شود و فیلدهایش (مثل requestId) به هر خط اضافه می‌شود.
 */
function createLogger({
  level = 'info',
  base = {},
  stream = process.stdout,
  getContext = () => ({}),
  now = () => new Date(),
} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const build = (bindings) => {
    const emit = (levelName, args) => {
      if (LEVELS[levelName] < threshold) return;

      const [first, second] = args;
      let fields = {};
      let msg;
      if (first instanceof Error) {
        fields = { err: serializeError(first) };
        msg = second;
      } else if (first !== null && typeof first === 'object') {
        fields = { ...first };
        if (fields.err instanceof Error) fields.err = serializeError(fields.err);
        msg = second;
      } else {
        msg = first;
      }

      const record = {
        ...base,
        ...bindings,
        ...getContext(),
        ...fields,
        level: levelName,
        time: now().toISOString(),
      };
      if (msg !== undefined) record.msg = msg;
      stream.write(`${safeStringify(record)}\n`);
    };

    return {
      debug: (...args) => emit('debug', args),
      info: (...args) => emit('info', args),
      warn: (...args) => emit('warn', args),
      error: (...args) => emit('error', args),
      child: (extra) => build({ ...bindings, ...extra }),
    };
  };

  return build({});
}

// لاگر آماده برای کل برنامه:  const { logger } = require('../helpers/logger')
// (requestId هر درخواست خودکار به هر خط اضافه می‌شود)
const logger = createLogger({
  level: config.logLevel,
  base: { app: 'barbershop-api' },
  getContext,
});

module.exports = { logger, createLogger, serializeError, LEVELS };
