'use strict';

const router = require('express').Router();
const adminController = require('../controllers/admin');
const { authenticate, requireRole } = require('../middlewares/auth');
const { ROLES } = require('../constants/roles');

const ADMIN = requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
const SUPER = requireRole(ROLES.SUPER_ADMIN);

router.use(authenticate);

router.get('/settings', adminController.getSettings);
router.put('/settings', SUPER, adminController.updateSettings);

router.get('/payments', ADMIN, adminController.listPayments);
router.post('/payments/:paymentId/refund', ADMIN, adminController.refund);
router.get('/refunds', ADMIN, adminController.listRefunds);

router.get('/users', ADMIN, adminController.listUsers);
router.put('/users/:userId/roles', SUPER, adminController.setUserRoles);
router.get('/users/:userId/wallet', ADMIN, adminController.userWallet);

router.get('/audit-logs', ADMIN, adminController.listAuditLogs);
router.get('/stats', ADMIN, adminController.stats);

// اجرای دستی کارهای زمان‌بندی‌شده
router.post('/jobs/expire-holds', ADMIN, adminController.expireHolds);
router.post('/jobs/no-show', ADMIN, adminController.runNoShow);

module.exports = router;
