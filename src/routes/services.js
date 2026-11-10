'use strict';

const router = require('express').Router();
const catalogController = require('../controllers/catalog');
const { authenticate, optionalAuth, requireRole } = require('../middlewares/auth');
const { ROLES } = require('../constants/roles');

const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

// کاتالوگ سراسری
router.get('/', optionalAuth, catalogController.listCatalog);
router.post('/', authenticate, requireRole(...ADMIN_ROLES), catalogController.createCatalogService);
router.post('/:serviceId/removal', authenticate, requireRole(...ADMIN_ROLES), catalogController.requestRemoval);
router.post('/:serviceId/archive', authenticate, requireRole(...ADMIN_ROLES), catalogController.archive);

// درخواست‌های خدمت (ادمین)
router.get('/requests', authenticate, requireRole(...ADMIN_ROLES), catalogController.listServiceRequests);
router.post(
  '/requests/:requestId/decide',
  authenticate,
  requireRole(...ADMIN_ROLES),
  catalogController.decideServiceRequest,
);

module.exports = router;
