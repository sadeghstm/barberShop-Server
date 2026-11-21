'use strict';

const router = require('express').Router();
const { ROLES } = require('../constants/roles');
const { authenticate, optionalAuthenticate, requireRole } = require('../middlewares/auth');
const catalogController = require('../controllers/catalog');

const adminOnly = [authenticate, requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)];

router.get('/', optionalAuthenticate, catalogController.list);
router.post('/', adminOnly, catalogController.create);
router.patch('/:serviceId', adminOnly, catalogController.update);
router.post('/:serviceId/removal', adminOnly, catalogController.requestRemoval);
router.post('/:serviceId/restore', adminOnly, catalogController.restore);

module.exports = router;
