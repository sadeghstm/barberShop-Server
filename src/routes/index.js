'use strict';

const router = require('express').Router();

// همه مسیرهای برنامه فقط اینجا سوار می‌شوند. هر فایل در این پوشه یک بخش است.
router.use('/health', require('./health'));
router.use('/api/auth', require('./auth'));
router.use('/api/users', require('./users'));
router.use('/api/shops', require('./shops'));
router.use('/api/services', require('./catalog'));
router.use('/api/service-requests', require('./serviceRequests'));
router.use('/api/appointments', require('./appointments'));

module.exports = router;
