'use strict';

const router = require('express').Router();
const authController = require('../controllers/auth');
const { authenticate } = require('../middlewares/auth');

router.post('/send-otp', authController.sendOtp);
router.post('/verify', authController.verify);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);
router.patch('/profile', authenticate, authController.updateProfile);

module.exports = router;
