'use strict';

const { config } = require('../config');
const { logger } = require('../helpers/logger');
const { AppError } = require('../helpers/AppError');

/** هر چیزی که throw شد را به AppError تبدیل می‌کند؛ ناشناخته‌ها ۵۰۰ عمومی می‌شوند. */
function normalizeError(err) {
  if (err instanceof AppError) return err;

  if (!(err instanceof Error)) {
    return new AppError('خطای داخلی سرور', { statusCode: 500, isOperational: false, cause: new Error(String(err)) });
  }

  // body-parser
  if (err.type === 'entity.parse.failed') {
    return AppError.badRequest('بدنه درخواست JSON معتبر نیست');
  }
  if (err.type === 'entity.too.large') {
    return new AppError('حجم درخواست بیش از حد مجاز است', { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
  }

  // mongoose / mongodb (با نام و کد تشخیص می‌دهیم تا این فایل به mongoose وابسته نشود)
  if (err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') {
    const details = Object.entries(err.errors).map(([field, e]) => ({ field, message: e.message }));
    return AppError.validation(undefined, details);
  }
  if (err.name === 'CastError') {
    return AppError.badRequest(`مقدار نامعتبر برای ${err.path ?? 'فیلد'}`);
  }
  if (err.code === 11000) {
    return AppError.conflict('مقدار تکراری است', { fields: Object.keys(err.keyPattern ?? {}) });
  }

  return new AppError('خطای داخلی سرور', { statusCode: 500, isOperational: false, cause: err });
}

function notFoundHandler(req, res, next) {
  next(AppError.notFound(`مسیر ${req.method} ${req.path} یافت نشد`));
}

// امضای ۴پارامتری برای شناسایی به‌عنوان error middleware در express الزامی است
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const normalized = normalizeError(err);

  if (normalized.statusCode >= 500) {
    logger.error({ err: normalized.cause ?? normalized, code: normalized.code }, 'unhandled error');
  } else {
    logger.warn({ code: normalized.code, status: normalized.statusCode }, normalized.message);
  }

  const body = {
    error: { code: normalized.code, message: normalized.message, requestId: req.id },
  };
  if (normalized.details !== undefined) body.error.details = normalized.details;
  if (!config.isProd && !normalized.isOperational) {
    body.error.stack = (normalized.cause ?? normalized).stack;
  }

  res.status(normalized.statusCode).json(body);
}

module.exports = { normalizeError, notFoundHandler, errorHandler };
