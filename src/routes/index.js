'use strict';

const router = require('express').Router();

// همه مسیرهای برنامه فقط اینجا سوار می‌شوند. هر فایل در این پوشه یک بخش است.
router.use('/health', require('./health'));
router.use('/api/auth', require('./auth'));
router.use('/api/shops', require('./shops'));
router.use('/api/appointments', require('./appointments'));
router.use('/api/barbers', require('./barbers'));
router.use('/api/services', require('./services'));
router.use('/api/surveys', require('./surveys'));
router.use('/api/admin', require('./admin'));
router.use('/api/me', require('./me'));

module.exports = router;
