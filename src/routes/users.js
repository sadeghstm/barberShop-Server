'use strict';

const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const userController = require('../controllers/user');

router.patch('/me', authenticate, userController.updateMe);

module.exports = router;
