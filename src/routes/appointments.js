'use strict';

const router = require('express').Router();
const appointmentsController = require('../controllers/appointments');
const { authenticate } = require('../middlewares/auth');

// مشتری
router.post('/hold', authenticate, appointmentsController.createHold);
router.get('/mine', authenticate, appointmentsController.mine);
router.get('/:id', authenticate, appointmentsController.getOne);
router.post('/:id/pay', authenticate, appointmentsController.pay);
router.post('/:id/cancel', authenticate, appointmentsController.cancel);
router.post('/:id/cancel-request/decide', authenticate, appointmentsController.decideCancelRequest);
router.post('/:id/survey', authenticate, appointmentsController.createSurvey);

// آرایشگر / مالک
router.post('/:id/cancel-request', authenticate, appointmentsController.requestCancel);
router.post('/:id/arrived', authenticate, appointmentsController.arrived);
router.post('/:id/start', authenticate, appointmentsController.start);
router.post('/:id/complete', authenticate, appointmentsController.complete);
router.post('/:id/no-show-hold', authenticate, appointmentsController.noShowHold);

module.exports = router;
