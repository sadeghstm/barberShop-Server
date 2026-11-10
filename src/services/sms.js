'use strict';

const { config } = require('../config');
const { logger } = require('../helpers/logger');

/**
 * ارسال پیامک. سرویس‌دهنده بعداً مشخص می‌شود (بخش ۲ سند)؛ فقط همین فایل باید عوض شود.
 * در development پیامکی فرستاده نمی‌شود و OTP همان کد ثابت است.
 */
async function sendOtp(mobile, code) {
  if (!config.isProd) {
    logger.info({ mobile }, 'dev mode: sms not sent, use the fixed DEV_OTP_CODE');
    return;
  }
  // TODO: اتصال به سرویس پیامک (مثلاً کاوه‌نگار). تا آن موقع ورود در production ممکن نیست.
  void code;
  throw new Error('SMS provider is not configured');
}

module.exports = { sendOtp };
