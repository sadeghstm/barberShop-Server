'use strict';

const router = require('express').Router();
const { ROLES } = require('../constants/roles');
const { authenticate, optionalAuthenticate, requireRole, requireShopAccess } = require('../middlewares/auth');
const shopController = require('../controllers/shop');
const barberController = require('../controllers/barber');
const barberServiceController = require('../controllers/barberService');
const appointmentController = require('../controllers/appointment');
const visitController = require('../controllers/visit');

// آرایشگر یا مالک همان آرایشگاه (جزئیات دسترسی: خود آرایشگرِ نوبت یا مالک، در سرویس)
const staff = [authenticate, requireRole(ROLES.BARBER, ROLES.SHOP_OWNER), requireShopAccess()];
// فقط ادمین / فقط مالک همان آرایشگاه (یا ادمین)
const adminOnly = [authenticate, requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)];
const ownerOrAdmin = [authenticate, requireRole(ROLES.SHOP_OWNER, ROLES.ADMIN, ROLES.SUPER_ADMIN), requireShopAccess()];

// آرایشگاه
router.get('/', shopController.list);
router.post('/', adminOnly, shopController.create);
router.get('/:shopId', shopController.getOne);
router.patch('/:shopId', ownerOrAdmin, shopController.update);

// ساعت کاری و تعطیلی
router.put('/:shopId/working-hours', ownerOrAdmin, shopController.setWorkingHours);
router.post('/:shopId/holidays', ownerOrAdmin, shopController.addHoliday);
router.delete('/:shopId/holidays/:date', ownerOrAdmin, shopController.removeHoliday);

// آرایشگران
router.get('/:shopId/barbers', barberController.listPublic);
router.get('/:shopId/staff', ownerOrAdmin, barberController.listStaff);
router.post('/:shopId/barbers', ownerOrAdmin, barberController.add);
router.patch('/:shopId/barbers/:barberId', ownerOrAdmin, barberController.update);

// خدمات هر آرایشگر: دیدن عمومی است؛ قیمت، مدت و فهرست خدمات را فقط مالک (یا ادمین) تغییر می‌دهد
router.get('/:shopId/services', optionalAuthenticate, barberServiceController.listForShop);
router.get('/:shopId/barbers/:barberId/services', optionalAuthenticate, barberServiceController.listForBarber);
router.get('/:shopId/barbers/:barberId/services/manage', ownerOrAdmin, barberServiceController.manage);
router.put('/:shopId/barbers/:barberId/services/:serviceId', ownerOrAdmin, barberServiceController.offer);
router.patch('/:shopId/barbers/:barberId/services/:serviceId', ownerOrAdmin, barberServiceController.setActive);
router.delete('/:shopId/barbers/:barberId/services/:serviceId', ownerOrAdmin, barberServiceController.remove);

// زمان‌های آزاد برای رزرو (عمومی)
router.get('/:shopId/barbers/:barberId/availability', appointmentController.availability);

// کارهای روزِ آرایشگر: برنامه‌ی روز، حاضر شد / شروع / پایان / عدم حضور، مشتری حضوری
router.get('/:shopId/barbers/:barberId/schedule', staff, visitController.daySchedule);
router.post('/:shopId/barbers/:barberId/walk-ins', staff, visitController.walkIn);
router.post('/:shopId/appointments/:id/arrive', staff, visitController.arrive);
router.post('/:shopId/appointments/:id/start', staff, visitController.start);
router.post('/:shopId/appointments/:id/complete', staff, visitController.complete);
router.post('/:shopId/appointments/:id/no-show', staff, visitController.noShow);
router.patch('/:shopId/appointments/:id/no-show-hold', staff, visitController.noShowHold);

module.exports = router;
