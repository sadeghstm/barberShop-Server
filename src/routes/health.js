'use strict';

const router = require('express').Router();
const healthController = require('../controllers/health');

router.get('/', healthController.live);
router.get('/ready', healthController.ready);

module.exports = router;
