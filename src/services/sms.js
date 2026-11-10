'use strict';

// ارسال پیامک (بخش ۵.۹): در development هیچ پیامکی فرستاده نمی‌شود (کد OTP ثابت است).
// در production با تنظیم SMS_PROVIDER=kavenegar و SMS_API_KEY ارسال واقعی انجام می‌شود.
// فقط همین فایل به سرویس‌دهنده وابسته است؛ بقیه برنامه فقط send/ sendOtp را صدا می‌زند.

const { config } = require('../config');
const { logger } = require('../helpers/logger');
const { AppError } = require('../helpers/AppError');

const SEND_TIMEOUT_MS = 10_000;

/** متن کد تایید. */
function otpText(code) {
  return `کد تایید شما در سامانه نوبت‌دهی: ${code}`;
}

/** ارسال از طریق کاوه‌نگار (REST ساده، بدون SDK). */
async function sendViaKavenegar(mobile, text) {
  const url = `https://api.kavenegar.com/v1/${encodeURIComponent(config.smsApiKey)}/sms/send.json`;
  const body = new URLSearchParams({
    receptor: mobile,
    message: text,
    sender: config.smsSender ?? '',
  });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError('ارسال پیامک ناموفق بود', { statusCode: 502, code: 'SMS_FAILED', cause: err });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AppError('سرویس پیامک خطا داد', {
      statusCode: 502,
      code: 'SMS_FAILED',
      details: { status: response.status, detail: detail.slice(0, 300) },
    });
  }
  return response.json().catch(() => ({}));
}

/** ارسال یک پیامک. در mock یا محیط غیر production فقط لاگ می‌شود. */
async function send(mobile, text) {
  if (!mobile || !text) throw new AppError('شماره و متن پیامک الزامی است', { statusCode: 422, code: 'VALIDATION_ERROR' });

  if (config.smsProvider === 'mock' || !config.isProd) {
    logger.info({ mobile, provider: config.smsProvider, dev: !config.isProd }, 'sms skipped (mock/dev)');
    return { mock: true };
  }

  if (config.smsProvider === 'kavenegar') {
    if (!config.smsApiKey) {
      throw new AppError('کلید سرویس پیامک تنظیم نشده است', { statusCode: 500, code: 'SMS_NOT_CONFIGURED' });
    }
    const result = await sendViaKavenegar(mobile, text);
    logger.info({ mobile }, 'sms sent');
    return result;
  }

  throw new AppError('سرویس پیامک پشتیبانی نمی‌شود', { statusCode: 500, code: 'SMS_NOT_CONFIGURED' });
}

/** ارسال کد تایید (همان مسیر send، متن متفاوت). */
async function sendOtp(mobile, code) {
  return send(mobile, otpText(code));
}

module.exports = { send, sendOtp, otpText };
