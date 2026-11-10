'use strict';

const router = require('express').Router();
const shopsController = require('../controllers/shops');
const catalogController = require('../controllers/catalog');
const appointmentsController = require('../controllers/appointments');
const { authenticate, optionalAuth, requireRole, requireShopAccess } = require('../middlewares/auth');
const { ROLES } = require('../constants/roles');

// عمومی (قیمت‌ها بر اساس ورود کاربر در کنترلر تنظیم می‌شود)
router.get('/', optionalAuth, shopsController.list);
router.get('/slug/:slug', optionalAuth, shopsController.getBySlug);
router.get('/id/:shopId', authenticate, shopsController.getById);
router.get('/:shopId/booking-board', optionalAuth, shopsController.bookingBoard);
router.get('/:shopId/barbers', optionalAuth, shopsController.listBarbers);
router.get('/:shopId/survey-stats', authenticate, requireShopAccess(), shopsController.surveyStats);

// پنل مالک/آرایشگر
// هر کاربر واردشده می‌تواند آرایشگاه بسازد و مالک آن شود (نقش shopOwner از سند Barber می‌آید)
router.post('/', authenticate, shopsController.create);
router.patch('/:shopId', authenticate, requireShopAccess(), shopsController.update);
router.put('/:shopId/working-hours', authenticate, requireShopAccess(), requireRole(ROLES.SHOP_OWNER), shopsController.setWorkingHours);
router.post('/:shopId/holidays', authenticate, requireShopAccess(), requireRole(ROLES.SHOP_OWNER), shopsController.addHoliday);
router.delete('/:shopId/holidays/:date', authenticate, requireShopAccess(), requireRole(ROLES.SHOP_OWNER), shopsController.removeHoliday);

// کارکنان
router.get('/:shopId/staff', authenticate, requireShopAccess(), shopsController.listStaff);
router.post('/:shopId/barbers', authenticate, requireShopAccess(), requireRole(ROLES.SHOP_OWNER), shopsController.addBarber);
router.delete(
  '/:shopId/barbers/:barberId',
  authenticate,
  requireShopAccess(),
  requireRole(ROLES.SHOP_OWNER),
  shopsController.removeBarber,
);

// خدمات هر آرایشگر
router.get('/:shopId/barbers/:barberId/services', optionalAuth, catalogController.listBarberServices);
router.put(
  '/:shopId/barbers/:barberId/services/:serviceId',
  authenticate,
  requireShopAccess(),
  catalogController.upsertBarberService,
);
router.delete(
  '/:shopId/barbers/:barberId/services/:serviceId',
  authenticate,
  requireShopAccess(),
  catalogController.deactivateBarberService,
);

// درخواست خدمت جدید توسط آرایشگر
router.post('/:shopId/service-requests', authenticate, requireShopAccess(), catalogController.createServiceRequest);

// مشتری حضوری (کارکنان آرایشگاه)
router.post('/:shopId/walk-ins', authenticate, requireShopAccess(), appointmentsController.createWalkIn);

// زمان‌های آزاد
router.get(
  '/:shopId/barbers/:barberId/availability',
  optionalAuth,
  appointmentsController.availability,
);

module.exports = router;
