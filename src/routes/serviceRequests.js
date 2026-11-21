'use strict';

const router = require('express').Router();
const { ROLES } = require('../constants/roles');
const { authenticate, requireRole } = require('../middlewares/auth');
const controller = require('../controllers/serviceRequest');

const adminOnly = [authenticate, requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)];
const barberOnly = [authenticate, requireRole(ROLES.BARBER, ROLES.SHOP_OWNER)];

// آرایشگر خدمت جدید پیشنهاد می‌دهد، ادمین تایید یا رد می‌کند
router.post('/', barberOnly, controller.create);
router.get('/mine', barberOnly, controller.listMine);
router.get('/', adminOnly, controller.list);
router.post('/:id/approve', adminOnly, controller.approve);
router.post('/:id/reject', adminOnly, controller.reject);

module.exports = router;
