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
router.post('/admins', SUPER, adminController.createAdmin);
router.put('/users/:userId/roles', SUPER, adminController.setUserRoles);
router.put('/users/:userId/active', ADMIN, adminController.setUserActive);
router.get('/users/:userId/wallet', ADMIN, adminController.userWallet);

// آرایشگاه‌ها
router.get('/shops', ADMIN, adminController.listShops);
router.post('/shops/:shopId/deactivate', ADMIN, adminController.deactivateShop);
router.post('/shops/:shopId/activate', ADMIN, adminController.activateShop);
router.post('/shops/:shopId/transfer-ownership', SUPER, adminController.transferOwnership);

// نوبت‌ها
router.get('/appointments', ADMIN, adminController.listAppointments);
router.get('/cancel-requests', ADMIN, adminController.pendingCancelRequests);
router.post('/appointments/:id/cancel', ADMIN, adminController.forceCancel);
router.post('/appointments/:id/revert', ADMIN, adminController.revertCompletion);

router.get('/audit-logs', ADMIN, adminController.listAuditLogs);
router.get('/stats', ADMIN, adminController.stats);
router.get('/stats/daily', ADMIN, adminController.dailyStats);

// اجرای دستی کارهای زمان‌بندی‌شده
router.post('/jobs/expire-holds', ADMIN, adminController.expireHolds);
router.post('/jobs/no-show', ADMIN, adminController.runNoShow);

module.exports = router;
