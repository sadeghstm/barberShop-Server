'use strict';

// استفاده:  npm run seed-services
// خدمات پیش‌فرض کاتالوگ را می‌سازد؛ هر عنوانی که از قبل هست رد می‌شود (بارها می‌توان اجرا کرد).
// عنوان‌ها را بعداً ادمین از API می‌تواند ویرایش کند یا خدمت تازه بسازد.
const { connectMongo, disconnectMongo } = require('../src/db/mongo');
const ServiceCatalog = require('../src/models/ServiceCatalog');
const auditService = require('../src/services/audit');
const { SYSTEM_ACTOR } = require('../src/constants/roles');

const DEFAULT_SERVICES = [
  'اصلاح سر',
  'اصلاح ریش',
  'اصلاح سر و ریش',
  'اصلاح سر کودک',
  'شست‌وشوی مو',
  'رنگ مو',
  'رنگ ریش',
  'مرتب‌سازی ابرو',
  'کراتینه مو',
  'پاکسازی و ماسک صورت',
];

async function main() {
  await connectMongo();
  let created = 0;
  for (const title of DEFAULT_SERVICES) {
    try {
      const service = await ServiceCatalog.create({ title, isDefault: true });
      await auditService.record({
        actor: { role: SYSTEM_ACTOR },
        action: 'service.create',
        entityType: 'serviceCatalog',
        entityId: service._id,
        after: service,
        meta: { source: 'seed' },
      });
      created += 1;
    } catch (err) {
      if (err.code !== 11000) throw err; // عنوان تکراری: قبلاً ساخته شده
    }
  }
  console.log(`خدمات جدید: ${created} از ${DEFAULT_SERVICES.length} (بقیه از قبل بودند)`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
