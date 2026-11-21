'use strict';

const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const appointmentController = require('../controllers/appointment');

// نوبت‌های خود کاربر واردشده (هر نقشی)
router.post('/', authenticate, appointmentController.hold);
router.get('/', authenticate, appointmentController.listMine);
router.get('/:id', authenticate, appointmentController.getOne);
router.post('/:id/pay', authenticate, appointmentController.pay);

module.exports = router;
