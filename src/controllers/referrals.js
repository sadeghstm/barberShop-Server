'use strict';

const referralService = require('../services/referral');

/** GET /api/me/referral — کد معرف، تعداد دعوت‌شده، پورسانت‌ها */
exports.myReferral = async (req, res) => {
  const info = await referralService.getMyReferralInfo(req.auth.userId);
  res.json(info);
};

/** POST /api/me/referral/apply { code } */
exports.applyCode = async (req, res) => {
  const result = await referralService.applyReferralCode({ userId: req.auth.userId, code: req.body?.code });
  res.json(result);
};

/** GET /api/me/wallet — موجودی و تراکنش‌ها */
exports.myWallet = async (req, res) => {
  const wallet = await referralService.getMyWallet(req.auth.userId);
  res.json(wallet);
};
