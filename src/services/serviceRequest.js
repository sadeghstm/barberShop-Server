'use strict';

const ServiceRequest = require('../models/ServiceRequest');
const ServiceCatalog = require('../models/ServiceCatalog');
const Barber = require('../models/Barber');
const Shop = require('../models/Shop');
const { AppError } = require('../helpers/AppError');
const { SERVICE_REQUEST_STATUS: STATUS, CATALOG_STATUS } = require('../constants/enums');

const DUPLICATE_KEY = 11000;
const MAX_PENDING_PER_BARBER = 5; // تا یک آرایشگر صف ادمین را پر نکند
const { normalizeTitle } = ServiceCatalog;

/**
 * آرایشگر (یا مالک) خدمت جدید پیشنهاد می‌دهد؛ فقط عنوان و توضیح (۵.۵ سند).
 * auth: req.auth آرایشگر (shopId و barberId دارد)
 */
async function create(auth, { title, description }) {
  const key = normalizeTitle(title);

  const inCatalog = await ServiceCatalog.findOne({ titleKey: key });
  if (inCatalog) {
    throw AppError.conflict('خدمتی با این عنوان از قبل در کاتالوگ هست', { serviceId: inCatalog._id }, 'ALREADY_IN_CATALOG');
  }

  const pending = await ServiceRequest.find({ barberId: auth.barberId, status: STATUS.PENDING });
  if (pending.some((r) => normalizeTitle(r.title) === key)) {
    throw AppError.conflict('درخواست مشابهی از شما در انتظار بررسی است', undefined, 'DUPLICATE_REQUEST');
  }
  if (pending.length >= MAX_PENDING_PER_BARBER) {
    throw AppError.conflict(`حداکثر ${MAX_PENDING_PER_BARBER} درخواست در انتظار بررسی می‌توانید داشته باشید`, undefined, 'TOO_MANY_PENDING');
  }

  return ServiceRequest.create({
    shopId: auth.shopId,
    barberId: auth.barberId,
    requestedBy: auth.userId,
    title,
    description,
  });
}

async function listMine(auth) {
  return ServiceRequest.find({ requestedBy: auth.userId }).sort({ createdAt: -1 }).limit(100);
}

/** برای ادمین: status = pending | approved | rejected | all. با نام آرایشگر و آرایشگاه. */
async function listAll({ status, page, limit }) {
  const filter = status === 'all' ? {} : { status };
  const [rows, total] = await Promise.all([
    ServiceRequest.find(filter)
      .sort({ createdAt: 1 }) // قدیمی‌ترین اول: صف بررسی
      .skip((page - 1) * limit)
      .limit(limit),
    ServiceRequest.countDocuments(filter),
  ]);

  const ids = (field) => [...new Set(rows.map((r) => String(r[field])))];
  const [barbers, shops] = await Promise.all([
    Barber.find({ _id: { $in: ids('barberId') } }).select('displayName'),
    Shop.find({ _id: { $in: ids('shopId') } }).select('name'),
  ]);
  const barberName = new Map(barbers.map((b) => [String(b._id), b.displayName]));
  const shopName = new Map(shops.map((s) => [String(s._id), s.name]));

  return {
    total,
    items: rows.map((request) => ({
      request,
      barberName: barberName.get(String(request.barberId)) ?? '',
      shopName: shopName.get(String(request.shopId)) ?? '',
    })),
  };
}

async function getOrThrow(requestId) {
  const request = await ServiceRequest.findById(requestId);
  if (!request) throw AppError.notFound('درخواست یافت نشد');
  return request;
}

/** فقط یک بار می‌شود تصمیم گرفت: «در انتظار» ← تصمیم (شرطی، تا دو ادمین هم‌زمان تصمیم متفاوت نگیرند). */
async function claim(requestId, admin, changes) {
  const claimed = await ServiceRequest.findOneAndUpdate(
    { _id: requestId, status: STATUS.PENDING },
    { ...changes, decidedBy: admin.userId, decidedAt: new Date() },
    { new: true },
  );
  if (!claimed) {
    await getOrThrow(requestId); // اگر اصلاً نبود ۴۰۴
    throw AppError.conflict('درباره‌ی این درخواست قبلاً تصمیم گرفته شده است', undefined, 'ALREADY_DECIDED');
  }
  return claimed;
}

/**
 * تایید: یک خدمت جدید در کاتالوگ ساخته می‌شود، یا اگر mergeInto داده شود (عنوان مشابه)، به خدمت موجود وصل می‌شود.
 * خروجی: { request, service, created }
 */
async function approve(requestId, admin, { mergeInto } = {}) {
  let target = null;
  if (mergeInto) {
    target = await ServiceCatalog.findById(mergeInto);
    if (!target) throw AppError.notFound('خدمتِ مقصد برای ادغام یافت نشد');
    if (target.status !== CATALOG_STATUS.ACTIVE) throw AppError.conflict('خدمت مقصد فعال نیست', undefined, 'TARGET_NOT_ACTIVE');
  }

  const request = await claim(requestId, admin, { status: STATUS.APPROVED, serviceId: target?._id ?? null });
  if (target) return { request, service: target, created: false };

  try {
    const service = await ServiceCatalog.create({
      title: request.title,
      description: request.description,
      isDefault: false,
      createdFromRequestId: request._id,
    });
    return { request: await ServiceRequest.findOneAndUpdate({ _id: request._id }, { serviceId: service._id }, { new: true }), service, created: true };
  } catch (err) {
    // جبران: درخواست دوباره «در انتظار» شود تا ادمین ادغام یا رد کند
    await ServiceRequest.findOneAndUpdate({ _id: request._id }, { status: STATUS.PENDING, decidedBy: null, decidedAt: null });
    if (err.code === DUPLICATE_KEY) {
      throw AppError.conflict('عنوان مشابهی در کاتالوگ هست؛ با mergeInto ادغام کنید یا درخواست را رد کنید', undefined, 'DUPLICATE_TITLE');
    }
    throw err;
  }
}

async function reject(requestId, admin, reason) {
  return claim(requestId, admin, { status: STATUS.REJECTED, rejectReason: reason });
}

module.exports = { create, listMine, listAll, getOrThrow, approve, reject };
