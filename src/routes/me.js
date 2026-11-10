'use strict';

const router = require('express').Router();
const shopsController = require('../controllers/shops');
const referralsController = require('../controllers/referrals');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

router.get('/barber', shopsController.myBarberProfile);
router.get('/referral', referralsController.myReferral);
router.post('/referral/apply', referralsController.applyCode);
router.get('/wallet', referralsController.myWallet);

module.exports = router;
