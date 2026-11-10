'use strict';

const router = require('express').Router();
const catalogController = require('../controllers/catalog');
const { authenticate, optionalAuth, requireRole } = require('../middlewares/auth');
const { ROLES } = require('../constants/roles');

// لیبل‌های نظرسنجی (برای فرم مشتری)
router.get('/labels', optionalAuth, catalogController.listSurveyLabels);
// مدیریت لیبل‌ها (ادمین)
router.put(
  '/labels/:key',
  authenticate,
  requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  catalogController.upsertSurveyLabel,
);

module.exports = router;
