'use strict';

// استفاده:  npm run seed:demo
// داده نمایشی می‌سازد (idempotent): یک آرایشگاه نمونه، مالک/آرایشگر، آرایشگر دوم،
// فعال‌سازی چند خدمت با قیمت و مدت و ساعت کاری شنبه تا پنجشنبه ۰۹:۰۰–۲۱:۰۰ (جمعه تعطیل).
// در پایان شماره‌های موبایل قابل ورود را چاپ می‌کند (کد OTP در development: 12345).

const { connectMongo, disconnectMongo } = require('../src/db/mongo');
const User = require('../src/models/User');
const Shop = require('../src/models/Shop');
const Barber = require('../src/models/Barber');
const ServiceCatalog = require('../src/models/ServiceCatalog');
const BarberService = require('../src/models/BarberService');
const { ROLES } = require('../src/constants/roles');
const { ensureDefaultCatalog, ensureDefaultSurveyLabels } = require('../src/services/seed');

const WORKING_HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  // 0 = شنبه ... 5 = پنجشنبه باز؛ 6 = جمعه تعطیل
  intervals: weekday === 6 ? [] : [{ start: '09:00', end: '21:00' }],
}));

const DEMO_SERVICES = [
  { title: 'اصلاح مو', price: 150000, durationMinutes: 30 },
  { title: 'اصلاح ریش', price: 80000, durationMinutes: 20 },
  { title: 'اصلاح سر و صورت', price: 200000, durationMinutes: 45 },
  { title: 'اصلاح ابرو', price: 40000, durationMinutes: 15 },
];

async function ensureUser(mobile, name, roles = [ROLES.CUSTOMER]) {
  const existing = await User.findOne({ mobile });
  if (existing) return existing;
  return User.create({ mobile, name, roles });
}

async function main() {
  await connectMongo();
  await ensureDefaultCatalog();
  await ensureDefaultSurveyLabels();

  const owner = await ensureUser('09120000001', 'مالک نمونه', [ROLES.CUSTOMER]);
  const barberUser = await ensureUser('09120000002', 'آرایشگر نمونه');
  const customer = await ensureUser('09120000003', 'مشتری نمونه');

  let shop = await Shop.findOne({ slug: 'demo-shop' });
  if (!shop) {
    shop = await Shop.create({
      name: 'آرایشگاه نمونه',
      slug: 'demo-shop',
      ownerId: owner._id,
      city: 'تهران',
      address: 'خیابان نمونه، پلاک ۱',
      phone: '02100000000',
      settings: { showPricesToGuests: true, workingHours: WORKING_HOURS, holidays: [] },
    });
  }

  const ownerBarber =
    (await Barber.findOne({ userId: owner._id, shopId: shop._id })) ??
    (await Barber.create({ userId: owner._id, shopId: shop._id, isOwner: true, displayName: 'مالک نمونه' }));

  const secondBarber =
    (await Barber.findOne({ userId: barberUser._id, shopId: shop._id })) ??
    (await Barber.create({ userId: barberUser._id, shopId: shop._id, displayName: 'آرایشگر نمونه' }));

  let created = 0;
  for (const item of DEMO_SERVICES) {
    const service = await ServiceCatalog.findOne({ title: item.title });
    if (!service) continue;
    for (const barber of [ownerBarber, secondBarber]) {
      const exists = await BarberService.findOne({ barberId: barber._id, serviceId: service._id });
      if (exists) continue;
      await BarberService.create({
        barberId: barber._id,
        shopId: shop._id,
        serviceId: service._id,
        price: item.price,
        durationMinutes: item.durationMinutes,
        isActive: true,
      });
      created += 1;
    }
  }

  console.log('آرایشگاه نمونه آماده است:');
  console.log(`  slug: ${shop.slug}`);
  console.log(`  مالک/آرایشگر: ${owner.mobile}`);
  console.log(`  آرایشگر دوم: ${barberUser.mobile}`);
  console.log(`  مشتری: ${customer.mobile}`);
  console.log(`  خدمات فعال‌شده جدید: ${created}`);
  console.log('  کد ورود در development: 12345');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
