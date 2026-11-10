'use strict';

const router = require('express').Router();
const appointmentsController = require('../controllers/appointments');
const { authenticate } = require('../middlewares/auth');

// تابلوی روز آرایشگر (مالک/آرایشگر همان آرایشگاه یا ادمین — بررسی در سرویس)
router.get('/:barberId/board', authenticate, appointmentsController.board);
// آمار نظرسنجی آرایشگر (برای نمایش در صفحه انتخاب آرایشگر)
router.get('/:barberId/survey-stats', appointmentsController.barberSurveyStats);

module.exports = router;
