'use strict';

const router = require('express').Router();

// همه مسیرهای برنامه فقط اینجا سوار می‌شوند. هر فایل در این پوشه یک بخش است.
router.use('/health', require('./health'));
router.use('/api/auth', require('./auth'));

// گام‌های بعد:
// router.use('/api/shops', require('./shops'));
// router.use('/api/appointments', require('./appointments'));

module.exports = router;
