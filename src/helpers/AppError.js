'use strict';

/**
 * خطای «عملیاتی» که پیامش برای کلاینت امن است (مثل ۴۰۴ یا تداخل نوبت).
 * هر خطای دیگری (باگ، قطع دیتابیس، ...) در errorHandler به ۵۰۰ عمومی تبدیل می‌شود.
 * `code` پایدار و انگلیسی است تا فرانت‌اند به آن تکیه کند؛ `message` فارسی و قابل نمایش است.
 */
class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details, cause, isOperational = true } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message = 'درخواست نامعتبر است', details) {
    return new AppError(message, { statusCode: 400, code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'ابتدا وارد شوید') {
    return new AppError(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }

  static forbidden(message = 'اجازه این کار را ندارید') {
    return new AppError(message, { statusCode: 403, code: 'FORBIDDEN' });
  }

  static notFound(message = 'یافت نشد') {
    return new AppError(message, { statusCode: 404, code: 'NOT_FOUND' });
  }

  static conflict(message = 'تداخل با وضعیت فعلی', details) {
    return new AppError(message, { statusCode: 409, code: 'CONFLICT', details });
  }

  static tooManyRequests(message = 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید') {
    return new AppError(message, { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
  }

  static validation(message = 'داده‌های ورودی معتبر نیستند', details) {
    return new AppError(message, { statusCode: 422, code: 'VALIDATION_ERROR', details });
  }
}

module.exports = { AppError };
