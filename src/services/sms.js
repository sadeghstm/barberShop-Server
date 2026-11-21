'use strict';

const { config } = require('../config');
const { logger } = require('../helpers/logger');

// فقط اولین بار ساخته می‌شود تا بدون کلید/پکیج، development و تست‌ها خراب نشوند
let api;
function getApi() {
  if (!api) {
    const Kavenegar = require('kavenegar');
    api = Kavenegar.KavenegarApi({ apikey: process.env.KAVENEGAR_API_KEY });
  }
  return api;
}

/** کاوه‌نگار با callback کار می‌کند؛ اینجا Promise می‌شود تا شکست ارسال به otp.js برسد. */
function send({ receptor, message }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SMS provider timeout')), 10000);
    getApi().Send({ message, sender: process.env.SMS_SENDER, receptor }, (response, status, text) => {
      clearTimeout(timer);
      if (status === 200) return resolve(response);
      const err = new Error(`SMS provider error (status ${status})`);
      err.providerMessage = text;
      return reject(err);
    });
  });
}

/**
 * ارسال کد تایید. سرویس‌دهنده فقط در همین فایل است.
 * در development (مگر SMS_ENABLED=true) پیامکی فرستاده نمی‌شود و OTP همان کد ثابت DEV_OTP_CODE است.
 */
async function sendOtp(mobile, code) {
  if (!config.isProd && process.env.SMS_ENABLED !== 'true') {
    logger.info({ mobile }, 'dev mode: sms not sent, use the fixed DEV_OTP_CODE');
    return;
  }
  try {
    await send({ receptor: mobile, message: `سامانه نوبت‌دهی آرایشگاه\nکد تایید: ${code}` });
  } catch (err) {
    logger.error({ mobile, err: err.message, providerMessage: err.providerMessage }, 'sms send failed'); // کد در لاگ نمی‌آید
    throw err;
  }
}

module.exports = { sendOtp };