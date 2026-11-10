'use strict';

const { ROLES } = require('../constants/roles');
const { AppError } = require('../helpers/AppError');
const { normalizeMobile, toEnglishDigits } = require('../helpers/mobile');
const { config } = require('../config');
const otpService = require('../services/otp');
const sessionService = require('../services/session');
const userService = require('../services/user');
const { COOKIE_NAME } = require('../middlewares/auth');

function cookieOptions() {
  return {
    httpOnly: true, // جاوااسکریپت صفحه به توکن دسترسی ندارد
    sameSite: 'lax',
    secure: config.isProd, // در production فقط روی HTTPS
    maxAge: sessionService.ttlSeconds() * 1000,
    path: '/',
  };
}

function requireMobile(value) {
  const mobile = normalizeMobile(value);
  if (!mobile) throw AppError.validation('شماره موبایل معتبر نیست');
  return mobile;
}

/** POST /api/auth/send-otp  { mobile } */
exports.sendOtp = async (req, res) => {
  const mobile = requireMobile(req.body?.mobile);
  const { expiresInSeconds } = await otpService.send(mobile);
  res.json({ message: 'کد تایید ارسال شد', expiresInSeconds });
};

/** POST /api/auth/verify  { mobile, code } — کاربر جدید خودکار ساخته می‌شود */
exports.verify = async (req, res) => {
  const mobile = requireMobile(req.body?.mobile);
  const code = toEnglishDigits(req.body?.code).trim();
  if (!/^\d{5}$/.test(code)) throw AppError.validation('کد تایید باید ۵ رقم باشد');

  await otpService.verify(mobile, code);

  const { user, isNew } = await userService.findOrCreateByMobile(mobile);
  if (!user.isActive) throw AppError.forbidden('حساب شما غیرفعال است');

  if (isNew) {
    await req.audit({
      actor: { userId: user._id, role: ROLES.CUSTOMER },
      action: 'user.register',
      entityType: 'users',
      entityId: user._id,
      after: user,
    });
  }

  const token = await sessionService.create(user._id);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ user: { id: user._id, mobile: user.mobile, name: user.name }, isNew });
};

/** POST /api/auth/logout */
exports.logout = async (req, res) => {
  await sessionService.destroy(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ message: 'خارج شدید' });
};

/** GET /api/auth/me — اطلاعات کاربر واردشده (برای فرانت‌اند) */
exports.me = (req, res) => {
  const { userId, mobile, name, role, roles, shopId, barberId } = req.auth;
  res.json({ user: { id: userId, mobile, name, role, roles, shopId, barberId } });
};

/** PATCH /api/auth/profile { name } — ویرایش نام نمایشی */
exports.updateProfile = async (req, res) => {
  const user = await userService.updateProfile({ userId: req.auth.userId, name: req.body?.name });
  await req.audit({
    action: 'user.updateProfile',
    entityType: 'users',
    entityId: user._id,
    after: { name: user.name },
  });
  res.json({ user: { id: user._id, mobile: user.mobile, name: user.name } });
};
